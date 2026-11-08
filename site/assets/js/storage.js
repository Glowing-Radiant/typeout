// Everything Type Out remembers lives in this browser's localStorage. Storage can be unavailable
// (private windows, blocked site data), so every access is guarded and the app works without it.

const KEY_SETTINGS = 'typeout:settings:v1';
const KEY_SETUP = 'typeout:setup:v1';
const KEY_HISTORY = 'typeout:history:v1';
const HISTORY_LIMIT = 300;

export const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark | contrast
  textSize: 22, // px, passage and typing box
  lineHeight: 'relaxed', // normal | relaxed | spacious
  font: 'sans', // sans | serif | mono | wide
  reduceMotion: false,
  showLiveStats: true,
  announceTime: true,
  announceMistakes: false,
};

export const DEFAULT_SETUP = {
  presetId: 'chsl-en',
  lang: 'en',
  customMinutes: 10,
  customWpm: 35,
  mode: 'exam',
  passageId: 'random',
  ownPassage: '',
  backspace: true,
  startOnType: true,
  compensatoryTime: false,
  errorLimitId: 'ur',
  customErrorPercent: 7,
  dictation: 'off', // off | voice (device speech) | screenreader (live region, no device speech)
  dictationHide: false,
  dictationPunctuation: false,
  dictationUnit: 'sentence', // sentence | words
  dictationSize: 8, // words per part when dictationUnit is 'words'
  dictationLead: 2, // read the next part when this many words of the last part are left
  idleAction: 'repeat', // repeat | next | off
  idleSeconds: 6,
  voiceURI: '',
  speechRate: 1,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read(KEY_SETTINGS, {}) });
export const saveSettings = (s) => write(KEY_SETTINGS, s);

export function loadSetup() {
  const setup = { ...DEFAULT_SETUP, ...read(KEY_SETUP, {}) };
  // Dictation was an on/off switch for the device voice before the screen-reader option existed.
  if (typeof setup.dictation === 'boolean') setup.dictation = setup.dictation ? 'voice' : 'off';
  return setup;
}
export const saveSetup = (s) => write(KEY_SETUP, s);

export function loadHistory() {
  const h = read(KEY_HISTORY, []);
  return Array.isArray(h) ? h : [];
}

export function addHistory(entry) {
  const h = loadHistory();
  h.push(entry);
  return write(KEY_HISTORY, h.slice(-HISTORY_LIMIT));
}

export const clearHistory = () => write(KEY_HISTORY, []);
