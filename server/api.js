// Type Out API, run by the Cloudflare Worker in server/worker.js with a D1 database bound as DB.
//
//   GET  /api/passage?lang=en|hi          a new passage from Wikipedia (stored, so scores on it can be checked)
//   GET  /api/scores?board=…&mode=…&period=…  top 10 for a scoreboard (mode: exam or practice)
//   POST /api/scores                      share an attempt; the server marks it again before saving it
//
// Scores are never taken from the browser: it sends the typed text, and the server re-marks it with the
// same scoring engine the page uses and applies the scoreboard rules (site/assets/js/leaderboard.js).
import { evaluate } from '../site/assets/js/scoring.js';
import { findPassage } from '../site/assets/js/passages.js';
import {
  BOARDS, MODES, PERIODS, boardDuration, boardKey, boardName, cleanName, eligibility,
} from '../site/assets/js/leaderboard.js';
import { fetchWikipediaPassage } from './wikipedia.js';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TYPED_CHARS = 30000;
const RATE_LIMIT_PER_HOUR = 6;
const TOP = 10;
const DAY_MS = 86400000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS passages (
    id TEXT PRIMARY KEY,
    lang TEXT NOT NULL,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    source_url TEXT NOT NULL,
    words INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS passages_lang ON passages (lang)',
  `CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board TEXT NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    net_wpm REAL NOT NULL,
    gross_wpm REAL NOT NULL,
    error_percent REAL NOT NULL,
    key_depressions INTEGER NOT NULL,
    elapsed_ms INTEGER NOT NULL,
    passage_id TEXT NOT NULL,
    passage_title TEXT NOT NULL,
    client TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS scores_board ON scores (board, net_wpm DESC)',
  'CREATE INDEX IF NOT EXISTS scores_client ON scores (client, created_at)',
];

/* ------------------------------------------------------------------ helpers */

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

const fail = (status, message) => json({ error: message }, status);

// Tables are created on first use, once per server instance, so setting up only needs the database
// and its binding. A failed attempt is retried on the next request.
let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/** Only for tests, which use a fresh database each time. */
export function resetSchemaCache() {
  schemaReady = null;
}

async function database(env) {
  if (!env?.DB) return null;
  await ensureSchema(env.DB);
  return env.DB;
}

/** A daily-changing hash of the visitor's address, used only to limit how often they can share. */
async function clientId(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const day = Math.floor(Date.now() / DAY_MS);
  const data = new TextEncoder().encode(`${env.SCORE_SALT ?? 'typeout'}|${day}|${ip}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const round1 = (n) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ passages */

export async function handlePassage(request, env, { fetch: fetchImpl = fetch } = {}) {
  const lang = new URL(request.url).searchParams.get('lang');
  if (lang !== 'en' && lang !== 'hi') return fail(400, 'lang must be en or hi.');
  let db = null;
  try {
    db = await database(env);
  } catch {
    db = null; // passages still work without storage, they just cannot be scored
  }

  let passage = null;
  try {
    passage = await fetchWikipediaPassage(lang, { fetch: fetchImpl });
  } catch {
    passage = null;
  }

  if (passage && db) {
    try {
      await db.prepare(
        'INSERT OR IGNORE INTO passages (id, lang, title, text, source_url, words, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(passage.id, lang, passage.title, passage.text, passage.source.url, passage.text.split(/\s+/u).length, Date.now()).run();
    } catch {
      // Not stored: the passage can still be typed, but scores on it cannot be checked.
    }
  }

  // Wikipedia unreachable or nothing usable: hand out one fetched earlier.
  if (!passage && db) {
    const row = await db.prepare('SELECT * FROM passages WHERE lang = ? ORDER BY RANDOM() LIMIT 1').bind(lang).first();
    if (row) passage = passageFromRow(row);
  }
  if (!passage) return fail(503, 'No online passage is available right now.');
  return json({ passage });
}

function passageFromRow(row) {
  return {
    id: row.id,
    lang: row.lang,
    title: row.title,
    text: row.text,
    source: {
      name: 'Wikipedia',
      url: row.source_url,
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    },
  };
}

async function lookupPassage(db, id) {
  if (typeof id !== 'string' || id.length > 100) return null;
  const builtIn = findPassage(id);
  if (builtIn) return builtIn;
  if (!id.startsWith('wiki-')) return null;
  const row = await db.prepare('SELECT * FROM passages WHERE id = ?').bind(id).first();
  return row ? passageFromRow(row) : null;
}

/* ------------------------------------------------------------------ scores */

/** @param {string} board a key from boardKey() */
async function topScores(db, board, period) {
  const since = period === 'week' ? Date.now() - 7 * DAY_MS : 0;
  // Each name appears once, with its best score; an earlier score wins a tie.
  const { results } = await db.prepare(
    `SELECT name, net_wpm, gross_wpm, error_percent, key_depressions, passage_title, created_at FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY name_key ORDER BY net_wpm DESC, created_at ASC) AS n
       FROM scores WHERE board = ? AND created_at >= ?
     ) WHERE n = 1 ORDER BY net_wpm DESC, created_at ASC LIMIT ${TOP}`,
  ).bind(board, since).all();
  return results.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    netWpm: r.net_wpm,
    grossWpm: r.gross_wpm,
    errorPercent: r.error_percent,
    keyDepressions: r.key_depressions,
    passageTitle: r.passage_title,
    date: new Date(r.created_at).toISOString(),
  }));
}

export async function handleScoresGet(request, env) {
  const params = new URL(request.url).searchParams;
  const board = params.get('board') ?? BOARDS[0];
  const mode = params.get('mode') ?? 'exam';
  const period = params.get('period') ?? 'all';
  if (!BOARDS.includes(board)) return fail(400, 'Unknown scoreboard.');
  if (!MODES[mode]) return fail(400, 'mode must be exam or practice.');
  if (!PERIODS[period]) return fail(400, 'period must be all or week.');
  const db = await database(env).catch(() => null);
  if (!db) return fail(503, 'The scoreboard is not set up yet.');
  const entries = await topScores(db, boardKey(board, mode), period);
  return json({ board, mode, period, entries }, 200, { 'Cache-Control': 'public, max-age=30' });
}

export async function handleScoresPost(request, env) {
  const db = await database(env).catch(() => null);
  if (!db) return fail(503, 'The scoreboard is not set up yet.');

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, 'That attempt is too large to share.');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'The request could not be read.');
  }
  if (!body || typeof body !== 'object') return fail(400, 'The request could not be read.');

  const { presetId, mode, passageId, typed, elapsedMs, byTimer, compensatoryTime, keystrokes } = body;
  const checkedName = cleanName(body.name);
  if (checkedName.error) return fail(400, checkedName.error);
  if (!BOARDS.includes(presetId)) return fail(400, 'This exam pattern has no scoreboard.');
  if (typeof typed !== 'string' || typed.length > MAX_TYPED_CHARS) return fail(400, 'The typed text is missing or too long.');
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return fail(400, 'The time taken is missing.');
  if (typeof byTimer !== 'boolean') return fail(400, 'Whether the time ran out is missing.');

  const duration = boardDuration(presetId, compensatoryTime);
  if (byTimer && Math.abs(elapsedMs - duration) > 1000) return fail(400, 'The time taken does not match the time allowed.');

  const passage = await lookupPassage(db, passageId);
  if (!passage) return fail(400, 'This passage cannot be checked, so the score cannot be shared.');

  const result = evaluate({ passage: passage.text, typed, elapsedMs, endedByTimer: byTimer });
  const verdict = eligibility({
    presetId,
    mode,
    passageId: passage.id,
    passageLang: passage.lang,
    byTimer,
    compensatoryTime: Boolean(compensatoryTime),
    result,
  });
  if (!verdict.ok) return fail(422, verdict.reason);
  // Every character on screen took at least one key press (allowing a little for input methods).
  if (!Number.isFinite(keystrokes) || keystrokes < result.keyDepressions * 0.9) {
    return fail(422, 'The key presses recorded do not match the text.');
  }

  const client = await clientId(request, env);
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM scores WHERE client = ? AND created_at > ?')
    .bind(client, Date.now() - 3600000).first('n');
  if (recent >= RATE_LIMIT_PER_HOUR) return fail(429, 'You have shared several scores in the last hour. Please try again later.');

  const now = Date.now();
  const netWpm = round1(result.netWpm);
  const key = boardKey(presetId, mode);
  await db.prepare(
    `INSERT INTO scores (board, name, name_key, net_wpm, gross_wpm, error_percent, key_depressions, elapsed_ms,
       passage_id, passage_title, client, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    key, checkedName.name, checkedName.key, netWpm, round1(result.grossWpm), round1(result.errorPercent),
    result.keyDepressions, Math.round(elapsedMs), passage.id, passage.title, client, now,
  ).run();

  // Position among everyone's best scores on this board (all time).
  const ahead = await db.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT name_key, MAX(net_wpm) AS best FROM scores WHERE board = ? GROUP BY name_key)
     WHERE best > ? AND name_key != ?`,
  ).bind(key, netWpm, checkedName.key).first('n');
  const personalBest = await db.prepare('SELECT MAX(net_wpm) AS best FROM scores WHERE board = ? AND name_key = ?')
    .bind(key, checkedName.key).first('best');

  return json({
    board: presetId,
    mode,
    boardName: boardName(presetId, mode),
    netWpm,
    personalBest,
    position: ahead + 1,
    entries: await topScores(db, key, 'all'),
  }, 201);
}
