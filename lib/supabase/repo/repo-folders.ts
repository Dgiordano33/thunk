import "server-only";
import type { RepoFolder } from "@/lib/projects/types";
import { db } from "../server";

const g = globalThis as typeof globalThis & { __thunkRepoFolders?: Map<string, RepoFolder> };
const mem = (g.__thunkRepoFolders ??= new Map());
type Row = { id: string; project_id: string; repo_id: string | null; path: string; label: string };
const columns = "id, project_id, repo_id, path, label";
const fromRow = (r: Row): RepoFolder => ({ id: r.id, projectId: r.project_id, repoId: r.repo_id, path: r.path, label: r.label });

export async function listRepoFolders(projectId: string): Promise<RepoFolder[]> {
  const client = db();
  if (!client) return [...mem.values()].filter((f) => f.projectId === projectId);
  const { data, error } = await client.from("project_repo_folders").select(columns).eq("project_id", projectId).order("created_at");
  if (error) throw error;
  return data.map(fromRow);
}

export async function insertRepoFolder(input: Omit<RepoFolder, "id">): Promise<RepoFolder> {
  const client = db();
  if (!client) {
    const existing = [...mem.values()].find((f) => f.projectId === input.projectId && f.repoId === input.repoId && f.path === input.path);
    if (existing) return existing;
    const folder = { ...input, id: crypto.randomUUID() };
    mem.set(folder.id, folder);
    return folder;
  }
  const existing = (await listRepoFolders(input.projectId)).find((f) => f.repoId === input.repoId && f.path === input.path);
  if (existing) return existing;
  const { data, error } = await client.from("project_repo_folders").insert({ project_id: input.projectId, repo_id: input.repoId, path: input.path, label: input.label }).select(columns).single();
  if (error?.code === "23505") {
    const folder = (await listRepoFolders(input.projectId)).find((f) => f.repoId === input.repoId && f.path === input.path);
    if (folder) return folder;
  }
  if (error) throw error;
  return fromRow(data!);
}

export async function deleteRepoFolder(projectId: string, id: string) {
  const client = db();
  if (!client) { if (mem.get(id)?.projectId === projectId) mem.delete(id); return; }
  const { error } = await client.from("project_repo_folders").delete().eq("project_id", projectId).eq("id", id);
  if (error) throw error;
}

export function forgetRepoFolders(projectId: string, repoId?: string) {
  for (const [id, folder] of mem) if (folder.projectId === projectId && (repoId === undefined || folder.repoId === repoId)) mem.delete(id);
}
