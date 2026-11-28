import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newBoard } from './canvas';

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
