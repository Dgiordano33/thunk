import { expect, test } from '@playwright/test';
import { newBoard, seed, doc, openCanvas, sidebarCanvases } from './canvas';

const idFromUrl = (url: string) => new URL(url).pathname.split('/canvas/')[1];

test('create and switch canvases from the sidebar, preserving existing cards and saving edits before leaving', async ({ page, request }) => {
    const board = await newBoard(request);
    const [original] = seed(board, [doc('Original canvas', { x: 100, y: 120 })]);
    await openCanvas(page, board, 1);
    const canvases = sidebarCanvases(page, board);
    await expect(canvases.getByRole('link', { name: 'Canvas', exact: true })).toHaveAttribute('aria-current', 'page');
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

test('rename a canvas from its header; the sidebar and title follow', async ({ page, request }) => {
    const board = await newBoard(request);
    await openCanvas(page, board, 0);
    await page.getByRole('button', { name: 'Rename canvas', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    await expect(name).toHaveValue('Canvas');
    await name.fill('Whiteboard');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Whiteboard', exact: true })).toBeVisible();
    await expect(sidebarCanvases(page, board).getByRole('link', { name: 'Whiteboard', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Whiteboard', exact: true })).toBeVisible();
});

test('old ?session= links and /canvas/main redirect to the canvas path', async ({ page, request }) => {
    const board = await newBoard(request);
    const { session } = await (await request.post(`/api/projects/${board.projectId}/boards`, { data: { name: 'Old link' } })).json();
    await page.goto(`/${board.slug}/canvas?session=${session.id}`);
    await expect(page).toHaveURL(new RegExp(`/${board.slug}/canvas/${session.id}$`));
    await expect(page.getByRole('heading', { name: 'Old link', exact: true })).toBeVisible();
    await page.goto(`/${board.slug}/canvas/main`);
    await expect(page).toHaveURL(new RegExp(`/${board.slug}/canvas$`));
    expect((await page.goto(`/${board.slug}/canvas/missing`))?.status()).toBe(404);
    expect((await page.goto(`/${board.slug}/canvas/a/b`))?.status()).toBe(404);
});

test('many canvases list in the sidebar without overflowing the smallest supported canvas screen', async ({ page, request }) => {
    const board = await newBoard(request);
    for (let i = 1; i <= 8; i++) {
        const response = await request.post(`/api/projects/${board.projectId}/boards`, { data: { name: `Research and planning ${i}` } });
        expect(response.ok()).toBe(true);
    }
    await page.setViewportSize({ width: 768, height: 1024 });
    await openCanvas(page, board, 0);
    const canvases = sidebarCanvases(page, board);
    await expect(canvases.getByRole('link')).toHaveCount(9);
    const create = page.getByRole('button', { name: 'New canvas', exact: true });
    await expect(create).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The board fills the pane and scrolls nothing but itself.
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    await canvases.getByRole('link').last().click();
    await expect(canvases.getByRole('link').last()).toHaveAttribute('aria-current', 'page');
    await create.click();
    await expect(page.getByRole('dialog', { name: 'New canvas', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create canvas', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(canvases.getByRole('link')).toHaveCount(9);
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
    expect((await (await request.get(root)).json()).sessions).toEqual([{ id: 'main', name: 'Canvas', status: 'idle' }, session]);
    expect((await request.get(`${root}/missing`)).status()).toBe(404);
    expect((await request.get(`${root}/bad.id`)).status()).toBe(400);

    // Rename and model live on the board; an empty model goes back to the default.
    expect((await request.patch(api, { data: { name: '  ' } })).status()).toBe(400);
    expect((await request.patch(api, { data: { name: 'Renamed', model: 'claude-haiku-5-5' } })).ok()).toBe(true);
    let saved = await (await request.get(api)).json();
    expect(saved.board.name).toBe('Renamed');
    expect(saved.board.model).toBe('claude-haiku-5-5');
    expect(saved.board.viewport.x).toBe(200);
    expect((await request.patch(api, { data: { model: null } })).ok()).toBe(true);
    saved = await (await request.get(api)).json();
    expect(saved.board.model).toBeUndefined();
});
