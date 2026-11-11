import { readFile, writeFile } from 'node:fs/promises';

const dataUrl = 'https://app-sources.w3cub.com/sister-apps/apps.json';
const readmePath = new URL('../README.md', import.meta.url);
const startMarker = '<!-- sister-apps:start -->';
const endMarker = '<!-- sister-apps:end -->';

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const response = await fetch(dataUrl);
if (!response.ok) {
  throw new Error(`Failed to fetch ${dataUrl}: ${response.status} ${response.statusText}`);
}

const apps = await response.json();
if (!Array.isArray(apps)) {
  throw new Error('The app source must be a JSON array.');
}

const cards = apps.map((app) => {
  const name = escapeHtml(app.name ?? app.id ?? 'Unnamed app');
  const description = escapeHtml(app.description_en ?? app.description ?? '');
  const appStoreUrl = escapeHtml(app.appStoreUrl ?? '#');
  const logo = app.logo
    ? `\n  <img src="${escapeHtml(app.logo)}" alt="${name} icon" width="72" height="72" />`
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
  console.log(`Updated README with ${apps.length} apps.`);
} else {
  console.log('README is already up to date.');
}
