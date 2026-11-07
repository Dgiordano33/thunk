import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readMemory(file: string): Promise<string> {
  return readFile(file, "utf8").catch(() => "");
}

export async function writeMemory(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

/** Create the memory dir (and an empty MEMORY.md with a header) if it doesn't exist. */
export async function ensureMemory(file: string, header: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const existing = await readFile(file, "utf8").catch(() => null);
  if (existing === null) await writeFile(file, `${header}\n`, "utf8");
}
