// Talking to the Type Out API: online passages and the shared scoreboard.
//
// Online passages are fetched ahead of time and kept in localStorage (a couple per language), so a test
// starts at once and still works offline for a while. When nothing is available, callers fall back to
// the built-in passages.

const KEY_QUEUE = 'typeout:online-passages:v1';
const QUEUE_SIZE = 2;
const TIMEOUT_MS = 10000;

// Set when the API is not there at all (an older static host, or a dev server without it), so the
// page stops asking until it is reloaded.
let apiMissing = false;
const filling = new Map();

function readQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(KEY_QUEUE) || '{}');
    return { en: Array.isArray(q.en) ? q.en : [], hi: Array.isArray(q.hi) ? q.hi : [] };
  } catch {
    return { en: [], hi: [] };
  }
}

function writeQueue(q) {
  try {
    localStorage.setItem(KEY_QUEUE, JSON.stringify(q));
  } catch {
    // Storage full or blocked: passages are simply fetched when needed.
  }
}

const isPassage = (p) =>
  p && typeof p.id === 'string' && typeof p.title === 'string' && typeof p.text === 'string' && p.source?.url;

async function request(path, options = {}) {
  const res = await fetch(path, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 404 && !body) apiMissing = true;
  if (!res.ok) {
    const err = new Error(body?.error || 'The server could not be reached. Check your connection and try again.');
    err.status = res.status;
    throw err;
  }
  return body;
}

// After a failed fetch, background top-ups wait a minute, so changing the set-up form does not keep
// sending requests while offline or while the server has no passage to give.
let quietUntil = 0;

async function fetchPassage(lang, { background = false } = {}) {
  if (apiMissing || !navigator.onLine || (background && Date.now() < quietUntil)) return null;
  try {
    const { passage } = await request(`api/passage?lang=${lang}`);
    if (isPassage(passage) && passage.lang === lang) return passage;
  } catch {
    // fall through
  }
  quietUntil = Date.now() + 60000;
  return null;
}

/** Top up the stored passages for a language in the background. */
export function prefetchPassages(lang) {
  if (filling.has(lang)) return filling.get(lang);
  const job = (async () => {
    for (let tries = 0; tries < QUEUE_SIZE; tries++) {
      if (readQueue()[lang].length >= QUEUE_SIZE) break;
      const p = await fetchPassage(lang, { background: true });
      if (!p) break;
      const q = readQueue();
      if (!q[lang].some((x) => x.id === p.id)) q[lang].push(p);
      writeQueue(q);
    }
  })().finally(() => filling.delete(lang));
  filling.set(lang, job);
  return job;
}

/**
 * A new online passage: a stored one if there is one (and fetch a replacement), otherwise fetched now.
 * @returns {Promise<object|null>} null when none could be had
 */
export async function takeOnlinePassage(lang, { avoid } = {}) {
  const q = readQueue();
  const index = q[lang].findIndex((p) => isPassage(p) && p.id !== avoid);
  if (index >= 0) {
    const [passage] = q[lang].splice(index, 1);
    writeQueue(q);
    prefetchPassages(lang);
    return passage;
  }
  const passage = await fetchPassage(lang);
  prefetchPassages(lang);
  return passage;
}

export const isOnlinePassage = (p) => Boolean(p?.source) && String(p.id).startsWith('wiki-');

/** @returns {Promise<{entries: object[]}>} */
export function fetchScoreboard(board, mode, period) {
  const q = new URLSearchParams({ board, mode, period });
  return request(`api/scores?${q}`);
}

/** Share an attempt. Rejects with an Error whose message can be shown as it is. */
export function shareScore(payload) {
  return request('api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
