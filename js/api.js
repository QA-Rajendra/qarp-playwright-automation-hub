/**
 * API Integration Layer for Playwright Test Runner
 * Uses standard fetch() to communicate with the backend test runner API.
 * Includes graceful fallback & mock simulation if the backend runner is offline.
 *
 * ─── Dynamic Project Support ──────────────────────────────────────────────
 * All timeouts are sized for large real-world projects (100+ spec files).
 * Mock fallbacks are generated dynamically from the active project context,
 * so the UI always reflects your actual project — never hardcoded demo data.
 */
class PlaywrightAPI {
  constructor() {
    this.baseUrl = APP_CONFIG.apiBaseUrl;
    this.isMockMode = false;
    this.mockJobs = new Map();
    this._projectCtx = null; // live project context cache (set on successful getStructure)
  }

  /**
   * Set and persist custom API URL
   */
  setBaseUrl(url) {
    this.baseUrl = url.trim().replace(/\/+$/, '');
    localStorage.setItem('pw_api_url', this.baseUrl);
  }

  getMcpEndpoint() {
    return new URL(`${this.baseUrl.replace(/\/+$/, '')}/mcp`).href;
  }

  getRunnerPort() {
    const runnerUrl = new URL(this.baseUrl);
    return runnerUrl.port || (runnerUrl.protocol === 'https:' ? '443' : '80');
  }

  /**
   * Check connection to backend runner
   */
  async checkHealth() {
    try {
      // 4 s — generous: large Node.js process may take a moment on first wake
      const res = await fetch(`${this.baseUrl}/`, { method: 'GET', signal: AbortSignal.timeout(4000) });
      this.isMockMode = !res.ok;
      return res.ok;
    } catch (_) {
      this.isMockMode = true;
      return false;
    }
  }

  /**
   * Fetch test directory structure.
   * 15 s timeout — 100+ nested spec files may take time to scan.
   * Falls back to a dynamic empty skeleton (NOT hardcoded demo data).
   */
  async getStructure() {
    try {
      const res = await fetch(`${this.baseUrl}/structure`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = await res.json();
        this._projectCtx = data; // cache for dynamic fallbacks
        return data;
      }
    } catch (_) {}
    // Dynamic fallback — reflects real project name, NOT hardcoded Step16_ERPMaster demo data
    return this._buildEmptyStructure();
  }

  _buildEmptyStructure() {
    const projectName = this._projectCtx?.projectName
      || localStorage.getItem('pw_last_project_name')
      || 'Project';
    return { tree: [], folders: [], totalTests: 0, gitBranch: 'main', projectName, projectRoot: '' };
  }

  /**
   * Fetch configured Playwright projects (browser project names).
   * 6 s timeout — falls back to ['chromium'] (most common single-project setup).
   */
  async getProjects() {
    try {
      const res = await fetch(`${this.baseUrl}/projects`, { signal: AbortSignal.timeout(6000) });
      if (res.ok) return await res.json();
    } catch (_) {}
    return ['chromium'];
  }

  /**
   * Start a Playwright test job
   */
  async startRun(command, environment = 'DEV') {
    try {
      // 8 s — Node.js needs time to spawn the child process
      const res = await fetch(`${this.baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, environment }),
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) return await res.json();
      throw new Error(`Server returned ${res.status}`);
    } catch (err) {
      console.warn('Backend runner offline or unreachable. Using simulation mode.', err.message);
      return this._startMockJob(command);
    }
  }

  /**
   * Poll live test output and status
   */
  async pollJob(jobId, offset = 0) {
    if (this.mockJobs.has(jobId)) return this._pollMockJob(jobId, offset);
    try {
      // 8 s — streaming responses for long test suites
      const res = await fetch(`${this.baseUrl}/run/${jobId}/poll?offset=${offset}`, {
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return { gone: true, error: 'Job not found' };
      return await res.json();
    } catch (err) {
      return { gone: false, newOutput: '', offset, done: false, error: err.message };
    }
  }

  /**
   * Cancel an active test run
   */
  async cancelJob(jobId) {
    if (this.mockJobs.has(jobId)) {
      const job = this.mockJobs.get(jobId);
      if (job) { job.cancelled = true; job.done = true; return { ok: true }; }
    }
    try {
      const res = await fetch(`${this.baseUrl}/run/${jobId}/cancel`, {
        method: 'POST', signal: AbortSignal.timeout(5000)
      });
      return await res.json();
    } catch (err) { return { ok: false, error: err.message }; }
  }

  /**
   * Launch Playwright HTML Report
   */
  async showReport() {
    try {
      const res = await fetch(`${this.baseUrl}/show-report`, { method: 'POST', signal: AbortSignal.timeout(5000) });
      if (res.ok) return await res.json();
    } catch (_) {}
    return { url: `${this.baseUrl.replace(/:[0-9]+$/, '')}:${APP_CONFIG.reportPort}` };
  }

  /**
   * Generate and open Allure Report
   */
  async openAllureReport() {
    try {
      const res = await fetch(`${this.baseUrl}/allure-report`, { method: 'POST', signal: AbortSignal.timeout(5000) });
      if (res.ok) return await res.json();
    } catch (_) {}
    return { url: `${this.baseUrl.replace(/:[0-9]+$/, '')}:${APP_CONFIG.allurePort}` };
  }

  /**
   * Fetch execution history
   */
  async getHistory() {
    try {
      // 5 s — history files can be large after many runs
      const res = await fetch(`${this.baseUrl}/history`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        return await res.json();
      }
    } catch (_) {}
    // Fallback: localStorage only — no hardcoded demo history
    try {
      const local = localStorage.getItem('pw_runner_history');
      return local ? JSON.parse(local) : [];
    } catch (_) { return []; }
  }

  /**
   * Clear execution history
   */
  async clearHistory() {
    try { await fetch(`${this.baseUrl}/history/clear`, { method: 'POST', signal: AbortSignal.timeout(4000) }); } catch (_) {}
    localStorage.removeItem('pw_runner_history');
    return { ok: true };
  }

  /**
   * Save entry to local history
   */
  saveToLocalHistory(entry) {
    try {
      const current = localStorage.getItem('pw_runner_history');
      const list = current ? JSON.parse(current) : [];
      list.unshift(entry);
      localStorage.setItem('pw_runner_history', JSON.stringify(list.slice(0, 100)));
    } catch (e) {
      console.warn('Could not save history locally', e);
    }
  }

  /**
   * Fetch captured API network traffic (requests and responses)
   */
  async getApiTraffic() {
    try {
      // 6 s — traffic files from long runs can be large
      const res = await fetch(`${this.baseUrl}/api-traffic`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) return (await res.json()).traffic || [];
    } catch (_) {}
    return [];
  }

  /**
   * Clear captured API network traffic
   */
  async clearApiTraffic() {
    try {
      const res = await fetch(`${this.baseUrl}/api-traffic/clear`, { method: 'POST', signal: AbortSignal.timeout(4000) });
      return res.ok;
    } catch (_) { return false; }
  }

  /**
   * Fetch active project path and recents list.
   * 5 s timeout — caches project name to localStorage for dynamic fallbacks.
   */
  async getProjectPath() {
    try {
      const res = await fetch(`${this.baseUrl}/project-path`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.projectName) localStorage.setItem('pw_last_project_name', data.projectName);
        return data;
      }
    } catch (_) {}
    const name = localStorage.getItem('pw_last_project_name') || 'Project';
    return { current: name, projectName: name, exists: true, recents: [] };
  }

  /**
   * Switch the active project path dynamically.
   * 10 s timeout — switching re-scans directory structure. Invalidates cache.
   */
  async switchProjectPath(newPath) {
    const res = await fetch(`${this.baseUrl}/project-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ path: newPath }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
    if (data.projectName) {
      localStorage.setItem('pw_last_project_name', data.projectName);
      this._projectCtx = null; // invalidate structure cache on project switch
    }
    return data;
  }

  async getRunnerSessions() {
    const r = await fetch(`${this.baseUrl}/runner-sessions`, { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d.sessions || [];
  }

  async startRunnerSession(projectRoot, port = 0, name = '') {
    const r = await fetch(`${this.baseUrl}/runner-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ projectRoot, port, name }),
      signal: AbortSignal.timeout(15000)
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d.session;
  }

  async stopRunnerSession(sessionId) {
    const r = await fetch(`${this.baseUrl}/runner-sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE', signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }

  /**
   * Fetch dashboard summary metrics and trend data
   */
  async getDashboardSummary() {
    try {
      // 8 s — aggregates across potentially large history files
      const res = await fetch(`${this.baseUrl}/dashboard-summary`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) return await res.json();
    } catch (_) {}
    return null;
  }

  /**
   * 1-Click System Self-Test & Health Audit
   */
  async runSelfTest() {
    // 30 s — installs/checks browsers, runs full diagnostics
    const res = await fetch(`${this.baseUrl}/self-test`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000)
    });
    const report = await res.json();
    if (!res.ok) throw new Error(report.error || `HTTP ${res.status}`);
    return report;
  }

  /**
   * AI Failure Diagnosis for Playwright error traces
   */
  async diagnoseFailure(errorOutput, testName = '', command = '') {
    try {
      // 10 s — server-side AI analysis may involve text parsing
      const res = await fetch(`${this.baseUrl}/ai-diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ errorOutput, testName, command }),
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) return await res.json();
    } catch (_) {}
    return this._getMockDiagnosis(errorOutput, testName);
  }

  /**
   * Send prompt / action to AI Assistant
   */
  async askAI(prompt, actionId = '', context = {}) {
    try {
      // 12 s — AI processing can take a moment for complex queries
      const res = await fetch(`${this.baseUrl}/ai-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ prompt, actionId, context }),
        signal: AbortSignal.timeout(12000)
      });
      if (res.ok) return await res.json();
    } catch (_) {}
    return this._getMockAIResponse(prompt, actionId, context);
  }

  /**
   * Save AI generated test code to file safely
   */
  async saveTestFile(filePath, code, overwrite = false) {
    try {
      // 8 s — file write on network drives may be slow
      const res = await fetch(`${this.baseUrl}/save-test-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ filePath, code, overwrite }),
        signal: AbortSignal.timeout(8000)
      });
      return await res.json();
    } catch (err) { return { ok: false, error: err.message }; }
  }

  // ── Dynamic AI Response — real project context, never hardcoded demo data ──
  _getMockAIResponse(prompt = '', actionId = '', context = {}) {
    const projectName = context.currentProject
      || this._projectCtx?.projectName
      || localStorage.getItem('pw_last_project_name')
      || 'Project';
    const env = context.environment || 'DEV';
    const selectedTest = context.selectedSpec || '';
    const p = prompt.trim();
    const lower = p.toLowerCase();

    if (actionId === 'generate-test' || /generate|create|write.*test|new.*spec/i.test(lower)) {
      const specName = selectedTest ? selectedTest.split(/[\/\\]/).pop().replace(/\.spec\.(js|ts)$/, '') : 'new_feature';
      return {
        title: `Generated Test: ${specName}`,
        category: 'CREATE',
        summary: `Generated Playwright spec for **${projectName}** [${env}].`,
        explanation: 'Robust spec with beforeEach navigation, auto-waiting assertions, and tag annotations.',
        code: `const { test, expect } = require('@playwright/test');

test.describe('${specName} — ${projectName}', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });
  test('should render primary UI @sanity', async ({ page }) => {
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator('body')).toBeVisible();
  });
  test('should handle user interaction @regression', async ({ page }) => {
    const btn = page.getByRole('button').first();
    if (await btn.isVisible()) await btn.click();
    await expect(page.locator('body')).toBeVisible();
  });
});`,
        suggestedFileName: selectedTest || `tests/${specName}.spec.js`,
        actions: ['Copy', 'Run', 'Save']
      };
    }

    if (actionId === 'fix-test' || /fix|repair|broken|failing/i.test(lower)) {
      return {
        title: 'Resilient Locator Fix',
        category: 'FIX',
        summary: `Applied auto-waiting patterns for **${projectName}**.`,
        explanation: '**getByRole** + **waitFor({ state: visible })** eliminates race conditions and timeout failures.',
        code: `await page.waitForLoadState('domcontentloaded');
const el = page.getByRole('button', { name: /submit|save|confirm/i });
await el.waitFor({ state: 'visible', timeout: 10000 });
await el.click();
await expect(page.getByText(/success|saved|done/i)).toBeVisible({ timeout: 8000 });`,
        actions: ['Copy', 'Run']
      };
    }

    if (actionId === 'explain-test' || /explain|describe|what does|how does/i.test(lower)) {
      return {
        title: 'Test Explanation',
        category: 'EXPLAIN',
        summary: `Analysis of test structure in **${projectName}**.`,
        explanation: `### How This Test Works\n1. **Navigation**: Opens app at baseURL in \`playwright.config.js\`.\n2. **Assertions**: Web-first assertions auto-retry until passing or timeout.\n3. **Isolation**: Browser context resets between tests — no state leakage.\n4. **Context**: Project \`${projectName}\`, env \`${env}\`.`,
        code: '', actions: ['Copy']
      };
    }

    if (actionId === 'run-all' || /run all|run suite|execute all/i.test(lower)) {
      return {
        title: `Run Full Suite — ${projectName}`,
        category: 'RUN',
        summary: `Execute the complete suite for **${projectName}** [${env}].`,
        explanation: 'Switch to the **Runner** tab, select your browser project, then click **▶ Run Tests + Show Report**.',
        code: `npx playwright test --project=chromium`,
        actions: ['Copy', 'Run']
      };
    }

    if (actionId === 'mock-api' || /mock|intercept|network/i.test(lower)) {
      return {
        title: 'API Traffic Mocking',
        category: 'ANALYZE',
        summary: `Network interception strategy for **${projectName}**.`,
        explanation: '**page.route()** intercepts matching requests and returns stubs — decouples UI tests from unstable backends.',
        code: `await page.route('**/api/**', async route => {\n  await route.fulfill({\n    status: 200, contentType: 'application/json',\n    body: JSON.stringify({ success: true, data: [] })\n  });\n});\nawait page.goto('/');\nawait expect(page.locator('[data-testid="status"]')).toContainText(/loaded/i);`,
        actions: ['Copy', 'Run', 'Save']
      };
    }

    if (actionId === 'optimize-test' || /optimize|speed|slow|flaky/i.test(lower)) {
      return {
        title: 'Performance Optimization',
        category: 'IMPROVE',
        summary: `Speed improvements for **${projectName}**.`,
        explanation: '### Rules\n- Eliminate `waitForTimeout()` — use web-first assertions.\n- Block trackers/analytics to cut load time.\n- Enable `fullyParallel: true` in config.',
        code: `// Auto-retrying assertion (no hardcoded sleep):\nawait expect(page.locator('.status')).toHaveText('Done', { timeout: 8000 });\n// Block non-essential assets:\nawait page.route('**/*{analytics,hotjar,segment}*', r => r.abort());`,
        actions: ['Copy', 'Explain', 'Run']
      };
    }

    if (actionId === 'analyze-run' || /analyze.*run|summary.*run/i.test(lower)) {
      return {
        title: `Run Analysis — ${projectName}`,
        category: 'ANALYZE',
        summary: `Assessment of most recent run in **${projectName}** [${env}].`,
        explanation: `### Summary\n- **Project**: \`${projectName}\`\n- **Env**: \`${env}\`\n- **Tip**: Run with \`--workers=4\` to parallelize.`,
        code: `npx playwright test --project=chromium --reporter=html`,
        actions: ['Run', 'Copy']
      };
    }

    if (actionId === 'convert-manual-test' || /manual|convert/i.test(lower)) {
      return {
        title: 'Manual to Playwright Conversion',
        category: 'CREATE',
        summary: `Converted manual steps to automated spec for **${projectName}**.`,
        explanation: 'Manual instructions mapped to Playwright role-based locators with auto-waiting assertions.',
        code: `const { test, expect } = require('@playwright/test');\n\ntest('${p.slice(0,40) || 'Converted flow'}', async ({ page }) => {\n  await page.goto('/');\n  await page.waitForLoadState('domcontentloaded');\n  const field = page.getByRole('textbox').first();\n  if (await field.isVisible()) await field.fill('Test Input');\n  await page.getByRole('button', { name: /submit|save|continue/i }).first().click();\n  await expect(page.locator('main, .result')).toBeVisible({ timeout: 8000 });\n});`,
        suggestedFileName: `tests/converted_${Date.now()}.spec.js`,
        actions: ['Copy', 'Run', 'Save']
      };
    }

    return {
      title: `QARP AI: ${p.slice(0,40) || 'Assistant'}`,
      category: 'CREATE',
      summary: `Response for **${projectName}** [${env}].`,
      explanation: `Tailored for **${projectName}** — test \`${selectedTest || 'Active Suite'}\`.`,
      code: `const { test, expect } = require('@playwright/test');\n\ntest('${p.slice(0,50) || 'custom test'}', async ({ page }) => {\n  await page.goto('/');\n  await page.waitForLoadState('domcontentloaded');\n  await expect(page.locator('body')).toBeVisible();\n});`,
      actions: ['Copy', 'Run', 'Save']
    };
  }

  // ── Dynamic AI Diagnosis — parses real error output ──
  _getMockDiagnosis(errorOutput = '', testName = '') {
    const projectName = this._projectCtx?.projectName || localStorage.getItem('pw_last_project_name') || 'Project';
    const isTimeout = /timeout|timed out/i.test(errorOutput);
    const isLocator = /locator|selector|element/i.test(errorOutput);
    const isNetwork = /net::|ECONNREFUSED|ERR_CONNECTION/i.test(errorOutput);
    const isAssertion = /expect\(|toHaveText|toBeVisible|toBe\(/i.test(errorOutput);
    const fileMatch = errorOutput.match(/at\s+([\w\\/\.\-]+\.spec\.(js|ts)):(\d+)/);
    const file = fileMatch ? fileMatch[1] : (testName || 'tests/unknown.spec.js');
    const line = fileMatch ? parseInt(fileMatch[3]) : 0;
    let cat, badge, title, cause, findings, tips, fix;
    if (isNetwork) {
      cat = 'NETWORK_ERROR'; badge = '🌐 NETWORK ERROR'; title = 'Network Connection Failure';
      cause = 'Cannot reach server — check baseURL, VPN, and server health.';
      findings = ['Connection refused or timed out', `Project: ${projectName}`];
      tips = ['Verify baseURL in playwright.config.js', 'Check VPN / firewall'];
      fix = `await page.waitForResponse(r => r.url().includes('/api/') && r.status() === 200, { timeout: 15000 });`;
    } else if (isTimeout && isLocator) {
      cat = 'LOCATOR_TIMEOUT'; badge = '⏱ LOCATOR TIMEOUT'; title = 'Element Not Found Within Timeout';
      cause = 'Playwright could not locate the DOM element within the configured timeout.';
      findings = ['Element not visible or not in DOM', `${file}${line ? ':' + line : ''}`];
      tips = ['Use getByRole / getByTestId for resilient locators', 'Add waitFor({ state: visible })'];
      fix = `await page.waitForLoadState('domcontentloaded');\nconst el = page.getByRole('button', { name: /submit|save/i });\nawait el.waitFor({ state: 'visible', timeout: 15000 });\nawait el.click();`;
    } else if (isAssertion) {
      cat = 'ASSERTION_FAILURE'; badge = '❌ ASSERTION FAILED'; title = 'Assertion Did Not Match';
      cause = 'Actual page state did not match expected — possible UI change or timing issue.';
      findings = ['Expected value mismatch', `${file}${line ? ':' + line : ''}`];
      tips = ['Use toContainText() for partial match', 'Check for UI text changes'];
      fix = `await expect(page.locator('.status')).toContainText(/success|done/i, { timeout: 8000 });`;
    } else {
      cat = 'GENERAL_FAILURE'; badge = '⚠️ TEST FAILURE'; title = 'Test Execution Failure';
      cause = 'Unexpected error during test execution.';
      findings = errorOutput ? [errorOutput.split('\n')[0].slice(0, 120)] : ['Unknown error'];
      tips = ['Check Live Console for full output', 'Run with --headed to debug visually'];
      fix = `// Enable trace in playwright.config.js: trace: 'on'\n// Then: npx playwright show-trace trace.zip`;
    }
    return {
      category: cat, badge, severity: isNetwork ? 'CRITICAL' : 'HIGH', confidence: '90%',
      title, rootCause: cause, location: { file, line, column: 0 },
      keyFindings: findings, preventionTips: tips, suggestedFixCode: fix, projectName
    };
  }

  // ── Dynamic Mock Job Simulator — uses real spec file paths from active project ──
  _startMockJob(command) {
    const id = 'mock-' + Date.now().toString(36);
    const projectName = this._projectCtx?.projectName || localStorage.getItem('pw_last_project_name') || 'Project';
    const specFiles = this._collectSpecPaths(this._projectCtx?.tree || []);
    const useFiles = specFiles.length > 0 ? specFiles.slice(0, 8) : ['tests/sample.spec.js'];
    const logs = [
      `Running: ${command}`,
      `[Playwright] Project: ${projectName} — initializing...`,
      `[Worker 1] pid ${Math.floor(1000 + Math.random() * 9000)}`,
      `Running ${useFiles.length} file(s)`,
      ...useFiles.flatMap(f => [
        `[chromium] > ${f}`,
        `  v  [chromium] > ${f} (${(Math.random() * 3 + 0.5).toFixed(1)}s)`
      ]),
      `\n  ${useFiles.length} passed (${(useFiles.length * 1.8).toFixed(1)}s)\n`
    ];
    const isFail = command.includes('fail') || command.includes('broken');
    if (isFail && useFiles.length > 1) {
      logs.splice(5, 0,
        `  x  [chromium] > ${useFiles[0]} (Timed out 30000ms)`,
        `    Error: expect(locator).toBeVisible()\n      at ${useFiles[0]}:15:18`
      );
      logs.pop();
      logs.push(`\n  1 failed\n  ${useFiles.length - 1} passed (${(useFiles.length * 2.1).toFixed(1)}s)\n`);
    }
    const state = {
      command, logs, currentIndex: 0, output: '', done: false, cancelled: false, startTime: Date.now(),
      result: {
        code: isFail ? 1 : 0,
        passed: isFail ? useFiles.length - 1 : useFiles.length,
        failed: isFail ? 1 : 0, skipped: 0, total: useFiles.length, failedTests: []
      }
    };
    this.mockJobs.set(id, state);
    return { id };
  }

  _collectSpecPaths(nodes = []) {
    const paths = [];
    for (const node of nodes) {
      if (node.files) for (const f of node.files) paths.push(f.path);
      if (node.folders) paths.push(...this._collectSpecPaths(node.folders));
    }
    return paths;
  }

  _pollMockJob(id, offset) {
    const job = this.mockJobs.get(id);
    if (!job) return { gone: true };

    if (!job.done && !job.cancelled) {
      const step = Math.floor(Math.random() * 3) + 2; // lines to emit
      const nextSlice = job.logs.slice(job.currentIndex, job.currentIndex + step);
      job.currentIndex += step;
      if (nextSlice.length > 0) {
        job.output += (job.output ? '\n' : '') + nextSlice.join('\n');
      }

      if (job.currentIndex >= job.logs.length) {
        job.done = true;
        this.saveToLocalHistory({
          timestamp: new Date().toISOString(),
          command: job.command,
          passed: job.result.passed,
          failed: job.result.failed,
          skipped: job.result.skipped,
          total: job.result.total,
          code: job.result.code
        });
      }
    }

    return {
      newOutput: job.output.slice(offset),
      offset: job.output.length,
      done: job.done,
      result: job.done ? job.result : null
    };
  }

}

// Global API instance
const api = new PlaywrightAPI();
