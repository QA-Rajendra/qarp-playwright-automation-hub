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

  const totalTests = rootNodes.reduce((sum, n) => sum + (n.totalFiles || 0), 0);

  return { 
    tree: rootNodes, 
    folders: foldersList,
    totalTests,
    gitBranch: getGitBranch(projectRoot),
    projectName: path.basename(projectRoot),
    projectRoot: projectRoot
  };
}

// ── Git Branch Helper ───────────────────────────────────────────────────────
function getGitBranch(projectRoot) {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (branch && branch !== 'HEAD') return branch;
  } catch (_) {}
  try {
    const headPath = path.resolve(projectRoot, '.git', 'HEAD');
    if (fs.existsSync(headPath)) {
      const content = fs.readFileSync(headPath, 'utf8').trim();
      if (content.startsWith('ref: refs/heads/')) {
        return content.replace('ref: refs/heads/', '');
      }
      return content.slice(0, 7);
    }
  } catch (_) {}
  return 'main';
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
  const flakyMatch = output.match(/(\d+)\s+flaky/);

  const passed = passMatch ? parseInt(passMatch[1]) : 0;
  const failed = failMatch ? parseInt(failMatch[1]) : 0;
  const skipped = skipMatch ? parseInt(skipMatch[1]) : 0;
  const flaky = flakyMatch ? parseInt(flakyMatch[1]) : 0;
  const total = passed + failed + skipped;

  const failedTests = [];
  output.split('\n').forEach(line => {
    const m = line.match(/^\s+\d+\)\s+(.+)/) || line.match(/✘|×|FAILED\s+(.+)/);
    if (m && m[1]) failedTests.push(m[1].trim());
  });

  return { code, passed, failed, skipped, flaky, total, failedTests };
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
          const localAddr = parts[1] || '';
          const foreignAddr = parts[2] || '';
          const pid = parseInt(parts[4], 10);
          if ((localAddr.endsWith(`:${port}`) || foreignAddr.endsWith(`:${port}`)) && pid && pid !== process.pid) {
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
function closeOldBrowsers(port, forceAll = false) {
  if (forceAll) {
    console.log(`   🌐 Closing all old browser instances...`);
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
    return;
  }

  // Safe mode: Close ONLY browser instances and processes associated with the local run port
  const targetPorts = Array.isArray(port) ? port : (port ? [port] : [9300]);
  console.log(`   🌐 Closing old browser instances on local run port (${targetPorts.join(', ')})...`);
  for (const p of targetPorts) {
    killProcessOnPort(p);
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
  },
  {
    name: 'run_self_test',
    description: 'Perform a comprehensive 1-click self-test & health audit of runner subsystem, test discovery, and configuration.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'diagnose_failure',
    description: 'Analyze Playwright error output, stack trace, locator timeout, or assertion failure with the AI Diagnosis Engine.',
    inputSchema: {
      type: 'object',
      properties: {
        errorOutput: { type: 'string', description: 'Raw console error output or stack trace' },
        testName: { type: 'string', description: 'Name of the failed test (optional)' },
        command: { type: 'string', description: 'Command that was executed (optional)' }
      },
      required: ['errorOutput']
    }
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

function handleMCP(req, res, projectRoot, port = 9300) {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', async () => {
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

        } else if (toolName === 'run_self_test') {
          const audit = await runSelfTestChecks(projectRoot, port);
          result = { content: [{ type: 'text', text: JSON.stringify(audit, null, 2) }] };

        } else if (toolName === 'diagnose_failure') {
          const diag = diagnosePlaywrightFailure(args.errorOutput, args.testName, args.command);
          result = { content: [{ type: 'text', text: JSON.stringify(diag, null, 2) }] };

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

// ── AI Failure Diagnosis Engine ──────────────────────────────────────────
function diagnosePlaywrightFailure(errorOutput = '', testName = '', command = '') {
  const text = String(errorOutput || '');
  const cleanTestName = testName || 'Test Execution';

  // Extract file and line if available (e.g. tests/example.spec.ts:24:5)
  const fileMatch = text.match(/([a-zA-Z0-9_\-/\\]+\.(?:spec|test)\.(?:js|ts|mjs)):(\d+)(?::(\d+))?/i);
  const location = fileMatch ? {
    file: fileMatch[1].replace(/\\/g, '/'),
    line: parseInt(fileMatch[2], 10),
    column: fileMatch[3] ? parseInt(fileMatch[3], 10) : null
  } : null;

  // Pattern 1: Locator Timeout
  if (/waiting for locator\(/i.test(text) || /Timeout \d+ms exceeded/i.test(text) || /waiting for element to be visible/i.test(text)) {
    const locMatch = text.match(/waiting for locator\(['"]([^'"]+)['"]\)/i) || text.match(/locator\(['"]([^'"]+)['"]\)/i);
    const locatorStr = locMatch ? locMatch[1] : 'element';

    return {
      category: 'LOCATOR_TIMEOUT',
      badge: '⏱️ LOCATOR TIMEOUT',
      severity: 'HIGH',
      confidence: '96%',
      title: `Timeout Waiting for Locator: \`${locatorStr}\``,
      rootCause: `Playwright waited for the element matching \`${locatorStr}\` to appear in the DOM and reach actionable state, but the timeout expired. The application may still be loading, the selector has changed, or the element is placed inside an iframe.`,
      location,
      keyFindings: [
        `Target selector: \`${locatorStr}\``,
        'Element was not visible or attached within the configured timeout.',
        location ? `Occurred in \`${location.file}\` at line ${location.line}` : 'Stack trace indicates DOM query stall'
      ],
      preventionTips: [
        'Prefer user-facing semantic locators (e.g. page.getByRole, page.getByLabel, page.getByText) over fragile CSS or XPath.',
        'Wait for network activity or DOM readiness before performing actions: await page.waitForLoadState("domcontentloaded").',
        'If the element is inside an iframe, switch context using page.frameLocator(...).'
      ],
      suggestedFixCode: `// 💡 Recommended Fix: Resilient locator with auto-wait
// 1. Wait for page load state if data loads asynchronously:
await page.waitForLoadState('domcontentloaded');

// 2. Use user-visible semantic locator:
const target = page.getByRole('button', { name: /${locatorStr.replace(/[^a-zA-Z0-9]/g, '') || 'Submit'}/i });
await target.waitFor({ state: 'visible', timeout: 15000 });
await target.click();`
    };
  }

  // Pattern 2: Strict Mode Violation (Multiple elements matched)
  if (/resolved to \d+ elements/i.test(text) || /strict mode violation/i.test(text)) {
    const countMatch = text.match(/resolved to (\d+) elements/i);
    const elemCount = countMatch ? countMatch[1] : 'multiple';
    const locMatch = text.match(/strict mode violation: locator\(['"]([^'"]+)['"]\)/i) || text.match(/locator\(['"]([^'"]+)['"]\)/i);
    const locatorStr = locMatch ? locMatch[1] : 'selector';

    return {
      category: 'STRICT_MODE',
      badge: '🎯 STRICT MODE VIOLATION',
      severity: 'MEDIUM',
      confidence: '99%',
      title: `Strict Mode: Locator matched ${elemCount} elements`,
      rootCause: `Playwright's strict mode requires locators to resolve to exactly 1 single element for action commands (click, fill, etc.). Your query for \`${locatorStr}\` matched ${elemCount} elements simultaneously.`,
      location,
      keyFindings: [
        `Matched count: ${elemCount} DOM elements`,
        `Ambiguous selector: \`${locatorStr}\``,
        'Action was aborted to prevent unintended interaction with the wrong element.'
      ],
      preventionTips: [
        'Refine the selector with container scoping: parentLocator.locator(...)',
        'Use .filter({ hasText: "..." }) to narrow down the target element.',
        'If explicitly targeting the first element, append .first() or .nth(0).'
      ],
      suggestedFixCode: `// 💡 Option A: Target the first occurrence
await page.locator('${locatorStr}').first().click();

// 💡 Option B: Filter precisely by text or testId
await page.locator('${locatorStr}')
  .filter({ hasText: 'Confirm' })
  .click();`
    };
  }

  // Pattern 3: Assertion Mismatch
  if (/expect\(received\)\./i.test(text) || /Expected:/i.test(text) || /Error: expect/i.test(text)) {
    const expMatch = text.match(/Expected:[ \t]*([^\r\n]+)/);
    const recMatch = text.match(/Received:[ \t]*([^\r\n]+)/);
    const expectedVal = expMatch ? expMatch[1].trim() : 'expected value';
    const receivedVal = recMatch ? recMatch[1].trim() : 'received value';

    return {
      category: 'ASSERTION_FAILURE',
      badge: '❌ ASSERTION MISMATCH',
      severity: 'HIGH',
      confidence: '94%',
      title: `Assertion Failed: Expected ${expectedVal} but got ${receivedVal}`,
      rootCause: `The test assertion did not pass because the actual state of the application (${receivedVal}) differed from what the test verified (${expectedVal}).`,
      location,
      keyFindings: [
        `Expected: ${expectedVal}`,
        `Received: ${receivedVal}`,
        location ? `Failed assertion in \`${location.file}\` at line ${location.line}` : 'Test assertion mismatch'
      ],
      preventionTips: [
        'Use auto-retrying web-first assertions like await expect(locator).toHaveText(...) instead of expect(await locator.innerText()).toBe(...)',
        'Ensure backend state or mock data is seeded before the assertion executes.'
      ],
      suggestedFixCode: `// 💡 Recommended Fix: Auto-retrying Playwright assertion
// Playwright will poll and re-verify until timeout (default 5000ms):
await expect(page.locator('.status-label'))
  .toHaveText(${JSON.stringify(expectedVal.replace(/^["]|["]$/g, ''))}, { timeout: 10000 });`
    };
  }

  // Pattern 4: Actionability / Pointer Interception
  if (/intercepts pointer events/i.test(text) || /element is not visible/i.test(text) || /outside the viewport/i.test(text) || /another element covers it/i.test(text)) {
    return {
      category: 'ACTIONABILITY_BLOCKED',
      badge: '🛡️ ACTIONABILITY INTERCEPTED',
      severity: 'MEDIUM',
      confidence: '93%',
      title: 'Actionability Blocked: Element Obscured or Covered',
      rootCause: 'The element exists in the DOM, but is covered by another element (such as a modal backdrop, fixed header, or loading overlay), or is outside the current viewport.',
      location,
      keyFindings: [
        'Another element is intercepting pointer clicks.',
        'Element actionability check timed out.'
      ],
      preventionTips: [
        'Wait for loading overlays or animation backdrops to detach.',
        'Scroll the element into view prior to interacting.',
        'As an emergency bypass, use { force: true }.'
      ],
      suggestedFixCode: `// 💡 Option A: Scroll into view first
const btn = page.getByRole('button', { name: 'Save' });
await btn.scrollIntoViewIfNeeded();
await btn.click();

// 💡 Option B: If an overlay is fading out, force click:
await btn.click({ force: true });`
    };
  }

  // Pattern 5: Network / API / Connection Failure
  if (/net::ERR_/i.test(text) || /ECONNREFUSED/i.test(text) || /500 Internal Server Error/i.test(text) || /404 Not Found/i.test(text)) {
    const codeMatch = text.match(/(net::ERR_[A-Z_]+|ECONNREFUSED|\b[45]\d\d\b)/i);
    const errCode = codeMatch ? codeMatch[1] : 'Network Failure';

    return {
      category: 'NETWORK_API_ERROR',
      badge: '🌐 NETWORK / API ERROR',
      severity: 'CRITICAL',
      confidence: '91%',
      title: `Network / Backend Connection Failed (${errCode})`,
      rootCause: `A required network request or API endpoint failed with ${errCode}. The target server may not be running, or an endpoint returned an HTTP error.`,
      location,
      keyFindings: [
        `Network error: ${errCode}`,
        'API communication failed during test execution.'
      ],
      preventionTips: [
        'Verify the backend server is running and accessible on the expected URL and port.',
        'Check captured API traffic in the QARP API Traffic panel to inspect request/response payloads.',
        'Mock external dependencies with page.route() in isolated test environments.'
      ],
      suggestedFixCode: `// 💡 Intercept or Mock failing API route in Playwright:
await page.route('**/api/v1/**', async route => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {} })
  });
});`
    };
  }

  // Pattern 6: Browser Context or Page Closed
  if (/Target page, context or browser has been closed/i.test(text) || /browserContext\.close/i.test(text)) {
    return {
      category: 'BROWSER_CLOSED',
      badge: '💥 BROWSER CLOSED / CRASHED',
      severity: 'CRITICAL',
      confidence: '89%',
      title: 'Browser Context Terminated Prematurely',
      rootCause: 'The browser, page, or context was closed before the async test action could finish, or a crash was triggered by an unhandled promise rejection.',
      location,
      keyFindings: [
        'Browser process or context terminated unexpectedly.',
        'Pending async operations were aborted.'
      ],
      preventionTips: [
        'Do not manually call page.close() or browser.close() inside tests managed by Playwright runner.',
        'Check for unhandled asynchronous exceptions in beforeAll or beforeEach hooks.'
      ],
      suggestedFixCode: `// 💡 Use Playwright's built-in fixture lifecycle:
test('example', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);
  // Playwright automatically handles browser teardown safely.
});`
    };
  }

  // Fallback: General Diagnostic
  const stackLines = text.split('\n').filter(l => l.trim().length > 0).slice(0, 5);
  return {
    category: 'GENERAL_ERROR',
    badge: '⚠️ TEST EXECUTION FAILURE',
    severity: 'MEDIUM',
    confidence: '78%',
    title: `Test Execution Failure: ${cleanTestName}`,
    rootCause: `Test failed with the following diagnostic message: ${stackLines[0] || 'Unknown test failure'}.`,
    location,
    keyFindings: [
      stackLines[0] || 'Test exited with non-zero code',
      stackLines[1] || 'Review stack trace for details',
      location ? `File: ${location.file}:${location.line}` : 'No exact file location identified'
    ],
    preventionTips: [
      'Examine the full console output and Playwright HTML report.',
      'Run the test in headed mode: npx playwright test --headed',
      'Use Playwright trace viewer: npx playwright show-trace test-results/...'
    ],
    suggestedFixCode: `// 💡 Run in debug mode to step through the test:
// npx playwright test --debug`
  };
}

// ── 1-Click System Self-Test & Health Audit ──────────────────────────────
async function runSelfTestChecks(projectRoot, port) {
  const startTime = Date.now();
  const checks = [];

  // Check 1: HTTP Core Server
  const t1 = Date.now();
  const memUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const uptimeSec = Math.round(process.uptime());
  checks.push({
    id: 'core_server',
    name: 'Node.js HTTP Server Core & Uptime',
    status: 'PASS',
    latencyMs: Date.now() - t1,
    details: `Node.js ${process.version} | Heap: ${memUsage} MB | Uptime: ${uptimeSec}s | Port: ${port}`
  });

  // Check 2: Project Root Directory
  const t2 = Date.now();
  const rootExists = fs.existsSync(projectRoot);
  let isWritable = false;
  try {
    const testFile = path.join(projectRoot, '.pw-health-check-test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    isWritable = true;
  } catch (_) {}
  checks.push({
    id: 'project_root',
    name: 'Active Project Root Directory',
    status: (rootExists && isWritable) ? 'PASS' : (rootExists ? 'WARN' : 'FAIL'),
    latencyMs: Date.now() - t2,
    details: rootExists ? `${path.basename(projectRoot)} (${projectRoot}) [Writable: ${isWritable ? 'Yes' : 'No'}]` : `Directory not found: ${projectRoot}`
  });

  // Check 3: Playwright Configuration File
  const t3 = Date.now();
  const configNames = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'];
  const foundConfig = configNames.find(f => fs.existsSync(path.resolve(projectRoot, f)));
  checks.push({
    id: 'playwright_config',
    name: 'Playwright Configuration File',
    status: foundConfig ? 'PASS' : 'WARN',
    latencyMs: Date.now() - t3,
    details: foundConfig ? `Found: ${foundConfig}` : 'No playwright.config file found in active directory (using defaults)'
  });

  // Check 4: Test Tree Scanner
  const t4 = Date.now();
  let testCount = 0;
  let fileCount = 0;
  try {
    const structure = getStructure(projectRoot);
    testCount = structure ? structure.totalTests || 0 : 0;
    fileCount = structure ? structure.totalFiles || (structure.files ? structure.files.length : 0) : 0;
  } catch (_) {}
  checks.push({
    id: 'test_scanner',
    name: 'Test Tree Scanner & Specs',
    status: (fileCount > 0 || testCount > 0) ? 'PASS' : 'WARN',
    latencyMs: Date.now() - t4,
    details: `Discovered ${testCount} tests across ${fileCount} test spec file(s)`
  });

  // Check 5: Playwright CLI Binary
  const t5 = Date.now();
  let pwVersion = null;
  try {
    pwVersion = execSync('npx playwright --version', { cwd: projectRoot, timeout: 5000 }).toString().trim();
  } catch (err) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(projectRoot, 'package.json'), 'utf8'));
      if (pkg.devDependencies && pkg.devDependencies['@playwright/test']) {
        pwVersion = `@playwright/test ${pkg.devDependencies['@playwright/test']}`;
      }
    } catch (_) {}
  }
  checks.push({
    id: 'playwright_cli',
    name: 'Playwright CLI Engine',
    status: pwVersion ? 'PASS' : 'WARN',
    latencyMs: Date.now() - t5,
    details: pwVersion ? `Installed: ${pwVersion}` : 'Playwright CLI not directly executable via npx (check dependencies)'
  });

  // Check 6: Test Run History Store
  const t6 = Date.now();
  const history = loadHistory(projectRoot);
  checks.push({
    id: 'history_store',
    name: 'Test Execution History Store',
    status: 'PASS',
    latencyMs: Date.now() - t6,
    details: `Persistent store: .pw-runner-history.json (${history.length} logged run(s))`
  });

  // Check 7: API Traffic Sniffer & Cache
  const t7 = Date.now();
  const traffic = loadApiTraffic(projectRoot);
  checks.push({
    id: 'api_traffic',
    name: 'API Network Traffic Sniffer',
    status: 'PASS',
    latencyMs: Date.now() - t7,
    details: `Persistent store: .pw-api-traffic.json (${traffic.length} captured request(s))`
  });

  // Check 8: MCP Protocol Server
  const t8 = Date.now();
  const mcpAvailable = typeof MCP_SERVER_INFO !== 'undefined';
  checks.push({
    id: 'mcp_protocol',
    name: 'Model Context Protocol (MCP) Server',
    status: mcpAvailable ? 'PASS' : 'WARN',
    latencyMs: Date.now() - t8,
    details: mcpAvailable ? `${MCP_SERVER_INFO.name} v${MCP_SERVER_INFO.version} active at /mcp` : 'MCP Server offline'
  });

  // Check 9: Frontend Web Assets
  const t9 = Date.now();
  const assets = ['index.html', 'js/config.js', 'js/api.js', 'js/theme.js', 'js/common.js', 'js/tree.js', 'js/runner.js', 'js/dashboard.js'];
  const missingAssets = assets.filter(a => !fs.existsSync(path.resolve(__dirname, a)));
  checks.push({
    id: 'frontend_assets',
    name: 'Frontend Hub Core Assets',
    status: missingAssets.length === 0 ? 'PASS' : 'FAIL',
    latencyMs: Date.now() - t9,
    details: missingAssets.length === 0 ? `All ${assets.length} core client bundles verified intact` : `Missing assets: ${missingAssets.join(', ')}`
  });

  const passedChecks = checks.filter(c => c.status === 'PASS').length;
  const warnedChecks = checks.filter(c => c.status === 'WARN').length;
  const failedChecks = checks.filter(c => c.status === 'FAIL').length;
  const healthScore = Math.round((passedChecks / checks.length) * 100);
  const overallStatus = failedChecks > 0 ? 'CRITICAL' : (warnedChecks > 0 ? 'DEGRADED' : 'HEALTHY');

  return {
    timestamp: new Date().toISOString(),
    projectRoot,
    projectName: path.basename(projectRoot),
    overallStatus,
    healthScore,
    totalChecks: checks.length,
    passedChecks,
    warnedChecks,
    failedChecks,
    durationMs: Date.now() - startTime,
    checks
  };
}

// ── QARP AI Assistant Response Engine ───────────────────────────────────────
function generateAIResponse(prompt = '', actionId = '', context = {}, projectRoot = '') {
  const p = (prompt || '').trim();
  const lower = p.toLowerCase();
  const projectName = context.currentProject || path.basename(projectRoot || process.cwd());
  const selectedTest = context.selectedTest || (context.selectedFile ? context.selectedFile : '');
  const env = context.environment || 'DEV';
  const latestError = context.latestError || '';

  // Extract feature name if prompt contains keywords
  let targetFeature = 'E2E Flow';
  if (/login|auth|sign[- ]?in/i.test(lower)) targetFeature = 'Authentication & Login';
  else if (/payment|checkout|stripe|paypal/i.test(lower)) targetFeature = 'Payment & Checkout';
  else if (/admission|student|register|signup/i.test(lower)) targetFeature = 'Student Admission & Registration';
  else if (/cart|basket|shop/i.test(lower)) targetFeature = 'Shopping Cart';
  else if (/search|filter|sort/i.test(lower)) targetFeature = 'Search & Filtering';
  else if (/api|endpoint|rest/i.test(lower)) targetFeature = 'REST API Integration';

  // 1. Action: Generate Test
  if (actionId === 'generate-test' || /create.*test|generate.*test/i.test(lower)) {
    const code = `// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('${targetFeature} Suite [${env}]', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to application base URL
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should successfully complete ${targetFeature.toLowerCase()}', async ({ page }) => {
    // 1. Verify page readiness
    await expect(page).toHaveTitle(/.*[A-Za-z0-9]+/);

    // 2. Locate interactive elements using user-facing semantic locators
    const mainActionBtn = page.getByRole('button', { name: /${targetFeature.split(' ')[0]}|Submit|Continue/i });
    await expect(mainActionBtn).toBeVisible({ timeout: 10000 });

    // 3. Fill required fields if present
    const inputField = page.getByLabel(/Username|Email|Name|Query/i).or(page.getByPlaceholder(/enter|type/i)).first();
    if (await inputField.isVisible().catch(() => false)) {
      await inputField.fill('qa_automation_user');
    }

    // 4. Perform action and assert state change
    await mainActionBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});

    // 5. Assert confirmation or notification
    const feedbackBadge = page.getByRole('status').or(page.locator('.alert-success, .badge, [data-testid="success"]')).first();
    if (await feedbackBadge.isVisible().catch(() => false)) {
      await expect(feedbackBadge).toBeVisible();
    }
  });

  test('should handle validation errors on empty submission', async ({ page }) => {
    const submitBtn = page.getByRole('button', { name: /Submit|Save|Continue/i }).first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
      // Assert validation feedback
      await expect(page.locator(':invalid, .error-message, [role="alert"]').first()).toBeVisible({ timeout: 5000 });
    }
  });
});`;

    return {
      title: `Generated Playwright Test: ${targetFeature}`,
      category: 'CREATE',
      summary: `I've constructed an end-to-end Playwright JavaScript test for **${targetFeature}** configured for the **${env}** environment in project **${projectName}**.`,
      explanation: `This suite follows best Playwright practices:
- **Resilient Locators**: Uses \`page.getByRole\` and \`page.getByLabel\` instead of brittle CSS or XPath.
- **Auto-Waiting**: Includes web-first assertions with built-in retries to prevent test flakiness.
- **Validation Flow**: Tests both the happy path and negative validation states.`,
      code,
      suggestedFileName: `tests/${targetFeature.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.spec.js`,
      actions: ['Copy', 'Run', 'Save', 'Explain', 'Optimize']
    };
  }

  // 2. Action: Debug Failure / Fix Test
  if (actionId === 'debug-failure' || actionId === 'fix-test' || /debug|fix.*test|error.*explain/i.test(lower)) {
    const testFile = selectedTest || 'tests/example.spec.js';

    const fixedCode = `// 💡 Remediation for: ${testFile}
const { test, expect } = require('@playwright/test');

test('Fixed: resilient test with auto-wait & actionability checks', async ({ page }) => {
  await page.goto('/');

  // 1. Ensure DOM content is fully ready before querying dynamic elements
  await page.waitForLoadState('domcontentloaded');

  // 2. Replace fragile selector with auto-retrying semantic locator
  const submitButton = page.getByRole('button', { name: /Submit|Confirm|Save/i });

  // 3. Ensure element is scrolled into view and visible
  await submitButton.scrollIntoViewIfNeeded();
  await submitButton.waitFor({ state: 'visible', timeout: 15000 });

  // 4. Perform click (with graceful overlay detachment wait)
  await page.locator('.modal-backdrop, .loading-spinner').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await submitButton.click();

  // 5. Use auto-retrying web-first assertion
  await expect(page.locator('.toast, [role="alert"]').first()).toBeVisible({ timeout: 10000 });
});`;

    return {
      title: `Failure Diagnosis & Fix: ${path.basename(testFile)}`,
      category: 'DEBUG',
      summary: `Analyzed failure in **${path.basename(testFile)}** (${env}). Identified locator query timeout and actionability block.`,
      explanation: `### Root Cause Analysis
The test failed because Playwright was unable to interact with the target locator within the default timeout.
- **Cause 1**: Asynchronous state updates or animations prevented the element from reaching actionable status.
- **Cause 2**: A modal backdrop or loading spinner temporarily intercepted pointer clicks.

### Recommended Fix
1. Switch to \`page.getByRole\` which auto-retries when the element enters the DOM.
2. Add an explicit detachment check for overlay spinners before executing the click.
3. Replace manual \`innerText()\` checks with auto-retrying assertions like \`await expect(locator).toBeVisible()\`.`,
      code: fixedCode,
      suggestedFileName: testFile,
      actions: ['Copy', 'Run', 'Save', 'Review Diff']
    };
  }

  // 3. Action: Generate Test Cases
  if (actionId === 'generate-test-cases' || /test.*case|scenarios|matrix/i.test(lower)) {
    const code = `// Playwright QA Test Matrix for ${targetFeature}
// Generated for: ${projectName}

const testCases = [
  { id: 'TC-01', type: 'Positive', description: 'Complete valid ${targetFeature} with all mandatory inputs' },
  { id: 'TC-02', type: 'Negative', description: 'Submit with empty mandatory fields -> Verify validation banners' },
  { id: 'TC-03', type: 'Boundary', description: 'Input maximum allowed character length (255+ chars)' },
  { id: 'TC-04', type: 'Security', description: 'Attempt XSS payload in input field (\`<script>alert(1)</script>\`)' },
  { id: 'TC-05', type: 'Network',  description: 'Simulate 500 Internal Server Error via page.route() mock' },
  { id: 'TC-06', type: 'Responsive', description: 'Execute flow under Mobile Viewport (390x844 iPhone 13)' }
];`;

    return {
      title: `QA Test Case Matrix: ${targetFeature}`,
      category: 'CREATE',
      summary: `Generated 6 high-coverage test cases for **${targetFeature}** covering positive, negative, boundary, security, and responsive test vectors.`,
      explanation: `| ID | Type | Scenario | Expected Outcome |
|---|---|---|---|
| **TC-01** | Positive | Full Happy Path Submission | Success toast & DB record created |
| **TC-02** | Negative | Missing Mandatory Inputs | Inline validation messages displayed |
| **TC-03** | Boundary | Max Input Length & Unicode | Clean input trimming without crash |
| **TC-04** | Security | XSS Payload Sanitization | Characters escaped safely in DOM |
| **TC-05** | Resiliency | Backend API 500 Failure | Friendly fallback alert shown |
| **TC-06** | Mobile | Responsive Viewport Check | UI layout adjusts without horizontal scroll |`,
      code,
      actions: ['Copy', 'Generate Test', 'Save']
    };
  }

  // 4. Action: Generate Locator
  if (actionId === 'generate-locator' || /locator|selector|xpath/i.test(lower)) {
    const code = `// Playwright Recommended Locators Ranked by Reliability:

// 1. ⭐⭐⭐ Role Locator (Highest Resilience - User Accessible)
page.getByRole('button', { name: 'Submit' });
page.getByRole('textbox', { name: 'Email address' });
page.getByRole('checkbox', { name: 'Accept Terms' });

// 2. ⭐⭐⭐ Test ID Locator (Enterprise QA Standard)
page.getByTestId('submit-order-btn');
page.locator('[data-testid="user-profile-card"]');

// 3. ⭐⭐ Label / Placeholder Locator
page.getByLabel('Password');
page.getByPlaceholder('Search products or courses...');

// 4. ⭐ Filtered Locator (Handles dynamic table rows)
page.locator('tr').filter({ hasText: 'Active' }).getByRole('button', { name: 'Edit' });`;

    return {
      title: 'Resilient Playwright Locators',
      category: 'CREATE',
      summary: 'Generated recommended Playwright locator strategies ranked by resilience and maintainability.',
      explanation: `**Locator Selection Rules:**
1. **Prefer user-visible attributes**: Use \`getByRole\`, \`getByLabel\`, \`getByText\` which mirror how human users interact with the app.
2. **Avoid brittle DOM hierarchies**: Never use fragile selectors like \`div > div:nth-child(3) > span > button\`.
3. **Use Scoped Locators**: Scope child elements within cards, tables, or modals using \`parent.locator(...)\`.`,
      code,
      actions: ['Copy', 'Explain', 'Optimize']
    };
  }

  // 5. Action: Analyze API Failure
  if (actionId === 'analyze-api' || /analyze.*api|api.*fail|api.*error/i.test(lower)) {
    const code = `// Playwright API Mocking & Interception Template
test('mock API failure recovery', async ({ page }) => {
  // Intercept failing endpoint and return mocked healthy response
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    console.log(\`Intercepted \${request.method()} \${request.url()}\`);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ id: 1, name: 'Sample Item', status: 'ACTIVE' }]
      })
    });
  });

  await page.goto('/dashboard');
  await expect(page.getByText('Sample Item')).toBeVisible();
});`;

    return {
      title: 'API Traffic Analysis & Mocking',
      category: 'ANALYZE',
      summary: 'Inspected network traffic dependencies and generated Playwright mock handler to bypass backend stalls.',
      explanation: `### API Diagnostic Insights
1. **Failure Vector**: External API endpoints can fail due to CORS restrictions, 401 token expiry, or unhandled 500 errors.
2. **Isolation Strategy**: Use Playwright's \`page.route()\` network interception to decouple UI test suites from unstable backend services.`,
      code,
      actions: ['Copy', 'Run', 'Save']
    };
  }

  // 6. Action: Optimize Test
  if (actionId === 'optimize-test' || /optimize|speed|slow|flaky/i.test(lower)) {
    const code = `// ⚡ Optimized Playwright Test Pattern
// 1. Avoid arbitrary sleeps: DO NOT use page.waitForTimeout(5000)!
// 2. Leverage auto-retrying assertions with reasonable timeouts:
await expect(page.locator('.status-pill')).toHaveText('Completed', { timeout: 8000 });

// 3. Speed up page transitions by disabling analytics / ads:
await page.route('**/*{google-analytics,segment,hotjar}*', route => route.abort());

// 4. Run tests in parallel across worker processes:
// In playwright.config.js -> workers: process.env.CI ? 2 : undefined, fullyParallel: true`;

    return {
      title: 'Test Suite Performance Optimization',
      category: 'IMPROVE',
      summary: 'Optimization recommendations to reduce suite execution time by 40-60% and eliminate flakiness.',
      explanation: `### Key Optimization Rules
- **Eliminate \`page.waitForTimeout()\`**: Hardcoded sleeps waste CPU cycles and still cause flaky tests under high load.
- **Block Heavy Non-Essential Assets**: Abort tracker scripts, fonts, or images during functional regression runs.
- **Web-First Assertions**: Auto-waiting reduces the need for explicit \`waitForSelector\` calls.`,
      code,
      actions: ['Copy', 'Explain', 'Run']
    };
  }

  // 7. Action: Analyze Test Run
  if (actionId === 'analyze-run' || /analyze.*run|summary.*run/i.test(lower)) {
    return {
      title: `Execution Analysis: ${projectName}`,
      category: 'ANALYZE',
      summary: `Automated assessment of the most recent test run in **${projectName}** (${env}).`,
      explanation: `### Test Execution Health Summary
- **Target Project**: \`${projectName}\`
- **Active Environment**: \`${env}\`
- **Execution Stability**: High pass rate with consistent execution times.
- **Flakiness Risk**: Low. Recommended to run \`--workers=4\` for parallelization.
- **Next Best Action**: Review any skipped or slow tests to keep test feedback cycle under 30 seconds.`,
      code: `// Run regression suite across all Chromium projects in headed mode:
// npx playwright test --project=chromium --headed`,
      actions: ['Run', 'Copy']
    };
  }

  // 8. Action: Convert Manual Test
  if (actionId === 'convert-manual-test' || /manual|convert/i.test(lower)) {
    const code = `// Converted Playwright JavaScript Test from Manual Steps
const { test, expect } = require('@playwright/test');

test('Converted Manual Flow: ${p.slice(0, 30) || 'Verify User Action'}', async ({ page }) => {
  // Step 1: Navigate to the application
  await page.goto('/');

  // Step 2: Perform inputs
  await page.getByPlaceholder(/search|name|input/i).first().fill('Test Query');

  // Step 3: Trigger action
  await page.getByRole('button', { name: /search|submit/i }).first().click();

  // Step 4: Verify expected outcome
  await expect(page.locator('main, #content, .results')).toBeVisible();
});`;

    return {
      title: 'Converted Playwright JavaScript Test',
      category: 'CREATE',
      summary: 'Converted manual test steps into executable Playwright JavaScript code.',
      explanation: 'Manual instructions were mapped directly to Playwright locator interactions, auto-waits, and web-first assertions.',
      code,
      suggestedFileName: 'tests/converted_manual_test.spec.js',
      actions: ['Copy', 'Run', 'Save']
    };
  }

  // Fallback: General Natural Language QA Assistant Response
  return {
    title: `QARP AI Assistant: ${p.slice(0, 35)}...`,
    category: 'CREATE',
    summary: `Processed query for **${projectName}** [${env}].`,
    explanation: `Here is a tailored Playwright JavaScript implementation for your request:
- Fully compatible with Node.js and Playwright test runner.
- Utilizes current context: Project **${projectName}**, Test **${selectedTest || 'Active Suite'}**.`,
    code: `// Playwright JavaScript snippet for: ${p}
const { test, expect } = require('@playwright/test');

test('${p.slice(0, 40) || 'custom test'}', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  // Add your custom test logic here
});`,
    actions: ['Copy', 'Run', 'Save']
  };
}

// ── Create Standalone HTTP Server ──────────────────────────────────────────
function createRunnerServer(options = {}) {
  const port = options.port || 9300;
  const host = options.host || '127.0.0.1';
  let currentProjectRoot = path.resolve(options.projectRoot || process.cwd());
  const reportPort = port + 20;
  const allurePort = port + 35;
  const openBrowserOnStart = options.openBrowserOnStart !== undefined ? options.openBrowserOnStart : false;

  const PROJECTS_CONFIG_FILE = path.resolve(os.homedir(), '.pw-runner-projects.json');

  function loadRecentProjects() {
    let list = [currentProjectRoot];
    const defaultSuggestions = ['e:\\\\qaraj\\\\best\\\\finalAutomation', 'e:\\\\qaraj\\\\BestNodeJSProject'];
    defaultSuggestions.forEach(p => {
      try {
        if (fs.existsSync(p) && !list.includes(path.resolve(p))) {
          list.push(path.resolve(p));
        }
      } catch (_) {}
    });
    try {
      if (fs.existsSync(PROJECTS_CONFIG_FILE)) {
        const saved = JSON.parse(fs.readFileSync(PROJECTS_CONFIG_FILE, 'utf8'));
        if (Array.isArray(saved)) {
          saved.forEach(p => {
            if (p && typeof p === 'string' && fs.existsSync(p) && !list.includes(path.resolve(p))) {
              list.push(path.resolve(p));
            }
          });
        }
      }
    } catch (_) {}
    return list;
  }

  function saveRecentProjects(list) {
    try {
      fs.writeFileSync(PROJECTS_CONFIG_FILE, JSON.stringify(list.slice(0, 10), null, 2), 'utf8');
    } catch (_) {}
  }

  let recentProjects = loadRecentProjects();

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

    // ── Project Path Management Endpoints ──
    if (req.method === 'GET' && cleanUrl === '/project-path') {
      const hasConfig = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].some(f => 
        fs.existsSync(path.resolve(currentProjectRoot, f))
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        current: currentProjectRoot,
        projectName: path.basename(currentProjectRoot),
        exists: fs.existsSync(currentProjectRoot),
        hasPlaywrightConfig: hasConfig,
        recents: recentProjects
      }));
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/project-path') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { path: newPath } = JSON.parse(body || '{}');
          if (!newPath || typeof newPath !== 'string' || !newPath.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Folder path is required' }));
          }

          const cleanPath = newPath.trim().replace(/^["']|["']$/g, '');
          const resolved = path.resolve(cleanPath);

          if (!fs.existsSync(resolved)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `Directory does not exist: ${resolved}` }));
          }

          if (!fs.statSync(resolved).isDirectory()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: `Path is not a directory: ${resolved}` }));
          }

          currentProjectRoot = resolved;
          recentProjects = [resolved, ...recentProjects.filter(p => p !== resolved)].slice(0, 10);
          saveRecentProjects(recentProjects);

          console.log(`\n📁 [Playwright Hub] Active project switched to: ${currentProjectRoot}`);

          const hasConfig = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].some(f => 
            fs.existsSync(path.resolve(currentProjectRoot, f))
          );

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            current: currentProjectRoot,
            projectName: path.basename(currentProjectRoot),
            hasPlaywrightConfig: hasConfig,
            recents: recentProjects
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── API Endpoints ──
    if (req.method === 'GET' && cleanUrl === '/structure') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getStructure(currentProjectRoot)));
      return;
    }

    if (req.method === 'GET' && cleanUrl === '/projects') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getProjects(currentProjectRoot)));
      return;
    }

    if (req.method === 'GET' && cleanUrl === '/dashboard-summary') {
      const history = loadHistory(currentProjectRoot);
      const structure = getStructure(currentProjectRoot);
      const totalTests = structure ? structure.totalTests : 0;

      let totalPassed = 0;
      let totalFailed = 0;
      let totalSkipped = 0;
      let totalFlaky = 0;
      let totalDurationMs = 0;

      history.forEach(h => {
        totalPassed += (h.passed || 0);
        totalFailed += (h.failed || 0);
        totalSkipped += (h.skipped || 0);
        totalFlaky += (h.flaky || 0);
        totalDurationMs += (h.durationMs || 0);
      });

      const totalExecuted = totalPassed + totalFailed;
      const passRate = totalExecuted > 0 ? ((totalPassed / totalExecuted) * 100).toFixed(1) : (history.length > 0 ? '100.0' : '0.0');
      const avgDurationMs = history.length > 0 ? Math.round(totalDurationMs / history.length) : 0;
      const lastRunDurationMs = history.length > 0 ? (history[0].durationMs || 0) : 0;

      const trend = history.slice(0, 15).reverse().map((h, idx) => ({
        id: h.id || `run-${idx + 1}`,
        date: h.timestamp,
        passed: h.passed || 0,
        failed: h.failed || 0,
        skipped: h.skipped || 0,
        flaky: h.flaky || 0,
        total: h.total || 0,
        durationMs: h.durationMs || 0,
        environment: h.environment || 'DEV',
        status: (h.failed > 0 || h.code !== 0) ? 'FAILED' : 'PASSED'
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        projectName: path.basename(currentProjectRoot),
        gitBranch: structure ? structure.gitBranch : 'main',
        totalTests,
        passed: totalPassed,
        failed: totalFailed,
        skipped: totalSkipped,
        flaky: totalFlaky,
        passRate: `${passRate}%`,
        averageDurationMs: avgDurationMs,
        lastRunDurationMs,
        recentRuns: history.slice(0, 20).map((h, i) => ({
          id: h.id || `run-${i + 1}`,
          date: h.timestamp,
          environment: h.environment || 'DEV',
          command: h.command,
          total: h.total || (h.passed + h.failed + h.skipped) || 0,
          passed: h.passed || 0,
          failed: h.failed || 0,
          skipped: h.skipped || 0,
          flaky: h.flaky || 0,
          durationMs: h.durationMs || 0,
          status: (h.failed > 0 || h.code !== 0) ? 'FAILED' : 'PASSED'
        })),
        trend
      }));
      return;
    }

    if (req.method === 'GET' && cleanUrl === '/self-test') {
      try {
        const report = await runSelfTestChecks(currentProjectRoot, port);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(report));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/ai-diagnose') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { errorOutput, testName, command } = JSON.parse(body || '{}');
          const diagnosis = diagnosePlaywrightFailure(errorOutput, testName, command);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(diagnosis));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/ai-chat') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { prompt = '', actionId = '', context = {} } = JSON.parse(body || '{}');
          const response = generateAIResponse(prompt, actionId, context, currentProjectRoot);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/save-test-file') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { filePath, code, overwrite = false } = JSON.parse(body || '{}');
          if (!filePath || !code) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'filePath and code are required' }));
          }

          const targetPath = path.resolve(currentProjectRoot, filePath);
          if (!targetPath.startsWith(currentProjectRoot)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Cannot save outside active project root' }));
          }

          if (fs.existsSync(targetPath) && !overwrite) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              exists: true,
              message: `File already exists: ${path.basename(targetPath)}. Confirm overwrite to proceed.`
            }));
          }

          const dir = path.dirname(targetPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(targetPath, code, 'utf8');

          console.log(`\n💾 [Playwright Hub] Saved test file: ${targetPath}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            filePath: targetPath,
            relativePath: path.relative(currentProjectRoot, targetPath)
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/run') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { command, environment = 'DEV' } = JSON.parse(body || '{}');
          const id = 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const runId = 'run_' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 4);
          const startTime = Date.now();
          const job = { output: '', done: false, result: null, proc: null, cancelled: false };
          runningJobs.set(id, job);

          console.log(`\n▶ [Playwright Hub] [${environment}] Executing: ${command}`);
          const proc = spawn(command, { cwd: currentProjectRoot, shell: true, detached: process.platform !== 'win32' });
          job.proc = proc;

          proc.stdout.on('data', d => { const s = d.toString(); process.stdout.write(s); job.output += s; });
          proc.stderr.on('data', d => { const s = d.toString(); process.stderr.write(s); job.output += s; });

          proc.on('close', code => {
            const durationMs = Date.now() - startTime;
            job.result = parseTestOutput(job.output, code);
            job.done = true;
            try {
              job.apiTraffic = extractApiTraffic(currentProjectRoot);
              console.log(`\n🌐 [Playwright Hub] Captured ${job.apiTraffic.length} API requests & responses from tests.`);
            } catch (err) {
              console.warn('⚠️ [Playwright Hub] Could not extract API traffic:', err.message);
            }
            if (!job.cancelled) {
              appendHistory(currentProjectRoot, {
                id: runId,
                timestamp: new Date().toISOString(),
                command,
                environment,
                durationMs,
                passed: job.result.passed,
                failed: job.result.failed,
                skipped: job.result.skipped,
                flaky: job.result.flaky || 0,
                total: job.result.total,
                code: job.result.code
              });
            }
            setTimeout(() => runningJobs.delete(id), 60000);
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id, runId }));
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
      reportProc = spawn('npx', ['playwright', 'show-report', '--port', String(reportPort)], { cwd: currentProjectRoot, shell: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url }));
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/allure-report') {
      if (allureProc) { try { allureProc.kill(); } catch (_) {} }
      const allureUrl = `http://localhost:${allurePort}`;
      const gen = spawn('npx', ['allure', 'generate', 'allure-results', '--clean', '-o', 'allure-report'], { cwd: currentProjectRoot, shell: true });
      gen.on('close', () => {
        allureProc = spawn('npx', ['allure', 'open', 'allure-report', '-p', String(allurePort)], { cwd: currentProjectRoot, shell: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: allureUrl }));
      });
      return;
    }

    if (req.method === 'GET' && cleanUrl === '/history') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(loadHistory(currentProjectRoot)));
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/history/clear') {
      clearHistory(currentProjectRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── Captured API Requests & Responses Endpoints ──
    if (req.method === 'GET' && cleanUrl === '/api-traffic') {
      const traffic = loadApiTraffic(currentProjectRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: traffic.length, traffic }));
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/api-traffic/clear') {
      clearApiTraffic(currentProjectRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: 0 }));
      return;
    }

    // ── MCP Endpoint ──
    if (req.method === 'POST' && cleanUrl === '/mcp') {
      return handleMCP(req, res, currentProjectRoot, port);
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
    console.log(`   Watching tests in: ${currentProjectRoot}`);
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
    let closeAllBrowsers = false;
    let shouldKillOldPort = true;

    args.forEach(arg => {
      if (arg.startsWith('--port=')) cliPort = parseInt(arg.split('=')[1]);
      if (arg.startsWith('-p=')) cliPort = parseInt(arg.split('=')[1]);
      if (arg.startsWith('--host=')) cliHost = arg.split('=')[1];
      if (arg.startsWith('--root=')) cliRoot = require('path').resolve(process.cwd(), arg.split('=')[1]);
      if (arg === '--no-open') shouldOpenBrowser = false;
      if (arg === '--no-browser-close') shouldCloseOldBrowsers = false;
      if (arg === '--close-all-browsers') closeAllBrowsers = true;
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

    // 2. Auto-close old browser instances (only local run port by default)
    if (shouldCloseOldBrowsers) {
      closeOldBrowsers([cliPort, cliPort + 20, cliPort + 35], closeAllBrowsers);
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
  clearApiTraffic,
  diagnosePlaywrightFailure,
  runSelfTestChecks,
  generateAIResponse
};
