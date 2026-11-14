import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { barChart, box, card, doc, focus, newBoard, openCanvas, seed, settled, stored, view } from './canvas';

/** Touch: one finger pans, two pinch, a tap writes or picks a card, and a picked card shows its controls. */

test.use({ hasTouch: true });

type P = { x: number; y: number };
/** Raw touches, so two fingers can move at once (Playwright's touchscreen only taps). */
async function touches(page: Page) {
    const cdp: CDPSession = await page.context().newCDPSession(page);
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: P[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });
    return {
        /** Moves each finger from its start to its end in `steps`. */
        async gesture(from: P[], to: P[], steps = 12) {
            await send('touchStart', from);
            for (let i = 1; i <= steps; i++)
                await send('touchMove', from.map((f, k) => ({ x: f.x + (to[k].x - f.x) * i / steps, y: f.y + (to[k].y - f.y) * i / steps })));
            await send('touchEnd', []);
            await page.waitForTimeout(100);
        },
    };
}

/** Where a screen point is on the canvas. */
async function canvasPoint(page: Page, p: P) {
    const root = (await page.locator('[aria-label="Canvas"][tabindex="0"]').boundingBox())!, v = await view(page);
    return { x: (p.x - root.x - v.x) / v.zoom, y: (p.y - root.y - v.y) / v.zoom };
}

test('one finger on empty canvas pans it', async ({ page, request }) => {
    const board = await newBoard(request);
    seed(board, [doc('Alpha', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    const t = await touches(page), before = await view(page);
    await t.gesture([{ x: 900, y: 700 }], [{ x: 780, y: 640 }]);
    const after = await view(page);
    expect(after.x - before.x).toBeCloseTo(-120, 0);
    expect(after.y - before.y).toBeCloseTo(-60, 0);
    expect(after.zoom).toBe(before.zoom);
    // A pan is not a tap: nothing was written.
    await expect(page.locator('[data-card]')).toHaveCount(1);
});

test('two fingers pinch about their midpoint and stop at 20% and 200%', async ({ page, request }) => {
    const board = await newBoard(request);
    seed(board, [doc('Alpha', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    const t = await touches(page);
    const mid = { x: 800, y: 600 }, anchor = await canvasPoint(page, mid);
    await t.gesture([{ x: 750, y: 600 }, { x: 850, y: 600 }], [{ x: 700, y: 600 }, { x: 900, y: 600 }]);
    const zoomed = await view(page);
    expect(zoomed.zoom).toBeCloseTo(2, 1);
    // The canvas point between the fingers stayed between them.
    const still = await canvasPoint(page, mid);
    expect(still.x).toBeCloseTo(anchor.x, 0);
    expect(still.y).toBeCloseTo(anchor.y, 0);

    await t.gesture([{ x: 600, y: 600 }, { x: 1000, y: 600 }], [{ x: 790, y: 600 }, { x: 810, y: 600 }]);
    expect((await view(page)).zoom).toBeCloseTo(.2, 2);
    await t.gesture([{ x: 790, y: 600 }, { x: 810, y: 600 }], [{ x: 200, y: 600 }, { x: 1300, y: 600 }]);
    expect((await view(page)).zoom).toBe(2);
});

test('a tap on empty canvas starts a text block; a tap on a card picks it', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a] = seed(board, [doc('Alpha', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    await page.touchscreen.tap(900, 700);
    await expect(page.locator('[data-card]')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.isContentEditable ?? false)).toBe(true);
    const b = await box(page, a.id);
    await page.touchscreen.tap(b.x + 60, b.y + b.height / 2);
    await expect.poll(async () => (await focus(page)).anchorId).toBe(a.id);
});

test('on a touch screen the picked card shows its grip, actions and width handle, and they work', async ({ page, request }) => {
    const board = await newBoard(request);
    const [c] = seed(board, [barChart('Checks', { x: 200, y: 160 })]);
    await openCanvas(page, board, 1);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const grip = card(page, c.id).getByRole('button', { name: /^Move / });
    const opacity = () => grip.evaluate(e => Number(getComputedStyle(e).opacity));
    expect(await opacity()).toBe(0);
    const b = await box(page, c.id);
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await expect.poll(async () => (await focus(page)).anchorId).toBe(c.id);
    await expect.poll(opacity).toBe(1);
    await expect(card(page, c.id).getByRole('toolbar')).toBeVisible();
    expect(await card(page, c.id).getByRole('toolbar').evaluate(e => Number(getComputedStyle(e).opacity))).toBe(1);
    expect(await card(page, c.id).getByRole('button', { name: /^Resize / }).evaluate(e => Number(getComputedStyle(e).opacity))).toBe(1);

    // Drag it by the grip with a finger.
    const g = (await grip.boundingBox())!, t = await touches(page);
    const from = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    await t.gesture([from], [{ x: from.x + 200, y: from.y + 100 }]);
    await settled(page);
    expect(await stored(page, c.id)).toMatchObject({ x: 400, y: 260 });
});
