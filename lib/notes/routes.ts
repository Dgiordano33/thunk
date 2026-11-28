import "server-only";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { dirsForScope } from "./resolve";
import { NoteConflictError, createNote, deleteNote, isNoteId, listNotes, metaOf, readNote, writeNote } from "./store";
import { MEMORY_NOTE_ID, type NoteScopeKind } from "./types";
import { getWorkspace } from "@/lib/db/repo/workspaces";
import type { NoteDirs } from "./store";
import { getRepoFolder, setRepoFolderFiles } from "@/lib/db/repo/repo-folders";
import { repoTaskLink } from "./task-link";

// Route handlers shared by /api/projects/[id]/notes and /api/workspaces/[id]/notes.

type Ctx<P> = { params: Promise<P> };

const Flags = {
  workspaceIds: z.array(z.string().uuid()).max(100).optional(),
  pinned: z.boolean().optional(),
  inject: z.boolean().optional(),
  actionable: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
};

const CreateBody = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i).optional(), title: z.string().max(200).optional(), markdown: z.string().max(200_000).optional(), ...Flags });
const PatchBody = z.object({
  expectedUpdatedAt: z.string().optional(),
  title: z.string().max(200).optional(),
  markdown: z.string().max(200_000).optional(),
  task: z.object({ line: z.number().int().nonnegative(), text: z.string().max(200_000), done: z.boolean() }).optional(),
  ...Flags,
}).refine((body) => !body.task || body.markdown === undefined, "Send task or markdown, not both");

function noteId(id: string) {
  if (!isNoteId(id)) throw new HttpError(400, "Invalid note id");
  return id;
}

async function validateLinks(dirs: NoteDirs, ids?: string[], existing: string[] = []) {
  if (!ids) return;
  if (dirs.scope.kind !== "projects") throw new HttpError(400, "Workspace links are supported on project notes");
  for (const id of ids) {
    if (existing.includes(id)) continue;
    const workspace = await getWorkspace(id);
    if (!workspace || workspace.projectId !== dirs.scope.id) throw new HttpError(400, "Linked workspace must belong to this project");
  }
}

export function notesCollection(kind: NoteScopeKind) {
  return {
    GET: handle(async (_req: Request, ctx: Ctx<{ id: string }>) => {
      const dirs = await dirsForScope({ kind, id: (await ctx.params).id });
      return Response.json({ notes: (await listNotes(dirs)).map(metaOf), dir: dirs.notesDir });
    }),
    POST: handle(async (req: Request, ctx: Ctx<{ id: string }>) => {
      const dirs = await dirsForScope({ kind, id: (await ctx.params).id });
      const body = await parseBody(req, CreateBody);
      await validateLinks(dirs, body.workspaceIds);
      if (kind === "repos" && (!body.id || body.id.toLowerCase() === MEMORY_NOTE_ID)) throw new HttpError(400, "A filename other than memory is required");
      const note = await createNote(dirs, body).catch((err) => {
        if (err.code === "EEXIST") throw new HttpError(409, "A note with this filename already exists");
        throw err;
      });
      // A notebook narrowed to picked files shows the files created through it too.
      if (kind === "repos" && dirs.include && !dirs.include.includes(note.id)) {
        const folder = await getRepoFolder(dirs.scope.id);
        if (folder) await setRepoFolderFiles(folder.projectId, folder.id, [...dirs.include, note.id]);
      }
      return Response.json({ note });
    }),
  };
}

export function noteItem(kind: NoteScopeKind) {
  return {
    GET: handle(async (_req: Request, ctx: Ctx<{ id: string; noteId: string }>) => {
      const p = await ctx.params;
      const note = await readNote(await dirsForScope({ kind, id: p.id }), noteId(p.noteId));
      if (!note) throw new HttpError(404, "Note not found");
      return Response.json({ note });
    }),
    PATCH: handle(async (req: Request, ctx: Ctx<{ id: string; noteId: string }>) => {
      const p = await ctx.params;
      const id = noteId(p.noteId);
      const body = await parseBody(req, PatchBody);
      if (id === MEMORY_NOTE_ID && Object.keys(body).some((k) => k !== "markdown" && k !== "expectedUpdatedAt"))
        throw new HttpError(400, "Memory only takes markdown edits");
      const dirs = await dirsForScope({ kind, id: p.id });
      await validateLinks(dirs, body.workspaceIds, (await readNote(dirs, id))?.workspaceIds);
      const note = await writeNote(dirs, id, body).catch((err) => {
        if (err instanceof NoteConflictError) throw new HttpError(409, err.message);
        throw err;
      });
      if (!note) throw new HttpError(404, "Note not found");
      // Tasks delegated from this note hear about the edit through their project's chief, once the edits settle.
      if (body.markdown !== undefined && id !== MEMORY_NOTE_ID) {
        const { noteSaved } = await import("@/lib/sources/service");
        noteSaved(kind === "repos" ? repoTaskLink(p.id, id) : id);
      }
      return Response.json({ note });
    }),
    DELETE: handle(async (_req: Request, ctx: Ctx<{ id: string; noteId: string }>) => {
      const p = await ctx.params;
      const id = noteId(p.noteId);
      if (id === MEMORY_NOTE_ID) throw new HttpError(400, "Memory can't be deleted");
      await deleteNote(await dirsForScope({ kind, id: p.id }), id);
      return Response.json({ ok: true });
    }),
  };
}
