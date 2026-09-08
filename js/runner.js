/**
 * Runner Dashboard Controller
 * Manages test execution parameters, flags, projects, tags, CLI command preview, and live console streaming.
 */
class RunnerController {
  constructor() {
    this.targetPath = null;
    this.isFolder = false;
    this.selectedProject = null;
    this.grepValue = '';
    this.grepInvert = false;
    this.flags = new Set(['--debug']);
    this.timeoutEnabled = false;
    this.timeoutMs = 30000;

    this.currentJobId = null;
    this.pollTimer = null;
    this.lastCommand = '';
  }

  async init() {
    this.renderProjects();
    this.renderFlags();
    this.renderTagPresets();
    this.setupListeners();
    this.updatePreview();
    this.checkAutoRerun();
  }

  setTarget(path, isFolder = false) {
    this.targetPath = path;
    this.isFolder = isFolder;
    this.updatePreview();
  }

  async renderProjects() {
    const container = document.getElementById('projectList');
    if (!container) return;

    const projects = await api.getProjects();
    if (!projects || projects.length === 0) {
      container.innerHTML = '<span class="text-xs text-slate-500">No projects found in playwright.config</span>';
      return;
    }

    container.innerHTML = projects.map(p => `
      <button type="button" class="proj-chip px-3 py-1 rounded text-xs border border-slate-700 bg-slate-800/80 hover:border-slate-500 text-slate-300 font-mono transition-all"
              data-project="${p}" onclick="testRunner.toggleProject(this)">
        ${p}
      </button>
    `).join('');
  }

  renderFlags() {
    const container = document.getElementById('flagsList');
    if (!container) return;

    container.innerHTML = APP_CONFIG.flags.map(f => {
      const isOn = this.flags.has(f.label);
      return `
        <button type="button" class="flag-chip px-2.5 py-1 rounded text-xs border ${isOn ? 'bg-violet-950/60 border-violet-500 text-purple-300' : 'bg-slate-800/80 border-slate-700 text-slate-400'} hover:border-slate-500 font-mono transition-all"
                data-flag="${f.label}" title="${f.hint}" onclick="testRunner.toggleFlag(this)">
          ${f.label}
        </button>
      `;
    }).join('');
  }

  renderTagPresets() {
    const container = document.getElementById('tagPresetsList');
    if (!container) return;

    container.innerHTML = APP_CONFIG.tagPresets.map(t => `
      <button type="button" class="tag-chip px-2.5 py-1 rounded-full text-xs border border-slate-700 bg-slate-800/70 hover:border-slate-500 text-slate-300 font-mono transition-all flex items-center gap-1.5"
              data-tag="${t.tag}" onclick="testRunner.setQuickTag('${t.tag}')">
        ${t.label}
      </button>
    `).join('') + `
      <button type="button" class="px-2.5 py-1 rounded-full text-xs text-slate-500 hover:text-rose-400 transition-colors" onclick="testRunner.clearQuickTag()">
        ✕ Clear
      </button>
    `;
  }

  toggleProject(el) {
    const p = el.dataset.project;
    const wasActive = el.classList.contains('active-project');

    document.querySelectorAll('.proj-chip').forEach(x => {
      x.classList.remove('active-project', 'bg-cyan-950/60', 'border-cyan-500', 'text-cyan-300');
    });

    if (wasActive) {
      this.selectedProject = null;
    } else {
      el.classList.add('active-project', 'bg-cyan-950/60', 'border-cyan-500', 'text-cyan-300');
      this.selectedProject = p;
    }
    this.updatePreview();
  }

  toggleFlag(el) {
    const flag = el.dataset.flag;
    if (this.flags.has(flag)) {
      this.flags.delete(flag);
      el.classList.remove('bg-violet-950/60', 'border-violet-500', 'text-purple-300');
      el.classList.add('bg-slate-800/80', 'border-slate-700', 'text-slate-400');
    } else {
      this.flags.add(flag);
      el.classList.add('bg-violet-950/60', 'border-violet-500', 'text-purple-300');
      el.classList.remove('bg-slate-800/80', 'border-slate-700', 'text-slate-400');
    }
    this.updatePreview();
  }

  setQuickTag(tag) {
    const input = document.getElementById('grepInput');
    if (this.grepValue === tag) {
      this.grepValue = '';
      if (input) input.value = '';
    } else {
      this.grepValue = tag;
      if (input) input.value = tag;
    }
    this.syncTagChips();
    this.updatePreview();
  }

  clearQuickTag() {
    this.grepValue = '';
    const input = document.getElementById('grepInput');
    if (input) input.value = '';
    this.syncTagChips();
    this.updatePreview();
  }

  syncTagChips() {
    document.querySelectorAll('.tag-chip[data-tag]').forEach(chip => {
      const isMatch = chip.dataset.tag === this.grepValue.trim();
      chip.classList.toggle('bg-violet-950/70', isMatch);
      chip.classList.toggle('border-violet-500', isMatch);
      chip.classList.toggle('text-purple-300', isMatch);
    });
  }

  updateGrep(val) {
    this.grepValue = val;
    this.syncTagChips();
    this.updatePreview();
  }

  toggleGrepInvert() {
    this.grepInvert = !this.grepInvert;
    const btn = document.getElementById('grepInvertBtn');
    if (btn) {
      btn.classList.toggle('bg-rose-950/70', this.grepInvert);
      btn.classList.toggle('border-rose-500', this.grepInvert);
      btn.classList.toggle('text-rose-300', this.grepInvert);
    }
    this.updatePreview();
  }

  updateTimeout(val) {
    this.timeoutMs = parseInt(val);
    const label = document.getElementById('timeoutVal');
    if (label) label.textContent = `${Number(this.timeoutMs).toLocaleString()} ms`;
    this.updatePreview();
  }

  toggleTimeout() {
    this.timeoutEnabled = !this.timeoutEnabled;
    const btn = document.getElementById('timeoutToggle');
    if (btn) {
      btn.textContent = this.timeoutEnabled ? 'enabled' : 'disabled';
      btn.classList.toggle('bg-violet-950/60', this.timeoutEnabled);
      btn.classList.toggle('border-violet-500', this.timeoutEnabled);
      btn.classList.toggle('text-purple-300', this.timeoutEnabled);
    }
    this.updatePreview();
  }

  buildCommand() {
    if (!this.targetPath) return null;
    const parts = [`npx playwright test ./${this.targetPath}`];
    if (this.selectedProject) parts.push(`--project="${this.selectedProject}"`);
    if (this.grepValue.trim()) {
      parts.push(`${this.grepInvert ? '--grep-invert=' : '--grep='}"${this.grepValue.trim()}"`);
    }
    this.flags.forEach(f => parts.push(f));
    if (this.timeoutEnabled) parts.push(`--timeout=${this.timeoutMs}`);
    return parts.join(' ');
  }

  updatePreview() {
    const previewEl = document.getElementById('cmdPreview');
    const runBtn = document.getElementById('btnRun');
    const cmd = this.buildCommand();

    if (!cmd) {
      if (previewEl) previewEl.innerHTML = '<span class="text-slate-500">— select a test file or folder from the sidebar —</span>';
      if (runBtn) runBtn.disabled = true;
      return;
    }

    const tokens = cmd.replace('npx playwright test', '').trim().split(' ');
    const target = tokens[0] || '';
    const rest = tokens.slice(1);
    const projTok = rest.filter(t => t.startsWith('--project='));
    const grepTok = rest.filter(t => t.startsWith('--grep=') || t.startsWith('--grep-invert='));
    const otherTok = rest.filter(t => !t.startsWith('--project=') && !t.startsWith('--grep=') && !t.startsWith('--grep-invert='));

    if (previewEl) {
      previewEl.innerHTML = `
        <span class="text-cyan-400 font-bold">npx playwright test</span>
        <span class="text-emerald-400 font-semibold">${target}</span>
        ${projTok.length ? `<span class="text-amber-400">${projTok.join(' ')}</span>` : ''}
        ${grepTok.length ? `<span class="text-pink-400">${grepTok.join(' ')}</span>` : ''}
        ${otherTok.length ? `<span class="text-purple-400">${otherTok.join(' ')}</span>` : ''}
      `;
    }

    if (runBtn) runBtn.disabled = false;
    this.lastCommand = cmd;
  }

  async run() {
    const cmd = this.buildCommand();
    if (!cmd) return;

    this.launchRun(cmd);
  }

  async launchRun(cmd) {
    const configPanel = document.getElementById('configPanel');
    const runningState = document.getElementById('runningState');
    const runCmd = document.getElementById('runCmd');
    const runError = document.getElementById('runError');
    const btnCancel = document.getElementById('btnCancelRun');

    if (configPanel) configPanel.classList.add('hidden');
    if (runningState) runningState.classList.remove('hidden');
    if (runCmd) runCmd.textContent = cmd;
    if (runError) runError.classList.add('hidden');
    if (btnCancel) {
      btnCancel.disabled = false;
      btnCancel.textContent = '✕ Cancel run';
    }

    this.resetConsole();
    UI.toast('Starting Playwright test execution...', 'info', 2000);

    try {
      const { id } = await api.startRun(cmd);
      this.currentJobId = id;
      this.pollJob(id, cmd);
    } catch (err) {
      this.showRunError(`Execution failed to start: ${err.message}`);
    }
  }

  pollJob(id, cmd) {
    let offset = 0;
    let failCount = 0;

    this.pollTimer = setInterval(async () => {
      try {
        const data = await api.pollJob(id, offset);
        if (data.gone) {
          clearInterval(this.pollTimer);
          this.currentJobId = null;
          this.showRunError('Lost track of test job (runner disconnected or job cleared).');
          return;
        }

        failCount = 0;
        if (data.newOutput) {
          this.appendConsole(data.newOutput);
        }
        offset = data.offset;

        if (data.done) {
          clearInterval(this.pollTimer);
          this.currentJobId = null;
          this.finishConsole();

          const res = data.result || { passed: 0, failed: 0, skipped: 0, total: 0, code: 0 };
          UI.toast(`Tests completed! Exit code: ${res.code}`, res.code === 0 ? 'success' : 'error', 3000);

          // Route to results view
          setTimeout(() => {
            const queryParams = new URLSearchParams({
              passed: res.passed,
              failed: res.failed,
              skipped: res.skipped,
              total: res.total,
              cmd: cmd,
              code: res.code,
              failedTests: JSON.stringify(res.failedTests || [])
            });
            window.location.href = `pages/results.html?${queryParams.toString()}`;
          }, 800);
        }
      } catch (_) {
        failCount++;
        if (failCount >= 6) {
          clearInterval(this.pollTimer);
          this.currentJobId = null;
          this.showRunError('Connection lost while polling for test progress.');
        }
      }
    }, 500);
  }

  async cancelRun() {
    if (!this.currentJobId) {
      window.location.reload();
      return;
    }
    const btn = document.getElementById('btnCancelRun');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Cancelling…';
    }

    clearInterval(this.pollTimer);
    await api.cancelJob(this.currentJobId);
    this.currentJobId = null;

    UI.toast('Test execution cancelled by user', 'warn');
    this.finishConsole();

    setTimeout(() => {
      const configPanel = document.getElementById('configPanel');
      const runningState = document.getElementById('runningState');
      if (configPanel) configPanel.classList.remove('hidden');
      if (runningState) runningState.classList.add('hidden');
    }, 700);
  }

  showRunError(msg) {
    const errEl = document.getElementById('runError');
    if (errEl) {
      errEl.textContent = `⚠ ${msg}`;
      errEl.classList.remove('hidden');
    }
    const runLbl = document.getElementById('runLabel');
    if (runLbl) runLbl.textContent = 'Execution Error';
    this.finishConsole();
    UI.toast(msg, 'error', 5000);
  }

  resetConsole() {
    const body = document.getElementById('crBody');
    const status = document.getElementById('crStatus');
    if (body) body.innerHTML = '';
    if (status) {
      status.textContent = '● running';
      status.className = 'text-[9px] px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-950/40 text-emerald-400 font-mono animate-pulse';
    }
  }

  appendConsole(text) {
    const body = document.getElementById('crBody');
    if (!body || !text) return;

    const lines = text.split('\n');
    lines.forEach(line => {
      if (!line && lines.indexOf(line) === lines.length - 1) return;
      const el = document.createElement('div');
      el.className = 'leading-relaxed font-mono';
      el.innerHTML = this.colorizeLog(line);
      body.appendChild(el);
    });

    body.scrollTop = body.scrollHeight;
  }

  colorizeLog(line) {
    const esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/passed|✓|✔|PASSED|\d+ passed/.test(line)) return `<span class="log-pass">${esc}</span>`;
    if (/failed|✗|✘|FAILED|\d+ failed|Error:|error:/.test(line)) return `<span class="log-fail">${esc}</span>`;
    if (/skipped|pending|todo/i.test(line)) return `<span class="log-skip">${esc}</span>`;
    if (/warn|warning/i.test(line)) return `<span class="log-warn">${esc}</span>`;
    if (/\d+ms|\d+s\b|Duration|Timeout/.test(line)) return `<span class="log-time">${esc}</span>`;
    if (/^\s*(at |Error |\s+\^)/.test(line)) return `<span class="log-err">${esc}</span>`;
    if (/\[chromium\]|\[firefox\]|\[webkit\]|\bWorker\b|\bPage\b/.test(line)) return `<span class="log-info">${esc}</span>`;
    return esc;
  }

  finishConsole() {
    const status = document.getElementById('crStatus');
    if (status) {
      status.textContent = 'finished';
      status.className = 'text-[9px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-800 text-slate-400 font-mono';
    }
  }

  checkAutoRerun() {
    const params = new URLSearchParams(window.location.search);
    const rerun = params.get('rerun');
    if (!rerun) return;

    window.history.replaceState(null, '', window.location.pathname);
    this.launchRun(decodeURIComponent(rerun));
  }

  setupListeners() {
    const grepInput = document.getElementById('grepInput');
    if (grepInput) {
      grepInput.addEventListener('input', (e) => this.updateGrep(e.target.value));
    }

    const slider = document.getElementById('timeoutSlider');
    if (slider) {
      slider.addEventListener('input', (e) => this.updateTimeout(e.target.value));
    }
  }
}

// Global Runner instance
const testRunner = new RunnerController();
window.testRunner = testRunner;
