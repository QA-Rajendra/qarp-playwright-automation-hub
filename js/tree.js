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
    this.searchScope = 'all';
  }

  async init() {
    if (!this.container) return;
    this.container.innerHTML = '<div class="p-4 text-xs text-slate-500 animate-pulse text-center">Loading test tree…</div>';
    this.structure = await api.getStructure();

    // Update project badge in header & sidebar if available
    if (this.structure && this.structure.projectName) {
      const projBadge = document.getElementById('projectBadge');
      if (projBadge) {
        projBadge.textContent = `📁 ${this.structure.projectName}`;
        projBadge.classList.remove('hidden');
        projBadge.title = `Project directory: ${this.structure.projectRoot || this.structure.projectName}`;
      }
      const treeProj = document.getElementById('treeProjectName');
      if (treeProj) {
        treeProj.textContent = `· ${this.structure.projectName}`;
        treeProj.title = this.structure.projectRoot || this.structure.projectName;
      }
    }

    this.render();
    this.setupSearch();
  }

  render() {
    if (!this.structure || !this.structure.tree || this.structure.tree.length === 0) {
      this.container.innerHTML = '<div class="p-4 text-xs text-slate-500 text-center">No test folders found in tests/, e2e/, or test/</div>';
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
        <div class="fr flex items-center gap-1.5 px-2 py-1.5 rounded border border-transparent hover:bg-slate-800/50 transition-all select-none group"
             title="${node.path}">
          <!-- Arrow: only toggles expand/collapse -->
          <span class="arr text-[8px] text-slate-500 w-2.5 flex-shrink-0 transition-transform duration-200 group-hover:text-purple-400 cursor-pointer hover:text-purple-300"
                onclick="testTree.toggleFolder(this.closest('.fr'))">▶</span>
          <!-- Folder name/icon area: selects folder as target AND toggles -->
          <span class="ftico text-xs flex-shrink-0 cursor-pointer" onclick="testTree.selectFolder(this.closest('.fr'), '${node.path}', '${displayName}')">${ico}</span>
          <span class="ftname text-xs font-semibold truncate flex-1 cursor-pointer" style="color:var(--folder-color)"
                onclick="testTree.selectFolder(this.closest('.fr'), '${node.path}', '${displayName}')">${displayName}</span>
          <span class="fcnt text-[9px] text-slate-500 flex-shrink-0 mr-1">${node.totalFiles}f</span>
          <button type="button" class="run-all text-[9px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800/80 hover:border-violet-500 hover:text-purple-300 hover:bg-violet-950/40 text-slate-400 font-mono transition-all flex-shrink-0"
                  onclick="testTree.runFolder('${node.path}', '${displayName}')"
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

  selectFolder(frEl, folderPath, folderName) {
    // Deselect all file items
    document.querySelectorAll('.file').forEach(x => {
      x.classList.remove('bg-violet-950/40', 'border-violet-500/80', 'ring-1', 'ring-violet-500/50');
    });

    // Deselect all folder rows
    document.querySelectorAll('.fr').forEach(x => {
      x.classList.remove('bg-violet-950/40', 'border-violet-500/80', 'ring-1', 'ring-violet-500/50');
    });

    // Highlight selected folder row
    if (frEl) {
      frEl.classList.add('bg-violet-950/40', 'border-violet-500/80', 'ring-1', 'ring-violet-500/50');

      // Also expand folder when selected
      const fl = frEl.nextElementSibling;
      const arr = frEl.querySelector('.arr');
      if (fl && fl.classList.contains('fl') && fl.classList.contains('hidden')) {
        fl.classList.remove('hidden');
        if (arr) arr.style.transform = 'rotate(90deg)';
        frEl.classList.add('bg-violet-950/20', 'border-violet-800/40');
      }
    }

    this.selectedPath = folderPath;
    this.selectedName = `📁 ${folderName}`;

    const badge = document.getElementById('selBadge');
    const selText = document.getElementById('selText');
    const breadPath = document.getElementById('breadPath');

    if (badge) badge.classList.remove('opacity-60');
    if (selText) selText.textContent = this.selectedName;
    if (breadPath) breadPath.textContent = folderPath;

    if (window.testRunner) {
      window.testRunner.setTarget(folderPath, true);
    }
    if (window.aiAssistant) {
      window.aiAssistant.onContextChanged({
        selectedTest: folderPath,
        selectedFile: folderName
      });
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
    if (window.aiAssistant) {
      window.aiAssistant.onContextChanged({
        selectedTest: this.selectedPath,
        selectedFile: this.selectedName
      });
    }
  }

  clearSelection() {
    this.selectedPath = null;
    this.selectedName = null;

    document.querySelectorAll('.file').forEach(x => {
      x.classList.remove('bg-violet-950/40', 'border-violet-500/80', 'ring-1', 'ring-violet-500/50');
    });

    document.querySelectorAll('.fr').forEach(x => {
      x.classList.remove('bg-violet-950/40', 'border-violet-500/80', 'ring-1', 'ring-violet-500/50');
    });

    const badge = document.getElementById('selBadge');
    const selText = document.getElementById('selText');
    const breadPath = document.getElementById('breadPath');

    if (badge) badge.classList.add('opacity-60');
    if (selText) selText.textContent = 'None';
    if (breadPath) breadPath.textContent = 'None';

    if (window.testRunner) {
      window.testRunner.setTarget(null, false);
    }
    if (window.aiAssistant) {
      window.aiAssistant.onContextChanged({
        selectedTest: null,
        selectedFile: null
      });
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

    const clearButton = document.getElementById('clearSearchButton');
    const scopeButtons = Array.from(document.querySelectorAll('.search-scope'));

    searchInput.addEventListener('input', () => this.applySearch());
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && (searchInput.value || this.searchScope !== 'all')) {
        event.preventDefault();
        this.clearSearch();
      }
    });
    if (clearButton) clearButton.addEventListener('click', () => this.clearSearch());
    scopeButtons.forEach(button => {
      button.addEventListener('click', () => {
        this.searchScope = button.dataset.searchScope || 'all';
        scopeButtons.forEach(option => {
          const selected = option === button;
          option.setAttribute('aria-pressed', String(selected));
          option.classList.toggle('border-violet-500', selected);
          option.classList.toggle('bg-violet-950/50', selected);
          option.classList.toggle('text-purple-200', selected);
          option.classList.toggle('font-semibold', selected);
          option.classList.toggle('border-slate-700', !selected);
          option.classList.toggle('text-slate-400', !selected);
        });
        this.applySearch();
      });
    });
  }

  clearSearch() {
    const searchInput = document.getElementById('searchBox');
    const allScope = document.querySelector('.search-scope[data-search-scope="all"]');
    if (searchInput) searchInput.value = '';
    this.searchScope = 'all';
    if (allScope) allScope.click();
    else this.applySearch();
    if (searchInput) searchInput.focus();
  }

  applySearch() {
    if (!this.container) return;

    const searchInput = document.getElementById('searchBox');
    const clearButton = document.getElementById('clearSearchButton');
    const status = document.getElementById('searchStatus');
    const query = (searchInput?.value || '').trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const filtering = terms.length > 0 || this.searchScope !== 'all';
    let fileCount = 0;
    let folderCount = 0;

    if (clearButton) clearButton.classList.toggle('hidden', !filtering);

    this.container.querySelectorAll('.file').forEach(file => {
      const searchable = `${file.dataset.name || ''} ${file.dataset.path || ''}`.toLowerCase();
      const matches = this.searchScope !== 'folders' && terms.every(term => searchable.includes(term));
      file.classList.toggle('hidden', !matches);
      if (matches) fileCount++;
    });

    const folders = Array.from(this.container.querySelectorAll('.fb'))
      .sort((a, b) => Number(b.dataset.depth || 0) - Number(a.dataset.depth || 0));

    folders.forEach(folder => {
      const row = folder.querySelector(':scope > .fr');
      const contents = folder.querySelector(':scope > .fl');
      const arrow = row?.querySelector('.arr');
      const searchable = `${row?.querySelector('.ftname')?.textContent || ''} ${folder.dataset.folderPath || ''}`.toLowerCase();
      const matches = this.searchScope !== 'files' && terms.every(term => searchable.includes(term));
      const hasVisibleFiles = Array.from(folder.querySelectorAll(':scope > .fl > .file'))
        .some(file => !file.classList.contains('hidden'));
      const hasVisibleSubfolders = Array.from(folder.querySelectorAll(':scope > .fl > .fb'))
        .some(child => child.dataset.searchVisible === 'true');
      const visible = matches || hasVisibleFiles || hasVisibleSubfolders;

      folder.dataset.searchVisible = String(visible);
      folder.classList.toggle('hidden', !visible);
      if (visible && filtering) {
        if (contents) contents.classList.remove('hidden');
        if (arrow) arrow.style.transform = 'rotate(90deg)';
      } else if (!filtering && contents) {
        const isRoot = Number(folder.dataset.depth || 0) === 0;
        contents.classList.toggle('hidden', !isRoot);
        if (arrow) arrow.style.transform = isRoot ? 'rotate(90deg)' : '';
      }
      if (matches) folderCount++;
    });

    const empty = document.getElementById('noMatchMsg');
    const hasResults = fileCount > 0 || folderCount > 0;
    if (filtering && !hasResults) {
      const message = document.createElement('div');
      message.id = 'noMatchMsg';
      message.className = 'p-4 text-xs text-slate-500 text-center font-mono';
      message.textContent = query ? `No tests or folders match "${searchInput.value.trim()}"` : 'No matching tests or folders';
      if (!empty) this.container.appendChild(message);
      else empty.textContent = message.textContent;
    } else if (empty) {
      empty.remove();
    }

    if (status) {
      status.textContent = filtering
        ? `${fileCount} ${fileCount === 1 ? 'file' : 'files'} · ${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}`
        : 'Search file names and folder paths';
    }
  }
}

// Global Tree instance
const testTree = new TestTree();
window.testTree = testTree;
