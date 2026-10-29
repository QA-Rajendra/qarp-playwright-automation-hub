'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const SENSITIVE_KEY = /authorization|cookie|password|passwd|secret|token|api[-_]?key|credential/i;

function redactText(value) {
  return String(value || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(Basic)\s+[A-Za-z0-9+/=]+/gi, '$1 [REDACTED]')
    .replace(/\b(set-cookie|cookie)\s*:\s*[^\r\n]+/gi, '$1: [REDACTED]')
    .replace(/([?&](?:access[_-]?token|api[_-]?key|password|passwd|secret|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|secret|token|api[-_]?key|authorization)\s*[:=]\s*)["']?[^&\s"',;]+/gi, '$1[REDACTED]');
}

function relativeFile(file, projectRoot) {
  if (!file) return '';
  const resolved = path.resolve(projectRoot, file);
  const relative = path.relative(projectRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return '';
  return relative.split(path.sep).join('/');
}

class QarpJsonReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile;
    this.projectRoot = path.resolve(options.projectRoot || process.cwd());
    this.runId = options.runId || '';
    this.startedAt = null;
    this.tests = new Map();
  }

  onBegin() {
    this.startedAt = new Date().toISOString();
  }

  onTestEnd(test, result) {
    const project = test.parent.project()?.name || '';
    const file = relativeFile(test.location.file, this.projectRoot);
    const titlePath = test.titlePath().filter(Boolean);
    const identity = `${project}\n${file}\n${titlePath.join('\n')}\n${test.repeatEachIndex || 0}`;
    const key = crypto.createHash('sha256').update(identity).digest('hex');
    let entry = this.tests.get(key);

    if (!entry) {
      entry = {
        key,
        project,
        file,
        title: test.title,
        titlePath,
        attempts: []
      };
      this.tests.set(key, entry);
    }

    entry.attempts.push({
      retry: result.retry,
      status: result.status,
      durationMs: result.duration,
      errors: (result.errors || []).map(error => ({
        message: redactText(error.message),
        stack: redactText(error.stack),
        location: error.location ? {
          file: relativeFile(error.location.file, this.projectRoot),
          line: error.location.line,
          column: error.location.column
        } : null
      }))
    });
  }

  async onEnd(result) {
    if (!this.outputFile) throw new Error('QARP JSON reporter requires an outputFile.');
    const tests = [...this.tests.values()].map(test => {
      const lastAttempt = test.attempts[test.attempts.length - 1];
      const failedThenPassed = test.attempts.some(attempt => ['failed', 'timedOut', 'interrupted'].includes(attempt.status))
        && lastAttempt.status === 'passed';
      return {
        ...test,
        status: lastAttempt.status,
        durationMs: test.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
        flaky: failedThenPassed,
        failure: lastAttempt.errors[0] || null
      };
    });
    const document = {
      schemaVersion: 1,
      runId: this.runId,
      startedAt: this.startedAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: result.status,
      tests
    };
    const serialized = JSON.stringify(document, null, 2);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REPORT_BYTES) {
      throw new Error(`QARP test result report exceeds ${MAX_REPORT_BYTES} bytes.`);
    }

    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    const temporaryFile = `${this.outputFile}.tmp`;
    await fs.promises.writeFile(temporaryFile, serialized, 'utf8');
    await fs.promises.rename(temporaryFile, this.outputFile);
  }
}

module.exports = QarpJsonReporter;
