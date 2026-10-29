/**
 * Results & Metrics Controller
 * Processes test results, animates progress bars, renders metrics, and manages report triggers.
 */
class ResultsController {
  constructor() {
    this.params = new URLSearchParams(window.location.search);
    this.countdownSeconds = 5;
    this.countdownTimer = null;
    this.autoOpenActive = true;
  }

  init() {
    this.parseData();
    this.renderBanner();
    this.renderStats();
    this.renderProgress();
    this.renderCommand();
    this.renderFailures();
    this.setupCountdown();
  }

  parseData() {
    this.passed = parseInt(this.params.get('passed')) || 0;
    this.failed = parseInt(this.params.get('failed')) || 0;
    this.skipped = parseInt(this.params.get('skipped')) || 0;
    this.total = parseInt(this.params.get('total')) || (this.passed + this.failed + this.skipped);
    this.code = parseInt(this.params.get('code')) || 0;
    this.cmd = decodeURIComponent(this.params.get('cmd') || 'npx playwright test');
    this.success = this.failed === 0 && this.code === 0;

    this.pct = this.total > 0 ? Math.round((this.passed / this.total) * 100) : 0;

    try {
      this.failedTests = JSON.parse(decodeURIComponent(this.params.get('failedTests') || '[]'));
    } catch (_) {
      this.failedTests = [];
    }
  }

  renderBanner() {
    const banner = document.getElementById('resultBanner');
    const icon = document.getElementById('bannerIcon');
    const title = document.getElementById('bannerTitle');
    const sub = document.getElementById('bannerSub');
    const exitBadge = document.getElementById('exitBadge');
    const breadcrumb = document.getElementById('breadPath');

    if (breadcrumb) {
      const parts = this.cmd.replace('npx playwright test', '').trim().split(' ');
      breadcrumb.textContent = parts[0] || 'Tests';
    }

    if (banner) {
      banner.className = `p-6 flex items-center gap-5 border-b border-slate-800 ${this.success ? 'bg-emerald-950/20' : 'bg-rose-950/20'}`;
    }
    if (icon) icon.textContent = this.success ? '✅' : '❌';
    if (title) {
      title.textContent = this.success ? 'All tests passed successfully!' : 'Some tests failed or encountered errors';
      title.className = `text-lg font-bold tracking-tight ${this.success ? 'text-emerald-400' : 'text-rose-400'}`;
    }
    if (sub) {
      sub.textContent = `${this.passed} passed · ${this.failed} failed · ${this.skipped} skipped · ${this.total} total`;
    }
    if (exitBadge) {
      exitBadge.textContent = this.code === 0 ? 'exit 0 ✓' : `exit ${this.code} ✗`;
      exitBadge.className = `text-xs px-3 py-1 rounded font-mono border ${this.code === 0 ? 'bg-emerald-950/50 border-emerald-500/60 text-emerald-400' : 'bg-rose-950/50 border-rose-500/60 text-rose-400'}`;
    }
  }

  renderStats() {
    const pEl = document.getElementById('statPassed');
    const fEl = document.getElementById('statFailed');
    const sEl = document.getElementById('statSkipped');
    const tEl = document.getElementById('statTotal');

    if (pEl) pEl.textContent = this.passed;
    if (fEl) fEl.textContent = this.failed;
    if (sEl) sEl.textContent = this.skipped;
    if (tEl) tEl.textContent = this.total;
  }

  renderProgress() {
    const pctEl = document.getElementById('progPct');
    const fillEl = document.getElementById('mainFill');
    const segP = document.getElementById('segP');
    const segF = document.getElementById('segF');
    const segS = document.getElementById('segS');

    if (pctEl) pctEl.innerHTML = `${this.pct}<span class="text-sm font-normal text-slate-400">%</span>`;

    setTimeout(() => {
      if (fillEl) {
        fillEl.style.width = `${this.pct}%`;
        fillEl.className = `h-full rounded transition-all duration-1000 prog-fill-shimmer ${this.success ? 'bg-gradient-to-r from-emerald-500 to-cyan-500' : 'bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500'}`;
      }
      if (segP) segP.style.flex = this.passed || (this.total === 0 ? 1 : 0);
      if (segF) segF.style.flex = this.failed;
      if (segS) segS.style.flex = this.skipped;
    }, 100);
  }

  renderCommand() {
    const cmdText = document.getElementById('cmdText');
    if (!cmdText) return;

    const rest = this.cmd.replace('npx playwright test', '').trim();
    const tokens = rest.split(' ');
    const target = tokens[0] || '';
    const otherFlags = tokens.slice(1).join(' ');

    cmdText.innerHTML = `
      <span class="text-cyan-400 font-bold">npx playwright test</span>
      <span class="text-emerald-400 font-semibold">${target}</span>
      ${otherFlags ? `<span class="text-purple-400 font-mono">${otherFlags}</span>` : ''}
    `;

    // Trace banner
    const hasTrace = /--trace=(on|retain-on-failure|on-first-retry)/.test(this.cmd);
    const traceBanner = document.getElementById('traceAlert');
    if (traceBanner) {
      traceBanner.classList.toggle('hidden', !hasTrace);
    }
  }

  renderFailures() {
    const container = document.getElementById('failList');
    const badge = document.getElementById('failCountBadge');
    if (!container) return;

    if (badge) {
      badge.textContent = this.failedTests.length;
      badge.classList.toggle('hidden', this.failedTests.length === 0);
    }

    if (this.failedTests.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center p-8 bg-slate-900/40 border border-slate-800 rounded-xl text-slate-400 gap-2">
          <svg class="w-8 h-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-sm font-semibold text-slate-300">Clean execution — No test failures</span>
          <span class="text-xs text-slate-500">All assertions passed without unhandled rejections or timeouts.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = this.failedTests.map((t, i) => `
      <div class="flex items-center gap-3 p-3.5 rounded-lg bg-rose-950/30 border border-rose-900/50 hover:border-rose-500 transition-colors text-xs font-mono mb-2">
        <span class="w-6 h-6 rounded-full bg-rose-900/80 text-rose-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
          ${i + 1}
        </span>
        <span class="text-slate-200 break-all flex-1">${t}</span>
      </div>
    `).join('');
  }

  setupCountdown() {
    const cdEl = document.getElementById('cdTimer');
    const cancelBtn = document.getElementById('pauseCountdownBtn');

    this.countdownTimer = setInterval(() => {
      if (!this.autoOpenActive) return;

      this.countdownSeconds--;
      if (cdEl) cdEl.textContent = this.countdownSeconds;

      if (this.countdownSeconds <= 0) {
        clearInterval(this.countdownTimer);
        this.openReport();
      }
    }, 1000);

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.autoOpenActive = false;
        clearInterval(this.countdownTimer);
        const autoNote = document.getElementById('autoNote');
        if (autoNote) autoNote.innerHTML = '<span class="text-slate-500">Auto-open cancelled</span>';
        UI.toast('Automatic report launch paused', 'info');
      });
    }
  }

  async openReport() {
    this.autoOpenActive = false;
    clearInterval(this.countdownTimer);

    const btn = document.getElementById('btnReport');
    if (btn) {
      btn.innerHTML = '⏳ Starting HTML Report…';
      btn.disabled = true;
    }

    try {
      const { url } = await api.showReport();
      window.open(url, '_blank');
      UI.toast('HTML Report opened in new tab', 'success');
    } catch (_) {
      window.open(`http://localhost:${APP_CONFIG.reportPort}`, '_blank');
    } finally {
      if (btn) {
        btn.innerHTML = '📊 Open HTML Report';
        btn.disabled = false;
      }
    }
  }

  async openAllureReport() {
    this.autoOpenActive = false;
    clearInterval(this.countdownTimer);

    const btn = document.getElementById('btnAllure');
    if (btn) {
      btn.innerHTML = '⏳ Generating Allure…';
      btn.disabled = true;
    }

    try {
      const { url } = await api.openAllureReport();
      window.open(url, '_blank');
      UI.toast('Allure Report opened in new tab', 'success');
    } catch (_) {
      window.open(`http://localhost:${APP_CONFIG.allurePort}`, '_blank');
    } finally {
      if (btn) {
        btn.innerHTML = '✨ Open Allure Report';
        btn.disabled = false;
      }
    }
  }

  copyCommand() {
    const btn = document.getElementById('copyBtn');
    UI.copyToClipboard(this.cmd, btn);
  }

  runAgain() {
    this.autoOpenActive = false;
    clearInterval(this.countdownTimer);
    window.location.href = `../index.html?rerun=${encodeURIComponent(this.cmd)}`;
  }

  goBack() {
    this.autoOpenActive = false;
    clearInterval(this.countdownTimer);
    window.location.href = '../index.html';
  }
}

// Global Results instance
const resultsCtrl = new ResultsController();
