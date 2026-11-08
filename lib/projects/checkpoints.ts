import "server-only";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { git, tryGit } from "./git";
import { workspaceRepoTargets, type RepoTarget } from "./repo-targets";
import type { Project, Workspace } from "./types";

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
export async function captureCheckpoint(
  cwd: string, workspaceId: string, sessionId: string, messageId: string, label: string,
  shared: { id: string; createdAt: string } = { id: crypto.randomUUID(), createdAt: new Date().toISOString() },
) {
  await assertSupported(cwd);
  const head = await tryGit(cwd, ["rev-parse", "--verify", "HEAD"]) ?? "";
  const checkpoint: Checkpoint = { id: shared.id, sessionId, messageId, label: label.slice(0, 120), createdAt: shared.createdAt, head };
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

/** Throws unless `id` can be restored in `cwd` right now; returns the checkpoint. Changes nothing. */
async function checkRestorable(cwd: string, workspaceId: string, id: string) {
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
  return checkpoint;
}

async function applyCheckpoint(cwd: string, workspaceId: string, id: string) {
  await temporaryIndex(cwd, async (run) => {
    const current = await workingTree(cwd, run);
    // The temporary index includes current untracked files, so checkout also removes files added since the snapshot.
    await run(["read-tree", "-m", "-u", current, prefix(workspaceId) + id]);
  });
}

/** Restore files only; the branch, commits, and user's staged index stay intact. */
export async function restoreCheckpoint(cwd: string, workspaceId: string, id: string) {
  const checkpoint = await checkRestorable(cwd, workspaceId, id);
  const recovery = await captureCheckpoint(cwd, workspaceId, checkpoint.sessionId, "recovery", "Before rewind (recovery)");
  await applyCheckpoint(cwd, workspaceId, id);
  return recovery;
}

type Ctx = { project: Project; workspace: Workspace };
const where = (t: RepoTarget, err: unknown, many: boolean) => many ? new Error(`${t.name}: ${(err as Error).message}`) : err;

/**
 * Snapshot every repo in the workspace under one checkpoint id, so a rewind brings them back together.
 * The primary repo must succeed; an extra repo that can't be snapshotted is skipped and reported.
 * Caller holds the workspace lock.
 */
export async function captureWorkspaceCheckpoint(ctx: Ctx, sessionId: string, messageId: string, label: string) {
  const targets = workspaceRepoTargets(ctx);
  const shared = { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  const skipped: string[] = [];
  let first: Checkpoint | null = null;
  for (const [i, t] of targets.entries()) {
    try {
      const cp = await captureCheckpoint(t.cwd, ctx.workspace.id, sessionId, messageId, label, shared);
      first ??= cp;
    } catch (err) {
      if (i === 0) throw where(t, err, targets.length > 1);
      skipped.push(`${t.name} (${(err as Error).message})`);
    }
  }
  return { checkpoint: first, skipped };
}

/** Checkpoints of the workspace, as recorded in its first repo (every repo shares the ids). */
export async function listWorkspaceCheckpoints(ctx: Ctx): Promise<Checkpoint[]> {
  const [first] = workspaceRepoTargets(ctx);
  return first ? listCheckpoints(first.cwd, ctx.workspace.id) : [];
}

/**
 * Rewind every repo that has this checkpoint. All are checked before any files change; each gets a
 * recovery checkpoint (one shared id) first. Repos added after the checkpoint are left alone.
 */
export async function restoreWorkspaceCheckpoint(ctx: Ctx, id: string) {
  const all = workspaceRepoTargets(ctx);
  if (!all.length) throw new Error("Rewind requires a Git workspace");
  const many = all.length > 1;
  const targets: { t: RepoTarget; checkpoint: Checkpoint }[] = [];
  for (const [i, t] of all.entries()) {
    const has = (await listCheckpoints(t.cwd, ctx.workspace.id)).some((c) => c.id === id);
    if (!has && i > 0) continue;
    try { targets.push({ t, checkpoint: await checkRestorable(t.cwd, ctx.workspace.id, id) }); }
    catch (err) { throw where(t, err, many); }
  }
  const shared = { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  let recovery: Checkpoint | null = null;
  for (const { t, checkpoint } of targets) {
    const cp = await captureCheckpoint(t.cwd, ctx.workspace.id, checkpoint.sessionId, "recovery", "Before rewind (recovery)", shared);
    recovery ??= cp;
  }
  for (const { t } of targets) {
    try { await applyCheckpoint(t.cwd, ctx.workspace.id, id); }
    catch (err) { throw where(t, err, many); }
  }
  return recovery!;
}
