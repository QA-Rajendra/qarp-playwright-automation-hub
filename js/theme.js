/**
 * Animated Theme & Customization Engine
 * Handles 9 themes, typography modes (bold, italic), and custom folder/spec colors.
 */
class ThemeManager {
  constructor() {
    this.root = document.documentElement;
    this.activeTheme = localStorage.getItem('pw_theme') || 'dark';
    this.isBold = localStorage.getItem('pw_bold') === 'true';
    this.isItalic = localStorage.getItem('pw_italic') === 'true';
    this.folderColor = localStorage.getItem('pw_folder_color') || '#38bdf8';
    this.fileColor = localStorage.getItem('pw_file_color') || '#34d399';

    this.init();
  }

  init() {
    this.applyTheme(this.activeTheme);
    this.applyTypography();
    this.applyCustomColors();
    this.setupEventListeners();
  }

  applyTheme(themeKey) {
    if (!APP_CONFIG.themes[themeKey]) themeKey = 'dark';
    this.activeTheme = themeKey;
    this.root.setAttribute('data-theme', themeKey);
    localStorage.setItem('pw_theme', themeKey);

    const meta = APP_CONFIG.themes[themeKey];
    const icoEl = document.getElementById('themeIco');
    const lblEl = document.getElementById('themeLbl');
    if (icoEl) icoEl.textContent = meta.ico;
    if (lblEl) lblEl.textContent = meta.name;

    // Highlight active option in menu
    document.querySelectorAll('.theme-opt').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.theme === themeKey);
    });
  }

  applyTypography() {
    if (this.isBold) this.root.setAttribute('data-bold', 'true');
    else this.root.removeAttribute('data-bold');

    if (this.isItalic) this.root.setAttribute('data-italic', 'true');
    else this.root.removeAttribute('data-italic');

    const boldBtn = document.getElementById('boldBtn');
    const italicBtn = document.getElementById('italicBtn');
    if (boldBtn) boldBtn.classList.toggle('active', this.isBold);
    if (italicBtn) italicBtn.classList.toggle('active', this.isItalic);

    localStorage.setItem('pw_bold', this.isBold);
    localStorage.setItem('pw_italic', this.isItalic);
  }

  toggleBold(e) {
    if (e) e.stopPropagation();
    this.isBold = !this.isBold;
    this.applyTypography();
  }

  toggleItalic(e) {
    if (e) e.stopPropagation();
    this.isItalic = !this.isItalic;
    this.applyTypography();
  }

  setFolderColor(col) {
    this.folderColor = col;
    this.root.style.setProperty('--folder-color', col);
    this.root.style.setProperty('--folder-sub-color', col);
    localStorage.setItem('pw_folder_color', col);

    const picker = document.getElementById('folderColorPicker');
    if (picker) picker.value = col;
  }

  setFileColor(col) {
    this.fileColor = col;
    this.root.style.setProperty('--file-color', col);
    this.root.style.setProperty('--file-hover-color', col);
    localStorage.setItem('pw_file_color', col);

    const picker = document.getElementById('fileColorPicker');
    if (picker) picker.value = col;
  }

  resetColors() {
    localStorage.removeItem('pw_folder_color');
    localStorage.removeItem('pw_file_color');
    this.root.style.removeProperty('--folder-color');
    this.root.style.removeProperty('--folder-sub-color');
    this.root.style.removeProperty('--file-color');
    this.root.style.removeProperty('--file-hover-color');

    const fp = document.getElementById('folderColorPicker');
    if (fp) fp.value = '#38bdf8';
    const flp = document.getElementById('fileColorPicker');
    if (flp) flp.value = '#34d399';
  }

  applyCustomColors() {
    if (localStorage.getItem('pw_folder_color')) {
      this.setFolderColor(this.folderColor);
    }
    if (localStorage.getItem('pw_file_color')) {
      this.setFileColor(this.fileColor);
    }
  }

  toggleThemeMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('themeMenu');
    if (menu) menu.classList.toggle('hidden');
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

// Global Theme instance
const theme = new ThemeManager();
