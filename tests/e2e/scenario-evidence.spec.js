'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { expect, test } = require('./support/runner-fixture.cjs');

test('Inspector rejects invalid input, captures local evidence, and serves its artifacts', async ({ page, runner }, testInfo) => {
  test.setTimeout(120_000);
  const pageErrors = [];
  const scenarioIds = [];
  const fixtureServer = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>QARP Local Evidence Fixture</title><main>Local scenario fixture</main>');
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once('error', reject);
    fixtureServer.listen(0, '127.0.0.1', resolve);
  });

  try {
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => {
      const requestUrl = new URL(route.request().url());
      return requestUrl.hostname === '127.0.0.1' || requestUrl.hostname === 'localhost'
        ? route.continue()
        : route.abort();
    });
    await page.goto(`${runner.baseUrl}/pages/mcp-inspector.html`);
    await expect(page.locator('#sp')).toHaveClass(/connected/);

    await page.locator('[title="Capture Browser Scenario Evidence"]').click();
    await expect(page.locator('#aiScenarioModal')).toBeVisible();
    await page.locator('#aiScenarioUrl').fill('javascript:alert(1)');
    await page.locator('#aiScenarioPrompt').fill('Capture the page load for validation');
    await page.locator('#aiScenarioBrowser').selectOption(testInfo.project.name);

    const rejectedResponse = page.waitForResponse(response =>
      response.url().endsWith('/api/run-scenario') && response.status() === 400
    );
    await page.locator('#runScenarioBtn').click();
    await rejectedResponse;
    await expect(page.locator('#progressList')).toContainText(/HTTP|Only HTTP|valid absolute/i);

    await page.locator('#aiScenarioUrl').fill(`http://127.0.0.1:${fixtureServer.address().port}/fixture`);
    const startedResponse = page.waitForResponse(response =>
      response.url().endsWith('/api/run-scenario') && response.status() === 202
    );
    await page.locator('#runScenarioBtn').click();
    const started = await (await startedResponse).json();
    scenarioIds.push(started.id);

    const statusUrl = `${runner.baseUrl}/api/scenarios/${encodeURIComponent(started.id)}`;
    await expect.poll(async () => {
      const response = await page.request.get(statusUrl);
      if (!response.ok()) return `http-${response.status()}`;
      return (await response.json()).status;
    }, { timeout: 100_000, intervals: [500, 1000, 1500] }).toBe('completed');

    const statusResponse = await page.request.get(statusUrl);
    const run = await statusResponse.json();
    expect(run.report.title).toBe('QARP Local Evidence Fixture');
    expect(run.report.pageErrors).toEqual([]);
    expect(run.artifacts.screenshot).toBe(true);
    expect(run.artifacts.video).toBe(true);
    await expect(page.locator('#scenarioResult')).toContainText(/Evidence captured/);

    for (const [artifact, contentType] of [['screenshot', 'image/png'], ['video', 'video/webm']]) {
      const artifactResponse = await page.request.get(`${statusUrl}/artifacts/${artifact}`);
      expect(artifactResponse.status()).toBe(200);
      expect(artifactResponse.headers()['content-type']).toContain(contentType);
      expect((await artifactResponse.body()).length).toBeGreaterThan(0);
    }

    expect(pageErrors).toEqual([]);
  } finally {
    await new Promise(resolve => fixtureServer.close(resolve));
    for (const id of scenarioIds) {
      fs.rmSync(path.join(runner.projectRoot, '.qarp-scenario-runs', id), { recursive: true, force: true });
    }
    const scenarioRoot = path.join(runner.projectRoot, '.qarp-scenario-runs');
    if (fs.existsSync(scenarioRoot) && fs.readdirSync(scenarioRoot).length === 0) {
      fs.rmdirSync(scenarioRoot);
    }
  }
});
