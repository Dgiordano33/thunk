import 'server-only';
import { z } from 'zod';
import path from 'node:path';
import { atomic } from './store';
import { visualKey } from './pending';
import { rm } from 'node:fs/promises';
import { handle, HttpError, parseBody } from '@/lib/api/http';
import { boardFor, addImageCard } from './service';
import { addCard, assetBytes, cardFile, lock, patchCard, readBoard, readCard, saveBoard, saveCard, snapshot } from './store';
import { sendBoard } from './session';
import { parseChart } from './chart';
import { refreshChart } from './refresh';
const validChart = (input: unknown) => { try {
    return parseChart(input);
}
catch (e) {
    throw new HttpError(400, e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message);
} };
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
const stroke = z.object({ id: z.string().max(80), points: z.array(point).max(10000), sentAt: z.string().nullable() });
const coord = z.number().finite().min(-1e6).max(1e6);
const patch = z.object({ baseRev: z.number().int().min(0), below: z.null().optional(), title: z.string().max(200).optional(), markdown: z.string().max(100000).optional(), contentJson: z.record(z.string(), z.unknown()).optional(), x: z.number().finite().optional(), y: z.number().finite().optional(), width: z.number().min(24).max(4000).optional(), height: z.number().min(1).max(20000).optional(), comments: z.array(reply.extend({ quote: z.string().max(100000), resolved: z.boolean(), detached: z.boolean().optional(), replies: z.array(reply).max(500), x: point.shape.x.optional(), y: point.shape.y.optional(), anchor: z.object({ x: z.union([z.string().max(200), z.number().finite()]), series: z.string().max(80).optional(), row: z.number().int().min(0).optional() }).strict().optional() })).max(500).optional(), chart: z.unknown().optional(), strokes: z.array(stroke).max(500).optional() }).strict();
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
            if (file.type === 'image/svg+xml')
                throw new HttpError(400, 'Upload a PNG, JPEG, GIF or WebP');
            if (file.size > 5000000)
                throw new HttpError(413, 'Image exceeds 5 MB');
            const at = z.object({ x: z.coerce.number().pipe(coord), y: z.coerce.number().pipe(coord) }).safeParse({ x: form.get('x'), y: form.get('y') });
            return Response.json({ card: await addImageCard(dir, { bytes: Buffer.from(await file.arrayBuffer()), mime: file.type, origin: 'user', ...(form.has('x') && form.has('y') && at.success ? at.data : {}) }) });
        }
        const body = await parseBody(req, z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(), contentJson: z.record(z.string(), z.unknown()).optional(), markdown: z.string().max(100000).default(''), title: z.string().max(200).default('Untitled'), kind: z.enum(['doc', 'drawing']).optional(), x: coord.optional(), y: coord.optional(), width: z.number().min(24).max(4000).optional(), height: z.number().min(1).max(20000).optional(), strokes: z.array(stroke.extend({ sentAt: z.null().default(null) })).max(500).optional() }).strict());
        return Response.json({ card: await lock(dir, () => addCard(dir, body)) });
    }) };
export const item = {
    PATCH: handle(async (req: Request, ctx: Ctx) => {
        const p = await ctx.params, { dir } = await boardFor(p.id), { baseRev, chart, ...body } = await parseBody(req, patch);
        return Response.json({ card: await patchCard(dir, p.cardId, baseRev, { ...body, ...(chart !== undefined ? { chart: validChart(chart) } : {}) }) });
    }),
    DELETE: handle(async (req: Request, ctx: Ctx) => { const p = await ctx.params, { dir } = await boardFor(p.id); const { baseRev } = await parseBody(req, z.object({ baseRev: z.number().int() })); await lock(dir, async () => { const c = await readCard(dir, p.cardId); if (c.rev !== baseRev)
        throw new HttpError(409, 'Card changed'); const b = await readBoard(dir); if (c.sentAt !== null || c.baselineMarkdown !== '')
        b.tombstones.push(c.id); b.edges = b.edges.filter(e => e.source !== c.id && e.target !== c.id); await saveBoard(dir, b); await rm(cardFile(dir, c.id)); }); return Response.json({ ok: true }); }),
};
export const file = { GET: handle(async (_: Request, ctx: Ctx) => { const p = await ctx.params, { dir } = await boardFor(p.id), c = await readCard(dir, p.cardId); return new Response(new Uint8Array(await assetBytes(dir, c)), { headers: { 'Content-Type': c.mime || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox', 'Cache-Control': 'no-store' } }); }) };
export const revert = { POST: handle(async (req: Request, ctx: Ctx) => { const p = await ctx.params, { dir } = await boardFor(p.id); const body = await parseBody(req, z.object({ baseRev: z.number().int(), keep: z.boolean().default(false) })); return Response.json({ card: await lock(dir, async () => { const c = await readCard(dir, p.cardId); if (c.rev !== body.baseRev)
            throw new HttpError(409, 'Card changed'); if (c.agentEdit && !body.keep) {
            c.markdown = c.agentEdit.markdown;
            c.contentJson = c.agentEdit.contentJson;
        } delete c.agentEdit; return saveCard(dir, c); }) }); }) };
export const send = { POST: handle(async (req: Request, ctx: ProjectCtx) => { const body = await parseBody(req, z.object({ scope: z.union([z.object({ cardId: z.string(), targetId: z.string() }).strict(), z.object({ focus: z.array(z.string().max(80)).min(1).max(50), prompt: z.string().max(20000).optional() }).strict()]).optional() }).strict()); return Response.json(await sendBoard((await ctx.params).id, body.scope)); }) };
export const annotated = { PUT: handle(async (req: Request, ctx: Ctx) => {
        const p = await ctx.params, { dir } = await boardFor(p.id);
        const form = await req.formData(), image = form.get('file'), key = form.get('key');
        if (!(image instanceof File) || image.type !== 'image/png' || image.size > 5000000 || typeof key !== 'string')
            throw new HttpError(400, 'Annotated PNG up to 5 MB and its key required');
        const bytes = Buffer.from(await image.arrayBuffer());
        if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
            throw new HttpError(400, 'Invalid PNG');
        await lock(dir, async () => { const c = await readCard(dir, p.cardId); if (visualKey(c) !== key)
            throw new HttpError(409, 'Image changed; retry send'); await atomic(path.join(dir, 'assets', `${c.id}.annotated.png`), bytes); await atomic(path.join(dir, 'assets', `${c.id}.annotated.key`), key); });
        return Response.json({ ok: true });
    }) };
/** Re-runs a chart's source command. The client sends the command it showed the user, so a command changed since then is refused. */
export const refresh = { POST: handle(async (req: Request, ctx: Ctx) => { const p = await ctx.params, { project, dir } = await boardFor(p.id); const { command } = await parseBody(req, z.object({ command: z.string().max(4000) }).strict()); return Response.json({ card: await refreshChart(project, dir, p.cardId, command) }); }) };
