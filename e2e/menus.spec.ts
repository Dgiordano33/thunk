import { expect, test, type Page } from '@playwright/test';
import { newWorkspace, SAMPLE } from './workspace';

/** Right-click menus on file tabs and tree rows, and middle-click to close a tab. */

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const tab = (page: Page, name: string) => page.getByRole('link', { name, exact: true }).and(page.locator('[title]'));
const fileTabs = (page: Page) => page.getByRole('navigation', { name: 'Sessions' }).getByRole('link').filter({ hasNot: page.getByText('New chat') });

async function openAll(page: Page, base: string, files: string[]) {
    for (const f of files) {
        await page.goto(`${base}/file/${f}`);
        await expect(page.locator('.cm-content')).toBeVisible();
    }
}
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test('Close others and Close to the right, from a tab’s menu', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await openAll(page, ws.base, ['README.md', 'package.json', 'src/index.ts']);
    await expect(fileTabs(page)).toHaveText(['README.md', 'package.json', 'index.ts']);
    await tab(page, 'README.md').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close to the right' }).click();
    // The open tab was closed, so the one kept opens.
    await expect(fileTabs(page)).toHaveText(['README.md']);
    await expect(page).toHaveURL(new RegExp(`${ws.base}/file/README\\.md`));

    await openAll(page, ws.base, ['package.json', 'src/index.ts']);
    await tab(page, 'package.json').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close others' }).click();
    await expect(fileTabs(page)).toHaveText(['package.json']);
    await expect(page).toHaveURL(new RegExp(`${ws.base}/file/package\\.json`));
});

test('closing several tabs asks once about the unsaved ones', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await openAll(page, ws.base, ['README.md', 'package.json']);
    await page.locator('.cm-content').click();
    await page.keyboard.type('edited ');
    await tab(page, 'README.md').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close others' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Discard unsaved changes to package.json?');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(fileTabs(page)).toHaveText(['README.md', 'package.json']);
});

test('middle-click closes a tab', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await openAll(page, ws.base, ['README.md', 'package.json']);
    await tab(page, 'README.md').click({ button: 'middle' });
    await expect(fileTabs(page)).toHaveText(['package.json']);
    // It didn't open a second browser tab either.
    expect(page.context().pages()).toHaveLength(1);
});

test('Copy path and Reveal in files, from a tab’s menu', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await openAll(page, ws.base, ['src/util/math.ts']);
    await tab(page, 'math.ts').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy path' }).click();
    expect(await clipboard(page)).toBe('src/util/math.ts');
    await expect(page.locator('[data-sonner-toast]')).toContainText('Copied path');
    await tab(page, 'math.ts').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Reveal in files' }).click();
    await expect(page).toHaveURL(/tab=files/);
    await expect(page.getByRole('treeitem', { name: 'math.ts', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('a tree row’s menu opens files, copies paths and collapses folders', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await page.goto(`${ws.base}/file/src/util/math.ts?tab=files`);
    const tree = page.getByRole('tree', { name: 'Workspace files' });
    await expect(tree.getByRole('treeitem', { name: 'math.ts', exact: true })).toBeVisible();
    await tree.getByRole('treeitem', { name: 'strings.ts', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy full path' }).click();
    expect(await clipboard(page)).toBe(`${ws.cwd}/src/util/strings.ts`);
    await tree.getByRole('treeitem', { name: 'README.md', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${ws.base}/file/README\\.md`));
    // Folders have no Open.
    await tree.getByRole('treeitem', { name: 'src', exact: true }).locator(':scope > [data-slot="tree-label"]').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Open', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Collapse all folders' }).click();
    await expect(tree.getByRole('treeitem', { name: 'src', exact: true })).toHaveAttribute('aria-expanded', 'false');
});
