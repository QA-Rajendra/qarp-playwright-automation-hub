/**
 * Test Explorer Tree Component
 * Recursively renders folder & spec tree, handles search filters, expand/collapse, and file selection.
 */
class TestTree {
  constructor() {
    this.container = document.getElementById('tree');
    this.structure = null;
    this.selectedPath = null;
    this.selectedName = null;
  }

  async init() {
    if (!this.container) return;
    this.container.innerHTML = '<div class="p-4 text-xs text-slate-500 animate-pulse text-center">Loading test tree…</div>';
    this.structure = await api.getStructure();
    this.render();
    this.setupSearch();
  }

  render() {
    if (!this.structure || !this.structure.tree || this.structure.tree.length === 0) {
      this.container.innerHTML = '<div class="p-4 text-xs text-slate-500 text-center">No test folders found in tests/ or e2e/</div>';
      return;
    }

    const html = this.structure.tree.map((node, i) => this.renderFolderNode(node, 0, i)).join('');
    this.container.innerHTML = html;
  }

  renderFolderNode(node, depth = 0, index = 0) {
    const folderIcos = ['🗂', '🔐', '📋', '👤', '🔌', '🧪', '⚙', '🔎', '🚀', '🌐'];
    const ico = folderIcos[index % folderIcos.length];
    const displayName = depth === 0 ? node.path : node.name;

    const subfoldersHTML = (node.folders || []).map((sub, i) => this.renderFolderNode(sub, depth + 1, i)).join('');
    const filesHTML = (node.files || []).map(f => `
      <div class="file flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer border border-transparent hover:bg-slate-800/60 transition-all text-slate-300 text-xs my-0.5 group"
           data-path="${f.path}" data-name="${f.name}" onclick="testTree.selectFile(this)">
        <svg class="file-ico w-3.5 h-3.5 flex-shrink-0 transition-transform group-hover:scale-110" style="color:var(--file-color)" viewBox="0 0 16 16" fill="none">
          <path d="M3 2h7l3 3v9H3V2z" stroke="currentColor" stroke-width="1.4" fill="none"/>
          <path d="M10 2v3h3" stroke="currentColor" stroke-width="1.4"/>
        </svg>
        <span class="fname truncate flex-1 font-medium transition-colors" style="color:var(--file-color)">${f.name}</span>
      </div>`).join('');

    const content = (subfoldersHTML + filesHTML) || '<div class="text-[10px] text-slate-500 px-3 py-1">No spec files</div>';

    return `
      <div class="fb mb-1" data-depth="${depth}" data-folder-path="${node.path}">
        <div class="fr flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer border border-transparent hover:bg-slate-800/50 transition-all select-none group"
             onclick="testTree.toggleFolder(this)" title="${node.path}">
          <span class="arr text-[8px] text-slate-500 w-2.5 transition-transform duration-200 group-hover:text-purple-400">▶</span>
          <span class="ftico text-xs flex-shrink-0">${ico}</span>
          <span class="ftname text-xs font-semibold truncate flex-1" style="color:var(--folder-color)">${displayName}</span>
          <span class="fcnt text-[9px] text-slate-500 flex-shrink-0 mr-1">${node.totalFiles}f</span>
          <button type="button" class="run-all text-[9px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800/80 hover:border-violet-500 hover:text-purple-300 hover:bg-violet-950/40 text-slate-400 font-mono transition-all flex-shrink-0"
                  onclick="event.stopPropagation(); testTree.runFolder('${node.path}', '${displayName}')"
                  title="Run all tests in ${node.path}">Run all</button>
        </div>
        <div class="fl hidden ml-2.5 pl-2.5 border-l border-slate-800/80 mt-0.5">
          ${content}
        </div>
      </div>`;
  }

  toggleFolder(el) {
    const fl = el.nextElementSibling;
    const arr = el.querySelector('.arr');
    if (fl && fl.classList.contains('fl')) {
      const isOpen = !fl.classList.contains('hidden');
      if (isOpen) {
        fl.classList.add('hidden');
        if (arr) arr.style.transform = '';
        el.classList.remove('bg-violet-950/20', 'border-violet-800/40');
      } else {
        fl.classList.remove('hidden');
        if (arr) arr.style.transform = 'rotate(90deg)';
        el.classList.add('bg-violet-950/20', 'border-violet-800/40');
      }
    }
  }

  expandAll() {
    document.querySelectorAll('.fr').forEach(fr => {
      const fl = fr.nextElementSibling;
      const arr = fr.querySelector('.arr');
      if (fl && fl.classList.contains('fl')) {
        fl.classList.remove('hidden');
        if (arr) arr.style.transform = 'rotate(90deg)';
      }
    });
  }

  collapseAll() {
    document.querySelectorAll('.fr').forEach(fr => {
      const fl = fr.nextElementSibling;
      const arr = fr.querySelector('.arr');
      if (fl && fl.classList.contains('fl')) {
        fl.classList.add('hidden');
        if (arr) arr.style.transform = '';
        fr.classList.remove('bg-violet-950/20', 'border-violet-800/40');
      }
    });
  }

  selectFile(el) {
    document.querySelectorAll('.file').forEach(x => {
      x.classList.remove('bg-violet-950/40', 'border-violet-500/80', 'ring-1', 'ring-violet-500/50');
    });
    el.classList.add('bg-violet-950/40', 'border-violet-500/80', 'ring-1', 'ring-violet-500/50');

    this.selectedPath = el.dataset.path;
    this.selectedName = el.dataset.name;

    const badge = document.getElementById('selBadge');
    const selText = document.getElementById('selText');
    const breadPath = document.getElementById('breadPath');

    if (badge) badge.classList.remove('opacity-60');
    if (selText) selText.textContent = this.selectedName;
    if (breadPath) breadPath.textContent = this.selectedPath;

    if (window.testRunner) {
      window.testRunner.setTarget(this.selectedPath, false);
    }
  }

  clearSelection() {
    this.selectedPath = null;
    this.selectedName = null;

    document.querySelectorAll('.file').forEach(x => {
      x.classList.remove('bg-violet-950/40', 'border-violet-500/80', 'ring-1', 'ring-violet-500/50');
    });

    const badge = document.getElementById('selBadge');
    const selText = document.getElementById('selText');
    const breadPath = document.getElementById('breadPath');

    if (badge) badge.classList.add('opacity-60');
    if (selText) selText.textContent = 'None selected';
    if (breadPath) breadPath.textContent = 'Select a test file';

    if (window.testRunner) {
      window.testRunner.setTarget(null, false);
    }
  }

  runFolder(folderPath, folderName) {
    this.selectedPath = folderPath;
    this.selectedName = `${folderName} (all)`;

    const badge = document.getElementById('selBadge');
    const selText = document.getElementById('selText');
    const breadPath = document.getElementById('breadPath');

    if (badge) badge.classList.remove('opacity-60');
    if (selText) selText.textContent = this.selectedName;
    if (breadPath) breadPath.textContent = this.selectedPath;

    if (window.testRunner) {
      window.testRunner.setTarget(folderPath, true);
      window.testRunner.run();
    }
  }

  setupSearch() {
    const searchInput = document.getElementById('searchBox');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (q === '') {
        document.querySelectorAll('.file').forEach(f => f.classList.remove('hidden'));
        document.querySelectorAll('.fb').forEach(fb => {
          fb.classList.remove('hidden');
          const depth = parseInt(fb.dataset.depth || '0');
          const fl = fb.querySelector(':scope > .fl');
          const arr = fb.querySelector(':scope > .fr .arr');
          if (depth === 0 && fl) {
            fl.classList.remove('hidden');
            if (arr) arr.style.transform = 'rotate(90deg)';
          } else if (fl) {
            fl.classList.add('hidden');
            if (arr) arr.style.transform = '';
          }
        });
        const empty = document.getElementById('noMatchMsg');
        if (empty) empty.remove();
        return;
      }

      const allFiles = Array.from(document.querySelectorAll('.file'));
      const matchingFiles = new Set();

      allFiles.forEach(fileEl => {
        const name = (fileEl.dataset.name || '').toLowerCase();
        const path = (fileEl.dataset.path || '').toLowerCase();
        const matches = name.includes(q) || path.includes(q);
        fileEl.classList.toggle('hidden', !matches);
        if (matches) matchingFiles.add(fileEl);
      });

      const allFolders = Array.from(document.querySelectorAll('.fb'))
        .sort((a, b) => parseInt(b.dataset.depth || '0') - parseInt(a.dataset.depth || '0'));

      let anyMatch = false;
      allFolders.forEach(folderBlock => {
        const fr = folderBlock.querySelector(':scope > .fr');
        const fl = folderBlock.querySelector(':scope > .fl');
        const arr = fr?.querySelector('.arr');
        const name = (fr?.querySelector('.ftname')?.textContent || '').toLowerCase();
        const path = (folderBlock.dataset.folderPath || '').toLowerCase();

        const nameMatch = name.includes(q) || path.includes(q);
        const hasVisibleFiles = Array.from(folderBlock.querySelectorAll(':scope > .fl > .file')).some(f => matchingFiles.has(f));
        const hasVisibleSubfolders = Array.from(folderBlock.querySelectorAll(':scope > .fl > .fb')).some(fb => !fb.classList.contains('hidden'));

        if (nameMatch || hasVisibleFiles || hasVisibleSubfolders) {
          folderBlock.classList.remove('hidden');
          if (fl) fl.classList.remove('hidden');
          if (arr) arr.style.transform = 'rotate(90deg)';
          anyMatch = true;
        } else {
          folderBlock.classList.add('hidden');
        }
      });

      let empty = document.getElementById('noMatchMsg');
      if (!anyMatch) {
        if (!empty) {
          empty = document.createElement('div');
          empty.id = 'noMatchMsg';
          empty.className = 'p-4 text-xs text-slate-500 text-center font-mono';
          empty.textContent = `No test files match "${q}"`;
          this.container.appendChild(empty);
        }
      } else if (empty) {
        empty.remove();
      }
    });
  }
}

// Global Tree instance
const testTree = new TestTree();
