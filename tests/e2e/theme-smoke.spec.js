'use strict';

const { expect, test } = require('./support/runner-fixture.cjs');

test('Sage is the initial theme and the theme picker persists a supported choice', async ({ page, runner }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.tailwind = window.tailwind || {};
  });
  await page.route('**/*', route => {
    const requestUrl = new URL(route.request().url());
    return requestUrl.origin === runner.baseUrl
      ? route.continue()
      : route.abort();
  });

  await page.goto(runner.baseUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sage');

  await page.locator('#themeBtn').click();
  await page.locator('#themeMenu [data-theme="default"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'default');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('app-theme'))).toBe('default');

  await page.goto(`${runner.baseUrl}/pages/mcp-inspector.html`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'default');
  await expect(page.locator('#themeMenu [data-theme="blue"]')).toHaveCount(0);
  await expect(page.locator('#themeMenu [data-theme="sage"]')).toHaveCount(1);

  expect(pageErrors).toEqual([]);
});
