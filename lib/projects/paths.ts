import "server-only";
import os from "node:os";
import path from "node:path";

/**
 * Thunk keeps project and workspace memory as files under one data dir so it
 * works the same with or without Supabase. Directories are keyed by stable
 * slugs (project root path, workspace slug), not database ids.
 */
export const DATA_DIR = (process.env.THUNK_DATA_DIR ?? path.join(os.homedir(), ".thunk")).replace(
  /^~(?=$|\/)/,
  os.homedir(),
);

/** Mirrors Claude Code's ~/.claude/projects naming: the absolute path with separators replaced. */
export function projectSlug(root: string) {
  return root.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace"
  );
}

export function projectDir(root: string) {
  return path.join(DATA_DIR, "projects", projectSlug(root));
}

/** Project memory: a single MEMORY.md shared by every workspace and session in the project. */
export function projectMemoryDir(root: string) {
  return path.join(projectDir(root), "memory");
}

export function projectMemoryFile(root: string) {
  return path.join(projectMemoryDir(root), "MEMORY.md");
}

/** Workspace memory: Claude Code's auto-memory directory, pointed here so all sessions in the workspace share it. */
export function workspaceMemoryDir(root: string, slug: string) {
  return path.join(projectDir(root), "workspaces", slug, "memory");
}

export function workspaceMemoryFile(root: string, slug: string) {
  return path.join(workspaceMemoryDir(root, slug), "MEMORY.md");
}

/** Where a workspace's git worktree lives: inside the repo, excluded from git. */
export function worktreePath(root: string, slug: string) {
  return path.join(root, ".claude", "worktrees", slug);
}

/** Project notes: one markdown file per note, shared by every workspace in the project. */
export function projectNotesDir(root: string) {
  return path.join(projectDir(root), "notes");
}

/** Workspace notes: sit beside the workspace's memory dir. */
export function workspaceNotesDir(root: string, slug: string) {
  return path.join(projectDir(root), "workspaces", slug, "notes");
}

/** Vault: one folder per uploaded item (original bytes + item.json), shared by every workspace in the project. */
export function projectVaultDir(root: string) {
  return path.join(projectDir(root), "vault");
}
