// Build for deployment: copy site/ to dist/ and tie every script and stylesheet to this build.
//
// Each local .js/.css reference (in the HTML pages, in module imports and in the service worker's
// precache list) gets ?v=<build>. A freshly loaded page therefore only ever loads files from its own
// build, never a stale copy from a browser or service-worker cache, and the service worker can cache
// those files without re-checking them. Used by Cloudflare Pages (build command: npm run build).
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const build = (
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.WORKERS_CI_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  Date.now().toString(36)
).slice(0, 12);
const v = `?v=${build}`;

rmSync('dist', { recursive: true, force: true });
cpSync('site', 'dist', { recursive: true });

const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, 'utf8')));

// <link href="assets/css/x.css"> and <script src="assets/js/x.js">, with or without a leading slash.
const HTML_REF = /((?:href|src)=")(\/?assets\/(?:css|js)\/[^"?]+\.(?:css|js))"/g;
// import … from './x.js' and import('./x.js')
const JS_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g;

for (const page of ['index.html', '404.html']) {
  edit(join('dist', page), (s) => s.replace(HTML_REF, `$1$2${v}"`));
}
const jsDir = join('dist', 'assets', 'js');
const jsFiles = readdirSync(jsDir).filter((f) => f.endsWith('.js')).map((f) => join(jsDir, f));
for (const file of jsFiles) edit(file, (s) => s.replace(JS_IMPORT, `$1$2$3${v}$2`));

edit(join('dist', 'sw.js'), (s) => {
  const stamped = s.replace("const VERSION = '__BUILD__';", `const VERSION = '${build}';`);
  if (stamped === s) throw new Error('sw.js: VERSION placeholder not found');
  return stamped;
});

// Guard: an unversioned reference would let a stale file slip through, so fail the build instead.
const problems = [];
for (const page of ['index.html', '404.html']) {
  for (const m of readFileSync(join('dist', page), 'utf8').matchAll(HTML_REF)) problems.push(`${page}: ${m[2]}`);
}
for (const file of jsFiles) {
  for (const m of readFileSync(file, 'utf8').matchAll(JS_IMPORT)) problems.push(`${file}: ${m[3]}`);
}
if (problems.length) throw new Error(`Unversioned asset references:\n  ${problems.join('\n  ')}`);

console.log(`Built dist/ (version ${build})`);
