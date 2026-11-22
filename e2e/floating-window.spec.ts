import { test, expect } from '@playwright/test';

for (const route of ['notes', 'inbox']) {
  test(`${route} window moves, resizes, maximizes and resets`, async ({ page }) => {
    await page.goto(`/${route}`);
    const frame = page.locator('[data-floating-window]');
    await expect(frame).toBeVisible();
    const initial = (await frame.boundingBox())!;
    // Shrink from the left so there is room to move in either direction.
    const edge = await frame.locator('[data-window-resize="w"]').boundingBox();
    await page.mouse.move(edge!.x + edge!.width / 2, edge!.y + edge!.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge!.x + 200, edge!.y + edge!.height / 2, { steps: 10 });
    await page.mouse.up();
    const resized = (await frame.boundingBox())!;
    expect(resized.width).toBeLessThan(initial.width - 150);
    const bar = await frame.locator('[data-window-drag]').first().boundingBox();
    await page.mouse.move(bar!.x + 100, bar!.y + 20);
    await page.mouse.down();
    await page.mouse.move(bar!.x, bar!.y + 20, { steps: 10 });
    await page.mouse.up();
    expect((await frame.boundingBox())!.x).toBeLessThan(resized.x - 80);
    const moved = (await frame.boundingBox())!;
    await frame.getByRole('button', { name: 'Maximize window', exact: true }).click();
    await expect(frame).toHaveAttribute('data-maximized', 'true');
    expect((await frame.boundingBox())!.width).toBeGreaterThan(moved.width);
    await frame.getByRole('button', { name: 'Restore window', exact: true }).click();
    expect((await frame.boundingBox())!.width).toBeCloseTo(moved.width, 0);
    await page.setViewportSize({ width: 800, height: 600 });
    await expect.poll(async () => { const box = (await frame.boundingBox())!; return box.x + box.width; }).toBeLessThanOrEqual(800);
    await page.setViewportSize({ width: 1400, height: 900 });
    await frame.getByRole('button', { name: 'Reset window layout' }).click();
    expect((await frame.boundingBox())!.width).toBeCloseTo(initial.width, 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(frame.getByRole('button', { name: 'Maximize window' })).toBeHidden();
    await expect(frame.locator('[data-window-resize]')).toHaveCount(0);
  });
}

test('project panel title bar supports keyboard movement and resizing', async ({ page, request }) => {
  const { newBoard } = await import('./canvas');
  const project = await newBoard(request);
  await page.goto(`/projects/${project.slug}/settings`);
  const frame = page.locator('[data-floating-window]');
  const title = frame.locator('[data-window-drag]');
  await expect(title).toBeVisible();
  const before = (await frame.boundingBox())!;
  await title.focus();
  await title.press('ArrowLeft');
  expect((await frame.boundingBox())!.x).toBeCloseTo(before.x - 16, 0);
  await title.press('Shift+ArrowLeft');
  expect((await frame.boundingBox())!.width).toBeCloseTo(before.width - 16, 0);
  await title.dblclick({ position: { x: 100, y: 15 } });
  await expect(frame).toHaveAttribute('data-maximized', 'true');
  await frame.getByRole('button', { name: 'Restore window', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
});
