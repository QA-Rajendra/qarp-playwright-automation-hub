'use strict';

const { expect, test } = require('./support/runner-fixture.cjs');

test('optimization advisor shows findings and filters them safely', async ({ page, runner }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route('**/*', route => {
    const requestUrl = new URL(route.request().url());
    return requestUrl.origin === runner.baseUrl ? route.continue() : route.abort();
  });
  await page.route('**/optimization-analysis', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      projectName: 'advisor-fixture',
      scannedAt: new Date().toISOString(),
      scan: { filesAnalyzed: 2, entriesVisited: 4, truncated: false, maxDepth: 16 },
      warnings: [],
      findings: [
        {
          ruleId: 'QARP-PW-001',
          category: 'Playwright reliability',
          priority: 'medium',
          file: 'tests/login.spec.js',
          line: 12,
          evidence: 'await page.waitForTimeout(1000);',
          summary: 'Fixed test delay may slow runs and still be flaky.',
          recommendation: 'Wait for a specific page state.',
          confidence: 0.93
        },
        {
          ruleId: 'QARP-PW-002',
          category: 'Playwright maintainability',
          priority: 'low',
          file: 'tests/search.spec.js',
          line: 8,
          evidence: '<img src=x onerror=alert(1)>',
          summary: 'This selector depends on DOM structure and may break when markup changes.',
          recommendation: 'Prefer a user-facing locator.',
          confidence: 0.78
        }
      ]
    })
  }));

  await page.goto(`${runner.baseUrl}/pages/optimization-advisor.html`);
  await expect(page.getByRole('heading', { name: 'Code Optimization Advisor' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sage');
  await page.getByRole('button', { name: 'Scan active project' }).click();
  await expect(page.getByRole('status')).toContainText('2 source files scanned');
  await expect(page.locator('.finding')).toHaveCount(2);
  await expect(page.locator('#totalCount')).toHaveText('2');
  await expect(page.locator('.finding img')).toHaveCount(0);

  await page.getByLabel('Priority').selectOption('medium');
  await expect(page.locator('.finding')).toHaveCount(1);
  await page.getByLabel('Priority').selectOption('all');
  await page.getByLabel('Category').selectOption('Playwright maintainability');
  await expect(page.locator('.finding')).toHaveCount(1);
  await expect(page.locator('.finding')).toContainText('tests/search.spec.js:8');
});

test('optimization advisor shows a clean-project empty state', async ({ page, runner }) => {
  await page.route('**/*', route => {
    const requestUrl = new URL(route.request().url());
    return requestUrl.origin === runner.baseUrl ? route.continue() : route.abort();
  });
  await page.route('**/optimization-analysis', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      projectName: 'clean-fixture',
      scannedAt: new Date().toISOString(),
      scan: { filesAnalyzed: 1, entriesVisited: 2, truncated: false, maxDepth: 16 },
      warnings: [],
      findings: []
    })
  }));
  await page.goto(`${runner.baseUrl}/pages/optimization-advisor.html`);
  await page.getByRole('button', { name: 'Scan active project' }).click();
  await expect(page.getByText('No suggestions found in the supported checks.')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('0 suggestions found');
});
