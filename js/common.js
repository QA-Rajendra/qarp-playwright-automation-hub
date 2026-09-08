/**
 * Common Utilities: Toasts, Modals, Resizable Panels & Keybindings
 */
const UI = {
  /**
   * Display modern toast notification
   */
  toast(message, type = 'info', duration = 3000) {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const colors = {
      success: 'bg-emerald-950/90 border-emerald-500 text-emerald-200',
      error: 'bg-rose-950/90 border-rose-500 text-rose-200',
      warn: 'bg-amber-950/90 border-amber-500 text-amber-200',
      info: 'bg-slate-900/90 border-violet-500 text-slate-200'
    };

    const icons = {
      success: '✓',
      error: '✕',
      warn: '⚠',
      info: 'ℹ'
    };

    toast.className = `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border shadow-xl backdrop-blur-md text-xs font-mono transition-all transform duration-300 translate-y-3 opacity-0 ${colors[type] || colors.info}`;
    toast.innerHTML = `
      <span class="font-bold text-sm">${icons[type] || 'ℹ'}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    // Animate entry
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-3', 'opacity-0');
    });

    // Animate exit
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /**
   * Copy text to clipboard
   */
  async copyToClipboard(text, btnElement = null) {
    try {
      await navigator.clipboard.writeText(text);
      if (btnElement) {
        const origText = btnElement.textContent;
        btnElement.textContent = 'copied!';
        btnElement.classList.add('text-emerald-400', 'border-emerald-500');
        setTimeout(() => {
          btnElement.textContent = origText;
          btnElement.classList.remove('text-emerald-400', 'border-emerald-500');
        }, 2000);
      }
      this.toast('Command copied to clipboard', 'success', 2000);
    } catch (_) {
      this.toast('Failed to copy to clipboard', 'error');
    }
  },

  /**
   * Modal Management
   */
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  },

  /**
   * Setup Draggable Resizers for Left Sidebar & Right Live Console
   */
  initResizablePanels() {
    const rootEl = document.documentElement;
    const savedSidebarW = localStorage.getItem('pw_sidebar_w') || '280px';
    const savedConsoleW = localStorage.getItem('pw_console_w') || '360px';
    const sidebarCollapsed = localStorage.getItem('pw_sidebar_collapsed') === 'true';
    const consoleCollapsed = localStorage.getItem('pw_console_collapsed') === 'true';

    rootEl.style.setProperty('--sidebar-w', savedSidebarW);
    rootEl.style.setProperty('--console-w', savedConsoleW);

    const sidebar = document.getElementById('leftSidebar');
    const consoleRail = document.getElementById('rightConsole');
    const resizerLeft = document.getElementById('resizerLeft');
    const resizerRight = document.getElementById('resizerRight');
    const btnToggleLeft = document.getElementById('btnToggleLeft');
    const btnToggleRight = document.getElementById('btnToggleRight');

    if (sidebar && sidebarCollapsed) {
      sidebar.classList.add('hidden');
      if (resizerLeft) resizerLeft.classList.add('hidden');
      if (btnToggleLeft) btnToggleLeft.innerHTML = '▶ Sidebar';
    }
    if (consoleRail && consoleCollapsed) {
      consoleRail.classList.add('hidden');
      if (resizerRight) resizerRight.classList.add('hidden');
      if (btnToggleRight) btnToggleRight.innerHTML = '◀ Live Console';
    }

    // Left Resizer Drag (Sidebar width)
    if (resizerLeft && sidebar) {
      let startX, startW;
      const onMouseDownLeft = (e) => {
        startX = e.clientX;
        startW = sidebar.getBoundingClientRect().width;
        resizerLeft.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMouseMoveLeft);
        window.addEventListener('mouseup', onMouseUpLeft);
      };
      const onMouseMoveLeft = (e) => {
        const newW = Math.max(240, Math.min(650, startW + (e.clientX - startX)));
        rootEl.style.setProperty('--sidebar-w', newW + 'px');
        localStorage.setItem('pw_sidebar_w', newW + 'px');
      };
      const onMouseUpLeft = () => {
        resizerLeft.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMoveLeft);
        window.removeEventListener('mouseup', onMouseUpLeft);
      };
      resizerLeft.addEventListener('mousedown', onMouseDownLeft);
      resizerLeft.addEventListener('dblclick', () => {
        rootEl.style.setProperty('--sidebar-w', '280px');
        localStorage.setItem('pw_sidebar_w', '280px');
      });
    }

    // Right Resizer Drag (Console width)
    if (resizerRight && consoleRail) {
      let startX, startW;
      const onMouseDownRight = (e) => {
        startX = e.clientX;
        startW = consoleRail.getBoundingClientRect().width;
        resizerRight.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMouseMoveRight);
        window.addEventListener('mouseup', onMouseUpRight);
      };
      const onMouseMoveRight = (e) => {
        const newW = Math.max(260, Math.min(850, startW - (e.clientX - startX)));
        rootEl.style.setProperty('--console-w', newW + 'px');
        localStorage.setItem('pw_console_w', newW + 'px');
      };
      const onMouseUpRight = () => {
        resizerRight.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMoveRight);
        window.removeEventListener('mouseup', onMouseUpRight);
      };
      resizerRight.addEventListener('mousedown', onMouseDownRight);
      resizerRight.addEventListener('dblclick', () => {
        rootEl.style.setProperty('--console-w', '360px');
        localStorage.setItem('pw_console_w', '360px');
      });
    }
  },

  toggleLeftSidebar() {
    const sidebar = document.getElementById('leftSidebar');
    const resizerLeft = document.getElementById('resizerLeft');
    const btn = document.getElementById('btnToggleLeft');
    if (!sidebar) return;
    const isHidden = sidebar.classList.toggle('hidden');
    if (resizerLeft) resizerLeft.classList.toggle('hidden', isHidden);
    if (btn) btn.innerHTML = isHidden ? '▶ Sidebar' : '◀ Sidebar';
    localStorage.setItem('pw_sidebar_collapsed', isHidden);
  },

  toggleRightConsole() {
    const consoleRail = document.getElementById('rightConsole');
    const resizerRight = document.getElementById('resizerRight');
    const btn = document.getElementById('btnToggleRight');
    if (!consoleRail) return;
    const isHidden = consoleRail.classList.toggle('hidden');
    if (resizerRight) resizerRight.classList.toggle('hidden', isHidden);
    if (btn) btn.innerHTML = isHidden ? '◀ Live Console' : 'Live Console ▶';
    localStorage.setItem('pw_console_collapsed', isHidden);
  },

  /**
   * Setup Keyboard Shortcuts
   */
  initShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Toggle sidebar: Ctrl + B or Cmd + B
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        this.toggleLeftSidebar();
      }
      // Toggle console: Ctrl + J or Cmd + J
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'j' || e.code === 'Backquote')) {
        e.preventDefault();
        this.toggleRightConsole();
      }
      // Quick search focus: "/" when not in input
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        const sb = document.getElementById('searchBox');
        if (sb) sb.focus();
      }
    });
  }
};
