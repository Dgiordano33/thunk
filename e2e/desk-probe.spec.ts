import { expect, test } from '@playwright/test';
import { HISTORY, seedSession } from './session';
import { newWorkspace, SAMPLE } from './workspace';
test('probe', async ({ page, request }) => {
    const ws = await newWorkspace(request, SAMPLE);
    const a = await seedSession(request, ws, HISTORY, { title: 'Probe' });
    await page.goto(a.href);
    await expect(page.getByText('Now run the tests.')).toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '.context/session-mobile/desktop-before.png' });
    console.log(JSON.stringify(await page.evaluate(() => {
        const r = (s: string) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
        return { ih: innerHeight, ta: r('textarea'), form: r('form'), group: r('[data-slot=input-group]') };
    })));
});
