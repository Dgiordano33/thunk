import "server-only";
import { customAlphabet } from "nanoid";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { classify, extOf, type VaultItem } from "./types";

/** One project's vault on disk: `<dir>/<itemId>/{item.json, original.<ext>}`. */
export type VaultDir = { projectId: string; dir: string };

export const newVaultId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);
const ID = /^[a-z0-9]{10}$/;
export const isVaultId = (id: string) => ID.test(id);

function itemDir(v: VaultDir, id: string) {
  if (!ID.test(id)) throw new Error("Invalid vault item id");
  return path.join(v.dir, id);
}

async function atomicWrite(file: string, content: string | Buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, file);
}

/** The original's file name on disk: `original.<ext>` keeps the extension so agents (and `file`) know what it is. */
function originalName(filename: string) {
  const ext = extOf(filename);
  return ext ? `original.${ext}` : "original";
}

export function originalPath(v: VaultDir, item: Pick<VaultItem, "id" | "filename">) {
  return path.join(itemDir(v, item.id), originalName(item.filename));
}

const titleFrom = (filename: string) => filename.replace(/\.[a-z0-9]{1,10}$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled";

export async function createItem(v: VaultDir, file: { filename: string; mime: string; bytes: Buffer; title?: string }): Promise<VaultItem> {
  const id = newVaultId();
  const now = new Date().toISOString();
  // Strip any directory parts a client might send.
  const filename = path.basename(file.filename).slice(0, 200) || "upload";
  const { kind, mime } = classify(filename, file.mime);
  const item: VaultItem = {
    id,
    projectId: v.projectId,
    title: file.title?.trim().slice(0, 200) || titleFrom(filename),
    ...(file.title?.trim() ? { titled: true } : {}),
    filename,
    mime,
    size: file.bytes.length,
    kind,
    createdAt: now,
    updatedAt: now,
    status: "queued",
  };
  await atomicWrite(originalPath(v, item), file.bytes);
  await atomicWrite(path.join(itemDir(v, id), "item.json"), JSON.stringify(item, null, 2));
  return withPath(v, item);
}

function withPath(v: VaultDir, item: VaultItem): VaultItem {
  return { ...item, path: originalPath(v, item) };
}

export async function readItem(v: VaultDir, id: string): Promise<VaultItem | null> {
  const raw = await readFile(path.join(itemDir(v, id), "item.json"), "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    const item = JSON.parse(raw) as VaultItem;
    return withPath(v, { ...item, id, projectId: v.projectId });
  } catch {
    return null;
  }
}

/** Newest first. Unreadable items are skipped. */
export async function listItems(v: VaultDir): Promise<VaultItem[]> {
  const entries = await readdir(v.dir).catch(() => [] as string[]);
  const items = await Promise.all(entries.filter((e) => ID.test(e)).map((id) => readItem(v, id)));
  return items.filter((i): i is VaultItem => i !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export type VaultPatch = Partial<Pick<VaultItem, "title" | "titled" | "status" | "error" | "summary" | "ideas" | "tags" | "promoted">>;

// Serialise read-modify-write per item so the queue and the UI can't clobber each other.
const locks = new Map<string, Promise<unknown>>();

export async function updateItem(v: VaultDir, id: string, patch: VaultPatch | ((item: VaultItem) => VaultPatch)): Promise<VaultItem | null> {
  const key = path.join(v.dir, id);
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const item = await readItem(v, id);
    if (!item) return null;
    const changes = typeof patch === "function" ? patch(item) : patch;
    const merged: VaultItem = { ...item, ...changes, updatedAt: new Date().toISOString() };
    if (merged.status !== "failed") delete merged.error;
    const { path: _p, ...stored } = merged;
    void _p;
    await atomicWrite(path.join(itemDir(v, id), "item.json"), JSON.stringify(stored, null, 2));
    return withPath(v, merged);
  });
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

export async function deleteItem(v: VaultDir, id: string) {
  await rm(itemDir(v, id), { recursive: true, force: true });
}

export async function readOriginal(v: VaultDir, item: Pick<VaultItem, "id" | "filename">) {
  return readFile(originalPath(v, item));
}
