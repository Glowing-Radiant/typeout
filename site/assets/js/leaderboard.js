// Scoreboard rules, shared by the page (to say up front whether an attempt can be shared) and the
// server (which re-marks every shared attempt and applies the same rules). Pure, no DOM access.
import { findPreset, resolveConfig } from './presets.js';

/** Exam patterns with a scoreboard, in display order. */
export const BOARDS = ['chsl-en', 'chsl-hi', 'cgl-dest'];

/**
 * Each pattern has one scoreboard per mode. Practice highlights the passage and allows pausing, so
 * its scores are kept apart from Exam simulation.
 */
export const MODES = { exam: 'Exam simulation', practice: 'Practice' };

/** The key a score is stored under: the pattern for Exam simulation, pattern + "-practice" for Practice. */
export const boardKey = (presetId, mode) => (mode === 'practice' ? `${presetId}-practice` : presetId);

/** The most lenient official error limit (reserved categories), so no candidate is left out. */
export const BOARD_MAX_ERROR_PERCENT = 10;

/** Faster than this over a full exam is not believable typing. */
export const MAX_GROSS_WPM = 200;

/** Shorter attempts give speeds that cannot be compared with a full test. */
export const MIN_ELAPSED_MS = 60000;

export const NAME_MIN = 2;
export const NAME_MAX = 24;

export const PERIODS = { all: 'All time', week: 'Last 7 days' };

export const boardName = (id, mode = 'exam') => `${findPreset(id).name}${mode === 'practice' ? ' (Practice)' : ''}`;

/** Time allowed for a scoreboard pattern, with or without compensatory time. */
export function boardDuration(presetId, compensatoryTime) {
  return resolveConfig({ presetId, compensatoryTime: Boolean(compensatoryTime) }).durationMs;
}

export function boardTargetKeys(presetId) {
  return resolveConfig({ presetId }).targetKeys;
}

/**
 * Can this attempt go on the scoreboard?
 * @param {object} a
 * @param {string} a.presetId
 * @param {string} a.mode exam | practice
 * @param {string} a.passageId
 * @param {string} a.passageLang
 * @param {boolean} a.byTimer the test ended because the time ran out
 * @param {boolean} a.compensatoryTime
 * @param {object} a.result output of evaluate()
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function eligibility({ presetId, mode, passageId, passageLang, byTimer, compensatoryTime, result }) {
  const no = (reason) => ({ ok: false, reason });
  if (!BOARDS.includes(presetId)) return no('Only SSC CHSL English, SSC CHSL Hindi and SSC CGL DEST attempts can be shared.');
  const preset = findPreset(presetId);
  if (!MODES[mode]) return no('Only Exam simulation and Practice attempts can be shared.');
  if (!passageId || passageId === 'own') return no('Attempts on your own passage cannot be shared, because the server cannot check them.');
  if (passageLang !== preset.lang) return no('The passage is not in the language of this exam pattern.');
  if (!result || result.typedWords === 0) return no('Nothing was typed.');
  if (!byTimer && !result.reachedEnd) return no('To share a score, keep typing until the time runs out or you reach the end of the passage.');
  if (result.elapsedMs < MIN_ELAPSED_MS) return no('The attempt was shorter than a minute.');
  if (result.elapsedMs > boardDuration(presetId, compensatoryTime) + 1000) return no('The attempt took longer than the time allowed.');
  if (result.keyDepressions < boardTargetKeys(presetId)) return no('Only attempts that reach the target speed can be shared.');
  if (result.errorPercent > BOARD_MAX_ERROR_PERCENT) {
    return no(`Only attempts with at most ${BOARD_MAX_ERROR_PERCENT}% errors can be shared.`);
  }
  if (result.grossWpm > MAX_GROSS_WPM) return no('This speed is too high to be checked.');
  return { ok: true };
}

// Words that are not allowed in a display name. Matched against the name with spaces, punctuation and
// letter case removed, so only entries unlikely to appear inside ordinary names are listed.
const BLOCKED = [
  'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'pussy', 'nigger', 'nigga', 'faggot', 'whore', 'slut',
  'chutiya', 'chutia', 'madarchod', 'bhenchod', 'behenchod', 'bhosdi', 'bhosri', 'gandu', 'harami',
  'चूतिया', 'चुतिया', 'मादरचोद', 'भेनचोद', 'बहनचोद', 'भोसड़ी', 'भोसडी', 'गांडू', 'गान्डू', 'रंडी', 'हरामी',
];

/**
 * Tidy a display name and check it.
 * @returns {{name: string, key: string} | {error: string}} key identifies the same name typed differently
 */
export function cleanName(raw) {
  const name = String(raw ?? '')
    .normalize('NFC')
    .replace(/[\p{C}]/gu, '') // control and formatting characters, including direction overrides
    .replace(/\s+/gu, ' ')
    .trim();
  const length = Array.from(name).length;
  if (length < NAME_MIN || length > NAME_MAX) return { error: `Use a name of ${NAME_MIN} to ${NAME_MAX} characters.` };
  if (!/^[\p{L}\p{M}\p{N} .'_-]+$/u.test(name)) {
    return { error: 'Use letters, numbers, spaces and . \' _ - only.' };
  }
  if (!/\p{L}/u.test(name)) return { error: 'The name needs at least one letter.' };
  const squashed = name.toLocaleLowerCase('en').replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  if (BLOCKED.some((w) => squashed.includes(w))) return { error: 'Please choose a different name.' };
  return { name, key: squashed };
}
