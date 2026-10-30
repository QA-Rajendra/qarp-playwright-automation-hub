'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { analyzeOptimizationProject, analyzeSource } = require('../../qarp-optimization-advisor.cjs');
const { createRunnerServer, runnerMiddleware } = require('../../runner-server.js');

function createProject(t) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qarp-optimization-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  return projectRoot;
}

function request(port, route) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: route,
      method: 'GET'
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('reports fixed waits and fragile Playwright selectors with exact lines', () => {
  const findings = analyzeSource('tests/e2e/login.spec.ts', [
    "test('login', async ({ page }) => {",
    '  await page.waitForTimeout(1000);',
    "  await page.locator('div > button:nth-child(2)').click();",
    '});'
  ].join('\n'));

  assert.deepEqual(findings.map(finding => [finding.ruleId, finding.line]), [
    ['QARP-PW-001', 2],
    ['QARP-PW-002', 3]
  ]);
  findings.forEach(finding => {
    assert.ok(finding.file.startsWith('tests/'));
    assert.ok(finding.evidence);
    assert.ok(finding.recommendation);
    assert.ok(finding.confidence > 0 && finding.confidence <= 1);
  });
});

test('does not report fixed waits in comments, non-test source, or state-based waits', () => {
  const testFindings = analyzeSource('tests/login.spec.js', [
    '// await page.waitForTimeout(500);',
    'await page.waitForLoadState("domcontentloaded");'
  ].join('\n'));
  const sourceFindings = analyzeSource('src/login.js', 'await page.waitForTimeout(500);');
  assert.deepEqual(testFindings, []);
  assert.deepEqual(sourceFindings, []);
});

test('flags large test files, malformed source remains safe, and finding order is stable', () => {
  const largeFile = analyzeSource('e2e/large.spec.ts', Array(301).fill('test("case", () => {});').join('\n'));
  assert.deepEqual(largeFile.map(finding => [finding.ruleId, finding.line]), [['QARP-TEST-001', 1]]);
  assert.deepEqual(analyzeSource('tests/malformed.spec.js', 'test("broken", () => { \u0000 ;'), []);
  const source = [
    "test('a', async ({ page }) => { await page.waitForTimeout(1); });",
    "test('b', async ({ page }) => { await page.locator('main > button').click(); });"
  ].join('\n');
  assert.deepEqual(analyzeSource('tests/order.spec.js', source), analyzeSource('tests/order.spec.js', source));
});

test('scans only supported, non-ignored project source and reports oversized files', t => {
  const root = createProject(t);
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n');
  fs.writeFileSync(path.join(root, '.qarpignore'), 'ignored-by-qarp/\n');
  fs.mkdirSync(path.join(root, 'tests', 'e2e'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests', 'nested', 'ignored'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ignored'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ignored-by-qarp'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'sample'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'e2e', 'login.spec.js'), 'await page.waitForTimeout(200);');
  fs.writeFileSync(path.join(root, 'tests', 'nested', '.gitignore'), 'ignored/\n');
  fs.writeFileSync(path.join(root, 'tests', 'nested', 'ignored', 'nested.spec.js'), 'await page.waitForTimeout(200);');
  fs.writeFileSync(path.join(root, 'ignored', 'ignored.spec.js'), 'await page.waitForTimeout(200);');
  fs.writeFileSync(path.join(root, 'ignored-by-qarp', 'ignored.spec.js'), 'await page.waitForTimeout(200);');
  fs.writeFileSync(path.join(root, 'node_modules', 'sample', 'dependency.spec.js'), 'await page.waitForTimeout(200);');
  fs.writeFileSync(path.join(root, 'large.ts'), ' '.repeat(256 * 1024 + 1));

  const result = analyzeOptimizationProject(root);
  assert.equal(result.scan.filesAnalyzed, 1);
  assert.deepEqual(result.findings.map(finding => finding.file), ['tests/e2e/login.spec.js']);
  assert.ok(result.warnings.some(warning => warning.includes('large.ts')));
  assert.deepEqual(result.findings, analyzeOptimizationProject(root).findings);
});

test('orders project findings by priority, path, line, and rule', t => {
  const root = createProject(t);
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'c-large.spec.js'), Array(301).fill('test("case", () => {});').join('\n'));
  fs.writeFileSync(path.join(root, 'tests', 'b-selector.spec.js'), "await page.locator('main > button').click();");
  fs.writeFileSync(path.join(root, 'tests', 'a-wait.spec.js'), 'await page.waitForTimeout(100);');

  const findings = analyzeOptimizationProject(root).findings;
  assert.deepEqual(findings.map(finding => [finding.priority, finding.file, finding.ruleId]), [
    ['medium', 'tests/a-wait.spec.js', 'QARP-PW-001'],
    ['low', 'tests/b-selector.spec.js', 'QARP-PW-002'],
    ['low', 'tests/c-large.spec.js', 'QARP-TEST-001']
  ]);
});

test('optimization endpoint scans only the configured project and does not modify it', async t => {
  const root = createProject(t);
  const outside = createProject(t);
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  const sourceFile = path.join(root, 'tests', 'active.spec.js');
  fs.writeFileSync(sourceFile, 'await page.waitForTimeout(150);');
  fs.writeFileSync(path.join(outside, 'outside.spec.js'), 'await page.waitForTimeout(200);');
  const original = fs.readFileSync(sourceFile, 'utf8');

  const server = createRunnerServer({
    port: 0,
    host: '127.0.0.1',
    projectRoot: root,
    openBrowserOnStart: false
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await request(server.address().port, `/optimization-analysis?root=${encodeURIComponent(outside)}`);
  assert.equal(response.statusCode, 200);
  const result = JSON.parse(response.body);
  assert.equal(result.projectName, path.basename(root));
  assert.equal(result.findings[0].file, 'tests/active.spec.js');
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), original);

  const invalidMethod = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: '/optimization-analysis',
      method: 'POST'
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(invalidMethod, 405);
});

test('middleware denies remote optimization scans before starting its local server', async () => {
  const middleware = runnerMiddleware({ projectRoot: process.cwd() });
  let statusCode = 0;
  let responseBody = '';
  const response = {
    writeHead(status) { statusCode = status; },
    end(body) { responseBody = body; }
  };
  await middleware({
    url: '/optimization-analysis',
    method: 'GET',
    socket: { remoteAddress: '192.0.2.10' },
    headers: {}
  }, response, error => { throw error || new Error('Remote request unexpectedly continued.'); });

  assert.equal(statusCode, 403);
  assert.match(JSON.parse(responseBody).error, /local machine only/);
  await new Promise(resolve => middleware.close(resolve));
});
