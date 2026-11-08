import "server-only";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export class NoteConflictError extends Error {}

const locks = new Map<string, Promise<unknown>>();

export async function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(file) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  locks.set(file, next);
  try { return await next; }
  finally { if (locks.get(file) === next) locks.delete(file); }
}

export async function readOptional(file: string) {
  return readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
}

/** Stage first, then recheck external edits immediately before replacing the file. */
export async function replaceFile(file: string, content: string, expected: string | null) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    if (await readOptional(file) !== expected) throw new NoteConflictError("Note changed on disk. Reload before saving.");
    // shortcut: external tools do not share our lock; strict cross-process CAS needs coordinated writers.
    await rename(tmp, file);
  } finally { await rm(tmp, { force: true }); }
}
