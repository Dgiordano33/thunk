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
  const suffix = (await searchParams).tab === "tasks" ? "?tab=tasks" : "";
  const [latest] = await listSessions({ workspaceId: ctx.workspace.id, limit: 1 });
  redirect((latest ? sessionPath(ctx.project, ctx.workspace, latest.id) : newChatPath(ctx.project, ctx.workspace)) + suffix);
}
