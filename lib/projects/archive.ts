import "server-only";
import { closeSession, listLiveSessions } from "@/lib/agent";
import { updateWorkspace } from "@/lib/supabase/repo/workspaces";
import { getWorkspaceContext } from "./index";
import { archiveWorkspaceProcesses, withWorkspaceLock } from "./runtime";

/** Close the workspace's sessions, run its archive hook and mark it archived. The worktree stays. */
export async function archiveWorkspace(id: string, { name }: { name?: string } = {}) {
  const ctx = await getWorkspaceContext(id);
  if (!ctx) throw new Error("Workspace not found");
  await withWorkspaceLock(id, async () => {
    if (ctx.workspace.status !== "archived") {
      for (const live of listLiveSessions()) if (live.meta.workspaceId === id) closeSession(live.id);
      await archiveWorkspaceProcesses(ctx);
    }
    await updateWorkspace(id, { status: "archived", ...(name ? { name } : {}) });
  });
}
