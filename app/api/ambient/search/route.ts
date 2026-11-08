import { listLiveSessions } from "@/lib/agent";
import type { SearchResult } from "@/lib/ambient/types";
import { handle, HttpError } from "@/lib/api/http";
import { projectNoteDirs, workspaceNoteDirs } from "@/lib/notes/resolve";
import { listNotes } from "@/lib/notes/store";
import { scopeKey } from "@/lib/notes/types";
import { listProjects } from "@/lib/supabase/repo/projects";
import { listAllWorkspaces } from "@/lib/supabase/repo/workspaces";
import { listDocumentsForSessions } from "@/lib/supabase/repo/documents";
import { db } from "@/lib/supabase/server";
import { listTasks } from "@/lib/supabase/repo/tasks";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const query = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (query.length > 200) throw new HttpError(400, "Search is limited to 200 characters");
  if (!query) return Response.json({ results: [] });
  const results = new Map<string, SearchResult>();
  const term = query.toLowerCase();
  const client = db();
  const live = listLiveSessions();
  if (client) {
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const [sessions, documents, messages] = await Promise.all([
      client.from("sessions").select("id, title, workspace_id, cwd").ilike("title", pattern).order("updated_at", { ascending: false }).limit(30),
      client.from("documents").select("id, session_id, current_markdown, kind, sessions(workspace_id)").ilike("current_markdown", pattern).order("created_at", { ascending: false }).limit(30),
      client.from("messages").select("id, seq, session_id, markdown, sessions(workspace_id)").eq("type", "user_message").ilike("markdown", pattern).order("created_at", { ascending: false }).limit(30),
    ]);
    for (const response of [sessions, documents, messages]) if (response.error) throw response.error;
    for (const s of sessions.data ?? []) results.set(s.id, { id: s.id, label: s.title || "Untitled session", detail: s.cwd, href: `/w/${s.workspace_id}/s/${s.id}`, kind: "Session" });
    for (const d of documents.data ?? []) {
      if (!d.sessions) continue;
      results.set(d.id, { id: d.id, label: `${d.kind} document`, detail: excerpt(d.current_markdown, term), href: `/w/${d.sessions.workspace_id}/s/${d.session_id}#doc-${d.id}`, kind: "Document" });
    }
    for (const m of messages.data ?? []) {
      if (!m.sessions) continue;
      results.set(`${m.session_id}:${m.seq}`, { id: `${m.session_id}:${m.seq}`, label: "Session prompt", detail: excerpt(m.markdown ?? "", term), href: `/w/${m.sessions.workspace_id}/s/${m.session_id}`, kind: "Prompt" });
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

/** Note titles and bodies across every project and active workspace. */
async function searchNotes(term: string): Promise<SearchResult[]> {
  const [projects, workspaces] = await Promise.all([listProjects().catch(() => []), listAllWorkspaces().catch(() => [])]);
  const scopes = projects.map((p) => [
    { dirs: projectNoteDirs(p), where: p.name },
    ...workspaces
      .filter((w) => w.projectId === p.id && w.status === "active")
      .map((w) => ({ dirs: workspaceNoteDirs(p, w), where: `${p.name} / ${w.slug === "main" ? "Local" : w.name}` })),
  ]);
  const hits = await Promise.all(
    scopes.flat().map(async ({ dirs, where }) =>
      (await listNotes(dirs).catch(() => []))
        .filter((n) => n.title.toLowerCase().includes(term) || n.markdown.toLowerCase().includes(term))
        .map((n) => ({
          id: `note:${scopeKey(n.scope)}/${n.id}`,
          label: n.title,
          detail: `${where} · ${n.title.toLowerCase().includes(term) ? n.excerpt : excerpt(n.markdown, term)}`,
          href: `/notes?scope=${scopeKey(n.scope)}&note=${n.id}`,
          kind: "Note",
        })),
    ),
  );
  return hits.flat().slice(0, 30);
}

function excerpt(text: string, term: string) {
  const start = Math.max(0, text.toLowerCase().indexOf(term) - 50);
  return `${start ? "…" : ""}${text.slice(start, start + 180)}`;
}
