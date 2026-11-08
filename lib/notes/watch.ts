import "server-only";
import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { DATA_DIR, projectSlug } from "@/lib/projects/paths";
import { listProjects } from "@/lib/supabase/repo/projects";
import { listAllWorkspaces } from "@/lib/supabase/repo/workspaces";
import { MEMORY_NOTE_ID, type NoteEvent, type NoteScope } from "./types";

type Listener = (e: NoteEvent) => void;

type Watch = {
  watcher: FSWatcher | null;
  listeners: Set<Listener>;
  pending: Map<string, ReturnType<typeof setTimeout>>;
  /** project slug → id, and `${projectSlug}/${workspaceSlug}` → workspace id. */
  projects: Map<string, string>;
  workspaces: Map<string, string>;
};

// One watcher per server process, surviving dev hot reloads like the db client.
const g = globalThis as typeof globalThis & { __thunkNotesWatch?: Watch };
const state = (g.__thunkNotesWatch ??= { watcher: null, listeners: new Set(), pending: new Map(), projects: new Map(), workspaces: new Map() });

const ROOT = path.join(DATA_DIR, "projects");
const DEBOUNCE_MS = 150;

async function refreshSlugs() {
  const [projects, workspaces] = await Promise.all([listProjects().catch(() => []), listAllWorkspaces().catch(() => [])]);
  state.projects = new Map(projects.map((p) => [projectSlug(p.root), p.id]));
  const roots = new Map(projects.map((p) => [p.id, p.root]));
  state.workspaces = new Map(
    workspaces.flatMap((w) => (roots.has(w.projectId) ? [[`${projectSlug(roots.get(w.projectId)!)}/${w.slug}`, w.id] as const] : [])),
  );
}

/** Map a changed file under DATA_DIR/projects to the note it backs. */
async function resolve(rel: string): Promise<{ scope: NoteScope; noteId: string } | null> {
  const parts = rel.split(path.sep);
  let scopeOf: () => NoteScope | null;
  let file: string[];
  if (parts[1] === "workspaces" && parts.length === 5) {
    const key = `${parts[0]}/${parts[2]}`;
    scopeOf = () => (state.workspaces.has(key) ? { kind: "workspaces", id: state.workspaces.get(key)! } : null);
    file = parts.slice(3);
  } else if (parts.length === 3) {
    scopeOf = () => (state.projects.has(parts[0]) ? { kind: "projects", id: state.projects.get(parts[0])! } : null);
    file = parts.slice(1);
  } else return null;

  let noteId: string;
  if (file[0] === "notes" && file[1].endsWith(".md")) noteId = file[1].slice(0, -3);
  else if (file[0] === "memory" && file[1] === "MEMORY.md") noteId = MEMORY_NOTE_ID;
  else return null;

  let scope = scopeOf();
  if (!scope) {
    await refreshSlugs();
    scope = scopeOf();
  }
  return scope ? { scope, noteId } : null;
}

function emit(rel: string) {
  void resolve(rel).then((hit) => {
    if (!hit) return;
    const kind = existsSync(path.join(ROOT, rel)) ? "changed" : "removed";
    for (const l of state.listeners) l({ ...hit, kind });
  });
}

function start() {
  if (state.watcher) return;
  mkdirSync(ROOT, { recursive: true });
  void refreshSlugs();
  try {
    state.watcher = watch(ROOT, { recursive: true }, (_event, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      const rel = filename.toString();
      clearTimeout(state.pending.get(rel));
      state.pending.set(rel, setTimeout(() => { state.pending.delete(rel); emit(rel); }, DEBOUNCE_MS));
    });
    state.watcher.on("error", (err) => {
      console.error("[thunk] notes watcher", err);
      state.watcher?.close();
      state.watcher = null;
    });
  } catch (err) {
    console.error("[thunk] notes watcher unavailable", err);
  }
}

/** Subscribe to note file changes, including agents editing files directly. */
export function subscribeNotes(listener: Listener) {
  start();
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size === 0 && state.watcher) {
      state.watcher.close();
      state.watcher = null;
    }
  };
}
