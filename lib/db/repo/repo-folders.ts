import "server-only";
import type { RepoFolder } from "@/lib/projects/types";
import { db } from "../server";
import { insertSql, run, updateSql } from "../sql";

const g = globalThis as typeof globalThis & { __thunkRepoFolders?: Map<string, RepoFolder> };
const mem = (g.__thunkRepoFolders ??= new Map());
type Row = { id: string; project_id: string; repo_id: string; path: string; label: string; files: string[] | null };
const columns = "id, project_id, repo_id, path, label, files";
const fromRow = (r: Row): RepoFolder => ({ id: r.id, projectId: r.project_id, repoId: r.repo_id, path: r.path, label: r.label, files: r.files ?? null });

export async function listRepoFolders(projectId: string): Promise<RepoFolder[]> {
  const client = db();
  if (!client) return [...mem.values()].filter((f) => f.projectId === projectId);
  return (await client.query<Row>(`select ${columns} from project_repo_folders where project_id = $1 order by created_at`, [projectId])).map(fromRow);
}

/** One folder by id, for repo-scope lookups that should not scan every project. */
export async function getRepoFolder(id: string): Promise<RepoFolder | null> {
  const client = db();
  if (!client) return mem.get(id) ?? null;
  const [row] = await client.query<Row>(`select ${columns} from project_repo_folders where id = $1`, [id]);
  return row ? fromRow(row) : null;
}

/** Every project's folders in one query, grouped by project id. */
export async function listAllRepoFolders(): Promise<Map<string, RepoFolder[]>> {
  const client = db();
  let folders: RepoFolder[];
  if (!client) folders = [...mem.values()];
  else {
    folders = (await client.query<Row>(`select ${columns} from project_repo_folders order by created_at`)).map(fromRow);
  }
  const byProject = new Map<string, RepoFolder[]>();
  for (const f of folders) byProject.set(f.projectId, [...byProject.get(f.projectId) ?? [], f]);
  return byProject;
}

export async function insertRepoFolder(input: Omit<RepoFolder, "id" | "files"> & { files?: string[] | null }): Promise<RepoFolder> {
  const client = db();
  if (!client) {
    const existing = [...mem.values()].find((f) => f.projectId === input.projectId && f.repoId === input.repoId && f.path === input.path);
    if (existing) return existing;
    const folder = { ...input, files: input.files ?? null, id: crypto.randomUUID() };
    mem.set(folder.id, folder);
    return folder;
  }
  const existing = (await listRepoFolders(input.projectId)).find((f) => f.repoId === input.repoId && f.path === input.path);
  if (existing) return existing;
  try {
    const [row] = await run<Row>(client, insertSql("project_repo_folders", { project_id: input.projectId, repo_id: input.repoId, path: input.path, label: input.label, files: input.files ?? null }, { returning: columns }));
    return fromRow(row);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      const folder = (await listRepoFolders(input.projectId)).find((f) => f.repoId === input.repoId && f.path === input.path);
      if (folder) return folder;
    }
    throw error;
  }
}

/** Narrow a notebook to some files, or pass null to show the whole folder. */
export async function setRepoFolderFiles(projectId: string, id: string, files: string[] | null): Promise<RepoFolder | null> {
  const client = db();
  if (!client) {
    const folder = mem.get(id);
    if (folder?.projectId !== projectId) return null;
    const next = { ...folder, files };
    mem.set(id, next);
    return next;
  }
  const [row] = await run<Row>(client, updateSql("project_repo_folders", { files }, "project_id = $1 and id = $2", [projectId, id], columns)!);
  return row ? fromRow(row) : null;
}

export async function deleteRepoFolder(projectId: string, id: string) {
  const client = db();
  if (!client) { if (mem.get(id)?.projectId === projectId) mem.delete(id); return; }
  await client.query("delete from project_repo_folders where project_id = $1 and id = $2", [projectId, id]);
}

export function forgetRepoFolders(projectId: string, repoId?: string) {
  for (const [id, folder] of mem) if (folder.projectId === projectId && (repoId === undefined || folder.repoId === repoId)) mem.delete(id);
}
