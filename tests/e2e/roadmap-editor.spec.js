'use strict';

const { expect, test } = require('./support/runner-fixture.cjs');

test('roadmap actions can be added, saved to JSON, and removed again', async ({ page, runner }) => {
  test.setTimeout(60_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => { window.tailwind = window.tailwind || {}; });
  await page.route('**/*', route => {
    const requestUrl = new URL(route.request().url());
    return requestUrl.origin === runner.baseUrl
      ? route.continue()
      : route.abort();
  });

  const endpoint = `${runner.baseUrl}/api/qa-roadmap`;
  const baselineResponse = await page.request.get(endpoint);
  expect(baselineResponse.status()).toBe(200);
  const baseline = await baselineResponse.json();
  const marker = `Browser E2E roadmap entry ${Date.now()}`;
  let roadmapModified = false;

  try {
    await page.goto(`${runner.baseUrl}/pages/qa-roadmap.html`);
    await expect(page.getByRole('heading', { name: 'QA Maturity Roadmap' })).toBeVisible();
    await page.locator('#addItemButton').click();
    await page.locator('#itemLevel').selectOption('level-0');
    await page.locator('#itemTitle').fill(marker);
    await page.locator('#itemDescription').fill('Validate saving a roadmap action to the JSON file.');
    await page.locator('#itemOwner').fill('QA E2E');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText(marker)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save roadmap' })).toBeEnabled();

    await page.getByRole('button', { name: 'Save roadmap' }).click();
    roadmapModified = true;
    await expect(page.locator('#statusMessage')).toContainText(/Roadmap saved/);
    const savedResponse = await page.request.get(endpoint);
    expect(savedResponse.status()).toBe(200);
    const saved = await savedResponse.json();
    expect(saved.levels[0].items.some(item => item.title === marker)).toBe(true);

    page.once('dialog', dialog => dialog.accept());
    await page.locator('.roadmap-item').filter({ hasText: marker })
      .getByRole('button', { name: 'Delete roadmap action' }).click();
    await page.getByRole('button', { name: 'Save roadmap' }).click();
    await expect(page.locator('#statusMessage')).toContainText(/Roadmap saved/);
    const restoredResponse = await page.request.get(endpoint);
    const restored = await restoredResponse.json();
    expect(restored.levels[0].items.some(item => item.title === marker)).toBe(false);
    roadmapModified = false;
    expect(pageErrors).toEqual([]);
  } finally {
    if (roadmapModified) {
      await page.request.put(endpoint, {
        headers: { 'Content-Type': 'application/json' },
        data: baseline
      });
    }
  }
});
