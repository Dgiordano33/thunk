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
  const [sessions, git, ...extras] = await Promise.all([
    listSessions({ workspaceId: id, limit: 50 }),
    worktreeStatus(ctx.workspace.cwd),
    // Uncommitted files across a multi-repo workspace's other repos count too.
    ...ctx.workspace.extraRepos.map((r) => worktreeStatus(r.cwd)),
  ]);
  const dirty = (git?.dirty ?? 0) + extras.reduce((n, s) => n + (s?.dirty ?? 0), 0);

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
