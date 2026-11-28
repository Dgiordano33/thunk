import "server-only";
import { createHash } from "node:crypto";
import path from "node:path";
import { readOptional, replaceFile, withFileLock } from "@/lib/notes/file-write";
import { projectMemoryDir } from "@/lib/projects/paths";
import type { MemorySidecar } from "./types";

/**
 * Sources and kind live beside MEMORY.md rather than in it: Claude's auto-memory reads MEMORY.md directly, so it stays
 * plain markdown. Entries are keyed by a hash of the entry text, so an entry keeps its sources wherever it moves.
 */
export const sidecarFile = (dataKey: string) => path.join(projectMemoryDir(dataKey), "sources.json");

/** The hash of a memory entry's text, ignoring surrounding and repeated whitespace. */
export function entryKey(text: string) {
  return createHash("sha256").update(text.trim().replace(/\s+/g, " ")).digest("hex").slice(0, 16);
}

/** The hash of a whole MEMORY.md, to tell whether it changed since a proposal or review screen read it. */
export function memoryHash(content: string) {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function parse(raw: string | null): MemorySidecar {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export async function readSidecar(dataKey: string): Promise<MemorySidecar> {
  return parse(await readOptional(sidecarFile(dataKey)));
}

export async function updateSidecar(dataKey: string, change: (sidecar: MemorySidecar) => void) {
  const file = sidecarFile(dataKey);
  return withFileLock(file, async () => {
    const raw = await readOptional(file);
    const sidecar = parse(raw);
    change(sidecar);
    await replaceFile(file, JSON.stringify(sidecar, null, 2) + "\n", raw);
    return sidecar;
  });
}
