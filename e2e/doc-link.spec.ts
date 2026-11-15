import { expect, test, type Page } from '@playwright/test';
import { card, doc, newBoard, openCanvas, seed, settled, stored } from './canvas';

/** Links in canvas docs: the toolbar's URL field, which replaced window.prompt. */

/** Selects `word` in card `id` by double-clicking exactly on it. */
async function select(page: Page, id: string, word: string) {
    const at = await card(page, id).locator('[contenteditable="true"]').evaluate((root, word) => {
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const i = n.textContent!.indexOf(word);
            if (i < 0) continue;
            const range = document.createRange();
            range.setStart(n, i);
            range.setEnd(n, i + word.length);
            const r = range.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        throw new Error(`no "${word}"`);
    }, word);
    // Far enough from any earlier click that the browser doesn't count a triple-click.
    await page.waitForTimeout(600);
    await page.mouse.dblclick(at.x, at.y);
    await expect.poll(() => page.evaluate(() => String(getSelection()).trim())).toBe(word);
}
const field = (page: Page) => page.getByRole('textbox', { name: 'Link URL' });

test('Link turns the toolbar into a URL field and links the selected word', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a] = seed(board, [{ ...doc('Alpha', { x: 200, y: 150, width: 520 }), markdown: '# Alpha\n\nRead the docs today.' }]);
    await openCanvas(page, board, 1);
    page.on('dialog', d => { throw new Error(`native dialog: ${d.message()}`); });
    await select(page, a.id, 'docs');
    await page.getByRole('button', { name: 'Link' }).click();
    await expect(field(page)).toBeFocused();
    await page.keyboard.type('checklyhq.com/docs');
    // The narrower field sits centered over the selection, not where the full toolbar's edge was.
    await expect.poll(async () => {
        const f = (await field(page).locator('xpath=ancestor::form').boundingBox())!;
        const sel = await card(page, a.id).locator('[contenteditable="true"]').evaluate((root) => {
            const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let n = w.nextNode(); n; n = w.nextNode()) { const i = n.textContent!.indexOf('docs'); if (i < 0) continue; const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 4); const b = r.getBoundingClientRect(); return b.x + b.width / 2; }
            return 0;
        });
        return Math.abs(f.x + f.width / 2 - sel);
    }).toBeLessThan(4);
    await page.keyboard.press('Enter');
    const link = card(page, a.id).getByRole('link', { name: 'docs' });
    await expect(link).toHaveAttribute('href', 'https://checklyhq.com/docs');
    await settled(page);
    expect((await stored(page, a.id))!.markdown).toContain('[docs](https://checklyhq.com/docs)');
});

test('an existing link opens prefilled, can be removed, and Escape cancels', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a] = seed(board, [{ ...doc('Alpha', { x: 200, y: 150, width: 520 }), markdown: '# Alpha\n\nRead the [docs](https://old.example.com) today.' }]);
    await openCanvas(page, board, 1);
    await select(page, a.id, 'docs');
    await page.getByRole('button', { name: 'Link' }).click();
    await expect(field(page)).toHaveValue('https://old.example.com');
    // Escape leaves the link alone and goes back to the editor, not the canvas.
    await page.keyboard.press('Escape');
    await expect(field(page)).toBeHidden();
    await expect(card(page, a.id).getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://old.example.com');
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.isContentEditable)).toBe(true);

    await select(page, a.id, 'docs');
    await page.getByRole('button', { name: 'Link' }).click();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(card(page, a.id).getByRole('link')).toHaveCount(0);
    await expect(card(page, a.id)).toContainText('Read the docs today.');
});

test('a javascript: link is refused with a message', async ({ page, request }) => {
    const board = await newBoard(request);
    const [a] = seed(board, [{ ...doc('Alpha', { x: 200, y: 150, width: 520 }), markdown: '# Alpha\n\nRead the docs today.' }]);
    await openCanvas(page, board, 1);
    await select(page, a.id, 'docs');
    await page.getByRole('button', { name: 'Link' }).click();
    await field(page).fill('javascript:alert(1)');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'Use a web or email address.' })).toBeVisible();
    await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(card(page, a.id).getByRole('link')).toHaveCount(0);
});
