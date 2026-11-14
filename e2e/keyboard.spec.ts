import { expect, test, type Page } from '@playwright/test';
import { barChart, card, doc, focus, grip, newBoard, openCanvas, seed, settled, stored, uploadImage } from './canvas';

/** Keyboard: tab stops and arrows through the canvas controls, tooltips, Refresh, and keys that must not collide. */

const active = (page: Page) => page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    return e ? e.getAttribute('aria-label') || e.textContent?.trim() || e.tagName : null;
});
/** Whether the focused element shows a focus indicator: an outline or a ring. */
const ringed = (page: Page) => page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!);
    return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
});
const root = (page: Page) => page.locator('[aria-label="Canvas"][tabindex="0"]');

test('a card’s controls are three tab stops, the toolbar takes arrows, and each shows focus', async ({ page, request }) => {
    const board = await newBoard(request);
    const img = await uploadImage(request, board, { x: 200, y: 150 });
    await openCanvas(page, board, 1);
    await root(page).focus();
    expect(await ringed(page)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await active(page)).toBe('Move Image');
    expect(await ringed(page)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await active(page)).toBe('Pin');
    expect(await ringed(page)).toBe(true);
    await page.keyboard.press('ArrowRight');
    expect(await active(page)).toBe('Draw');
    await page.keyboard.press('Tab');
    expect(await active(page)).toBe('Resize Image');
    expect(await ringed(page)).toBe(true);
    await page.keyboard.press('Shift+Tab');
    // The toolbar remembers where you were in it.
    expect(await active(page)).toBe('Draw');
    void img;
});

test('arrows switch the tool, and so does D', async ({ page, request }) => {
    const board = await newBoard(request);
    seed(board, [doc('Alpha', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    await page.getByRole('radio', { name: 'Write' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Draw' })).toBeChecked();
    await root(page).focus();
    await page.keyboard.press('d');
    await expect(page.getByRole('radio', { name: 'Write' })).toBeChecked();
});

test('Space on the tool switch picks a tool instead of starting a pan', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a] = seed(board, [doc('Alpha', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    await page.getByRole('radio', { name: 'Draw' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('radio', { name: 'Draw' })).toBeChecked();
    await page.keyboard.press('d');
    // No pan is stuck on: a grip drag still moves the card.
    const start = (await stored(page, a.id))!, from = await grip(page, a.id);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + 100, from.y, { steps: 8 }); await page.mouse.up();
    await settled(page);
    expect((await stored(page, a.id))!.x).toBe(start.x + 100);
});

test('tooltips open on keyboard focus with their shortcut', async ({ page, request }) => {
    const board = await newBoard(request);
    seed(board, [doc('Alpha', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    // Tooltips open on keyboard focus, so arrive by keyboard rather than a click.
    await page.locator('[aria-label="Canvas"][tabindex="0"]').focus();
    await page.keyboard.press('Shift+Tab');
    await page.getByRole('button', { name: /^Send all/ }).focus();
    const tip = page.getByRole('tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Send every pending edit');
    await expect(tip.locator('kbd, [data-slot*="shortcut"]').first()).toHaveText(/(⌘|Ctrl).*(↩|↵|Enter)/);
});

test('Refresh opens with the keyboard, takes focus, and gives it back on Escape without dropping the focus', async ({ page, request }) => {
    const board = await newBoard(request);
    const [c] = seed(board, [{ ...barChart('Checks', { x: 200, y: 160 }), chartSource: { command: 'echo hi' } }]);
    await openCanvas(page, board, 1);
    await card(page, c.id).click({ position: { x: 10, y: 10 } });
    await expect.poll(async () => (await focus(page)).anchorId).toBe(c.id);
    const refresh = card(page, c.id).getByRole('button', { name: 'Refresh' });
    await refresh.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(d => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(refresh).toBeFocused();
    expect((await focus(page)).anchorId).toBe(c.id);
});

test('Escape closes a tooltip first, without leaving the Draw tool', async ({ page, request }) => {
    const board = await newBoard(request);
    seed(board, [doc('Alpha', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    await page.getByRole('radio', { name: 'Draw' }).focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: /^Send all/ }).focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toBeHidden();
    await expect(page.getByRole('radio', { name: 'Draw' })).toBeChecked();
});

test('Delete removes the picked card from the canvas, not from a header or footer control', async ({ page, request }) => {
    const board = await newBoard(request);
    const [c] = seed(board, [barChart('Checks', { x: 200, y: 160 })]);
    await openCanvas(page, board, 1);
    await card(page, c.id).click({ position: { x: 10, y: 10 } });
    await expect.poll(async () => (await focus(page)).anchorId).toBe(c.id);
    await page.getByRole('button', { name: 'Add image' }).focus();
    await page.keyboard.press('Backspace');
    await page.getByRole('button', { name: /^Send all/ }).focus();
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-card]')).toHaveCount(1);
    await root(page).focus();
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-card]')).toHaveCount(0);
});

test('moves and resizes are announced by the card’s name', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a] = seed(board, [doc('Alpha', { x: 200, y: 150 })]);
    await openCanvas(page, board, 1);
    await card(page, a.id).getByRole('button', { name: 'Move Alpha' }).focus();
    await page.keyboard.press('ArrowRight');
    const said = page.locator('[role=alert], [role=status], [aria-live]');
    await expect(said.filter({ hasText: 'moved to' })).toContainText('Alpha moved to');
    await card(page, a.id).getByRole('button', { name: 'Resize Alpha' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(said.filter({ hasText: 'resized to' })).toContainText('Alpha resized to');
    for (const text of await said.allTextContents()) expect(text).not.toContain(a.id);
});
