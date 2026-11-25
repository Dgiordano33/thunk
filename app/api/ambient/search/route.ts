import { listLiveSessions } from "@/lib/agent";
import type { SearchResult } from "@/lib/ambient/types";
import { handle, HttpError } from "@/lib/api/http";
import { projectNoteDirs } from "@/lib/notes/resolve";
import { listNotes } from "@/lib/notes/store";
import { scopeKey } from "@/lib/notes/types";
import { listProjects } from "@/lib/db/repo/projects";
import { listDocumentsForSessions } from "@/lib/db/repo/documents";
import { db } from "@/lib/db/server";
import { listTasks } from "@/lib/db/repo/tasks";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const query = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (query.length > 200) throw new HttpError(400, "Search is limited to 200 characters");
  if (!query) return Response.json({ results: [] });
  const results = new Map<string, SearchResult>();
  const term = query.toLowerCase();
  const client = db();
  const live = listLiveSessions().filter(s => s.meta.origin?.kind !== "board");
  if (client) {
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    type Origin = { kind?: string } | null;
    const [sessions, documents, messages] = await Promise.all([
      client.query<{ id: string; title: string | null; workspace_id: string; cwd: string; origin: Origin }>(
        "select id, title, workspace_id, cwd, origin from sessions where title ilike $1 order by updated_at desc limit 30", [pattern]),
      client.query<{ id: string; session_id: string; current_markdown: string; kind: string; workspace_id: string; origin: Origin }>(
        "select d.id, d.session_id, d.current_markdown, d.kind, s.workspace_id, s.origin from documents d join sessions s on s.id = d.session_id where d.current_markdown ilike $1 order by d.created_at desc limit 30", [pattern]),
      client.query<{ id: string; seq: number; session_id: string; markdown: string | null; workspace_id: string; origin: Origin }>(
        "select m.id, m.seq, m.session_id, m.markdown, s.workspace_id, s.origin from messages m join sessions s on s.id = m.session_id where m.type = 'user_message' and m.markdown ilike $1 order by m.created_at desc limit 30", [pattern]),
    ]);
    for (const s of sessions.filter(s => s.origin?.kind !== "board")) results.set(s.id, { id: s.id, label: s.title || "Untitled session", detail: s.cwd, href: `/w/${s.workspace_id}/s/${s.id}`, kind: "Session" });
    for (const d of documents) {
      if (d.origin?.kind === "board") continue;
      results.set(d.id, { id: d.id, label: `${d.kind} document`, detail: excerpt(d.current_markdown, term), href: `/w/${d.workspace_id}/s/${d.session_id}#doc-${d.id}`, kind: "Document" });
    }
    for (const m of messages) {
      if (m.origin?.kind === "board") continue;
      results.set(`${m.session_id}:${m.seq}`, { id: `${m.session_id}:${m.seq}`, label: "Session prompt", detail: excerpt(m.markdown ?? "", term), href: `/w/${m.workspace_id}/s/${m.session_id}`, kind: "Prompt" });
    }
  }
  for (const s of live) {
    const href = `/w/${s.meta.workspaceId}/s/${s.id}`;
    if (s.meta.title?.toLowerCase().includes(term)) results.set(s.id, { id: s.id, label: s.meta.title, detail: s.meta.cwd, href, kind: "Session" });
    for (const e of s.events) {
      if (e.type === "user_message" && e.content.toLowerCase().includes(term)) {
        const id = `${s.id}:${e.seq}`;
        results.set(id, { id, label: s.meta.title || "Session prompt", detail: excerpt(e.content, term), href, kind: "Prompt" });
      }
    }
  }
  if (!client) {
    for (const d of await listDocumentsForSessions(live.map((s) => s.id))) {
      if (!d.markdown.toLowerCase().includes(term)) continue;
      const s = live.find((s) => s.id === d.sessionId)!;
      results.set(d.id, { id: d.id, label: `${d.kind} document`, detail: excerpt(d.markdown, term), href: `/w/${s.meta.workspaceId}/s/${s.id}#doc-${d.id}`, kind: "Document" });
    }
  }
  for (const task of await listTasks()) {
    if (!task.title.toLowerCase().includes(term)) continue;
    const id = `task:${task.id}`;
    results.set(id, {
      id,
      label: task.title,
      detail: task.status.replaceAll("_", " "),
      href: task.workspaceId ? `/w/${task.workspaceId}?tab=tasks` : `/p/${task.projectId}?building=tasks`,
      kind: "Task",
    });
  }
  for (const r of await searchNotes(term)) results.set(r.id, r);
  return Response.json({ results: [...results.values()].slice(0, 60) });
});

type IndexedNote = { note: Awaited<ReturnType<typeof listNotes>>[number]; where: string };
let noteIndex: { expires: number; promise: Promise<IndexedNote[]> } | undefined;

async function searchNotes(term: string): Promise<SearchResult[]> {
  if (!noteIndex || Date.now() >= noteIndex.expires) {
    const entry = { expires: Date.now() + 2000, promise: loadNoteIndex() };
    noteIndex = entry;
    entry.promise.catch(() => { if (noteIndex === entry) noteIndex = undefined; });
  }
  const notes = await noteIndex.promise;
  return notes.filter(({ note: n }) => n.title.toLowerCase().includes(term) || n.markdown.toLowerCase().includes(term))
    .slice(0, 30).map(({ note: n, where }) => ({
      id: `note:${scopeKey(n.scope)}/${n.id}`, label: n.title,
      detail: `${where} · ${n.title.toLowerCase().includes(term) ? n.excerpt : excerpt(n.markdown, term)}`,
      href: `/notes?scope=${scopeKey(n.scope)}&note=${n.id}`, kind: "Note",
    }));
}

/** shortcut: snapshots may lag edits by two seconds; use a watcher index if this becomes noticeable. */
async function loadNoteIndex(): Promise<IndexedNote[]> {
  const projects = await listProjects().catch(() => []);
  const scopes = projects.map((p) => [
    { dirs: projectNoteDirs(p), where: p.name },
  ]);
  return (await Promise.all(scopes.flat().map(async ({ dirs, where }) =>
    (await listNotes(dirs).catch(() => [])).map((note) => ({ note, where })),
  ))).flat();
}

function excerpt(text: string, term: string) {
  const start = Math.max(0, text.toLowerCase().indexOf(term) - 50);
  return `${start ? "…" : ""}${text.slice(start, start + 180)}`;
}
