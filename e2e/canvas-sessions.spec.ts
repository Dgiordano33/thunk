import { expect, test } from '@playwright/test';
import { newBoard, seed, doc, openCanvas } from './canvas';

test('create and switch canvas sessions, preserving existing cards and saving edits before leaving', async ({ page, request }) => {
    const board = await newBoard(request);
    const [original] = seed(board, [doc('Original canvas', { x: 100, y: 120 })]);
    await openCanvas(page, board, 1);
    await page.getByRole('button', { name: 'New canvas', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Research');
    await page.getByRole('button', { name: 'Create canvas', exact: true }).click();
    await expect(page).toHaveURL(/canvas\?session=/);
    const id = new URL(page.url()).searchParams.get('session')!;
    const api = `/api/projects/${board.projectId}/boards/${id}`;
    await expect(page.locator('[data-card]')).toHaveCount(0);
    const canvases = page.getByRole('navigation', { name: 'Project canvases' });
    await expect(canvases.getByRole('button', { name: 'Research', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(canvases.getByRole('button', { name: 'Canvas', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    const editor = page.locator('[contenteditable=true]').first();
    await editor.fill('Only in Research');
    await canvases.getByRole('button', { name: 'Canvas', exact: true }).click();
    await expect(page).toHaveURL(/session=main/);
    await expect(page.locator('[data-card]')).toHaveCount(1);
    await expect(page.locator('[data-card]')).toContainText('Original canvas');
    const saved = await (await request.get(api)).json();
    expect(saved.cards).toHaveLength(1);
    expect(saved.cards[0].markdown).toContain('Only in Research');
    expect((await (await request.get(board.api)).json()).cards[0].id).toBe(original.id);

    await canvases.getByRole('button', { name: 'Research', exact: true }).click();
    await expect(page.locator('[data-card]')).toHaveCount(1);
    await expect(page.locator('[data-card]')).toContainText('Only in Research');
    await page.reload();
    await expect(page.locator('[data-card]')).toContainText('Only in Research');

    await page.getByRole('button', { name: 'New canvas', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Launch plan');
    await page.getByRole('button', { name: 'Create canvas', exact: true }).click();
    await expect(canvases.getByRole('button')).toHaveCount(3);
    await expect(canvases.getByRole('button', { name: 'Launch plan', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-card]')).toHaveCount(0);
});

test('many canvases scroll without hiding creation or overflowing a narrow screen', async ({ page, request }) => {
    const board = await newBoard(request);
    for (let i = 1; i <= 8; i++) {
        const response = await request.post(`/api/projects/${board.projectId}/boards`, { data: { name: `Research and planning ${i}` } });
        expect(response.ok()).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await openCanvas(page, board, 0);
    const canvases = page.getByRole('navigation', { name: 'Project canvases' });
    await expect(canvases.getByRole('button')).toHaveCount(9);
    const create = page.getByRole('button', { name: 'New canvas', exact: true });
    await expect(create).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await canvases.getByRole('button').last().focus();
    await expect(canvases.getByRole('button').last()).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(canvases.getByRole('button').last()).toHaveAttribute('aria-current', 'page');
    await expect(canvases.getByRole('button').last()).toBeInViewport();
    await page.reload();
    await expect(canvases.getByRole('button').last()).toBeInViewport();
    await expect(create).toBeInViewport();
    await create.click();
    await expect(page.getByRole('dialog', { name: 'New canvas', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create canvas', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(canvases.getByRole('button')).toHaveCount(9);
});

test('session APIs validate names and IDs and isolate cards and viewports', async ({ request }) => {
    const board = await newBoard(request);
    const root = `/api/projects/${board.projectId}/boards`;
    expect((await request.post(root, { data: { name: '  ' } })).status()).toBe(400);
    const created = await request.post(root, { data: { name: 'Second' } });
    expect(created.status()).toBe(201);
    const { session } = await created.json();
    const api = `${root}/${session.id}`;
    const { card } = await (await request.post(`${api}/cards`, { data: { markdown: 'isolated' } })).json();
    expect((await request.patch(`${api}/cards/${card.id}`, { data: { baseRev: card.rev, markdown: 'edited' } })).ok()).toBe(true);
    expect((await request.patch(`${board.api}/cards/${card.id}`, { data: { baseRev: card.rev, markdown: 'wrong board' } })).status()).toBe(404);
    await request.patch(api, { data: { viewport: { x: 200, y: 300, zoom: 0.5 } } });
    const state = await (await request.get(api)).json();
    expect(state.board.id).toBe(session.id);
    expect(state.board.viewport.x).toBe(200);
    expect(state.cards[0].markdown).toBe('edited');
    const main = await (await request.get(board.api)).json();
    expect(main.cards).toEqual([]);
    expect(main.board.viewport.x).toBe(0);
    expect((await (await request.get(root)).json()).sessions).toEqual([{ id: 'main', name: 'Canvas' }, session]);
    expect((await request.get(`${root}/missing`)).status()).toBe(404);
    expect((await request.get(`${root}/bad.id`)).status()).toBe(400);
});
