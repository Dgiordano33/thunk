import { expect, test } from '@playwright/test';

test('projects start without Local and offer chat before any workspace exists', async ({ page, request, context, baseURL }) => {
  await context.addCookies([{ name: 'thunk.onboarding', value: 'intro,checklist-dismissed,map-legend', url: baseURL! }]);
  await page.route('**/api/agents/status*', route => route.fulfill({ json: {
    claude: { state: 'ready', message: 'Ready' }, codex: { state: 'ready', message: 'Ready' },
  } }));
  await page.route('**/api/models', route => route.fulfill({ json: { models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet', provider: 'claude' }] } }));
  const response = await request.post('/api/projects', { data: { name: `Effort UI ${Date.now()}`, repos: [] } });
  expect(response.ok()).toBeTruthy();
  const { project } = await response.json();
  expect((await (await request.get(`/api/workspaces?projectId=${project.id}`)).json()).workspaces).toEqual([]);
  await page.goto(`/projects/${project.slug}/chat`);
  await expect(page.getByRole('heading', { name: `New chat in ${project.name}` })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Local', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: `New chat in ${project.name}`, exact: true })).toBeVisible();
  // Visiting the composer must not allocate an unused checkout.
  expect((await (await request.get(`/api/workspaces?projectId=${project.id}`)).json()).workspaces).toEqual([]);
  const { workspace } = await (await request.post('/api/workspaces', { data: { projectId: project.id, name: 'Separate effort' } })).json();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Separate effort', exact: true })).toBeVisible();
  await request.patch(`/api/workspaces/${workspace.id}`, { data: { visibility: 'project' } });
  await page.reload();
  await expect(page.getByRole('link', { name: 'Separate effort', exact: true })).toHaveCount(0);
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/sessions', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 400, json: { error: 'Submission captured without starting an agent' } });
  });
  await page.getByPlaceholder('Ask the agent to do something…').fill('Plan this project');
  await page.getByPlaceholder('Ask the agent to do something…').press('Enter');
  await expect.poll(() => submitted?.projectId).toBe(project.id);
  expect(submitted?.workspaceId).toBeUndefined();
});
