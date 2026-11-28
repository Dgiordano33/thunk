import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { replacePromptItems, upsertContextItem, type ContextItemRow } from "@/lib/db/repo/context-items";
import { parseNote } from "@/lib/notes/frontmatter";
import type { ContextItemDraft, ContextKind, ContextOrigin } from "./types";

/** Snapshots for diffs are capped so one huge note can't bloat the table. */
const CONTENT_LIMIT = 200_000;

export const contentHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);

export function toRow(d: ContextItemDraft): ContextItemRow {
  const source = d.source ?? null;
  return {
    kind: d.kind, refId: d.refId, title: d.title || d.refId, path: d.path ?? null, mode: d.mode, reason: d.reason ?? null, chars: d.chars,
    contentHash: source === null ? null : contentHash(source),
    content: d.keepContent && source !== null && source.length <= CONTENT_LIMIT ? source : null,
  };
}

// Prompt items are built while the driver starts, before the session row exists; writes wait for it.
type Ready = { promise: Promise<void>; resolve: () => void };
const g = globalThis as typeof globalThis & { __thunkContextReady?: Map<string, Ready> };
const ready: Map<string, Ready> = (g.__thunkContextReady ??= new Map());

function readyFor(sessionId: string) {
  let entry = ready.get(sessionId);
  if (!entry) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    entry = { promise, resolve };
    ready.set(sessionId, entry);
  }
  return entry;
}

/** Called by persistence once the session row is written (or right away without a database). */
export function sessionPersisted(sessionId: string) {
  readyFor(sessionId).resolve();
}

/** Write context items for a session. Never throws: this is a side record. */
export async function recordContextItems(sessionId: string, origin: ContextOrigin, drafts: ContextItemDraft[]) {
  try {
    await readyFor(sessionId).promise;
    const rows = drafts.map(toRow);
    if (origin === "prompt") await replacePromptItems(sessionId, rows);
    else for (const row of rows) await upsertContextItem(sessionId, origin, row);
  } catch (err) {
    console.error("[thunk] record session context failed", err);
  }
}

/** The text an item's hash covers: a note's body, or a whole memory or instructions file. */
export const sourceOf = (kind: ContextKind, raw: string) => (kind === "note" ? parseNote(raw).body : raw);

export type ContextDirs = { notes: string[]; memory: { dir: string; refId: string; title: string }[]; vault: string };

const inside = (dir: string, file: string) => file === dir || file.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/** What a Read of `file` fetched, if it is a note, memory file or Vault item. */
export function classifyRead(dirs: ContextDirs, file: string): { kind: ContextKind; refId: string; title: string } | null {
  const abs = path.resolve(file);
  const memory = dirs.memory.find((m) => inside(m.dir, abs));
  if (memory) {
    const main = path.basename(abs) === "MEMORY.md";
    return { kind: "memory", refId: main ? memory.refId : `${memory.refId}/${path.relative(memory.dir, abs)}`, title: main ? memory.title : `${memory.title} · ${path.basename(abs)}` };
  }
  if (dirs.notes.some((d) => inside(d, abs)) && abs.endsWith(".md")) return { kind: "note", refId: path.basename(abs, ".md"), title: path.basename(abs, ".md") };
  if (inside(dirs.vault, abs) && abs !== dirs.vault) return { kind: "vault", refId: path.relative(dirs.vault, abs).split(path.sep)[0], title: path.basename(abs) };
  return null;
}

const dg = globalThis as typeof globalThis & { __thunkContextDirs?: Map<string, ContextDirs> };
const readDirs: Map<string, ContextDirs> = (dg.__thunkContextDirs ??= new Map());

/** Remember where this session's context files live, for {@link recordToolUse}. Set on every start and resume. */
export function watchContextReads(sessionId: string, dirs: ContextDirs) {
  readDirs.set(sessionId, dirs);
}

/** Called from the event bridge for every tool call; records Reads of notes, memory and the Vault. */
export function recordToolUse(sessionId: string, name: string, input: unknown) {
  if (name !== "Read") return;
  const dirs = readDirs.get(sessionId);
  if (!dirs) return;
  void recordRead(sessionId, dirs, (input as { file_path?: unknown } | null)?.file_path).catch((err) => console.error("[thunk] record read failed", err));
}

/** Record a Read tool call that targeted a note, memory file or Vault original. */
export async function recordRead(sessionId: string, dirs: ContextDirs, file: unknown) {
  if (typeof file !== "string" || !file) return;
  const hit = classifyRead(dirs, file);
  if (!hit) return;
  const raw = hit.kind === "vault" ? null : await readFile(file, "utf8").catch(() => null);
  const source = raw === null ? null : sourceOf(hit.kind, raw);
  const title = hit.kind === "note" && raw !== null ? (parseNote(raw).frontmatter.title ?? hit.title) : hit.title;
  await recordContextItems(sessionId, "fetched", [{
    ...hit, title, path: path.resolve(file), mode: "full", chars: raw?.length ?? 0, source, keepContent: hit.kind === "note",
  }]);
}
