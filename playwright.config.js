const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    trace: 'on',
    recordHar: {
      path: 'test-results/api-traffic.har',
      mode: 'full',
      content: 'embed'
    }
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } }
  ]
});
