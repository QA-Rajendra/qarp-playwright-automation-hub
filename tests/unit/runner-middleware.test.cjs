'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { createRunnerServer, runnerMiddleware } = require('../../runner-server.js');

test('requires explicit opt-in before binding outside loopback', () => {
  assert.throws(
    () => createRunnerServer({ host: '0.0.0.0' }),
    /allowLan: true/
  );
});

function request(port, route, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: route,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('middleware serves runner APIs and injects its mount path into HTML', async t => {
  const middleware = runnerMiddleware({ projectRoot: path.resolve(__dirname, '../..') });
  const server = http.createServer((req, res) => {
    const mountPath = '/test-runner';
    if (!req.url.startsWith(mountPath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    req.baseUrl = mountPath;
    req.url = req.url.slice(mountPath.length) || '/';
    middleware(req, res, error => {
      res.writeHead(error ? 500 : 404, { 'Content-Type': 'text/plain' });
      res.end(error ? error.message : 'Not found');
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => middleware.close(resolve));
  });
  const port = server.address().port;

  const crossOrigin = await request(port, '/test-runner/structure', {
    headers: { Origin: 'https://untrusted.example' }
  });
  assert.equal(crossOrigin.statusCode, 403);

  const page = await request(port, '/test-runner/');
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /window\.__QARP_BASE_PATH__="\/test-runner"/);
  assert.equal(page.headers['access-control-allow-origin'], undefined);

  const structure = await request(port, '/test-runner/structure');
  assert.equal(structure.statusCode, 200);
  assert.ok(Array.isArray(JSON.parse(structure.body).tree));

  const invalidScenario = await request(port, '/test-runner/api/run-scenario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'javascript:alert(1)', prompt: 'capture' })
  });
  assert.equal(invalidScenario.statusCode, 400);

  const missingScenario = await request(
    port,
    '/test-runner/api/scenarios/00000000-0000-4000-8000-000000000000'
  );
  assert.equal(missingScenario.statusCode, 404);
  assert.match(missingScenario.body, /Scenario run not found/);
});
