'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const QarpJsonReporter = require('../../qarp-json-reporter.cjs');

function testCase(root, title, titlePath = ['suite', title]) {
  return {
    title,
    titlePath: () => titlePath,
    location: { file: path.join(root, 'tests', 'example.spec.js') },
    parent: { project: () => ({ name: 'chromium' }) }
  };
}

function attempt(status, retry, message = '') {
  return {
    status,
    retry,
    duration: 12,
    errors: message ? [{ message, stack: message, location: null }] : []
  };
}

test('writes structured test outcomes and identifies retry-proven flaky results', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qarp-run-insights-'));
  const outputFile = path.join(root, '.qarp-run-results', 'run_test.json');
  try {
    const reporter = new QarpJsonReporter({ outputFile, projectRoot: root, runId: 'run_test' });
    reporter.onBegin();
    reporter.onTestEnd(testCase(root, 'retried test'), attempt('failed', 0, 'token=secret-value'));
    reporter.onTestEnd(testCase(root, 'retried test'), attempt('passed', 1));
    reporter.onTestEnd(testCase(root, 'failed test'), attempt('failed', 0, 'Cookie: session=private-value'));
    reporter.onTestEnd(testCase(root, 'skipped test'), attempt('skipped', 0));
    await reporter.onEnd({ status: 'failed' });

    const report = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.runId, 'run_test');
    assert.equal(report.tests.length, 3);

    const retried = report.tests.find(item => item.title === 'retried test');
    assert.equal(retried.status, 'passed');
    assert.equal(retried.flaky, true);
    assert.equal(retried.attempts.length, 2);
    assert.equal(retried.durationMs, 24);
    assert.match(retried.attempts[0].errors[0].message, /token=\[REDACTED\]/);

    const failed = report.tests.find(item => item.title === 'failed test');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.flaky, false);
    assert.equal(failed.failure.message, 'Cookie: [REDACTED]');
    assert.equal(report.tests.find(item => item.title === 'skipped test').status, 'skipped');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
