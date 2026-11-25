import "server-only";
import { createHash } from "node:crypto";
import { link, mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseNote, serializeNote } from "./frontmatter";
import { NoteConflictError, readOptional, withFileLock } from "./file-write";

/** Stable names let an interrupted migration resume without duplicating a note. */
export function migratedNoteId(workspaceId: string, noteId: string) {
  return `ws-${createHash("sha256").update(`${workspaceId}/${noteId}`).digest("hex").slice(0, 40)}`;
}

/** Move legacy files only after a durable project copy and reference updates exist. */
export async function migrateWorkspaceNotes(source: string, destination: string, workspaceId: string,
  updateReferences: (from: string, to: string) => Promise<void> = async () => {}) {
  const files = await readdir(source).catch((err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return []; throw err; });
  // A conflict preserves both files and must not stop the remaining notes from migrating.
  const conflicts: NoteConflictError[] = [];
  for (const filename of files.filter((f) => /^[a-z0-9][a-z0-9_-]{0,63}\.md$/i.test(f) && f !== "memory.md")) {
    const from = path.join(source, filename);
    await withFileLock(from, async () => {
      const raw = await readOptional(from);
      if (raw === null) return;
      const id = filename.slice(0, -3);
      const nextId = migratedNoteId(workspaceId, id);
      const to = path.join(destination, `${nextId}.md`);
      const parsed = parseNote(raw);
      const content = serializeNote({ ...parsed.frontmatter, workspaceIds: [...new Set([...(parsed.frontmatter.workspaceIds ?? []), workspaceId])] }, parsed.body, parsed);
      await mkdir(destination, { recursive: true });
      await withFileLock(to, async () => {
        const temp = `${to}.${crypto.randomUUID()}.tmp`;
        try {
          await writeFile(temp, content);
          await link(temp, to);
        }
        catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
          if (await readOptional(to) !== content) throw new NoteConflictError("A legacy note and its project copy differ. Both files were preserved.");
        }
        finally { await rm(temp, { force: true }); }
        await updateReferences(id, nextId);
        if (await readOptional(from) !== raw) throw new NoteConflictError("Note changed during migration. Both files were preserved.");
        await unlink(from);
      });
    }).catch((err) => {
      if (!(err instanceof NoteConflictError)) throw err;
      conflicts.push(err);
    });
  }
  if (conflicts.length) throw conflicts[0];
}
