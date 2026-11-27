import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newBoard } from './canvas';

test('Vanilla replaces Game world, persists, and keeps project tools and Solar reachable', async ({ page, request, context }) => {
  const project = await newBoard(request);
  await request.patch(`/api/projects/${project.projectId}`, { data: { name: 'Thunk' } });
  project.name = 'Thunk';
  const workspaceResponse = await request.post('/api/workspaces', { data: { projectId: project.projectId, name: 'Interface refresh' } });
  expect(workspaceResponse.ok()).toBe(true);
  const { workspace } = await workspaceResponse.json();
  await context.addCookies([{ name: 'thunk.onboarding', value: 'intro,map-legend,checklist-dismissed', url: process.env.THUNK_E2E_URL! }]);
  await page.goto('/settings/appearance');
  await expect(page.getByRole('radio', { name: /^Solar system/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /^Game world/ })).toHaveCount(0);
  await page.getByRole('radio', { name: /^Vanilla/ }).click();
  await expect(page.getByRole('link', { name: 'All projects', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/look-vanilla/);
  await expect(page.getByRole('radio', { name: /^Vanilla/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('link', { name: 'All projects', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search projects' }).fill(project.name);
  await page.getByRole('main').getByRole('link', { name: new RegExp(project.name) }).click();
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  const sections = page.getByRole('navigation', { name: 'Project sections' });
  for (const [label, route] of [['Notes', 'notes'], ['Tasks', 'tasks'], ['Routines', 'routines'], ['Vault', 'vault'], ['Overview & settings', 'settings']]) {
    await sections.getByRole('link', { name: new RegExp(`^${label}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/${route}$`));
    await expect(sections.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.vanilla-panel')).toBeVisible();
    await expect(page.locator('[data-floating-window]')).toHaveCount(0);
    const box = (await page.locator('.vanilla-panel').boundingBox())!;
    expect(box.width).toBeGreaterThan(700);
    expect(box.height).toBeGreaterThan(350);
  }
  await sections.getByRole('link', { name: /^Workspaces/ }).click();
  await expect(page).toHaveURL(`/${project.slug}`);
  await expect(page.getByRole('heading', { name: 'Recent sessions', exact: true })).toBeVisible();
  mkdirSync('.context/vanilla', { recursive: true });
  await page.screenshot({ path: '.context/vanilla/project-light.png' });
  await page.getByRole('main').getByRole('link', { name: /Interface refresh.*Project files/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${project.slug}/${workspace.slug}/new$`));
  await expect(page.getByRole('link', { name: 'All projects', exact: true })).toBeVisible();
  await page.goto(`/${project.slug}`);
  await sections.getByRole('link', { name: /^Canvas/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${project.slug}/canvas$`));
  await expect(page.getByRole('link', { name: 'All projects', exact: true })).toBeVisible();
  for (const route of ['inbox', 'notes', 'routines', 'vault']) {
    await page.goto(`/${route}`);
    await expect(page.locator('.vanilla-panel')).toBeVisible();
    await expect(page.locator('[data-window-resize]')).toHaveCount(0);
  }
  await page.goto('/settings/appearance');
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await page.getByRole('link', { name: 'All projects', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search projects' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: '.context/vanilla/projects-dark.png' });
  await page.goto('/settings/appearance');
  await page.getByRole('radio', { name: /^Solar system/ }).click();
  await expect(page.locator('html')).toHaveClass(/look-space/);
  await expect(page.getByRole('link', { name: 'All projects', exact: true })).toHaveCount(0);
  await page.goto(`/${project.slug}`);
  await expect(page.locator('.space')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Project sections' })).toBeVisible();
});
