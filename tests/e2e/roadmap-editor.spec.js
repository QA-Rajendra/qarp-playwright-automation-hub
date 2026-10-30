'use strict';

const { expect, test } = require('./support/runner-fixture.cjs');

test('learning roadmap opens tool notes and saves added tools and key point edits', async ({ page, runner }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('roadmap-e2e-initialized')) {
      localStorage.clear();
      sessionStorage.setItem('roadmap-e2e-initialized', '1');
    }
    window.tailwind = window.tailwind || {};
  });
  await page.route('**/*', route => {
    const requestUrl = new URL(route.request().url());
    return requestUrl.origin === runner.baseUrl
      ? route.continue()
      : route.abort();
  });

  await page.goto(`${runner.baseUrl}/pages/qa-roadmap.html`);
  await expect(page.getByRole('heading', { name: 'QA Learning Roadmap' })).toBeVisible();
  await expect(page.locator('.level-row')).toHaveCount(9);
  await expect(page.locator('.level-row').first()).toHaveAttribute('data-level', '8');
  await expect(page.locator('.level-row').last()).toHaveAttribute('data-level', '0');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sage');
  await expect(page.locator('#themeToggle')).toHaveCount(0);
  await expect(page.locator('.level-row[data-level="0"] .cube-front')).toHaveText('Level 0');
  await expect(page.locator('.level-row[data-level="0"] .cube-side')).toHaveText('Foundation');
  await expect(page.locator('.level-row[data-level="8"] .cube-front')).toHaveText('Level 8');
  await expect(page.locator('.level-row[data-level="8"] .cube-side')).toHaveText('AI & Intelligence');
  await expect(page.locator('.level-row[data-level="0"] .cube')).toHaveCSS('animation-name', 'none');
  const labelCenterDifference = await page.locator('.level-row[data-level="2"] .cube-front span')
    .evaluate(front => {
      const side = document.querySelector('.level-row[data-level="2"] .cube-side span');
      return Math.abs(front.getBoundingClientRect().top + front.getBoundingClientRect().height / 2
        - side.getBoundingClientRect().top - side.getBoundingClientRect().height / 2);
    });
  expect(labelCenterDifference).toBeLessThan(0.5);
  await expect(page.getByRole('button', { name: 'ChatGPT notes' })).toBeVisible();

  await page.getByRole('button', { name: 'ChatGPT notes' }).click();
  await expect(page).toHaveURL(/#l8-0$/);
  await expect(page.getByRole('heading', { name: 'ChatGPT' })).toBeVisible();
  await expect(page.locator('.key-point')).toHaveCount(3);

  const editedPoint = `Reviewed point ${Date.now()}`;
  await page.locator('.key-point').first().getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Edit key point' }).fill(editedPoint);
  await page.getByRole('textbox', { name: 'Edit key point' }).press('Enter');
  await expect(page.getByText(editedPoint)).toBeVisible();

  await page.getByRole('link', { name: 'Back to roadmap' }).click();
  await expect(page.locator('.level-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Add a tool to Level 0' }).click();
  const addedName = `Learning tool ${Date.now()}`;
  await page.getByLabel('Tool name').fill(addedName);
  await page.getByLabel('Short description').fill('A tool added during the browser test.');
  await page.getByLabel('Key points (one per line)').fill('First point\nSecond point');
  await page.getByRole('button', { name: 'Add tool' }).click();
  await expect(page).toHaveURL(/#l0-a/);
  await expect(page.getByRole('heading', { name: addedName })).toBeVisible();
  await expect(page.locator('.key-point')).toHaveCount(2);
  expect(pageErrors).toEqual([]);

  await page.reload();
  await expect(page.getByRole('heading', { name: addedName })).toBeVisible();
  await page.getByRole('link', { name: 'Back to roadmap' }).click();
  await page.getByRole('button', { name: 'ChatGPT notes' }).click();
  await expect(page.getByText(editedPoint)).toBeVisible();
  expect(pageErrors).toEqual([]);
});
