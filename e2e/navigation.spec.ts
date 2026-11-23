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
