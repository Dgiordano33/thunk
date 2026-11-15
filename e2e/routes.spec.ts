import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { newBoard } from './canvas';

test('project screens support direct links, legacy redirects, reload and back', async ({ page, request }) => {
  const project = await newBoard(request);
  for (const [building, section] of Object.entries({ center: 'settings', library: 'notes', tasks: 'tasks', workshop: 'routines', vault: 'vault' })) {
    const response = await page.goto(`/${project.slug}?building=${building}`);
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/${section}$`));
    await expect(page.getByRole('heading', { name: new RegExp('Canvas') }).first()).toBeVisible();
  }
  await page.goto(`/${project.slug}?building=library&note=memory`);
  await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/notes\\?note=memory$`));
  expect((await page.reload())?.ok()).toBe(true);
  await page.goto(`/projects/${project.slug}/tasks`);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/notes\\?note=memory$`));
});

test('editor links preserve special filenames and legacy URLs select the same tab', async ({ page, request }) => {
  const project = await newBoard(request);
  await page.goto(`/${project.slug}`);
  const { workspaces } = await (await request.get(`/api/projects/${project.projectId}`)).json();
  const workspace = workspaces[0];
  const filename = 'nested/a #100% ü.txt';
  mkdirSync(path.join(workspace.cwd, 'nested'), { recursive: true });
  writeFileSync(path.join(workspace.cwd, filename), 'URL routing test');
  const base = `/${project.slug}/${workspace.slug}`;
  await page.goto(`${base}/file?${new URLSearchParams({ path: filename, tab: 'files' })}`);
  await expect(page).toHaveURL(new RegExp('/file/nested/'));
  await expect(page.locator('.cm-content')).toContainText('URL routing test');
  await expect(page.getByRole('link', { name: 'a #100% ü.txt', exact: true }).first()).toHaveAttribute('aria-current', 'page');
  expect((await page.reload())?.ok()).toBe(true);
  await expect(page.locator('.cm-content')).toContainText('URL routing test');
  const literal = 'nested/literal%2F.txt';
  writeFileSync(path.join(workspace.cwd, literal), 'Literal percent sequence');
  await page.goto(`${base}/file/nested/literal%252F.txt?root=workspace`);
  await expect(page.locator('.cm-content')).toContainText('Literal percent sequence');
});
