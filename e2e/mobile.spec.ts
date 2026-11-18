import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace, SAMPLE } from './workspace';

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('mobile navigation and desktop-only surfaces', async ({ page, request }) => {
  test.setTimeout(180000);
  const ws = await newWorkspace(request, SAMPLE);
  const project = ws.base.split('/')[1];
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error' && /hydration|hydrated/i.test(m.text())) errors.push(m.text()); });
  await page.goto('/projects');
  await page.locator(`main a[href="/${project}"]`).tap();
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible({ timeout: 30000 });
  await fits(page);
  await page.locator(`a[href="/${project}?ws=${ws.id}"]`).tap();
  await page.getByRole('link', { name: 'New session', exact: true }).tap();
  await expect(page).toHaveURL(new RegExp(`${ws.base}/new`));
  await fits(page);
  await expect(page.locator('[data-slot="resizable-handle"]')).toHaveCount(0);
  for (const url of [`/${project}/canvas`, `${ws.base}/file/README.md`]) {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Open this on a larger screen' })).toBeVisible();
    await fits(page);
    await expect(page.locator('.cm-content')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('mobile tasks can be created and completed', async ({ page, request }) => {
  const ws = await newWorkspace(request, SAMPLE);
  await page.goto(`${ws.base}/new?tab=tasks`);
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).tap();
  await page.getByPlaceholder('Add a task…').fill('Mobile task');
  await page.getByRole('button', { name: 'Details', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'New task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save task', exact: true }).tap();
  await page.getByRole('checkbox', { name: 'Mark Mobile task done' }).tap();
  await expect(page.getByRole('checkbox', { name: 'Mark Mobile task open', includeHidden: true })).toBeChecked();
  await fits(page);
});

test('mobile notes keep editing and list navigation', async ({ page, request }) => {
  const ws = await newWorkspace(request, SAMPLE);
  await page.goto(`${ws.base}/new?tab=notes`);
  await page.getByRole('button', { name: 'Workspace tools', exact: true }).tap();
  await page.getByRole('button', { name: 'New note', exact: true }).tap();
  await expect(page.getByRole('dialog').last()).toBeVisible();
  await fits(page);
  await expect(page.locator('[contenteditable="true"]').last()).toBeVisible();
  await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('Mobile note');
  await expect.poll(async () => {
    const response = await request.get(`/api/workspaces/${ws.id}/notes`);
    return JSON.stringify(await response.json());
  }).toContain('Mobile note');
  await page.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(page.getByText('Mobile note', { exact: true })).toBeVisible();
});


test('mobile and tablet screenshots have no horizontal overflow', async ({ page, request }) => {
  test.setTimeout(180000);
  const ws = await newWorkspace(request, SAMPLE);
  const project = ws.base.split('/')[1];
  mkdirSync('.context/mobile-screenshots', { recursive: true });
  const routes = { projects: '/projects', project: `/${project}`, workspace: `/${project}?ws=${ws.id}`, chat: `${ws.base}/new`, notes: '/notes', tasks: `/projects/${project}/tasks`, inbox: '/inbox', routines: '/routines', vault: '/vault' };
  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1024 });
    for (const [name, route] of Object.entries(routes)) {
      await page.goto(route);
      await expect(page.locator('body')).not.toContainText('Application error');
      await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
      await fits(page);
      await page.screenshot({ path: `.context/mobile-screenshots/${name}-${width}.png` });
    }
  }
});
