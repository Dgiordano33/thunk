import { expect, test } from '@playwright/test';
import { newBoard, seed, doc, openCanvas } from './canvas';

test('create and switch canvas sessions, preserving existing cards and saving edits before leaving', async ({ page, request }) => {
    const board = await newBoard(request);
    const [original] = seed(board, [doc('Original canvas', { x: 100, y: 120 })]);
    await openCanvas(page, board, 1);
    await page.getByRole('button', { name: 'New session', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Research');
    await page.getByRole('button', { name: 'Create session', exact: true }).click();
    await expect(page).toHaveURL(/canvas\?session=/);
    const id = new URL(page.url()).searchParams.get('session')!;
    const api = `/api/projects/${board.projectId}/boards/${id}`;
    await expect(page.locator('[data-card]')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Canvas session' })).toHaveText('Research');

    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    const editor = page.locator('[contenteditable=true]').first();
    await editor.fill('Only in Research');
    await page.getByRole('combobox', { name: 'Canvas session' }).click();
    await page.getByRole('option', { name: 'Canvas', exact: true }).click();
    await expect(page).toHaveURL(/session=main/);
    await expect(page.locator('[data-card]')).toHaveCount(1);
    await expect(page.locator('[data-card]')).toContainText('Original canvas');
    const saved = await (await request.get(api)).json();
    expect(saved.cards).toHaveLength(1);
    expect(saved.cards[0].markdown).toContain('Only in Research');
    expect((await (await request.get(board.api)).json()).cards[0].id).toBe(original.id);

    await page.getByRole('combobox', { name: 'Canvas session' }).click();
    await page.getByRole('option', { name: 'Research', exact: true }).click();
    await expect(page.locator('[data-card]')).toHaveCount(1);
    await expect(page.locator('[data-card]')).toContainText('Only in Research');
    await page.reload();
    await expect(page.locator('[data-card]')).toContainText('Only in Research');
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
