import { expect, test, type Page } from '@playwright/test';
import { box, card, doc, drag, focus, inFocus, newBoard, openCanvas, seed, settled, startAt } from './canvas';

/** The focus outline's eight handles redefine the focus as what sits inside it. */

const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
const handle = (page: Page, h: (typeof HANDLES)[number]) => page.locator(`div[data-resize-handle="${h}"]`);
async function centre(page: Page, h: (typeof HANDLES)[number]) {
    const b = (await handle(page, h).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Three text cards close enough to form one cluster, and the first anchored: all three are in focus. */
async function cluster(page: Page, request: Parameters<typeof newBoard>[0], zoom = 1) {
    const board = await newBoard(request);
    if (zoom !== 1) await startAt(request, board, { x: 40, y: 40, zoom });
    const cards = seed(board, [doc('Alpha', { x: 200, y: 150, width: 300 }), doc('Beta', { x: 560, y: 150, width: 300 }), doc('Gamma', { x: 920, y: 150, width: 300 })]);
    await openCanvas(page, board, 3);
    await card(page, cards[0].id).click();
    await page.keyboard.press('Escape'); // leave the editor; the focus stays
    await expect.poll(() => inFocus(page)).toBe(3);
    return { board, cards };
}

for (const zoom of [0.5, 1, 2]) {
    test(`the outline's handles stay 12px on screen at ${zoom * 100}%`, async ({ page, request }) => {
        await cluster(page, request, zoom);
        for (const h of HANDLES) {
            const b = (await handle(page, h).boundingBox())!;
            if (h.length === 2) { expect(b.width, h).toBeCloseTo(12, 0); expect(b.height, h).toBeCloseTo(12, 0); }
            else expect('ns'.includes(h) ? b.height : b.width, h).toBeCloseTo(12, 0);
        }
    });
}

test('dragging an edge past a card’s middle takes it out of the focus; past the anchor drops the anchor', async ({ page, request }) => {
    const { cards: [a, b, c] } = await cluster(page, request);
    const [cb, ab] = [await box(page, c.id), await box(page, a.id)];
    const e = await centre(page, 'e');
    await drag(page, e, { x: cb.x + cb.width / 2 - 20, y: e.y });
    await expect.poll(() => inFocus(page)).toBe(2);
    let f = await focus(page);
    expect(f.fixed).toBe(true);
    expect(f.anchorId).toBe(a.id);
    const w = await centre(page, 'w');
    await drag(page, w, { x: ab.x + ab.width / 2 + 20, y: w.y });
    await expect.poll(() => inFocus(page)).toBe(1);
    f = await focus(page);
    expect(f.anchorId).toBeNull();
    // What is left is the card whose middle is inside.
    await expect(page.locator('footer')).toContainText('1 in focus');
    void b;
});

test('the outline never shrinks below 40 canvas units', async ({ page, request }) => {
    await cluster(page, request);
    const se = await centre(page, 'se'), nw = await centre(page, 'nw');
    await drag(page, se, { x: nw.x - 200, y: nw.y - 200 });
    await settled(page);
    const f = await focus(page);
    expect(f.rect!.width).toBe(40);
    expect(f.rect!.height).toBe(40);
});

test('Escape mid-drag puts the outline back and keeps the focus', async ({ page, request }) => {
    const { cards } = await cluster(page, request);
    const before = await focus(page);
    const e = await centre(page, 'e');
    await drag(page, e, { x: e.x - 500, y: e.y }, async () => {
        await page.keyboard.press('Escape');
    });
    await page.waitForTimeout(200);
    expect(await inFocus(page)).toBe(3);
    const after = await focus(page);
    expect(after.anchorId).toBe(cards[0].id);
    expect(after.fixed).toBe(before.fixed);
});

test('Shift keeps the outline’s proportions while a corner is dragged', async ({ page, request }) => {
    await cluster(page, request);
    const before = (await page.locator('div:has(> div[data-resize-handle="se"])').boundingBox())!;
    const se = await centre(page, 'se');
    await page.keyboard.down('Shift');
    await drag(page, se, { x: se.x - 300, y: se.y + 10 });
    await page.keyboard.up('Shift');
    await settled(page);
    const r = (await focus(page)).rect!;
    expect(r.width / r.height).toBeCloseTo(before.width / before.height, 1);
});

test('resizing with the ask bar open keeps what was typed, and a drop over the pill doesn’t click it', async ({ page, request }) => {
    const { cards: [, , c] } = await cluster(page, request);
    await page.locator('[aria-label="Canvas"][tabindex="0"]').focus();
    await page.keyboard.press('ControlOrMeta+Enter');
    const ask = page.getByRole('textbox', { name: /^Ask about/ });
    await expect(ask).toBeVisible();
    await ask.fill('compare these');
    const e = await centre(page, 'e');
    const cb = await box(page, c.id);
    await drag(page, e, { x: cb.x + cb.width / 2 - 20, y: e.y }, async () => {
        await expect(ask).toBeHidden(); // tucked away while the outline moves
    });
    await expect(ask).toHaveValue('compare these');
    await expect.poll(() => inFocus(page)).toBe(2);

    // Close the bar, then end a drag of the bottom edge right on the "N items" pill.
    await ask.press('Escape');
    const pill = page.getByRole('button', { name: /items · ⌘↵$/ });
    await expect(pill).toBeVisible();
    const p = (await pill.boundingBox())!, s = await centre(page, 's');
    await drag(page, s, { x: p.x + p.width / 2, y: p.y + p.height / 2 });
    await page.waitForTimeout(200);
    await expect(ask).toBeHidden();
});
