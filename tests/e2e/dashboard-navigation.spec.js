'use strict';

const { expect, test } = require('./support/runner-fixture.cjs');

test('dashboard links open every packaged local page and Quick Links toggle accessibly', async ({ page, runner }) => {
  test.setTimeout(90_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.tailwind = window.tailwind || {};
  });
  await page.route('**/*', route => {
    const requestUrl = new URL(route.request().url());
    return requestUrl.origin === runner.baseUrl
      ? route.continue()
      : route.abort();
  });

  const response = await page.goto(runner.baseUrl);
  expect(response.status()).toBe(200);
  await expect(page).toHaveTitle(/Automation Hub/);

  const quickLinksToggle = page.locator('#quickLinksToggle');
  await expect(quickLinksToggle).toHaveAttribute('aria-expanded', 'false');
  await quickLinksToggle.click();
  await expect(quickLinksToggle).toHaveAttribute('aria-expanded', 'true');

  const [historyResponse] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('#quickLinksPanel a[href="pages/history.html"]').click()
  ]);
  expect(historyResponse.status()).toBe(200);

  const localPages = await page.locator('a[href$=".html"]').evaluateAll(anchors =>
    [...new Set(anchors.map(anchor => anchor.href))]
      .filter(href => new URL(href).origin === window.location.origin)
  );
  expect(localPages.length).toBeGreaterThan(0);

  for (const localPage of localPages) {
    const pageResponse = await page.goto(localPage, { waitUntil: 'domcontentloaded' });
    expect(pageResponse.status(), `Expected ${localPage} to load`).toBe(200);
  }

  expect(pageErrors).toEqual([]);
});
