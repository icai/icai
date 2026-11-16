import { readFile, writeFile } from 'node:fs/promises';

// app-sources.w3cub.com sits behind Cloudflare and regularly returns 403 to
// GitHub Actions egress IPs (or times out). The sister-apps section of README.md
// is itself the committed snapshot: when the refresh fails we simply leave the
// README untouched and exit successfully instead of failing the scheduled job.
const defaultDataUrl = 'https://app-sources.w3cub.com/sister-apps/apps.json';
const dataUrl = process.env.APPS_SOURCE_URL ?? defaultDataUrl;
const attempts = Math.max(1, Number(process.env.APPS_FETCH_ATTEMPTS ?? 3) || 3);

const readmePath = new URL('../README.md', import.meta.url);
const startMarker = '<!-- sister-apps:start -->';
const endMarker = '<!-- sister-apps:end -->';

const requestHeaders = {
  accept: 'application/json, */*',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const warn = (message) => {
  const prefix = process.env.GITHUB_ACTIONS === 'true' ? '::warning::' : '[warn] ';
  console.warn(`${prefix}${message}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

// Only allow http(s) links from the untrusted remote payload.
const safeUrl = (value, fallback = '#') => {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : fallback;
  } catch {
    return fallback;
  }
};

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const validateApps = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('The app source must be a non-empty JSON array.');
  }
  const invalidIndex = value.findIndex((app) => !isPlainObject(app) || !(app.name || app.id));
  if (invalidIndex !== -1) {
    throw new Error(`The app source has an invalid entry at index ${invalidIndex}.`);
  }
  return value;
};

const fetchRemoteApps = async () => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(dataUrl, {
        headers: requestHeaders,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return validateApps(await response.json());
    } catch (error) {
      lastError = error;
      warn(`Fetch attempt ${attempt}/${attempts} for ${dataUrl} failed: ${error.message}`);
      if (attempt < attempts) {
        await sleep(1000 * attempt);
      }
    }
  }
  throw lastError ?? new Error(`Could not fetch ${dataUrl}.`);
};

if (!dataUrl) {
  console.log('APPS_SOURCE_URL is empty; skipping README update.');
  process.exit(0);
}

let apps;
try {
  apps = await fetchRemoteApps();
} catch (error) {
  warn(`Unable to refresh sister apps (${error.message}); keeping the existing README section unchanged.`);
  process.exit(0);
}

const cards = apps.map((app) => {
  const name = escapeHtml(app.name ?? app.id ?? 'Unnamed app');
  const description = escapeHtml(app.description_en ?? app.description ?? '');
  const appStoreUrl = safeUrl(app.appStoreUrl);
  const logoUrl = safeUrl(app.logo, '');
  const logo = logoUrl
    ? `\n  <img src="${logoUrl}" alt="${name} icon" width="72" height="72" />`
    : '';

  return `<td width="25%" valign="top" align="center">\n  <div><a href="${appStoreUrl}">${logo}</a></div>\n  <div><a href="${appStoreUrl}"><strong>${name}</strong></a></div>\n  <div>${description}</div>\n</td>`;
});

const rows = [];
for (let index = 0; index < cards.length; index += 4) {
  const rowCards = cards.slice(index, index + 4);
  while (rowCards.length < 4) {
    rowCards.push('<td width="25%"></td>');
  }
  rows.push(`<tr>\n${rowCards.join('\n')}\n</tr>`);
  if (index + 4 < cards.length) {
    rows.push('<tr><td colspan="4" style="border-bottom: 1px solid #ddd; height: 12px;"></td></tr>');
  }
}

const generatedSection = `${startMarker}\n\n### 📦 My Apps\n\n<p>A collection of apps I’ve built for macOS and the web.</p>\n\n<table>\n${rows.join('\n')}\n</table>\n\n${endMarker}`;
const readme = await readFile(readmePath, 'utf8');
const markerPattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);

if (!markerPattern.test(readme)) {
  throw new Error(`Could not find ${startMarker} and ${endMarker} in README.md.`);
}

const updatedReadme = readme.replace(markerPattern, generatedSection);
if (updatedReadme !== readme) {
  await writeFile(readmePath, updatedReadme);
  console.log(`Updated README with ${apps.length} apps from ${dataUrl}.`);
} else {
  console.log(`README is already up to date (${apps.length} apps).`);
}
