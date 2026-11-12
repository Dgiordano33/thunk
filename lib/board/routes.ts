import 'server-only';
import { z } from 'zod';
import path from 'node:path';
import { atomic } from './store';
import { rm } from 'node:fs/promises';
import { handle, HttpError, parseBody } from '@/lib/api/http';
import { boardFor, addImageCard } from './service';
import { addCard, assetBytes, cardFile, lock, patchCard, readBoard, readCard, saveBoard, saveCard, snapshot } from './store';
import { sendBoard } from './session';
type ProjectCtx = {
    params: Promise<{
        id: string;
    }>;
};
type Ctx = {
    params: Promise<{
        id: string;
        cardId: string;
    }>;
};
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const reply = z.object({ id: z.string().max(80), body: z.string().max(20000), author: z.enum(['user', 'agent']), sentAt: z.string().nullable() });
const patch = z.object({ baseRev: z.number().int().min(0), title: z.string().max(200).optional(), markdown: z.string().max(100000).optional(), contentJson: z.record(z.string(), z.unknown()).optional(), x: z.number().finite().optional(), y: z.number().finite().optional(), width: z.number().min(240).max(2000).optional(), height: z.number().min(180).max(3000).optional(), comments: z.array(reply.extend({ quote: z.string().max(100000), resolved: z.boolean(), detached: z.boolean().optional(), replies: z.array(reply).max(500), x: point.shape.x.optional(), y: point.shape.y.optional() })).max(500).optional(), strokes: z.array(z.object({ id: z.string().max(80), points: z.array(point).max(10000), sentAt: z.string().nullable() })).max(500).optional() }).strict();
export const collection = {
    GET: handle(async (_: Request, ctx: ProjectCtx) => { const { dir } = await boardFor((await ctx.params).id); return Response.json(await lock(dir, () => snapshot(dir))); }),
    PATCH: handle(async (req: Request, ctx: ProjectCtx) => { const { dir } = await boardFor((await ctx.params).id); const body = await parseBody(req, z.object({ viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(.2).max(2) }) }).strict()); await lock(dir, async () => { const b = await readBoard(dir); b.viewport = body.viewport; await saveBoard(dir, b); }); return Response.json({ ok: true }); }),
};
export const cards = { POST: handle(async (req: Request, ctx: ProjectCtx) => {
        const { dir } = await boardFor((await ctx.params).id);
        if (req.headers.get('content-type')?.includes('multipart/form-data')) {
            const form = await req.formData();
            const file = form.get('file');
            if (!(file instanceof File))
                throw new HttpError(400, 'Image required');
            if (file.size > 5000000)
                throw new HttpError(413, 'Image exceeds 5 MB');
            return Response.json({ card: await addImageCard(dir, { bytes: Buffer.from(await file.arrayBuffer()), mime: file.type, origin: 'user' }) });
        }
        const body = await parseBody(req, z.object({ markdown: z.string().max(100000).default(''), title: z.string().max(200).default('Untitled') }).strict());
        return Response.json({ card: await lock(dir, () => addCard(dir, body)) });
    }) };
export const item = {
    PATCH: handle(async (req: Request, ctx: Ctx) => { const p = await ctx.params, { dir } = await boardFor(p.id), { baseRev, ...body } = await parseBody(req, patch); return Response.json({ card: await patchCard(dir, p.cardId, baseRev, body) }); }),
    DELETE: handle(async (req: Request, ctx: Ctx) => { const p = await ctx.params, { dir } = await boardFor(p.id); const { baseRev } = await parseBody(req, z.object({ baseRev: z.number().int() })); await lock(dir, async () => { const c = await readCard(dir, p.cardId); if (c.rev !== baseRev)
        throw new HttpError(409, 'Card changed'); const b = await readBoard(dir); b.tombstones.push(c.id); b.edges = b.edges.filter(e => e.source !== c.id && e.target !== c.id); await saveBoard(dir, b); await rm(cardFile(dir, c.id)); }); return Response.json({ ok: true }); }),
};
export const file = { GET: handle(async (_: Request, ctx: Ctx) => { const p = await ctx.params, { dir } = await boardFor(p.id), c = await readCard(dir, p.cardId); return new Response(new Uint8Array(await assetBytes(dir, c)), { headers: { 'Content-Type': c.mime || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox', 'Cache-Control': 'no-store' } }); }) };
export const revert = { POST: handle(async (req: Request, ctx: Ctx) => { const p = await ctx.params, { dir } = await boardFor(p.id); const body = await parseBody(req, z.object({ baseRev: z.number().int(), keep: z.boolean().default(false) })); return Response.json({ card: await lock(dir, async () => { const c = await readCard(dir, p.cardId); if (c.rev !== body.baseRev)
            throw new HttpError(409, 'Card changed'); if (c.agentEdit && !body.keep) {
            c.markdown = c.agentEdit.markdown;
            c.contentJson = c.agentEdit.contentJson;
        } delete c.agentEdit; return saveCard(dir, c); }) }); }) };
export const send = { POST: handle(async (req: Request, ctx: ProjectCtx) => { const body = await parseBody(req, z.object({ scope: z.object({ cardId: z.string(), targetId: z.string() }).optional() }).strict()); return Response.json(await sendBoard((await ctx.params).id, body.scope)); }) };
export const annotated = { PUT: handle(async (req: Request, ctx: Ctx) => {
        const p = await ctx.params, { dir } = await boardFor(p.id);
        const form = await req.formData(), image = form.get('file'), baseRev = Number(form.get('baseRev'));
        if (!(image instanceof File) || image.type !== 'image/png' || image.size > 5000000)
            throw new HttpError(400, 'Annotated PNG up to 5 MB required');
        const bytes = Buffer.from(await image.arrayBuffer());
        if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
            throw new HttpError(400, 'Invalid PNG');
        await lock(dir, async () => { const c = await readCard(dir, p.cardId); if (c.rev !== baseRev)
            throw new HttpError(409, 'Image changed; retry send'); await atomic(path.join(dir, 'assets', `${c.id}.annotated.png`), bytes); await atomic(path.join(dir, 'assets', `${c.id}.annotated.rev`), String(c.rev)); });
        return Response.json({ ok: true });
    }) };
