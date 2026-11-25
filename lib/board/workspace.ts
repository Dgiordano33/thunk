import "server-only";
import { listLiveSessions } from "@/lib/agent";
import { withFileLock } from "@/lib/notes/file-write";
import { fastForwardCheckouts, restoreCheckouts } from "@/lib/projects/checkouts";
import { prepareWorkspace } from "@/lib/projects/runtime";
import { createWorkspace } from "@/lib/projects";
import { getWorkspace } from "@/lib/db/repo/workspaces";
import type { Board } from "./types";
import { boardFor } from "./service";
import { lock, readBoard, saveBoard } from "./store";

const BUSY = ["starting", "running", "awaiting"];

/** Update board.json under the board lock, which is held only for the write. */
const patchBoard = (dir: string, patch: Partial<Board>) =>
  lock(dir, async () => { const board = await readBoard(dir); Object.assign(board, patch); await saveBoard(dir, board); });

/**
 * One persisted checkout per canvas, shared by every agent and source command. A missing or archived
 * workspace is replaced, a released one is restored, and an untouched one is brought up to its base
 * while no agent is working in it. Setup runs outside the board lock, so the canvas stays editable meanwhile.
 */
export async function ensureBoardWorkspace(projectId: string, boardId = "main") {
  const { project, dir } = await boardFor(projectId, boardId);
  return withFileLock(`board-workspace:${dir}`, async () => {
    const board = await readBoard(dir);
    let workspace = board.workspaceId ? await getWorkspace(board.workspaceId) : null;
    if (!workspace || workspace.projectId !== projectId || workspace.status === "archived") {
      workspace = await createWorkspace({ projectId, visibility: "project", setup: "skip" });
      await patchBoard(dir, { workspaceId: workspace.id, workspaceReady: false });
      board.workspaceReady = false;
    }
    const ctx = { project, workspace };
    if (!board.workspaceReady) {
      await prepareWorkspace(ctx);
      await patchBoard(dir, { workspaceReady: true });
    } else if (!(await restoreCheckouts(ctx)) && !listLiveSessions().some((s) => s.meta.workspaceId === workspace.id && BUSY.includes(s.meta.status))) {
      await fastForwardCheckouts(ctx);
    }
    return workspace;
  });
}
