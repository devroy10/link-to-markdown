const state = {
  links: [], selected: new Set(), port: null, failedCount: 0,
  groups: [], linkGroupMap: new Map(),
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  state.port = chrome.runtime.connect({ name: 'fetch-progress' });
  state.port.onMessage.addListener(onMessage);
  state.port.onDisconnect.addListener(() => { state.port = null; });

  document.getElementById('scan-btn').addEventListener('click', scanLinks);
  document.getElementById('select-all-btn').addEventListener('click', selectAll);
  document.getElementById('select-none-btn').addEventListener('click', selectNone);
  document.getElementById('copy-btn').addEventListener('click', copySelected);
  document.getElementById('fetch-btn').addEventListener('click', startFetch);
  document.getElementById('cancel-btn').addEventListener('click', cancelFetch);
  document.getElementById('options-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  state.groups = await loadGroupState();
  await scanLinks();
}

function scanLinks() {
  showLoading('Scanning page...');
  hideMulti('.footer', '.progress', '.summary', '.error', '#controls', '#groups');

  if (!state.port) {
    showError('Connection lost. Close and reopen the side panel.');
    return;
  }

  state.port.postMessage({ action: 'getLinks' });
}

function onMessage(msg) {
  switch (msg.type) {
    case 'links':
      state.links = msg.links;
      classifyLinks();
      applyGroupDefaults();
      renderGroups();
      renderLinks();
      showControls2();
      document.getElementById('link-count').textContent =
        `${msg.links.length} link${msg.links.length === 1 ? '' : 's'} found`;
      break;

    case 'linksError':
      showError('Cannot extract links: ' + msg.error);
      break;

    case 'start':
      state.failedCount = 0;
      updateProgressBar(0);
      document.getElementById('progress-text').textContent = `0 / ${msg.total} fetched`;
      break;

    case 'progress':
      if (!msg.success && !msg.rateLimited) state.failedCount++;
      updateProgressBar(msg.total > 0 ? Math.round((msg.completed / msg.total) * 100) : 0);
      document.getElementById('progress-text').textContent =
        `${msg.completed} / ${msg.total} fetched`;
      if (state.failedCount > 0) {
        document.getElementById('progress-fails').classList.remove('hidden');
        document.getElementById('progress-fails').textContent = `${state.failedCount} failed`;
      }
      if (!msg.success) markFailed(msg.url);
      break;

    case 'done':
      hideMulti('.progress');
      triggerDownload(msg);
      showSummary(msg);
      document.getElementById('fetch-btn').disabled = false;
      setTimeout(() => {
        hideMulti('.summary', '#failed-list');
        document.getElementById('footer').classList.remove('hidden');
        document.getElementById('controls').classList.remove('hidden');
        document.getElementById('groups').classList.remove('hidden');
      }, 5000);
      break;

    case 'error':
      showError(msg.message);
      document.getElementById('fetch-btn').disabled = false;
      break;

    case 'cancelled':
      hideMulti('.progress');
      document.getElementById('fetch-btn').disabled = false;
      document.getElementById('footer').classList.remove('hidden');
      document.getElementById('controls').classList.remove('hidden');
      document.getElementById('groups').classList.remove('hidden');
      document.getElementById('link-count').textContent =
        `${state.selected.size} link${state.selected.size === 1 ? '' : 's'} selected`;
      break;
  }
}

function classifyLinks() {
  state.linkGroupMap = new Map();
  for (const link of state.links) {
    const matched = [];
    for (const g of state.groups) {
      if (g.enabled && matchUrlAgainstGroup(g, link.url)) matched.push(g.id);
    }
    state.linkGroupMap.set(link.url, matched);
  }
}

function applyGroupDefaults() {
  state.selected = new Set(state.links.map(l => l.url));
  for (const g of state.groups) {
    if (!g.enabled || g.defaultSelected) continue;
    for (const link of state.links) {
      if (state.linkGroupMap.get(link.url)?.includes(g.id)) {
        state.selected.delete(link.url);
      }
    }
  }
}

function renderGroups() {
  const container = document.getElementById('groups');
  container.innerHTML = '';

  const visible = state.groups.filter(g => g.enabled);
  if (visible.length === 0) { container.classList.add('hidden'); return; }

  container.classList.remove('hidden');
  for (const g of visible) {
    const count = state.links.filter(l => state.linkGroupMap.get(l.url)?.includes(g.id)).length;
    if (count === 0) continue;

    const row = document.createElement('div');
    row.className = 'group-row';

    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = g.name;

    const countEl = document.createElement('span');
    countEl.className = 'group-count';
    countEl.textContent = count;

    const toggle = document.createElement('label');
    toggle.className = 'toggle';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isGroupActive(g);
    cb.addEventListener('change', () => toggleGroup(g.id, cb.checked));

    const slider = document.createElement('span');
    slider.className = 'slider';

    toggle.appendChild(cb);
    toggle.appendChild(slider);
    row.appendChild(name);
    row.appendChild(countEl);
    row.appendChild(toggle);
    container.appendChild(row);
  }
}

function isGroupActive(g) {
  const members = state.links.filter(l => state.linkGroupMap.get(l.url)?.includes(g.id));
  if (members.length === 0) return true;
  return members.some(l => state.selected.has(l.url));
}

function toggleGroup(groupId, on) {
  for (const link of state.links) {
    if (state.linkGroupMap.get(link.url)?.includes(groupId)) {
      if (on) state.selected.add(link.url);
      else state.selected.delete(link.url);
    }
  }
  updateCheckboxStates();
  updateSelectionCount();
}

function updateCheckboxStates() {
  document.querySelectorAll('.link-item').forEach(item => {
    const url = item.dataset.url;
    const cb = item.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = state.selected.has(url);
  });
}

function renderLinks() {
  const container = document.getElementById('link-list');
  container.innerHTML = '';

  for (const link of state.links) {
    const item = document.createElement('div');
    item.className = 'link-item';
    item.dataset.url = link.url;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(link.url);
    cb.addEventListener('change', () => {
      if (cb.checked) state.selected.add(link.url);
      else state.selected.delete(link.url);
      updateSelectionCount();
      renderGroups();
    });

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;cursor:pointer';
    info.addEventListener('click', () => {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });

    const textSpan = document.createElement('span');
    textSpan.className = 'link-text';
    textSpan.textContent = link.text;

    const urlSpan = document.createElement('span');
    urlSpan.className = 'link-url';
    try {
      const u = new URL(link.url);
      urlSpan.textContent = u.hostname + (u.pathname !== '/' ? u.pathname : '');
    } catch {
      urlSpan.textContent = link.url;
    }

    info.appendChild(textSpan);
    info.appendChild(urlSpan);
    item.appendChild(cb);
    item.appendChild(info);
    container.appendChild(item);
  }

  updateSelectionCount();
}

function updateSelectionCount() {
  document.getElementById('selected-count').textContent = state.selected.size;
  document.getElementById('total-count').textContent = state.links.length;
}

function selectAll() {
  state.selected = new Set(state.links.map(l => l.url));
  updateCheckboxStates();
  updateSelectionCount();
  renderGroups();
}

function selectNone() {
  state.selected.clear();
  updateCheckboxStates();
  updateSelectionCount();
  renderGroups();
}

async function copySelected() {
  const urls = state.links.filter(l => state.selected.has(l.url)).map(l => l.url);
  if (urls.length === 0) return;
  try {
    await navigator.clipboard.writeText(urls.join('\n'));
    const btn = document.getElementById('copy-btn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch {
    showError('Failed to copy to clipboard.');
  }
}

function cancelFetch() {
  if (state.port) state.port.postMessage({ action: 'cancel' });
  document.getElementById('cancel-btn').disabled = true;
  document.getElementById('cancel-btn').textContent = 'Cancelling...';
}

async function startFetch() {
  const urls = state.links
    .filter(l => state.selected.has(l.url))
    .map(l => l.url);

  if (urls.length === 0) { showError('No links selected.'); return; }

  document.getElementById('fetch-btn').disabled = true;
  hideMulti('.footer', '.summary', '.error', '#controls', '#groups');
  showProgress();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const originUrl = tab ? tab.url : '';

  if (state.port) {
    state.port.postMessage({ action: 'fetchAndDownload', urls, originUrl });
  } else {
    document.getElementById('fetch-btn').disabled = false;
    showError('Connection lost. Close and reopen the side panel.');
  }
}

async function triggerDownload(msg) {
  if (!msg.zipData || msg.succeeded === 0) return;
  try {
    const binary = atob(msg.zipData);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({ url, filename: msg.zipName, saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    showError('Download failed: ' + e.message);
  }
}

function markFailed(url) {
  const item = document.querySelector(`.link-item[data-url="${CSS.escape(url)}"]`);
  if (item) item.classList.add('failed');
}

function showSummary(msg) {
  const el = document.getElementById('summary');
  el.classList.remove('hidden');
  document.getElementById('summary-text').textContent =
    `${msg.succeeded} file${msg.succeeded === 1 ? '' : 's'} downloaded`;

  if (msg.failed && msg.failed.length > 0) {
    const fl = document.getElementById('failed-list');
    fl.classList.remove('hidden');
    const ul = document.getElementById('failed-urls');
    ul.innerHTML = '';
    for (const f of msg.failed) {
      const li = document.createElement('li');
      li.textContent = f.url + (f.error ? ` \u2014 ${f.error}` : '');
      ul.appendChild(li);
    }
  }
}

function showLoading(text) {
  document.getElementById('link-count').textContent = text;
  document.getElementById('link-list').innerHTML = '';
  document.getElementById('groups').classList.add('hidden');
}

function showError(msg) {
  hideMulti('.progress', '.summary');
  document.getElementById('error').textContent = msg;
  document.getElementById('error').classList.remove('hidden');
}

function showControls2() {
  document.getElementById('controls').classList.remove('hidden');
  document.getElementById('footer').classList.remove('hidden');
}

function showProgress() {
  document.getElementById('progress').classList.remove('hidden');
  document.getElementById('progress-fails').classList.add('hidden');
}

function updateProgressBar(pct) {
  document.getElementById('progress-fill').style.width = `${pct}%`;
}

function hideMulti(...selectors) {
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach(el => el.classList.add('hidden'));
  }
}
