import "server-only";
import path from "node:path";
import { db } from "../server";

export type WorkspaceRow = { id: string; name: string; cwd: string; updatedAt: string };

export async function upsertWorkspace(cwd: string): Promise<string | null> {
  const client = db();
  if (!client) return null;
  const { data, error } = await client
    .from("workspaces")
    .upsert({ cwd, name: path.basename(cwd) || cwd, updated_at: new Date().toISOString() }, { onConflict: "cwd" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function listWorkspaces(limit = 20): Promise<WorkspaceRow[]> {
  const client = db();
  if (!client) return [];
  const { data, error } = await client
    .from("workspaces")
    .select("id, name, cwd, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((w) => ({ id: w.id, name: w.name, cwd: w.cwd, updatedAt: w.updated_at }));
}
