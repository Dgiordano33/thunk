import { listSessions } from "@/lib/agent";
import { handle, HttpError } from "@/lib/api/http";
import type { Artifact } from "@/lib/documents/types";
import { getWorkspaceContext } from "@/lib/projects";
import { listDocumentsForSessions } from "@/lib/supabase/repo/documents";

export const dynamic = "force-dynamic";

function titleOf(markdown: string) {
  const line = markdown.split("\n").find((l) => l.trim()) ?? "";
  return line.replace(/^#+\s*/, "").replace(/[*_`]/g, "").trim().slice(0, 100) || "Untitled";
}

/** Documents produced across all sessions in the workspace: the latest version of each, newest first. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/workspaces/[id]/artifacts">) => {
  const { id } = await ctx.params;
  if (!(await getWorkspaceContext(id))) throw new HttpError(404, "Workspace not found");
  const sessions = await listSessions({ workspaceId: id, limit: 500 });
  const titles = new Map(sessions.map((s) => [s.id, s.title]));
  const rows = await listDocumentsForSessions(sessions.map((s) => s.id));
  const superseded = new Set(rows.map((r) => r.parentDocumentId).filter(Boolean));
  const artifacts: Artifact[] = rows
    .filter((r) => !superseded.has(r.id))
    .map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      sessionTitle: titles.get(r.sessionId) ?? null,
      kind: r.kind,
      version: r.version,
      status: r.status,
      title: titleOf(r.markdown),
      openComments: r.openComments,
      createdAt: r.createdAt,
    }));
  return Response.json({ artifacts });
});
