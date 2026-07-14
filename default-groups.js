const DEFAULT_GROUPS = [
  {
    id: 'nav',
    name: 'Navigation',
    builtIn: true,
    defaultEnabled: true,
    defaultSelected: false,
    paths: ['/', '/home', '/about', '/contact', '/faq', '/help', '/support', '/sitemap'],
    domains: [],
  },
  {
    id: 'account',
    name: 'Account',
    builtIn: true,
    defaultEnabled: true,
    defaultSelected: false,
    paths: ['/login', '/signup', '/register', '/logout', '/forgot-password', '/reset-password'],
    domains: [],
  },
  {
    id: 'legal',
    name: 'Legal',
    builtIn: true,
    defaultEnabled: true,
    defaultSelected: false,
    paths: ['/privacy', '/terms', '/cookie', '/privacy-policy', '/terms-of-service'],
    domains: [],
  },
  {
    id: 'social',
    name: 'Social',
    builtIn: true,
    defaultEnabled: true,
    defaultSelected: false,
    paths: [],
    domains: [
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
    ],
  },
  {
    id: 'index',
    name: 'Index',
    builtIn: true,
    defaultEnabled: true,
    defaultSelected: false,
    paths: ['/blog', '/news', '/search', '/index', '/index.html', '/index.php'],
    domains: [],
  },
];

function matchUrlAgainstGroup(group, url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '') || '/';
    if (group.paths.includes(path)) return true;
    if (group.domains.includes(u.hostname)) return true;
  } catch {}
  return false;
}

async function loadGroupState() {
  const { groupSettings, customGroups } = await chrome.storage.sync.get(['groupSettings', 'customGroups']);

  const merged = DEFAULT_GROUPS.map(g => ({
    ...g,
    enabled: groupSettings?.[g.id]?.enabled ?? g.defaultEnabled,
  }));

  const custom = (customGroups || []).map((g, i) => ({
    ...g,
    id: g.id || `custom_${i}`,
    builtIn: false,
    enabled: g.enabled !== false,
  }));

  return [...merged, ...custom];
}

async function saveGroupState(groupSettings, customGroups) {
  await chrome.storage.sync.set({ groupSettings, customGroups });
}

function getDefaultGroupSettings() {
  const s = {};
  for (const g of DEFAULT_GROUPS) s[g.id] = { enabled: g.defaultEnabled };
  return s;
}
