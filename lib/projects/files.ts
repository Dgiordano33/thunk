import "server-only";
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "@/lib/api/errors";
import { tryGit } from "./git";
import { cleanRelativePath, isWithin } from "./file-paths";
import type { WorkspaceContext } from "./index";
import { anchorTarget } from "./repo-targets";
import type { FileContent, FileEntry, FileRoot } from "./types";

/** Files above this size open as "too large" instead of in the editor. */
const MAX_EDIT_BYTES = 2 * 1024 * 1024;
/** Directories with more entries than this skip the gitignore check (one git call per listing). */
const MAX_IGNORE_CHECK = 2000;

/** The directories the file browser shows: each repo or folder of the workspace, or its cwd when it has none. */
export function fileRoots({ project, workspace }: WorkspaceContext): FileRoot[] {
  const anchor = anchorTarget({ project, workspace });
  if (!workspace.repos.length) return [{ id: "workspace", name: workspace.name, cwd: workspace.cwd, git: false, anchor: false }];
  return workspace.repos.map((r) => ({
    id: r.repoId,
    name: r.name,
    cwd: r.cwd,
    git: project.repos.find((p) => p.id === r.repoId)?.kind === "repo",
    anchor: r.repoId === anchor?.id,
  }));
}

export function findRoot(ctx: WorkspaceContext, id: string | null): FileRoot {
  const roots = fileRoots(ctx);
  const root = id ? roots.find((r) => r.id === id) : roots[0];
  if (!root) throw new HttpError(404, "Root not in this workspace");
  return root;
}

/** Resolve a relative path inside `root`, following symlinks, and refuse anything that lands outside it. */
async function resolveInside(root: FileRoot, rel: string) {
  const clean = cleanRelativePath(rel);
  if (clean === null) throw new HttpError(400, "Invalid path");
  const base = await realpath(root.cwd).catch(() => {
    throw new HttpError(404, "Workspace directory is missing");
  });
  const abs = await realpath(path.join(base, clean)).catch(() => {
    throw new HttpError(404, "File not found");
  });
  if (!isWithin(base, abs)) throw new HttpError(403, "Path is outside the workspace");
  return { clean, abs };
}

/** One directory level, folders first, with gitignored entries flagged (they're shown dimmed, not hidden). */
export async function listDirectory(root: FileRoot, rel: string): Promise<FileEntry[]> {
  const { clean, abs } = await resolveInside(root, rel);
  const dirents = await readdir(abs, { withFileTypes: true }).catch(() => {
    throw new HttpError(404, "Not a directory");
  });
  const entries: FileEntry[] = await Promise.all(
    dirents
      .filter((d) => d.name !== ".git" && d.name !== ".DS_Store")
      .map(async (d) => {
        // Symlinks are listed as what they point to; reads still refuse targets outside the root.
        const dir = d.isDirectory() || (d.isSymbolicLink() && (await stat(path.join(abs, d.name)).catch(() => null))?.isDirectory());
        return { name: d.name, path: clean ? `${clean}/${d.name}` : d.name, kind: dir ? "dir" : "file", ignored: false } as FileEntry;
      }),
  );

  if (root.git && entries.length && entries.length <= MAX_IGNORE_CHECK) {
    const args = entries.map((e) => (e.kind === "dir" ? `${e.path}/` : e.path));
    // Exits 1 (null) when nothing is ignored.
    const out = await tryGit(root.cwd, ["check-ignore", "--", ...args]);
    const ignored = new Set((out ?? "").split("\n").map((l) => l.replace(/\/$/, "")).filter(Boolean));
    for (const e of entries) e.ignored = ignored.has(e.path);
  }

  return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
}

const versionOf = (buf: Buffer | string) => createHash("sha1").update(buf).digest("hex");

export async function readWorkspaceFile(root: FileRoot, rel: string): Promise<FileContent> {
  const { abs } = await resolveInside(root, rel);
  const s = await stat(abs);
  if (!s.isFile()) throw new HttpError(400, "Not a file");
  if (s.size > MAX_EDIT_BYTES) return { kind: "too-large", size: s.size, version: `${s.size}:${s.mtimeMs}` };
  const buf = await readFile(abs);
  if (buf.subarray(0, 8000).includes(0)) return { kind: "binary", size: s.size, version: versionOf(buf) };
  return { kind: "text", content: buf.toString("utf8"), version: versionOf(buf) };
}

/** The current version only, for cheap polling. */
export async function fileVersion(root: FileRoot, rel: string) {
  const file = await readWorkspaceFile(root, rel);
  return file.version;
}

/**
 * Overwrite an existing text file. `baseVersion` is the version the editor loaded; when the file changed
 * on disk since (an agent edited it), nothing is written and the current content comes back instead.
 * Pass `force` to overwrite anyway.
 */
export async function writeWorkspaceFile(root: FileRoot, rel: string, content: string, baseVersion: string, force: boolean) {
  const current = await readWorkspaceFile(root, rel);
  if (current.kind !== "text") throw new HttpError(400, "Only text files can be edited");
  if (!force && current.version !== baseVersion) return { conflict: true as const, ...current };
  if (Buffer.byteLength(content) > MAX_EDIT_BYTES) throw new HttpError(413, "File is too large to save");
  const { abs } = await resolveInside(root, rel);
  await writeFile(abs, content, "utf8");
  return { conflict: false as const, version: versionOf(content) };
}
