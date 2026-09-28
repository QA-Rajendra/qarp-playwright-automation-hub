/**
 * Execution History Controller
 * Manages test audit logs, status filtering, re-run command routing, and log clearing.
 */
class HistoryController {
  constructor() {
    this.historyList = [];
    this.filterStatus = 'all';
    this.searchQuery = '';
  }

  async init() {
    await this.loadHistory();
    this.setupListeners();
  }

  async loadHistory() {
    const container = document.getElementById('historyList');
    if (container) {
      container.innerHTML = '<div class="p-8 text-xs text-slate-500 text-center animate-pulse">Loading execution history…</div>';
    }

    this.historyList = await api.getHistory();
    this.render();
  }

  render() {
    const container = document.getElementById('historyList');
    const countBadge = document.getElementById('historyCount');
    if (!container) return;

    let filtered = this.historyList;

    // Filter by status
    if (this.filterStatus === 'passed') {
      filtered = filtered.filter(h => (h.failed === 0) && (parseInt(h.code) === 0));
    } else if (this.filterStatus === 'failed') {
      filtered = filtered.filter(h => (h.failed > 0) || (parseInt(h.code) !== 0));
    }

    // Filter by search query
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter(h => (h.command || '').toLowerCase().includes(q));
    }

    if (countBadge) {
      countBadge.textContent = `${filtered.length} of ${this.historyList.length}`;
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 bg-slate-900/30 border border-slate-800 rounded-xl text-slate-400 gap-3">
          <svg class="w-10 h-10 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-sm font-semibold text-slate-300">No test executions match your filter</span>
          <span class="text-xs text-slate-500">Run tests from the runner dashboard to automatically record execution logs here.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(h => {
      const isSuccess = (h.failed === 0) && (parseInt(h.code) === 0);
      const dt = new Date(h.timestamp);
      const formattedDate = isNaN(dt.getTime()) ? h.timestamp : dt.toLocaleString();
      const cmdRest = (h.command || '').replace('npx playwright test', '').trim();

      return `
        <div class="p-4 rounded-xl border border-slate-800 bg-slate-900/40 hover:bg-slate-900/70 hover:border-slate-700 transition-all font-mono text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span class="text-sm">${isSuccess ? '✅' : '❌'}</span>
              <span class="text-[11px] text-slate-400">${formattedDate}</span>
              <span class="text-[10px] px-2 py-0.5 rounded ${isSuccess ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60' : 'bg-rose-950/60 text-rose-400 border border-rose-800/60'}">
                exit ${h.code}
              </span>
              <span class="text-[11px] text-emerald-400 font-semibold">${h.passed} passed</span>
              ${h.failed > 0 ? `<span class="text-[11px] text-rose-400 font-semibold">${h.failed} failed</span>` : ''}
              ${h.skipped > 0 ? `<span class="text-[11px] text-amber-400">${h.skipped} skipped</span>` : ''}
              <span class="text-[10px] text-slate-500">(${h.total} total)</span>
            </div>
            <div class="text-[11px] text-slate-300 break-all bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
              <span class="text-cyan-400 font-bold">npx playwright test</span>
              <span class="text-purple-300">${cmdRest}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
            <button type="button" class="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:border-violet-500 hover:text-purple-300 text-slate-300 transition-all text-xs flex items-center gap-1.5"
                    onclick="historyCtrl.rerunCommand('${encodeURIComponent(h.command || '')}')">
              <span>🔁</span> Run again
            </button>
            <button type="button" class="px-2 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-400 transition-all text-xs"
                    onclick="UI.copyToClipboard('${(h.command || '').replace(/'/g, "\\'")}', this)" title="Copy command">
              📋
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  setFilter(status) {
    this.filterStatus = status;
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.toggle('bg-violet-950/70', btn.dataset.status === status);
      btn.classList.toggle('border-violet-500', btn.dataset.status === status);
      btn.classList.toggle('text-purple-300', btn.dataset.status === status);
    });
    this.render();
  }

  search(val) {
    this.searchQuery = val;
    this.render();
  }

  rerunCommand(cmdEncoded) {
    const cmd = decodeURIComponent(cmdEncoded);
    window.location.href = `../index.html?rerun=${encodeURIComponent(cmd)}`;
  }

  async confirmClearHistory() {
    UI.openModal('clearConfirmModal');
  }

  async executeClearHistory() {
    UI.closeModal('clearConfirmModal');
    await api.clearHistory();
    this.historyList = [];
    this.render();
    UI.toast('Run history cleared successfully', 'info');
  }

  setupListeners() {
    const searchInput = document.getElementById('historySearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.search(e.target.value));
    }
  }
}

// Global History instance
const historyCtrl = new HistoryController();
