importScripts('lib/jszip.min.js');

try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch {}

const CONCURRENCY = 2;
const REQUEST_GAP_MS = 3500;
let lastRequestTime = 0;

async function waitForSlot() {
  const now = Date.now();
  const gap = REQUEST_GAP_MS - (now - lastRequestTime);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  lastRequestTime = Date.now();
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'fetch-progress') return;

  let aborted = false;
  port.onDisconnect.addListener(() => { aborted = true; });

  port.onMessage.addListener(async (msg) => {
    if (aborted) return;

    switch (msg.action) {
      case 'getLinks':
        await handleGetLinks(port);
        break;
      case 'fetchAndDownload':
        await handleFetchAndDownload(msg.urls, msg.originUrl, port, () => aborted);
        break;
      case 'cancel':
        aborted = true;
        break;
    }
  });
});

async function handleGetLinks(port) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { port.postMessage({ type: 'linksError', error: 'No active tab' }); return; }

    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractLinksInline,
    });
    port.postMessage({ type: 'links', links: execResult.result || [] });
  } catch (e) {
    port.postMessage({ type: 'linksError', error: e.message });
  }
}

function extractLinksInline() {
  const excluded = [
    '/', '/home', '/about', '/contact', '/privacy', '/terms',
    '/login', '/signup', '/logout', '/register', '/forgot-password',
    '/reset-password', '/faq', '/help', '/support', '/sitemap',
    '/search', '/blog', '/news', '/index', '/index.html', '/index.php',
  ];
  const excludedSet = new Set(excluded);

  const socialDomains = new Set([
    'facebook.com', 'www.facebook.com',
    'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com',
    'linkedin.com', 'www.linkedin.com',
    'instagram.com', 'www.instagram.com',
    'youtube.com', 'www.youtube.com', 'youtu.be',
    'tiktok.com', 'www.tiktok.com',
    'reddit.com', 'www.reddit.com',
    'pinterest.com', 'www.pinterest.com',
    'snapchat.com', 'www.snapchat.com',
    'whatsapp.com', 'www.whatsapp.com',
    't.me', 'telegram.me', 'telegram.org',
    'discord.com', 'discord.gg',
    'medium.com', 'www.medium.com',
    'threads.net', 'www.threads.net',
    'bsky.app', 'www.bsky.app',
    'twitch.tv', 'www.twitch.tv',
  ]);

  const links = [];
  const seen = new Set();

  document.querySelectorAll('a[href]').forEach(a => {
    let href = a.getAttribute('href');
    if (!href || href === '#' || href.startsWith('#') || href === '') return;
    if (/^javascript:|^mailto:|^tel:/i.test(href)) return;

    try { href = new URL(href, window.location.href).href; }
    catch { return; }

    if (!href.startsWith('http://') && !href.startsWith('https://')) return;

    try {
      const p = new URL(href);
      const path = p.pathname.replace(/\/$/, '') || '/';
      if (excludedSet.has(path)) return;
      if (socialDomains.has(p.hostname)) return;
    } catch { return; }

    if (seen.has(href)) return;
    seen.add(href);

    let text = a.textContent.trim();
    if (!text) text = a.title || href;
    if (text.length > 200) text = text.slice(0, 200) + '...';

    links.push({ url: href, text });
  });

  return links;
}

async function handleFetchAndDownload(urls, originUrl, port, isAborted) {
  const total = urls.length;
  const results = new Array(total);
  let completed = 0;

  port.postMessage({ type: 'start', total });

  let idx = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
    while (idx < total && !isAborted()) {
      const i = idx++;
      const url = urls[i];
      const result = await fetchWithRetry(url, { port, completed, total, isAborted });
      results[i] = result;
      completed++;
      try {
        port.postMessage({ type: 'progress', completed, total, url, success: result.success });
      } catch {}
    }
  });

  await Promise.all(workers);
  if (isAborted()) { port.postMessage({ type: 'cancelled' }); return; }

  const succeeded = [];
  const failed = [];

  for (const r of results) {
    if (r && r.success && r.markdown) succeeded.push(r);
    else if (r && !r.success) failed.push(r);
  }

  if (succeeded.length === 0) {
    port.postMessage({
      type: 'done', zipData: null, zipName: null, total,
      succeeded: 0, failed: failed.map(r => ({ url: r.url, error: r.error })),
    });
    return;
  }

  const zip = new JSZip();
  const usedNames = new Set();

  for (const r of succeeded) {
    const filename = sanitizeFilename(r.title) + '.md';
    const uniqueName = getUniqueName(usedNames, filename);
    usedNames.add(uniqueName);
    zip.file(uniqueName, r.markdown);
  }

  const zipData = await zip.generateAsync({ type: 'arraybuffer' });
  const domain = extractDomain(originUrl);
  const zipName = `${domain}-${getTimestamp()}.zip`;

  port.postMessage({
    type: 'done', zipData, zipName, total,
    succeeded: succeeded.length,
    failed: failed.map(r => ({ url: r.url, error: r.error })),
  });
}

async function fetchWithRetry(url, ctx = {}) {
  const { port, completed, total, isAborted } = ctx;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (isAborted?.()) return { success: false, url, error: 'Cancelled' };
      await waitForSlot();
      if (isAborted?.()) return { success: false, url, error: 'Cancelled' };

      const resp = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
        headers: { Accept: 'text/plain' },
      });

      if (resp.status === 429) {
        if (attempt === 0) {
          try { port?.postMessage({ type: 'progress', completed, total, url, success: false, rateLimited: true }); } catch {}
          const backoff = 65000 + Math.random() * 10000;
          const step = 1000;
          for (let waited = 0; waited < backoff; waited += step) {
            if (isAborted?.()) return { success: false, url, error: 'Cancelled' };
            await new Promise(r => setTimeout(r, step));
          }
          continue;
        }
        throw new Error('Rate limited. Add a Jina API key for higher limits.');
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const markdown = await resp.text();
      const title = resp.headers.get('X-Reader-Title') || extractTitle(markdown) || url;
      return { success: true, url, markdown, title };
    } catch (err) {
      if (attempt === 1) return { success: false, url, error: err.message };
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function extractTitle(md) {
  const m = md.match(/^#\s+(.+)/m);
  if (m) return m[1].trim();
  const first = md.split('\n')[0].trim();
  if (first && first.length < 200) return first;
  return null;
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'unknown'; }
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function getUniqueName(used, name) {
  if (!used.has(name)) return name;
  const base = name.replace(/\.md$/, '');
  let n = 1;
  while (used.has(`${base} (${n}).md`)) n++;
  return `${base} (${n}).md`;
}

function getTimestamp() {
  const d = new Date();
  return String(d.getFullYear()) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') + '-' +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0');
}
