import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newBoard } from './canvas';

for (const [route, label] of [['settings/appearance', 'Appearance'], ['inbox', 'Inbox'], ['notes', 'Notes'], ['routines', 'Routines'], ['vault', 'Vault']]) {
  test(`${label} has a way home on direct visits and reloads`, async ({ page }) => {
    await page.goto(`/${route}`);
    await page.reload();
    const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(trail.locator('[aria-current="page"]')).toContainText(label);
    if (route.startsWith('settings/')) {
      await expect(trail.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('href', '/settings');
      mkdirSync('.context/navigation', { recursive: true });
      await page.screenshot({ path: '.context/navigation/settings.png' });
    }
    await trail.getByRole('link', { name: 'Projects', exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });
}

test('project sections link to their project before the map', async ({ page, request }) => {
  const project = await newBoard(request);
  for (const section of ['notes', 'settings', 'tasks', 'routines', 'vault']) {
    await page.goto(`/projects/${project.slug}/${section}`);
    const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(trail.locator('[aria-current="page"]')).toHaveText(section[0].toUpperCase() + section.slice(1));
    const parent = trail.getByRole('link').nth(1);
    await expect(parent).toHaveAttribute('href', `/${project.slug}`);
    await parent.click();
    await expect(page).toHaveURL(`/${project.slug}`);
  }
});

test('game look retains the world parent and long project names fit', async ({ page, request, context }) => {
  await context.addCookies([{ name: 'thunk.look', value: 'world', url: process.env.THUNK_E2E_URL! }]);
  const project = await newBoard(request);
  const renamed = await request.patch(`/api/projects/${project.projectId}`, { data: { name: 'A very long project name that should fit beside the navigation actions' } });
  expect(renamed.ok()).toBe(true);
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto(`/projects/${project.slug}/notes`);
  const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(trail.getByRole('link', { name: 'World', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await trail.getByRole('link', { name: 'World', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test('Canvas keeps the sidebar, and the planet dock counts canvases', async ({ page, request, context }) => {
  await context.addCookies([{ name: 'thunk.look', value: 'space', url: process.env.THUNK_E2E_URL! }]);
  const project = await newBoard(request);
  await request.post(`/api/projects/${project.projectId}/boards`, { data: { name: 'Second canvas' } });
  await page.goto(`/${project.slug}`);
  const dock = page.getByRole('navigation', { name: 'Project sections' });
  const section = dock.getByRole('link', { name: /^Canvas/ });
  await expect(section).toHaveAttribute('href', `/${project.slug}/canvas`);
  await expect(section).toContainText('2');
  await section.click();
  await expect(page).toHaveURL(new RegExp(`/${project.slug}/canvas$`));
  // The workspace shell stays: the sidebar, with this project's canvases, and no back button on the board.
  await expect(page.getByRole('link', { name: 'Library' })).toBeVisible();
  await expect(page.getByRole('group', { name: `${project.name} canvases`, exact: true }).getByRole('link')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^←/ })).toHaveCount(0);
});
