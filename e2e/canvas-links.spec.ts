import { expect, test, type Page } from '@playwright/test';
import { card, doc, focus, newBoard, openCanvas, seed, type Board } from './canvas';

/** Opens a card's "Use elsewhere" menu and picks an action. */
async function cardAction(page: Page, id: string, label: string, action: string) {
    await card(page, id).hover();
    await page.getByRole('button', { name: `More actions for ${label}`, exact: true }).click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
}

const backLink = (board: Board, id: string) => `/${board.slug}/canvas?card=${id}`;

test('card → task carries the card text and a link back', async ({ page, request }) => {
    const board = await newBoard(request);
    const [c] = seed(board, [doc('Ship the importer', { x: 120, y: 120 })]);
    await openCanvas(page, board, 1);
    await cardAction(page, c.id, 'Ship the importer', 'Create task');
    await expect(page.getByText('Task created')).toBeVisible();
    const { tasks } = await (await request.get(`/api/tasks?projectId=${board.projectId}`)).json();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Ship the importer');
    expect(tasks[0].body).toContain('Line 1 of Ship the importer.');
    expect(tasks[0].body).toContain(backLink(board, c.id));
});

test('card → note saves the card markdown with a link back', async ({ page, request }) => {
    const board = await newBoard(request);
    const [c] = seed(board, [doc('Research notes', { x: 120, y: 120 })]);
    await openCanvas(page, board, 1);
    await cardAction(page, c.id, 'Research notes', 'Save as note');
    await expect(page.getByText('Saved as note')).toBeVisible();
    const { notes } = await (await request.get(`/api/projects/${board.projectId}/notes`)).json();
    const note = notes.find((n: { title: string }) => n.title === 'Research notes');
    expect(note).toBeTruthy();
    const { note: full } = await (await request.get(`/api/projects/${board.projectId}/notes/${note.id}`)).json();
    expect(full.markdown).toContain('Line 1 of Research notes.');
    expect(full.markdown).toContain(backLink(board, c.id));
});

test('card → session opens a new chat with the card as the first prompt', async ({ page, request }) => {
    const board = await newBoard(request);
    const [c] = seed(board, [doc('Refactor the parser', { x: 120, y: 120 })]);
    await openCanvas(page, board, 1);
    await cardAction(page, c.id, 'Refactor the parser', 'Start session from card');
    await expect(page).toHaveURL(new RegExp(`/${board.slug}/[\\w-]+/new\\?canvas=main&card=${c.id}$`));
    const message = page.getByRole('textbox', { name: 'Message' });
    await expect(message).toHaveValue(/Line 1 of Refactor the parser\./);
    await expect(message).toHaveValue(new RegExp(backLink(board, c.id).replace(/[?]/g, '\\?')));
});

test('task → canvas adds a card to the main canvas, and the toast opens it focused', async ({ page, request }) => {
    const board = await newBoard(request);
    const created = await request.post('/api/tasks', { data: { projectId: board.projectId, title: 'Draft the launch post', body: 'Outline first.' } });
    expect(created.ok(), await created.text()).toBe(true);
    await page.goto(`/projects/${board.slug}/tasks`);
    await page.getByRole('button', { name: 'Add Draft the launch post to Canvas', exact: true }).click();
    await expect(page.getByText('Added to Canvas')).toBeVisible();
    const { cards } = await (await request.get(board.api)).json();
    expect(cards).toHaveLength(1);
    expect(cards[0].markdown).toContain('Draft the launch post');
    expect(cards[0].markdown).toContain('Outline first.');
    await page.getByRole('button', { name: 'Open canvas', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${board.slug}/canvas\\?card=${cards[0].id}$`));
    await expect(card(page, cards[0].id)).toBeInViewport();
    await expect.poll(async () => (await focus(page)).anchorId).toBe(cards[0].id);
});

test('?card= centres a card that starts off screen and makes it the focus', async ({ page, request }) => {
    const board = await newBoard(request);
    const [, far] = seed(board, [doc('Near', { x: 80, y: 80 }), doc('Far away', { x: 4200, y: 3100 })]);
    await openCanvas(page, board, 2, `/${board.slug}/canvas?card=${far.id}`);
    await expect(card(page, far.id)).toBeInViewport();
    expect((await focus(page)).anchorId).toBe(far.id);
});
