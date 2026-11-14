import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from '../scripts/dev-d1.mjs';
import { handlePassage, handleScoresGet, handleScoresPost, resetSchemaCache } from '../server/api.js';
import { cleanExtract, cleanParagraph } from '../server/wikipedia.js';
import { cleanName, eligibility } from '../site/assets/js/leaderboard.js';
import { findPassage, PASSAGES } from '../site/assets/js/passages.js';
import { evaluate } from '../site/assets/js/scoring.js';

// The database tests need Node's built-in SQLite (Node 22.13+); older Node skips them.
const probe = await createD1();
const skip = probe ? false : 'node:sqlite is not available in this Node version';
probe?.close();

async function freshEnv() {
  resetSchemaCache();
  return { DB: await createD1() };
}

const post = (env, body, ip = '203.0.113.7') =>
  handleScoresPost(new Request('http://x/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  }), env);

const get = (env, query) => handleScoresGet(new Request(`http://x/api/scores?${query}`), env);

const builtIn = PASSAGES.find((p) => p.lang === 'en');
const words = builtIn.text.split(/\s+/u);

/** A believable CHSL English attempt: the whole passage, one wrong word, at about 150 WPM gross. */
function attempt(overrides = {}) {
  const typed = words.map((w, i) => (i === 3 ? `${w}x` : w)).join(' ');
  return {
    name: 'Asha',
    presetId: 'chsl-en',
    mode: 'exam',
    compensatoryTime: false,
    passageId: builtIn.id,
    typed,
    elapsedMs: (typed.length / 5 / 150) * 60000,
    byTimer: false,
    keystrokes: typed.length + 4,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ rules */

test('cleanName tidies names and refuses bad ones', () => {
  assert.deepEqual(cleanName('  Asha   Rani '), { name: 'Asha Rani', key: 'asharani' });
  assert.equal(cleanName('आशा').name, 'आशा');
  assert.equal(cleanName('A‮sha').name, 'Asha', 'direction overrides are removed');
  assert.ok(cleanName('a').error);
  assert.ok(cleanName('x'.repeat(25)).error);
  assert.ok(cleanName('12345').error, 'needs a letter');
  assert.ok(cleanName('<script>').error);
  assert.ok(cleanName('Big F.u.c.k').error);
  assert.equal(cleanName('Randi Sharma').error, undefined, 'ordinary names are not caught by the word filter');
});

test('eligibility follows the scoreboard rules', () => {
  const base = { presetId: 'chsl-en', mode: 'exam', passageId: builtIn.id, passageLang: 'en', byTimer: true, compensatoryTime: false };
  const typed = words.slice(0, 400).join(' ');
  const result = evaluate({ passage: builtIn.text, typed, elapsedMs: 600000, endedByTimer: true });
  assert.equal(eligibility({ ...base, result }).ok, true);
  assert.equal(eligibility({ ...base, mode: 'practice', result }).ok, true, 'Practice has its own scoreboard');
  assert.equal(eligibility({ ...base, mode: 'turbo', result }).ok, false);
  assert.equal(eligibility({ ...base, presetId: 'custom', result }).ok, false);
  assert.equal(eligibility({ ...base, passageId: 'own', result }).ok, false);
  assert.equal(eligibility({ ...base, passageLang: 'hi', result }).ok, false);
  const early = evaluate({ passage: builtIn.text, typed, elapsedMs: 300000 });
  assert.match(eligibility({ ...base, byTimer: false, result: early }).reason, /time runs out or you reach the end/);
  const slow = evaluate({ passage: builtIn.text, typed: words.slice(0, 100).join(' '), elapsedMs: 600000, endedByTimer: true });
  assert.match(eligibility({ ...base, result: slow }).reason, /target speed/);
  const sloppy = evaluate({ passage: builtIn.text, typed: words.slice(0, 400).map((w, i) => (i % 5 ? w : 'zzz')).join(' '), elapsedMs: 600000, endedByTimer: true });
  assert.match(eligibility({ ...base, result: sloppy }).reason, /10% errors/);
  assert.equal(eligibility({ ...base, compensatoryTime: true, result: { ...result, elapsedMs: 800000 } }).ok, true);
  assert.equal(eligibility({ ...base, result: { ...result, elapsedMs: 700000 } }).ok, false);
});

/* ------------------------------------------------------------------ passage cleaning */

test('cleanParagraph removes asides and refuses lists, formulas and figures', () => {
  const p = cleanParagraph(
    'The Ganga (Hindi: गंगा) is a river [1] — one of the longest in Asia — and its basin supports “hundreds of millions” of people who depend on it for water, farming, fishing and transport across several states.',
    'en',
  );
  assert.equal(p, 'The Ganga is a river, one of the longest in Asia, and its basin supports "hundreds of millions" of people who depend on it for water, farming, fishing and transport across several states.');
  assert.equal(cleanParagraph('Café culture spread across Europe during the eighteenth century, and coffee houses became places where merchants, writers and politicians met to read newspapers and argue.', 'en').slice(0, 4), 'Cafe');
  assert.equal(cleanParagraph('Population: 1,234,567 (2011), 2,345,678 (2021), growth 3.4%, density 456 per km2, literacy 78.9%, sex ratio 940, and 12 tehsils in 3 divisions with 1,234 villages.', 'en'), null);
  assert.equal(cleanParagraph('The energy is given by {\\displaystyle E=mc^{2}} for a body at rest, which is one of the most famous results of physics and is widely known.', 'en'), null);
  assert.equal(cleanParagraph('List of rivers', 'en'), null);
  assert.equal(cleanParagraph('गंगा भारत की सबसे महत्वपूर्ण नदी है और यह करोड़ों लोगों के जीवन का आधार है। इसके किनारे अनेक प्राचीन नगर बसे हैं और यह कृषि के लिए जल देती है।', 'hi').endsWith('है।'), true);
  assert.equal(cleanParagraph('गंगा (Ganges) भारत की सबसे महत्वपूर्ण नदी है और यह करोड़ों लोगों के जीवन का आधार है। इसके किनारे अनेक नगर बसे हैं और यह जल देती है।', 'hi').includes('Ganges'), false);
  assert.equal(cleanParagraph('गंगा Ganges भारत की सबसे महत्वपूर्ण नदी है और यह करोड़ों लोगों के जीवन का आधार है। इसके किनारे अनेक नगर बसे हैं और यह जल देती है।', 'hi'), null);
});

test('cleanExtract keeps 300 to 800 words of prose and stops at reference sections', () => {
  const sentence = 'Rivers carry water from the hills to the plains and support farming, fishing and the towns along their banks.';
  const para = Array(6).fill(sentence).join(' '); // 114 words
  const extract = [para, '== History ==', para, para, '== See also ==', para, para, para].join('\n');
  const text = cleanExtract(extract, 'en');
  assert.equal(text.split('\n\n').length, 3, 'stops at See also');
  assert.equal(cleanExtract(para, 'en'), null, 'too short');
  const long = cleanExtract(Array(12).fill(para).join('\n'), 'en');
  const n = long.split(/\s+/u).length;
  assert.ok(n >= 600 && n <= 800, `${n} words`);
});

/* ------------------------------------------------------------------ API */

test('scoreboard without a database says it is not set up', async () => {
  resetSchemaCache();
  const res = await get({}, 'board=chsl-en');
  assert.equal(res.status, 503);
});

test('a shared attempt is re-marked, saved and ranked', { skip }, async () => {
  const env = await freshEnv();
  const res = await post(env, attempt());
  assert.equal(res.status, 201, await res.clone().text());
  const body = await res.json();
  const expected = evaluate({ passage: builtIn.text, typed: attempt().typed, elapsedMs: attempt().elapsedMs });
  assert.equal(body.netWpm, Math.round(expected.netWpm * 10) / 10);
  assert.equal(body.position, 1);
  assert.equal(body.entries.length, 1);
  assert.equal(body.entries[0].name, 'Asha');

  // A client-side figure is ignored: the server only uses the typed text.
  const forged = await post(env, { ...attempt({ name: 'Ravi' }), netWpm: 999 });
  assert.equal((await forged.json()).netWpm, body.netWpm);
});

test('each name shows once, with its best score, highest first', { skip }, async () => {
  const env = await freshEnv();
  const slower = attempt().elapsedMs * 1.3;
  assert.equal((await post(env, attempt({ name: 'Asha', elapsedMs: slower }))).status, 201);
  assert.equal((await post(env, attempt({ name: 'asha ' }))).status, 201, 'same name, better score');
  assert.equal((await post(env, attempt({ name: 'Ravi', elapsedMs: slower * 1.1 }), '198.51.100.2')).status, 201);
  const { entries } = await (await get(env, 'board=chsl-en&period=all')).json();
  assert.deepEqual(entries.map((e) => [e.rank, e.name]), [[1, 'asha'], [2, 'Ravi']]);
  assert.ok(entries[0].netWpm > entries[1].netWpm);
  const week = await (await get(env, 'board=chsl-en&period=week')).json();
  assert.equal(week.entries.length, 2);
  assert.equal((await (await get(env, 'board=cgl-dest')).json()).entries.length, 0);
});

test('attempts that break the rules are refused with a reason', { skip }, async () => {
  const env = await freshEnv();
  const cases = [
    [{ name: 'x' }, 400, /2 to 24/],
    [{ presetId: 'custom' }, 400, /no scoreboard/],
    [{ passageId: 'own' }, 400, /cannot be checked/],
    [{ passageId: 'wiki-en-1-2' }, 400, /cannot be checked/],
    [{ mode: 'turbo' }, 422, /Exam simulation and Practice/],
    [{ typed: words.slice(0, 50).join(' ') }, 422, /time runs out/],
    [{ elapsedMs: 30000 }, 422, /shorter than a minute|too high/],
    [{ elapsedMs: 300000, byTimer: true }, 400, /does not match/],
    [{ keystrokes: 10 }, 422, /key presses/],
    [{ presetId: 'chsl-hi' }, 422, /language/],
  ];
  for (const [change, status, message] of cases) {
    const res = await post(env, attempt(change));
    const body = await res.json();
    assert.equal(res.status, status, `${JSON.stringify(change)} → ${body.error}`);
    assert.match(body.error, message);
  }
  const res = await handleScoresPost(new Request('http://x/api/scores', { method: 'POST', body: '{nope' }), env);
  assert.equal(res.status, 400);
});

test('sharing is limited per visitor per hour', { skip }, async () => {
  const env = await freshEnv();
  for (let i = 0; i < 6; i++) assert.equal((await post(env, attempt({ name: `Name ${'abcdef'[i]}` }))).status, 201);
  const res = await post(env, attempt({ name: 'Another' }));
  assert.equal(res.status, 429);
  assert.equal((await post(env, attempt({ name: 'Another' }), '192.0.2.99')).status, 201, 'other visitors are unaffected');
});

test('online passages are stored so scores on them can be checked', { skip }, async () => {
  const env = await freshEnv();
  const sentence = 'Forests protect the soil, store rain water and give shelter to many kinds of birds, animals and plants.';
  const extract = Array(8).fill(Array(6).fill(sentence).join(' ')).join('\n');
  const fakeFetch = async (url) => {
    const u = new URL(url);
    const body = u.searchParams.get('list') === 'search'
      ? { query: { search: [{ pageid: 42, title: 'Forest', size: 50000 }] } }
      : { query: { pages: [{ pageid: 42, lastrevid: 7, title: 'Forest', fullurl: 'https://en.wikipedia.org/wiki/Forest', extract }] } };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  const res = await handlePassage(new Request('http://x/api/passage?lang=en'), env, { fetch: fakeFetch });
  assert.equal(res.status, 200);
  const { passage } = await res.json();
  assert.equal(passage.id, 'wiki-en-42-7');
  assert.equal(passage.source.license, 'CC BY-SA 4.0');

  const typed = passage.text.split(/\s+/u).join(' ');
  const shared = await post(env, attempt({ passageId: passage.id, typed, elapsedMs: (typed.length / 5 / 150) * 60000, keystrokes: typed.length }));
  assert.equal(shared.status, 201, await shared.clone().text());

  // Wikipedia unreachable: an earlier passage is handed out instead.
  const offline = await handlePassage(new Request('http://x/api/passage?lang=en'), env, { fetch: async () => { throw new Error('down'); } });
  assert.equal((await offline.json()).passage.id, 'wiki-en-42-7');
  const none = await handlePassage(new Request('http://x/api/passage?lang=hi'), env, { fetch: async () => { throw new Error('down'); } });
  assert.equal(none.status, 503);
  assert.equal((await handlePassage(new Request('http://x/api/passage?lang=fr'), env)).status, 400);
});

test('built-in passages can be found by the server', () => {
  assert.equal(findPassage(builtIn.id).text, builtIn.text);
});

test('the Worker sends /api/* to the API and everything else to static assets', { skip }, async () => {
  const { default: worker } = await import('../server/worker.js');
  const env = await freshEnv();
  const served = [];
  env.ASSETS = { fetch: async (req) => { served.push(new URL(req.url).pathname); return new Response('asset'); } };
  const scores = await worker.fetch(new Request('http://x/api/scores?board=chsl-en'), env);
  assert.equal(scores.status, 200);
  assert.deepEqual((await scores.json()).entries, []);
  assert.equal((await worker.fetch(new Request('http://x/api/nope'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('http://x/api/scores', { method: 'DELETE' }), env)).status, 404);
  assert.equal(await (await worker.fetch(new Request('http://x/index.html'), env)).text(), 'asset');
  assert.deepEqual(served, ['/index.html']);
});

test('Practice and Exam simulation scores go on separate scoreboards', { skip }, async () => {
  const env = await freshEnv();
  assert.equal((await post(env, attempt({ name: 'Asha' }))).status, 201);
  const practice = await post(env, attempt({ name: 'Ravi', mode: 'practice' }), '198.51.100.2');
  assert.equal(practice.status, 201);
  const shared = await practice.json();
  assert.equal(shared.boardName, 'SSC CHSL – English (Practice)');
  assert.equal(shared.position, 1, 'ranked among Practice scores only');

  const exam = await (await get(env, 'board=chsl-en&mode=exam')).json();
  const practiceBoard = await (await get(env, 'board=chsl-en&mode=practice')).json();
  const defaultBoard = await (await get(env, 'board=chsl-en')).json();
  assert.deepEqual(exam.entries.map((e) => e.name), ['Asha']);
  assert.deepEqual(practiceBoard.entries.map((e) => e.name), ['Ravi']);
  assert.deepEqual(defaultBoard.entries.map((e) => e.name), ['Asha'], 'no mode means Exam simulation');
  assert.equal((await get(env, 'board=chsl-en&mode=turbo')).status, 400);
});

test('the Quick drill has a scoreboard for each language', { skip }, async () => {
  const env = await freshEnv();
  const hindi = PASSAGES.find((p) => p.lang === 'hi');
  const drill = (passage, extra = {}) => {
    const typed = passage.text.split(/\s+/u).slice(0, 220).join(' ');
    return attempt({ presetId: 'quick', passageId: passage.id, typed, elapsedMs: 120000, byTimer: true, keystrokes: typed.length, ...extra });
  };
  const en = await post(env, drill(builtIn, { name: 'Asha' }));
  assert.equal(en.status, 201, await en.clone().text());
  assert.equal((await en.json()).boardName, 'Quick drill – English');
  const hi = await post(env, drill(hindi, { name: 'Ravi' }), '198.51.100.2');
  assert.equal(hi.status, 201, await hi.clone().text());
  assert.equal((await hi.json()).boardName, 'Quick drill – Hindi');
  const practice = await post(env, drill(hindi, { name: 'Meena', mode: 'practice' }), '198.51.100.3');
  assert.equal((await practice.json()).boardName, 'Quick drill – Hindi (Practice)');

  const names = async (q) => (await (await get(env, q)).json()).entries.map((e) => e.name);
  assert.deepEqual(await names('board=quick-en'), ['Asha']);
  assert.deepEqual(await names('board=quick-hi'), ['Ravi']);
  assert.deepEqual(await names('board=quick-hi&mode=practice'), ['Meena']);
  assert.deepEqual(await names('board=chsl-en'), [], 'drills stay off the CHSL board');
  assert.equal((await get(env, 'board=quick')).status, 400);
});

test('Quick drill attempts follow the same rules as the exam patterns', () => {
  const typed = words.slice(0, 220).join(' ');
  const result = evaluate({ passage: builtIn.text, typed, elapsedMs: 120000, endedByTimer: true });
  const base = { presetId: 'quick', mode: 'exam', passageId: builtIn.id, passageLang: 'en', byTimer: true, compensatoryTime: false };
  assert.equal(eligibility({ ...base, result }).ok, true);
  assert.equal(eligibility({ ...base, passageLang: 'hi', result }).ok, true, 'either language');
  const short = evaluate({ passage: builtIn.text, typed: words.slice(0, 40).join(' '), elapsedMs: 120000, endedByTimer: true });
  assert.match(eligibility({ ...base, result: short }).reason, /target speed/);
  assert.match(eligibility({ ...base, presetId: 'custom', result }).reason, /Quick drill/);
});
