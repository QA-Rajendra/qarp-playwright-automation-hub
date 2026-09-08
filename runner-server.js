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
const { spawn } = require('child_process');

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

  const rootNodes = [];
  const foldersList = [];

  ['tests', 'e2e'].forEach(dirName => {
    const targetDir = path.resolve(projectRoot, dirName);
    if (fs.existsSync(targetDir)) {
      const node = scanDir(targetDir, dirName, `${dirName} (root)`);
      if (node && (node.files.length > 0 || node.folders.length > 0)) {
        rootNodes.push(node);
        foldersList.push(node.path);
      }
    }
  });

  return { tree: rootNodes, folders: foldersList };
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

// ── Create Standalone HTTP Server ──────────────────────────────────────────
function createRunnerServer(options = {}) {
  const port = options.port || 9300;
  const host = options.host || '127.0.0.1';
  const projectRoot = options.projectRoot || process.cwd();
  const reportPort = port + 20;
  const allurePort = port + 35;

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
    console.log(`   Watching tests in: ${projectRoot}\n`);
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
  const args = process.argv.slice(2);
  let cliPort = null; // null = auto-detect from 9300-9305
  let cliHost = '0.0.0.0'; // allows access from other devices/people on network
  let cliRoot = process.cwd();

  args.forEach(arg => {
    if (arg.startsWith('--port=')) cliPort = parseInt(arg.split('=')[1]);
    if (arg.startsWith('-p=')) cliPort = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--host=')) cliHost = arg.split('=')[1];
    if (arg.startsWith('--root=')) cliRoot = path.resolve(process.cwd(), arg.split('=')[1]);
  });

  if (cliPort !== null) {
    // Explicit port provided — use it directly
    createRunnerServer({ port: cliPort, host: cliHost, projectRoot: cliRoot });
  } else {
    // Auto-detect: try ports 9300 to 9305
    findAvailablePort(9300, 9305)
      .then(availablePort => {
        console.log(`\n🔍 Auto-selected port: ${availablePort}`);
        createRunnerServer({ port: availablePort, host: cliHost, projectRoot: cliRoot });
      })
      .catch(err => {
        console.error(`\n❌ ${err.message}`);
        console.error('   Please free up a port in the range 9300–9305 and try again.');
        process.exit(1);
      });
  }
}

module.exports = {
  createRunnerServer,
  runnerMiddleware,
  getStructure,
  getProjects
};
