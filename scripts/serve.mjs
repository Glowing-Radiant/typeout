// Local dev server: serves site/ (or the folder given, e.g. dist) and the API, with the same headers as production (site/_headers) and caching off,
// so edits always show and Content-Security-Policy problems surface before deploy.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createD1 } from './dev-d1.mjs';

const root = resolve(process.argv[2] || 'site');
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

// Only the global "/*" block of _headers is applied; that is all this site uses.
const headers = {};
let inGlobal = false;
for (const line of (await readFile(join(root, '_headers'), 'utf8')).split(/\r?\n/)) {
  if (!line.trim()) continue;
  if (!/^\s/.test(line)) inGlobal = line.trim() === '/*';
  else if (inGlobal) {
    const i = line.indexOf(':');
    headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}

// The API (the Cloudflare Worker in production) runs here too, with a local SQLite file standing
// in for D1. Passages still come from the real Wikipedia.
const apiModule = await import('../server/api.js');
const { mkdirSync } = await import('node:fs');
mkdirSync('.dev', { recursive: true });
const env = { DB: await createD1('.dev/typeout.sqlite') };
const API = {
  'GET /api/passage': apiModule.handlePassage,
  'GET /api/scores': apiModule.handleScoresGet,
  'POST /api/scores': apiModule.handleScoresPost,
};

async function serveApi(req, res, handler) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(new URL(req.url, `http://localhost:${port}`), {
    method: req.method,
    headers: { ...req.headers, 'CF-Connecting-IP': req.socket.remoteAddress ?? '' },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
  let response;
  try {
    response = await handler(request, env);
  } catch (err) {
    console.error(err);
    response = new Response(JSON.stringify({ error: 'Server error.' }), { status: 500 });
  }
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const handler = API[`${req.method} ${path}`];
  if (handler) {
    await serveApi(req, res, handler);
    return;
  }
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  let status = 200;
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    await stat(file);
  } catch {
    file = join(root, '404.html');
    status = 404;
  }
  res.writeHead(status, {
    ...headers,
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(await readFile(file));
}).listen(port, () => console.log(`Type Out on http://localhost:${port}`));
