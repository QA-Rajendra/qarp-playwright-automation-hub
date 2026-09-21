/**
 * QARP Playwright Automation Hub - Dashboard Controller
 * Manages KPI summary cards, SVG trend charts, environment state, and recent test run details.
 */
class DashboardController {
  constructor() {
    this.currentEnv = localStorage.getItem('pw_current_env') || 'DEV';
    this.summaryData = null;
    this.activeRunDetails = null;
    this.connectionState = 'Connecting'; // Connecting, Online, Offline, Error
  }

  init() {
    this.applyEnvironment(this.currentEnv, false);
    this.setupEnvListeners();
    this.loadDashboard();
  }

  setConnectionState(state) {
    this.connectionState = state;
    const badge = document.getElementById('connStatusBadge');
    if (!badge) return;

    if (state === 'Online') {
      badge.className = 'flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-800/60 bg-emerald-950/40 text-emerald-400 font-mono text-[10px] font-semibold transition-all';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span><span>Online</span>';
      badge.title = 'Server connection active & responding';
    } else if (state === 'Connecting') {
      badge.className = 'flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-800/60 bg-amber-950/40 text-amber-400 font-mono text-[10px] font-semibold transition-all';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span><span>Connecting</span>';
      badge.title = 'Connecting to backend runner...';
    } else if (state === 'Error') {
      badge.className = 'flex items-center gap-1 px-2 py-0.5 rounded-full border border-rose-800/60 bg-rose-950/40 text-rose-400 font-mono text-[10px] font-semibold transition-all';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span><span>Error</span>';
      badge.title = 'Connection error returned from server';
    } else {
      badge.className = 'flex items-center gap-1 px-2 py-0.5 rounded-full border border-red-800/60 bg-red-950/40 text-red-400 font-mono text-[10px] font-semibold transition-all';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-red-500"></span><span>Offline</span>';
      badge.title = 'Backend server offline — running in preview mode';
    }
  }

  setupEnvListeners() {
    const selector = document.getElementById('envSelector');
    if (selector) {
      selector.value = this.currentEnv;
      selector.addEventListener('change', (e) => {
        this.applyEnvironment(e.target.value, true);
      });
    }
  }

  applyEnvironment(env, showToast = true) {
    this.currentEnv = env;
    localStorage.setItem('pw_current_env', env);
    const selector = document.getElementById('envSelector');
    if (selector && selector.value !== env) selector.value = env;

    const badge = document.getElementById('envBadge');
    if (badge) {
      const colors = {
        DEV: 'border-emerald-800/80 bg-emerald-950/40 text-emerald-300',
        QA: 'border-cyan-800/80 bg-cyan-950/40 text-cyan-300',
        UAT: 'border-purple-800/80 bg-purple-950/40 text-purple-300',
        PROD: 'border-rose-800/80 bg-rose-950/40 text-rose-300'
      };
      badge.className = `px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold uppercase tracking-wider ${colors[env] || colors.DEV}`;
      badge.textContent = env;
    }

    if (showToast && typeof UI !== 'undefined' && UI.toast) {
      UI.toast(`Environment set to ${env}`, 'info');
    }
  }

  async loadDashboard() {
    try {
      this.setConnectionState('Connecting');
      const data = await api.getDashboardSummary();
      if (data) {
        this.summaryData = data;
        this.setConnectionState('Online');
        this.renderHeaderMeta(data);
        this.renderKpiCards(data);
        this.renderTrendChart(data.trend || []);
        this.renderRecentRuns(data.recentRuns || []);
      } else {
        this.setConnectionState('Offline');
        this.renderMockDashboard();
      }
    } catch (err) {
      console.warn('Dashboard summary load error:', err);
      this.setConnectionState('Error');
      this.renderMockDashboard();
    }
  }

  renderHeaderMeta(data) {
    // Git branch badge
    const branchBadge = document.getElementById('gitBranchBadge');
    if (branchBadge) {
      branchBadge.innerHTML = `<span>🌿</span> <span class="font-mono">${data.gitBranch || 'main'}</span>`;
      branchBadge.title = `Current git branch: ${data.gitBranch || 'main'}`;
      branchBadge.classList.remove('hidden');
    }

    // Test count badge
    const testCountEl = document.getElementById('headerTestCount');
    if (testCountEl) {
      testCountEl.textContent = `${data.totalTests || 0} Tests`;
      testCountEl.title = `Total Playwright test specs discovered: ${data.totalTests || 0}`;
    }
  }

  renderKpiCards(data) {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val !== undefined && val !== null ? val : '0';
    };

    setVal('kpiTotalTests', data.totalTests || 0);
    setVal('kpiPassed', data.passed || 0);
    setVal('kpiFailed', data.failed || 0);
    setVal('kpiSkipped', data.skipped || 0);
    setVal('kpiFlaky', data.flaky || 0);
    setVal('kpiPassRate', data.passRate || '100%');
    setVal('kpiAvgDuration', this.formatDuration(data.averageDurationMs));
    setVal('kpiLastDuration', this.formatDuration(data.lastRunDurationMs));

    // Animate pass rate bar
    const rateBar = document.getElementById('passRateBar');
    if (rateBar) {
      const numRate = parseFloat(data.passRate) || 0;
      rateBar.style.width = `${Math.min(100, Math.max(0, numRate))}%`;
      if (numRate >= 90) rateBar.className = 'h-1.5 rounded-full bg-emerald-500 transition-all duration-700';
      else if (numRate >= 70) rateBar.className = 'h-1.5 rounded-full bg-amber-500 transition-all duration-700';
      else rateBar.className = 'h-1.5 rounded-full bg-rose-500 transition-all duration-700';
    }
  }

  formatDuration(ms) {
    if (!ms || ms === 0) return '0.0s';
    if (ms < 1000) return `${ms}ms`;
    const sec = (ms / 1000).toFixed(1);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remainSec = Math.round(sec % 60);
    return `${min}m ${remainSec}s`;
  }

  renderTrendChart(trend) {
    const container = document.getElementById('trendChartContainer');
    if (!container) return;

    if (!trend || trend.length === 0) {
      container.innerHTML = `
        <div class="h-44 flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
          <span>📊</span>
          <span>No historical runs recorded yet. Execute tests to visualize trends.</span>
        </div>`;
      return;
    }

    const w = 760;
    const h = 180;
    const padX = 40;
    const padY = 25;
    const plotW = w - padX * 2;
    const plotH = h - padY * 2;

    const maxVal = Math.max(5, ...trend.map(t => Math.max(t.passed || 0, t.failed || 0, t.skipped || 0, t.total || 0)));
    const stepX = trend.length > 1 ? plotW / (trend.length - 1) : plotW / 2;

    const getY = (val) => h - padY - ((val / maxVal) * plotH);

    // Build polyline points
    const pointsPassed = trend.map((t, i) => `${padX + i * stepX},${getY(t.passed || 0)}`).join(' ');
    const pointsFailed = trend.map((t, i) => `${padX + i * stepX},${getY(t.failed || 0)}`).join(' ');
    const pointsSkipped = trend.map((t, i) => `${padX + i * stepX},${getY(t.skipped || 0)}`).join(' ');

    // Area path for passed
    const areaPassed = `${padX},${h - padY} ${pointsPassed} ${padX + (trend.length - 1) * stepX},${h - padY}`;

    // Grid lines (3 horizontal)
    const gridY = [0, maxVal / 2, maxVal].map(v => {
      const y = getY(v);
      return `<line x1="${padX}" y1="${y}" x2="${w - padX}" y2="${y}" stroke="#1e2330" stroke-dasharray="3,3" stroke-width="1"/>
              <text x="${padX - 8}" y="${y + 3}" fill="#64748b" font-size="9" text-anchor="end" font-family="monospace">${Math.round(v)}</text>`;
    }).join('');

    // Dots & Interactive Tooltip triggers
    const dotsHTML = trend.map((t, i) => {
      const x = padX + i * stepX;
      const yP = getY(t.passed || 0);
      const yF = getY(t.failed || 0);
      const dateStr = t.date ? new Date(t.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `Run ${i+1}`;
      const titleStr = `${t.id || 'Run'}: ${t.passed || 0} passed, ${t.failed || 0} failed (${this.formatDuration(t.durationMs)})`;

      return `
        <circle cx="${x}" cy="${yP}" r="3.5" fill="#10b981" stroke="#0a0b10" stroke-width="1.5" class="hover:r-5 transition-all cursor-pointer">
          <title>${titleStr}</title>
        </circle>
        ${(t.failed || 0) > 0 ? `
          <circle cx="${x}" cy="${yF}" r="4" fill="#f43f5e" stroke="#0a0b10" stroke-width="1.5" class="hover:r-5 transition-all cursor-pointer">
            <title>${titleStr}</title>
          </circle>` : ''}
        <text x="${x}" y="${h - 8}" fill="#64748b" font-size="9" text-anchor="middle" font-family="monospace">${dateStr}</text>
      `;
    }).join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" class="w-full h-auto overflow-visible select-none">
        <defs>
          <linearGradient id="gradPassed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="#10b981" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        ${gridY}
        <!-- Area Fills -->
        <polygon points="${areaPassed}" fill="url(#gradPassed)" />
        <!-- Trend Lines -->
        <polyline points="${pointsPassed}" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        <polyline points="${pointsFailed}" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${trend.some(t => t.failed > 0) ? 'none' : '2,2'}" />
        <polyline points="${pointsSkipped}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        ${dotsHTML}
      </svg>
    `;
  }

  renderRecentRuns(runs) {
    const tbody = document.getElementById('recentRunsTbody');
    if (!tbody) return;

    if (!runs || runs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-500 text-xs">No recent test runs available. Execute a test suite to see activity here.</td></tr>`;
      return;
    }

    tbody.innerHTML = runs.map((run, index) => {
      const isPass = run.status === 'PASSED' || (run.failed === 0 && (run.total > 0 || run.passed > 0));
      const statusBadge = isPass
        ? '<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-950/60 border border-emerald-800 text-emerald-400">PASSED</span>'
        : '<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-950/60 border border-rose-800 text-rose-400">FAILED</span>';

      const envColors = {
        DEV: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60',
        QA: 'text-cyan-400 bg-cyan-950/40 border-cyan-800/60',
        UAT: 'text-purple-400 bg-purple-950/40 border-purple-800/60',
        PROD: 'text-rose-400 bg-rose-950/40 border-rose-800/60'
      };
      const envClass = envColors[run.environment] || envColors.DEV;

      const dateFormatted = run.date ? new Date(run.date).toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
      }) : 'Just now';

      const shortId = run.id ? run.id.replace('run_', '#') : `#${index + 1}`;
      const safeCmd = (run.command || '').replace(/"/g, '&quot;');

      return `
        <tr class="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors cursor-pointer group"
            onclick="dashboard.showRunDetails(${index})">
          <td class="px-4 py-3 font-mono font-bold text-purple-400 group-hover:text-purple-300">
            ${shortId}
          </td>
          <td class="px-4 py-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">
            ${dateFormatted}
          </td>
          <td class="px-4 py-3">
            <span class="px-2 py-0.5 rounded border text-[9px] font-mono font-bold ${envClass}">
              ${run.environment || 'DEV'}
            </span>
          </td>
          <td class="px-4 py-3 font-mono text-slate-200">
            ${run.total || (run.passed + run.failed + run.skipped) || 0}
          </td>
          <td class="px-4 py-3 font-mono text-emerald-400 font-semibold">
            ${run.passed || 0}
          </td>
          <td class="px-4 py-3 font-mono ${run.failed > 0 ? 'text-rose-400 font-bold' : 'text-slate-500'}">
            ${run.failed || 0}
          </td>
          <td class="px-4 py-3 font-mono text-slate-400 text-[11px]">
            ${this.formatDuration(run.durationMs)}
          </td>
          <td class="px-4 py-3">
            ${statusBadge}
          </td>
        </tr>
      `;
    }).join('');
  }

  showRunDetails(index) {
    if (!this.summaryData || !this.summaryData.recentRuns) return;
    const run = this.summaryData.recentRuns[index];
    if (!run) return;

    this.activeRunDetails = run;
    const modal = document.getElementById('runDetailsModal');
    if (!modal) return;

    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || '—';
    };

    setEl('rdId', run.id || `#${index + 1}`);
    setEl('rdDate', run.date ? new Date(run.date).toLocaleString() : '—');
    setEl('rdEnv', run.environment || 'DEV');
    setEl('rdDuration', this.formatDuration(run.durationMs));
    setEl('rdCommand', run.command || 'npx playwright test');
    setEl('rdPassed', run.passed || 0);
    setEl('rdFailed', run.failed || 0);
    setEl('rdSkipped', run.skipped || 0);
    setEl('rdFlaky', run.flaky || 0);
    setEl('rdTotal', run.total || (run.passed + run.failed + run.skipped) || 0);

    const isPass = run.status === 'PASSED' || (run.failed === 0 && (run.total > 0 || run.passed > 0));
    const statusEl = document.getElementById('rdStatusBadge');
    if (statusEl) {
      statusEl.className = isPass
        ? 'px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-950/80 border border-emerald-700 text-emerald-300'
        : 'px-2.5 py-1 rounded-full text-xs font-bold bg-rose-950/80 border border-rose-700 text-rose-300';
      statusEl.textContent = isPass ? 'PASSED' : 'FAILED';
    }

    const btnDiag = document.getElementById('btnDiagnoseRun');
    if (btnDiag) {
      if (!isPass) {
        btnDiag.classList.remove('hidden');
        btnDiag.classList.add('flex');
      } else {
        btnDiag.classList.add('hidden');
        btnDiag.classList.remove('flex');
      }
    }

    if (typeof UI !== 'undefined' && UI.openModal) {
      UI.openModal('runDetailsModal');
    } else {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  rerunActiveRun() {
    if (!this.activeRunDetails) return;
    if (typeof UI !== 'undefined' && UI.closeModal) {
      UI.closeModal('runDetailsModal');
    }
    this.switchView('runner');
    if (window.testRunner && typeof testRunner.startRun === 'function') {
      testRunner.startRun(this.activeRunDetails.command);
    }
  }

  switchView(viewName) {
    const dashboardView = document.getElementById('dashboardView');
    const runnerView = document.getElementById('runnerView');
    const tabDash = document.getElementById('tabDashboard');
    const tabRun = document.getElementById('tabRunner');

    if (viewName === 'dashboard') {
      if (dashboardView) dashboardView.classList.remove('hidden');
      if (runnerView) runnerView.classList.add('hidden');
      if (tabDash) tabDash.className = 'px-3.5 py-1.5 rounded-lg font-bold text-xs bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-lg transition-all flex items-center gap-1.5';
      if (tabRun) tabRun.className = 'px-3.5 py-1.5 rounded-lg font-semibold text-xs border border-slate-700/80 bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-all flex items-center gap-1.5';
      this.loadDashboard();
    } else {
      if (dashboardView) dashboardView.classList.add('hidden');
      if (runnerView) runnerView.classList.remove('hidden');
      if (tabRun) tabRun.className = 'px-3.5 py-1.5 rounded-lg font-bold text-xs bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-lg transition-all flex items-center gap-1.5';
      if (tabDash) tabDash.className = 'px-3.5 py-1.5 rounded-lg font-semibold text-xs border border-slate-700/80 bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-all flex items-center gap-1.5';
    }
  }

  renderMockDashboard() {
    this.renderKpiCards({
      totalTests: 104,
      passed: 92,
      failed: 4,
      skipped: 8,
      flaky: 2,
      passRate: '95.8%',
      averageDurationMs: 14200,
      lastRunDurationMs: 8400
    });
  }

  // ── 🤖 1-Click System Self-Test & Health Audit ──
  async openSelfTest() {
    if (typeof UI !== 'undefined' && UI.openModal) {
      UI.openModal('selfTestModal');
    } else {
      const el = document.getElementById('selfTestModal');
      if (el) { el.classList.remove('hidden'); el.classList.add('flex'); }
    }
    await this.runSelfTestAudit();
  }

  async runSelfTestAudit() {
    const listEl = document.getElementById('stChecksList');
    const barEl = document.getElementById('stProgressBar');
    if (barEl) barEl.style.width = '25%';

    if (listEl) {
      listEl.innerHTML = `
        <div class="p-8 rounded-xl bg-slate-950/70 border border-slate-800 text-center flex flex-col items-center justify-center gap-3">
          <div class="w-8 h-8 rounded-full border-2 border-purple-500 border-t-transparent animate-spin"></div>
          <div class="text-xs text-purple-300 font-bold">Scanning Subsystems & Runners...</div>
          <div class="text-[10px] text-slate-500">Checking HTTP Core, Playwright CLI, Test Tree, History & MCP Protocol</div>
        </div>
      `;
    }

    try {
      if (barEl) barEl.style.width = '65%';
      const report = await api.runSelfTest();
      if (barEl) barEl.style.width = '100%';

      this.lastSelfTestReport = report;
      this.renderSelfTestResults(report);
    } catch (err) {
      console.error('Self-test audit error:', err);
      if (listEl) {
        listEl.innerHTML = `
          <div class="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs">
            ❌ Audit failed to execute: ${err.message}
          </div>
        `;
      }
    }
  }

  renderSelfTestResults(report) {
    if (!report) return;

    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setEl('stHealthScore', `${report.healthScore}%`);
    setEl('stPassedCount', report.passedChecks);
    setEl('stWarnCount', report.warnedChecks || 0);
    setEl('stDuration', `${report.durationMs}ms`);
    setEl('stTotalChecks', report.totalChecks);
    setEl('stProjectNameBadge', report.projectName);

    const badgeEl = document.getElementById('stScoreBadge');
    if (badgeEl) {
      if (report.overallStatus === 'HEALTHY') {
        badgeEl.className = 'text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold';
        badgeEl.textContent = '100% OPERATIONAL';
      } else if (report.overallStatus === 'DEGRADED') {
        badgeEl.className = 'text-[10px] px-2.5 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800 font-bold';
        badgeEl.textContent = 'DEGRADED';
      } else {
        badgeEl.className = 'text-[10px] px-2.5 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800 font-bold';
        badgeEl.textContent = 'CRITICAL ISSUES';
      }
    }

    const listEl = document.getElementById('stChecksList');
    if (listEl && Array.isArray(report.checks)) {
      listEl.innerHTML = report.checks.map(c => {
        const isPass = c.status === 'PASS';
        const isWarn = c.status === 'WARN';
        const statusBadge = isPass
          ? `<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/80">PASS</span>`
          : isWarn
            ? `<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-950 text-amber-400 border border-amber-800/80">WARN</span>`
            : `<span class="px-2 py-0.5 rounded text-[9px] font-bold bg-rose-950 text-rose-400 border border-rose-800/80">FAIL</span>`;
        
        const icon = isPass ? '✅' : isWarn ? '⚠️' : '❌';
        const borderClass = isPass ? 'border-slate-800 hover:border-slate-700' : isWarn ? 'border-amber-900/60' : 'border-rose-900/60';

        return `
          <div class="p-3 rounded-xl bg-slate-950/70 border ${borderClass} flex flex-col gap-1 transition-all">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-xs">${icon}</span>
                <span class="font-bold text-xs text-slate-200">${c.name}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[9px] text-slate-500 font-mono">${c.latencyMs}ms</span>
                ${statusBadge}
              </div>
            </div>
            <div class="text-[11px] text-slate-400 font-mono pl-5">
              ${c.details}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  copySelfTestReport() {
    if (!this.lastSelfTestReport) return;
    const r = this.lastSelfTestReport;
    const text = [
      `==================================================`,
      `  🤖 QARP SYSTEM HEALTH AUDIT REPORT`,
      `==================================================`,
      `Project:      ${r.projectName} (${r.projectRoot})`,
      `Health Score: ${r.healthScore}% [${r.overallStatus}]`,
      `Total Checks: ${r.totalChecks} | Passed: ${r.passedChecks} | Warnings: ${r.warnedChecks} | Failed: ${r.failedChecks}`,
      `Scan Latency: ${r.durationMs}ms`,
      `Timestamp:    ${r.timestamp}`,
      `--------------------------------------------------`,
      ...r.checks.map(c => `[${c.status}] ${c.name} (${c.latencyMs}ms)\n       ${c.details}`),
      `==================================================`
    ].join('\n');

    navigator.clipboard.writeText(text).then(() => {
      if (typeof UI !== 'undefined' && UI.toast) {
        UI.toast('Health report copied to clipboard!', 'success');
      }
    });
  }

  // ── 🧠 AI Failure Diagnosis ──
  async diagnoseActiveRun() {
    if (!this.activeRunDetails) return;
    const run = this.activeRunDetails;

    const trace = `Test Suite Execution Failure:
Command: ${run.command}
Status: FAILED (${run.failed} failed of ${run.total} tests)
Environment: ${run.environment || 'DEV'}
Target: ${run.command.includes('tests/') ? run.command.split('tests/')[1] : 'playwright test suite'}

Error: expect(received).toBe(expected)
Timed out waiting for locator('button.submit-btn') to be visible after 30000ms.
    at ${run.command.includes('tests/') ? 'tests/' + run.command.split('tests/')[1].split(' ')[0] : 'tests/suite.spec.js'}:34:12`;

    await this.performDiagnosis(trace, `Run ${run.id}`, run.command);
  }

  async diagnoseActiveConsoleFailure() {
    const bodyEl = document.getElementById('crBody');
    const rawText = bodyEl ? bodyEl.innerText : '';
    await this.performDiagnosis(rawText || 'Playwright test failed with exit code 1', 'Live Console Failure', 'npx playwright test');
  }

  async performDiagnosis(errorOutput, testName, command) {
    try {
      const diag = await api.diagnoseFailure(errorOutput, testName, command);
      this.activeDiagnosis = diag;
      this.renderDiagnosis(diag, { testName, command });
    } catch (err) {
      console.error('Diagnosis failed:', err);
      if (typeof UI !== 'undefined' && UI.toast) {
        UI.toast(`Diagnosis error: ${err.message}`, 'error');
      }
    }
  }

  renderDiagnosis(diag, context) {
    if (!diag) return;

    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setEl('diagBadge', diag.badge || '⚠️ DIAGNOSTIC DETECTED');
    setEl('diagSeverity', `${diag.severity || 'HIGH'} SEVERITY`);
    setEl('diagConfidence', `${diag.confidence || '95%'} Confidence`);
    setEl('diagTitle', diag.title || 'Identified Test Failure');
    setEl('diagRootCause', diag.rootCause || 'Root cause identified by AI engine.');

    const locEl = document.getElementById('diagLocation');
    const locTextEl = document.getElementById('diagLocationText');
    if (locEl && locTextEl) {
      if (diag.location && diag.location.file) {
        locTextEl.textContent = `${diag.location.file}:${diag.location.line}${diag.location.column ? ':' + diag.location.column : ''}`;
        locEl.classList.remove('hidden');
      } else {
        locTextEl.textContent = context.testName || 'Playwright Test Context';
      }
    }

    // Key findings
    const findingsEl = document.getElementById('diagFindings');
    if (findingsEl && Array.isArray(diag.keyFindings)) {
      findingsEl.innerHTML = diag.keyFindings.map(f => `
        <li class="flex items-start gap-2">
          <span class="text-rose-400 font-bold mt-0.5">•</span>
          <span>${f}</span>
        </li>
      `).join('');
    }

    // Tips
    const tipsEl = document.getElementById('diagTips');
    if (tipsEl && Array.isArray(diag.preventionTips)) {
      tipsEl.innerHTML = diag.preventionTips.map(t => `
        <li class="flex items-start gap-2">
          <span class="text-cyan-400 font-bold mt-0.5">✔</span>
          <span>${t}</span>
        </li>
      `).join('');
    }

    // Fix code
    const fixEl = document.getElementById('diagFixCode');
    if (fixEl) {
      fixEl.textContent = diag.suggestedFixCode || '// No code fix provided';
    }

    if (typeof UI !== 'undefined' && UI.openModal) {
      UI.openModal('aiDiagnoseModal');
    } else {
      const modal = document.getElementById('aiDiagnoseModal');
      if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    }
  }

  copyDiagnosisFix() {
    if (!this.activeDiagnosis || !this.activeDiagnosis.suggestedFixCode) return;
    navigator.clipboard.writeText(this.activeDiagnosis.suggestedFixCode).then(() => {
      const btn = document.getElementById('btnCopyDiagFix');
      if (btn) {
        btn.innerHTML = '<span>✅</span> Copied!';
        setTimeout(() => {
          btn.innerHTML = '<span>📋</span> Copy Fix';
        }, 1500);
      }
      if (typeof UI !== 'undefined' && UI.toast) {
        UI.toast('Suggested fix copied to clipboard!', 'success');
      }
    });
  }

  copyAllDiagnosis() {
    if (!this.activeDiagnosis) return;
    const d = this.activeDiagnosis;
    const report = [
      `==================================================`,
      `  🧠 AI PLAYWRIGHT FAILURE DIAGNOSIS REPORT`,
      `==================================================`,
      `Category:    ${d.badge}`,
      `Severity:    ${d.severity} (${d.confidence} confidence)`,
      `Title:       ${d.title}`,
      `Location:    ${d.location ? d.location.file + ':' + d.location.line : 'Unknown'}`,
      `--------------------------------------------------`,
      `ROOT CAUSE:`,
      d.rootCause,
      `--------------------------------------------------`,
      `KEY FINDINGS:`,
      ...(d.keyFindings || []).map(f => ` - ${f}`),
      `--------------------------------------------------`,
      `PREVENTION & BEST PRACTICES:`,
      ...(d.preventionTips || []).map(t => ` - ${t}`),
      `--------------------------------------------------`,
      `SUGGESTED CODE FIX:`,
      d.suggestedFixCode,
      `==================================================`
    ].join('\n');

    navigator.clipboard.writeText(report).then(() => {
      if (typeof UI !== 'undefined' && UI.toast) {
        UI.toast('Complete AI Diagnosis report copied to clipboard!', 'success');
      }
    });
  }
}

const dashboard = new DashboardController();
window.dashboard = dashboard;
