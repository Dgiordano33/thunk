import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { WorkspaceTabs } from "@/components/workspace/workspace-tabs";
import { listSessions } from "@/lib/agent";
import { getWorkspaceContext } from "@/lib/projects";
import { worktreeStatus } from "@/lib/projects/git";

export const dynamic = "force-dynamic";

// A workspace: session tabs over the open session (or new-session page), with the workspace panel alongside.
export default async function WorkspaceLayout({ params, children }: LayoutProps<"/w/[id]">) {
  const { id } = await params;
  const ctx = await getWorkspaceContext(id);
  if (!ctx) notFound();
  const [sessions, statuses] = await Promise.all([
    listSessions({ workspaceId: id, limit: 50 }),
    // Uncommitted files count across every repo of the workspace.
    Promise.all(ctx.workspace.repos.map((r) => worktreeStatus(r.cwd))),
  ]);
  const dirty = statuses.reduce((n, s) => n + (s?.dirty ?? 0), 0);
  const git = statuses[ctx.workspace.repos.findIndex((r) => r.cwd === ctx.workspace.cwd)] ?? null;

  const ordered = [...sessions].reverse();
  return (
    <WorkspaceShell
      workspaceId={id}
      projectId={ctx.project.id}
      sessions={ordered}
      tabs={
        <WorkspaceTabs
          workspace={ctx.workspace}
          sessions={ordered}
          branch={git?.branch ?? null}
          dirty={dirty}
        />
      }
    >
      {children}
    </WorkspaceShell>
  );
}
