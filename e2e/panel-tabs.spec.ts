import { test, expect } from '@playwright/test';
import { newBoard } from './canvas';

test('project panel tabs select their content and survive reload', async ({ page, request }) => {
  const project = await newBoard(request);
  await page.goto(`/projects/${project.slug}/settings`);
  await expect(page.getByRole('tab', { name: 'Chief', exact: true })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['Overview', 'Notes', 'Settings', 'Chief'] as const) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(new RegExp(`section=${name.toLowerCase()}`));
    await expect(page.getByRole('tabpanel')).toBeVisible();
    const content = { Overview: 'Total spend', Notes: 'Open the library', Settings: 'Danger zone', Chief: 'Open the chief' }[name];
    await expect(page.getByRole('tabpanel')).toContainText(content);
  }
  await page.getByRole('tab', { name: 'Chief', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('section', 'notes');
    window.history.pushState(null, '', url);
  });
  await expect(page.getByRole('tab', { name: 'Notes', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('workspace tabs switch before the URL update completes', async ({ page, request }) => {
  const project = await newBoard(request);
  await page.goto(`/${project.slug}`);
  const { workspaces } = await (await request.get(`/api/projects/${project.projectId}`)).json();
  await page.goto(`/${project.slug}?ws=${workspaces[0].id}`);
  await expect(page.getByRole('tab', { name: 'Folder', exact: true })).toHaveAttribute('aria-selected', 'true');

  // Hold the router's URL notification to check that tab selection is immediate.
  await page.evaluate(() => {
    const replace = window.history.replaceState.bind(window.history);
    window.history.replaceState = (...args) => {
      window.history.replaceState = replace;
      window.addEventListener('flush-tab-url', () => replace(...args), { once: true });
    };
  });
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Preview');
  await page.evaluate(() => window.dispatchEvent(new Event('flush-tab-url')));
  await expect(page).toHaveURL(/section=preview/);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Open the library');
});
