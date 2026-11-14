// Dictation: reads the passage aloud in parts, either with the device's speech voice or through the
// candidate's screen reader (never both). Each part is read once the part before it is fully typed
// (lead 0), or, if the candidate prefers, a few words before the end (lead > 0). An idle timer repeats
// the current part, or moves on, when typing stops.
// The pure helpers (chunkPassage, speakableText) have no DOM access so the Node tests can use them.

const ENDS_SENTENCE = /[.?!।]["'”’)]*$/u;

/**
 * Split passage words into the parts that are read aloud.
 * @param {string[]} words
 * @param {{unit?: 'sentence'|'words', size?: number, max?: number}} options
 *   max caps a very long sentence so no single part runs on for too long
 * @returns {{start: number, end: number}[]} word index ranges, end exclusive
 */
export function chunkPassage(words, { unit = 'sentence', size = 8, max = 30 } = {}) {
  const chunks = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const length = i - start + 1;
    const last = unit === 'words' ? length >= size : ENDS_SENTENCE.test(words[i]) || length >= max;
    if (last || i === words.length - 1) {
      chunks.push({ start, end: i + 1 });
      start = i + 1;
    }
  }
  return chunks;
}

const MARK_NAMES = {
  en: {
    ',': 'comma', '.': 'full stop', '।': 'full stop', ';': 'semicolon', ':': 'colon', '?': 'question mark',
    '!': 'exclamation mark', '-': 'hyphen', '–': 'dash', '—': 'dash', '(': 'open bracket', ')': 'close bracket',
    '"': 'quote', '“': 'open quote', '”': 'close quote', '‘': 'open quote', '’': 'close quote',
  },
  hi: {
    ',': 'अल्पविराम', '।': 'पूर्ण विराम', '.': 'बिंदु', ';': 'अर्धविराम', ':': 'कोलन', '?': 'प्रश्नवाचक चिह्न',
    '!': 'विस्मयादिबोधक चिह्न', '-': 'योजक चिह्न', '–': 'डैश', '—': 'डैश', '(': 'कोष्ठक खुला', ')': 'कोष्ठक बंद',
    '"': 'उद्धरण चिह्न', '“': 'उद्धरण चिह्न', '”': 'उद्धरण चिह्न',
  },
};

/** The text to speak for some passage words, optionally naming punctuation as dictators do. */
export function speakableText(words, lang, sayPunctuation = false) {
  if (!sayPunctuation) return words.join(' ');
  const names = MARK_NAMES[lang] ?? MARK_NAMES.en;
  const say = (marks) => Array.from(marks).map((c) => names[c]).filter(Boolean);
  return words
    .map((word) => {
      const [, lead, core, trail] = word.match(/^([\p{P}\p{S}]*)(.*?)([\p{P}\p{S}]*)$/u);
      return [...say(lead), core, ...say(trail)].filter(Boolean).join(' ');
    })
    .join(' ');
}

export const speechSupported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** Voices for a passage language, Indian English or Hindi voices first. */
export function voicesFor(lang) {
  if (!speechSupported()) return [];
  const prefix = lang === 'hi' ? 'hi' : 'en';
  const rank = (v) => (v.lang.toLowerCase().endsWith('-in') ? 0 : 1);
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith(prefix))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Browsers fill the voice list asynchronously; until then an empty list means "not known yet". */
export const voicesLoaded = () => speechSupported() && speechSynthesis.getVoices().length > 0;

export function onVoicesChanged(callback) {
  if (speechSupported()) speechSynthesis.addEventListener('voiceschanged', callback);
}

function utterance(text, { lang, voiceURI, rate }) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const voices = voicesFor(lang);
  const voice = voices.find((v) => v.voiceURI === voiceURI) ?? voices[0];
  if (voice) u.voice = voice;
  u.rate = rate;
  return u;
}

/** Play a short sample so the candidate can judge the voice and speed. */
export function previewVoice({ lang, voiceURI, rate }) {
  if (!speechSupported()) return;
  speechSynthesis.cancel();
  const text = lang === 'hi' ? 'श्रुतलेख इस आवाज़ और गति में पढ़ा जाएगा।' : 'Dictation will be read in this voice, at this speed.';
  speechSynthesis.speak(utterance(text, { lang, voiceURI, rate }));
}

/** Speaks through the device's speech engine only; nothing is sent to screen readers. */
function voiceSpeaker({ lang, voiceURI, rate }) {
  return {
    speak(text, { onstart, onend }) {
      const u = utterance(text, { lang, voiceURI, rate });
      u.onstart = onstart;
      u.onend = onend;
      u.onerror = onend;
      speechSynthesis.speak(u);
    },
    cancel() {
      speechSynthesis.cancel();
    },
  };
}

/**
 * Rough time a screen reader needs to read some text, in milliseconds. Screen readers do not report
 * when they finish, so parts are spaced by this estimate (about 160 words a minute, a little
 * slower than most screen-reader users listen).
 */
export function screenReaderDuration(text) {
  const words = text.split(/\s+/u).filter(Boolean).length;
  return 600 + words * 375;
}

/**
 * Hands each part to the screen reader through an assertive live region, one at a time. The device
 * voice is never used. Parts are queued here, because a new live-region message would cut off the
 * one the screen reader is still reading.
 */
function screenReaderSpeaker(announce) {
  const queue = [];
  let timer = 0;
  let busy = false;
  const next = () => {
    busy = false;
    const item = queue.shift();
    if (!item) return;
    busy = true;
    announce(item.text);
    item.onstart();
    timer = setTimeout(() => {
      item.onend();
      next();
    }, screenReaderDuration(item.text));
  };
  return {
    speak(text, { onstart, onend }) {
      queue.push({ text, onstart, onend });
      if (!busy) next();
    },
    cancel() {
      clearTimeout(timer);
      queue.length = 0;
      busy = false;
    },
  };
}

const MAX_IDLE_REPEATS = 3;

/**
 * @param {object} p
 * @param {string[]} p.words passage words
 * @param {'en'|'hi'} p.lang
 * @param {object} p.options dictation config from resolveConfig(); options.output is 'voice' or 'screenreader'
 * @param {(text: string) => void} [p.announce] sends text to the screen reader (screenreader output only)
 * @param {(state: {part: number, total: number, speaking: boolean, done: boolean}) => void} [p.onChange]
 */
export function createDictator({ words, lang, options, announce, onChange }) {
  const chunks = chunkPassage(words, { unit: options.unit, size: options.size });
  const total = chunks.length;
  const speaker = options.output === 'screenreader'
    ? screenReaderSpeaker(announce)
    : voiceSpeaker({ lang, voiceURI: options.voiceURI, rate: options.rate });
  let spoken = 0; // parts handed to the speaker
  let pending = 0; // parts of the current generation still queued or being read
  let generation = 0; // bumped on cancel, so callbacks from cancelled parts are ignored
  let typist = 0; // passage word index the candidate has reached
  let lastPart = 0;
  let idleTimer = 0;
  let idleRepeats = 0;
  let active = true;

  const partAt = (index) => {
    const i = chunks.findIndex((c) => index < c.end);
    return i === -1 ? total - 1 : i;
  };

  const report = (speaking) => onChange?.({ part: lastPart, total, speaking, done: !speaking && spoken >= total && typist >= words.length });

  const clearIdle = () => clearTimeout(idleTimer);
  const armIdle = () => {
    clearIdle();
    if (!active || options.idleAction === 'off') return;
    idleTimer = setTimeout(onIdle, options.idleSeconds * 1000);
  };

  function say(part) {
    const chunk = chunks[part];
    if (!chunk || !active) return;
    const gen = generation;
    const text = speakableText(words.slice(chunk.start, chunk.end), lang, options.punctuation);
    pending += 1;
    clearIdle();
    speaker.speak(text, {
      onstart: () => {
        if (gen !== generation) return;
        lastPart = part;
        report(true);
      },
      onend: () => {
        if (gen !== generation) return;
        pending = Math.max(0, pending - 1);
        if (!pending) {
          report(false);
          armIdle();
        }
      },
    });
  }

  function cancel() {
    generation += 1;
    pending = 0;
    speaker.cancel();
  }

  /** Read further parts while the candidate is within `lead` words of the end of what has been read. */
  function advance() {
    while (spoken < total && (spoken === 0 || typist >= chunks[spoken - 1].end - options.lead)) {
      say(spoken);
      spoken += 1;
    }
  }

  function onIdle() {
    if (!active) return;
    if (pending) return armIdle();
    if (options.idleAction === 'next') {
      if (spoken < total) {
        say(spoken);
        spoken += 1;
      }
    } else if (idleRepeats < MAX_IDLE_REPEATS) {
      idleRepeats += 1;
      say(partAt(typist));
    }
  }

  return {
    total,
    start() {
      advance();
      armIdle();
    },
    /** Call whenever the typed text changes, with the passage word index the candidate has reached. */
    progress(index) {
      typist = index;
      idleRepeats = 0;
      advance();
      if (!pending) armIdle();
    },
    repeat() {
      cancel();
      // Before the first part has been read, "repeat" just starts the dictation.
      if (spoken === 0) advance();
      else say(partAt(typist));
    },
    pause() {
      active = false;
      clearIdle();
      cancel();
    },
    resume() {
      active = true;
      say(partAt(typist));
    },
    stop() {
      active = false;
      clearIdle();
      cancel();
    },
  };
}
