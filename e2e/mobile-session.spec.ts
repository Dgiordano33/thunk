import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { HISTORY, QUESTION, seedSession } from './session';
import { newWorkspace, SAMPLE } from './workspace';

test('baseline screenshots', async ({ page, request }) => {
    test.setTimeout(180000);
    mkdirSync('.context/session-mobile', { recursive: true });
    const ws = await newWorkspace(request, SAMPLE);
    const a = await seedSession(request, ws, HISTORY, { title: 'Make the session screen work on a phone' });
    const q = await seedSession(request, ws, QUESTION, { title: 'Tidy the header' });
    const tag = process.env.SHOT ?? 'before';
    await page.goto(a.href);
    await expect(page.getByText('Now run the tests.')).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `.context/session-mobile/${tag}-bottom.png` });
    await page.getByText('Phone layout').first().scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector('[role=log]')?.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `.context/session-mobile/${tag}-top.png` });
    await page.goto(q.href);
    await expect(page.getByText('Which header should stay on phones?')).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `.context/session-mobile/${tag}-question.png` });
    console.log('overflow', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
});
