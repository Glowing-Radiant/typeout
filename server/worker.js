// Cloudflare Worker entry point (see wrangler.jsonc).
//
// Static files in dist/ are served by Workers static assets without running this script. Only
// /api/* requests reach it (assets.run_worker_first), and they go to the handlers in api.js.
import { handlePassage, handleScoresGet, handleScoresPost } from './api.js';

const ROUTES = {
  'GET /api/passage': handlePassage,
  'GET /api/scores': handleScoresGet,
  'POST /api/scores': handleScoresPost,
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const handler = ROUTES[`${request.method} ${pathname}`];
    if (!handler) {
      return new Response(JSON.stringify({ error: 'Not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    try {
      return await handler(request, env);
    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({ error: 'Something went wrong on the server. Please try again.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
      });
    }
  },
};
