import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Card } from '../lib/board/types';

/** Helpers for driving the Canvas in a browser: a fresh board per test, seeded cards, and what the page saved. */

export type Board = { projectId: string; slug: string; dir: string; api: string };
type Seed = Partial<Card> & Pick<Card, 'x' | 'y'>;
export type Box = { x: number; y: number; width: number; height: number };

const DATA = () => {
    const dir = process.env.THUNK_E2E_DATA;
    if (!dir) throw new Error('THUNK_E2E_DATA is unset; run through `npm run test:e2e`.');
    return dir;
};

let made = 0;
/** A new in-memory project with an empty board. */
export async function newBoard(request: APIRequestContext): Promise<Board> {
    const res = await request.post('/api/projects', { data: { name: `Canvas ${Date.now().toString(36)} ${++made}`, repos: [] } });
    expect(res.ok(), await res.text()).toBe(true);
    const { project } = await res.json();
    return { projectId: project.id, slug: project.slug, dir: path.join(DATA(), 'projects', project.dataKey, 'boards', 'main'), api: `/api/projects/${project.id}/board` };
}

/** Writes cards straight into the board's files, for kinds and layouts the API only lets the agent make (charts, stacks). */
export function seed(board: Board, cards: Seed[], edges: { source: string; target: string }[] = []): Card[] {
    mkdirSync(path.join(board.dir, 'cards'), { recursive: true });
    const out = cards.map(c => ({
        id: crypto.randomUUID(), rev: 1, kind: 'doc' as const, title: 'Untitled', width: 420, height: c.kind === 'doc' || !c.kind ? 70 : 320,
        author: 'user' as const, markdown: '', baselineMarkdown: '', comments: [], strokes: [], sentAt: null, ...c,
    }));
    for (const c of out) writeFileSync(path.join(board.dir, 'cards', `${c.id}.json`), JSON.stringify(c));
    if (edges.length)
        writeFileSync(path.join(board.dir, 'board.json'), JSON.stringify({ id: 'main', rev: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges, tombstones: [], agent: null, lastSend: null }));
    return out;
}

/** A text card, `lines` paragraphs tall. */
export const doc = (title: string, at: Pick<Card, 'x' | 'y'> & Partial<Card>, lines = 1): Seed => ({
    title, markdown: `# ${title}\n\n${Array.from({ length: lines }, (_, i) => `Line ${i + 1} of ${title}.`).join('\n\n')}`, width: 420, ...at,
});

export const barChart = (title: string, at: Pick<Card, 'x' | 'y'> & Partial<Card>): Seed => ({
    kind: 'chart', title, author: 'agent', width: 520, height: 320, ...at,
    chart: { type: 'bar', x: 'month', series: [{ key: 'checks', label: 'Checks' }], rows: [{ month: 'Jan', checks: 12 }, { month: 'Feb', checks: 30 }, { month: 'Mar', checks: 22 }, { month: 'Apr', checks: 41 }] },
});

/** A solid PNG, `w` by `h`. */
export function png(w: number, h: number, rgb: [number, number, number] = [70, 120, 200]): Buffer {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

/** Uploads an image card through the API, as a drop would. */
export async function uploadImage(request: APIRequestContext, board: Board, at: { x: number; y: number }, w = 400, h = 300): Promise<Card> {
    const res = await request.post(`${board.api}/cards`, { multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: png(w, h) }, x: String(at.x), y: String(at.y) } });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()).card;
}

/** Every non-GET board request the page sends, from now on. */
export function recordSaves(page: Page) {
    const saves: { method: string; path: string; body: Record<string, unknown> }[] = [];
    page.on('request', r => {
        if (r.method() === 'GET' || !r.url().includes('/board')) return;
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(r.postData() ?? '{}'); } catch { /* multipart */ }
        saves.push({ method: r.method(), path: r.url().split('/board')[1] ?? '', body });
    });
    return {
        all: saves,
        clear: () => { saves.length = 0; },
        /** Saves of card `id` that touched geometry. */
        of: (id: string) => saves.filter(s => s.path === `/cards/${id}`),
    };
}

/** Opens the board's canvas and waits until its cards are on screen and their heights have settled. */
export async function openCanvas(page: Page, board: Board, cards: number) {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`/${board.slug}/canvas`);
    await expect(page.locator('[data-card]')).toHaveCount(cards);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    return { errors };
}

export const card = (page: Page, id: string) => page.locator(`[data-card][data-id="${id}"]`);
export async function box(page: Page, id: string): Promise<Box> {
    const b = await card(page, id).boundingBox();
    if (!b) throw new Error(`card ${id} is not on screen`);
    return b;
}

/** A card as the store has it now. */
export const stored = (page: Page, id: string) => page.evaluate(id => (window as never as Win).__thunkBoard.getState().cards.find(c => c.id === id) ?? null, id);
/** The focus as the store has it now. */
export const focus = (page: Page) => page.evaluate(() => (window as never as Win).__thunkBoard.getState().focus);
type Win = { __thunkBoard: { getState: () => { cards: Card[]; dirty: Record<string, Partial<Card>>; focus: { anchorId: string | null; add: string[]; remove: string[]; rect: Box | null; fixed?: boolean }; merge: (c: Card) => void } } };

/** The number in "N in focus" in the footer, or 0. */
export async function inFocus(page: Page) {
    const text = await page.locator('footer span').first().textContent();
    return Number(text?.match(/(\d+) in focus/)?.[1] ?? 0);
}

/**
 * An edit that lands from elsewhere, like an agent tool: saved on the server, then merged into the page the way a
 * board_op is. Use it while a gesture is held.
 */
export async function remoteEdit(page: Page, request: APIRequestContext, board: Board, id: string, patch: Partial<Card>) {
    const snap = await (await request.get(board.api)).json();
    const current = (snap.cards as Card[]).find(c => c.id === id);
    if (!current) throw new Error(`no card ${id}`);
    const res = await request.patch(`${board.api}/cards/${id}`, { data: { baseRev: current.rev, ...patch } });
    expect(res.ok(), await res.text()).toBe(true);
    const saved: Card = (await res.json()).card;
    await page.evaluate(c => (window as never as Win).__thunkBoard.getState().merge(c), saved);
    return saved;
}

/** A card added from elsewhere and merged in, like the agent answering with a new card. */
export async function remoteAdd(page: Page, board: Board, input: Seed) {
    const [c] = seed(board, [input]);
    await page.evaluate(c => (window as never as Win).__thunkBoard.getState().merge(c), c);
    return c;
}

/** The world transform: pan and zoom. */
export const view = (page: Page) => page.evaluate(() => {
    const w = document.querySelector('[data-card]')?.parentElement ?? document.querySelector('[aria-label="Canvas"] > div');
    const m = getComputedStyle(w!).transform.match(/matrix\(([^)]+)\)/)?.[1].split(',').map(Number) ?? [1, 0, 0, 1, 0, 0];
    return { zoom: m[0], x: m[4], y: m[5] };
});

/** Presses at `from`, moves to `to` in steps, and optionally runs `during` before letting go. */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, during?: () => Promise<void>) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + (to.x - from.x) / 4, from.y + (to.y - from.y) / 4, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.waitForTimeout(60);
    if (during) await during();
    await page.mouse.up();
}

/** The centre of the grip that moves card `id`; hovering the card first reveals it. */
export async function grip(page: Page, id: string) {
    await card(page, id).hover({ position: { x: 20, y: 10 } });
    const b = await card(page, id).getByRole('button', { name: /^Move / }).boundingBox();
    if (!b) throw new Error('no grip');
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** The centre of card `id`'s width handle. */
export async function widthHandle(page: Page, id: string) {
    await card(page, id).hover({ position: { x: 20, y: 10 } });
    const b = await card(page, id).getByRole('button', { name: /^Resize / }).boundingBox();
    if (!b) throw new Error('no width handle');
    return { x: b.x + b.width / 2, y: b.y + Math.min(20, b.height / 2) };
}

/** Waits out the save debounce, then until every unsaved edit has been saved. */
export async function settled(page: Page) {
    await page.waitForTimeout(700);
    await expect.poll(() => page.evaluate(() => Object.keys((window as never as Win).__thunkBoard.getState().dirty).length), { timeout: 10_000 }).toBe(0);
    await page.waitForTimeout(100);
}

/** Saves the board's viewport, so the canvas opens there. */
export async function startAt(request: APIRequestContext, board: Board, viewport: { x: number; y: number; zoom: number }) {
    const res = await request.patch(board.api, { data: { viewport } });
    expect(res.ok(), await res.text()).toBe(true);
}

/** Width and height from a PNG's header, found anywhere in `bytes` (like a multipart body). */
export function pngSize(bytes: Buffer) {
    const at = bytes.indexOf(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (at < 0) return null;
    return { width: bytes.readUInt32BE(at + 16), height: bytes.readUInt32BE(at + 20) };
}
