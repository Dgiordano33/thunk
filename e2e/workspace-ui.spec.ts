import { expect, test } from '@playwright/test';
import { newWorkspace, SAMPLE } from './workspace';

/** shadcn pieces in the workspace: tooltips with their keys, and checkboxes. */

test('the editor’s Save shows a tooltip with its shortcut on keyboard focus', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await page.goto(`${ws.base}/file/README.md`);
    await page.locator('.cm-content').click();
    await page.keyboard.type('edited ');
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeEnabled();
    await save.focus();
    await page.keyboard.press('Shift');
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText('Save');
    await expect(tip.locator('[data-slot="kbd"]')).toHaveText('⌘S');
    // The unsaved mark is named, not just a dot.
    await expect(page.getByRole('img', { name: 'Unsaved changes' })).toBeVisible();
});

test('a task’s checkbox marks it done, by click or by Space', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await page.goto(`${ws.base}/file/README.md?tab=tasks`);
    const add = page.getByPlaceholder('Add a task…');
    for (const t of ['Write the changelog', 'Tag the release']) { await add.fill(t); await add.press('Enter'); }
    await page.getByRole('checkbox', { name: 'Mark Write the changelog done' }).click();
    // A done task moves into the collapsed done list, so look past what's shown.
    await expect(page.getByRole('checkbox', { name: 'Mark Write the changelog open', includeHidden: true })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Mark Tag the release done' }).press('Space');
    await expect(page.getByRole('checkbox', { name: 'Mark Tag the release open', includeHidden: true })).toBeChecked();
});

test('a resized panel comes back the same size after a reload, with no hydration or key errors', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' && /hydrat|same key/i.test(m.text())) errors.push(m.text().slice(0, 120)); });
    for (const tab of ['tasks', 'files']) await page.goto(`${ws.base}/file/README.md?tab=${tab}`);
    const sidebar = page.locator('#sidebar');
    const before = (await sidebar.boundingBox())!.width;
    const handle = page.locator('[data-slot="resizable-handle"]').first();
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + 200);
    await page.mouse.down();
    await page.mouse.move(h.x + 120, h.y + 200, { steps: 8 });
    await page.mouse.up();
    const resized = (await sidebar.boundingBox())!.width;
    expect(resized).toBeGreaterThan(before + 60);
    await expect.poll(async () => (await page.context().cookies()).some((c) => c.name.startsWith('react-resizable-panels_'))).toBe(true);
    await page.reload();
    await expect(page.locator('.cm-content')).toBeVisible();
    expect(Math.abs((await sidebar.boundingBox())!.width - resized)).toBeLessThan(3);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
});
