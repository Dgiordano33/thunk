import "server-only";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "@/lib/api/errors";
import { readLifecycleConfig } from "@/lib/projects/lifecycle-config";
import type { Project, RepoFolder } from "@/lib/projects/types";
import { insertRepoFolder } from "@/lib/supabase/repo/repo-folders";

export function validateFolderPath(value: string) {
  if (path.isAbsolute(value) || value.includes("\\") || value.includes("\0") || value.split("/").some((p) => !p || p === "." || p === ".." || p === ".git"))
    throw new HttpError(400, "Use a relative folder path without empty, dot, or .git segments");
  return value;
}

export async function resolveRepoFolder(project: Project, folder: Pick<RepoFolder, "repoId" | "path">) {
  validateFolderPath(folder.path);
  const root = folder.repoId === null ? project.root : project.extraRepos.find((r) => r.id === folder.repoId)?.path;
  if (!root) throw new HttpError(404, "Repo not found");
  const checkoutRoot = await realpath(root);
  const notesDir = await realpath(path.join(checkoutRoot, folder.path)).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") throw new HttpError(404, "Notebook folder must exist before registering it");
    throw err;
  });
  if (!notesDir.startsWith(checkoutRoot + path.sep) || !(await stat(notesDir)).isDirectory()) throw new HttpError(400, "Notebook must be a directory inside the checkout");
  // Keep the registered path so later symlink changes are revalidated by the store.
  return { checkoutRoot, notesDir: path.join(checkoutRoot, folder.path) };
}

/**
 * Register notebooks a checkout declares in thunk.json. This reads a file per checkout and may insert rows,
 * so it runs only at project load, folder registration, and the watcher's tick; project getters stay pure.
 */
export async function reconcileDeclaredFolders<T extends Project>(project: T): Promise<T> {
  const folders = [...project.repoFolders];
  let added = false;
  for (const repo of [{ id: null, path: project.root }, ...project.extraRepos]) {
    const config = await readLifecycleConfig(repo.path).catch((err) => { console.error("[thunk] notebook config", err); return null; });
    for (const folderPath of config?.notebooks ?? []) {
      if (folders.some((f) => f.repoId === repo.id && f.path === folderPath)) continue;
      try {
        await resolveRepoFolder(project, { repoId: repo.id, path: folderPath });
        folders.push(await insertRepoFolder({ projectId: project.id, repoId: repo.id, path: folderPath, label: folderPath }));
        added = true;
      } catch (err) { console.error("[thunk] register declared notebook", err); }
    }
  }
  return added ? { ...project, repoFolders: folders } : project;
}

export async function suggestRepoFolders(project: Project) {
  const candidates = [];
  for (const repo of [{ id: null, name: project.name, path: project.root }, ...project.extraRepos]) {
    for (const folderPath of [".claude/plans", ".claude/tasks", "docs", "plans"]) {
      if (project.repoFolders.some((f) => f.repoId === repo.id && f.path === folderPath)) continue;
      try {
        const { notesDir } = await resolveRepoFolder(project, { repoId: repo.id, path: folderPath });
        const count = (await readdir(notesDir, { withFileTypes: true })).filter((f) => f.isFile() && /^[a-z0-9][a-z0-9_-]{0,63}\.md$/i.test(f.name) && f.name !== "memory.md").length;
        if (count) candidates.push({ repoId: repo.id, repoName: repo.name, path: folderPath, count });
      } catch { /* Missing or unsafe folders are not suggestions. */ }
    }
  }
  return candidates;
}
