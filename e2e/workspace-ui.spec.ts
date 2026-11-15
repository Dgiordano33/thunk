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
