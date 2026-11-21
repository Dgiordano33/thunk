import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const ready = { claude: { state: 'ready', message: 'Installed · sign-in not verified' }, codex: { state: 'missing', message: 'Not installed', command: 'npm install -g @openai/codex' } };
test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'thunk.onboarding', value: '', url: baseURL! }]);
  await page.route('**/api/agents/status*', route => route.fulfill({ json: ready }));
  await page.route('**/api/models', route => route.fulfill({ json: { models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet', provider: 'claude' }] } }));
});
async function settings(page: Page) {
  const open = page.getByRole('button', { name: 'Open menu', exact: true });
  if (await open.isVisible()) await open.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
}

test('intro skips once, replays, resets hints, and hands off to add project', async ({ page, context }) => {
  await page.goto('/projects');
  const intro = page.getByRole('dialog', { name: 'How work is organised' });
  await expect(intro).toBeVisible();
  await intro.getByRole('button', { name: 'Skip' }).click();
  await page.reload();
  await expect(intro).toBeHidden();
  await page.getByRole('button', { name: 'Dismiss map legend' }).click();
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Map legend' })).toBeHidden();
  await settings(page);
  await page.getByRole('button', { name: 'Show intro', exact: true }).click();
  await expect(intro).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(intro).toBeHidden();
  expect((await context.cookies()).find(c => c.name === 'thunk.onboarding')?.value).toContain('intro');
  await settings(page);
  await page.getByRole('button', { name: 'Reset hints', exact: true }).click();
  await expect(intro).toBeVisible();
  await intro.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Your agents and setup');
  const add = page.getByRole('button', { name: 'Add your first project', exact: true });
  if (await add.isVisible()) {
    await add.click();
    await expect(page.getByRole('dialog', { name: 'Create a project' })).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }
});

test('existing install skips intro; checklist uses real project, workspace and note data', async ({ page, request, context, baseURL }) => {
  const created = await request.post('/api/projects', { data: { name: `Onboarding ${Date.now()}`, repos: [] } });
  expect(created.ok()).toBeTruthy();
  const { project } = await created.json();
  await context.clearCookies();
  await page.goto('/projects');
  await expect(page.getByRole('dialog', { name: 'How work is organised' })).toBeHidden();
  let progress = await (await request.get('/api/onboarding/progress')).json();
  expect(progress.projects).toBeGreaterThan(0);
  const before = progress.workspaces;
  const ws = await request.post('/api/workspaces', { data: { projectId: project.id } });
  expect(ws.ok(), await ws.text()).toBeTruthy();
  expect((await request.post(`/api/projects/${project.id}/notes`, { data: { title: 'First plan', markdown: 'A useful plan.' } })).ok()).toBeTruthy();
  progress = await (await request.get('/api/onboarding/progress')).json();
  expect(progress.workspaces).toBe(before + 1);
  expect(progress.notes).toBeGreaterThan(0);
  if (await page.getByRole('button', { name: 'Open menu', exact: true }).isVisible()) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const checklist = page.getByLabel('Getting started');
  await expect(checklist.getByRole('link', { name: 'Complete Add a project' })).toBeVisible();
  await checklist.getByRole('button', { name: 'Dismiss checklist' }).click();
  await page.reload();
  if (await page.getByRole('button', { name: 'Open menu', exact: true }).isVisible()) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await expect(page.getByLabel('Getting started')).toBeHidden();
  await context.addCookies([{ name: 'thunk.onboarding', value: '', url: baseURL! }]);
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
});

for (const look of ['space', 'world']) for (const theme of ['light', 'dark']) {
  test(`intro and legend ${look} ${theme}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'thunk.look', value: look, url: baseURL! }]);
    await page.addInitScript(theme => localStorage.setItem('thunk.theme', theme), theme);
    await page.goto('/projects');
    await expect(page.getByRole('dialog', { name: 'How work is organised' })).toBeVisible();
    await page.screenshot({ animations: "disabled", path: path.resolve(`.context/onboarding-${look}-${theme}.png`) });
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Map legend' })).toBeVisible();
  });
}

test('mobile intro uses a drawer without the diagram', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/projects');
  const dialog = page.getByRole('dialog', { name: 'How work is organised' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('list')).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: path.resolve('.context/onboarding-mobile.png') });
  await dialog.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByLabel('Getting started')).toBeVisible();
});

test('starter prompts fill without sending; unavailable agents disable the composer', async ({ page, request }) => {
  const created = await request.post('/api/projects', { data: { name: `Prompts ${Date.now()}`, repos: [] } });
  const { project, workspace } = await created.json();
  await page.goto(`/${project.slug}/${workspace.slug}/new`);
  await page.getByRole('button', { name: 'Explain how this repo is organised', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Explain how this repo is organised');
  await expect(page).toHaveURL(/\/new$/);
  await page.route('**/api/agents/status*', route => route.fulfill({ json: { ...ready, claude: { state: 'signed-out', message: 'Sign in to start sessions', command: 'claude auth login' } } }));
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeDisabled();
  await expect(page.getByText('claude auth login', { exact: true })).toBeVisible();
  await page.route('**/api/agents/status*', route => route.fulfill({ json: ready }));
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
});

test('archive offers Harvest for workspace notes and can keep them in place', async ({ page, request }) => {
  const created = await request.post('/api/projects', { data: { name: `Harvest intro ${Date.now()}`, repos: [] } });
  const { project } = await created.json();
  const { workspace } = await (await request.post('/api/workspaces', { data: { projectId: project.id } })).json();
  expect((await request.post(`/api/workspaces/${workspace.id}/notes`, { data: { title: 'Lesson', markdown: 'Keep this lesson.' } })).ok()).toBeTruthy();
  await page.goto(`/${project.slug}/${workspace.slug}/new`);
  await page.getByRole('button', { name: `${workspace.name} options`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  const harvest = page.getByRole('dialog', { name: `Harvest · ${workspace.name}` });
  await expect(harvest).toContainText('Harvest keeps what this workspace learned');
  await harvest.getByRole('button', { name: 'Archive without harvesting', exact: true }).click();
  await expect(harvest).toBeHidden();
  const notes = await request.get(`/api/workspaces/${workspace.id}/notes`);
  expect(await notes.text()).toContain('Lesson');
});

test('routine templates fill the form without creating a routine', async ({ page, request }) => {
  const created = await request.post('/api/projects', { data: { name: `Templates ${Date.now()}`, repos: [] } });
  const { project } = await created.json();
  await page.goto(`/projects/${project.slug}/routines?routine=new`);
  await expect(page.getByRole('button', { name: 'Daily PR summary', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Weekly project review', exact: true }).click();
  await expect(page.getByPlaceholder('Nightly dependency check')).toHaveValue('Weekly project review');
  await expect(page.getByText('Mondays at 09:00', { exact: true }).first()).toBeVisible();
  const response = await request.get(`/api/routines?projectId=${project.id}`);
  expect((await response.json()).routines).toHaveLength(0);
});

test('a completed checklist stays out of the way', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'thunk.onboarding', value: 'intro', url: baseURL! }]);
  await page.route('**/api/onboarding/progress', route => route.fulfill({ json: { projects: 1, workspaces: 1, sessions: 1, notes: 1, tasksOrRoutines: 1 } }));
  await page.goto('/projects');
  await settings(page);
  await expect(page.getByLabel('Getting started')).toBeHidden();
});
