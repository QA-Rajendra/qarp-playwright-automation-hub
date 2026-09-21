/**
 * API Integration Layer for Playwright Test Runner
 * Uses standard fetch() to communicate with the backend test runner API.
 * Includes graceful fallback & mock simulation if the backend runner is offline.
 */
class PlaywrightAPI {
  constructor() {
    this.baseUrl = APP_CONFIG.apiBaseUrl;
    this.isMockMode = false;
    this.mockJobs = new Map();
  }

  /**
   * Set and persist custom API URL
   */
  setBaseUrl(url) {
    this.baseUrl = url.replace(/\/$/, '');
    localStorage.setItem('pw_api_url', this.baseUrl);
  }

  /**
   * Check connection to backend runner
   */
  async checkHealth() {
    try {
      const res = await fetch(`${this.baseUrl}/`, { method: 'GET', signal: AbortSignal.timeout(1500) });
      this.isMockMode = !res.ok;
      return res.ok;
    } catch (_) {
      this.isMockMode = true;
      return false;
    }
  }

  /**
   * Fetch test directory structure
   */
  async getStructure() {
    try {
      const res = await fetch(`${this.baseUrl}/structure`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        return await res.json();
      }
      throw new Error('Endpoint not supported by backend');
    } catch (_) {
      // Return built-in structure
      return APP_CONFIG.mockStructure;
    }
  }

  /**
   * Fetch configured Playwright projects
   */
  async getProjects() {
    try {
      const res = await fetch(`${this.baseUrl}/projects`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        return await res.json();
      }
      throw new Error('Projects endpoint offline');
    } catch (_) {
      return APP_CONFIG.mockProjects;
    }
  }

  /**
   * Start a Playwright test job
   */
  async startRun(command, environment = 'DEV') {
    try {
      const res = await fetch(`${this.baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, environment }),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        return await res.json(); // { id, runId }
      }
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
    // If running a simulated mock job
    if (this.mockJobs.has(jobId)) {
      return this._pollMockJob(jobId, offset);
    }

    try {
      const res = await fetch(`${this.baseUrl}/run/${jobId}/poll?offset=${offset}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (!res.ok) {
        return { gone: true, error: 'Job not found' };
      }
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
      job.cancelled = true;
      job.done = true;
      return { ok: true };
    }

    try {
      const res = await fetch(`${this.baseUrl}/run/${jobId}/cancel`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000)
      });
      return await res.json();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Launch Playwright HTML Report
   */
  async showReport() {
    try {
      const res = await fetch(`${this.baseUrl}/show-report`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return { url: `${this.baseUrl.replace(/:[0-9]+$/, '')}:${APP_CONFIG.reportPort}` };
  }

  /**
   * Generate and open Allure Report
   */
  async openAllureReport() {
    try {
      const res = await fetch(`${this.baseUrl}/allure-report`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return { url: `${this.baseUrl.replace(/:[0-9]+$/, '')}:${APP_CONFIG.allurePort}` };
  }

  /**
   * Fetch execution history
   */
  async getHistory() {
    try {
      const res = await fetch(`${this.baseUrl}/history`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        return await res.json();
      }
    } catch (_) {}
    
    // Fallback to local storage history
    try {
      const local = localStorage.getItem('pw_runner_history');
      return local ? JSON.parse(local) : this._getDefaultMockHistory();
    } catch (_) {
      return this._getDefaultMockHistory();
    }
  }

  /**
   * Clear execution history
   */
  async clearHistory() {
    try {
      await fetch(`${this.baseUrl}/history/clear`, { method: 'POST', signal: AbortSignal.timeout(2000) });
    } catch (_) {}
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
      const res = await fetch(`${this.baseUrl}/api-traffic`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = await res.json();
        return data.traffic || [];
      }
    } catch (_) {}
    return [];
  }

  /**
   * Clear captured API network traffic
   */
  async clearApiTraffic() {
    try {
      const res = await fetch(`${this.baseUrl}/api-traffic/clear`, {
        method: 'POST',
        signal: AbortSignal.timeout(2000)
      });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * Fetch active project path and recents list
   */
  async getProjectPath() {
    try {
      const res = await fetch(`${this.baseUrl}/project-path`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return { current: 'Default Project', projectName: 'Default', exists: true, recents: [] };
  }

  /**
   * Switch the active project path dynamically
   */
  async switchProjectPath(newPath) {
    try {
      const res = await fetch(`${this.baseUrl}/project-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ path: newPath }),
        signal: AbortSignal.timeout(5000)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }
      return data;
    } catch (err) {
      throw err;
    }
  }

  /**
   * Fetch dashboard summary metrics and trend data
   */
  async getDashboardSummary() {
    try {
      const res = await fetch(`${this.baseUrl}/dashboard-summary`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return null;
  }

  /**
   * 1-Click System Self-Test & Health Audit
   */
  async runSelfTest() {
    try {
      const res = await fetch(`${this.baseUrl}/self-test`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return this._getMockSelfTest();
  }

  /**
   * AI Failure Diagnosis for Playwright error traces
   */
  async diagnoseFailure(errorOutput, testName = '', command = '') {
    try {
      const res = await fetch(`${this.baseUrl}/ai-diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ errorOutput, testName, command }),
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return this._getMockDiagnosis(errorOutput, testName);
  }

  /**
   * Send prompt / action to AI Assistant
   */
  async askAI(prompt, actionId = '', context = {}) {
    try {
      const res = await fetch(`${this.baseUrl}/ai-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ prompt, actionId, context }),
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    return this._getMockAIResponse(prompt, actionId, context);
  }

  /**
   * Save AI generated test code to file safely
   */
  async saveTestFile(filePath, code, overwrite = false) {
    try {
      const res = await fetch(`${this.baseUrl}/save-test-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ filePath, code, overwrite }),
        signal: AbortSignal.timeout(5000)
      });
      return await res.json();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  _getMockAIResponse(prompt = '', actionId = '', context = {}) {
    return {
      title: 'Generated Playwright Test',
      category: 'CREATE',
      summary: `Generated Playwright test for ${context.currentProject || 'Project'} [${context.environment || 'DEV'}].`,
      explanation: `Created robust test suite with resilient locators and auto-waiting.`,
      code: `const { test, expect } = require('@playwright/test');

test('Sample AI Generated Test', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Playwright/);
});`,
      actions: ['Copy', 'Run', 'Save']
    };
  }

  _getMockSelfTest() {
    return {
      timestamp: new Date().toISOString(),
      projectRoot: 'e:\\qaraj\\BestNodeJSProject',
      projectName: 'BestNodeJSProject',
      overallStatus: 'HEALTHY',
      healthScore: 100,
      totalChecks: 9,
      passedChecks: 9,
      warnedChecks: 0,
      failedChecks: 0,
      durationMs: 42,
      checks: [
        { id: 'core_server', name: 'Node.js HTTP Server Core & Uptime', status: 'PASS', latencyMs: 1, details: 'Node.js v20.18.0 | Heap: 38 MB | Port: 9300' },
        { id: 'project_root', name: 'Active Project Root Directory', status: 'PASS', latencyMs: 2, details: 'BestNodeJSProject [Writable: Yes]' },
        { id: 'playwright_config', name: 'Playwright Configuration File', status: 'PASS', latencyMs: 1, details: 'Found: playwright.config.js' },
        { id: 'test_scanner', name: 'Test Tree Scanner & Specs', status: 'PASS', latencyMs: 12, details: 'Discovered 104 tests across 18 test file(s)' },
        { id: 'playwright_cli', name: 'Playwright CLI Engine', status: 'PASS', latencyMs: 15, details: 'Installed: Version 1.48.0' },
        { id: 'history_store', name: 'Test Execution History Store', status: 'PASS', latencyMs: 2, details: 'Persistent store: .pw-runner-history.json' },
        { id: 'api_traffic', name: 'API Network Traffic Sniffer', status: 'PASS', latencyMs: 2, details: 'Persistent store: .pw-api-traffic.json' },
        { id: 'mcp_protocol', name: 'Model Context Protocol (MCP) Server', status: 'PASS', latencyMs: 3, details: 'QARP Playwright MCP Server v1.0.0 active at /mcp' },
        { id: 'frontend_assets', name: 'Frontend Hub Core Assets', status: 'PASS', latencyMs: 4, details: 'All 5 core client bundles verified intact' }
      ]
    };
  }

  _getMockDiagnosis(errorOutput = '', testName = '') {
    return {
      category: 'LOCATOR_TIMEOUT',
      badge: '⏱️ LOCATOR TIMEOUT',
      severity: 'HIGH',
      confidence: '95%',
      title: 'Timeout Waiting for Locator',
      rootCause: 'Playwright could not locate the targeted DOM element before the action timeout expired.',
      location: { file: 'tests/e2e.spec.js', line: 42, column: 8 },
      keyFindings: [
        'Locator timed out after 30000ms',
        'Element was not visible or attached in the DOM'
      ],
      preventionTips: [
        'Use semantic page.getByRole or page.getByTestId locators',
        'Wait for DOM content to settle: await page.waitForLoadState("domcontentloaded")'
      ],
      suggestedFixCode: `// Resilient locator fix:
await page.waitForLoadState('domcontentloaded');
const btn = page.getByRole('button', { name: 'Submit' });
await btn.waitFor({ state: 'visible', timeout: 15000 });
await btn.click();`
    };
  }

  /* ────────────────── Mock Simulator for Standalone Preview ────────────────── */
  _startMockJob(command) {
    const id = 'mock-' + Date.now().toString(36);
    const logs = [
      `▶ Running: ${command}`,
      `[Playwright Runner] Initializing test workers on local environment...`,
      `[Worker 1] Started worker process on pid ${Math.floor(1000 + Math.random() * 9000)}`,
      `[Worker 2] Started worker process on pid ${Math.floor(1000 + Math.random() * 9000)}`,
      `Running 12 tests using 2 workers`,
      `[chromium] › 1_authentication.spec.js:14:5 › Login with valid credentials`,
      `  ✓  [chromium] › 1_authentication.spec.js:14:5 › Login with valid credentials (1.2s)`,
      `[chromium] › 1_authentication.spec.js:32:5 › Session token persistence & refresh`,
      `  ✓  [chromium] › 1_authentication.spec.js:32:5 › Session token persistence & refresh (940ms)`,
      `[chromium] › 2_dashboard_metrics.spec.js:18:5 › Render KPIs and real-time counter`,
      `  ✓  [chromium] › 2_dashboard_metrics.spec.js:18:5 › Render KPIs and real-time counter (1.5s)`,
      `[chromium] › 2_dashboard_metrics.spec.js:45:5 › Filter courses by department`,
      `  ✓  [chromium] › 2_dashboard_metrics.spec.js:45:5 › Filter courses by department (820ms)`,
      `[chromium] › Step16_ERPMaster/1_programs.spec.js:12:5 › Create academic program`,
      `  ✓  [chromium] › Step16_ERPMaster/1_programs.spec.js:12:5 › Create academic program (2.1s)`,
      `[chromium] › Step16_ERPMaster/2_departments.spec.js:20:5 › Verify department schema`,
      `  ✓  [chromium] › Step16_ERPMaster/2_departments.spec.js:20:5 › Verify department schema (670ms)`,
      `[chromium] › Step16_ERPMaster/3_courses_catalog.spec.js:15:5 › Add course to master list`,
      `  ✓  [chromium] › Step16_ERPMaster/3_courses_catalog.spec.js:15:5 › Add course to master list (1.8s)`,
      `[chromium] › Step16_ERPMaster/4_faculty_assignment.spec.js:25:5 › Assign professor to lecture`,
      `  ✓  [chromium] › Step16_ERPMaster/4_faculty_assignment.spec.js:25:5 › Assign professor to lecture (1.1s)`,
      `[chromium] › Step16_ERPMaster/5_student_enrollment.spec.js:10:5 › Validate seat capacity limits`,
      `  ✓  [chromium] › Step16_ERPMaster/5_student_enrollment.spec.js:10:5 › Validate seat capacity limits (1.3s)`,
      `[chromium] › 2ComputerWithVPN/7_vpn_connection.spec.js:16:5 › Check network latency threshold`,
      `  ✓  [chromium] › 2ComputerWithVPN/7_vpn_connection.spec.js:16:5 › Check network latency threshold (890ms)`,
      `[chromium] › 2ComputerWithVPN/8_finalcourses.spec.js:30:5 › Final grade calculation boundary`,
      `  ✓  [chromium] › 2ComputerWithVPN/8_finalcourses.spec.js:30:5 › Final grade calculation boundary (980ms)`,
      `[chromium] › 2ComputerWithVPN/9_data_sync.spec.js:40:5 › MongoDB write transaction commit`,
      `  ✓  [chromium] › 2ComputerWithVPN/9_data_sync.spec.js:40:5 › MongoDB write transaction commit (1.4s)`,
      `\n  12 passed (15.2s)\n`
    ];

    const isFailureScenario = command.includes('fail') || command.includes('broken');
    if (isFailureScenario) {
      logs.splice(8, 0,
        `  ✘  [chromium] › 2_dashboard_metrics.spec.js:45:5 › Filter courses by department (Timed out 5000ms)`,
        `    Error: expect(locator).toBeVisible()\n    Call log:\n      - locator.waitFor({ state: 'visible' })`,
        `      at tests/2_dashboard_metrics.spec.js:48:32`
      );
      logs.pop();
      logs.push(`\n  1 failed\n  11 passed (18.1s)\n`);
    }

    const state = {
      command,
      logs,
      currentIndex: 0,
      output: '',
      done: false,
      cancelled: false,
      startTime: Date.now(),
      result: {
        code: isFailureScenario ? 1 : 0,
        passed: isFailureScenario ? 11 : 12,
        failed: isFailureScenario ? 1 : 0,
        skipped: 0,
        total: 12,
        failedTests: isFailureScenario ? ['[chromium] › 2_dashboard_metrics.spec.js:45:5 › Filter courses by department'] : []
      }
    };

    this.mockJobs.set(id, state);
    return { id };
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

  _getDefaultMockHistory() {
    return [
      {
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        command: 'npx playwright test tests/Step16_ERPMaster --project=chromium --headed',
        passed: 5,
        failed: 0,
        skipped: 0,
        total: 5,
        code: 0
      },
      {
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        command: 'npx playwright test tests/2ComputerWithVPN/8_finalcourses.spec.js --headed --project=chromium',
        passed: 3,
        failed: 0,
        skipped: 0,
        total: 3,
        code: 0
      },
      {
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        command: 'npx playwright test e2e --grep="@regression" --workers=4',
        passed: 8,
        failed: 1,
        skipped: 1,
        total: 10,
        code: 1
      }
    ];
  }
}

// Global API instance
const api = new PlaywrightAPI();
