import { reanchor } from './anchors';
import 'server-only';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withFileLock, readOptional } from '@/lib/notes/file-write';
import { HttpError } from '@/lib/api/errors';
import type { Board, Card, Snapshot } from './types';
import { GAP, estimateHeight, placement } from './placement';
/** Card fields that only describe layout: saving them never conflicts with content edits. */
export const GEOMETRY = new Set(['x', 'y', 'width', 'height', 'below']);
export const validId = (id: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export function cardFile(dir: string, id: string) { if (!validId(id))
    throw new HttpError(400, 'Invalid card id'); return path.join(dir, 'cards', `${id}.json`); }
export async function atomic(file: string, value: string | Buffer) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
        await writeFile(tmp, value);
        await rename(tmp, file);
    }
    finally {
        await rm(tmp, { force: true });
    }
}
export const lock = <T>(dir: string, fn: () => Promise<T>) => withFileLock(dir, fn);
export async function readBoard(dir: string): Promise<Board> {
    const raw = await readOptional(path.join(dir, 'board.json'));
    return raw ? JSON.parse(raw) : { id: 'main', rev: 0, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], tombstones: [], agent: null, lastSend: null };
}
export async function saveBoard(dir: string, board: Board) { board.rev++; await atomic(path.join(dir, 'board.json'), JSON.stringify(board)); }
export async function readCard(dir: string, id: string): Promise<Card> { const raw = await readOptional(cardFile(dir, id)); if (!raw)
    throw new HttpError(404, 'Card not found'); return JSON.parse(raw); }
export async function snapshot(dir: string): Promise<Snapshot> {
    const entries = await readdir(path.join(dir, 'cards')).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT')
        return []; throw e; });
    return { board: await readBoard(dir), cards: await Promise.all(entries.filter(f => f.endsWith('.json')).map(f => readCard(dir, f.slice(0, -5)))) };
}
export async function saveCard(dir: string, card: Card) { card.rev++; await atomic(cardFile(dir, card.id), JSON.stringify(card)); return card; }
export async function addCard(dir: string, input: Partial<Card>, sourceId?: string, direction: 'right' | 'below' = 'right') {
    const { cards, board } = await snapshot(dir);
    const source = sourceId ? cards.find(c => c.id === sourceId) : undefined;
    if (sourceId && !source) throw new HttpError(404, 'Source card not found');
    if (input.id !== undefined && (!validId(input.id) || cards.some(c => c.id === input.id))) throw new HttpError(409, 'Card id unavailable');
    const width = input.width ?? (input.kind && input.kind !== 'doc' ? 420 : 900);
    const height = input.height ?? (!input.kind || input.kind === 'doc' ? estimateHeight(input.markdown ?? '', width) : 320);
    const positioned = input.x !== undefined && input.y !== undefined;
    const at = positioned ? { x: input.x!, y: input.y! } : placement(cards, source, width, direction, height);
    // Stacked only when it landed flush under the source; the client then keeps it there as the source's height changes.
    const below = source && !positioned && direction === 'below' && at.x === source.x && at.y === source.y + source.height + GAP ? source.id : undefined;
    const card: Card = { id: crypto.randomUUID(), rev: 0, kind: 'doc', title: 'Untitled', width, height, author: 'user', markdown: '', baselineMarkdown: '', comments: [], strokes: [], sentAt: null, ...input, ...at, ...(below ? { below } : {}) };
    await saveCard(dir, card);
    if (sourceId) {
        board.edges.push({ source: sourceId, target: card.id });
        await saveBoard(dir, board);
    }
    return card;
}
/** A hand edit to a chart keeps what the agent last saw, so the next send carries a diff; editing it back clears that. */
function trackChartEdit(before: Card, next: Card) {
    if (before.kind !== 'chart')
        throw new HttpError(400, 'Not a chart');
    const baseline = before.baselineChart ?? before.chart;
    if (!baseline || JSON.stringify(baseline) === JSON.stringify(next.chart))
        delete next.baselineChart;
    else
        next.baselineChart = baseline;
}
export async function patchCard(dir: string, id: string, baseRev: number, patch: Partial<Card>) {
    return lock(dir, async () => { const card = await readCard(dir, id); if (card.rev !== baseRev && !Object.keys(patch).every(k => GEOMETRY.has(k)))
        throw new HttpError(409, 'Card changed. Reload before saving; local changes are preserved.'); const next = { ...card, ...patch }; if (patch.chart !== undefined)
        trackChartEdit(card, next); if (patch.markdown !== undefined)
        next.comments = reanchor(next.markdown, next.comments); return saveCard(dir, next); });
}
export async function assetBytes(dir: string, card: Card) { if (!card.asset || path.basename(card.asset) !== card.asset)
    throw new HttpError(404, 'Image missing'); return readFile(path.join(dir, 'assets', card.asset)); }
