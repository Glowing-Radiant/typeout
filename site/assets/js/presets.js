// Exam patterns. Figures follow recent SSC notices; candidates should always confirm them against the
// notice for their own exam, which is why every value can be overridden with the Custom pattern.

export const PRESETS = [
  {
    id: 'chsl-en',
    name: 'SSC CHSL – English',
    short: 'CHSL English',
    lang: 'en',
    minutes: 10,
    targetWpm: 35,
    note: '35 words per minute, about 10,500 key depressions per hour.',
  },
  {
    id: 'chsl-hi',
    name: 'SSC CHSL – Hindi',
    short: 'CHSL Hindi',
    lang: 'hi',
    minutes: 10,
    targetWpm: 30,
    note: '30 words per minute, about 9,000 key depressions per hour.',
  },
  {
    id: 'cgl-dest',
    name: 'SSC CGL – DEST',
    short: 'CGL DEST',
    lang: 'en',
    minutes: 15,
    targetKeys: 2000,
    note: 'Data Entry Speed Test: 2,000 key depressions in 15 minutes (8,000 per hour).',
  },
  {
    id: 'quick',
    name: 'Quick drill',
    short: 'Quick drill',
    lang: null, // chosen by the candidate
    minutes: 2,
    targetWpm: 35,
    note: 'A two-minute warm-up at CHSL speed.',
  },
  {
    id: 'custom',
    name: 'Custom',
    short: 'Custom',
    lang: null,
    minutes: null,
    targetWpm: null,
    note: 'Choose your own duration, language and target speed.',
  },
];

export const ERROR_LIMITS = [
  { id: 'ur', label: 'Unreserved (UR)', percent: 7 },
  { id: 'reserved', label: 'OBC, EWS, SC, ST, ESM, PwBD', percent: 10 },
  { id: 'custom', label: 'Custom limit', percent: null },
];

/** Compensatory time for eligible PwBD candidates: 20 minutes for every hour of examination. */
export const COMPENSATORY_FACTOR = 1 + 20 / 60;

export const LANG_LABEL = { en: 'English', hi: 'Hindi' };

export function findPreset(id) {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/**
 * Turn the setup form values into a concrete test configuration.
 * @param {object} s setup values (see DEFAULT_SETUP in storage.js)
 */
export function resolveConfig(s) {
  const preset = findPreset(s.presetId);
  const lang = preset.lang ?? s.lang;
  const minutes = preset.minutes ?? clamp(Number(s.customMinutes) || 10, 1, 60);
  const targetWpm = preset.targetKeys ? null : (preset.targetWpm ?? clamp(Number(s.customWpm) || 35, 5, 150));
  const targetKeys = preset.targetKeys ?? Math.round(targetWpm * 5 * minutes);
  const limit = ERROR_LIMITS.find((l) => l.id === s.errorLimitId) ?? ERROR_LIMITS[0];
  const maxErrorPercent = limit.percent ?? clamp(Number(s.customErrorPercent) || 7, 0, 100);
  const durationMs = Math.round(minutes * 60000 * (s.compensatoryTime ? COMPENSATORY_FACTOR : 1));
  return {
    presetId: preset.id,
    presetName: preset.name,
    presetShort: preset.short,
    lang,
    minutes,
    durationMs,
    targetWpm,
    targetKeys,
    maxErrorPercent,
    mode: s.mode === 'practice' ? 'practice' : 'exam',
    backspace: Boolean(s.backspace),
    startOnType: Boolean(s.startOnType),
    compensatoryTime: Boolean(s.compensatoryTime),
  };
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
