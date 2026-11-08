import "server-only";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { projectNoteDirs } from "@/lib/notes/resolve";
import { createNote } from "@/lib/notes/store";
import { createTask } from "@/lib/tasks/service";
import { enqueue } from "./extract";
import { createItem, deleteItem, isVaultId, listItems, readOriginal, updateItem } from "./store";
import { ideaBody, listAllItems, recordPromotion, requireItem, vaultFor } from "./service";
import { VAULT_MAX_BYTES, VAULT_MAX_FILES } from "./types";

// Route handlers for /api/projects/[id]/vault/** and /api/vault.

type Ctx<P> = { params: Promise<P> };
type ItemParams = { id: string; itemId: string };

function itemId(id: string) {
  if (!isVaultId(id)) throw new HttpError(400, "Invalid vault item id");
  return id;
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;

export const collection = {
  GET: handle(async (_req: Request, ctx: Ctx<{ id: string }>) => {
    const { vault } = await vaultFor((await ctx.params).id);
    return Response.json({ items: await listItems(vault), dir: vault.dir });
  }),
  /** multipart/form-data: `file` (repeatable) and/or `text` (pasted content), optional `title`. */
  POST: handle(async (req: Request, ctx: Ctx<{ id: string }>) => {
    const { vault } = await vaultFor((await ctx.params).id);
    const form = await req.formData().catch(() => {
      throw new HttpError(400, "Send multipart/form-data");
    });
    const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
    const text = form.get("text");
    const title = typeof form.get("title") === "string" ? (form.get("title") as string) : undefined;
    const pasted = typeof text === "string" && text.trim() ? text : null;
    if (!files.length && !pasted) throw new HttpError(400, "Nothing to upload");
    if (files.length + (pasted ? 1 : 0) > VAULT_MAX_FILES) throw new HttpError(400, `Up to ${VAULT_MAX_FILES} files at a time`);
    for (const f of files) {
      if (f.size > VAULT_MAX_BYTES) throw new HttpError(413, `${f.name} is over ${mb(VAULT_MAX_BYTES)}`);
      if (f.size === 0) throw new HttpError(400, `${f.name} is empty`);
    }
    if (pasted && Buffer.byteLength(pasted) > VAULT_MAX_BYTES) throw new HttpError(413, `Pasted text is over ${mb(VAULT_MAX_BYTES)}`);
    const items = [];
    for (const f of files) {
      items.push(await createItem(vault, { filename: f.name, mime: f.type, bytes: Buffer.from(await f.arrayBuffer()), title: files.length === 1 && !pasted ? title : undefined }));
    }
    if (pasted) items.push(await createItem(vault, { filename: "pasted.md", mime: "text/markdown", bytes: Buffer.from(pasted, "utf8"), title }));
    for (const item of items) enqueue(vault, item.id);
    return Response.json({ items });
  }),
};

const PatchBody = z.object({ title: z.string().trim().min(1).max(200).optional(), reextract: z.literal(true).optional() }).strict();

export const item = {
  GET: handle(async (_req: Request, ctx: Ctx<ItemParams>) => {
    const p = await ctx.params;
    const { vault } = await vaultFor(p.id);
    return Response.json({ item: await requireItem(vault, itemId(p.itemId)) });
  }),
  PATCH: handle(async (req: Request, ctx: Ctx<ItemParams>) => {
    const p = await ctx.params;
    const { vault } = await vaultFor(p.id);
    const id = itemId(p.itemId);
    const body = await parseBody(req, PatchBody);
    const cur = await requireItem(vault, id);
    if (body.reextract && (cur.status === "queued" || cur.status === "processing")) throw new HttpError(409, "Already being read");
    const next = await updateItem(vault, id, {
      ...(body.title ? { title: body.title, titled: true } : {}),
      ...(body.reextract ? { status: "queued" as const } : {}),
    });
    if (body.reextract) enqueue(vault, id);
    return Response.json({ item: next });
  }),
  DELETE: handle(async (_req: Request, ctx: Ctx<ItemParams>) => {
    const p = await ctx.params;
    const { vault } = await vaultFor(p.id);
    await deleteItem(vault, itemId(p.itemId));
    return Response.json({ ok: true });
  }),
};

export const file = {
  GET: handle(async (req: Request, ctx: Ctx<ItemParams>) => {
    const p = await ctx.params;
    const { vault } = await vaultFor(p.id);
    const it = await requireItem(vault, itemId(p.itemId));
    const bytes = await readOriginal(vault, it).catch(() => {
      throw new HttpError(404, "Original file is missing");
    });
    const download = new URL(req.url).searchParams.has("download");
    // Only images and PDFs render inline; anything else (HTML, SVG, scripts) is served as plain text or a download.
    const type = it.kind === "image" || it.kind === "pdf" ? it.mime : it.kind === "text" ? "text/plain; charset=utf-8" : "application/octet-stream";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": type,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(it.filename)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }),
};

const PromoteBody = z.object({ ideaId: z.string().min(1).max(20), to: z.enum(["note", "task"]) }).strict();

export const promote = {
  POST: handle(async (req: Request, ctx: Ctx<ItemParams>) => {
    const p = await ctx.params;
    const { project, vault } = await vaultFor(p.id);
    const id = itemId(p.itemId);
    const body = await parseBody(req, PromoteBody);
    const it = await requireItem(vault, id);
    const { idea, body: markdown } = ideaBody(it, body.ideaId);
    if (body.to === "note") {
      const note = await createNote(projectNoteDirs(project), { title: idea.title.slice(0, 200), markdown, tags: ["vault", ...(it.tags ?? [])].slice(0, 20) });
      return Response.json({ item: await recordPromotion(vault, id, idea.id, { noteId: note.id }), noteId: note.id });
    }
    const task = await createTask({ projectId: project.id, title: idea.title.slice(0, 200), body: markdown }, { createdBy: "user" });
    return Response.json({ item: await recordPromotion(vault, id, idea.id, { taskId: task.id }), taskId: task.id });
  }),
};

export const everything = {
  GET: handle(async () => Response.json({ items: await listAllItems() })),
};
