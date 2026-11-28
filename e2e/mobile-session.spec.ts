import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { HISTORY, seedSession } from './session';
import { newWorkspace, SAMPLE } from './workspace';

/** The session screen on a phone, against scripted sessions (no agent runs). */

const SHOTS = '.context/session-mobile';
mkdirSync(SHOTS, { recursive: true });

async function fits(page: Page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('one header, a usable composer, and an approval reachable from anywhere in the timeline', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    const session = await seedSession(request, ws, HISTORY, { title: 'Make the session screen work on a phone' });
    await page.goto(session.href);
    await expect(page.getByText('Now run the tests.')).toBeVisible({ timeout: 60000 });
    await fits(page);

    // One bar: navigation, the session switcher, workspace tools. The title isn't repeated below it.
    for (const name of ['Navigation', 'Sessions', 'Workspace tools']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Make the session screen work on a phone' })).toHaveCount(0);
    const timeline = await page.getByRole('log').boundingBox();
    expect(timeline!.y).toBeLessThan(60);

    // The message box is full width and on screen, with model and mode beside the send button.
    const message = page.getByRole('textbox', { name: 'Message' });
    await expect(message).toBeInViewport({ ratio: 1 });
    expect((await message.boundingBox())!.width).toBeGreaterThan(300);
    await expect(page.getByRole('combobox').filter({ hasText: 'Sonnet 5.5' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeInViewport();
    await expect(page.getByRole('combobox').filter({ hasText: 'Ask before edits' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/after-bottom.png` });

    // Return adds a line on a touch keyboard; nothing is sent.
    await message.fill('first');
    await message.press('Enter');
    await expect(message).toHaveValue('first\n');
    await message.fill('');

    // Scrolled away from the approval, a bar above the composer brings it back.
    const allow = page.getByRole('button', { name: 'Allow', exact: true });
    await expect(page.getByRole('status').filter({ hasText: 'needs your permission' })).toHaveCount(0);
    await page.getByText('Make the session screen work on a phone, and check').scrollIntoViewIfNeeded();
    const bar = page.getByRole('status').filter({ hasText: 'Bash needs your permission' });
    await expect(bar).toBeVisible();
    await fits(page);
    await page.screenshot({ path: `${SHOTS}/after-top.png` });
    await bar.getByRole('button', { name: 'Review' }).tap();
    await expect(allow).toBeInViewport();
    await expect(bar).toHaveCount(0);

    // Stop is a button on the composer while the agent works, since there is no Esc.
    await allow.tap();
    await expect(allow).toHaveCount(0);
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeVisible();
    await stop.tap();
    await expect(stop).toHaveCount(0);
});
