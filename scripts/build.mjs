// Build for deployment: copy site/ to dist/ and stamp the service worker cache name with the commit,
// so each deploy replaces the offline cache. Used by Cloudflare Pages (build command: npm run build).
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const build = (process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12);

rmSync('dist', { recursive: true, force: true });
cpSync('site', 'dist', { recursive: true });

const sw = 'dist/sw.js';
writeFileSync(sw, readFileSync(sw, 'utf8').replace("'typeout-__BUILD__'", `'typeout-${build}'`));

console.log(`Built dist/ (cache ${build})`);
