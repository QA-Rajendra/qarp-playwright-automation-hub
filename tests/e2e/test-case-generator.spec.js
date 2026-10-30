'use strict';

const { expect, test } = require('./support/runner-fixture.cjs');

async function openGenerator(page, runner) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('test-case-generator-initialized')) {
      localStorage.clear();
      sessionStorage.setItem('test-case-generator-initialized', '1');
    }
  });
  await page.route('**/*', route => {
    const requestUrl = new URL(route.request().url());
    return requestUrl.origin === runner.baseUrl ? route.continue() : route.abort();
  });
  await page.goto(`${runner.baseUrl}/pages/test-case-generator.html`);
  await expect(page.getByRole('heading', { name: 'Test Case Generator' })).toBeVisible();
}

test('generates, filters, edits, persists and exports screen-control test cases', async ({ page, runner }) => {
  await openGenerator(page, runner);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sage');
  await expect(page.locator('#fieldRows .field-row')).toHaveCount(4);
  await expect(page.getByText('124 controls shown in 8 categories')).toBeVisible();

  await page.getByLabel('Password required error').fill('Please enter your password');
  await page.getByRole('button', { name: 'Quick rule: disable button if a required field is empty' }).click();
  await expect(page.locator('#conditionList .condition-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Generate test cases' }).click();
  await expect(page.locator('.test-card')).toHaveCount(34);
  await expect(page.locator('.test-results thead tr')).toContainText('Scenario');
  await expect(page.locator('.test-results thead tr')).toContainText('IF / ELSE condition');
  await expect(page.locator('#testSummary')).toContainText('34 test cases');
  await expect(page.locator('#testSummary')).toContainText('4 positive');
  await expect(page.locator('.test-card').first()).toContainText('TC001');
  await expect(page.locator('#status')).toContainText('4 controls × 8 types plus 2 IF/ELSE condition cases');

  await page.getByRole('button', { name: 'Boundary', exact: true }).click();
  await expect(page.locator('.test-card')).toHaveCount(4);
  await expect(page.locator('.test-card').first()).toContainText('Boundary');
  await page.getByRole('button', { name: 'Positive', exact: true }).click();
  await expect(page.locator('.test-card')).toHaveCount(4);

  const firstTitle = page.locator('.test-card').first().getByLabel(/Test case title/);
  await firstTitle.fill('<img src=x onerror=alert(1)>');
  await expect(page.locator('.test-card img')).toHaveCount(0);
  await expect(page.locator('#saveState')).toHaveText('Saved locally', { timeout: 5000 });
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await csvDownload).suggestedFilename()).toBe('qarp-screen-test-cases.csv');

  await page.reload();
  await expect(page.locator('#fieldRows .field-row')).toHaveCount(4);
  await expect(page.locator('.test-card')).toHaveCount(34);
  await expect(page.locator('.test-card').first().getByLabel(/Test case title/))
    .toHaveValue('<img src=x onerror=alert(1)>');
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  expect((await jsonDownload).suggestedFilename()).toBe('qarp-screen-test-cases.json');
});

test('filters the control catalog, adds controls, and supports registration examples', async ({ page, runner }) => {
  await openGenerator(page, runner);
  await page.getByLabel('Filter controls by category').selectOption('Choice');
  await page.getByLabel('Search control name').fill('country');
  await expect(page.getByText('1 controls shown in 8 categories')).toBeVisible();
  await page.getByRole('button', { name: 'Add all (apply to list)' }).click();
  await expect(page.locator('#fieldRows .field-row')).toHaveCount(5);
  await expect(page.getByLabel('Field name').last()).toHaveValue('Country');

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Load registration example' }).click();
  await expect(page.locator('#fieldRows .field-row')).toHaveCount(6);
  await expect(page.getByLabel('Field name').nth(3)).toHaveValue('Confirm password');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear all fields' }).click();
  await expect(page.locator('#fieldRows .field-row')).toHaveCount(0);
});

test('validates missing condition targets and saves edited rules', async ({ page, runner }) => {
  await openGenerator(page, runner);
  await page.getByRole('button', { name: 'Add condition' }).click();
  await expect(page.locator('#conditionList .condition-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Generate test cases' }).click();
  await expect(page.locator('#status')).toContainText('test cases');
  await expect(page.locator('.test-card')).toHaveCount(34);
  await page.getByRole('button', { name: 'Condition', exact: true }).click();
  await expect(page.locator('.test-card')).toHaveCount(2);
  await expect(page.locator('.test-card').first().getByLabel(/Test case title/)).toHaveValue('Condition 1 — TRUE: Username');
  await expect(page.locator('.test-card').last().getByLabel(/Test case title/)).toHaveValue('Condition 1 — ELSE: Username');
  await expect(page.locator('.test-card').first().locator('.result-condition')).toContainText('IF');
});

test('marks generated cases stale when screen rules change and blocks export', async ({ page, runner }) => {
  await openGenerator(page, runner);
  await page.getByRole('button', { name: 'Generate test cases' }).click();
  await expect(page.locator('#exportCsv')).toBeEnabled();
  await page.getByLabel('Password rules').fill('10,24');
  await expect(page.locator('#exportCsv')).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Regenerate test cases before exporting');
  await page.getByRole('button', { name: 'Generate test cases' }).click();
  await expect(page.locator('#exportCsv')).toBeEnabled();
});

test('generates, filters, edits, and exports a form-level decision table matrix', async ({ page, runner }) => {
  await openGenerator(page, runner);
  await page.getByRole('button', { name: 'Generate decision table matrix' }).click();
  await expect(page.locator('.test-card')).toHaveCount(27);
  await expect(page.locator('#testSummary')).toContainText('27 decision table matrix');
  await expect(page.locator('.test-card').first()).toContainText('M001');
  await expect(page.locator('.test-card').first().getByLabel(/Test case title/)).toHaveValue('All fields valid');
  await expect(page.locator('.test-card').first().getByLabel(/Expected result/)).toHaveValue('Form submits successfully');

  await page.getByRole('button', { name: 'Decision Table Matrix', exact: true }).click();
  await expect(page.locator('.test-card')).toHaveCount(27);
  await expect(page.locator('.test-card').nth(1).getByLabel(/Expected result/)).toHaveValue(/Username: Invalid username/);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('qarp-screen-test-cases.csv');
});

test('previews field-change conditions and resets preview values', async ({ page, runner }) => {
  await openGenerator(page, runner);
  const login = page.getByRole('button', { name: 'Login', exact: true });
  await expect(login).toBeEnabled();
  await page.getByRole('button', { name: 'Quick rule: disable button if a required field is empty' }).click();
  await expect(login).toBeDisabled();
  await page.locator('#previewFields input').nth(0).fill('qa-user');
  await expect(login).toBeDisabled();
  await page.locator('#previewFields input').nth(1).fill('valid-password');
  await expect(login).toBeEnabled();
  await page.getByRole('button', { name: 'Reset preview' }).click();
  await expect(page.locator('#previewFields input').nth(0)).toHaveValue('');
  await expect(login).toBeDisabled();
});

test('applies button-click conditions only when the preview action is clicked', async ({ page, runner }) => {
  await openGenerator(page, runner);
  const login = page.getByRole('button', { name: 'Login', exact: true });
  await page.getByRole('button', { name: 'Quick rule: disable button if a required field is empty' }).click();
  await page.getByLabel('Condition apply timing').selectOption('On button click');
  await expect(login).toBeEnabled();
  await login.click();
  await expect(login).toBeDisabled();
  await expect(page.locator('#previewStatus')).toContainText('disabled by a condition');
});

test('evaluates page-load conditions against the initial preview values', async ({ page, runner }) => {
  await openGenerator(page, runner);
  const login = page.getByRole('button', { name: 'Login', exact: true });
  await page.getByRole('button', { name: 'Quick rule: disable button if a required field is empty' }).click();
  await page.getByLabel('Condition apply timing').selectOption('On page load');
  await expect(login).toBeDisabled();
  await page.locator('#previewFields input').nth(0).fill('qa-user');
  await page.locator('#previewFields input').nth(1).fill('valid-password');
  await expect(login).toBeDisabled();
});
