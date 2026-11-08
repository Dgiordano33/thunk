import "server-only";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { readOptional } from "../notes/file-write";
import { granaryEntryDir, projectGranaryDir, workspaceMemoryDir } from "./paths";

export function headerOnly(memory: string) {
  return !memory.trim() || /^# [^\n]+$/.test(memory.trim());
}

const entries = (dir: string) => readdir(dir).catch((err: NodeJS.ErrnoException) => {
  if (err.code === "ENOENT") return [];
  throw err;
});

/** Preserve unknown files and auto-memory topic files, even if MEMORY.md is empty. */
export async function moveToGranary(root: string, slug: string) {
  const source = path.dirname(workspaceMemoryDir(root, slug));
  const files = await entries(source);
  if (!files.length) return null;
  const memory = await readOptional(path.join(source, "memory", "MEMORY.md"));
  const trivial = files.every(f => f === "memory" || f === "notes")
    && (await entries(path.join(source, "memory"))).every(f => f === "MEMORY.md")
    && !(await entries(path.join(source, "notes"))).length && headerOnly(memory ?? "");
  if (trivial) {
    await rm(source, { recursive: true });
    return null;
  }
  await mkdir(projectGranaryDir(root), { recursive: true });
  const destination = granaryEntryDir(root, slug, new Date());
  await rename(source, destination);
  return destination;
}
