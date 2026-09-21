/**
 * QARP-Tool AI Assistant & Context-Aware Suggestion Box Controller
 * Integrates dynamic suggestions, categorized quick actions, predictive smart input,
 * and Playwright JavaScript code action bars.
 */
class AIAssistantController {
  constructor() {
    this.context = {
      currentProject: '',
      selectedTest: '',
      selectedFile: '',
      selectedFolder: '',
      environment: 'DEV',
      browser: 'chromium',
      latestRun: null,
      failedTests: 0,
      latestError: '',
      apiRequests: 0,
      apiFailures: 0,
      consoleLogs: ''
    };

    this.pinnedSuggestions = this.loadPinnedSuggestions();
    this.recentActions = this.loadRecentActions();
    this.isExpanded = false;
    this.isOpen = false;
    this.showMore = false;
    this.activeCategory = 'ALL';
    this.activeGeneratedCode = '';
    this.activeGeneratedFile = '';
  }

  init() {
    this.syncContext();
    this.setupListeners();
    this.renderContextChips();
    this.renderSuggestions();
    this.renderRecentActions();
  }

  // ── Context Management ──────────────────────────────────────────────────
  syncContext() {
    if (window.dashboard) {
      this.context.environment = dashboard.currentEnv || 'DEV';
      if (dashboard.summaryData) {
        this.context.currentProject = dashboard.summaryData.projectName || 'BestNodeJSProject';
        if (dashboard.summaryData.recentRuns && dashboard.summaryData.recentRuns.length > 0) {
          const run = dashboard.summaryData.recentRuns[0];
          this.context.latestRun = run;
          this.context.failedTests = run.failed || 0;
        }
      }
    }

    const prjEl = document.getElementById('headerProjectName');
    if (prjEl && prjEl.textContent) {
      this.context.currentProject = prjEl.textContent.trim();
    }

    const crBody = document.getElementById('crBody');
    if (crBody && crBody.innerText) {
      this.context.consoleLogs = crBody.innerText.slice(-2000);
      const errMatch = this.context.consoleLogs.match(/(Error:[^\n]+|Timeout \d+ms exceeded[^\n]+)/i);
      if (errMatch) {
        this.context.latestError = errMatch[0];
      }
    }
  }

  onContextChanged(partialContext = {}) {
    Object.assign(this.context, partialContext);
    this.renderContextChips();
    this.renderSuggestions();
  }

  renderContextChips() {
    const setChip = (id, active, label, tooltip) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (active) {
        el.className = 'flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-800/80 bg-emerald-950/40 text-emerald-300 text-[9px] font-mono cursor-pointer transition-all hover:scale-105';
        el.innerHTML = `<span>✓</span> <span>${label}</span>`;
      } else {
        el.className = 'flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-800 bg-slate-950/40 text-slate-500 text-[9px] font-mono cursor-pointer transition-all';
        el.innerHTML = `<span class="opacity-50">•</span> <span>${label}</span>`;
      }
      if (tooltip) el.title = tooltip;
    };

    setChip('aiCtxProject', !!this.context.currentProject, this.context.currentProject || 'Project', `Active Project: ${this.context.currentProject || 'None'}`);
    setChip('aiCtxTest', !!this.context.selectedTest, this.context.selectedTest ? pathBasename(this.context.selectedTest) : 'Test', `Selected Test: ${this.context.selectedTest || 'No test selected'}`);
    setChip('aiCtxRun', !!this.context.latestRun, this.context.latestRun ? (this.context.latestRun.failed > 0 ? 'Run: Fail' : 'Run: Pass') : 'Run', `Latest Run: ${this.context.latestRun ? this.context.latestRun.status : 'No runs logged'}`);
    setChip('aiCtxError', !!this.context.latestError || this.context.failedTests > 0, this.context.failedTests > 0 ? `${this.context.failedTests} Errors` : 'Errors', `Errors: ${this.context.latestError || (this.context.failedTests + ' failures')}`);
    setChip('aiCtxApi', this.context.apiRequests > 0, this.context.apiFailures > 0 ? `${this.context.apiFailures} API Fails` : (this.context.apiRequests > 0 ? `${this.context.apiRequests} APIs` : 'API'), `Captured API Requests: ${this.context.apiRequests}`);
  }

  // ── Dynamic Suggestion Engine ───────────────────────────────────────────
  getAISuggestions() {
    const list = [];
    const ctx = this.context;
    const testName = ctx.selectedTest ? pathBasename(ctx.selectedTest) : '';
    const hasFailures = ctx.failedTests > 0 || !!ctx.latestError;
    const hasApiFailures = ctx.apiFailures > 0;
    const hasSelectedTest = !!ctx.selectedTest;
    const isSuccess = ctx.latestRun && ctx.latestRun.status === 'PASSED' && !hasFailures;

    // 1. High Priority: DEBUG (If failure or error detected)
    if (hasFailures) {
      list.push({
        id: 'debug-failure',
        category: 'DEBUG',
        priority: 100,
        icon: '🐞',
        title: ctx.failedTests > 1 ? `Debug ${ctx.failedTests} Failed Tests` : 'Debug Failure',
        description: 'Analyze failure stack trace and suggest resilient code fix',
        actionId: 'debug-failure'
      });
      list.push({
        id: 'fix-test',
        category: 'DEBUG',
        priority: 95,
        icon: '🔄',
        title: 'Fix Failed Test',
        description: 'Generate replacement Playwright JavaScript code with auto-waits',
        actionId: 'fix-test'
      });
      list.push({
        id: 'explain-error',
        category: 'DEBUG',
        priority: 90,
        icon: '🔍',
        title: 'Explain Error',
        description: 'Plain-English explanation of why this assertion or timeout failed',
        actionId: 'explain-error'
      });
      list.push({
        id: 'analyze-screenshot',
        category: 'DEBUG',
        priority: 85,
        icon: '📸',
        title: 'Analyze Trace & State',
        description: 'Inspect DOM snapshot, console logs and actionability state',
        actionId: 'debug-failure'
      });
    }

    // 2. High Priority: API Failure (If network failure detected)
    if (hasApiFailures) {
      list.push({
        id: 'analyze-api-failure',
        category: 'ANALYZE',
        priority: 98,
        icon: '📡',
        title: 'Analyze API Failure',
        description: 'Inspect failing HTTP status, network headers and response payload',
        actionId: 'analyze-api'
      });
      list.push({
        id: 'mock-api',
        category: 'CREATE',
        priority: 92,
        icon: '🧪',
        title: 'Generate API Mock Test',
        description: 'Create Playwright page.route() mock handler to bypass API stalls',
        actionId: 'analyze-api'
      });
    }

    // 3. Medium Priority: Selected Test Actions
    if (hasSelectedTest) {
      list.push({
        id: 'analyze-current-test',
        category: 'ANALYZE',
        priority: hasFailures ? 70 : 95,
        icon: '🔍',
        title: `Analyze ${testName || 'Test'}`,
        description: 'Audit test structure, locators resilience and execution risks',
        actionId: 'analyze-test'
      });
      list.push({
        id: 'optimize-test',
        category: 'IMPROVE',
        priority: hasFailures ? 65 : 90,
        icon: '⚡',
        title: 'Optimize Test Execution',
        description: 'Remove arbitrary sleeps, eliminate flakiness, tune for speed',
        actionId: 'optimize-test'
      });
      list.push({
        id: 'improve-locators',
        category: 'IMPROVE',
        priority: 85,
        icon: '🎯',
        title: 'Improve Locators',
        description: 'Upgrade fragile CSS/XPath to semantic getByRole & getByLabel',
        actionId: 'generate-locator'
      });
      list.push({
        id: 'generate-negative-cases',
        category: 'CREATE',
        priority: 80,
        icon: '🧪',
        title: 'Generate Negative Cases',
        description: 'Create validation and boundary test scenarios for this flow',
        actionId: 'generate-test-cases'
      });
      list.push({
        id: 'explain-test',
        category: 'ANALYZE',
        priority: 75,
        icon: '▶',
        title: 'Explain This Test',
        description: 'Step-by-step summary of user interactions and assertions',
        actionId: 'analyze-test'
      });
    }

    // 4. Success State Actions
    if (isSuccess && !hasFailures) {
      list.push({
        id: 'optimize-test-success',
        category: 'IMPROVE',
        priority: 95,
        icon: '⚡',
        title: 'Optimize Passed Suite',
        description: 'Evaluate opportunities for parallelization and faster runs',
        actionId: 'optimize-test'
      });
      list.push({
        id: 'detect-flaky',
        category: 'ANALYZE',
        priority: 90,
        icon: '⚠',
        title: 'Detect Potential Flakiness',
        description: 'Identify race conditions and unreliable timing assertions',
        actionId: 'optimize-test'
      });
      list.push({
        id: 'analyze-run',
        category: 'ANALYZE',
        priority: 85,
        icon: '📊',
        title: 'Analyze Run Results',
        description: 'Execution stability summary across environments',
        actionId: 'analyze-run'
      });
    }

    // 5. Default Baseline Actions: CREATE
    list.push({
      id: 'generate-test',
      category: 'CREATE',
      priority: hasFailures ? 50 : 88,
      icon: '✨',
      title: 'Generate Playwright Test',
      description: 'Create an end-to-end JavaScript test with semantic locators',
      actionId: 'generate-test'
    });
    list.push({
      id: 'generate-test-cases',
      category: 'CREATE',
      priority: hasFailures ? 45 : 82,
      icon: '🧪',
      title: 'Generate QA Test Cases',
      description: 'Construct positive, negative, boundary and security test matrix',
      actionId: 'generate-test-cases'
    });
    list.push({
      id: 'convert-manual-test',
      category: 'CREATE',
      priority: 70,
      icon: '📝',
      title: 'Convert Manual Test → Code',
      description: 'Translate manual QA steps into automated Playwright JavaScript',
      actionId: 'convert-manual-test'
    });
    list.push({
      id: 'generate-locator',
      category: 'CREATE',
      priority: 72,
      icon: '🎯',
      title: 'Generate Locator',
      description: 'Find user-visible, resilient Playwright locator options',
      actionId: 'generate-locator'
    });
    list.push({
      id: 'analyze-api-general',
      category: 'ANALYZE',
      priority: 60,
      icon: '📡',
      title: 'Analyze API Traffic',
      description: 'Review captured requests & responses from recent executions',
      actionId: 'analyze-api'
    });
    list.push({
      id: 'clean-test-code',
      category: 'IMPROVE',
      priority: 55,
      icon: '🧹',
      title: 'Clean & Refactor Code',
      description: 'Organize page fixtures, selectors and helper utilities',
      actionId: 'optimize-test'
    });

    // Remove duplicates by id
    const unique = [];
    const seen = new Set();
    for (const item of list) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        unique.push(item);
      }
    }

    // Sort by priority descending
    unique.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return unique;
  }

  // ── Render Suggestions Box ──────────────────────────────────────────────
  renderSuggestions() {
    const container = document.getElementById('aiSuggestionsContainer');
    const countEl = document.getElementById('aiSuggestionsCount');
    const moreBtn = document.getElementById('btnAiMoreSuggestions');
    if (!container) return;

    const all = this.getAISuggestions();
    const count = all.length;
    if (countEl) countEl.textContent = `(${count})`;

    let displayList = all;
    if (!this.showMore) {
      displayList = all.slice(0, 6);
      if (moreBtn) moreBtn.innerHTML = `<span>+</span> <span>More Suggestions (${count - 6} more)</span>`;
    } else {
      if (moreBtn) moreBtn.innerHTML = `<span>−</span> <span>Fewer Suggestions</span>`;
    }

    // If categorized filter is active
    if (this.showMore && this.activeCategory !== 'ALL') {
      displayList = all.filter(s => s.category === this.activeCategory);
    }

    const cardsHtml = displayList.map(s => {
      const isPinned = this.isSuggestionPinned(s.id);
      return `
        <div class="ai-sugg-card group relative p-3 rounded-xl bg-slate-950/70 border border-slate-800/90 hover:border-purple-600/70 hover:bg-purple-950/20 transition-all cursor-pointer shadow-sm flex flex-col justify-between"
             onclick="aiAssistant.executeSuggestion('${s.actionId}', '${escapeHtml(s.title)}')">
          <div class="flex items-start justify-between gap-1.5">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-base flex-shrink-0">${s.icon}</span>
              <span class="font-bold text-xs text-slate-200 group-hover:text-purple-300 transition-colors truncate">
                ${s.title}
              </span>
            </div>
            <button type="button" 
                    class="text-xs p-0.5 text-slate-500 hover:text-amber-400 transition-colors"
                    title="${isPinned ? 'Unpin' : 'Pin to My Suggestions'}"
                    onclick="event.stopPropagation(); aiAssistant.togglePin('${s.id}')">
              ${isPinned ? '⭐' : '☆'}
            </button>
          </div>
          <p class="text-[10px] text-slate-400 mt-1 line-clamp-2 leading-relaxed font-sans">
            ${s.description}
          </p>
        </div>
      `;
    }).join('');

    container.innerHTML = cardsHtml;
    this.renderPinnedSuggestions();
  }

  toggleMoreSuggestions() {
    this.showMore = !this.showMore;
    const catTabs = document.getElementById('aiCategoryTabs');
    if (catTabs) {
      if (this.showMore) {
        catTabs.classList.remove('hidden');
        catTabs.classList.add('flex');
      } else {
        catTabs.classList.add('hidden');
        catTabs.classList.remove('flex');
      }
    }
    this.renderSuggestions();
  }

  setCategory(category) {
    this.activeCategory = category;
    const tabs = document.querySelectorAll('.ai-cat-tab');
    tabs.forEach(t => {
      if (t.dataset.cat === category) {
        t.className = 'ai-cat-tab px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-900/60 text-purple-200 border border-purple-700 transition-all';
      } else {
        t.className = 'ai-cat-tab px-2.5 py-0.5 rounded text-[10px] font-medium text-slate-400 hover:text-slate-200 bg-slate-900/60 border border-slate-800 transition-all';
      }
    });
    this.renderSuggestions();
  }

  // ── Pinned Suggestions ──────────────────────────────────────────────────
  loadPinnedSuggestions() {
    try {
      return JSON.parse(localStorage.getItem('pw_ai_pinned_suggestions') || '["generate-test", "debug-failure", "generate-locator"]');
    } catch (_) {
      return ['generate-test', 'debug-failure', 'generate-locator'];
    }
  }

  savePinnedSuggestions() {
    try {
      localStorage.setItem('pw_ai_pinned_suggestions', JSON.stringify(this.pinnedSuggestions));
    } catch (_) {}
  }

  isSuggestionPinned(id) {
    return this.pinnedSuggestions.includes(id);
  }

  togglePin(id) {
    if (this.pinnedSuggestions.includes(id)) {
      this.pinnedSuggestions = this.pinnedSuggestions.filter(p => p !== id);
      if (typeof UI !== 'undefined' && UI.toast) UI.toast('Suggestion unpinned', 'info');
    } else {
      this.pinnedSuggestions.push(id);
      if (typeof UI !== 'undefined' && UI.toast) UI.toast('Pinned to ⭐ My Suggestions!', 'success');
    }
    this.savePinnedSuggestions();
    this.renderSuggestions();
  }

  renderPinnedSuggestions() {
    const container = document.getElementById('aiPinnedContainer');
    const sec = document.getElementById('aiPinnedSection');
    if (!container || !sec) return;

    if (this.pinnedSuggestions.length === 0) {
      sec.classList.add('hidden');
      return;
    }

    sec.classList.remove('hidden');
    const all = this.getAISuggestions();
    const pinned = all.filter(s => this.pinnedSuggestions.includes(s.id));

    container.innerHTML = pinned.map(s => `
      <button type="button" 
              class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-900/40 bg-amber-950/20 hover:bg-amber-900/40 text-amber-300 font-mono text-[10px] font-semibold transition-all group"
              onclick="aiAssistant.executeSuggestion('${s.actionId}', '${escapeHtml(s.title)}')">
        <span>${s.icon}</span>
        <span class="truncate max-w-[130px]">${s.title}</span>
      </button>
    `).join('');
  }

  // ── Recent AI Actions ───────────────────────────────────────────────────
  loadRecentActions() {
    try {
      return JSON.parse(localStorage.getItem('pw_ai_recent_actions') || '[]');
    } catch (_) {
      return [];
    }
  }

  saveRecentActions() {
    try {
      localStorage.setItem('pw_ai_recent_actions', JSON.stringify(this.recentActions.slice(0, 8)));
    } catch (_) {}
  }

  addRecentAction(title, actionId) {
    const item = {
      title,
      actionId,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    this.recentActions = [item, ...this.recentActions.filter(r => r.title !== title)].slice(0, 8);
    this.saveRecentActions();
    this.renderRecentActions();
  }

  renderRecentActions() {
    const list = document.getElementById('aiRecentActionsList');
    const sec = document.getElementById('aiRecentSection');
    if (!list || !sec) return;

    if (this.recentActions.length === 0) {
      sec.classList.add('hidden');
      return;
    }

    sec.classList.remove('hidden');
    list.innerHTML = this.recentActions.map(r => `
      <div class="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-800/60 cursor-pointer text-[10px] text-slate-300 group transition-colors"
           onclick="aiAssistant.executeSuggestion('${r.actionId}', '${escapeHtml(r.title)}')">
        <div class="flex items-center gap-1.5 truncate">
          <span class="text-slate-500">🕘</span>
          <span class="group-hover:text-cyan-300 truncate">${r.title}</span>
        </div>
        <span class="text-[9px] text-slate-500 font-mono flex-shrink-0">${r.timestamp}</span>
      </div>
    `).join('');
  }

  // ── Predictive Autocomplete for Chat Input ──────────────────────────────
  onChatInput(value) {
    const popup = document.getElementById('aiSmartSuggestionsPopup');
    const list = document.getElementById('aiSmartSuggestionsList');
    if (!popup || !list) return;

    const v = (value || '').trim().toLowerCase();
    if (v.length < 2) {
      popup.classList.add('hidden');
      return;
    }

    const matches = this.getPredictiveMatches(v);
    if (matches.length === 0) {
      popup.classList.add('hidden');
      return;
    }

    list.innerHTML = matches.map(m => `
      <div class="flex items-center justify-between p-2 rounded-lg hover:bg-purple-950/40 hover:text-purple-200 text-slate-300 cursor-pointer transition-all"
           onclick="aiAssistant.applySmartSuggestion('${escapeHtml(m.title)}', '${m.actionId}')">
        <div class="flex items-center gap-2 truncate">
          <span class="text-sm">${m.icon}</span>
          <span class="font-bold text-xs truncate">${m.title}</span>
        </div>
        <span class="text-[9px] text-slate-500 font-mono">${m.category}</span>
      </div>
    `).join('');

    popup.classList.remove('hidden');
  }

  getPredictiveMatches(query) {
    const keywords = {
      create: [
        { icon: '✨', title: 'Create Playwright test', actionId: 'generate-test', category: 'CREATE' },
        { icon: '🧪', title: 'Create test cases', actionId: 'generate-test-cases', category: 'CREATE' },
        { icon: '📡', title: 'Create API test', actionId: 'analyze-api', category: 'CREATE' },
        { icon: '📝', title: 'Create negative test cases', actionId: 'generate-test-cases', category: 'CREATE' }
      ],
      debug: [
        { icon: '🐞', title: 'Debug latest failure', actionId: 'debug-failure', category: 'DEBUG' },
        { icon: '🔍', title: 'Explain error trace', actionId: 'explain-error', category: 'DEBUG' },
        { icon: '🔄', title: 'Fix failed test', actionId: 'fix-test', category: 'DEBUG' },
        { icon: '📸', title: 'Analyze screenshot', actionId: 'debug-failure', category: 'DEBUG' }
      ],
      locator: [
        { icon: '🎯', title: 'Generate locator', actionId: 'generate-locator', category: 'CREATE' },
        { icon: '🎯', title: 'Improve current locator', actionId: 'generate-locator', category: 'IMPROVE' },
        { icon: '🔍', title: 'Analyze locator reliability', actionId: 'generate-locator', category: 'ANALYZE' }
      ],
      login: [
        { icon: '✨', title: 'Create Login Test', actionId: 'generate-test', category: 'CREATE' },
        { icon: '🧪', title: 'Create Login Test Cases', actionId: 'generate-test-cases', category: 'CREATE' },
        { icon: '🎯', title: 'Find Login Locators', actionId: 'generate-locator', category: 'CREATE' },
        { icon: '🔐', title: 'Test Invalid Login', actionId: 'generate-test-cases', category: 'DEBUG' },
        { icon: '🔍', title: 'Analyze Login Test', actionId: 'analyze-test', category: 'ANALYZE' }
      ],
      payment: [
        { icon: '💳', title: 'Create Payment Test', actionId: 'generate-test', category: 'CREATE' },
        { icon: '🧪', title: 'Payment Validation Cases', actionId: 'generate-test-cases', category: 'CREATE' },
        { icon: '🐞', title: 'Analyze Payment Failure', actionId: 'debug-failure', category: 'DEBUG' },
        { icon: '📡', title: 'Analyze Payment API', actionId: 'analyze-api', category: 'ANALYZE' },
        { icon: '🔄', title: 'Fix Payment Test', actionId: 'fix-test', category: 'DEBUG' }
      ],
      admission: [
        { icon: '📝', title: 'Create Admission Test', actionId: 'generate-test', category: 'CREATE' },
        { icon: '🧪', title: 'Admission Validation Cases', actionId: 'generate-test-cases', category: 'CREATE' },
        { icon: '🐞', title: 'Analyze Admission Failure', actionId: 'debug-failure', category: 'DEBUG' },
        { icon: '🔍', title: 'Generate Admission Locators', actionId: 'generate-locator', category: 'CREATE' },
        { icon: '📊', title: 'Analyze Admission Tests', actionId: 'analyze-test', category: 'ANALYZE' }
      ]
    };

    // Exact key match
    for (const [key, items] of Object.entries(keywords)) {
      if (query.includes(key)) return items;
    }

    // Substring match in titles
    const all = this.getAISuggestions();
    return all.filter(s => s.title.toLowerCase().includes(query) || s.description.toLowerCase().includes(query)).slice(0, 4);
  }

  applySmartSuggestion(title, actionId) {
    const input = document.getElementById('aiChatInput');
    const popup = document.getElementById('aiSmartSuggestionsPopup');
    if (input) input.value = '';
    if (popup) popup.classList.add('hidden');
    this.executeSuggestion(actionId, title);
  }

  // ── Execution & Prompt Dispatching ──────────────────────────────────────
  async executeSuggestion(actionId, title) {
    this.syncContext();
    this.addRecentAction(title, actionId);

    // Render user message in chat
    this.appendChatMessage('user', title);

    // Show AI typing indicator
    const msgId = this.appendTypingMessage();

    try {
      const response = await api.askAI(title, actionId, this.context);
      this.updateAIMessage(msgId, response);
    } catch (err) {
      this.updateAIMessage(msgId, {
        title: 'Error processing request',
        summary: `Could not connect to AI service: ${err.message}`,
        explanation: 'Please ensure QARP server is running.',
        code: null
      });
    }
  }

  async sendUserPrompt() {
    const input = document.getElementById('aiChatInput');
    if (!input || !input.value.trim()) return;

    const text = input.value.trim();
    input.value = '';

    const popup = document.getElementById('aiSmartSuggestionsPopup');
    if (popup) popup.classList.add('hidden');

    this.syncContext();
    this.addRecentAction(text.slice(0, 25), 'custom-prompt');

    this.appendChatMessage('user', text);
    const msgId = this.appendTypingMessage();

    try {
      const response = await api.askAI(text, '', this.context);
      this.updateAIMessage(msgId, response);
    } catch (err) {
      this.updateAIMessage(msgId, {
        title: 'Query Failed',
        summary: err.message,
        code: null
      });
    }
  }

  // ── Chat Rendering & Code Action Bar ────────────────────────────────────
  appendChatMessage(role, text) {
    const box = document.getElementById('aiChatHistory');
    if (!box) return;

    const msg = document.createElement('div');
    msg.className = role === 'user'
      ? 'p-3 rounded-xl bg-purple-950/40 border border-purple-800/80 text-purple-200 text-xs ml-8 leading-relaxed'
      : 'p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-xs mr-4 leading-relaxed';

    msg.innerHTML = `
      <div class="flex items-center gap-1.5 mb-1 font-bold text-[10px] ${role === 'user' ? 'text-purple-400' : 'text-cyan-400'}">
        <span>${role === 'user' ? '👤 You' : '🤖 QARP AI'}</span>
        <span class="text-[9px] text-slate-500 font-mono">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div>${escapeHtml(text)}</div>
    `;

    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
  }

  appendTypingMessage() {
    const box = document.getElementById('aiChatHistory');
    if (!box) return null;

    const id = 'msg_' + Date.now();
    const msg = document.createElement('div');
    msg.id = id;
    msg.className = 'p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-xs mr-4 leading-relaxed';
    msg.innerHTML = `
      <div class="flex items-center gap-2 text-cyan-400 text-xs">
        <span class="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
        <span class="font-bold">Analyzing Playwright context & generating response...</span>
      </div>
    `;

    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
    return id;
  }

  updateAIMessage(id, response) {
    const el = document.getElementById(id);
    if (!el || !response) return;

    this.activeGeneratedCode = response.code || '';
    this.activeGeneratedFile = response.suggestedFileName || 'tests/generated.spec.js';

    let codeBlockHtml = '';
    if (response.code) {
      codeBlockHtml = `
        <div class="mt-3 rounded-xl border border-slate-800 bg-slate-950 overflow-hidden shadow-xl">
          <!-- Code Action Bar -->
          <div class="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800/80 flex-wrap gap-1">
            <span class="text-[10px] font-mono text-cyan-400 font-bold">JavaScript (Playwright)</span>
            <div class="flex items-center gap-1">
              <button type="button" class="px-2 py-0.5 rounded text-[10px] border border-slate-700 bg-slate-800 hover:text-cyan-300 text-slate-300 font-mono transition-all"
                      onclick="aiAssistant.copyActiveCode(this)" title="Copy Code">
                📋 Copy
              </button>
              <button type="button" class="px-2 py-0.5 rounded text-[10px] border border-purple-700 bg-purple-950/60 hover:bg-purple-900 text-purple-300 font-mono font-bold transition-all"
                      onclick="aiAssistant.runActiveCode()" title="Run in QARP">
                ▶ Run
              </button>
              <button type="button" class="px-2 py-0.5 rounded text-[10px] border border-emerald-800 bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 font-mono transition-all"
                      onclick="aiAssistant.saveActiveCode()" title="Save as Spec File">
                💾 Save
              </button>
              <button type="button" class="px-2 py-0.5 rounded text-[10px] border border-slate-700 bg-slate-800 hover:text-slate-200 text-slate-400 font-mono transition-all"
                      onclick="aiAssistant.explainActiveCode()" title="Explain Lines">
                🔍 Explain
              </button>
            </div>
          </div>
          <pre class="p-3 text-[11px] font-mono text-cyan-200 overflow-x-auto leading-relaxed max-h-72 select-text">${escapeHtml(response.code)}</pre>
        </div>
      `;
    }

    el.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-1.5 font-bold text-xs text-cyan-400">
          <span>🤖</span>
          <span>${escapeHtml(response.title || 'QARP AI Assistant')}</span>
        </div>
        <span class="text-[9px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 font-bold border border-purple-800">
          ${response.category || 'QA'}
        </span>
      </div>

      <div class="text-slate-300 leading-relaxed space-y-2">
        ${response.summary ? `<p class="font-medium text-slate-200">${escapeHtml(response.summary)}</p>` : ''}
        ${response.explanation ? `<div class="text-[11px] text-slate-400 leading-relaxed">${formatMarkdown(response.explanation)}</div>` : ''}
      </div>

      ${codeBlockHtml}
    `;

    const box = document.getElementById('aiChatHistory');
    if (box) box.scrollTop = box.scrollHeight;
  }

  // ── Code Actions ────────────────────────────────────────────────────────
  copyActiveCode(btn) {
    if (!this.activeGeneratedCode) return;
    navigator.clipboard.writeText(this.activeGeneratedCode).then(() => {
      if (btn) {
        btn.textContent = '✅ Copied!';
        setTimeout(() => btn.textContent = '📋 Copy', 1500);
      }
      if (typeof UI !== 'undefined' && UI.toast) UI.toast('Code copied to clipboard!', 'success');
    });
  }

  runActiveCode() {
    if (typeof UI !== 'undefined' && UI.toast) {
      UI.toast('Executing generated Playwright test suite...', 'info');
    }
    if (window.testRunner && typeof testRunner.startRun === 'function') {
      testRunner.startRun('npx playwright test --headed');
    }
  }

  async saveActiveCode() {
    if (!this.activeGeneratedCode) return;
    const fileName = prompt('Enter filename to save spec file:', this.activeGeneratedFile || 'tests/generated.spec.js');
    if (!fileName) return;

    try {
      const res = await api.saveTestFile(fileName, this.activeGeneratedCode, false);
      if (res.exists) {
        const overwrite = confirm(res.message);
        if (overwrite) {
          const res2 = await api.saveTestFile(fileName, this.activeGeneratedCode, true);
          if (res2.ok) {
            UI.toast(`Saved to ${res2.relativePath}`, 'success');
            if (window.testTree) testTree.init();
          }
        }
      } else if (res.ok) {
        UI.toast(`Successfully created ${res.relativePath}`, 'success');
        if (window.testTree) testTree.init();
      } else {
        UI.toast(`Failed to save: ${res.error}`, 'error');
      }
    } catch (err) {
      UI.toast(`Error: ${err.message}`, 'error');
    }
  }

  explainActiveCode() {
    this.executeSuggestion('explain-test', 'Explain the generated Playwright code in detail');
  }

  // ── Panel Display Controls ──────────────────────────────────────────────
  togglePanel(forceOpen = null) {
    this.isOpen = forceOpen !== null ? forceOpen : !this.isOpen;
    const panel = document.getElementById('aiAssistantPanel');
    if (!panel) return;

    if (this.isOpen) {
      panel.classList.remove('hidden');
      panel.classList.add('flex');
      this.syncContext();
      this.renderContextChips();
      this.renderSuggestions();
    } else {
      panel.classList.add('hidden');
      panel.classList.remove('flex');
    }
  }

  refreshUI() {
    this.syncContext();
    this.renderContextChips();
    this.renderSuggestions();
  }

  toggleExpand() {
    this.isExpanded = !this.isExpanded;
    const panel = document.getElementById('rightConsole') || document.getElementById('aiAssistantPanel');
    const expBtn = document.getElementById('btnAiExpand');
    if (!panel) return;

    if (this.isExpanded) {
      panel.style.width = '620px';
      if (expBtn) expBtn.textContent = '⛶ Contract';
    } else {
      panel.style.width = 'var(--console-w, 380px)';
      if (expBtn) expBtn.textContent = '⛶ Expand';
    }
  }

  clearChat() {
    const box = document.getElementById('aiChatHistory');
    if (box) {
      box.innerHTML = `
        <div class="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-300">
          <div class="flex items-center gap-1.5 font-bold text-cyan-400 text-xs mb-1">
            <span>🤖</span> <span>QARP AI Assistant</span>
          </div>
          <p class="leading-relaxed">
            Hello! I can help you create, debug, and optimize Playwright JavaScript tests.
            Choose a suggestion below or type any question.
          </p>
        </div>
      `;
    }
    if (typeof UI !== 'undefined' && UI.toast) UI.toast('Chat conversation cleared', 'info');
  }

  setupListeners() {
    const input = document.getElementById('aiChatInput');
    if (input) {
      input.addEventListener('input', (e) => this.onChatInput(e.target.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendUserPrompt();
        }
      });
    }

    // Close smart suggestions when clicking outside
    document.addEventListener('click', (e) => {
      const popup = document.getElementById('aiSmartSuggestionsPopup');
      const inputEl = document.getElementById('aiChatInput');
      if (popup && !popup.contains(e.target) && e.target !== inputEl) {
        popup.classList.add('hidden');
      }
    });
  }
}

// Helper Utilities
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-100">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[10px]">$1</code>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n- /g, '<br/>• ');
}

function pathBasename(str) {
  if (!str) return '';
  return str.split(/[\\\/]/).filter(Boolean).pop() || str;
}

// Global instance
const aiAssistant = new AIAssistantController();
window.aiAssistant = aiAssistant;
