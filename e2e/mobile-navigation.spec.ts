import { test, expect } from '@playwright/test';
import { newBoard } from './canvas';

test('settings back steps through the section list to projects', async ({ page }) => {
  await page.goto('/settings/appearance');
  await page.getByRole('link', { name: 'Back to Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole('link', { name: 'Back to Projects', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test('project notes back returns to its project', async ({ page, request }) => {
  const project = await newBoard(request);
  await page.goto(`/projects/${project.slug}/notes`);
  const back = page.getByRole('link', { name: /^Back to Canvas/ });
  await expect(back).toHaveAttribute('href', `/${project.slug}`);
  await back.click();
  await expect(page).toHaveURL(`/${project.slug}`);
});

for (const route of ['notes', 'inbox', 'vault']) {
  test(`${route} has an accessible back link`, async ({ page }) => {
    await page.goto(`/${route}`);
    await page.getByRole('link', { name: 'Back to Projects', exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });
}


test('Vanilla keeps mobile lists and persists the look when returning to settings', async ({ page, context, request }) => {
  await context.addCookies([{ name: 'thunk.look', value: 'vanilla', url: process.env.THUNK_E2E_URL! }]);
  const project = await newBoard(request);
  await page.goto(`/${project.slug}`);
  await expect(page.getByRole('main').getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: /^Notes/ }).click();
  await expect(page).toHaveURL(`/projects/${project.slug}/notes`);
  await page.getByRole('link', { name: /^Back to Canvas/ }).click();
  await expect(page).toHaveURL(`/${project.slug}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/settings/appearance');
  await expect(page.getByRole('radio', { name: /^Vanilla/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/look-vanilla/);
});
