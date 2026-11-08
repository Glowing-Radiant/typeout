import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, countKeys, compareWord, align, evaluate, qualify } from '../site/assets/js/scoring.js';

const kinds = (ops) => ops.map((o) => `${o.kind}:${o.type}`);

test('tokenize splits on any whitespace and drops empties', () => {
  assert.deepEqual(tokenize('  The  quick\nbrown\tfox '), ['The', 'quick', 'brown', 'fox']);
  assert.deepEqual(tokenize(''), []);
});

test('countKeys counts code points including spaces, ignoring trailing whitespace', () => {
  assert.equal(countKeys('ab cd '), 5);
  assert.equal(countKeys('भारत'), 4);
});

test('compareWord classifies differences', () => {
  assert.equal(compareWord('India', 'India'), 'match');
  assert.equal(compareWord('India', 'india'), 'capitalization');
  assert.equal(compareWord('India,', 'India'), 'punctuation');
  assert.equal(compareWord('India', 'Indai'), 'spelling');
  assert.equal(compareWord('भारत।', 'भारत'), 'punctuation');
});

test('perfect copy has no mistakes and untyped remainder is ignored', () => {
  const r = evaluate({ passage: 'one two three four five', typed: 'one two three', elapsedMs: 60000 });
  assert.equal(r.fullMistakes, 0);
  assert.equal(r.halfMistakes, 0);
  assert.equal(r.attemptedWords, 3);
  assert.equal(r.correctWords, 3);
  assert.equal(r.reachedEnd, false);
});

test('omission, addition and substitution are full mistakes', () => {
  const { ops } = align(tokenize('the cat sat on the mat'), tokenize('the sat on the big mat'));
  assert.deepEqual(kinds(ops), [
    'correct:match', 'full:omission', 'correct:match', 'correct:match', 'correct:match',
    'full:addition', 'correct:match',
  ]);
  const sub = align(tokenize('the cat sat'), tokenize('the cot sat')).ops;
  assert.deepEqual(kinds(sub), ['correct:match', 'full:spelling', 'correct:match']);
});

test('spacing, capitalisation, punctuation and transposition are half mistakes', () => {
  const merged = align(tokenize('in the house'), tokenize('in thehouse')).ops;
  assert.deepEqual(kinds(merged), ['correct:match', 'half:spacing']);

  const split = align(tokenize('a notebook here'), tokenize('a note book here')).ops;
  assert.deepEqual(kinds(split), ['correct:match', 'half:spacing', 'correct:match']);

  const swapped = align(tokenize('very good work'), tokenize('good very work')).ops;
  assert.deepEqual(kinds(swapped), ['half:transposition', 'correct:match']);

  const r = evaluate({ passage: 'Delhi is big, really.', typed: 'delhi is big really.', elapsedMs: 60000 });
  assert.equal(r.halfMistakes, 2);
  assert.equal(r.errors, 1);
  assert.equal(r.errorPercent, 25);
});

test('a skipped line is reported as omissions, not a cascade of substitutions', () => {
  const passage = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
  const typed = 'alpha beta zeta eta theta iota kappa';
  const r = evaluate({ passage, typed, elapsedMs: 60000 });
  assert.equal(r.fullMistakes, 3);
  assert.equal(r.correctWords, 7);
});

test('a word cut off by the timer is not a mistake', () => {
  const passage = 'the examination begins now';
  const cut = evaluate({ passage, typed: 'the exami', elapsedMs: 60000, endedByTimer: true });
  assert.equal(cut.fullMistakes, 0);
  assert.equal(cut.attemptedWords, 1);
  assert.equal(cut.ops.at(-1).kind, 'partial');

  const submitted = evaluate({ passage, typed: 'the exami', elapsedMs: 60000 });
  assert.equal(submitted.fullMistakes, 1);
});

test('speed figures follow the 5 key depressions per word convention', () => {
  const typed = 'abcd '.repeat(70).trim(); // 349 key depressions
  const r = evaluate({ passage: typed, typed, elapsedMs: 120000 });
  assert.equal(r.keyDepressions, 349);
  assert.ok(Math.abs(r.grossWpm - 34.9) < 1e-9);
  assert.equal(r.netWpm, r.grossWpm);
  assert.ok(Math.abs(r.kdph - 10470) < 1e-9);
});

test('qualify checks key depressions and error percentage', () => {
  const r = { keyDepressions: 1800, errorPercent: 6.5, attemptedWords: 300 };
  assert.deepEqual(qualify(r, { targetKeys: 1750, maxErrorPercent: 7 }), { speedOk: true, errorsOk: true, passed: true });
  assert.equal(qualify(r, { targetKeys: 2000, maxErrorPercent: 7 }).passed, false);
  assert.equal(qualify(r, { targetKeys: 1750, maxErrorPercent: 5 }).errorsOk, false);
});

test('alignment handles a long attempt quickly', () => {
  const words = Array.from({ length: 900 }, (_, i) => `word${i % 97}`);
  const passage = words.join(' ');
  const typed = words.filter((_, i) => i % 50 !== 0).join(' ');
  const t0 = performance.now();
  const r = evaluate({ passage, typed, elapsedMs: 900000 });
  assert.ok(performance.now() - t0 < 2000);
  assert.equal(r.fullMistakes, 18);
});
