import { expect, test, type Page } from '@playwright/test';
import { newWorkspace, SAMPLE } from './workspace';

/** The workspace file tree: one tab stop, arrow keys, typing to find, folders that list on first open, links that open files. */

const tree = (page: Page) => page.getByRole('tree', { name: 'Workspace files' });
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true });
/** The name of the tree item with focus: its own label, not its children's. */
const focused = (page: Page) => page.evaluate(() => {
    const row = document.activeElement?.closest('[role="treeitem"]');
    return row?.querySelector(':scope > [data-slot="tree-label"]')?.textContent?.trim() ?? row?.textContent?.trim() ?? null;
});

async function openFiles(page: Page, base: string) {
    await page.goto(`${base}?tab=files`);
    await expect(item(page, 'README.md')).toBeVisible();
}

test('the tree is one tab stop, and arrows walk it, opening and closing folders', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await openFiles(page, ws.base);
    // Folders first, then files, alphabetically.
    await expect(tree(page).getByRole('treeitem')).toHaveText([/docs/, /src/, /package\.json/, /README\.md/]);
    await item(page, 'docs').focus();
    expect(await focused(page)).toBe('docs');
    await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe('src');
    await page.keyboard.press('ArrowRight');
    // Its children list on first open.
    await expect(item(page, 'index.ts')).toBeVisible();
    await expect(item(page, 'src')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowRight');
    expect(await focused(page)).toBe('util');
    await page.keyboard.press('ArrowRight');
    await expect(item(page, 'math.ts')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(item(page, 'math.ts')).toBeHidden();
    await page.keyboard.press('ArrowLeft');
    expect(await focused(page)).toBe('src');
    // Tab leaves the tree in one press.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="tree"]'))).toBe(false);
    await page.keyboard.press('Shift+Tab');
    expect(await focused(page)).toBe('src');
});

test('typing jumps to the item whose name starts with it', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await openFiles(page, ws.base);
    await item(page, 'docs').focus();
    await page.keyboard.type('re');
    expect(await focused(page)).toBe('README.md');
    await page.waitForTimeout(800);
    await page.keyboard.type('p');
    expect(await focused(page)).toBe('package.json');
});

test('Enter on a file opens it in a tab and marks it as the current page', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await openFiles(page, ws.base);
    await item(page, 'src').focus();
    await page.keyboard.press('ArrowRight');
    await expect(item(page, 'index.ts')).toBeVisible();
    await page.keyboard.press('ArrowDown'); // util
    await page.keyboard.press('ArrowDown'); // index.ts
    expect(await focused(page)).toBe('index.ts');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${ws.base}/file/src/index\\.ts`));
    await expect(page.getByRole('link', { name: 'index.ts' }).first()).toBeVisible();
    await expect(item(page, 'index.ts')).toHaveAttribute('aria-current', 'page');
    // The open folder stays open across the navigation.
    await expect(item(page, 'src')).toHaveAttribute('aria-expanded', 'true');
});

test('files are real links, so they can open in a new tab', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await openFiles(page, ws.base);
    await expect(item(page, 'README.md').getByRole('link')).toHaveAttribute('href', new RegExp(`${ws.base}/file/README\\.md`));
});

test('an empty folder says so', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await openFiles(page, ws.base);
    await item(page, 'docs').click();
    await expect(tree(page).getByText('Empty')).toBeVisible();
});

test('opening a nested file straight from a link reveals it in the tree', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    await page.goto(`${ws.base}/file/src/util/math.ts?tab=files`);
    await expect(item(page, 'math.ts')).toHaveAttribute('aria-current', 'page');
    await expect(item(page, 'util')).toHaveAttribute('aria-expanded', 'true');
    // And it holds the tree's one tab stop, so Tab lands on it first.
    const stop = tree(page).locator('[tabindex="0"]');
    await expect(stop).toHaveCount(1);
    await stop.focus();
    expect(await focused(page)).toBe('math.ts');
});
