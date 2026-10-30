'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_ENTRIES = 30_000;
const MAX_DEPTH = 16;
const MAX_SOURCE_FILES = 2_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_IGNORE_FILE_BYTES = 64 * 1024;
const MAX_FINDINGS = 1_000;
const MAX_SCAN_MS = 10_000;
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx']);
const IGNORED_DIRECTORIES = new Set([
  '.git', '.next', '.nuxt', '.output', '.turbo', '.vscode', '.yarn',
  'allure-report', 'allure-results', 'build', 'coverage', 'dist',
  'node_modules', 'playwright-report', 'test-results', 'vendor',
  '.cache', '.pytest_cache', '.venv', 'venv'
]);

function createFinding(ruleId, category, priority, file, line, evidence, summary, recommendation, confidence) {
  return { ruleId, category, priority, file, line, evidence, summary, recommendation, confidence };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compileIgnorePattern(rawPattern, base = '') {
  const negated = rawPattern.startsWith('!');
  let pattern = negated ? rawPattern.slice(1) : rawPattern;
  pattern = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!pattern) return null;

  const hasSlash = pattern.includes('/');
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return {
    negated,
    base,
    regex: hasSlash ? new RegExp(`^${source}(?:/.*)?$`) : new RegExp(`(?:^|/)${source}(?:$|/)`)
  };
}

function loadIgnorePatterns(root, warnings, base = '') {
  const patterns = [];
  for (const filename of ['.gitignore', '.qarpignore']) {
    const filePath = path.join(root, filename);
    if (!fs.existsSync(filePath)) continue;
    try {
      const stats = fs.lstatSync(filePath);
      if (stats.isSymbolicLink()) {
        warnings.push(`${filename} was skipped because symbolic links are not followed.`);
        continue;
      }
      if (!stats.isFile() || stats.size > MAX_IGNORE_FILE_BYTES) {
        warnings.push(`${filename} was skipped because it is not a regular file or exceeds the 64 KB limit.`);
        continue;
      }
      const contents = fs.readFileSync(filePath, 'utf8');
      contents.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const compiled = compileIgnorePattern(trimmed, base);
        if (compiled) patterns.push(compiled);
      });
    } catch (error) {
      warnings.push(`Could not read ${filename}: ${error.message}`);
    }
  }
  return patterns;
}

function isIgnored(relativePath, patterns) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.split('/').some(part => IGNORED_DIRECTORIES.has(part))) return true;
  let ignored = false;
  for (const pattern of patterns) {
    if (pattern.base && normalized !== pattern.base && !normalized.startsWith(`${pattern.base}/`)) continue;
    const scopedPath = pattern.base
      ? normalized === pattern.base ? '' : normalized.slice(pattern.base.length + 1)
      : normalized;
    if (pattern.regex.test(scopedPath)) ignored = !pattern.negated;
  }
  return ignored;
}

function analyzeSource(relativeFile, contents) {
  const findings = [];
  const lines = contents.split(/\r?\n/);
  const isTestFile = /(?:^|\/)(?:tests?|e2e|specs?)(?:\/|$)/i.test(relativeFile)
    || /\.(?:spec|test)\.[cm]?[jt]sx?$/i.test(relativeFile);

  lines.forEach((sourceLine, index) => {
    const lineNumber = index + 1;
    const line = sourceLine.trim().slice(0, 500);
    if (!isTestFile || !line || line.startsWith('//') || line.startsWith('*')) return;

    if (/\b(?:page|locator|frame)\.waitForTimeout\s*\(\s*\d+/.test(line)
        || /\bwaitForTimeout\s*\(\s*\d+/.test(line)) {
      findings.push(createFinding(
        'QARP-PW-001',
        'Playwright reliability',
        'medium',
        relativeFile,
        lineNumber,
        line,
        'Fixed test delay may slow runs and still be flaky.',
        'Wait for a specific page state or use a web-first assertion such as expect(locator).toBeVisible().',
        0.93
      ));
    }

    const locatorCall = line.match(/\.locator\s*\(\s*(['"`])(.+?)\1/);
    if (locatorCall && /(?:nth-child|nth-of-type|:nth\(|xpath=|>\s*[a-z*])/i.test(locatorCall[2])) {
      findings.push(createFinding(
        'QARP-PW-002',
        'Playwright maintainability',
        'low',
        relativeFile,
        lineNumber,
        line,
        'This selector depends on DOM structure and may break when markup changes.',
        'Prefer a user-facing locator such as getByRole, getByLabel, or a stable test ID.',
        0.78
      ));
    }
  });

  if (isTestFile && lines.length > 300) {
    findings.push(createFinding(
      'QARP-TEST-001',
      'Test maintainability',
      'low',
      relativeFile,
      1,
      `${lines.length} lines`,
      'Large test file may be harder to navigate and maintain.',
      'Consider grouping related scenarios into focused files or extracting reusable fixtures.',
      0.72
    ));
  }
  return findings;
}

function analyzeOptimizationProject(projectRoot) {
  let root;
  try {
    root = fs.realpathSync(projectRoot);
    if (!fs.statSync(root).isDirectory()) throw new Error('Active project path is not a directory.');
  } catch (error) {
    throw new Error(`Could not access the active project: ${error.message}`);
  }

  const warnings = [];
  const pending = [{
    absolute: root,
    relative: '',
    depth: 0,
    ignorePatterns: loadIgnorePatterns(root, warnings)
  }];
  const findings = [];
  let entriesVisited = 0;
  let filesAnalyzed = 0;
  let truncated = false;
  const startedAt = Date.now();

  while (pending.length && !truncated && findings.length < MAX_FINDINGS) {
    if (Date.now() - startedAt >= MAX_SCAN_MS) {
      truncated = true;
      warnings.push(`Scan stopped at the ${MAX_SCAN_MS / 1000}-second time limit.`);
      break;
    }
    const current = pending.pop();
    const activeIgnorePatterns = current.relative
      ? [...current.ignorePatterns, ...loadIgnorePatterns(current.absolute, warnings, current.relative)]
      : current.ignorePatterns;
    let entries;
    try {
      entries = fs.readdirSync(current.absolute, { withFileTypes: true });
    } catch (error) {
      if (current.relative) warnings.push(`Cannot scan ${current.relative}: ${error.message}`);
      else throw new Error(`Could not read the active project: ${error.message}`);
      continue;
    }
    entries.sort((a, b) => compareText(b.name, a.name));

    for (const entry of entries) {
      if (Date.now() - startedAt >= MAX_SCAN_MS) {
        truncated = true;
        warnings.push(`Scan stopped at the ${MAX_SCAN_MS / 1000}-second time limit.`);
        break;
      }
      entriesVisited += 1;
      if (entriesVisited > MAX_ENTRIES) {
        truncated = true;
        warnings.push(`Scan stopped at the ${MAX_ENTRIES.toLocaleString()}-entry limit.`);
        break;
      }

      const relativePath = current.relative
        ? `${current.relative}/${entry.name}`
        : entry.name;
      const absolutePath = path.join(current.absolute, entry.name);
      if (entry.isSymbolicLink() || isIgnored(relativePath, activeIgnorePatterns)) continue;

      if (entry.isDirectory()) {
        if (current.depth >= MAX_DEPTH) {
          truncated = true;
          warnings.push(`Scan stopped at the ${MAX_DEPTH}-directory-depth limit.`);
          break;
        }
        pending.push({
          absolute: absolutePath,
          relative: relativePath,
          depth: current.depth + 1,
          ignorePatterns: activeIgnorePatterns
        });
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (filesAnalyzed >= MAX_SOURCE_FILES) {
        truncated = true;
        warnings.push(`Scan stopped at the ${MAX_SOURCE_FILES.toLocaleString()}-source-file limit.`);
        break;
      }

      let stats;
      try {
        stats = fs.lstatSync(absolutePath);
      } catch (error) {
        warnings.push(`Cannot inspect ${relativePath}: ${error.message}`);
        continue;
      }
      if (!stats.isFile() || stats.isSymbolicLink()) continue;
      if (stats.size > MAX_FILE_BYTES) {
        warnings.push(`${relativePath} was skipped because it exceeds the 256 KB source-file limit.`);
        continue;
      }
      let contents;
      try {
        contents = fs.readFileSync(absolutePath, 'utf8');
      } catch (error) {
        warnings.push(`Cannot read ${relativePath}: ${error.message}`);
        continue;
      }
      filesAnalyzed += 1;
      findings.push(...analyzeSource(relativePath, contents));
      if (findings.length >= MAX_FINDINGS) {
        findings.length = MAX_FINDINGS;
        truncated = true;
        warnings.push(`Findings were capped at ${MAX_FINDINGS.toLocaleString()} results.`);
        break;
      }
    }
  }

  if (!truncated && Date.now() - startedAt >= MAX_SCAN_MS) {
    truncated = true;
    warnings.push(`Scan stopped at the ${MAX_SCAN_MS / 1000}-second time limit.`);
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  findings.sort((left, right) =>
    priorityOrder[left.priority] - priorityOrder[right.priority]
    || compareText(left.file, right.file)
    || left.line - right.line
    || compareText(left.ruleId, right.ruleId)
  );
  return {
    projectName: path.basename(root),
    scannedAt: new Date().toISOString(),
    scan: { filesAnalyzed, entriesVisited, truncated, maxDepth: MAX_DEPTH },
    findings,
    warnings
  };
}

module.exports = { analyzeOptimizationProject, analyzeSource };
