/**
 * QARP-Runner Theme Controller
 * Supports Theme 1 (Default / Midnight Cyber) and Theme 2 (Blue).
 */

class ThemeManager {
  constructor() {
    this.root = document.documentElement;
    const stored = localStorage.getItem('app-theme') || localStorage.getItem('pw_theme') || 'default';
    this.activeTheme = (stored === 'blue' || stored === 'blue-erp') ? 'blue' : 'default';
    this.init();
  }

  init() {
    this.applyTheme(this.activeTheme);
    this.setupEventListeners();
  }

  applyTheme(themeKey) {
    if (themeKey === 'blue-erp') themeKey = 'blue';
    if (themeKey !== 'default' && themeKey !== 'blue') {
      themeKey = 'default';
    }
    this.activeTheme = themeKey;
    this.root.setAttribute('data-theme', themeKey);
    localStorage.setItem('app-theme', themeKey);
    localStorage.setItem('pw_theme', themeKey);

    const isBlue = themeKey === 'blue';
    const icoEl = document.getElementById('themeIco');
    const lblEl = document.getElementById('themeLbl');
    const dotEl = document.getElementById('themeDot');

    if (icoEl) icoEl.textContent = isBlue ? '🔷' : '🌙';
    if (lblEl) lblEl.textContent = isBlue ? 'BLUE' : 'DEFAULT';
    if (dotEl) dotEl.className = isBlue ? 'w-2 h-2 rounded-full bg-blue-500' : 'w-2 h-2 rounded-full bg-violet-500';

    // Highlight active option in menu
    document.querySelectorAll('.theme-opt').forEach(opt => {
      const optKey = opt.dataset.theme === 'blue-erp' ? 'blue' : opt.dataset.theme;
      const active = optKey === themeKey;
      opt.classList.toggle('active', active);
      const checkEl = opt.querySelector('.theme-check');
      if (checkEl) {
        checkEl.textContent = active ? '✓' : '';
      }
    });
  }

  changeTheme(themeKey) {
    this.applyTheme(themeKey);
  }

  toggleThemeMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('themeMenu');
    if (menu) {
      menu.classList.toggle('hidden');
    } else {
      // In sub-pages without dropdown, toggle directly between Default and Blue
      this.applyTheme(this.activeTheme === 'default' ? 'blue' : 'default');
    }
  }

  setupEventListeners() {
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('themeMenu');
      const btn = document.getElementById('themeBtn');
      if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !btn?.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });
  }
}

// Global changeTheme function
function changeTheme(theme) {
  if (window.theme && typeof window.theme.applyTheme === 'function') {
    window.theme.applyTheme(theme);
  } else {
    const key = (theme === 'blue' || theme === 'blue-erp') ? 'blue' : 'default';
    document.documentElement.setAttribute('data-theme', key);
    localStorage.setItem('app-theme', key);
  }
}

// Instant theme bootstrap to avoid unstyled flash
(function () {
  const saved = localStorage.getItem('app-theme') || localStorage.getItem('pw_theme') || 'default';
  const active = (saved === 'blue' || saved === 'blue-erp') ? 'blue' : 'default';
  document.documentElement.setAttribute('data-theme', active);
})();

// Global instances
const theme = new ThemeManager();
window.theme = theme;
window.changeTheme = changeTheme;
