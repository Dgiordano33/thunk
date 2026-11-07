import "server-only";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { git, tryGit } from "./git";

const exec = promisify(execFile);
// shortcut: snapshots retain files only; add index/history rewind if that becomes part of the review flow.
export type Checkpoint = { id: string; sessionId: string; messageId: string; label: string; createdAt: string; head: string };
async function temporaryIndex<T>(cwd: string, fn: (run: (args: string[]) => Promise<string>) => Promise<T>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "thunk-index-"));
  const run = async (args: string[]) => (await exec("git", args, {
    cwd, env: { ...process.env, GIT_INDEX_FILE: path.join(dir, "index") }, maxBuffer: 16 * 1024 * 1024,
  })).stdout.trim();
  try {
    const index = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
    await copyFile(index, path.join(dir, "index")).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
    return await fn(run);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function assertSupported(cwd: string) {
  if ((await git(cwd, ["ls-files", "-v", "-z"])).split("\0").some((file) => /^[a-zS] /.test(file))) {
    throw new Error("Checkpoints do not support sparse or assume-unchanged files");
  }
  if (await git(cwd, ["ls-files", "--unmerged"])) throw new Error("Resolve Git conflicts before using checkpoints");
  if ((await git(cwd, ["ls-files", "--stage"])).split("\n").some((line) => line.startsWith("160000 "))) {
    throw new Error("Checkpoints do not support repositories containing submodules");
  }
  for (const name of ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"]) {
    const file = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", name]);
    if (await stat(file).catch(() => null)) throw new Error("Finish the Git operation before using checkpoints");
  }
}

async function workingTree(cwd: string, run: (args: string[]) => Promise<string>) {
  await run(["add", "-A", "--", "."]);
  return run(["write-tree"]);
}

const prefix = (workspaceId: string) => {
  if (!/^[\w-]+$/.test(workspaceId)) throw new Error("Invalid workspace ID");
  return `refs/thunk/checkpoints/${workspaceId}/`;
};

/** Caller holds the workspace lock. Private refs keep snapshots alive without touching HEAD or the real index. */
export async function captureCheckpoint(cwd: string, workspaceId: string, sessionId: string, messageId: string, label: string) {
  await assertSupported(cwd);
  const head = await tryGit(cwd, ["rev-parse", "--verify", "HEAD"]) ?? "";
  const checkpoint: Checkpoint = { id: crypto.randomUUID(), sessionId, messageId, label: label.slice(0, 120), createdAt: new Date().toISOString(), head };
  await temporaryIndex(cwd, async (run) => {
    const tree = await workingTree(cwd, run);
    const commit = await run(["-c", "user.name=Thunk", "-c", "user.email=checkpoints@thunk.local", "commit-tree", tree, ...(head ? ["-p", head] : []), "-m", JSON.stringify(checkpoint)]);
    await git(cwd, ["update-ref", prefix(workspaceId) + checkpoint.id, commit]);
  });
  return checkpoint;
}

export async function listCheckpoints(cwd: string, workspaceId: string): Promise<Checkpoint[]> {
  const refs = await tryGit(cwd, ["for-each-ref", "--format=%(contents:subject)", prefix(workspaceId)]);
  return (refs ?? "").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Checkpoint)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Restore files only; the branch, commits, and user's staged index stay intact. */
export async function restoreCheckpoint(cwd: string, workspaceId: string, id: string) {
  const checkpoint = (await listCheckpoints(cwd, workspaceId)).find((c) => c.id === id);
  if (!checkpoint) throw new Error("Checkpoint not found");
  await assertSupported(cwd);
  if ((await tryGit(cwd, ["rev-parse", "--verify", "HEAD"]) ?? "") !== checkpoint.head) throw new Error("HEAD changed since this checkpoint. Restore the original commit first.");
  const targetRef = prefix(workspaceId) + id;
  const ignored = (await git(cwd, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"])).split("\0").filter(Boolean).map((file) => file.replace(/\/$/, ""));
  const targetFiles = (await git(cwd, ["ls-tree", "-rz", "--name-only", targetRef])).split("\0").filter(Boolean);
  if (ignored.some((file) => targetFiles.some((target) => file === target || file.startsWith(target + "/") || target.startsWith(file + "/")))) {
    throw new Error("An ignored file would be overwritten by this checkpoint. Move it aside first.");
  }
  const recovery = await captureCheckpoint(cwd, workspaceId, checkpoint.sessionId, "recovery", "Before rewind (recovery)");
  await temporaryIndex(cwd, async (run) => {
    const current = await workingTree(cwd, run);
    // The temporary index includes current untracked files, so checkout also removes files added since the snapshot.
    await run(["read-tree", "-m", "-u", current, prefix(workspaceId) + id]);
  });
  return recovery;
}
