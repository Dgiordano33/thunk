import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { WorkspaceTabs } from "@/components/workspace/workspace-tabs";
import { listSessions } from "@/lib/agent";
import { getWorkspaceContextBySlugs } from "@/lib/projects";
import { workspacePath } from "@/lib/routes";
import { workspaceRepoTargets } from "@/lib/projects/repo-targets";
import { worktreeStatus } from "@/lib/projects/git";

export const dynamic = "force-dynamic";

// A workspace: session tabs over the open session (or new-session page), with the workspace panel alongside.
export default async function WorkspaceLayout({ params, children }: LayoutProps<"/[project]/[workspace]">) {
  const { project, workspace } = await params;
  const ctx = await getWorkspaceContextBySlugs(project, workspace);
  if (!ctx) notFound();
  const id = ctx.workspace.id;
  const base = workspacePath(ctx.project, ctx.workspace);
  // Stream Git decoration independently: slow repositories must not block the chat.
  const gitStatus = Promise.all(ctx.workspace.repos.map((r) => worktreeStatus(r.cwd))).then(statuses => ({
    dirty: statuses.reduce((n, status) => n + (status?.dirty ?? 0), 0),
    branch: statuses[ctx.workspace.repos.findIndex((r) => r.cwd === ctx.workspace.cwd)]?.branch ?? ctx.workspace.branch,
  })).catch(() => ({ dirty: 0, branch: ctx.workspace.branch }));
  const sessions = await listSessions({ workspaceId: id, limit: 50 });

  const ordered = [...sessions].reverse();
  return (
    <WorkspaceShell
      hasGit={workspaceRepoTargets(ctx).length > 0}
      workspaceId={id}
      projectId={ctx.project.id}
      base={base}
      sessions={ordered}
      tabs={
        <WorkspaceTabs
          workspace={ctx.workspace}
          base={base}
          sessions={ordered}
          gitStatus={gitStatus}
        />
      }
    >
      {children}
    </WorkspaceShell>
  );
}
