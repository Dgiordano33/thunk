import "server-only";
import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { reconcileDeclaredFolders } from "./folders";
import { repoNoteDirs } from "./resolve";
import path from "node:path";
import { DATA_DIR } from "@/lib/projects/paths";
import { listProjects } from "@/lib/supabase/repo/projects";
import { listAllWorkspaces } from "@/lib/supabase/repo/workspaces";
import { MEMORY_NOTE_ID, type NoteEvent, type NoteScope } from "./types";

type Listener = (e: NoteEvent) => void;

type Watch = {
  watcher: FSWatcher | null;
  folders?: Map<string, { watcher: FSWatcher; inode: number; path: string }>;
  folderRetry?: ReturnType<typeof setTimeout>;
  refreshing?: Promise<void>;
  retry?: ReturnType<typeof setTimeout>;
  retryDelay?: number;
  healthy?: ReturnType<typeof setTimeout>;
  listeners: Set<Listener>;
  pending: Map<string, ReturnType<typeof setTimeout>>;
  /** project data key → id, and `${dataKey}/${workspaceSlug}` → workspace id. */
  projects: Map<string, string>;
  workspaces: Map<string, string>;
};

// One watcher per server process, surviving dev hot reloads like the db client.
const g = globalThis as typeof globalThis & { __thunkNotesWatch?: Watch };
const state: Watch = (g.__thunkNotesWatch ??= { watcher: null, listeners: new Set(), pending: new Map(), projects: new Map(), workspaces: new Map() });

const ROOT = path.join(DATA_DIR, "projects");
const DEBOUNCE_MS = 150;
/** Safety-net rescan for folders that appear later or are replaced without a `rename` reaching the watcher. */
const FOLDER_RESCAN_MS = 60_000;
/** Git replaces directories on checkout; re-watch soon after a watcher sees its own directory go. */
const FOLDER_REPLACED_MS = 1000;

async function refreshSlugs() {
  const [projects, workspaces] = await Promise.all([listProjects().catch(() => []), listAllWorkspaces().catch(() => [])]);
  state.projects = new Map(projects.map((p) => [p.dataKey, p.id]));
  const keys = new Map(projects.map((p) => [p.id, p.dataKey]));
  state.workspaces = new Map(
    workspaces.flatMap((w) => (keys.has(w.projectId) ? [[`${keys.get(w.projectId)}/${w.slug}`, w.id] as const] : [])),
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

function retry() {
  if (!state.listeners.size || state.retry) return;
  const delay = state.retryDelay ?? 1000;
  state.retryDelay = Math.min(delay * 2, 30_000);
  state.retry = setTimeout(() => {
    state.retry = undefined;
    start();
  }, delay);
}

function start() {
  if (state.watcher || state.retry) return;
  void refreshSlugs();
  void refreshFolders();
  try {
    mkdirSync(ROOT, { recursive: true });
    state.watcher = watch(ROOT, { recursive: true }, (_event, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      const rel = filename.toString();
      clearTimeout(state.pending.get(rel));
      state.pending.set(rel, setTimeout(() => { state.pending.delete(rel); emit(rel); }, DEBOUNCE_MS));
    });
    state.healthy = setTimeout(() => { state.retryDelay = 1000; }, 30_000);
    state.watcher.on("error", (err) => {
      console.error("[thunk] notes watcher", err);
      state.watcher?.close();
      state.watcher = null;
      clearTimeout(state.healthy);
      retry();
    });
  } catch (err) {
    console.error("[thunk] notes watcher unavailable", err);
    retry();
  }
}

/** Subscribe to note file changes, including agents editing files directly. */
export function subscribeNotes(listener: Listener) {
  state.listeners.add(listener);
  start();
  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size === 0) {
      clearTimeout(state.folderRetry);
      state.folderRetry = undefined;
      for (const entry of state.folders?.values() ?? []) entry.watcher.close();
      state.folders?.clear();
      clearTimeout(state.retry);
      clearTimeout(state.healthy);
      state.retry = undefined;
      state.retryDelay = 1000;
      for (const timer of state.pending.values()) clearTimeout(timer);
      state.pending.clear();
      state.watcher?.close();
      state.watcher = null;
    }
  };
}

/** Reconcile watches after registration, on a slow tick, and soon after git replaces a watched directory. */
export function refreshFolders(): Promise<void> {
  if (!state.listeners.size) return Promise.resolve();
  if (state.refreshing) return state.refreshing;
  state.refreshing = refreshRepoWatches().catch((err) => console.error("[thunk] repo notes watcher", err)).finally(() => {
    state.refreshing = undefined;
    scheduleFolderRefresh(FOLDER_RESCAN_MS);
  });
  return state.refreshing;
}

function scheduleFolderRefresh(delay: number) {
  clearTimeout(state.folderRetry);
  if (state.listeners.size) state.folderRetry = setTimeout(() => { void refreshFolders(); }, delay);
}

async function refreshRepoWatches() {
  const folders = (state.folders ??= new Map());
  const projects = await Promise.all((await listProjects()).map((p) => reconcileDeclaredFolders(p)));
  const wanted = new Set<string>();
  for (const project of projects) for (const folder of project.repoFolders) {
    if (!state.listeners.size) return;
    const key = `r:${folder.id}`;
    try {
      const dirs = await repoNoteDirs(project, folder);
      const info = await stat(dirs.notesDir);
      if (!state.listeners.size) return;
      wanted.add(folder.id);
      const current = folders.get(folder.id);
      if (current?.inode === info.ino && current.path === dirs.notesDir) continue;
      current?.watcher.close();
      const emitFolder = () => {
        for (const listener of state.listeners) listener({ scope: dirs.scope, noteId: "*", kind: "changed" });
      };
      const watcher = watch(dirs.notesDir, (event, filename) => {
        const gone = !existsSync(dirs.notesDir);
        // The directory itself was renamed or removed: this inode is stale, so re-watch whatever replaces it.
        if (gone || (event === "rename" && filename === path.basename(dirs.notesDir))) scheduleFolderRefresh(FOLDER_REPLACED_MS);
        if (filename && !filename.toString().endsWith(".md") && !gone) return;
        clearTimeout(state.pending.get(key));
        state.pending.set(key, setTimeout(() => { state.pending.delete(key); emitFolder(); }, 300));
      });
      watcher.on("error", (err) => {
        console.error("[thunk] repo notebook watcher", err);
        watcher.close();
        folders.delete(folder.id);
        scheduleFolderRefresh(FOLDER_REPLACED_MS);
      });
      folders.set(folder.id, { watcher, inode: info.ino, path: dirs.notesDir });
      emitFolder();
    } catch { /* Missing directories are retried while subscribed. */ }
  }
  for (const [id, entry] of folders) if (!wanted.has(id)) {
    entry.watcher.close(); folders.delete(id);
    clearTimeout(state.pending.get(`r:${id}`)); state.pending.delete(`r:${id}`);
    for (const listener of state.listeners) listener({ scope: { kind: "repos", id }, noteId: "*", kind: "removed" });
  }
}

/** Explicit changes from actions need not wait for the filesystem debounce. */
export function emitNote(event: NoteEvent) {
  for (const listener of state.listeners) listener(event);
}
