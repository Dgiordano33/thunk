import { expect, test, type Page } from '@playwright/test';
import { barChart, box, card, doc, drag, newBoard, openCanvas, pngSize, seed, settled, startAt, stored, uploadImage, view, widthHandle } from './canvas';

/** Chart and image cards: width changes, the Pin / Draw / Data tools, Refresh, and sending them as pictures. */

const toolbar = (page: Page, id: string) => card(page, id).getByRole('toolbar');
const plot = (page: Page, id: string) => card(page, id).locator('svg[data-plot]');

/** Bars of a single-series bar chart, left to right. */
async function bars(page: Page, id: string) {
    const all = await plot(page, id).locator('path').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    return all.filter(r => r.width > 8 && r.height > 4).sort((a, b) => a.x - b.x);
}

test('a chart follows its width while the handle is dragged, then lays out again on release', async ({ page, request }) => {
    const board = await newBoard(request);
    const [c] = seed(board, [barChart('Checks', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    const from = await widthHandle(page, c.id);
    await drag(page, from, { x: from.x - 160, y: from.y }, async () => {
        const [k, p] = [await box(page, c.id), await plot(page, c.id).boundingBox()];
        // Mid-drag the plot scales with the card instead of being clipped by it.
        expect(Math.abs(p!.width - (k.width - 2))).toBeLessThan(3);
    });
    await settled(page);
    expect((await stored(page, c.id))!.width).toBe(360);
    await expect(plot(page, c.id)).toHaveAttribute('width', '358');
});

for (const zoom of [0.5, 1, 2]) {
    test(`a pin on an image lands where it was clicked at ${zoom * 100}% and stays there as the width changes`, async ({ page, request }) => {
        const board = await newBoard(request);
        await startAt(request, board, { x: 40, y: 40, zoom });
        const img = await uploadImage(request, board, { x: 100, y: 100 });
        await openCanvas(page, board, 1);
        const image = card(page, img.id).locator('img');
        await card(page, img.id).hover();
        await toolbar(page, img.id).getByRole('button', { name: 'Pin' }).click();
        await expect(toolbar(page, img.id).getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true');
        const r = (await image.boundingBox())!;
        await page.mouse.click(r.x + r.width * .25, r.y + r.height * .75);
        await card(page, img.id).getByRole('textbox').fill('Look here');
        await card(page, img.id).getByRole('textbox').press('Enter');
        await settled(page);
        const pin = (await stored(page, img.id))!.comments[0];
        expect(pin.x).toBeCloseTo(.25, 2);
        expect(pin.y).toBeCloseTo(.75, 2);

        // Ink, then a wider card: both stay on the same spot of the picture.
        await toolbar(page, img.id).getByRole('button', { name: 'Draw' }).click();
        await drag(page, { x: r.x + r.width * .5, y: r.y + r.height * .2 }, { x: r.x + r.width * .7, y: r.y + r.height * .4 });
        await settled(page);
        const stroke = (await stored(page, img.id))!.strokes[0];
        expect(stroke.points[0].x).toBeCloseTo(.5, 1);
        expect(stroke.points.at(-1)!.y).toBeCloseTo(.4, 1);
        const handle = await widthHandle(page, img.id);
        await drag(page, handle, { x: handle.x + 120 * zoom, y: handle.y });
        await settled(page);
        const after = (await image.boundingBox())!;
        expect(after.width).toBeGreaterThan(r.width + 100 * zoom);
        const dot = (await card(page, img.id).locator('svg[viewBox="0 0 1 1"] circle').first().boundingBox())!;
        expect((dot.x + dot.width / 2 - after.x) / after.width).toBeCloseTo(.25, 2);
        expect((dot.y + dot.height / 2 - after.y) / after.height).toBeCloseTo(.75, 2);
    });
}

test('a pin on a chart anchors to the bar it was dropped on', async ({ page, request }) => {
    const board = await newBoard(request);
    const [c] = seed(board, [barChart('Checks', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    await card(page, c.id).hover();
    await toolbar(page, c.id).getByRole('button', { name: 'Pin' }).click();
    const feb = (await bars(page, c.id))[1];
    await page.mouse.move(feb.x + feb.width / 2, feb.y + 4);
    await page.mouse.down();
    await page.mouse.up();
    await card(page, c.id).getByRole('textbox').fill('Why the jump?');
    await card(page, c.id).getByRole('textbox').press('Enter');
    await settled(page);
    expect((await stored(page, c.id))!.comments[0].anchor).toMatchObject({ x: 'Feb', series: 'checks' });
    // The Pin tool turns itself off once placed.
    await expect(toolbar(page, c.id).getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'false');
});

test('the wheel over a chart’s data table scrolls the table, not the canvas', async ({ page, request }) => {
    const board = await newBoard(request);
    const rows = Array.from({ length: 40 }, (_, i) => ({ day: `D${i + 1}`, checks: i * 3 }));
    const [c] = seed(board, [{ ...barChart('Daily', { x: 200, y: 60 }), chart: { type: 'bar', x: 'day', series: [{ key: 'checks' }], rows } }]);
    await openCanvas(page, board, 1);
    await card(page, c.id).hover();
    await toolbar(page, c.id).getByRole('button', { name: 'Data' }).click();
    const pane = card(page, c.id).locator('[data-scroll]').first();
    await expect(pane).toBeVisible();
    const before = await view(page);
    await pane.hover();
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(200);
    expect(await pane.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
    expect(await view(page)).toEqual(before);
});

test('Refresh asks once, next to its button, and the question follows the canvas when it pans', async ({ page, request }) => {
    const board = await newBoard(request);
    await startAt(request, board, { x: 0, y: 0, zoom: 1.5 });
    const [c] = seed(board, [{ ...barChart('Checks', { x: 120, y: 120 }), chartSource: { command: 'echo \'{"rows":[]}\'' } }]);
    await openCanvas(page, board, 1);
    await card(page, c.id).hover();
    const refresh = toolbar(page, c.id).getByRole('button', { name: 'Refresh' });
    await refresh.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`echo '{"rows":[]}'`);
    const near = async () => {
        const [b, d] = [(await refresh.boundingBox())!, (await dialog.boundingBox())!];
        expect(Math.abs(d.y - (b.y + b.height))).toBeLessThan(16);
        expect(Math.abs(d.x + d.width - (b.x + b.width))).toBeLessThan(16);
    };
    await near();
    // Panning with the question open: it either closes or stays anchored to the button, never floats off.
    await page.mouse.move(1200, 820);
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(300);
    if (await dialog.isVisible()) await near();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
});

test('sending flattens a resized chart and an image to pictures of what is on screen', async ({ page, request }) => {
    const board = await newBoard(request);
    const img = await uploadImage(request, board, { x: 100, y: 500 }, 400, 300);
    const [c] = seed(board, [{ ...barChart('Checks', { x: 100, y: 80 }), strokes: [{ id: 's1', points: [{ x: .1, y: .1 }, { x: .4, y: .5 }], sentAt: null }] }]);
    await openCanvas(page, board, 2);
    const handle = await widthHandle(page, c.id);
    await drag(page, handle, { x: handle.x + 200, y: handle.y });
    await settled(page);
    const shown = (await plot(page, c.id).boundingBox())!;
    const pictures: Record<string, { width: number; height: number } | null> = {};
    page.on('request', r => {
        const m = r.url().match(/\/cards\/([^/]+)\/annotated$/);
        if (m && r.method() === 'PUT') pictures[m[1]] = pngSize(r.postDataBuffer() ?? Buffer.alloc(0));
    });
    // The send itself would start an agent; answer it here instead.
    await page.route('**/board/send', route => route.fulfill({ json: { sessionId: '', sent: false, held: 0 } }));
    await page.getByRole('button', { name: /^Send all/ }).click();
    await expect.poll(() => Object.keys(pictures).length).toBe(2);
    await expect(page.locator('[role=alert]').filter({ hasText: /failed|error|could not/i })).toHaveCount(0);
    expect(pictures[img.id]).toEqual({ width: 400, height: 300 });
    const chart = pictures[c.id]!;
    expect(chart.width / chart.height).toBeCloseTo(shown.width / shown.height, 1);
});

test('drawings and prompt chips have no width handle; text, image and chart cards do', async ({ page, request }) => {
    const board = await newBoard(request);
    const img = await uploadImage(request, board, { x: 600, y: 100 });
    const [d, p, t, c] = seed(board, [
        { kind: 'drawing', title: 'Drawing', x: 100, y: 100, width: 200, height: 120, strokes: [{ id: 's', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], sentAt: null }] },
        { prompt: true, title: 'Prompt', markdown: 'What changed?', x: 100, y: 300, width: 300, height: 36 },
        doc('Text', { x: 100, y: 400 }),
        barChart('Chart', { x: 1100, y: 100 }),
    ]);
    await openCanvas(page, board, 5);
    for (const [id, n] of [[d.id, 0], [p.id, 0], [t.id, 1], [img.id, 1], [c.id, 1]] as const)
        await expect(card(page, id).getByRole('button', { name: /^Resize / }), id).toHaveCount(n);
});
