import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NoteConflictError, readOptional, replaceFile, withFileLock } from "../notes/file-write";

export async function readMemory(file: string): Promise<string> {
  return readFile(file, "utf8").catch(() => "");
}

export async function writeMemory(file: string, content: string, expectedContent: string) {
  return withFileLock(file, async () => {
    const current = await readOptional(file);
    if ((current ?? "") !== expectedContent) throw new NoteConflictError("Memory changed on disk. Reload before saving.");
    await replaceFile(file, content, current);
  });
}

/** Create the memory dir (and an empty MEMORY.md with a header) if it doesn't exist. */
export async function ensureMemory(file: string, header: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${header}\n`, { encoding: "utf8", flag: "wx" }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "EEXIST") throw err;
  });
}
