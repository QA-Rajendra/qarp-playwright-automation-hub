#!/usr/bin/env node

/**
 * Playwright Automation Hub - Node.js Server & Middleware Module
 * 
 * ZERO external dependencies: uses only built-in Node.js modules (http, fs, path, os, child_process).
 * 
 * Can be used in 3 ways:
 * 1. CLI / Globally: playwright-hub (or npx / node runner-server.js)
 * 2. Node.js import: const { createRunnerServer } = require('./runner-server'); createRunnerServer({ port: 9300 });
 * 3. Express middleware: app.use('/test-runner', runnerMiddleware());
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const STATIC_ROOT = __dirname; // Current directory containing index.html, js/, assets/, pages/

// ── MIME Types ─────────────────────────────────────────────────────────────
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js':   'text/javascript; charset=UTF-8',
  '.mjs':  'text/javascript; charset=UTF-8',
  '.css':  'text/css; charset=UTF-8',
  '.svg':  'image/svg+xml',
  '.json': 'application/json; charset=UTF-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon'
};

// ── Job Manager ────────────────────────────────────────────────────────────
const runningJobs = new Map();
const HISTORY_FILE_NAME = '.pw-runner-history.json';
const HISTORY_MAX = 100;

function loadHistory(projectRoot) {
  const filePath = path.resolve(projectRoot, HISTORY_FILE_NAME);
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function appendHistory(projectRoot, entry) {
  const filePath = path.resolve(projectRoot, HISTORY_FILE_NAME);
  try {
    const list = loadHistory(projectRoot);
    list.unshift(entry);
    const trimmed = list.slice(0, HISTORY_MAX);
    fs.writeFileSync(filePath, JSON.stringify(trimmed, null, 2), 'utf8');
    return trimmed;
  } catch (_) {
    return [];
  }
}

function clearHistory(projectRoot) {
  const filePath = path.resolve(projectRoot, HISTORY_FILE_NAME);
  try {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

// ── API Traffic Extractor (Captures HTTP Requests & Responses from Tests) ──
const API_TRAFFIC_FILE = '.pw-api-traffic.json';

function loadApiTraffic(projectRoot) {
  const filePath = path.resolve(projectRoot, API_TRAFFIC_FILE);
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (_) {}

  const resPath = path.resolve(projectRoot, 'test-results', 'api-traffic.json');
  try {
    if (fs.existsSync(resPath)) {
      const data = JSON.parse(fs.readFileSync(resPath, 'utf8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (_) {}
  return [];
}

function clearApiTraffic(projectRoot) {
  try {
    const f1 = path.resolve(projectRoot, API_TRAFFIC_FILE);
    const f2 = path.resolve(projectRoot, 'test-results', 'api-traffic.json');
    if (fs.existsSync(f1)) fs.writeFileSync(f1, JSON.stringify([]), 'utf8');
    if (fs.existsSync(f2)) fs.writeFileSync(f2, JSON.stringify([]), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function extractApiTraffic(projectRoot) {
  const testResultsDir = path.resolve(projectRoot, 'test-results');
  if (!fs.existsSync(testResultsDir)) return [];

  const tempExtractDir = path.resolve(testResultsDir, '.tmp_trace_extract');
  const allTraffic = [];

  function findTraces(dir) {
    let list = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== '.tmp_trace_extract') {
          list = list.concat(findTraces(full));
        } else if (e.isFile() && e.name === 'trace.zip') {
          list.push(full);
        }
      }
    } catch (_) {}
    return list;
  }

  const traces = findTraces(testResultsDir);

  for (let idx = 0; idx < traces.length; idx++) {
    const tracePath = traces[idx];
    const testFolder = path.basename(path.dirname(tracePath));
    const destDir = path.join(tempExtractDir, `trace_${idx}`);

    try {
      if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
      fs.mkdirSync(destDir, { recursive: true });

      if (process.platform === 'win32') {
        execSync(`powershell -Command "Expand-Archive -LiteralPath '${tracePath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'ignore' });
      } else {
        execSync(`unzip -o -q "${tracePath}" -d "${destDir}"`, { stdio: 'ignore' });
      }

      const files = fs.readdirSync(destDir);
      const networkFiles = files.filter(f => f.endsWith('.network'));

      for (const nFile of networkFiles) {
        const nContent = fs.readFileSync(path.join(destDir, nFile), 'utf8');
        const lines = nContent.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'resource-snapshot' && entry.snapshot) {
              const snap = entry.snapshot;
              const req = snap.request || {};
              const res = snap.response || {};

              const reqHeaders = {};
              if (Array.isArray(req.headers)) {
                req.headers.forEach(h => { reqHeaders[h.name] = h.value; });
              }

              const resHeaders = {};
              if (Array.isArray(res.headers)) {
                res.headers.forEach(h => { resHeaders[h.name] = h.value; });
              }

              let requestBody = null;
              if (req.postData) {
                if (req.postData.text) {
                  try { requestBody = JSON.parse(req.postData.text); } catch (_) { requestBody = req.postData.text; }
                } else if (req.postData._file) {
                  const pFile = path.join(destDir, req.postData._file);
                  if (fs.existsSync(pFile)) {
                    try {
                      const raw = fs.readFileSync(pFile, 'utf8');
                      try { requestBody = JSON.parse(raw); } catch (_) { requestBody = raw; }
                    } catch (_) {}
                  }
                }
              }

              let responseBody = null;
              if (res.content) {
                if (res.content.text) {
                  try { responseBody = JSON.parse(res.content.text); } catch (_) { responseBody = res.content.text; }
                } else if (res.content._file) {
                  const resFilePath = path.join(destDir, res.content._file);
                  if (fs.existsSync(resFilePath)) {
                    try {
                      const raw = fs.readFileSync(resFilePath, 'utf8');
                      try { responseBody = JSON.parse(raw); } catch (_) { responseBody = raw; }
                    } catch (_) {}
                  }
                }
              }

              allTraffic.push({
                id: 'req_' + (allTraffic.length + 1),
                testSuite: testFolder,
                startedAt: snap.startedDateTime || new Date().toISOString(),
                durationMs: Math.round(snap.time || 0),
                method: req.method || 'GET',
                url: req.url || '',
                status: res.status || 0,
                statusText: res.statusText || '',
                resourceType: snap._resourceType || 'api',
                request: {
                  method: req.method || 'GET',
                  url: req.url || '',
                  headers: reqHeaders,
                  body: requestBody
                },
                response: {
                  status: res.status || 0,
                  statusText: res.statusText || '',
                  headers: resHeaders,
                  body: responseBody
                }
              });
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  try {
    if (fs.existsSync(tempExtractDir)) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
  } catch (_) {}

  try {
    const jsonPath = path.resolve(testResultsDir, 'api-traffic.json');
    fs.writeFileSync(jsonPath, JSON.stringify(allTraffic, null, 2), 'utf8');
    fs.writeFileSync(path.resolve(projectRoot, API_TRAFFIC_FILE), JSON.stringify(allTraffic, null, 2), 'utf8');
  } catch (_) {}

  return allTraffic;
}

// ── Test Explorer Scanner ──────────────────────────────────────────────────
function getStructure(projectRoot) {
  const IGNORED = new Set([
    'node_modules', '.git', 'allure-report', 'allure-results',
    'playwright-report', 'test-results', '.vscode', 'scratch'
  ]);

  function scanDir(dirPath, relPath, name) {
    if (!fs.existsSync(dirPath)) return null;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const files = [];
      const folders = [];

      for (const e of entries) {
        if (e.isFile() && /\.(spec|test)\.(js|ts|mjs|cjs)$/.test(e.name)) {
          files.push({ name: e.name, path: relPath ? `${relPath}/${e.name}` : e.name });
        }
      }

      for (const e of entries) {
        if (e.isDirectory() && !IGNORED.has(e.name)) {
          const subRel = relPath ? `${relPath}/${e.name}` : e.name;
          const sub = scanDir(path.join(dirPath, e.name), subRel, e.name);
          if (sub && (sub.files.length > 0 || sub.folders.length > 0)) {
            folders.push(sub);
          }
        }
      }

      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

      return {
        name: name || path.basename(dirPath),
        path: relPath || '.',
        files,
        folders,
        totalFiles: files.length + folders.reduce((sum, f) => sum + f.totalFiles, 0)
      };
    } catch (_) {
      return null;
    }
  }

  // Detect test directories:
  // 1. Check playwright.config (testDir property)
  const candidateDirs = new Set(['tests', 'test', 'e2e', 'specs', 'spec']);
  const configFiles = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'];
  for (const cfg of configFiles) {
    const p = path.resolve(projectRoot, cfg);
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf8');
        const m = content.match(/testDir\s*:\s*['"`]([^'"`]+)['"`]/);
        if (m && m[1]) {
          const cleanDir = m[1].replace(/^\.[\\\/]/, '').replace(/[\\\/]$/, '');
          if (cleanDir && cleanDir !== '.') candidateDirs.add(cleanDir);
        }
      } catch (_) {}
      break;
    }
  }

  const rootNodes = [];
  const foldersList = [];

  candidateDirs.forEach(dirName => {
    const targetDir = path.resolve(projectRoot, dirName);
    if (fs.existsSync(targetDir)) {
      const node = scanDir(targetDir, dirName, `${dirName} (root)`);
      if (node && (node.files.length > 0 || node.folders.length > 0)) {
        rootNodes.push(node);
        foldersList.push(node.path);
      }
    }
  });

  return { 
    tree: rootNodes, 
    folders: foldersList,
    projectName: path.basename(projectRoot),
    projectRoot: projectRoot
  };
}

// ── Project Parser from playwright.config ──────────────────────────────────
function getProjects(projectRoot) {
  const candidates = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'];
  const configPath = candidates.map(f => path.resolve(projectRoot, f)).find(p => fs.existsSync(p));

  if (!configPath) return ['chromium', 'firefox', 'webkit'];

  try {
    const src = fs.readFileSync(configPath, 'utf8');
    const startIdx = src.search(/projects\s*:\s*\[/);
    if (startIdx === -1) return ['chromium'];

    const openBracket = src.indexOf('[', startIdx);
    let depth = 0, i = openBracket, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '[') depth++;
      else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return ['chromium'];

    const block = src.slice(openBracket, end + 1);
    const names = [...block.matchAll(/name\s*:\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1]);
    return [...new Set(names)];
  } catch (_) {
    return ['chromium', 'firefox', 'webkit'];
  }
}

// ── Output Parser ──────────────────────────────────────────────────────────
function parseTestOutput(output, code) {
  const passMatch = output.match(/(\d+)\s+passed/);
  const failMatch = output.match(/(\d+)\s+failed/);
  const skipMatch = output.match(/(\d+)\s+skipped/);

  const passed = passMatch ? parseInt(passMatch[1]) : 0;
  const failed = failMatch ? parseInt(failMatch[1]) : 0;
  const skipped = skipMatch ? parseInt(skipMatch[1]) : 0;
  const total = passed + failed + skipped;

  const failedTests = [];
  output.split('\n').forEach(line => {
    const m = line.match(/^\s+\d+\)\s+(.+)/) || line.match(/✘|×|FAILED\s+(.+)/);
    if (m && m[1]) failedTests.push(m[1].trim());
  });

  return { code, passed, failed, skipped, total, failedTests };
}

// ── Port Finder (tries 9300–9305 by default) ──────────────────────────────
function findAvailablePort(startPort, endPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > endPort) {
        return reject(new Error(`All ports from ${startPort} to ${endPort} are in use.`));
      }
      const testServer = http.createServer();
      testServer.once('error', () => {
        console.log(`   Port ${p} is busy, trying ${p + 1}...`);
        tryPort(p + 1);
      });
      testServer.once('listening', () => {
        testServer.close(() => resolve(p));
      });
      testServer.listen(p, '0.0.0.0');
    };
    tryPort(startPort);
  });
}

// ── Port Cleaner & Process Killer ──────────────────────────────────────────
function killProcessOnPort(port) {
  if (!port) return;
  try {
    if (process.platform === 'win32') {
      let netstatOut = '';
      try {
        netstatOut = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      } catch (_) {}

      const pids = new Set();
      const lines = netstatOut.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('TCP')) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 5) {
          const localAddr = parts[1];
          const state = parts[3];
          const pid = parseInt(parts[4], 10);
          if (localAddr.endsWith(`:${port}`) && state === 'LISTENING' && pid && pid !== process.pid) {
            pids.add(pid);
          }
        }
      }

      for (const pid of pids) {
        try {
          console.log(`   🔌 Freeing port ${port}: terminating old process (PID ${pid})...`);
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
        } catch (_) {}
      }
    } else {
      try {
        const pids = execSync(`lsof -ti :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        if (pids) {
          for (const pidStr of pids.split('\n')) {
            const pid = parseInt(pidStr.trim(), 10);
            if (pid && pid !== process.pid) {
              console.log(`   🔌 Freeing port ${port}: terminating old process (PID ${pid})...`);
              try { process.kill(pid, 'SIGKILL'); } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    // Non-critical port cleanup
  }
}

// ── Close Old Browser Instances ────────────────────────────────────────────
function closeOldBrowsers() {
  console.log(`   🌐 Closing old browser instances...`);
  if (process.platform === 'win32') {
    const targets = ['msedge.exe', 'chrome.exe', 'chromium.exe', 'headless_shell.exe'];
    for (const target of targets) {
      try {
        execSync(`taskkill /F /IM ${target} /T`, { stdio: 'ignore' });
      } catch (_) {}
    }
  } else if (process.platform === 'darwin') {
    const targets = ['Google Chrome', 'Microsoft Edge', 'Chromium'];
    for (const target of targets) {
      try {
        execSync(`pkill -f "${target}"`, { stdio: 'ignore' });
      } catch (_) {}
    }
  } else {
    const targets = ['chrome', 'chromium', 'msedge'];
    for (const target of targets) {
      try {
        execSync(`pkill -f "${target}"`, { stdio: 'ignore' });
      } catch (_) {}
    }
  }
}

// ── Open Fresh Browser Window ──────────────────────────────────────────────
function openBrowser(url) {
  console.log(`   🚀 Opening fresh browser: ${url}`);
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    console.warn(`   ⚠️ Could not auto-open browser: ${err.message}`);
  }
}

// ── MCP (Model Context Protocol) Server ───────────────────────────────────
const MCP_SERVER_INFO = {
  name: 'playwright-automation-hub',
  version: '1.0.0',
  description: 'Playwright Automation Hub MCP Server — run & manage Playwright tests via AI agents'
};

const MCP_CAPABILITIES = { tools: { listChanged: false } };

const MCP_TOOLS = [
  {
    name: 'get_api_traffic',
    description: 'Retrieve captured API requests and responses (methods, URLs, status, headers, and request/response bodies) from the test execution.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max number of requests to return (default: 50)' },
        method: { type: 'string', description: 'Filter by HTTP method (GET, POST, etc.)' }
      },
      required: []
    }
  },

  {
    name: 'list_test_files',
    description: 'Scan the project and return all Playwright test files and folders in a tree structure.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'list_projects',
    description: 'List available Playwright browser projects (e.g. chromium, firefox, webkit) from playwright.config.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'run_tests',
    description: 'Start a Playwright test run. Returns a jobId to use with poll_job and cancel_job.',
    inputSchema: {
      type: 'object',
      properties: {
        file:    { type: 'string',  description: 'Relative path to a test file or folder, e.g. "tests/login.spec.ts"' },
        project: { type: 'string',  description: 'Playwright project name, e.g. "chromium"' },
        headed:  { type: 'boolean', description: 'Run tests in headed mode. Default: false' },
        grep:    { type: 'string',  description: 'Filter tests by name/tag, e.g. "@smoke"' },
        workers: { type: 'number',  description: 'Number of parallel workers. Default: 1' },
        command: { type: 'string',  description: 'Override: full custom npx playwright test command' }
      },
      required: []
    }
  },
  {
    name: 'poll_job',
    description: 'Poll live output and status of a running test job. Call repeatedly until done=true.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId:  { type: 'string', description: 'Job ID returned by run_tests' },
        offset: { type: 'number', description: 'Byte offset for incremental output. Start at 0.' }
      },
      required: ['jobId']
    }
  },
  {
    name: 'cancel_job',
    description: 'Cancel a currently running test job by its job ID.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID returned by run_tests' }
      },
      required: ['jobId']
    }
  },
  {
    name: 'get_history',
    description: 'Retrieve the most recent test run history entries.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max number of history entries to return. Default: 20' }
      },
      required: []
    }
  },
  {
    name: 'clear_history',
    description: 'Clear all test run history entries.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  }
];

function mcpOk(id, result)  { return { jsonrpc: '2.0', id, result }; }
function mcpErr(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

function buildCmd(args) {
  if (args.command) return args.command;
  let cmd = 'npx playwright test';
  if (args.file)    cmd += ` "${args.file}"`;
  if (args.project) cmd += ` --project=${args.project}`;
  if (args.headed)  cmd += ' --headed';
  if (args.grep)    cmd += ` --grep="${args.grep}"`;
  if (args.workers) cmd += ` --workers=${args.workers}`;
  return cmd;
}

function handleMCP(req, res, projectRoot) {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    let rpc;
    try { rpc = JSON.parse(body); } catch (_) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mcpErr(null, -32700, 'Parse error')));
      return;
    }

    const { jsonrpc, id, method, params = {} } = rpc;
    if (jsonrpc !== '2.0') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mcpErr(id, -32600, 'Invalid Request')));
      return;
    }

    let response;

    if (method === 'initialize') {
      response = mcpOk(id, { protocolVersion: '2025-03-26', capabilities: MCP_CAPABILITIES, serverInfo: MCP_SERVER_INFO });

    } else if (method === 'notifications/initialized') {
      res.writeHead(204); res.end(); return;

    } else if (method === 'tools/list') {
      response = mcpOk(id, { tools: MCP_TOOLS });

    } else if (method === 'tools/call') {
      const toolName = params.name;
      const args = params.arguments || {};
      try {
        let result;

        if (toolName === 'list_test_files') {
          result = { content: [{ type: 'text', text: JSON.stringify(getStructure(projectRoot), null, 2) }] };

        } else if (toolName === 'list_projects') {
          result = { content: [{ type: 'text', text: JSON.stringify({ projects: getProjects(projectRoot) }, null, 2) }] };

        } else if (toolName === 'run_tests') {
          const command = buildCmd(args);
          const jid = 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const job = { output: '', done: false, result: null, proc: null, cancelled: false };
          runningJobs.set(jid, job);
          console.log(`\n▶ [MCP] Executing: ${command}`);
          const proc = spawn(command, { cwd: projectRoot, shell: true, detached: process.platform !== 'win32' });
          job.proc = proc;
          proc.stdout.on('data', d => { const s = d.toString(); process.stdout.write(s); job.output += s; });
          proc.stderr.on('data', d => { const s = d.toString(); process.stderr.write(s); job.output += s; });
          proc.on('close', code => {
            job.result = parseTestOutput(job.output, code);
            job.done = true;
            try {
              job.apiTraffic = extractApiTraffic(projectRoot);
              console.log(`\n🌐 [MCP] Captured ${job.apiTraffic.length} API requests & responses from tests.`);
            } catch (err) {
              console.warn('⚠️ [MCP] Could not extract API traffic:', err.message);
            }
            if (!job.cancelled) {
              appendHistory(projectRoot, { timestamp: new Date().toISOString(), command, passed: job.result.passed, failed: job.result.failed, skipped: job.result.skipped, total: job.result.total, code: job.result.code });
            }
            setTimeout(() => runningJobs.delete(jid), 60000);
          });
          result = { content: [{ type: 'text', text: JSON.stringify({ jobId: jid, command, status: 'started' }, null, 2) }] };

        } else if (toolName === 'poll_job') {
          const { jobId, offset = 0 } = args;
          const job = runningJobs.get(jobId);
          if (!job) {
            result = { content: [{ type: 'text', text: JSON.stringify({ gone: true, error: 'Job not found' }) }], isError: true };
          } else {
            result = { content: [{ type: 'text', text: JSON.stringify({ newOutput: job.output.slice(offset), offset: job.output.length, done: job.done, result: job.done ? job.result : null }, null, 2) }] };
          }

        } else if (toolName === 'cancel_job') {
          const { jobId } = args;
          const job = runningJobs.get(jobId);
          if (job && job.proc && !job.done) {
            job.cancelled = true;
            try { process.kill(-job.proc.pid, 'SIGTERM'); } catch (_) { try { job.proc.kill('SIGTERM'); } catch (__) {} }
          }
          result = { content: [{ type: 'text', text: JSON.stringify({ ok: true, jobId }) }] };

        } else if (toolName === 'get_api_traffic') {
          let traffic = loadApiTraffic(projectRoot);
          if (args.method) {
            traffic = traffic.filter(t => t.method && t.method.toUpperCase() === args.method.toUpperCase());
          }
          traffic = traffic.slice(0, args.limit || 50);
          result = { content: [{ type: 'text', text: JSON.stringify({ count: traffic.length, traffic }, null, 2) }] };

        } else if (toolName === 'get_history') {
          const history = loadHistory(projectRoot).slice(0, args.limit || 20);
          result = { content: [{ type: 'text', text: JSON.stringify({ history, count: history.length }, null, 2) }] };

        } else if (toolName === 'clear_history') {
          clearHistory(projectRoot);
          result = { content: [{ type: 'text', text: JSON.stringify({ ok: true, message: 'History cleared' }) }] };

        } else {
          response = mcpErr(id, -32601, `Tool not found: ${toolName}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
          return;
        }
        response = mcpOk(id, result);
      } catch (err) {
        response = mcpErr(id, -32603, 'Tool execution error', err.message);
      }

    } else if (method === 'ping') {
      response = mcpOk(id, {});

    } else {
      response = mcpErr(id, -32601, `Method not found: ${method}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
}

// ── Create Standalone HTTP Server ──────────────────────────────────────────
function createRunnerServer(options = {}) {
  const port = options.port || 9300;
  const host = options.host || '127.0.0.1';
  const projectRoot = options.projectRoot || process.cwd();
  const reportPort = port + 20;
  const allurePort = port + 35;
  const openBrowserOnStart = options.openBrowserOnStart !== undefined ? options.openBrowserOnStart : false;

  let reportProc = null;
  let allureProc = null;

  const server = http.createServer(async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const [cleanUrl] = req.url.split('?');

    // ── API Endpoints ──
    if (req.method === 'GET' && cleanUrl === '/structure') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getStructure(projectRoot)));
      return;
    }

    if (req.method === 'GET' && cleanUrl === '/projects') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getProjects(projectRoot)));
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/run') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { command } = JSON.parse(body);
          const id = 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const job = { output: '', done: false, result: null, proc: null, cancelled: false };
          runningJobs.set(id, job);

          console.log(`\n▶ [Playwright Hub] Executing: ${command}`);
          const proc = spawn(command, { cwd: projectRoot, shell: true, detached: process.platform !== 'win32' });
          job.proc = proc;

          proc.stdout.on('data', d => { const s = d.toString(); process.stdout.write(s); job.output += s; });
          proc.stderr.on('data', d => { const s = d.toString(); process.stderr.write(s); job.output += s; });

          proc.on('close', code => {
            job.result = parseTestOutput(job.output, code);
            job.done = true;
            try {
              job.apiTraffic = extractApiTraffic(projectRoot);
              console.log(`\n🌐 [Playwright Hub] Captured ${job.apiTraffic.length} API requests & responses from tests.`);
            } catch (err) {
              console.warn('⚠️ [Playwright Hub] Could not extract API traffic:', err.message);
            }
            if (!job.cancelled) {
              appendHistory(projectRoot, {
                timestamp: new Date().toISOString(),
                command,
                passed: job.result.passed,
                failed: job.result.failed,
                skipped: job.result.skipped,
                total: job.result.total,
                code: job.result.code
              });
            }
            setTimeout(() => runningJobs.delete(id), 60000);
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && /^\/run\/[^/]+\/poll$/.test(cleanUrl)) {
      const id = cleanUrl.split('/')[2];
      const qs = Object.fromEntries(new URLSearchParams(req.url.split('?')[1] || ''));
      const offset = parseInt(qs.offset) || 0;
      const job = runningJobs.get(id);

      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ gone: true, error: 'Job not found' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          newOutput: job.output.slice(offset),
          offset: job.output.length,
          done: job.done,
          result: job.done ? job.result : null
        }));
      }
      return;
    }

    if (req.method === 'POST' && /^\/run\/[^/]+\/cancel$/.test(cleanUrl)) {
      const id = cleanUrl.split('/')[2];
      const job = runningJobs.get(id);
      if (job && job.proc && !job.done) {
        job.cancelled = true;
        try { process.kill(-job.proc.pid, 'SIGTERM'); } catch (_) {
          try { job.proc.kill('SIGTERM'); } catch (__) {}
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/show-report') {
      if (reportProc) { try { reportProc.kill(); } catch (_) {} }
      const url = `http://localhost:${reportPort}`;
      reportProc = spawn('npx', ['playwright', 'show-report', '--port', String(reportPort)], { cwd: projectRoot, shell: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url }));
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/allure-report') {
      if (allureProc) { try { allureProc.kill(); } catch (_) {} }
      const allureUrl = `http://localhost:${allurePort}`;
      const gen = spawn('npx', ['allure', 'generate', 'allure-results', '--clean', '-o', 'allure-report'], { cwd: projectRoot, shell: true });
      gen.on('close', () => {
        allureProc = spawn('npx', ['allure', 'open', 'allure-report', '-p', String(allurePort)], { cwd: projectRoot, shell: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: allureUrl }));
      });
      return;
    }

    if (req.method === 'GET' && cleanUrl === '/history') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(loadHistory(projectRoot)));
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/history/clear') {
      clearHistory(projectRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── Captured API Requests & Responses Endpoints ──
    if (req.method === 'GET' && cleanUrl === '/api-traffic') {
      const traffic = loadApiTraffic(projectRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: traffic.length, traffic }));
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/api-traffic/clear') {
      clearApiTraffic(projectRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: 0 }));
      return;
    }

    // ── MCP Endpoint ──
    if (req.method === 'POST' && cleanUrl === '/mcp') {
      return handleMCP(req, res, projectRoot);
    }

    if (req.method === 'GET' && cleanUrl === '/mcp') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        mcp: true, server: MCP_SERVER_INFO,
        endpoint: `http://localhost:${port}/mcp`,
        transport: 'http', protocol: '2025-03-26',
        toolCount: MCP_TOOLS.length,
        tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description }))
      }));
      return;
    }

    // ── Static Frontend File Serving ──
    let relativeFilePath = cleanUrl === '/' ? '/index.html' : cleanUrl;
    const safePath = path.normalize(path.join(STATIC_ROOT, relativeFilePath));

    if (!safePath.startsWith(STATIC_ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(safePath).pipe(res);
    });
  });

  function getNetworkIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }
    return ips;
  }

  server.listen(port, host, () => {
    const networkIps = getNetworkIPs();
    console.log(`\n🎭 Playwright Automation Hub Server started!`);
    console.log(`   Local Access:   http://localhost:${port}`);
    if (networkIps.length > 0) {
      networkIps.forEach(ip => {
        console.log(`   Network Access: http://${ip}:${port}  (Share this with teammates on your Wi-Fi/LAN)`);
      });
    }
    console.log(`   Watching tests in: ${projectRoot}`);
    console.log(`   🤖 MCP Endpoint:   http://localhost:${port}/mcp`);
    console.log(`   🔍 MCP Inspector:  http://localhost:${port}/pages/mcp-inspector.html\n`);

    if (openBrowserOnStart) {
      setTimeout(() => {
        openBrowser(`http://localhost:${port}`);
      }, 500);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${port} is currently busy.`);
      console.error(`   Tip: Pass --kill-port to force release, or use --port=<port> to select an alternate port.\n`);
    } else {
      console.error(`\n❌ Server error:`, err.message);
    }
  });

  return server;
}

// ── Express / Connect Middleware Integration ──
function runnerMiddleware(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  return (req, res, next) => {
    const [cleanUrl] = req.url.split('?');
    if (['/structure', '/projects', '/run', '/history', '/show-report', '/allure-report'].some(p => cleanUrl.startsWith(p))) {
      return next();
    }
    next();
  };
}

// ── Auto-start if executed directly from terminal or via global CLI ──
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    let cliPort = 9300; // default to 9300
    let cliHost = '0.0.0.0'; // allows access from other devices/people on network
    let cliRoot = process.cwd();
    let shouldOpenBrowser = true;
    let shouldCloseOldBrowsers = true;
    let shouldKillOldPort = true;

    args.forEach(arg => {
      if (arg.startsWith('--port=')) cliPort = parseInt(arg.split('=')[1]);
      if (arg.startsWith('-p=')) cliPort = parseInt(arg.split('=')[1]);
      if (arg.startsWith('--host=')) cliHost = arg.split('=')[1];
      if (arg.startsWith('--root=')) cliRoot = require('path').resolve(process.cwd(), arg.split('=')[1]);
      if (arg === '--no-open') shouldOpenBrowser = false;
      if (arg === '--no-browser-close') shouldCloseOldBrowsers = false;
      if (arg === '--no-kill-port') shouldKillOldPort = false;
    });

    console.log('\n=============================================================');
    console.log('  🎭 QARP Playwright Automation Hub Launcher');
    console.log('=============================================================');

    // 1. Auto-close old port process if port is occupied
    if (shouldKillOldPort) {
      killProcessOnPort(cliPort);
      killProcessOnPort(cliPort + 20); // reportPort
      killProcessOnPort(cliPort + 35); // allurePort
      await new Promise(r => setTimeout(r, 400));
    }

    // 2. Auto-close old browser instances
    if (shouldCloseOldBrowsers) {
      closeOldBrowsers();
      await new Promise(r => setTimeout(r, 400));
    }

    // 3. Launch server & auto-open fresh browser
    createRunnerServer({
      port: cliPort,
      host: cliHost,
      projectRoot: cliRoot,
      openBrowserOnStart: shouldOpenBrowser
    });
  })();
}

module.exports = {
  createRunnerServer,
  runnerMiddleware,
  getStructure,
  getProjects,
  killProcessOnPort,
  closeOldBrowsers,
  openBrowser,
  extractApiTraffic,
  loadApiTraffic,
  clearApiTraffic
};
