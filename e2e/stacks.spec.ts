import { expect, test } from '@playwright/test';
import { box, card, doc, drag, grip, newBoard, openCanvas, recordSaves, seed, settled, stored } from './canvas';

/** Cards stacked with `below` move with the card above them, and a hand move unstacks only the card moved. */

const GAP = 48;

async function stackOfThree(request: Parameters<typeof newBoard>[0]) {
    const board = await newBoard(request);
    const [a] = seed(board, [doc('Alpha', { x: 200, y: 100 })]);
    const [b] = seed(board, [doc('Beta', { x: 200, y: 100 + 70 + GAP, below: a.id })]);
    const [c] = seed(board, [doc('Gamma', { x: 200, y: 100 + 2 * (70 + GAP), below: b.id })]);
    return { board, a, b, c };
}

/** Each card sits flush under its source, GAP apart. */
async function expectStacked(page: Parameters<typeof box>[0], ids: string[]) {
    for (let i = 1; i < ids.length; i++) {
        const above = await stored(page, ids[i - 1]), below = await stored(page, ids[i]);
        expect(below!.below).toBe(ids[i - 1]);
        expect(below!.x).toBe(above!.x);
        expect(below!.y).toBe(above!.y + above!.height + GAP);
    }
}

test('dragging the top of a stack carries the whole stack, live and on drop', async ({ page, request }) => {
    const { board, a, b, c } = await stackOfThree(request);
    await openCanvas(page, board, 3);
    await settled(page);
    await expectStacked(page, [a.id, b.id, c.id]);
    const saves = recordSaves(page);
    const before = await Promise.all([a, b, c].map(x => box(page, x.id)));
    const from = await grip(page, a.id);
    await drag(page, from, { x: from.x + 300, y: from.y + 60 }, async () => {
        // Mid-drag the children follow by the same offset, before anything is saved.
        const mid = await Promise.all([a, b, c].map(x => box(page, x.id)));
        for (let i = 0; i < 3; i++) {
            expect(mid[i].x - before[i].x).toBeCloseTo(300, 0);
            expect(mid[i].y - before[i].y).toBeCloseTo(60, 0);
        }
        expect(saves.all).toHaveLength(0);
    });
    await settled(page);
    await expectStacked(page, [a.id, b.id, c.id]);
    expect((await stored(page, a.id))!.below ?? null).toBeNull();
    // One save per moved card, and the stack stays put afterwards: no save ping-pong.
    for (const id of [a.id, b.id, c.id]) expect(saves.of(id)).toHaveLength(1);
    saves.clear();
    await page.waitForTimeout(1500);
    expect(saves.all).toHaveLength(0);
});

test('dragging a middle card out unstacks it and takes its own children along', async ({ page, request }) => {
    const { board, a, b, c } = await stackOfThree(request);
    await openCanvas(page, board, 3);
    await settled(page);
    const aBefore = await stored(page, a.id);
    const from = await grip(page, b.id);
    await drag(page, from, { x: from.x + 500, y: from.y + 40 });
    await settled(page);
    expect((await stored(page, b.id))!.below ?? null).toBeNull();
    await expectStacked(page, [b.id, c.id]);
    // The card above didn't move, and nothing is stacked under it now.
    const aAfter = await stored(page, a.id);
    expect({ x: aAfter!.x, y: aAfter!.y }).toEqual({ x: aBefore!.x, y: aBefore!.y });
    const b2 = await stored(page, b.id);
    expect(b2!.x).toBe(aBefore!.x + 500);
});

test('arrow keys on a stacked card’s grip unstack it and nudge it with its children', async ({ page, request }) => {
    const { board, a, b, c } = await stackOfThree(request);
    await openCanvas(page, board, 3);
    await settled(page);
    const start = await stored(page, b.id);
    await card(page, b.id).getByRole('button', { name: /^Move / }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await settled(page);
    const moved = await stored(page, b.id);
    expect({ x: moved!.x, y: moved!.y }).toEqual({ x: start!.x + 10, y: start!.y + 50 });
    expect(moved!.below ?? null).toBeNull();
    await expectStacked(page, [b.id, c.id]);
    void a;
});

test('a stack follows its parent growing as it is typed into', async ({ page, request }) => {
    const { board, a, b, c } = await stackOfThree(request);
    await openCanvas(page, board, 3);
    await settled(page);
    const before = await stored(page, a.id);
    const editor = card(page, a.id).locator('[contenteditable="true"]');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.keyboard.type(`More text ${i}`); }
    await settled(page);
    const after = await stored(page, a.id);
    expect(after!.height).toBeGreaterThan(before!.height + 40);
    await expectStacked(page, [a.id, b.id, c.id]);
    // What the store says matches the screen.
    const [ab, bb] = [await box(page, a.id), await box(page, b.id)];
    expect(bb.y).toBeCloseTo(ab.y + ab.height + GAP, 0);
});
