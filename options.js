let groupSettings = {};
let customGroups = [];
let editingId = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadData();
  renderBuiltin();
  renderCustom();
  document.getElementById('add-custom-btn').addEventListener('click', () => openModal(null));
  document.getElementById('reset-btn').addEventListener('click', resetDefaults);
  document.getElementById('modal-save').addEventListener('click', saveModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
}

async function loadData() {
  const stored = await chrome.storage.sync.get(['groupSettings', 'customGroups']);
  groupSettings = stored.groupSettings || {};
  customGroups = stored.customGroups || [];
}

async function persist() {
  await chrome.storage.sync.set({ groupSettings, customGroups });
}

function renderBuiltin() {
  const container = document.getElementById('builtin-list');
  container.innerHTML = '';

  for (const g of DEFAULT_GROUPS) {
    const enabled = groupSettings[g.id]?.enabled ?? g.defaultEnabled;

    const card = document.createElement('div');
    card.className = 'group-card built-in';

    const header = document.createElement('div');
    header.className = 'group-header';

    const info = document.createElement('div');
    info.className = 'group-info';

    const name = document.createElement('div');
    name.className = 'group-name';
    name.textContent = g.name;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'built-in';
    name.appendChild(badge);
    info.appendChild(name);

    const patterns = document.createElement('div');
    patterns.className = 'group-patterns';
    const parts = [];
    if (g.paths.length) parts.push(`${g.paths.length} paths`);
    if (g.domains.length) parts.push(`${g.domains.length} domains`);
    if (g.paths.length > 0) parts.push(g.paths.slice(0, 4).join(', ') + (g.paths.length > 4 ? '...' : ''));
    if (g.domains.length > 0) patterns.textContent = g.domains.slice(0, 3).join(', ') + (g.domains.length > 3 ? '...' : '');
    else if (g.paths.length > 0) patterns.textContent = g.paths.slice(0, 4).join(', ') + (g.paths.length > 4 ? '...' : '');
    info.appendChild(patterns);
    header.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'group-actions';

    const toggle = document.createElement('label');
    toggle.className = 'toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = enabled;
    cb.addEventListener('change', async () => {
      groupSettings[g.id] = { enabled: cb.checked };
      await persist();
      showToast('Saved');
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    toggle.appendChild(cb);
    toggle.appendChild(slider);
    actions.appendChild(toggle);
    header.appendChild(actions);
    card.appendChild(header);
    container.appendChild(card);
  }
}

function renderCustom() {
  const container = document.getElementById('custom-list');
  container.innerHTML = '';

  if (customGroups.length === 0) {
    container.innerHTML = '<div class="empty-state">No custom groups yet.</div>';
    return;
  }

  for (const g of customGroups) {
    const item = document.createElement('div');
    item.className = 'custom-group-item';

    const info = document.createElement('div');
    info.className = 'custom-group-info';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = g.name;

    const detail = document.createElement('div');
    detail.className = 'detail';
    const parts = [];
    if (g.paths?.length) parts.push(`${g.paths.length} paths`);
    if (g.domains?.length) parts.push(`${g.domains.length} domains`);
    detail.textContent = parts.join(' · ') || 'No patterns';

    info.appendChild(name);
    info.appendChild(detail);

    const actions = document.createElement('div');
    actions.className = 'custom-group-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openModal(g));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      customGroups = customGroups.filter(c => c.id !== g.id);
      delete groupSettings[g.id];
      await persist();
      renderCustom();
      showToast('Deleted');
    });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    item.appendChild(info);
    item.appendChild(actions);
    container.appendChild(item);
  }
}

function openModal(group) {
  editingId = group ? group.id : null;
  document.getElementById('modal-title').textContent = group ? 'Edit Custom Group' : 'Add Custom Group';
  document.getElementById('modal-name').value = group ? group.name : '';
  document.getElementById('modal-paths').value = group?.paths ? group.paths.join('\n') : '';
  document.getElementById('modal-domains').value = group?.domains ? group.domains.join('\n') : '';
  document.getElementById('modal-selected').checked = group ? !!group.defaultSelected : false;
  document.getElementById('modal').classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

async function saveModal() {
  const name = document.getElementById('modal-name').value.trim();
  const pathsRaw = document.getElementById('modal-paths').value.trim();
  const domainsRaw = document.getElementById('modal-domains').value.trim();
  const defaultSelected = document.getElementById('modal-selected').checked;

  if (!name) { alert('Group name is required.'); return; }

  const paths = pathsRaw ? pathsRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
  const domains = domainsRaw ? domainsRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];

  if (paths.length === 0 && domains.length === 0) {
    alert('Add at least one path or domain pattern.');
    return;
  }

  if (editingId) {
    const idx = customGroups.findIndex(c => c.id === editingId);
    if (idx !== -1) {
      customGroups[idx] = { ...customGroups[idx], name, paths, domains, defaultSelected };
    }
  } else {
    customGroups.push({
      id: 'custom_' + Date.now(),
      name, paths, domains, defaultSelected,
    });
  }

  await persist();
  closeModal();
  renderCustom();
  showToast('Saved');
}

async function resetDefaults() {
  if (!confirm('Reset all group settings to defaults? This will delete all custom groups.')) return;
  groupSettings = {};
  customGroups = [];
  for (const g of DEFAULT_GROUPS) groupSettings[g.id] = { enabled: g.defaultEnabled };
  await persist();
  renderBuiltin();
  renderCustom();
  showToast('Reset to defaults');
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}
