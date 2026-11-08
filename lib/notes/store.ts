import "server-only";
import { customAlphabet } from "nanoid";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile, lstat, realpath, link } from "node:fs/promises";
import path from "node:path";
import { extractTasks, noteExcerpt, noteTitle, parseNote, serializeNote, setTaskDone, type NoteFrontmatter } from "./frontmatter";
import { MEMORY_NOTE_ID, sortNotes, type Note, type NoteFlags, type NoteMeta, type NoteScope, type NoteTaskPatch, type NoteTask } from "./types";

/** Where one scope's notes live on disk. */
export type NoteDirs = { scope: NoteScope; notesDir: string; memoryFile?: string; memoryTitle?: string; checkoutRoot?: string };

/** Lowercase alphanumerics: safe as a file name on every filesystem and easy for agents to type. */
export const newNoteId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function isNoteId(id: string) {
  return id === MEMORY_NOTE_ID || ID.test(id);
}

async function fileFor(dirs: NoteDirs, id: string) {
  if (id === MEMORY_NOTE_ID) return dirs.memoryFile;
  if (!ID.test(id)) throw new Error("Invalid note id");
  const file = path.join(dirs.notesDir, `${id}.md`);
  if (dirs.scope.kind === "repos") {
    const root = await realpath(dirs.checkoutRoot ?? dirs.notesDir);
    const folder = await realpath(dirs.notesDir);
    if (folder !== root && !folder.startsWith(root + path.sep)) throw new Error("Notebook escapes checkout");
    const info = await lstat(file).catch((err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return null; throw err; });
    if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error("Note must be a regular file");
  }
  return file;
}

async function atomicWrite(file: string, content: string, exclusive = false) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, content, "utf8");
  try {
    if (exclusive) await link(tmp, file);
    else await rename(tmp, file);
  } finally { await rm(tmp, { force: true }); }
}

function toNote(dirs: NoteDirs, id: string, file: string, raw: string, mtime: Date, birth: Date): Note {
  if (id === MEMORY_NOTE_ID) {
    const tasks = extractTasks(raw);
    return {
      id,
      scope: dirs.scope,
      source: "thunk",
      title: dirs.memoryTitle ?? "Memory",
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
    source: dirs.scope.kind === "repos" ? "repo" : "thunk",
    title,
    ...(dirs.scope.kind === "repos" ? { titleInFile: fm.title !== null } : {}),
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
  const file = await fileFor(dirs, id);
  if (!file) return null;
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
  const notes = await Promise.all([...(withMemory && dirs.memoryFile ? [MEMORY_NOTE_ID] : []), ...ids].map((id) => readNote(dirs, id).catch(() => null)));
  return sortNotes(notes.filter((n): n is Note => n !== null));
}

export function metaOf(note: Note): NoteMeta {
  const { markdown, ...meta } = note;
  void markdown;
  return meta;
}

export type NotePatch = Partial<NoteFlags> & { title?: string; markdown?: string; task?: NoteTaskPatch; expectedUpdatedAt?: string };

export class NoteConflictError extends Error {}

export async function createNote(dirs: NoteDirs, input: { id?: string; title?: string; markdown?: string } & Partial<NoteFlags> = {}) {
  const id = dirs.scope.kind === "repos" ? input.id : newNoteId();
  if (!id || !ID.test(id) || id.toLowerCase() === MEMORY_NOTE_ID) throw new Error("A valid filename (without .md) is required");
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
  const file = (await fileFor(dirs, id))!;
  const body = input.markdown ?? (dirs.scope.kind === "repos" ? `# ${fm.title}\n` : "");
  const flags = input.pinned !== undefined || input.inject !== undefined || input.actionable !== undefined || input.tags !== undefined;
  await atomicWrite(file, dirs.scope.kind === "repos" && !flags ? body : serializeNote(fm, body), true);
  return (await readNote(dirs, id))!;
}

/** Update a note in place. Memory only takes `markdown`; its flags are fixed. */
export async function writeNote(dirs: NoteDirs, id: string, patch: NotePatch): Promise<Note | null> {
  const file = await fileFor(dirs, id);
  if (!file) return null;
  if (id === MEMORY_NOTE_ID) {
    if (patch.markdown !== undefined) await atomicWrite(file, patch.markdown);
    return readNote(dirs, id);
  }
  const raw = await readFile(file, "utf8").catch(() => null);
  if (raw === null) return null;
  if (patch.expectedUpdatedAt && (await stat(file)).mtime.toISOString() !== patch.expectedUpdatedAt)
    throw new NoteConflictError("Note changed on disk. Reload before saving.");
  const parsed = parseNote(raw);
  let markdown = patch.markdown ?? parsed.body;
  // shortcut: external writers can race this read/write; use coordinated file locking if strict concurrency is needed.
  if (patch.task) {
    const tasks = extractTasks(parsed.body);
    const matches = tasks.filter((t) => t.text === patch.task!.text);
    const task = tasks.find((t) => t.line === patch.task!.line && t.text === patch.task!.text) ?? (matches.length === 1 ? matches[0] : undefined);
    if (!task || task.text !== patch.task.text)
      throw new NoteConflictError("Task changed on disk. Refresh the task list and try again.");
    markdown = setTaskDone(parsed.body, task.line, patch.task.done);
  }
  const fm: NoteFrontmatter = {
    ...parsed.frontmatter,
    title: patch.title !== undefined ? patch.title.trim() || "Untitled" : parsed.frontmatter.title,
    pinned: patch.pinned ?? parsed.frontmatter.pinned,
    inject: patch.inject ?? parsed.frontmatter.inject,
    actionable: patch.actionable ?? parsed.frontmatter.actionable,
    tags: patch.tags ?? parsed.frontmatter.tags,
    updated: dirs.scope.kind === "repos" ? parsed.frontmatter.updated : new Date().toISOString(),
  };
  await atomicWrite(file, serializeNote(fm, markdown, parsed));
  return readNote(dirs, id);
}

export async function deleteNote(dirs: NoteDirs, id: string) {
  if (id === MEMORY_NOTE_ID) throw new Error("Memory can't be deleted");
  await rm((await fileFor(dirs, id))!, { force: true });
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
    all.map(async (d) => Number(Boolean(d.memoryFile)) + (await readdir(d.notesDir, { withFileTypes: true }).catch(() => [])).filter((f) => f.isFile() && f.name.endsWith(".md") && f.name !== "memory.md" && ID.test(f.name.slice(0, -3))).length),
  );
  return counts.reduce((a, b) => a + b, 0);
}
