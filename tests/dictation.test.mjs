import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPassage, createDictator, screenReaderDuration, speakableText, utterance } from '../site/assets/js/dictation.js';
import { tokenize } from '../site/assets/js/scoring.js';
import { resolveConfig } from '../site/assets/js/presets.js';

const parts = (words, chunks) => chunks.map((c) => words.slice(c.start, c.end).join(' '));

test('splits a passage into sentences', () => {
  const words = tokenize('India is large. It has many states! Is it diverse? Yes.');
  assert.deepEqual(parts(words, chunkPassage(words)), ['India is large.', 'It has many states!', 'Is it diverse?', 'Yes.']);
});

test('treats the Hindi purna viram and closing quotes as sentence ends', () => {
  const words = tokenize('भारत विशाल है। यह “सुंदर देश” है।');
  assert.deepEqual(parts(words, chunkPassage(words)), ['भारत विशाल है।', 'यह “सुंदर देश” है।']);
  const quoted = tokenize('He said “stop.” Then left.');
  assert.deepEqual(parts(quoted, chunkPassage(quoted)), ['He said “stop.”', 'Then left.']);
});

test('caps very long sentences and keeps a trailing fragment', () => {
  const words = Array.from({ length: 70 }, (_, i) => `w${i}`);
  const chunks = chunkPassage(words, { max: 30 });
  assert.deepEqual(chunks.map((c) => c.end - c.start), [30, 30, 10]);
});

test('splits into fixed-size parts', () => {
  const words = tokenize('a b c d e f g h i j');
  assert.deepEqual(parts(words, chunkPassage(words, { unit: 'words', size: 4 })), ['a b c d', 'e f g h', 'i j']);
});

test('covers every word exactly once', () => {
  const words = tokenize('One. Two three, four. Five six seven eight nine ten eleven.');
  for (const opts of [{}, { unit: 'words', size: 3 }]) {
    const chunks = chunkPassage(words, opts);
    assert.equal(chunks[0].start, 0);
    assert.equal(chunks.at(-1).end, words.length);
    chunks.slice(1).forEach((c, i) => assert.equal(c.start, chunks[i].end));
  }
});

test('names punctuation only when asked', () => {
  const words = tokenize('Yes, the (new) rule applies.');
  assert.equal(speakableText(words, 'en'), 'Yes, the (new) rule applies.');
  assert.equal(
    speakableText(words, 'en', true),
    'Yes comma the open bracket new close bracket rule applies full stop',
  );
  assert.equal(speakableText(tokenize("don't low-cost 1,500"), 'en', true), "don't low-cost 1,500");
  assert.equal(speakableText(tokenize('भारत, देश है।'), 'hi', true), 'भारत अल्पविराम देश है पूर्ण विराम');
});

const OPTIONS = { unit: 'sentence', size: 8, lead: 1, idleAction: 'repeat', idleSeconds: 5, punctuation: false, rate: 1, voiceURI: '' };
const WORDS = tokenize('One two three. Four five six. Seven eight nine.');

test('screen reader output announces parts one at a time and never uses the device voice', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.speechSynthesis = { speak: () => assert.fail('device voice used'), cancel() {} };
  t.after(() => delete globalThis.speechSynthesis);

  const heard = [];
  const d = createDictator({ words: WORDS, lang: 'en', options: { ...OPTIONS, output: 'screenreader' }, announce: (s) => heard.push(s) });
  d.start();
  assert.deepEqual(heard, ['One two three.']);

  d.progress(2); // within one word of the end: the next part is queued, not announced over the first
  assert.deepEqual(heard, ['One two three.']);
  t.mock.timers.tick(screenReaderDuration('One two three.'));
  assert.deepEqual(heard, ['One two three.', 'Four five six.']);

  t.mock.timers.tick(screenReaderDuration('Four five six.')); // finished reading; idle timer starts
  t.mock.timers.tick(OPTIONS.idleSeconds * 1000);
  assert.equal(heard.at(-1), 'One two three.', 'idle repeats the part the typist is in');
  d.stop();
  t.mock.timers.tick(60000);
  assert.equal(heard.length, 3);
});

test('device voice output never sends text to the screen reader', (t) => {
  const spoken = [];
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.speechSynthesis = { speak: (u) => { spoken.push(u.text); u.onstart?.(); }, cancel() {} };
  t.after(() => { delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance; });

  const d = createDictator({
    words: WORDS, lang: 'en', options: { ...OPTIONS, output: 'voice', idleAction: 'off' },
    announce: () => assert.fail('screen reader used'),
  });
  d.start();
  d.progress(4); // brings in part two only
  d.repeat(); // the typist is in part two
  assert.deepEqual(spoken, ['One two three.', 'Four five six.', 'Four five six.']);
  d.stop();
});

test('repeat before the dictation has started reads the first part once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const heard = [];
  const d = createDictator({ words: WORDS, lang: 'en', options: { ...OPTIONS, output: 'screenreader' }, announce: (s) => heard.push(s) });
  d.repeat();
  d.start();
  assert.deepEqual(heard, ['One two three.']);
  d.stop();
});

test('by default the next part waits until every word of the current part is typed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const heard = [];
  const d = createDictator({
    words: WORDS, lang: 'en', options: { ...OPTIONS, lead: 0, idleAction: 'off', output: 'screenreader' },
    announce: (s) => heard.push(s),
  });
  d.start();
  t.mock.timers.tick(10000); // the first part has been read
  d.progress(2); // "One two" typed, "three." still to go
  t.mock.timers.tick(10000);
  assert.deepEqual(heard, ['One two three.'], 'nothing new while the part is unfinished');
  d.progress(3); // "three." finished
  assert.deepEqual(heard, ['One two three.', 'Four five six.']);
  d.stop();
});

test('the early-reading option is off unless chosen, and then reads ahead by the chosen words', () => {
  const base = { presetId: 'chsl-en', dictation: 'voice', dictationLead: 3 };
  assert.equal(resolveConfig(base).dictation.lead, 0);
  assert.equal(resolveConfig(base).dictation.early, false);
  assert.equal(resolveConfig({ ...base, dictationEarly: true }).dictation.lead, 3);
  assert.equal(resolveConfig({ ...base, dictationEarly: true, dictationLead: 0 }).dictation.lead, 2, 'early needs at least one word');
});

test('the chosen voice is used with its own language, so browsers do not swap it for another', (t) => {
  const voices = [
    { name: 'Heera', lang: 'en-IN', voiceURI: 'heera' },
    { name: 'George', lang: 'en-GB', voiceURI: 'george' },
    { name: 'Kalpana', lang: 'hi-IN', voiceURI: 'kalpana' },
  ];
  globalThis.window = globalThis;
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.speechSynthesis = { getVoices: () => voices, speak() {}, cancel() {} };
  t.after(() => { delete globalThis.window; delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance; });

  const uk = utterance('Hello', { lang: 'en', voiceURI: 'george', rate: 1 });
  assert.equal(uk.voice.name, 'George');
  assert.equal(uk.lang, 'en-GB', 'not en-IN, which would make the browser pick an Indian voice instead');
  const fallback = utterance('Hello', { lang: 'en', voiceURI: 'gone', rate: 1 });
  assert.equal(fallback.voice.name, 'Heera', 'a voice that no longer exists falls back to the first English one');
  assert.equal(fallback.lang, 'en-IN');
  globalThis.speechSynthesis.getVoices = () => [];
  assert.equal(utterance('नमस्ते', { lang: 'hi', voiceURI: '', rate: 1 }).lang, 'hi-IN', 'no voices: language only');
});
