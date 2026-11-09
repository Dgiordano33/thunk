import "server-only";
import os from "node:os";
import path from "node:path";

/**
 * Thunk keeps project and workspace memory as files under one data dir so it
 * works the same with or without Supabase. Directories are keyed by stable
 * names (the project's data key, workspace slug), not database ids.
 */
export const DATA_DIR = (process.env.THUNK_DATA_DIR ?? path.join(os.homedir(), ".thunk")).replace(
  /^~(?=$|\/)/,
  os.homedir(),
);

/** Data key of a project opened from a directory. Mirrors Claude Code's ~/.claude/projects naming: the absolute path with separators replaced. */
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

export function projectDir(key: string) {
  return path.join(DATA_DIR, "projects", key);
}

/** Where sessions of a project with no repos run. Outside projects/, which the notes watcher recurses. */
export function projectHomeDir(key: string) {
  return path.join(DATA_DIR, "homes", key);
}

/** Project memory: a single MEMORY.md shared by every workspace and session in the project. */
export function projectMemoryDir(key: string) {
  return path.join(projectDir(key), "memory");
}

export function projectMemoryFile(key: string) {
  return path.join(projectMemoryDir(key), "MEMORY.md");
}

/** Workspace memory: the shared task log, explicitly maintained by sessions. */
export function workspaceMemoryDir(key: string, slug: string) {
  return path.join(projectDir(key), "workspaces", slug, "memory");
}

export function workspaceMemoryFile(key: string, slug: string) {
  return path.join(workspaceMemoryDir(key, slug), "MEMORY.md");
}

/** Where a workspace's git worktree lives: inside the repo, excluded from git. */
export function worktreePath(root: string, slug: string) {
  return path.join(root, ".claude", "worktrees", slug);
}

/** Project notes: one markdown file per note, shared by every workspace in the project. */
export function projectNotesDir(key: string) {
  return path.join(projectDir(key), "notes");
}

/** Workspace notes: sit beside the workspace's memory dir. */
export function workspaceNotesDir(key: string, slug: string) {
  return path.join(projectDir(key), "workspaces", slug, "notes");
}

/** Vault: one folder per uploaded item (original bytes + item.json), shared by every workspace in the project. */
export function projectVaultDir(key: string) {
  return path.join(projectDir(key), "vault");
}

export function projectGranaryDir(key: string) {
  return path.join(projectDir(key), "granary");
}

export function granaryEntryDir(key: string, slug: string, when: Date) {
  return path.join(projectGranaryDir(key), `${slug}-${when.toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`);
}
