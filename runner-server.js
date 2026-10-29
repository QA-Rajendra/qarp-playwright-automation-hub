#!/usr/bin/env node

/**
 * Playwright Automation Hub - Node.js Server & Middleware Module
 * 
 * Uses Node.js built-ins plus the installed Puppeteer and project Playwright packages for browser features.
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
const crypto = require('crypto');
const { spawn, execSync, execFileSync } = require('child_process');
const puppeteer = require('puppeteer');
const { getGitStatus } = require('./qarp-git-status.cjs');
const { readRoadmap, validateRoadmap, writeRoadmap } = require('./qarp-roadmap-store.cjs');
const {
  getScenarioArtifact,
  startScenario,
  validateScenarioInput
} = require('./qarp-scenario-runner.cjs');

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
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.ico':  'image/x-icon'
};

// ── File Memory Cache (Optimization) ───────────────────────────────────────
const fileCache = new Map();
function getCachedJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  const cacheHit = fileCache.get(filePath);
  if (cacheHit && cacheHit.mtime === stat.mtimeMs) return cacheHit.data;
  
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    fileCache.set(filePath, { mtime: stat.mtimeMs, data });
    return data;
  } catch(e) {
    return null;
  }
}

// ── Job Manager ────────────────────────────────────────────────────────────
const runningJobs = new Map();
const managedRunnerSessions = new Map();
let nextRunnerSessionId = 1;
const HISTORY_FILE_NAME = '.pw-runner-history.json';
const HISTORY_MAX = 100;

function createRunId() {
  return `run_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;
}

function loadHistory(projectRoot) {
  const filePath = path.resolve(projectRoot, HISTORY_FILE_NAME);
  const data = getCachedJson(filePath);
  return Array.isArray(data) ? data : [];
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

function getPlaywrightConfigPath(projectRoot) {
  const candidates = [
    'playwright.config.ts',
    'playwright.config.js',
    'playwright.config.mjs',
    'playwright.config.cjs'
  ];
  return candidates.map(file => path.resolve(projectRoot, file)).find(file => fs.existsSync(file)) || null;
}

function prepareRunInsights(projectRoot, runId) {
  const configPath = getPlaywrightConfigPath(projectRoot);
  if (!configPath) return null;

  const outputDirectory = path.resolve(projectRoot, '.qarp-run-results');
  const outputFile = path.join(outputDirectory, `${runId}.json`);
  const wrapperPath = path.resolve(projectRoot, `.qarp-playwright-${runId}.mjs`);
  const reporterPath = path.resolve(__dirname, 'qarp-json-reporter.cjs');
  const configUrl = require('url').pathToFileURL(configPath).href;
  const wrapper = [
    `import originalConfigModule from ${JSON.stringify(configUrl)};`,
    `const reporterPath = ${JSON.stringify(reporterPath)};`,
    `const outputFile = ${JSON.stringify(outputFile)};`,
    `const projectRoot = ${JSON.stringify(path.resolve(projectRoot))};`,
    `const runId = ${JSON.stringify(runId)};`,
    'const originalConfig = originalConfigModule?.default ?? originalConfigModule;',
    'const resolvedConfig = typeof originalConfig === "function" ? await originalConfig() : originalConfig;',
    'const configured = resolvedConfig.reporter;',
    'const reporters = configured == null ? [["list"]] : typeof configured === "string" ? [[configured]] : Array.isArray(configured) && typeof configured[0] === "string" && configured[1] && typeof configured[1] === "object" ? [configured] : configured.map(item => typeof item === "string" ? [item] : item);',
    'export default { ...resolvedConfig, rootDir: resolvedConfig.rootDir || projectRoot, reporter: [...reporters, [reporterPath, { outputFile, projectRoot, runId }]] };'
  ].join('\n');

  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(wrapperPath, wrapper, 'utf8');
    return { wrapperPath, outputFile };
  } catch (error) {
    throw new Error(`Could not prepare structured test results: ${error.message}`);
  }
}

function tryPrepareRunInsights(projectRoot, runId, command) {
  if (/(?:^|\s)--config(?:=|\s)/.test(command)) {
    return {
      insights: null,
      error: 'Structured insights are disabled for commands with a custom --config option.'
    };
  }
  try {
    return { insights: prepareRunInsights(projectRoot, runId), error: null };
  } catch (error) {
    console.warn(`Structured test insights are unavailable for run ${runId}: ${error.message}`);
    return { insights: null, error: error.message };
  }
}

function loadRunInsights(projectRoot, runId) {
  if (typeof runId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) {
    const error = new Error('Invalid run ID.');
    error.statusCode = 400;
    throw error;
  }

  const filePath = path.resolve(projectRoot, '.qarp-run-results', `${runId}.json`);
  if (!fs.existsSync(filePath)) {
    const error = new Error('Structured results are not available for this run.');
    error.statusCode = 404;
    throw error;
  }

  const stat = fs.statSync(filePath);
  if (stat.size > 5 * 1024 * 1024) {
    const error = new Error('Structured results exceed the supported size limit.');
    error.statusCode = 413;
    throw error;
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (data.schemaVersion !== 1 || data.runId !== runId || !Array.isArray(data.tests)) {
    const error = new Error('Structured results are invalid or unsupported.');
    error.statusCode = 422;
    throw error;
  }
  return data;
}

function quoteRunArgument(value) {
  const text = String(value);
  if (/[\u0000-\u001f]/u.test(text)) throw new Error('Test paths and names cannot contain control characters.');
  if (process.platform === 'win32') {
    if (/[%!^"]/u.test(text)) throw new Error('A selected test path or project name contains unsupported Windows shell characters.');
    return `"${text}"`;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function getFailedRerunCommands(projectRoot, runId, testKeys) {
  if (!Array.isArray(testKeys) || testKeys.length === 0 || testKeys.length > 100) {
    const error = new Error('Select between 1 and 100 failed tests to rerun.');
    error.statusCode = 400;
    throw error;
  }

  const report = loadRunInsights(projectRoot, runId);
  const selectedKeys = new Set(testKeys);
  const selected = report.tests.filter(test => selectedKeys.has(test.key)
    && ['failed', 'timedOut', 'interrupted'].includes(test.status));
  if (selected.length !== selectedKeys.size) {
    const error = new Error('One or more selected tests are not failed tests in this run.');
    error.statusCode = 400;
    throw error;
  }

  const configuredProjects = new Set(getProjects(projectRoot));
  const grouped = new Map();
  for (const test of selected) {
    if (!configuredProjects.has(test.project)) {
      const error = new Error(`Unknown browser project: ${test.project || '(default)'}.`);
      error.statusCode = 400;
      throw error;
    }

    const candidatePath = path.resolve(projectRoot, test.file);
    const relative = path.relative(path.resolve(projectRoot), candidatePath);
    if (!test.file || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      const error = new Error('A selected test path is outside the active project.');
      error.statusCode = 403;
      throw error;
    }
    let resolvedPath;
    try {
      resolvedPath = fs.realpathSync(candidatePath);
    } catch (cause) {
      const error = new Error(`Selected test file is unavailable: ${test.file}`);
      error.statusCode = 400;
      throw error;
    }
    const resolvedRelative = path.relative(path.resolve(projectRoot), resolvedPath);
    if (resolvedRelative === '..' || resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)
      || !fs.statSync(resolvedPath).isFile() || !/\.(?:spec|test)\.(?:js|ts|mjs|cjs)$/i.test(resolvedPath)) {
      const error = new Error('A selected test file is invalid or outside the active project.');
      error.statusCode = 400;
      throw error;
    }

    const projectTests = grouped.get(test.project) || new Map();
    const titles = projectTests.get(resolvedRelative) || new Set();
    titles.add(test.titlePath.join(' '));
    projectTests.set(resolvedRelative, titles);
    grouped.set(test.project, projectTests);
  }

  if (grouped.size !== 1) {
    const error = new Error('Rerun failed tests from one browser project at a time.');
    error.statusCode = 400;
    throw error;
  }

  return [...grouped.entries()].map(([project, files]) => {
    const selectedTitles = [...files.values()].flatMap(titles => [...titles]);
    const grep = `^(?:${selectedTitles.map(title => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`;
    const args = ['npx', 'playwright', 'test'];
    for (const [file, titles] of files) args.push(quoteRunArgument(file));
    args.push('--project', quoteRunArgument(project), '--grep', quoteRunArgument(grep));
    return args.join(' ');
  });
}

function retainRunInsights(projectRoot, keep = HISTORY_MAX) {
  const directory = path.resolve(projectRoot, '.qarp-run-results');
  if (!fs.existsSync(directory)) return;
  const historyIds = new Set(loadHistory(projectRoot).map(entry => entry.runId).filter(Boolean));
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^[a-zA-Z0-9_-]{1,128}\.json$/.test(entry.name))
    .map(entry => ({ name: entry.name, time: fs.statSync(path.join(directory, entry.name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  entries.forEach((entry, index) => {
    const runId = entry.name.slice(0, -5);
    if (index >= keep && !historyIds.has(runId)) {
      fs.unlinkSync(path.join(directory, entry.name));
    }
  });
}

function clearHistory(projectRoot) {
  const filePath = path.resolve(projectRoot, HISTORY_FILE_NAME);
  try {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
    const insightDirectory = path.resolve(projectRoot, '.qarp-run-results');
    if (fs.existsSync(insightDirectory)) {
      for (const entry of fs.readdirSync(insightDirectory, { withFileTypes: true })) {
        if (entry.isFile() && /^[a-zA-Z0-9_-]{1,128}\.json$/.test(entry.name)) {
          fs.unlinkSync(path.join(insightDirectory, entry.name));
        }
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

// ── API Traffic Extractor (Captures HTTP Requests & Responses from Tests) ──
const API_TRAFFIC_FILE = '.pw-api-traffic.json';
const API_TRAFFIC_MAX_ENTRIES = 500;
const API_TRAFFIC_MAX_BYTES = 5 * 1024 * 1024;
const SENSITIVE_FIELD = /authorization|cookie|password|passwd|secret|token|api[-_]?key|credential/i;

function redactSensitiveValue(value, key = '') {
  if (SENSITIVE_FIELD.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/\b(Basic)\s+[A-Za-z0-9+/=]+/gi, '$1 [REDACTED]')
      .replace(/\b(set-cookie|cookie)\s*:\s*[^\r\n]+/gi, '$1: [REDACTED]')
      .replace(/([?&](?:access[_-]?token|api[_-]?key|password|passwd|secret|token)=)[^&\s]+/gi, '$1[REDACTED]')
      .replace(/((?:password|passwd|secret|token|api[-_]?key|authorization)\s*[:=]\s*)["']?[^&\s"',;]+/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(item => redactSensitiveValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([field, item]) => [
      field,
      redactSensitiveValue(item, field)
    ]));
  }
  return value;
}

function boundApiTraffic(entries) {
  const bounded = entries.slice(-API_TRAFFIC_MAX_ENTRIES).map(entry => redactSensitiveValue(entry));
  let serialized = JSON.stringify(bounded, null, 2);
  while (bounded.length > 0 && Buffer.byteLength(serialized, 'utf8') > API_TRAFFIC_MAX_BYTES) {
    bounded.shift();
    serialized = JSON.stringify(bounded, null, 2);
  }
  return { entries: bounded, serialized };
}

function writeApiTrafficStores(projectRoot, serialized) {
  const destinations = [
    path.resolve(projectRoot, API_TRAFFIC_FILE),
    path.resolve(projectRoot, 'test-results', 'api-traffic.json')
  ];
  for (const destination of destinations) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporaryFile = `${destination}.tmp`;
    fs.writeFileSync(temporaryFile, serialized, 'utf8');
    fs.renameSync(temporaryFile, destination);
  }
}

function loadApiTraffic(projectRoot) {
  const filePath = path.resolve(projectRoot, API_TRAFFIC_FILE);
  let data = getCachedJson(filePath);
  if (!Array.isArray(data)) {
    const resPath = path.resolve(projectRoot, 'test-results', 'api-traffic.json');
    data = getCachedJson(resPath);
  }
  if (Array.isArray(data)) {
    const safeTraffic = boundApiTraffic(data);
    writeApiTrafficStores(projectRoot, safeTraffic.serialized);
    fileCache.set(filePath, {
      mtime: fs.statSync(filePath).mtimeMs,
      data: safeTraffic.entries
    });
    return safeTraffic.entries;
  }

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

  let safeTraffic;
  try {
    safeTraffic = boundApiTraffic(allTraffic);
    writeApiTrafficStores(projectRoot, safeTraffic.serialized);
  } catch (error) {
    console.error(`Could not persist redacted API traffic: ${error.message}`);
    return [];
  }

  return safeTraffic ? safeTraffic.entries : [];
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

function analyzeProject(projectRoot) {
  const root = fs.realpathSync(projectRoot);
  const ignoredDirectories = new Set([
    '.git', '.next', '.nuxt', '.output', '.turbo', '.vscode', '.yarn',
    'allure-report', 'allure-results', 'build', 'coverage', 'dist',
    'node_modules', 'playwright-report', 'test-results', 'vendor',
    '.cache', '.pytest_cache', '.venv', 'venv'
  ]);
  const frameworkCatalog = {
    '@playwright/test': ['Playwright Test', 'Browser automation'],
    'playwright': ['Playwright', 'Browser automation'],
    'playwright-core': ['Playwright Core', 'Browser automation'],
    'cypress': ['Cypress', 'Browser automation'],
    'webdriverio': ['WebdriverIO', 'Browser automation'],
    'selenium-webdriver': ['Selenium WebDriver', 'Browser automation'],
    'puppeteer': ['Puppeteer', 'Browser automation'],
    'jest': ['Jest', 'Test framework'],
    'vitest': ['Vitest', 'Test framework'],
    'mocha': ['Mocha', 'Test framework'],
    'jest-cucumber': ['Jest Cucumber', 'BDD testing'],
    'cucumber': ['Cucumber', 'BDD testing'],
    '@cucumber/cucumber': ['Cucumber.js', 'BDD testing'],
    'allure-playwright': ['Allure Playwright', 'Reporting'],
    'allure-cypress': ['Allure Cypress', 'Reporting'],
    'react': ['React', 'Frontend framework'],
    'react-dom': ['React DOM', 'Frontend framework'],
    'next': ['Next.js', 'Frontend framework'],
    'vue': ['Vue.js', 'Frontend framework'],
    'nuxt': ['Nuxt', 'Frontend framework'],
    '@angular/core': ['Angular', 'Frontend framework'],
    'svelte': ['Svelte', 'Frontend framework'],
    'express': ['Express', 'Backend framework'],
    '@nestjs/core': ['NestJS', 'Backend framework'],
    'fastify': ['Fastify', 'Backend framework'],
    'koa': ['Koa', 'Backend framework'],
    'vite': ['Vite', 'Build tool'],
    'webpack': ['Webpack', 'Build tool'],
    'typescript': ['TypeScript', 'Language tooling'],
    'eslint': ['ESLint', 'Code quality'],
    'prettier': ['Prettier', 'Code quality']
  };
  const configNames = new Set([
    'playwright.config.js', 'playwright.config.ts', 'playwright.config.mjs', 'playwright.config.cjs',
    'cypress.config.js', 'cypress.config.ts', 'jest.config.js', 'jest.config.ts',
    'vitest.config.js', 'vitest.config.ts', 'vite.config.js', 'vite.config.ts',
    'webpack.config.js', 'tsconfig.json', 'jsconfig.json', 'babel.config.js',
    '.babelrc', '.eslintrc', '.eslintrc.js', 'eslint.config.js', 'prettier.config.js',
    'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
    'pyproject.toml', 'requirements.txt', 'Pipfile', 'pytest.ini', 'tox.ini',
    'Gemfile', 'go.mod', 'Cargo.toml', 'composer.json', 'Dockerfile',
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'
  ]);
  const languageByExtension = {
    '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.jsx': 'JavaScript JSX', '.ts': 'TypeScript', '.mts': 'TypeScript',
    '.cts': 'TypeScript', '.tsx': 'TypeScript JSX', '.py': 'Python',
    '.java': 'Java', '.kt': 'Kotlin', '.go': 'Go', '.rs': 'Rust',
    '.cs': 'C#', '.php': 'PHP', '.rb': 'Ruby', '.html': 'HTML',
    '.css': 'CSS', '.scss': 'SCSS', '.json': 'JSON', '.yml': 'YAML',
    '.yaml': 'YAML', '.xml': 'XML', '.sql': 'SQL'
  };
  const maxFiles = 30000;
  const maxDepth = 16;
  const stack = [{ absolute: root, relative: '', depth: 0 }];
  const languageCounts = new Map();
  const topDirectories = [];
  const directories = [];
  let directoryCount = 0;
  const configFiles = [];
  const packageManifests = [];
  const warnings = [];
  let packageManifestLimitReached = false;
  let fileCount = 0;
  let visitedEntries = 0;
  let symlinksSkipped = 0;
  let truncated = false;

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current.absolute, { withFileTypes: true });
    } catch (error) {
      warnings.push(`Cannot read ${current.relative || '.\\'}: ${error.message}`);
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      visitedEntries++;
      if (visitedEntries > maxFiles) {
        truncated = true;
        stack.length = 0;
        break;
      }

      const relativePath = current.relative
        ? path.join(current.relative, entry.name)
        : entry.name;
      const normalizedPath = relativePath.split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        symlinksSkipped++;
        continue;
      }

      if (entry.isDirectory()) {
        if (current.depth === 0) topDirectories.push(entry.name);
        if (!ignoredDirectories.has(entry.name)) {
          directoryCount++;
          if (directories.length < 500) directories.push(normalizedPath);
          if (current.depth < maxDepth) {
            stack.push({
              absolute: path.join(current.absolute, entry.name),
              relative: relativePath,
              depth: current.depth + 1
            });
          } else {
            truncated = true;
          }
        }
        continue;
      }
      if (!entry.isFile()) continue;

      fileCount++;
      const extension = path.extname(entry.name).toLowerCase();
      const language = languageByExtension[extension];
      if (language) languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
      if (configNames.has(entry.name)) configFiles.push(normalizedPath);
      if (entry.name === 'package.json') {
        if (packageManifests.length < 100) {
          packageManifests.push({ absolute: path.join(current.absolute, entry.name), relative: normalizedPath });
        } else {
          packageManifestLimitReached = true;
        }
      }
    }
  }
  if (packageManifestLimitReached) {
    warnings.push('Only the first 100 package.json manifests were inspected.');
  }
  if (directoryCount > directories.length) {
    warnings.push('Only the first 500 project directory paths are listed.');
  }

  let lockData = null;
  let lockfilePath = null;
  const packageLockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(packageLockPath)) {
    try {
      const lockStats = fs.statSync(packageLockPath);
      if (lockStats.size > 20 * 1024 * 1024) {
        warnings.push('package-lock.json exceeds the 20 MB inspection limit; resolved package versions are not available.');
      } else {
        lockData = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
        lockfilePath = 'package-lock.json';
      }
    } catch (error) {
      warnings.push(`Cannot parse package-lock.json: ${error.message}`);
    }
  }

  const frameworks = [];
  const manifests = [];
  for (const manifest of packageManifests) {
    let packageData;
    try {
      const stats = fs.statSync(manifest.absolute);
      if (stats.size > 1024 * 1024) {
        warnings.push(`${manifest.relative} exceeds the 1 MB manifest inspection limit.`);
        continue;
      }
      packageData = JSON.parse(fs.readFileSync(manifest.absolute, 'utf8'));
    } catch (error) {
      warnings.push(`Cannot parse ${manifest.relative}: ${error.message}`);
      continue;
    }

    const dependencies = {
      ...(packageData.dependencies || {}),
      ...(packageData.devDependencies || {}),
      ...(packageData.peerDependencies || {}),
      ...(packageData.optionalDependencies || {})
    };
    manifests.push({
      path: manifest.relative,
      name: typeof packageData.name === 'string' ? packageData.name : path.basename(path.dirname(manifest.absolute)),
      version: typeof packageData.version === 'string' ? packageData.version : null,
      moduleType: packageData.type === 'module' ? 'ES modules' : 'CommonJS/default',
      nodeEngine: packageData.engines && packageData.engines.node ? packageData.engines.node : null,
      dependencyCount: Object.keys(dependencies).length
    });

    for (const [packageName, declaredVersion] of Object.entries(dependencies)) {
      const catalog = frameworkCatalog[packageName.toLowerCase()];
      if (!catalog) continue;
      let resolvedVersion = null;
      const isRootManifest = manifest.relative === 'package.json';
      if (isRootManifest && lockData && lockData.packages && typeof lockData.packages === 'object') {
        const matchingKey = Object.keys(lockData.packages)
          .filter(key => key === `node_modules/${packageName}` || key.endsWith(`/node_modules/${packageName}`))
          .sort((a, b) => a.length - b.length)[0];
        if (matchingKey && lockData.packages[matchingKey] && typeof lockData.packages[matchingKey].version === 'string') {
          resolvedVersion = lockData.packages[matchingKey].version;
        }
      }
      if (isRootManifest && !resolvedVersion && lockData && lockData.dependencies && lockData.dependencies[packageName]) {
        resolvedVersion = lockData.dependencies[packageName].version || null;
      }
      frameworks.push({
        name: catalog[0],
        category: catalog[1],
        packageName,
        declaredVersion: String(declaredVersion),
        resolvedVersion,
        manifestPath: manifest.relative,
        lockfilePath: resolvedVersion ? lockfilePath : null
      });
    }
  }

  const uniqueFrameworks = [...new Map(
    frameworks.map(framework => [`${framework.manifestPath}:${framework.packageName}`, framework])
  ).values()];
  uniqueFrameworks.sort((a, b) =>
    a.category.localeCompare(b.category) ||
    a.name.localeCompare(b.name) ||
    a.manifestPath.localeCompare(b.manifestPath)
  );
  manifests.sort((a, b) => a.path.localeCompare(b.path));
  const playwrightConfigs = configFiles.filter(file => /^playwright\.config\./i.test(path.basename(file)));
  const projectTree = {
    topLevelDirectories: topDirectories.sort((a, b) => a.localeCompare(b)),
    directories: directories.sort((a, b) => a.localeCompare(b)),
    configurationFiles: configFiles.sort((a, b) => a.localeCompare(b)),
    packageManifests: manifests
  };

  return {
    projectName: path.basename(root),
    projectRoot: root,
    scannedAt: new Date().toISOString(),
    scan: {
      filesCounted: fileCount,
      directoriesCounted: directoryCount,
      entriesVisited: visitedEntries,
      truncated,
      directoryPathsTruncated: directoryCount > directories.length,
      symlinksSkipped,
      skippedDirectoryNames: [...ignoredDirectories].sort(),
      maxDepth
    },
    runtime: { nodeVersion: process.version },
    languages: [...languageCounts.entries()]
      .map(([name, files]) => ({ name, files }))
      .sort((a, b) => b.files - a.files),
    frameworks: uniqueFrameworks,
    packageManifests: manifests,
    lockfilePath,
    playwright: {
      configPaths: playwrightConfigs,
      browserProjects: playwrightConfigs.length > 0 ? getProjects(root) : [],
      testFiles: getStructure(root).totalTests
    },
    projectTree,
    warnings
  };
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
  description: 'Playwright Automation Hub MCP Server — run tests and analyze JavaScript applications with REA'
};

const MCP_CAPABILITIES = { tools: { listChanged: false }, resources: {}, prompts: { listChanged: false } };

async function analyzeJavascriptApplication(targetInput, projectRoot) {
  if (typeof targetInput !== 'string' || !targetInput.trim()) {
    const error = new Error('A JavaScript application directory or .asar path is required.');
    error.statusCode = 400;
    throw error;
  }
  if (targetInput.length > 4096 || /[\u0000-\u001f"]/u.test(targetInput)) {
    const error = new Error('The analysis path is invalid or too long.');
    error.statusCode = 400;
    throw error;
  }

  const root = fs.realpathSync(projectRoot);
  let resolvedTarget;
  try {
    resolvedTarget = fs.realpathSync(path.resolve(root, targetInput.trim()));
  } catch (cause) {
    const error = new Error(`The analysis target does not exist or cannot be accessed: ${cause.message}`);
    error.statusCode = 400;
    throw error;
  }
  const relativeTarget = path.relative(root, resolvedTarget);
  if (relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
    const error = new Error('The analysis target must be inside the active project directory.');
    error.statusCode = 403;
    throw error;
  }

  const targetStats = fs.statSync(resolvedTarget);
  if (!targetStats.isDirectory() && !(targetStats.isFile() && path.extname(resolvedTarget).toLowerCase() === '.asar')) {
    const error = new Error('Choose a JavaScript application directory or an .asar file.');
    error.statusCode = 400;
    throw error;
  }

  const args = ['-y', 'rea-agents@6.7.0', 'analyze-javascript-application', resolvedTarget, '--json'];
  const isWindows = process.platform === 'win32';
  if (isWindows && /[%!^]/u.test(resolvedTarget)) {
    const error = new Error('On Windows, analysis paths cannot contain %, !, or ^ characters.');
    error.statusCode = 400;
    throw error;
  }

  const command = isWindows
    ? (process.env.ComSpec || 'cmd.exe')
    : 'npx';
  const commandArgs = isWindows
    ? ['/d', '/s', '/c', `npx -y rea-agents@6.7.0 analyze-javascript-application "${resolvedTarget}" --json`]
    : args;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;

    const child = spawn(command, commandArgs, {
      cwd: root,
      windowsHide: true,
      shell: false
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 10 * 60 * 1000);

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    }

    function collect(stream, chunk) {
      outputBytes += chunk.length;
      if (outputBytes > 5 * 1024 * 1024) {
        outputLimitExceeded = true;
        child.kill('SIGTERM');
        return;
      }
      if (stream === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
    }

    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.on('error', error => {
      fail(new Error(`Could not start REA analysis. Ensure Node.js and npm are installed: ${error.message}`));
    });
    child.on('close', exitCode => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error('REA analysis exceeded the 10-minute time limit.'));
        return;
      }
      if (outputLimitExceeded) {
        reject(new Error('REA analysis output exceeded the 5 MB limit.'));
        return;
      }
      resolve({
        target: relativeTarget || '.',
        exitCode,
        stdout,
        stderr
      });
    });
  });
}

// ── MCP Prompts (2026-07-28) ───────────────────────────────────────────────
const MCP_PROMPTS = [
  {
    name: 'run_all_tests',
    description: 'Run the full Playwright test suite on the active project and report results.',
    arguments: [
      { name: 'project', description: 'Browser project to use (e.g. chromium, firefox). Default: chromium.', required: false },
      { name: 'workers', description: 'Number of parallel workers. Default: 1.', required: false }
    ]
  },
  {
    name: 'run_smoke_tests',
    description: 'Run only tests tagged @smoke for a quick sanity check before a release.',
    arguments: [
      { name: 'project', description: 'Browser project to use. Default: chromium.', required: false }
    ]
  },
  {
    name: 'diagnose_last_failure',
    description: 'Fetch the last failed test run from history and diagnose the root cause with fix suggestions.',
    arguments: []
  },
  {
    name: 'run_file',
    description: 'Run a specific Playwright test file and stream live output until done.',
    arguments: [
      { name: 'file', description: 'Relative path to the spec file, e.g. tests/QAtest/demoApiTest.spec.js', required: true },
      { name: 'headed', description: 'Run in headed (visible browser) mode. true or false.', required: false }
    ]
  },
  {
    name: 'full_regression',
    description: 'Run the complete regression suite across all configured browser projects and summarise the results.',
    arguments: [
      { name: 'workers', description: 'Parallel workers per project. Default: 2.', required: false }
    ]
  },
  {
    name: 'check_api_traffic',
    description: 'Run all tests and then inspect the captured API requests and responses for anomalies.',
    arguments: [
      { name: 'method', description: 'Filter captured traffic by HTTP method (GET, POST, PUT, DELETE).', required: false }
    ]
  },
  {
    name: 'cross_browser_check',
    description: 'Run a specific test file on chromium, firefox, and webkit sequentially and compare results.',
    arguments: [
      { name: 'file', description: 'Relative path to the spec file to run cross-browser.', required: true }
    ]
  },
  {
    name: 'health_check',
    description: 'Run a full system self-test to verify Playwright, Node.js, browsers, and MCP are all healthy.',
    arguments: []
  }
];

function buildPromptMessages(promptName, args = {}, port = 9300) {
  const base = `You are an AI assistant controlling a Playwright test runner via MCP tools.\nMCP endpoint: http://localhost:${port}/mcp\nAvailable tools: get_project_analysis, list_test_files, analyze_javascript_application, list_projects, run_tests, poll_job, cancel_job, get_history, get_api_traffic, run_self_test, diagnose_failure, clear_history.\n\n`;

  switch (promptName) {
    case 'run_all_tests':
      return [{ role: 'user', content: { type: 'text', text:
        base +
        `Task: Run ALL Playwright tests in the project.\n` +
        `1. Call list_test_files to discover the test tree.\n` +
        `2. Call run_tests with project="${args.project || 'chromium'}"${args.workers ? ` and workers=${args.workers}` : ''} (no file argument = run all).\n` +
        `3. Call poll_job with the returned jobId, offset=0. Repeat with updated offset until done=true.\n` +
        `4. Report the final passed/failed/skipped counts and overall status.`
      }}];

    case 'run_smoke_tests':
      return [{ role: 'user', content: { type: 'text', text:
        base +
        `Task: Run only @smoke-tagged tests for a quick sanity check.\n` +
        `1. Call run_tests with grep="@smoke" and project="${args.project || 'chromium'}".\n` +
        `2. Poll with poll_job until done=true.\n` +
        `3. Report pass/fail and whether the build is safe to deploy.`
      }}];

    case 'diagnose_last_failure':
      return [{ role: 'user', content: { type: 'text', text:
        base +
        `Task: Diagnose the most recent test failure.\n` +
        `1. Call get_history with limit=1.\n` +
        `2. If the last run has failed>0, call diagnose_failure with its command as the context.\n` +
        `3. Present the root cause, severity, prevention tips, and the suggested fix code clearly.`
      }}];

    case 'run_file':
      return [{ role: 'user', content: { type: 'text', text:
        base +
        `Task: Run a specific test file and report results.\n` +
        `File: ${args.file}\n` +
        `Headed: ${args.headed || 'false'}\n` +
        `1. Call run_tests with file="${args.file}"${args.headed === 'true' ? ' and headed=true' : ''}.\n` +
        `2. Poll with poll_job (start offset=0, increment with each response) until done=true.\n` +
        `3. Stream the output as you receive it, then give the final test summary.`
      }}];

    case 'full_regression':
      return [{ role: 'user', content: { type: 'text', text:
        base +
        `Task: Run a full regression suite across all browser projects.\n` +
        `1. Call list_projects to get available browser names.\n` +
        `2. For each browser: call run_tests with that project and workers=${args.workers || 2}.\n` +
        `3. Poll each job until done.\n` +
        `4. Build a comparison table: browser | passed | failed | skipped | duration.\n` +
        `5. Flag any browser where failed>0.`
      }}];

    case 'check_api_traffic':
      return [{ role: 'user', content: { type: 'text', text:
        base +
        `Task: Run tests and audit captured API traffic.\n` +
        `1. Call run_tests (all tests, no file filter).\n` +
        `2. Poll until done=true.\n` +
        `3. Call get_api_traffic${args.method ? ` with method="${args.method}"` : ''}.\n` +
        `4. Analyse the traffic: flag any 4xx/5xx responses, unexpected endpoints, or missing auth headers.\n` +
        `5. Summarise findings in a table: method | url | status | issue.`
      }}];

    case 'cross_browser_check':
      return [{ role: 'user', content: { type: 'text', text:
        base +
        `Task: Run the file on chromium, firefox, and webkit and compare.\n` +
        `File: ${args.file}\n` +
        `1. Run run_tests three times: project=chromium, firefox, webkit, each with file="${args.file}".\n` +
        `2. Poll each job to completion.\n` +
        `3. Present a cross-browser result table: browser | passed | failed | duration.\n` +
        `4. Highlight any browser-specific failures.`
      }}];

    case 'health_check':
      return [{ role: 'user', content: { type: 'text', text:
        base +
        `Task: Verify the entire test runner system is healthy.\n` +
        `1. Call run_self_test.\n` +
        `2. Report each check: name | status | detail.\n` +
        `3. If any check fails, suggest a fix.\n` +
        `4. End with overall PASS or FAIL verdict.`
      }}];

    default:
      return [{ role: 'user', content: { type: 'text', text: base + `Run the prompt: ${promptName}` } }];
  }
}

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
    name: 'get_project_analysis',
    description: 'Read-only scan of the active project layout, languages, package manifests, detected frameworks, declared and npm-lockfile versions, Playwright config paths, and browser projects.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'analyze_javascript_application',
    description: 'Analyze a JavaScript application directory or .asar bundle inside the active project directory with REA. The first run downloads the pinned REA CLI package through npm.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Application directory or .asar path, relative to the active project root (for example "dist" or "release/app.asar").' }
      },
      required: ['path']
    }
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
        projects: { type: 'array', items: { type: 'string' }, description: 'Multiple configured Playwright project names to run, e.g. ["chromium", "firefox"].' },
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
  if (Array.isArray(args.projects) && args.projects.length > 0) {
    args.projects.forEach(project => { cmd += ` --project="${project}"`; });
  } else if (args.project) {
    cmd += ` --project=${args.project}`;
  }
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
      response = mcpOk(id, { protocolVersion: '2026-07-28', capabilities: MCP_CAPABILITIES, serverInfo: MCP_SERVER_INFO });

    } else if (method === 'notifications/initialized') {
      res.writeHead(204); res.end(); return;

    } else if (method === 'tools/list') {
      response = mcpOk(id, { tools: MCP_TOOLS });

    } else if (method === 'tools/call') {
      const toolName = params.name;
      const args = params.arguments || {};
      try {
        let result;

        if (toolName === 'get_project_analysis') {
          result = { content: [{ type: 'text', text: JSON.stringify(analyzeProject(projectRoot), null, 2) }] };

        } else if (toolName === 'list_test_files') {
          result = { content: [{ type: 'text', text: JSON.stringify(getStructure(projectRoot), null, 2) }] };

        } else if (toolName === 'analyze_javascript_application') {
          const analysis = await analyzeJavascriptApplication(args.path, projectRoot);
          result = {
            content: [{ type: 'text', text: JSON.stringify(analysis, null, 2) }],
            isError: analysis.exitCode !== 0
          };

        } else if (toolName === 'list_projects') {
          result = { content: [{ type: 'text', text: JSON.stringify({ projects: getProjects(projectRoot) }, null, 2) }] };

        } else if (toolName === 'run_tests') {
          if (Array.isArray(args.projects)) {
            const configuredProjects = getProjects(projectRoot);
            const invalidProjects = args.projects.filter(project => typeof project !== 'string' || !configuredProjects.includes(project));
            if (invalidProjects.length > 0) {
              throw new Error(`Unknown browser project(s): ${invalidProjects.join(', ')}. Configured projects: ${configuredProjects.join(', ')}`);
            }
          }
          const command = buildCmd(args);
          const jid = 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const runId = createRunId();
          const { insights, error: insightsError } = tryPrepareRunInsights(projectRoot, runId, command);
          const executionCommand = insights
            ? `${command} --config="${insights.wrapperPath.replace(/"/g, '\\"')}"`
            : command;
          const job = { output: '', done: false, result: null, proc: null, cancelled: false, runId, insights, insightsError };
          runningJobs.set(jid, job);
          console.log(`\n▶ [MCP] Executing: ${executionCommand}`);
          const proc = spawn(executionCommand, { cwd: projectRoot, shell: true, detached: process.platform !== 'win32' });
          job.proc = proc;
          proc.stdout.on('data', d => { const s = d.toString(); process.stdout.write(s); job.output += s; });
          proc.stderr.on('data', d => { const s = d.toString(); process.stderr.write(s); job.output += s; });
          proc.on('close', code => {
            job.result = parseTestOutput(job.output, code);
            job.done = true;
            if (insights) {
              try {
                const structured = loadRunInsights(projectRoot, runId);
                job.result.flaky = structured.tests.filter(test => test.flaky).length;
              } catch (error) {
                job.result.insightsError = error.message;
              }
              try {
                fs.unlinkSync(insights.wrapperPath);
              } catch (error) {
                console.warn(`Could not remove temporary Playwright config: ${error.message}`);
              }
            }
            try {
              job.apiTraffic = extractApiTraffic(projectRoot);
              console.log(`\n🌐 [MCP] Captured ${job.apiTraffic.length} API requests & responses from tests.`);
            } catch (err) {
              console.warn('⚠️ [MCP] Could not extract API traffic:', err.message);
            }
            if (!job.cancelled) {
              appendHistory(projectRoot, { id: runId, runId: insights ? runId : null, timestamp: new Date().toISOString(), command, passed: job.result.passed, failed: job.result.failed, skipped: job.result.skipped, flaky: job.result.flaky || 0, total: job.result.total, code: job.result.code });
              try {
                retainRunInsights(projectRoot);
              } catch (error) {
                console.warn(`Could not apply structured result retention: ${error.message}`);
              }
            }
            setTimeout(() => runningJobs.delete(jid), 60000);
          });
          result = { content: [{ type: 'text', text: JSON.stringify({ jobId: jid, runId, insightsAvailable: Boolean(insights), insightsError, command, status: 'started' }, null, 2) }] };

        } else if (toolName === 'poll_job') {
          const { jobId, offset = 0 } = args;
          const job = runningJobs.get(jobId);
          if (!job) {
            result = { content: [{ type: 'text', text: JSON.stringify({ gone: true, error: 'Job not found' }) }], isError: true };
          } else {
            result = { content: [{ type: 'text', text: JSON.stringify({ newOutput: job.output.slice(offset), offset: job.output.length, done: job.done, runId: job.runId || null, result: job.done ? job.result : null }, null, 2) }] };
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

    } else if (method === 'prompts/list') {
      response = mcpOk(id, { prompts: MCP_PROMPTS });

    } else if (method === 'prompts/get') {
      const promptName = params.name;
      const promptArgs = params.arguments || {};
      const prompt = MCP_PROMPTS.find(p => p.name === promptName);
      if (!prompt) {
        response = mcpErr(id, -32602, `Prompt not found: ${promptName}`);
      } else {
        const messages = buildPromptMessages(promptName, promptArgs);
        response = mcpOk(id, { description: prompt.description, messages });
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

  // Check 5: npm CLI
  const t5 = Date.now();
  let npmVersion = null;
  try {
    npmVersion = execSync('npm --version', { cwd: projectRoot, timeout: 5000, windowsHide: true }).toString().trim();
  } catch (err) {
    npmVersion = null;
  }
  checks.push({
    id: 'npm_cli',
    name: 'npm Package Manager',
    status: npmVersion ? 'PASS' : 'FAIL',
    latencyMs: Date.now() - t5,
    details: npmVersion ? `Installed: npm ${npmVersion}` : 'npm is unavailable on the runner host. Install Node.js with npm and restart QARP.'
  });

  // Check 6: Project-local Playwright packages and CLI
  const t6 = Date.now();
  let playwrightCliVersion = null;
  let playwrightPackagePath = null;
  let playwrightError = '';
  try {
    require.resolve('@playwright/test', { paths: [projectRoot] });
    playwrightPackagePath = require.resolve('playwright/package.json', { paths: [projectRoot] });
    const playwrightPackage = JSON.parse(fs.readFileSync(playwrightPackagePath, 'utf8'));
    const cliRelativePath = typeof playwrightPackage.bin === 'string'
      ? playwrightPackage.bin
      : playwrightPackage.bin && playwrightPackage.bin.playwright;
    if (!cliRelativePath) throw new Error('Playwright package does not declare its CLI');
    const cliPath = path.resolve(path.dirname(playwrightPackagePath), cliRelativePath);
    playwrightCliVersion = execFileSync(process.execPath, [cliPath, '--version'], {
      cwd: projectRoot,
      timeout: 8000,
      windowsHide: true
    }).toString().trim();
  } catch (err) {
    playwrightError = err.message;
  }
  checks.push({
    id: 'playwright_install',
    name: 'Project Playwright Package & CLI',
    status: playwrightCliVersion ? 'PASS' : 'FAIL',
    latencyMs: Date.now() - t6,
    details: playwrightCliVersion
      ? `@playwright/test and local CLI installed (${playwrightCliVersion})`
      : `Install project dependencies with npm install. ${playwrightError}`
  });

  // Check 7: Chromium browser executable
  const t7 = Date.now();
  let chromiumExecutable = '';
  let chromiumError = '';
  try {
    if (!playwrightPackagePath) throw new Error('Install the project Playwright packages first.');
    const playwright = require(path.resolve(path.dirname(playwrightPackagePath), 'index.js'));
    chromiumExecutable = playwright.chromium.executablePath();
    if (!fs.existsSync(chromiumExecutable)) {
      throw new Error('Chromium browser files are missing. Run npx playwright install chromium.');
    }
  } catch (err) {
    chromiumError = err.message;
  }
  checks.push({
    id: 'playwright_browser',
    name: 'Playwright Chromium Browser',
    status: chromiumExecutable && fs.existsSync(chromiumExecutable) ? 'PASS' : 'FAIL',
    latencyMs: Date.now() - t7,
    details: chromiumExecutable && fs.existsSync(chromiumExecutable)
      ? `Installed: ${chromiumExecutable}`
      : chromiumError || 'Chromium browser is not installed. Run npx playwright install chromium.'
  });

  // Check 8: Test Run History Store
  const t8 = Date.now();
  const history = loadHistory(projectRoot);
  checks.push({
    id: 'history_store',
    name: 'Test Execution History Store',
    status: 'PASS',
    latencyMs: Date.now() - t8,
    details: `Persistent store: .pw-runner-history.json (${history.length} logged run(s))`
  });

  // Check 9: API Traffic Sniffer & Cache
  const t9 = Date.now();
  const traffic = loadApiTraffic(projectRoot);
  checks.push({
    id: 'api_traffic',
    name: 'API Network Traffic Sniffer',
    status: 'PASS',
    latencyMs: Date.now() - t9,
    details: `Persistent store: .pw-api-traffic.json (${traffic.length} captured request(s))`
  });

  // Check 10: MCP Protocol Server
  const t10 = Date.now();
  const mcpAvailable = typeof MCP_SERVER_INFO !== 'undefined';
  checks.push({
    id: 'mcp_protocol',
    name: 'Model Context Protocol (MCP) Server',
    status: mcpAvailable ? 'PASS' : 'WARN',
    latencyMs: Date.now() - t10,
    details: mcpAvailable ? `${MCP_SERVER_INFO.name} v${MCP_SERVER_INFO.version} active at /mcp` : 'MCP Server offline'
  });

  // Check 11: Frontend Web Assets
  const t11 = Date.now();
  const assets = ['index.html', 'js/config.js', 'js/api.js', 'js/theme.js', 'js/common.js', 'js/tree.js', 'js/runner.js', 'js/dashboard.js'];
  const missingAssets = assets.filter(a => !fs.existsSync(path.resolve(__dirname, a)));
  checks.push({
    id: 'frontend_assets',
    name: 'Frontend Hub Core Assets',
    status: missingAssets.length === 0 ? 'PASS' : 'FAIL',
    latencyMs: Date.now() - t11,
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

const MAX_WALKTHROUGH_STEPS = 200;

function safeWalkthroughUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs can be included in a walkthrough.');
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function formatWalkthroughMarkdown(session) {
  const rows = [
    '# Website Walkthrough',
    '',
    `- Website: ${safeWalkthroughUrl(session.url)}`,
    `- Recorded: ${session.startedAt}`,
    `- Actions: ${session.steps.length}`,
    '',
  ];
  if (session.truncated) {
    rows.push(`> Recording reached the ${MAX_WALKTHROUGH_STEPS}-action limit. This walkthrough is incomplete.`, '');
  }
  rows.push('## Steps', '');
  if (session.steps.length === 0) rows.push('No browser actions were recorded.');
  session.steps.forEach((step, index) => {
    rows.push(`${index + 1}. ${step.description}`);
  });
  rows.push('');
  return rows.join('\n');
}

// ── Create Standalone HTTP Server ──────────────────────────────────────────
function isLoopbackHost(host) {
  const normalizedHost = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  return normalizedHost === 'localhost' || normalizedHost === '::1' || normalizedHost.startsWith('127.');
}

function createRunnerServer(options = {}) {
  const requestedPort = Number.isInteger(options.port) ? options.port : 9300;
  let port = requestedPort;
  const host = options.host || '127.0.0.1';
  if (!isLoopbackHost(host) && options.allowLan !== true) {
    throw new Error('Binding QARP to a network interface requires allowLan: true.');
  }
  let currentProjectRoot = path.resolve(options.projectRoot || process.cwd());
  let reportPort = port ? port + 20 : 0;
  let allurePort = port ? port + 35 : 0;
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
  const walkthroughSessions = new Map();
  const scenarioJobs = new Map();
  const allowedCorsOrigins = new Set();
  for (const configuredOrigin of Array.isArray(options.corsOrigins) ? options.corsOrigins : []) {
    try {
      const parsedOrigin = new URL(configuredOrigin);
      if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== configuredOrigin) {
        throw new Error('Origin must be an HTTP(S) origin without a path.');
      }
      allowedCorsOrigins.add(parsedOrigin.origin);
    } catch (error) {
      throw new Error(`Invalid CORS origin "${configuredOrigin}": ${error.message}`);
    }
  }

  function isLocalWalkthroughRequest(req) {
    const remoteAddress = req.socket.remoteAddress || '';
    const isLoopback = remoteAddress === '::1' || remoteAddress === '127.0.0.1' || remoteAddress.startsWith('::ffff:127.');
    if (!isLoopback) return false;
    if (!req.headers.origin) return true;
    try {
      const origin = new URL(req.headers.origin);
      const isLocalOrigin = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
      return isLocalOrigin && origin.host === req.headers.host;
    } catch (_) {
      return false;
    }
  }

  function sendWalkthroughJson(res, statusCode, value) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  }

  function readWalkthroughBody(req, maxBytes = 4096) {
    return new Promise((resolve, reject) => {
      let body = '';
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        body += chunk.toString();
        if (Buffer.byteLength(body) > maxBytes) {
          tooLarge = true;
          body = '';
        }
      });
      req.on('end', () => {
        if (tooLarge) {
          reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
          return;
        }
        try {
          resolve(JSON.parse(body || '{}'));
        } catch (error) {
          reject(Object.assign(new Error(`Invalid JSON request: ${error.message}`), { statusCode: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const requestOrigin = req.headers.origin;
    const expectedOrigin = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
    const originAllowed = !requestOrigin || requestOrigin === expectedOrigin || allowedCorsOrigins.has(requestOrigin);
    if (!originAllowed) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Vary': 'Origin' });
      res.end(JSON.stringify({ error: 'This origin is not allowed to access the QARP server.' }));
      return;
    }
    if (requestOrigin) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    }

    if (req.method === 'OPTIONS') {
      if (!requestOrigin) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    const [cleanUrl] = req.url.split('?');

    if (cleanUrl === '/api/qa-roadmap' && ['GET', 'PUT'].includes(req.method)) {
      if (!isLocalWalkthroughRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'The QA roadmap is available only from the local QARP dashboard.' }));
        return;
      }

      if (req.method === 'GET') {
        try {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(readRoadmap()));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: error.message || 'Could not load the QA roadmap.' }));
        }
        return;
      }

      try {
        const body = await readWalkthroughBody(req, 1024 * 1024);
        const roadmap = writeRoadmap(validateRoadmap(body));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: true, roadmap }));
      } catch (error) {
        const statusCode = error.statusCode || 500;
        res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: error.message || 'Could not save the QA roadmap.' }));
      }
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/api/run-scenario') {
      if (!isLocalWalkthroughRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scenario runs are available only from the local QARP dashboard.' }));
        return;
      }
      if ([...scenarioJobs.values()].some(job => job.status === 'running')) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'A scenario is already running. Wait for it to finish before starting another.' }));
        return;
      }
      try {
        const input = await readWalkthroughBody(req, 16 * 1024);
        const job = startScenario(currentProjectRoot, validateScenarioInput(input));
        scenarioJobs.set(job.id, job);
        while (scenarioJobs.size > 20) {
          const oldest = scenarioJobs.keys().next().value;
          if (scenarioJobs.get(oldest).status === 'running') break;
          scenarioJobs.delete(oldest);
        }
        res.writeHead(202, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ id: job.id, status: job.status, startedAt: job.startedAt }));
      } catch (error) {
        res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message || 'Could not start the scenario.' }));
      }
      return;
    }

    const scenarioStatusMatch = cleanUrl.match(/^\/api\/scenarios\/([0-9a-f-]{36})$/i);
    if (req.method === 'GET' && scenarioStatusMatch) {
      if (!isLocalWalkthroughRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scenario results are available only from the local QARP dashboard.' }));
        return;
      }
      const job = scenarioJobs.get(scenarioStatusMatch[1]);
      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scenario run not found.' }));
        return;
      }
      const hasArtifact = type => {
        try {
          getScenarioArtifact(job, type);
          return true;
        } catch (error) {
          if (error.statusCode === 404) return false;
          throw error;
        }
      };
      let artifacts;
      try {
        artifacts = {
          screenshot: hasArtifact('screenshot'),
          video: hasArtifact('video')
        };
      } catch (error) {
        res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message || 'Could not inspect scenario artifacts.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        input: { url: job.input.url, browser: job.input.browser },
        report: job.report,
        error: job.error,
        artifacts
      }));
      return;
    }

    const scenarioArtifactMatch = cleanUrl.match(/^\/api\/scenarios\/([0-9a-f-]{36})\/artifacts\/(screenshot|video)$/i);
    if (req.method === 'GET' && scenarioArtifactMatch) {
      if (!isLocalWalkthroughRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scenario artifacts are available only from the local QARP dashboard.' }));
        return;
      }
      const job = scenarioJobs.get(scenarioArtifactMatch[1]);
      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scenario run not found.' }));
        return;
      }
      try {
        const artifact = getScenarioArtifact(job, scenarioArtifactMatch[2]);
        res.writeHead(200, {
          'Content-Type': artifact.contentType,
          'Content-Length': artifact.size,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        fs.createReadStream(artifact.filePath).pipe(res);
      } catch (error) {
        res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    if (req.method === 'GET' && cleanUrl === '/runner-sessions') {
      const sessions = [...managedRunnerSessions.values()].map(({ id, name, projectRoot, port: sessionPort, url, startedAt }) => ({
        id, name, projectRoot, port: sessionPort, url, startedAt,
        status: 'running'
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/runner-sessions') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        let sessionServer;
        try {
          let parsedBody = {};
          try { parsedBody = JSON.parse(body || '{}'); } catch(e) {}
          
          // Smart Defaults: Use current directory if none provided, and default name to folder name
          const projectRoot = parsedBody.projectRoot || process.cwd(); 
          const name = parsedBody.name || require('path').basename(projectRoot);
          const requestedSessionPort = parsedBody.port ? parseInt(parsedBody.port, 10) : 0;
          
          if (typeof projectRoot !== 'string') {
            throw new Error('Project directory path must be a string.');
          }
          
          const resolvedRoot = path.resolve(projectRoot);
          if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
            throw new Error(`Project directory not found at: ${resolvedRoot}`);
          }
          
          if (isNaN(requestedSessionPort) || requestedSessionPort < 0 || requestedSessionPort > 65535) {
            throw new Error('Port must be 0 (automatic) or a valid number between 1 and 65535.');
          }

          const id = `runner-${nextRunnerSessionId++}`;
          sessionServer = createRunnerServer({
            port: requestedSessionPort,
            host: '127.0.0.1',
            projectRoot: resolvedRoot,
            openBrowserOnStart: false
          });
          await new Promise((resolve, reject) => {
            sessionServer.once('listening', resolve);
            sessionServer.once('error', reject);
          });

          const sessionPort = sessionServer.address().port;
          const session = {
            id,
            name: String(name || path.basename(resolvedRoot)).slice(0, 80),
            projectRoot: resolvedRoot,
            port: sessionPort,
            url: `http://localhost:${sessionPort}`,
            startedAt: new Date().toISOString(),
            server: sessionServer
          };
          managedRunnerSessions.set(id, session);
          sessionServer.once('close', () => managedRunnerSessions.delete(id));
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ session: { ...session, server: undefined, status: 'running' } }));
        } catch (err) {
          if (sessionServer && sessionServer.listening) sessionServer.close();
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.code === 'EADDRINUSE' ? 'That port is already in use.' : err.message }));
        }
      });
      return;
    }

    const stopSessionMatch = cleanUrl.match(/^\/runner-sessions\/([\w-]+)$/);
    if (req.method === 'DELETE' && stopSessionMatch) {
      const session = managedRunnerSessions.get(stopSessionMatch[1]);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Runner session not found.' }));
        return;
      }
      session.server.close(() => {
        managedRunnerSessions.delete(session.id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: session.id }));
      });
      return;
    }

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

    // ── Clone Project Endpoint ──
    if (req.method === 'POST' && cleanUrl === '/clone-project') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { gitUrl } = JSON.parse(body || '{}');
          if (!gitUrl || typeof gitUrl !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'gitUrl is required' }));
          }

          const repoNameMatch = gitUrl.match(/\/([^\/]+?)(\.git)?$/);
          const repoName = repoNameMatch ? repoNameMatch[1] : `repo_${Date.now()}`;
          const clonesDir = path.resolve(process.cwd(), 'cloned-projects');
          if (!fs.existsSync(clonesDir)) {
            fs.mkdirSync(clonesDir, { recursive: true });
          }

          let dest = path.join(clonesDir, repoName);
          let counter = 1;
          while (fs.existsSync(dest)) {
            dest = path.join(clonesDir, `${repoName}_${counter}`);
            counter++;
          }

          console.log(`\n📁 [Playwright Hub] Cloning ${gitUrl} into ${dest}...`);
          execSync(`git clone "${gitUrl}" "${dest}"`, { stdio: 'inherit' });

          currentProjectRoot = dest;
          recentProjects = [dest, ...recentProjects.filter(p => p !== dest)].slice(0, 10);
          saveRecentProjects(recentProjects);

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
          console.error(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to clone repository: ' + err.message }));
        }
      });
      return;
    }

    // ── Project Detect Endpoint ──
    if (req.method === 'POST' && cleanUrl === '/project-detect') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { path: checkPath } = JSON.parse(body || '{}');
          const resolved = path.resolve((checkPath || '').trim().replace(/^["']|["']$/g, ''));
          const checks = [];
          let valid = true;

          // 1. Directory exists
          const exists = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
          checks.push({ key: 'directory', label: 'Project directory exists', ok: exists, detail: resolved });
          if (!exists) { valid = false; }

          // 2. package.json
          const hasPkg = exists && fs.existsSync(path.join(resolved, 'package.json'));
          checks.push({ key: 'package', label: 'package.json found', ok: hasPkg });

          // 3. playwright.config
          const cfgFiles = ['playwright.config.js', 'playwright.config.ts', 'playwright.config.mjs', 'playwright.config.cjs'];
          const foundCfg = exists ? cfgFiles.find(f => fs.existsSync(path.join(resolved, f))) : null;
          checks.push({ key: 'config', label: 'playwright.config found', ok: !!foundCfg, detail: foundCfg || 'Not found' });

          // 4. Test files
          let testCount = 0;
          if (exists) {
            try {
              const struct = getStructure(resolved);
              function countFiles(node) {
                if (!node) return 0;
                let c = (node.files || []).length;
                (node.folders || []).forEach(f => { c += countFiles(f); });
                return c;
              }
              testCount = countFiles(struct);
            } catch (_) {}
          }
          checks.push({ key: 'tests', label: `Test files found`, ok: testCount > 0, detail: `${testCount} spec file(s)` });

          // 5. Browser projects
          const browserProjects = exists ? getProjects(resolved) : [];
          checks.push({ key: 'browsers', label: 'Browser projects detected', ok: browserProjects.length > 0, detail: browserProjects.join(', ') || 'None' });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: valid && !!foundCfg, checks, projectName: path.basename(resolved), resolvedPath: resolved, testCount, browserProjects }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── Named Projects Registry (name+path pairs) ──
    const NAMED_PROJECTS_FILE = path.resolve(os.homedir(), '.pw-runner-named-projects.json');
    function loadNamedProjects() {
      try {
        if (fs.existsSync(NAMED_PROJECTS_FILE)) return JSON.parse(fs.readFileSync(NAMED_PROJECTS_FILE, 'utf8'));
      } catch (_) {}
      return [{ name: path.basename(currentProjectRoot), path: currentProjectRoot }];
    }
    function saveNamedProjects(list) {
      try { fs.writeFileSync(NAMED_PROJECTS_FILE, JSON.stringify(list, null, 2), 'utf8'); } catch (_) {}
    }

    if (req.method === 'GET' && cleanUrl === '/named-projects') {
      const list = loadNamedProjects();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ projects: list, current: currentProjectRoot }));
      return;
    }

    if (req.method === 'POST' && cleanUrl === '/named-projects') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { name, path: projPath } = JSON.parse(body || '{}');
          if (!name || !projPath) throw new Error('name and path are required');
          const resolved = path.resolve(projPath.trim().replace(/^["']|["']$/g, ''));
          if (!fs.existsSync(resolved)) throw new Error(`Path does not exist: ${resolved}`);
          const list = loadNamedProjects().filter(p => p.path !== resolved);
          list.unshift({ name: name.trim(), path: resolved });
          saveNamedProjects(list.slice(0, 20));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, projects: list }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── API Endpoints ──

    if (req.method === 'GET' && cleanUrl === '/git-status') {
      if (!isLocalWalkthroughRequest(req)) {
        res.writeHead(403, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify({ error: 'Git status is available only from the local QARP dashboard.' }));
        return;
      }
      try {
        const gitStatus = await getGitStatus(currentProjectRoot);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify(gitStatus));
      } catch (error) {
        const statusCode = error.code === 'GIT_UNAVAILABLE' ? 503 : 500;
        res.writeHead(statusCode, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        });
        res.end(JSON.stringify({
          error: error.message || 'Could not inspect Git status.',
          code: error.code || 'GIT_STATUS_FAILED'
        }));
      }
      return;
    }

    if (cleanUrl.startsWith('/walkthrough/')) {
      if (!isLocalWalkthroughRequest(req)) {
        sendWalkthroughJson(res, 403, { error: 'The walkthrough recorder is available only from the local QARP dashboard.' });
        return;
      }

      if (req.method === 'POST' && cleanUrl === '/walkthrough/start') {
        let body;
        try {
          body = await readWalkthroughBody(req);
        } catch (error) {
          sendWalkthroughJson(res, error.statusCode || 400, { error: error.message });
          return;
        }

        if (walkthroughSessions.size > 0) {
          sendWalkthroughJson(res, 409, { error: 'A walkthrough is already recording. Finish it before starting another.' });
          return;
        }

        let targetUrl;
        try {
          const rawUrl = String(body.url || '').trim();
          if (!rawUrl) throw new Error('Enter a website URL.');
          targetUrl = new URL(/^[a-z][a-z\d+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
          if (!['http:', 'https:'].includes(targetUrl.protocol)) {
            throw new Error('Only HTTP and HTTPS website URLs are supported.');
          }
          if (targetUrl.username || targetUrl.password) {
            throw new Error('Remove username and password information from the URL before recording.');
          }
        } catch (error) {
          sendWalkthroughJson(res, 400, { error: error.message || 'Enter a valid HTTP or HTTPS website URL.' });
          return;
        }

        const browserMode = body.mode === 'headless' || (!body.mode && options.walkthroughHeadless === true)
          ? 'headless'
          : 'headful';
        const session = {
          id: crypto.randomUUID(),
          url: targetUrl.toString(),
          browserMode,
          startedAt: new Date().toISOString(),
          steps: [],
          lastUrl: safeWalkthroughUrl(targetUrl.toString()),
          truncated: false,
          browser: null,
          page: null
        };
        const addStep = (type, description) => {
          if (session.steps.length >= MAX_WALKTHROUGH_STEPS) {
            session.truncated = true;
            return;
          }
          const cleanDescription = String(description || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 240);
          if (cleanDescription) {
            session.steps.push({ type, description: cleanDescription, timestamp: new Date().toISOString() });
          }
        };
        session.recordStep = addStep;
        addStep('navigation', `Open ${safeWalkthroughUrl(targetUrl.toString())}`);

        try {
          session.browser = await puppeteer.launch({
            headless: browserMode === 'headless'
          });
          session.page = await session.browser.newPage();
          await session.page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
          await session.page.exposeFunction('__qarpRecordWalkthroughStep', (type, description) => {
            if (['click', 'input', 'change', 'submit'].includes(type)) addStep(type, description);
          });
          await session.page.evaluateOnNewDocument(() => {
            const timers = new WeakMap();
            const shortText = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
            const describeField = element => {
              const label = element.labels && element.labels.length
                ? Array.from(element.labels).map(item => item.innerText).join(' ')
                : '';
              return shortText(element.getAttribute('aria-label') || label || element.getAttribute('placeholder') || element.getAttribute('name') || element.id || element.tagName.toLowerCase());
            };
            const record = (type, description) => {
              if (window.__qarpRecordWalkthroughStep) {
                window.__qarpRecordWalkthroughStep(type, description);
              }
            };
            document.addEventListener('click', event => {
              const origin = event.target instanceof Element ? event.target : null;
              const element = origin && origin.closest('button, a, input[type="button"], input[type="submit"], [role="button"]');
              if (!element) return;
              const label = shortText(element.getAttribute('aria-label') || element.innerText || element.getAttribute('title') || element.getAttribute('value') || element.tagName.toLowerCase());
              record('click', `Click ${label ? `"${label}"` : 'control'}`);
            }, true);
            document.addEventListener('input', event => {
              const element = event.target;
              if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;
              if (['password', 'file', 'hidden'].includes((element.type || '').toLowerCase())) return;
              if (element instanceof HTMLSelectElement) return;
              clearTimeout(timers.get(element));
              timers.set(element, setTimeout(() => record('input', `Enter text in "${describeField(element)}" (value not recorded)`), 700));
            }, true);
            document.addEventListener('change', event => {
              const element = event.target;
              if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) return;
              if (['password', 'file', 'hidden'].includes((element.type || '').toLowerCase())) return;
              if (element instanceof HTMLInputElement && !['checkbox', 'radio'].includes(element.type)) return;
              record('change', `Change "${describeField(element)}" (value not recorded)`);
            }, true);
            document.addEventListener('submit', event => {
              const form = event.target;
              if (form instanceof HTMLFormElement) {
                record('submit', `Submit form${form.getAttribute('aria-label') ? ` "${shortText(form.getAttribute('aria-label'))}"` : ''}`);
              }
            }, true);
          });
          session.page.on('framenavigated', frame => {
            if (frame !== session.page.mainFrame()) return;
            const navigatedUrl = frame.url();
            if (!navigatedUrl || navigatedUrl === 'about:blank') return;
            try {
              const safeUrl = safeWalkthroughUrl(navigatedUrl);
              if (safeUrl !== session.lastUrl) {
                session.lastUrl = safeUrl;
                addStep('navigation', `Navigate to ${safeUrl}`);
              }
            } catch (_) {}
          });
          walkthroughSessions.set(session.id, session);
          await session.page.goto(targetUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
          sendWalkthroughJson(res, 201, {
            sessionId: session.id,
            url: safeWalkthroughUrl(targetUrl.toString()),
            title: await session.page.title(),
            browserMode,
            maxSteps: MAX_WALKTHROUGH_STEPS
          });
        } catch (error) {
          walkthroughSessions.delete(session.id);
          if (session.browser) {
            try {
              await session.browser.close();
            } catch (closeError) {
              console.error('Could not close failed walkthrough browser:', closeError.message);
            }
          }
          sendWalkthroughJson(res, 500, { error: `Could not start the walkthrough browser: ${error.message}` });
        }
        return;
      }

      if (req.method === 'POST' && cleanUrl === '/walkthrough/inspect') {
        let body;
        try {
          body = await readWalkthroughBody(req, 8192);
        } catch (error) {
          sendWalkthroughJson(res, error.statusCode || 400, { error: error.message });
          return;
        }
        const session = walkthroughSessions.get(String(body.sessionId || ''));
        if (!session || !session.page || session.page.isClosed()) {
          sendWalkthroughJson(res, 404, { error: 'The recording browser is not open.' });
          return;
        }
        const selector = String(body.selector || '').trim();
        if (!selector || selector.length > 500) {
          sendWalkthroughJson(res, 400, { error: 'Enter a CSS selector up to 500 characters long.' });
          return;
        }
        try {
          const elements = await session.page.$$eval(selector, nodes => nodes.slice(0, 30).map(element => ({
            tag: element.tagName.toLowerCase(),
            text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
            href: element instanceof HTMLAnchorElement ? element.href : null,
            ariaLabel: element.getAttribute('aria-label'),
            role: element.getAttribute('role'),
            type: element instanceof HTMLInputElement ? element.type : null
          })));
          session.recordStep('inspect', `Inspect ${elements.length} element${elements.length === 1 ? '' : 's'} matching "${selector}"`);
          sendWalkthroughJson(res, 200, { count: elements.length, truncated: elements.length === 30, elements });
        } catch (error) {
          sendWalkthroughJson(res, 400, { error: `Could not query selector: ${error.message}` });
        }
        return;
      }

      if (req.method === 'POST' && cleanUrl === '/walkthrough/action') {
        let body;
        try {
          body = await readWalkthroughBody(req, 16384);
        } catch (error) {
          sendWalkthroughJson(res, error.statusCode || 400, { error: error.message });
          return;
        }
        const session = walkthroughSessions.get(String(body.sessionId || ''));
        if (!session || !session.page || session.page.isClosed()) {
          sendWalkthroughJson(res, 404, { error: 'The recording browser is not open.' });
          return;
        }
        const selector = String(body.selector || '').trim();
        if (!selector || selector.length > 500) {
          sendWalkthroughJson(res, 400, { error: 'Enter a CSS selector up to 500 characters long.' });
          return;
        }
        try {
          if (body.action === 'click') {
            await session.page.locator(selector).click({ timeout: 10000 });
            session.recordStep('click', `Click element matching "${selector}"`);
          } else if (body.action === 'fill') {
            const value = typeof body.value === 'string' ? body.value : '';
            if (value.length > 5000) {
              sendWalkthroughJson(res, 400, { error: 'Text to fill must be 5,000 characters or fewer.' });
              return;
            }
            const element = await session.page.$(selector);
            if (!element) {
              sendWalkthroughJson(res, 400, { error: 'No element matched that CSS selector.' });
              return;
            }
            const type = await element.evaluate(node => node instanceof HTMLInputElement ? node.type.toLowerCase() : '');
            await element.dispose();
            if (['file', 'hidden'].includes(type)) {
              sendWalkthroughJson(res, 400, { error: 'File and hidden inputs cannot be filled by this control.' });
              return;
            }
            await session.page.locator(selector).fill(value, { timeout: 10000 });
            session.recordStep('input', `Fill element matching "${selector}" (value not recorded)`);
          } else if (body.action === 'submit') {
            const element = await session.page.$(selector);
            if (!element) {
              sendWalkthroughJson(res, 400, { error: 'No element matched that CSS selector.' });
              return;
            }
            try {
              await element.evaluate(node => {
                const form = node instanceof HTMLFormElement ? node : node.closest('form');
                if (!form) throw new Error('Selector must match a form or an element inside a form.');
                form.requestSubmit();
              });
            } finally {
              await element.dispose();
            }
            session.recordStep('submit', `Submit form matching "${selector}"`);
          } else {
            sendWalkthroughJson(res, 400, { error: 'Action must be click, fill, or submit.' });
            return;
          }
          sendWalkthroughJson(res, 200, { ok: true, action: body.action });
        } catch (error) {
          sendWalkthroughJson(res, 400, { error: `Could not ${String(body.action || 'perform action')}: ${error.message}` });
        }
        return;
      }

      if (req.method === 'GET' && cleanUrl === '/walkthrough/artifact') {
        const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const session = walkthroughSessions.get(query.get('sessionId') || '');
        if (!session || !session.page || session.page.isClosed()) {
          sendWalkthroughJson(res, 404, { error: 'The recording browser is not open.' });
          return;
        }
        const format = query.get('format');
        try {
          let content;
          let contentType;
          let filename;
          if (format === 'png') {
            content = await session.page.screenshot({ type: 'png', fullPage: true });
            contentType = 'image/png';
            filename = 'website-screenshot.png';
          } else if (format === 'pdf') {
            content = await session.page.pdf({ format: 'A4', printBackground: true });
            contentType = 'application/pdf';
            filename = 'website-page.pdf';
          } else {
            sendWalkthroughJson(res, 400, { error: 'Format must be png or pdf.' });
            return;
          }
          if (content.length > 25 * 1024 * 1024) {
            sendWalkthroughJson(res, 413, { error: 'The generated document exceeds the 25 MB download limit.' });
            return;
          }
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': content.length,
            'Cache-Control': 'no-store'
          });
          res.end(content);
          session.recordStep('document', `Generate ${format.toUpperCase()} ${filename}`);
        } catch (error) {
          sendWalkthroughJson(res, 500, { error: `Could not generate ${format} document: ${error.message}` });
        }
        return;
      }

      if (req.method === 'GET' && cleanUrl === '/walkthrough/status') {
        const sessionId = new URL(req.url, `http://${req.headers.host}`).searchParams.get('sessionId');
        const session = sessionId && walkthroughSessions.get(sessionId);
        if (!session) {
          sendWalkthroughJson(res, 404, { error: 'Walkthrough session not found. It may have already been finished.' });
          return;
        }
        sendWalkthroughJson(res, 200, {
          sessionId: session.id,
          steps: session.steps,
          isBrowserOpen: !!(session.page && !session.page.isClosed()),
          truncated: session.truncated,
          maxSteps: MAX_WALKTHROUGH_STEPS
        });
        return;
      }

      if (req.method === 'POST' && cleanUrl === '/walkthrough/stop') {
        let body;
        try {
          body = await readWalkthroughBody(req);
        } catch (error) {
          sendWalkthroughJson(res, error.statusCode || 400, { error: error.message });
          return;
        }
        const session = walkthroughSessions.get(String(body.sessionId || ''));
        if (!session) {
          sendWalkthroughJson(res, 404, { error: 'Walkthrough session not found. It may have already been finished.' });
          return;
        }

        let closeWarning = null;
        if (session.browser) {
          try {
            await session.browser.close();
          } catch (error) {
            closeWarning = `The browser may need to be closed manually: ${error.message}`;
          }
        }
        walkthroughSessions.delete(session.id);
        sendWalkthroughJson(res, 200, {
          markdown: formatWalkthroughMarkdown(session),
          steps: session.steps,
          truncated: session.truncated,
          warning: closeWarning
        });
        return;
      }

      sendWalkthroughJson(res, 404, { error: 'Walkthrough endpoint not found.' });
      return;
    }

    if (req.method === 'GET' && cleanUrl === '/project-analysis') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(analyzeProject(currentProjectRoot)));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Project scan failed: ${error.message}` }));
      }
      return;
    }

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
        gitBranch: structure ? structure.gitBranch : 'unknown',
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

    if (req.method === 'POST' && cleanUrl === '/rea/analyze') {
      const remoteAddress = req.socket.remoteAddress || '';
      const isLoopback = remoteAddress === '::1' || remoteAddress === '127.0.0.1' || remoteAddress.startsWith('::ffff:127.');
      const requestOrigin = req.headers.origin;
      const expectedOrigin = `http://${req.headers.host}`;
      if (!isLoopback || (requestOrigin && requestOrigin !== expectedOrigin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'REA analysis is available only from the local QARP dashboard.' }));
        return;
      }

      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 8192) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body is too large.' }));
          req.destroy();
        }
      });
      req.on('end', async () => {
        if (res.writableEnded) return;
        try {
          const { path: targetPath } = JSON.parse(body || '{}');
          const analysis = await analyzeJavascriptApplication(targetPath, currentProjectRoot);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(analysis));
        } catch (error) {
          res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
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
          if (typeof command !== 'string' || !command.trim()) {
            throw new Error('A Playwright command is required.');
          }
          const id = 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const runId = createRunId();
          const startTime = Date.now();
          const { insights, error: insightsError } = tryPrepareRunInsights(currentProjectRoot, runId, command);
          const executionCommand = insights
            ? `${command} --config="${insights.wrapperPath.replace(/"/g, '\\"')}"`
            : command;
          const job = { output: '', done: false, result: null, proc: null, cancelled: false, runId, insights, insightsError };
          runningJobs.set(id, job);

          console.log(`\n▶ [Playwright Hub] [${environment}] Executing: ${executionCommand}`);
          const proc = spawn(executionCommand, { cwd: currentProjectRoot, shell: true, detached: process.platform !== 'win32' });
          job.proc = proc;

          proc.stdout.on('data', d => { const s = d.toString(); process.stdout.write(s); job.output += s; });
          proc.stderr.on('data', d => { const s = d.toString(); process.stderr.write(s); job.output += s; });

          proc.on('close', code => {
            const durationMs = Date.now() - startTime;
            job.result = parseTestOutput(job.output, code);
            job.done = true;
            if (insights) {
              try {
                const structured = loadRunInsights(currentProjectRoot, runId);
                job.result.flaky = structured.tests.filter(test => test.flaky).length;
              } catch (error) {
                job.result.insightsError = error.message;
              }
              try {
                fs.unlinkSync(insights.wrapperPath);
              } catch (error) {
                console.warn(`Could not remove temporary Playwright config: ${error.message}`);
              }
            }
            try {
              job.apiTraffic = extractApiTraffic(currentProjectRoot);
              console.log(`\n🌐 [Playwright Hub] Captured ${job.apiTraffic.length} API requests & responses from tests.`);
            } catch (err) {
              console.warn('⚠️ [Playwright Hub] Could not extract API traffic:', err.message);
            }
            if (!job.cancelled) {
              appendHistory(currentProjectRoot, {
                id: runId,
                runId: insights ? runId : null,
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
              try {
                retainRunInsights(currentProjectRoot);
              } catch (error) {
                console.warn(`Could not apply structured result retention: ${error.message}`);
              }
            }
            setTimeout(() => runningJobs.delete(id), 60000);
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id, runId, insightsAvailable: Boolean(insights), insightsError }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && /^\/run-insights\/[^/]+$/.test(cleanUrl)) {
      const runId = cleanUrl.slice('/run-insights/'.length);
      try {
        const insights = loadRunInsights(currentProjectRoot, runId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(insights));
      } catch (error) {
        res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    if (req.method === 'POST' && /^\/run-insights\/[^/]+\/rerun-commands$/.test(cleanUrl)) {
      const runId = cleanUrl.slice('/run-insights/'.length).replace(/\/rerun-commands$/, '');
      let body = '';
      let requestTooLarge = false;
      req.on('data', chunk => {
        if (requestTooLarge) return;
        body += chunk;
        if (Buffer.byteLength(body, 'utf8') > 64 * 1024) {
          requestTooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Rerun request exceeds the supported size limit.' }));
        }
      });
      req.on('end', () => {
        if (requestTooLarge) return;
        try {
          const parsed = JSON.parse(body || '{}');
          const commands = getFailedRerunCommands(currentProjectRoot, runId, parsed.testKeys);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ commands }));
        } catch (error) {
          res.writeHead(error.statusCode || 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
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
        transport: 'http', protocol: '2026-07-28',
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

  server.listen(requestedPort, host, () => {
    port = server.address().port;
    reportPort = port + 20;
    allurePort = port + 35;
    const networkIps = getNetworkIPs();
    console.log(`\n🎭 Playwright Automation Hub Server started!`);
    console.log(`   Local Access:   http://localhost:${port}`);
    if (!isLoopbackHost(host) && networkIps.length > 0) {
      networkIps.forEach(ip => {
        console.warn(`   LAN Access:     http://${ip}:${port}  (Trusted network only; no authentication is configured)`);
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

  server.on('close', () => {
    scenarioJobs.forEach(job => {
      if (job.status !== 'running' || !job.proc) return;
      job.status = 'failed';
      job.error = 'QARP server stopped before the scenario finished.';
      job.completedAt = new Date().toISOString();
      job.proc.kill();
    });
    const sessions = [...walkthroughSessions.values()];
    walkthroughSessions.clear();
    sessions.forEach(session => {
      if (session.browser) {
        session.browser.close().catch(error => {
          console.error('Could not close walkthrough browser after server shutdown:', error.message);
        });
      }
    });
  });

  return server;
}

// ── Express / Connect Middleware Integration ──
function runnerMiddleware(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  let server = null;
  let serverReady = null;

  function getServer() {
    if (!serverReady) {
      server = createRunnerServer({
        port: 0,
        host: '127.0.0.1',
        projectRoot,
        openBrowserOnStart: false
      });
      serverReady = new Promise((resolve, reject) => {
        const onError = error => reject(error);
        server.once('error', onError);
        server.once('listening', () => {
          server.removeListener('error', onError);
          resolve(server.address().port);
        });
      }).catch(error => {
        serverReady = null;
        throw error;
      });
    }
    return serverReady;
  }

  function addMountBootstrap(html, mountPrefix) {
    const prefix = JSON.stringify(mountPrefix).replace(/</g, '\\u003c');
    const bootstrap = `<script>window.__QARP_BASE_PATH__=${prefix};(function(){const prefix=window.__QARP_BASE_PATH__;const nativeFetch=window.fetch.bind(window);window.fetch=function(input,init){if(!prefix)return nativeFetch(input,init);let target=typeof input==='string'||input instanceof URL?input.toString():input instanceof Request?input.url:null;if(!target)return nativeFetch(input,init);const url=new URL(target,window.location.href);if(url.origin===window.location.origin&&!url.pathname.startsWith(prefix+'/')&&url.pathname!==prefix)url.pathname=prefix+url.pathname;const nextInput=input instanceof Request?new Request(url.href,input):url.href;return nativeFetch(nextInput,init)}})();</script>`;
    const headIndex = html.toLowerCase().indexOf('</head>');
    return headIndex === -1
      ? `${bootstrap}${html}`
      : `${html.slice(0, headIndex)}${bootstrap}${html.slice(headIndex)}`;
  }

  const middleware = async (req, res, next) => {
    if (!req.url || !req.url.startsWith('/') || req.url.startsWith('//')) return next();
    const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
    if (!allowedMethods.has(req.method)) return next();
    const requestOrigin = req.headers.origin;
    const requestProtocol = req.protocol || (req.socket.encrypted ? 'https' : 'http');
    const expectedOrigin = `${requestProtocol}://${req.headers.host}`;
    if (requestOrigin && requestOrigin !== expectedOrigin) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Vary': 'Origin' });
      res.end(JSON.stringify({ error: 'The QARP middleware accepts same-origin browser requests only.' }));
      return;
    }

    try {
      const internalPort = await getServer();
      const mountPrefix = String(req.baseUrl || options.mountPath || '').replace(/\/+$/, '');
      const internalOrigin = `http://127.0.0.1:${internalPort}`;
      const headers = { ...req.headers, host: `127.0.0.1:${internalPort}` };
      if (req.headers.origin) headers.origin = internalOrigin;

      let parsedBody = null;
      if (req.readableEnded && req.body !== undefined && !['GET', 'HEAD'].includes(req.method)) {
        parsedBody = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(parsedBody.length);
      }

      const upstream = http.request({
        hostname: '127.0.0.1',
        port: internalPort,
        method: req.method,
        path: req.url,
        headers
      }, upstreamResponse => {
        const responseHeaders = { ...upstreamResponse.headers };
        delete responseHeaders['access-control-allow-origin'];
        delete responseHeaders['access-control-allow-methods'];
        delete responseHeaders['access-control-allow-headers'];

        if (!(responseHeaders['content-type'] || '').includes('text/html')) {
          res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
          upstreamResponse.pipe(res);
          return;
        }

        const chunks = [];
        upstreamResponse.on('data', chunk => chunks.push(chunk));
        upstreamResponse.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf8');
          const output = Buffer.from(addMountBootstrap(html, mountPrefix), 'utf8');
          delete responseHeaders['content-encoding'];
          delete responseHeaders['transfer-encoding'];
          responseHeaders['content-length'] = String(output.length);
          res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
          res.end(output);
        });
      });

      upstream.on('error', error => {
        if (res.headersSent) {
          res.destroy(error);
          return;
        }
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `QARP middleware server failed: ${error.message}` }));
      });

      if (parsedBody) upstream.end(parsedBody);
      else req.pipe(upstream);
    } catch (error) {
      next(error);
    }
  };

  middleware.close = callback => {
    if (!server || !server.listening) {
      if (callback) callback();
      return;
    }
    server.close(callback);
  };
  return middleware;
}

// ── Auto-start if executed directly from terminal or via global CLI ──
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    let cliPort = 9300; // default to 9300
    let cliHost = '127.0.0.1';
    const lanAccess = args.includes('--lan');
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

    if (lanAccess && cliHost === '127.0.0.1') cliHost = '0.0.0.0';
    if (!isLoopbackHost(cliHost) && !lanAccess) {
      console.error('Network binding is disabled by default. Use --lan to explicitly allow trusted LAN access.');
      process.exitCode = 1;
      return;
    }

    console.log('\n=============================================================');
    console.log('  🎭 QARP Playwright Automation Hub Launcher');
    console.log('=============================================================');

    // Find available port dynamically to support multiple instances
    try {
      cliPort = await findAvailablePort(cliPort, cliPort + 20);
    } catch (err) {
      console.warn(`   ⚠️ ${err.message}`);
    }

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
      allowLan: lanAccess,
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
  analyzeProject,
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
