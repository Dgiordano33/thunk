import { expect, test } from '@playwright/test';
import { newBoard, seed, doc, openCanvas, sidebarCanvases } from './canvas';

const idFromUrl = (url: string) => new URL(url).pathname.split('/canvas/')[1];

test('create and switch canvases from the sidebar, preserving existing cards and saving edits before leaving', async ({ page, request }) => {
    const board = await newBoard(request);
    const [original] = seed(board, [doc('Original canvas', { x: 100, y: 120 })]);
    await openCanvas(page, board, 1);
    const canvases = sidebarCanvases(page, board);
    await expect(canvases.getByRole('link', { name: 'Canvas', exact: true })).toHaveAttribute('aria-current', 'page');
    // A canvas row reveals its new-canvas button on hover.
    await canvases.getByRole('link', { name: 'Canvas', exact: true }).hover();
    await canvases.getByRole('button', { name: `New canvas in ${board.name}`, exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Research');
    await page.getByRole('button', { name: 'Create canvas', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${board.slug}/canvas/[\\w-]+$`));
    const id = idFromUrl(page.url());
    const api = `/api/projects/${board.projectId}/boards/${id}`;
    await expect(page.locator('[data-card]')).toHaveCount(0);
    await expect(canvases.getByRole('link', { name: 'Research', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    const editor = page.locator('[contenteditable=true]').first();
    await editor.fill('Only in Research');
    // A client-side switch: the edit still saves once the next canvas has loaded.
    await canvases.getByRole('link', { name: 'Canvas', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${board.slug}/canvas$`));
    await expect(page.locator('[data-card]')).toHaveCount(1);
    await expect(page.locator('[data-card]')).toContainText('Original canvas');
    await expect.poll(async () => (await (await request.get(api)).json()).cards.map((c: { markdown: string }) => c.markdown).join()).toContain('Only in Research');
    expect((await (await request.get(board.api)).json()).cards[0].id).toBe(original.id);

    await canvases.getByRole('link', { name: 'Research', exact: true }).click();
    await expect(page.locator('[data-card]')).toHaveCount(1);
    await expect(page.locator('[data-card]')).toContainText('Only in Research');
    await page.reload();
    await expect(page.locator('[data-card]')).toContainText('Only in Research');

    // The board header creates one too.
    await page.getByRole('button', { name: 'New canvas', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Launch plan');
    await page.getByRole('button', { name: 'Create canvas', exact: true }).click();
    await expect(canvases.getByRole('link')).toHaveCount(3);
    await expect(canvases.getByRole('link', { name: 'Launch plan', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-card]')).toHaveCount(0);
});
