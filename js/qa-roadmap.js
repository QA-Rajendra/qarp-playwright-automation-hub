'use strict';

(() => {
  const elements = {
    title: document.getElementById('roadmapTitle'),
    levels: document.getElementById('roadmapLevels'),
    status: document.getElementById('statusMessage'),
    search: document.getElementById('searchInput'),
    filter: document.getElementById('statusFilter'),
    save: document.getElementById('saveButton'),
    discard: document.getElementById('discardButton'),
    reload: document.getElementById('reloadButton'),
    export: document.getElementById('exportButton'),
    dialog: document.getElementById('itemDialog'),
    form: document.getElementById('itemForm'),
    dialogTitle: document.getElementById('dialogTitle'),
    id: document.getElementById('itemId'),
    level: document.getElementById('itemLevel'),
    itemTitle: document.getElementById('itemTitle'),
    description: document.getElementById('itemDescription'),
    itemStatus: document.getElementById('itemStatus'),
    owner: document.getElementById('itemOwner'),
    targetDate: document.getElementById('itemTargetDate')
  };

  let savedRoadmap = null;
  let roadmap = null;
  let dirty = false;
  let statusTimer;

  const statusLabels = {
    'not-started': 'Not started',
    'in-progress': 'In progress',
    blocked: 'Blocked',
    complete: 'Complete'
  };

  function setStatus(message, kind = 'info') {
    clearTimeout(statusTimer);
    elements.status.textContent = message;
    elements.status.dataset.kind = kind;
  }

  function flashStatus(message, kind = 'success') {
    setStatus(message, kind);
    statusTimer = setTimeout(() => {
      if (kind === 'success') elements.status.textContent = 'Roadmap ready. Changes are saved to data/qa-roadmap.json.';
      elements.status.dataset.kind = 'info';
    }, 3500);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function markDirty() {
    dirty = true;
    elements.save.disabled = false;
    elements.discard.disabled = false;
    setStatus('Unsaved changes. Save to update data/qa-roadmap.json.', 'info');
  }

  function updateSummary() {
    const items = roadmap.levels.flatMap(level => level.items);
    const complete = items.filter(item => item.status === 'complete').length;
    const percent = items.length ? Math.round((complete / items.length) * 100) : 0;
    document.getElementById('levelCount').textContent = String(roadmap.levels.length);
    document.getElementById('itemCount').textContent = String(items.length);
    document.getElementById('completedCount').textContent = String(complete);
    document.getElementById('progressPercent').textContent = `${percent}%`;
    const progress = document.getElementById('overallProgress');
    progress.value = percent;
    progress.textContent = `${percent}%`;
  }

  function createActionButton(label, action, itemId, className = 'text-button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.itemId = itemId;
    button.setAttribute('aria-label', `${label} roadmap action`);
    return button;
  }

  function render() {
    if (!roadmap) return;
    elements.title.textContent = roadmap.title;
    updateSummary();
    elements.levels.replaceChildren();

    const query = elements.search.value.trim().toLocaleLowerCase();
    const statusFilter = elements.filter.value;
    let visibleLevels = 0;

    roadmap.levels.forEach((level, index) => {
      const visibleItems = level.items.filter(item => {
        const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
        const searchable = `${level.title} ${level.description} ${item.title} ${item.description} ${item.owner}`.toLocaleLowerCase();
        return matchesStatus && (!query || searchable.includes(query));
      });
      const matchesLevel = `${level.title} ${level.description}`.toLocaleLowerCase().includes(query);
      if (!visibleItems.length && (query || statusFilter !== 'all') &&
          !(query && matchesLevel && statusFilter === 'all')) return;
      visibleLevels += 1;

      const card = document.createElement('article');
      card.className = 'level-card';
      card.dataset.levelId = level.id;

      const head = document.createElement('div');
      head.className = 'level-head';
      const identity = document.createElement('div');
      identity.style.cssText = 'display:flex;gap:10px;align-items:flex-start;min-width:0;';
      const number = document.createElement('span');
      number.className = 'level-number';
      number.textContent = `LEVEL ${index}`;
      const copy = document.createElement('div');
      const title = document.createElement('h2');
      title.className = 'level-title';
      title.textContent = level.title;
      const description = document.createElement('p');
      description.className = 'level-description';
      description.textContent = level.description;
      copy.append(title, description);
      identity.append(number, copy);

      const levelStatus = document.createElement('select');
      levelStatus.className = 'level-status';
      levelStatus.setAttribute('aria-label', `${level.title} status`);
      [
        ['not-started', 'Not started'],
        ['in-progress', 'In progress'],
        ['complete', 'Complete']
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = level.status === value;
        levelStatus.appendChild(option);
      });
      levelStatus.addEventListener('change', () => {
        level.status = levelStatus.value;
        markDirty();
      });
      head.append(identity, levelStatus);
      card.appendChild(head);

      const completed = level.items.filter(item => item.status === 'complete').length;
      const levelProgress = document.createElement('div');
      levelProgress.className = 'level-progress';
      const progressText = document.createElement('span');
      progressText.textContent = `${completed} of ${level.items.length} actions complete`;
      const progress = document.createElement('progress');
      progress.max = Math.max(level.items.length, 1);
      progress.value = completed;
      progress.setAttribute('aria-label', `${level.title} completion`);
      progress.textContent = `${completed} of ${level.items.length}`;
      levelProgress.append(progressText, progress);
      card.appendChild(levelProgress);

      const itemList = document.createElement('div');
      itemList.className = 'action-list';
      if (visibleItems.length) {
        visibleItems.forEach(item => {
          const itemCard = document.createElement('div');
          itemCard.className = 'roadmap-item';
          const topLine = document.createElement('div');
          topLine.className = 'item-topline';
          const itemTitle = document.createElement('h3');
          itemTitle.className = 'item-title';
          itemTitle.textContent = item.title;
          const actions = document.createElement('div');
          actions.className = 'item-actions';
          actions.append(
            createActionButton('Edit', 'edit', item.id),
            createActionButton('Delete', 'delete', item.id, 'text-button danger')
          );
          topLine.append(itemTitle, actions);
          itemCard.appendChild(topLine);

          if (item.description) {
            const itemDescription = document.createElement('p');
            itemDescription.className = 'item-description';
            itemDescription.textContent = item.description;
            itemCard.appendChild(itemDescription);
          }

          const badge = document.createElement('span');
          badge.className = 'status-pill';
          badge.dataset.status = item.status;
          badge.textContent = statusLabels[item.status];
          itemCard.appendChild(badge);

          const metadata = [item.owner && `Owner: ${item.owner}`, item.targetDate && `Target: ${item.targetDate}`].filter(Boolean);
          if (metadata.length) {
            const meta = document.createElement('p');
            meta.className = 'item-meta';
            meta.textContent = metadata.join(' · ');
            itemCard.appendChild(meta);
          }
          itemList.appendChild(itemCard);
        });
      } else {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = query ? 'No matching actions in this level.' : 'No actions yet. Add one to get started.';
        itemList.appendChild(empty);
      }

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'add-level-item';
      addButton.dataset.action = 'add';
      addButton.dataset.levelId = level.id;
      addButton.textContent = '+ Add action to this level';
      addButton.setAttribute('aria-label', `Add action to ${level.title}`);
      card.append(itemList, addButton);
      elements.levels.appendChild(card);
    });

    if (!visibleLevels) {
      const empty = document.createElement('p');
      empty.className = 'status-message';
      empty.textContent = 'No roadmap actions match the current search or filter.';
      elements.levels.appendChild(empty);
    }

    elements.save.disabled = !dirty;
    elements.discard.disabled = !dirty;
  }

  function fillLevelOptions(selectedLevel) {
    elements.level.replaceChildren();
    roadmap.levels.forEach((level, index) => {
      const option = document.createElement('option');
      option.value = level.id;
      option.textContent = `Level ${index} — ${level.title.replace(/^Level \d+\s*[—-]\s*/, '')}`;
      option.selected = level.id === selectedLevel;
      elements.level.appendChild(option);
    });
  }

  function openEditor(item, levelId) {
    elements.form.reset();
    elements.id.value = item ? item.id : '';
    elements.dialogTitle.textContent = item ? 'Edit action' : 'Add an action';
    fillLevelOptions(item ? levelId : levelId || roadmap.levels[0].id);
    elements.itemTitle.value = item ? item.title : '';
    elements.description.value = item ? item.description : '';
    elements.itemStatus.value = item ? item.status : 'not-started';
    elements.owner.value = item ? item.owner : '';
    elements.targetDate.value = item ? item.targetDate : '';
    elements.dialog.showModal();
    elements.itemTitle.focus();
  }

  function setCleanState() {
    dirty = false;
    elements.save.disabled = true;
    elements.discard.disabled = true;
  }

  async function loadRoadmap() {
    setStatus('Loading roadmap…');
    try {
      const response = await fetch('/api/qa-roadmap', { headers: { Accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);
      savedRoadmap = clone(data);
      roadmap = clone(data);
      setCleanState();
      setStatus('Roadmap ready. Changes are saved to data/qa-roadmap.json.');
      render();
    } catch (error) {
      setStatus(`Could not load the roadmap: ${error.message}`, 'error');
    }
  }

  elements.levels.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'add') {
      openEditor(null, button.dataset.levelId);
      return;
    }
    const level = roadmap.levels.find(candidate => candidate.items.some(item => item.id === button.dataset.itemId));
    if (!level) return;
    const itemIndex = level.items.findIndex(item => item.id === button.dataset.itemId);
    if (button.dataset.action === 'edit') {
      openEditor(level.items[itemIndex], level.id);
    } else if (button.dataset.action === 'delete' && window.confirm(`Delete "${level.items[itemIndex].title}"?`)) {
      level.items.splice(itemIndex, 1);
      markDirty();
      render();
    }
  });

  elements.form.addEventListener('submit', event => {
    event.preventDefault();
    if (!elements.form.reportValidity()) return;
    const item = {
      id: elements.id.value || (crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      title: elements.itemTitle.value.trim(),
      description: elements.description.value.trim(),
      status: elements.itemStatus.value,
      owner: elements.owner.value.trim(),
      targetDate: elements.targetDate.value
    };
    const destination = roadmap.levels.find(level => level.id === elements.level.value);
    if (!destination) {
      setStatus('Choose a valid roadmap level before saving this action.', 'error');
      return;
    }
    if (elements.id.value) {
      roadmap.levels.forEach(level => {
        level.items = level.items.filter(existing => existing.id !== elements.id.value);
      });
    }
    destination.items.push(item);
    elements.dialog.close();
    markDirty();
    render();
  });

  async function saveRoadmap() {
    elements.save.disabled = true;
    setStatus('Saving roadmap…');
    try {
      const response = await fetch('/api/qa-roadmap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(roadmap)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Server returned ${response.status}`);
      savedRoadmap = clone(data.roadmap);
      roadmap = clone(data.roadmap);
      setCleanState();
      render();
      flashStatus('Roadmap saved to data/qa-roadmap.json.');
    } catch (error) {
      elements.save.disabled = false;
      setStatus(`Could not save the roadmap: ${error.message}`, 'error');
    }
  }

  elements.save.addEventListener('click', saveRoadmap);
  elements.discard.addEventListener('click', () => {
    roadmap = clone(savedRoadmap);
    setCleanState();
    render();
    setStatus('Unsaved changes discarded; loaded data/qa-roadmap.json.');
  });
  elements.reload.addEventListener('click', () => {
    if (dirty && !window.confirm('Discard your unsaved changes and reload the saved roadmap JSON?')) return;
    loadRoadmap();
  });
  document.getElementById('addItemButton').addEventListener('click', () => openEditor(null));
  document.getElementById('closeDialogButton').addEventListener('click', () => elements.dialog.close());
  document.getElementById('cancelDialogButton').addEventListener('click', () => elements.dialog.close());
  elements.search.addEventListener('input', render);
  elements.filter.addEventListener('change', render);
  document.getElementById('themeToggle').addEventListener('click', event => theme.toggleThemeMenu(event));
  elements.export.addEventListener('click', () => {
    if (!roadmap) return;
    const file = new Blob([`${JSON.stringify(roadmap, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'qa-roadmap.json';
    link.click();
    URL.revokeObjectURL(url);
  });

  loadRoadmap();
})();
