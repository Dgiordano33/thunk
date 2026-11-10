import { notFound, redirect } from "next/navigation";
import { listSessions } from "@/lib/agent";
import { getWorkspaceContextBySlugs } from "@/lib/projects";
import { newChatPath, sessionPath } from "@/lib/routes";

export const dynamic = "force-dynamic";

// Opening a workspace lands on its most recent session, or the new-session tab when it has none.
export default async function WorkspaceIndex({ params, searchParams }: PageProps<"/[project]/[workspace]">) {
  const { project, workspace } = await params;
  const ctx = await getWorkspaceContextBySlugs(project, workspace);
  if (!ctx) notFound();
  // Carry the right-panel tab through, e.g. a link straight to the workspace's tasks or files.
  const { tab } = await searchParams;
  const suffix = typeof tab === "string" && /^[a-z]+$/.test(tab) ? `?tab=${tab}` : "";
  const [latest] = await listSessions({ workspaceId: ctx.workspace.id, limit: 1 });
  redirect((latest ? sessionPath(ctx.project, ctx.workspace, latest.id) : newChatPath(ctx.project, ctx.workspace)) + suffix);
}
