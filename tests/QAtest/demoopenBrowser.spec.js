const { test, expect } = require('@playwright/test');

test('Demo Open Browser - example.com', async ({ page }) => {
  // Navigate to website
  await page.goto('https://example.com');

  // Verify page loaded
  await expect(page).toHaveTitle(/Example/);

  // Wait for 5 seconds so you can see the open browser before it closes
  await page.waitForTimeout(5000);
});

// Standalone execution support: node tests/QAtest/demoopenBrowser.spec.js
if (require.main === module) {
  const { chromium } = require('playwright');
  (async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto('https://example.com');
    await page.waitForTimeout(5000);
    await browser.close();
  })();
}
