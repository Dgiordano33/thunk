import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newBoard } from './canvas';

test('Vanilla replaces Game world, persists, and keeps project tools and Solar reachable', async ({ page, request, context }) => {
  test.setTimeout(180_000);
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
  await expect(page.locator('#sidebar').getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/look-vanilla/);
  await expect(page.getByRole('radio', { name: /^Vanilla/ })).toHaveAttribute('aria-checked', 'true');
  await page.locator('#sidebar').getByRole('link', { name: 'Projects', exact: true }).click();
  // Search and Relay sit in the bar across the top, not the sidebar; the Projects list has no breadcrumb row repeating its heading.
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
  const bar = page.locator('#top-bar');
  await expect(bar.getByRole('button', { name: /^Search/ })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Relay a thought', exact: true })).toBeVisible();
  await expect(page.locator('#sidebar').getByRole('button', { name: 'Relay a thought', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '.context/vanilla/top-bar.png' });
  await page.getByRole('textbox', { name: 'Search projects' }).fill(project.name);
  await page.getByRole('main').getByRole('link', { name: new RegExp(project.name) }).click();
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible({ timeout: 30_000 });
  // Inside a project the sidebar swaps to that project's Inbox, Notes and Vault, then each workspace with its sessions.
  const seeded = await request.post('/api/e2e/session', { data: { workspaceId: workspace.id, title: 'Tidy the sidebar', events: [] } });
  expect(seeded.ok()).toBe(true);
  const sidebar = page.locator('#sidebar');
  await expect(sidebar.getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'All projects', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('list', { name: project.name, exact: true }).getByRole('link')).toHaveText([/^Inbox/, /^Tasks/, /^Notes/, /^Vault/, /^Routines/, /^Settings/]);
  await expect(sidebar.getByRole('link', { name: 'Interface refresh', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('list', { name: 'Interface refresh sessions' }).getByRole('link', { name: 'Tidy the sidebar' })).toBeVisible();
  mkdirSync('.context/vanilla', { recursive: true });
  await page.screenshot({ path: '.context/vanilla/sidebar-project.png' });
  await sidebar.getByRole('link', { name: /^Inbox/ }).click();
  await expect(page).toHaveURL(new RegExp(`/inbox\\?projectId=${project.projectId}$`));
  await expect(sidebar.getByRole('link', { name: 'All projects', exact: true })).toBeVisible();
  await sidebar.getByRole('link', { name: 'All projects', exact: true }).click();
  await expect(sidebar.getByRole('list', { name: 'General' }).getByRole('link')).toHaveText([/^Projects/, /^Inbox/, /^Tasks/, /^Notes/, /^Vault/, /^Routines/]);
  await page.screenshot({ path: '.context/vanilla/sidebar-general.png' });
  await page.getByRole('main').getByRole('link', { name: new RegExp(project.name) }).click();
  // The sidebar is the only project navigation: no tab strip on the page.
  await expect(page.getByRole('navigation', { name: 'Project sections' })).toHaveCount(0);
  const sections = sidebar.getByRole('list', { name: project.name, exact: true });
  for (const [label, route] of [['Notes', 'notes'], ['Tasks', 'tasks'], ['Routines', 'routines'], ['Vault', 'vault'], ['Settings', 'settings']]) {
    await sections.getByRole('link', { name: new RegExp(`^${label}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/${route}$`), { timeout: 30_000 });
    await expect(sections.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.vanilla-panel')).toBeVisible();
    await expect(page.locator('[data-floating-window]')).toHaveCount(0);
    const box = (await page.locator('.vanilla-panel').boundingBox())!;
    expect(box.width).toBeGreaterThan(700);
    expect(box.height).toBeGreaterThan(350);
  }
  await sidebar.locator(`a[href="/${project.slug}"]`).click();
  await expect(page).toHaveURL(`/${project.slug}`);
  await expect(page.getByRole('heading', { name: 'Recent sessions', exact: true })).toBeVisible();
  mkdirSync('.context/vanilla', { recursive: true });
  await page.screenshot({ path: '.context/vanilla/project-light.png' });
  await page.getByRole('main').getByRole('link', { name: /Interface refresh.*Project files/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${project.slug}/${workspace.slug}(/|$)`));
  await expect(page.getByRole('link', { name: 'All projects', exact: true })).toBeVisible();
  await page.goto(`/${project.slug}`);
  await sidebar.getByRole('link', { name: 'Canvas', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${project.slug}/canvas$`));
  await expect(page.getByRole('link', { name: 'All projects', exact: true })).toBeVisible();
  for (const route of ['inbox', 'notes', 'routines', 'vault']) {
    await page.goto(`/${route}`);
    await expect(page.locator('.vanilla-panel')).toBeVisible();
    await expect(page.locator('[data-window-resize]')).toHaveCount(0);
  }
  await page.goto('/settings/appearance');
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await page.locator('#sidebar').getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search projects' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: '.context/vanilla/projects-dark.png' });
  await page.goto('/settings/appearance');
  await page.getByRole('radio', { name: /^Solar system/ }).click();
  await expect(page.locator('html')).toHaveClass(/look-space/);
  await expect(page.locator('#sidebar').getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0);
  await page.goto(`/${project.slug}`);
  await expect(page.locator('.space')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Project sections' })).toBeVisible();
});


test('Vanilla general sidebar opens Tasks and keeps it reachable when collapsed', async ({ page, request, context }) => {
  const project = await newBoard(request);
  await context.addCookies([
    { name: 'thunk.look', value: 'vanilla', url: process.env.THUNK_E2E_URL! },
    { name: 'thunk.onboarding', value: 'intro,map-legend,checklist-dismissed', url: process.env.THUNK_E2E_URL! },
  ]);
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  const sidebar = page.locator('#sidebar');
  await sidebar.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page).toHaveURL('/projects', { timeout: 30_000 });
  await sidebar.getByRole('link', { name: /^Tasks/ }).click();
  await expect(page).toHaveURL('/tasks', { timeout: 30_000 });
  await expect(sidebar.getByRole('link', { name: /^Tasks/ })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('combobox', { name: 'Tasks project' }).click();
  await page.getByRole('option', { name: project.name, exact: true }).click();
  await page.getByRole('textbox', { name: 'New task title' }).fill('Review sidebar tasks');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByText('Review sidebar tasks', { exact: true })).toBeVisible();
  mkdirSync('.context/vanilla', { recursive: true });
  await page.screenshot({ path: '.context/vanilla/tasks.png' });
  await sidebar.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(sidebar.getByRole('link', { name: 'Tasks', exact: true })).toHaveAttribute('aria-current', 'page');
});
