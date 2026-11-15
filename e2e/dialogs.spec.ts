import { expect, test, type Page } from '@playwright/test';
import { newWorkspace, SAMPLE } from './workspace';

/** Questions and messages that used to be window.confirm and window.alert: an alert dialog and toasts. */

async function editFile(page: Page, base: string, file: string) {
    await page.goto(`${base}/file/${file}`);
    const editor = page.locator('.cm-content');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type('edited ');
}

test('closing a tab with unsaved edits asks first, starting on Cancel', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await editFile(page, ws.base, 'README.md');
    const close = page.getByRole('button', { name: 'Close README.md (unsaved changes)' });
    await expect(close).toBeVisible();
    await close.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Discard unsaved changes to README.md?');
    // A destructive question starts on Cancel, and Escape answers it.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(close).toBeVisible();

    await close.click();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByRole('link', { name: 'README.md' })).toHaveCount(0);
});

test('a failure that used to be an alert shows as a toast, and the page stays usable', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await page.goto(`${ws.base}/file/README.md`);
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.route('**/api/**/notes**', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { error: 'Disk full' } }) : route.continue());
    const options = page.getByRole('button', { name: /options$/ }).first();
    await options.click({ force: true });
    await page.getByRole('menuitem', { name: 'New note' }).click();
    const toast = page.locator('[data-sonner-toast]');
    await expect(toast).toContainText('Couldn’t create the note');
    await expect(toast).toContainText('Disk full');
    // No modal was left behind.
    await page.locator('.cm-content').click();
    await page.keyboard.type('x');
    await expect(page.locator('.cm-content')).toContainText('x');
});
