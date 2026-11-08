import "server-only";
import { customAlphabet } from "nanoid";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractTasks, noteExcerpt, noteTitle, parseNote, serializeNote, type NoteFrontmatter } from "./frontmatter";
import { MEMORY_NOTE_ID, sortNotes, type Note, type NoteFlags, type NoteMeta, type NoteScope, type NoteTask } from "./types";

/** Where one scope's notes live on disk. */
export type NoteDirs = { scope: NoteScope; notesDir: string; memoryFile: string; memoryTitle: string };

/** Lowercase alphanumerics: safe as a file name on every filesystem and easy for agents to type. */
export const newNoteId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function isNoteId(id: string) {
  return id === MEMORY_NOTE_ID || ID.test(id);
}

function fileFor(dirs: NoteDirs, id: string) {
  if (id === MEMORY_NOTE_ID) return dirs.memoryFile;
  if (!ID.test(id)) throw new Error("Invalid note id");
  return path.join(dirs.notesDir, `${id}.md`);
}

async function atomicWrite(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

function toNote(dirs: NoteDirs, id: string, file: string, raw: string, mtime: Date, birth: Date): Note {
  if (id === MEMORY_NOTE_ID) {
    const tasks = extractTasks(raw);
    return {
      id,
      scope: dirs.scope,
      title: dirs.memoryTitle,
      path: file,
      pinned: true,
      inject: true,
      actionable: false,
      tags: [],
      createdAt: birth.toISOString(),
      updatedAt: mtime.toISOString(),
      excerpt: noteExcerpt(raw),
      openTasks: tasks.filter((t) => !t.done).length,
      doneTasks: tasks.filter((t) => t.done).length,
      markdown: raw,
    };
  }
  const parsed = parseNote(raw);
  const fm = parsed.frontmatter;
  const title = noteTitle(parsed, id);
  const tasks = extractTasks(parsed.body);
  return {
    id,
    scope: dirs.scope,
    title,
    path: file,
    pinned: fm.pinned,
    inject: fm.inject,
    actionable: fm.actionable,
    tags: fm.tags,
    createdAt: fm.created ?? birth.toISOString(),
    // Agents edit the body without touching `updated`; the file's mtime is the truth.
    updatedAt: mtime.toISOString(),
    excerpt: noteExcerpt(parsed.body, title),
    openTasks: tasks.filter((t) => !t.done).length,
    doneTasks: tasks.filter((t) => t.done).length,
    markdown: parsed.body,
  };
}

export async function readNote(dirs: NoteDirs, id: string): Promise<Note | null> {
  const file = fileFor(dirs, id);
  const [raw, st] = await Promise.all([readFile(file, "utf8").catch(() => null), stat(file).catch(() => null)]);
  if (id === MEMORY_NOTE_ID) {
    const now = new Date();
    return toNote(dirs, id, file, raw ?? "", st?.mtime ?? now, st?.birthtime ?? now);
  }
  if (raw === null || !st) return null;
  return toNote(dirs, id, file, raw, st.mtime, st.birthtime);
}

/** Every note in the scope, memory first. Files that fail to read are skipped. */
export async function listNotes(dirs: NoteDirs, { withMemory = true } = {}): Promise<Note[]> {
  const entries = await readdir(dirs.notesDir).catch(() => [] as string[]);
  const ids = entries.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).filter((id) => ID.test(id) && id !== MEMORY_NOTE_ID);
  const notes = await Promise.all([...(withMemory ? [MEMORY_NOTE_ID] : []), ...ids].map((id) => readNote(dirs, id).catch(() => null)));
  return sortNotes(notes.filter((n): n is Note => n !== null));
}

export function metaOf(note: Note): NoteMeta {
  const { markdown, ...meta } = note;
  void markdown;
  return meta;
}

export type NotePatch = Partial<NoteFlags> & { title?: string; markdown?: string };

export async function createNote(dirs: NoteDirs, input: { title?: string; markdown?: string } & Partial<NoteFlags> = {}) {
  const id = newNoteId();
  const now = new Date().toISOString();
  const fm: NoteFrontmatter = {
    title: input.title?.trim() || "Untitled",
    pinned: input.pinned ?? false,
    inject: input.inject ?? false,
    actionable: input.actionable ?? false,
    tags: input.tags ?? [],
    created: now,
    updated: now,
  };
  await atomicWrite(fileFor(dirs, id), serializeNote(fm, input.markdown ?? ""));
  return (await readNote(dirs, id))!;
}

/** Update a note in place. Memory only takes `markdown`; its flags are fixed. */
export async function writeNote(dirs: NoteDirs, id: string, patch: NotePatch): Promise<Note | null> {
  const file = fileFor(dirs, id);
  if (id === MEMORY_NOTE_ID) {
    if (patch.markdown !== undefined) await atomicWrite(file, patch.markdown);
    return readNote(dirs, id);
  }
  const raw = await readFile(file, "utf8").catch(() => null);
  if (raw === null) return null;
  const parsed = parseNote(raw);
  const fm: NoteFrontmatter = {
    ...parsed.frontmatter,
    title: patch.title !== undefined ? patch.title.trim() || "Untitled" : noteTitle(parsed, id),
    pinned: patch.pinned ?? parsed.frontmatter.pinned,
    inject: patch.inject ?? parsed.frontmatter.inject,
    actionable: patch.actionable ?? parsed.frontmatter.actionable,
    tags: patch.tags ?? parsed.frontmatter.tags,
    updated: new Date().toISOString(),
  };
  await atomicWrite(file, serializeNote(fm, patch.markdown ?? parsed.body));
  return readNote(dirs, id);
}

export async function deleteNote(dirs: NoteDirs, id: string) {
  if (id === MEMORY_NOTE_ID) throw new Error("Memory can't be deleted");
  await rm(fileFor(dirs, id), { force: true });
}

/** Tasks from the scope's actionable notes, open ones first. */
export function tasksOf(notes: Note[], { includeDone = false } = {}): NoteTask[] {
  return notes
    .filter((n) => n.actionable)
    .flatMap((n) =>
      extractTasks(n.markdown)
        .filter((t) => includeDone || !t.done)
        .map((t) => ({ ...t, noteId: n.id, noteTitle: n.title, notePath: n.path })),
    );
}

/** How many notes (memory included) live in these scopes, without reading the files. */
export async function countNotes(all: NoteDirs[]) {
  const counts = await Promise.all(
    all.map(async (d) => 1 + (await readdir(d.notesDir).catch(() => [] as string[])).filter((f) => f.endsWith(".md") && ID.test(f.slice(0, -3))).length),
  );
  return counts.reduce((a, b) => a + b, 0);
}
