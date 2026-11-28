import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Card } from '../lib/board/types';

/** Helpers for driving the Canvas in a browser: a fresh board per test, seeded cards, and what the page saved. */

export type Board = { projectId: string; slug: string; name: string; dir: string; api: string };
type Seed = Partial<Card> & Pick<Card, 'x' | 'y'>;

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
    return { projectId: project.id, slug: project.slug, name: project.name, dir: path.join(DATA(), 'projects', project.dataKey, 'boards', 'main'), api: `/api/projects/${project.id}/board` };
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

/** Opens the board's canvas and waits until its cards are on screen and their heights have settled. */
export async function openCanvas(page: Page, board: Board, cards: number, path = `/${board.slug}/canvas`) {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(path);
    await expect(page.locator('[data-card]')).toHaveCount(cards);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    return { errors };
}

export const card = (page: Page, id: string) => page.locator(`[data-card][data-id="${id}"]`);

/** The board's project's Canvas group in the sidebar. */
export const sidebarCanvases = (page: Page, board: Board) => page.getByRole('group', { name: `${board.name} canvases`, exact: true });
