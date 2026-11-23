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
