import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

assert.equal(pkg.version, '1.1.0');
assert.match(app, /Open Graph metadata fallback/);
assert.match(app, /\/embed\/captioned\//);
assert.match(app, /isAllowedPublicMediaUrl/);
assert.match(app, /No source text was exposed/);
assert.match(app, /does not extract video streams from YouTube/);
for (const id of ['tool', 'extract-form', 'url-input', 'extract-button', 'results-wrap', 'recent-list', 'clear-history', 'toast', 'sidebar', 'mobile-overlay', 'mobile-menu']) {
  assert.ok(html.includes('id="' + id + '"'), `missing runtime hook #${id}`);
}
assert.match(html, /RexMedia Studio/);
assert.match(html, /styles\.css/);
console.log('RexMedia regression tests passed.');
