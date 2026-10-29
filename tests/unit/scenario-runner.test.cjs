'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  getScenarioArtifact,
  redactScenarioText,
  validateScenarioInput
} = require('../../qarp-scenario-runner.cjs');

test('validates and normalizes a scenario capture request', () => {
  assert.deepEqual(validateScenarioInput({
    url: 'https://example.test/path',
    prompt: 'Check the landing page',
    browser: 'webkit'
  }), {
    url: 'https://example.test/path',
    prompt: 'Check the landing page',
    browser: 'webkit'
  });
});

test('rejects invalid URLs, embedded credentials, unsupported browsers, and empty notes', () => {
  for (const input of [
    { url: 'javascript:alert(1)', prompt: 'capture' },
    { url: 'https://user:pass@example.test', prompt: 'capture' },
    { url: 'https://example.test', prompt: 'capture', browser: 'edge' },
    { url: 'https://example.test', prompt: ' ' }
  ]) {
    assert.throws(() => validateScenarioInput(input), error => error.statusCode === 400);
  }
});

test('limits scenario note size and redacts common credential strings', () => {
  assert.throws(() => validateScenarioInput({
    url: 'https://example.test',
    prompt: 'x'.repeat(4001)
  }), error => error.statusCode === 400);
  assert.equal(
    redactScenarioText('https://example.test/?access_token=hidden'),
    'https://example.test/?access_token=[REDACTED]'
  );
  assert.equal(redactScenarioText('Authorization: Bearer abc.def'), 'Authorization: [REDACTED]');
});

test('serves only known artifact names inside the run folder', t => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qarp-scenario-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const screenshotPath = path.join(outputDir, 'screenshot.png');
  fs.writeFileSync(screenshotPath, Buffer.from([137, 80, 78, 71]));

  assert.deepEqual(getScenarioArtifact({ outputDir }, 'screenshot'), {
    filePath: screenshotPath,
    size: 4,
    contentType: 'image/png'
  });
  assert.throws(
    () => getScenarioArtifact({ outputDir }, '../package.json'),
    error => error.statusCode === 400
  );
  assert.throws(
    () => getScenarioArtifact({ outputDir }, 'video'),
    error => error.statusCode === 404
  );
});
