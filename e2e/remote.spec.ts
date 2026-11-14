import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Card } from '../lib/board/types';
import { box, card, doc, drag, focus, grip, inFocus, newBoard, openCanvas, recordSaves, remoteAdd, remoteEdit, seed, settled, stored, widthHandle, type Board } from './canvas';

/**
 * Edits that land while a gesture is held, the way an agent's board_op does: the card being dragged doesn't
 * jump, the drop still lands where the pointer let go, and nothing remote is lost.
 */

const GAP = 48;
const serverCard = async (request: APIRequestContext, board: Board, id: string) =>
    ((await (await request.get(board.api)).json()).cards as Card[]).find(c => c.id === id) ?? null;
/** Lets a merged change render before measuring. */
const frame = (page: Page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

test('the agent moving the card being dragged: no jump, and the drop wins', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a] = seed(board, [doc('Alpha', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    const start = (await stored(page, a.id))!, from = await grip(page, a.id);
    await drag(page, from, { x: from.x + 240, y: from.y + 80 }, async () => {
        const mid = await box(page, a.id);
        await remoteEdit(page, request, board, a.id, { x: 900, y: 600 });
        await frame(page);
        const after = await box(page, a.id);
        expect(after.x).toBeCloseTo(mid.x, 0);
        expect(after.y).toBeCloseTo(mid.y, 0);
    });
    await settled(page);
    expect(await stored(page, a.id)).toMatchObject({ x: start.x + 240, y: start.y + 80 });
    expect(await serverCard(request, board, a.id)).toMatchObject({ x: start.x + 240, y: start.y + 80 });
});

test('the agent editing the text of the card being dragged: the text lands, and so does the drop', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a] = seed(board, [doc('Alpha', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    const start = (await stored(page, a.id))!, from = await grip(page, a.id);
    await drag(page, from, { x: from.x + 200, y: from.y + 40 }, async () => {
        const mid = await box(page, a.id);
        await remoteEdit(page, request, board, a.id, { markdown: '# Alpha\n\nRewritten by the agent.' });
        await expect(card(page, a.id)).toContainText('Rewritten by the agent.');
        const after = await box(page, a.id);
        expect(after.x).toBeCloseTo(mid.x, 0);
        expect(after.y).toBeCloseTo(mid.y, 0);
    });
    await settled(page);
    const saved = await serverCard(request, board, a.id);
    expect(saved).toMatchObject({ x: start.x + 200, y: start.y + 40 });
    expect(saved!.markdown).toContain('Rewritten by the agent.');
    await expect(page.locator('[role=alert]').filter({ hasText: /changed|not found|failed/i })).toHaveCount(0);
});

test('the card above a dragged stacked card growing: the dragged card lands where it was dropped', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a] = seed(board, [doc('Alpha', { x: 200, y: 100 })]);
    const [b] = seed(board, [doc('Beta', { x: 200, y: 100 + 70 + GAP, below: a.id })]);
    await openCanvas(page, board, 2);
    await settled(page);
    const start = (await stored(page, b.id))!, from = await grip(page, b.id);
    await drag(page, from, { x: from.x + 400, y: from.y + 20 }, async () => {
        const mid = await box(page, b.id);
        await remoteEdit(page, request, board, a.id, { markdown: '# Alpha\n\n' + Array.from({ length: 6 }, (_, i) => `Agent line ${i}.`).join('\n\n') });
        await expect(card(page, a.id)).toContainText('Agent line 5.');
        await page.waitForTimeout(150); // the new height is measured and the stack settles
        const after = await box(page, b.id);
        expect(after.y).toBeCloseTo(mid.y, 0);
    });
    await settled(page);
    expect(await stored(page, b.id)).toMatchObject({ x: start.x + 400, y: start.y + 20, below: null });
});

test('the agent adding a card under the one being dragged: it joins the stack where the drop lands', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a] = seed(board, [doc('Alpha', { x: 200, y: 100 })]);
    await openCanvas(page, board, 1);
    const from = await grip(page, a.id);
    let added: Card | undefined;
    await drag(page, from, { x: from.x + 300, y: from.y + 100 }, async () => {
        const at = (await stored(page, a.id))!;
        added = await remoteAdd(page, board, doc('Reply', { x: at.x, y: at.y + at.height + GAP, below: a.id, author: 'agent' }));
        await expect(page.locator('[data-card]')).toHaveCount(2);
    });
    await settled(page);
    const [top, child] = [await stored(page, a.id), await stored(page, added!.id)];
    expect(child).toMatchObject({ below: a.id, x: top!.x, y: top!.y + top!.height + GAP });
});

test('the dragged card going away mid-drag: the drop is quiet', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a, b] = seed(board, [doc('Alpha', { x: 200, y: 150 }), doc('Beta', { x: 200, y: 400 })]);
    await openCanvas(page, board, 2);
    const saves = recordSaves(page), errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    const from = await grip(page, a.id);
    await drag(page, from, { x: from.x + 200, y: from.y + 50 }, async () => {
        const rev = (await serverCard(request, board, a.id))!.rev;
        expect((await request.delete(`${board.api}/cards/${a.id}`, { data: { baseRev: rev } })).ok()).toBe(true);
        // What a reload brings in: the card is gone from the board.
        await page.evaluate(id => (window as never as { __thunkBoard: { getState: () => { discard: (id: string) => void } } }).__thunkBoard.getState().discard(id), a.id);
        await expect(page.locator('[data-card]')).toHaveCount(1);
    });
    await settled(page);
    expect(saves.of(a.id)).toHaveLength(0);
    expect(errors).toEqual([]);
    await expect(page.locator('[role=alert]').filter({ hasText: /not found|failed|error/i })).toHaveCount(0);
    void b;
});

test('the agent editing a card while its width is dragged: both land', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a] = seed(board, [doc('Alpha', { x: 200, y: 150, width: 500 })]);
    await openCanvas(page, board, 1);
    const from = await widthHandle(page, a.id);
    await drag(page, from, { x: from.x - 150, y: from.y }, async () => {
        await remoteEdit(page, request, board, a.id, { markdown: '# Alpha\n\nThe agent was here.' });
        await expect(card(page, a.id)).toContainText('The agent was here.');
        expect((await box(page, a.id)).width).toBeCloseTo(350, 0);
    });
    await settled(page);
    const saved = await serverCard(request, board, a.id);
    expect(saved).toMatchObject({ width: 350 });
    expect(saved!.markdown).toContain('The agent was here.');
});

test('a card the agent adds inside the outline while it is resized joins the focus', async ({ page, request }) => {
    const board = await newBoard(request);
    const cards = seed(board, [doc('Alpha', { x: 200, y: 150, width: 300 }), doc('Beta', { x: 560, y: 150, width: 300 })]);
    await openCanvas(page, board, 2);
    await card(page, cards[0].id).click();
    await page.keyboard.press('Escape');
    await expect.poll(() => inFocus(page)).toBe(2);
    const s = (await page.locator('div[data-resize-handle="s"]').boundingBox())!;
    await drag(page, { x: s.x + s.width / 2, y: s.y + 6 }, { x: s.x + s.width / 2, y: s.y + 400 }, async () => {
        await remoteAdd(page, board, doc('Reply', { x: 300, y: 330, width: 300, author: 'agent' }));
        await expect(page.locator('[data-card]')).toHaveCount(3);
    });
    await expect.poll(() => inFocus(page)).toBe(3);
    expect((await focus(page)).fixed).toBe(true);
});

test.fail('a Shift-drag selection hits a card where the agent moved it mid-drag', async ({ page, request }) => {
    // Known: the UI SDK lasso measures cards when the press starts, so a card moved during the drag is
    // hit-tested where it was. Low impact: a selection drag lasts a second or two. Fails until the SDK re-measures.
    const board = await newBoard(request);
    const [a, b] = seed(board, [doc('Alpha', { x: 200, y: 150 }), doc('Beta', { x: 200, y: 500 })]);
    await openCanvas(page, board, 2);
    const ab = await box(page, a.id);
    await page.keyboard.down('Shift');
    await drag(page, { x: ab.x + ab.width + 60, y: ab.y - 30 }, { x: ab.x + ab.width + 200, y: ab.y + 60 }, async () => {
        // Moved right under the rectangle being drawn.
        await remoteEdit(page, request, board, b.id, { x: 200 + ab.width + 80, y: 150 });
        await frame(page);
    });
    await page.keyboard.up('Shift');
    await expect.poll(async () => (await focus(page)).add).toContain(b.id);
});
