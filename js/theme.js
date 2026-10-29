/**
 * QARP-Tool Theme Controller
 * Supports Theme 1 (Default / Midnight Cyber) and Theme 2 (Sage Slate).
 */

class ThemeManager {
  constructor() {
    this.root = document.documentElement;
    const stored = localStorage.getItem('app-theme') || localStorage.getItem('pw_theme') || 'sage';
    this.activeTheme = (stored === 'sage' || stored === 'green-slate' || stored === 'blue' || stored === 'blue-erp')
      ? 'sage'
      : 'default';
    this.init();
  }

  init() {
    this.applyTheme(this.activeTheme);
    this.setupEventListeners();
  }

  applyTheme(themeKey) {
    if (['blue', 'blue-erp', 'green-slate'].includes(themeKey)) themeKey = 'sage';
    if (themeKey !== 'default' && themeKey !== 'sage') {
      themeKey = 'default';
    }
    this.activeTheme = themeKey;
    this.root.setAttribute('data-theme', themeKey);
    localStorage.setItem('app-theme', themeKey);
    localStorage.setItem('pw_theme', themeKey);

    const isSage = themeKey === 'sage';
    const icoEl = document.getElementById('themeIco');
    const lblEl = document.getElementById('themeLbl');
    const dotEl = document.getElementById('themeDot');

    if (icoEl) icoEl.textContent = isSage ? '🌿' : '🌙';
    if (lblEl) lblEl.textContent = isSage ? 'SAGE' : 'DEFAULT';
    if (dotEl) dotEl.className = isSage ? 'w-2 h-2 rounded-full bg-lime-200' : 'w-2 h-2 rounded-full bg-violet-500';

    // Highlight active option in menu
    document.querySelectorAll('.theme-opt').forEach(opt => {
      const optKey = opt.dataset.theme;
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
      // In sub-pages without a picker, toggle between the two available palettes.
      this.applyTheme(this.activeTheme === 'default' ? 'sage' : 'default');
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
    const key = ['sage', 'green-slate', 'blue', 'blue-erp'].includes(theme) ? 'sage' : 'default';
    document.documentElement.setAttribute('data-theme', key);
    localStorage.setItem('app-theme', key);
  }
}

// Instant theme bootstrap to avoid unstyled flash
(function () {
  let saved = localStorage.getItem('app-theme') || localStorage.getItem('pw_theme');
  if (localStorage.getItem('sage-default-migrated') !== 'true') {
    if (saved === 'default') {
      saved = 'sage';
      localStorage.setItem('app-theme', saved);
      localStorage.setItem('pw_theme', saved);
    }
    localStorage.setItem('sage-default-migrated', 'true');
  }
  saved = saved || 'sage';
  const active = ['sage', 'green-slate', 'blue', 'blue-erp'].includes(saved) ? 'sage' : 'default';
  document.documentElement.setAttribute('data-theme', active);
})();

// Global instances
const theme = new ThemeManager();
window.theme = theme;
window.changeTheme = changeTheme;
