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
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        recordHar: { path: 'test-results/api-traffic-chromium.har', mode: 'full', content: 'embed' }
      }
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        recordHar: { path: 'test-results/api-traffic-firefox.har', mode: 'full', content: 'embed' }
      }
    },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        recordHar: { path: 'test-results/api-traffic-webkit.har', mode: 'full', content: 'embed' }
      }
    }
  ]
});
