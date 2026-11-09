import "server-only";
import { HttpError } from "@/lib/api/http";
import type { Project } from "@/lib/projects/types";
import { getProject, listProjects } from "@/lib/supabase/repo/projects";
import { vaultDirOf } from "./dir";
import { enqueue } from "./extract";
import { listItems, readItem, updateItem, type VaultDir } from "./store";
import { IDEA_LABELS, type VaultItem } from "./types";

export { vaultDirOf };

/** A project's vault, 404 when the project doesn't exist. */
export async function vaultFor(projectId: string): Promise<{ project: Project; vault: VaultDir }> {
  const project = await getProject(projectId);
  if (!project) throw new HttpError(404, "Project not found");
  return { project, vault: vaultDirOf(project) };
}

export async function requireItem(vault: VaultDir, id: string): Promise<VaultItem> {
  const item = await readItem(vault, id).catch(() => null);
  if (!item) throw new HttpError(404, "Vault item not found");
  return item;
}

/** Every project's items, newest first, with the project name for the world page. */
export async function listAllItems(): Promise<(VaultItem & { projectName: string })[]> {
  const projects = await listProjects().catch(() => []);
  const all = await Promise.all(projects.map(async (p) => (await listItems(vaultDirOf(p))).map((i) => ({ ...i, projectName: p.name }))));
  return all.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** How many items every project's vault holds, for the world menu. Counts folders; doesn't parse them. */
export async function countVaultItems(projects: Pick<Project, "id" | "dataKey">[]) {
  const { readdir } = await import("node:fs/promises");
  const counts = await Promise.all(
    projects.map((p) => readdir(vaultDirOf(p).dir).then((e) => e.filter((x) => /^[a-z0-9]{10}$/.test(x)).length, () => 0)),
  );
  return counts.reduce((a, b) => a + b, 0);
}

/** After a restart, pick up anything that was waiting or mid-extraction. */
export async function recoverVaultQueue() {
  const projects = await listProjects().catch(() => []);
  for (const p of projects) {
    const v = vaultDirOf(p);
    for (const item of await listItems(v)) if (item.status === "queued" || item.status === "processing") enqueue(v, item.id);
  }
}

/** Markdown body for a note or task made from an idea, pointing back at its source. */
export function ideaBody(item: VaultItem, ideaId: string) {
  const idea = item.ideas?.find((i) => i.id === ideaId);
  if (!idea) throw new HttpError(404, "Idea not found");
  const body = [
    idea.detail,
    "",
    `_${IDEA_LABELS[idea.kind]} from the Vault: **${item.title}** (\`${item.filename}\`, vault id \`${item.id}\`)._`,
  ].join("\n");
  return { idea, body: body.trim() };
}

export async function recordPromotion(vault: VaultDir, id: string, ideaId: string, patch: { noteId?: string; taskId?: string }) {
  return updateItem(vault, id, (cur) => {
    const promoted = [...(cur.promoted ?? [])];
    const i = promoted.findIndex((p) => p.ideaId === ideaId);
    if (i >= 0) promoted[i] = { ...promoted[i], ...patch };
    else promoted.push({ ideaId, ...patch });
    return { promoted };
  });
}
