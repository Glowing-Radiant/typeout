import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const run = () =>
  execFileSync(process.execPath, ['scripts/build.mjs'], { env: { ...process.env, CF_PAGES_COMMIT_SHA: 'abc123def4567890' } });

test('build ties every script and stylesheet to the build', () => {
  run();
  const v = '?v=abc123def456';

  const index = readFileSync('dist/index.html', 'utf8');
  assert.match(index, /href="assets\/css\/styles\.css\?v=abc123def456"/);
  assert.match(index, /src="assets\/js\/app\.js\?v=abc123def456"/);
  assert.match(index, /src="assets\/js\/theme-init\.js\?v=abc123def456"/);
  assert.doesNotMatch(index, /assets\/(js|css)\/[\w-]+\.(js|css)"/, 'no unversioned references');

  const notFound = readFileSync('dist/404.html', 'utf8');
  assert.match(notFound, /href="\/assets\/css\/styles\.css\?v=abc123def456"/);

  for (const file of readdirSync('dist/assets/js')) {
    const src = readFileSync(`dist/assets/js/${file}`, 'utf8');
    for (const [, spec] of src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
      assert.ok(spec.endsWith(`.js${v}`), `${file} imports ${spec}`);
    }
  }

  const sw = readFileSync('dist/sw.js', 'utf8');
  assert.match(sw, /const VERSION = 'abc123def456';/);
  assert.doesNotMatch(sw, /__BUILD__/);

  // The source files stay untouched.
  assert.match(readFileSync('site/sw.js', 'utf8'), /const VERSION = '__BUILD__';/);
  assert.match(readFileSync('site/index.html', 'utf8'), /src="assets\/js\/app\.js"/);
});
