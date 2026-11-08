// Scoring engine for Type Out.
// Pure functions with no DOM access, so the browser app and the Node tests share one implementation.
//
// The typed text is aligned against the passage word by word (a weighted edit distance), and each
// difference is classified the way SSC skill-test evaluation describes it:
//   full mistakes  – omitted word, added word, wrong word / spelling
//   half mistakes  – spacing (two words joined or one word split), capitalisation, punctuation,
//                    transposition of two adjacent words
// Untyped passage text after the candidate's last word is not counted as omissions.

const PUNCT = /[\p{P}\p{S}]/gu;

const OP_NONE = 0;
const OP_SUB = 1; // passage word ↔ typed word (correct, half or full)
const OP_OMIT = 2; // passage word skipped
const OP_ADD = 3; // extra typed word
const OP_MERGE = 4; // two passage words typed without the space between them
const OP_SPLIT = 5; // one passage word typed with a space inside it
const OP_SWAP = 6; // two adjacent passage words typed in reverse order

const COST = {
  exact: 0,
  half: 0.5,
  similar: 1,
  dissimilar: 1.25, // nudges the alignment to pair up words that look alike
  gap: 1,
};

/** Split text into words. Any run of whitespace (spaces, tabs, new lines) separates words. */
export function tokenize(text) {
  return String(text ?? '')
    .normalize('NFC')
    .split(/\s+/u)
    .filter(Boolean);
}

/** Number of key depressions needed to produce the text (Unicode code points, spaces included). */
export function countKeys(text) {
  return Array.from(String(text ?? '').normalize('NFC').trim()).length;
}

const lower = (s) => s.toLocaleLowerCase();
const bare = (s) => lower(s.replace(PUNCT, ''));

/**
 * Compare one passage word with one typed word.
 * @returns {'match'|'capitalization'|'punctuation'|'spelling'}
 */
export function compareWord(expected, typed) {
  if (expected === typed) return 'match';
  if (lower(expected) === lower(typed)) return 'capitalization';
  if (bare(expected) === bare(typed)) return 'punctuation';
  return 'spelling';
}

function kindOf(e, t, el, tl, eb, tb) {
  if (e === t) return 'match';
  if (el === tl) return 'capitalization';
  if (eb === tb) return 'punctuation';
  return 'spelling';
}

/**
 * Align typed words against passage words.
 * @param {string[]} P passage words
 * @param {string[]} T typed words
 * @returns {{ops: object[], consumed: number}} ops in reading order (pw = passage words each op covers);
 *   consumed = passage words covered
 */
export function align(P, T) {
  const m = T.length;
  // Only the start of the passage can be matched by m typed words; leave generous room for skipped lines.
  const N = Math.min(P.length, m * 2 + 50);
  const W = m + 1;
  const Pl = P.slice(0, N).map(lower);
  const Tl = T.map(lower);
  const Pb = P.slice(0, N).map(bare);
  const Tb = T.map(bare);
  const cost = new Float64Array((N + 1) * W).fill(Infinity);
  const op = new Uint8Array((N + 1) * W);
  cost[0] = 0;

  const relax = (i, j, c, o) => {
    const k = i * W + j;
    if (c < cost[k]) {
      cost[k] = c;
      op[k] = o;
    }
  };

  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= m; j++) {
      const c = cost[i * W + j];
      if (c === Infinity) continue;
      if (i < N && j < m) {
        const kind = kindOf(P[i], T[j], Pl[i], Tl[j], Pb[i], Tb[j]);
        const alike = Pl[i][0] === Tl[j][0] || Pl[i].at(-1) === Tl[j].at(-1);
        const step =
          kind === 'match' ? COST.exact
          : kind === 'spelling' ? (alike ? COST.similar : COST.dissimilar)
          : COST.half;
        relax(i + 1, j + 1, c + step, OP_SUB);
      }
      if (i + 1 < N && j < m && Tl[j] === Pl[i] + Pl[i + 1]) {
        relax(i + 2, j + 1, c + COST.half, OP_MERGE);
      }
      if (i < N && j + 1 < m && Pl[i] === Tl[j] + Tl[j + 1]) {
        relax(i + 1, j + 2, c + COST.half, OP_SPLIT);
      }
      if (i + 1 < N && j + 1 < m && P[i] !== P[i + 1] && P[i] === T[j + 1] && P[i + 1] === T[j]) {
        relax(i + 2, j + 2, c + COST.half, OP_SWAP);
      }
      if (i < N) relax(i + 1, j, c + COST.gap, OP_OMIT);
      if (j < m) relax(i, j + 1, c + COST.gap, OP_ADD);
    }
  }

  // Free end: the candidate may stop anywhere in the passage. On a tie, prefer covering more of the
  // passage, so a final word is read as an attempt at the next passage word rather than an extra word.
  let end = 0;
  for (let i = 1; i <= N; i++) {
    if (cost[i * W + m] <= cost[end * W + m]) end = i;
  }

  const ops = [];
  let i = end;
  let j = m;
  while (i > 0 || j > 0) {
    const o = op[i * W + j];
    switch (o) {
      case OP_SUB: {
        const type = compareWord(P[i - 1], T[j - 1]);
        ops.push({
          kind: type === 'match' ? 'correct' : type === 'spelling' ? 'full' : 'half',
          type,
          expected: P[i - 1],
          typed: T[j - 1],
          pw: 1,
        });
        i -= 1; j -= 1;
        break;
      }
      case OP_OMIT:
        ops.push({ kind: 'full', type: 'omission', expected: P[i - 1], typed: null, pw: 1 });
        i -= 1;
        break;
      case OP_ADD:
        ops.push({ kind: 'full', type: 'addition', expected: null, typed: T[j - 1], pw: 0 });
        j -= 1;
        break;
      case OP_MERGE:
        ops.push({ kind: 'half', type: 'spacing', expected: `${P[i - 2]} ${P[i - 1]}`, typed: T[j - 1], pw: 2 });
        i -= 2; j -= 1;
        break;
      case OP_SPLIT:
        ops.push({ kind: 'half', type: 'spacing', expected: P[i - 1], typed: `${T[j - 2]} ${T[j - 1]}`, pw: 1 });
        i -= 1; j -= 2;
        break;
      case OP_SWAP:
        ops.push({
          kind: 'half',
          type: 'transposition',
          expected: `${P[i - 2]} ${P[i - 1]}`,
          typed: `${T[j - 2]} ${T[j - 1]}`,
          pw: 2,
        });
        i -= 2; j -= 2;
        break;
      case OP_NONE:
      default:
        throw new Error(`Alignment backtrack failed at ${i},${j}`);
    }
  }
  ops.reverse();
  return { ops, consumed: end };
}

/**
 * Evaluate a finished attempt.
 * @param {object} input
 * @param {string} input.passage
 * @param {string} input.typed
 * @param {number} input.elapsedMs   time actually spent typing
 * @param {boolean} [input.endedByTimer] if true, a half-finished last word is not counted as a mistake
 */
export function evaluate({ passage, typed, elapsedMs, endedByTimer = false }) {
  const P = tokenize(passage);
  const T = tokenize(typed);
  const { ops, consumed } = align(P, T);

  // The clock can stop in the middle of a word; that unfinished word is not a mistake.
  const last = ops.at(-1);
  let attempted = consumed;
  if (
    endedByTimer &&
    last &&
    last.kind === 'full' &&
    last.type === 'spelling' &&
    !/\s$/u.test(typed) &&
    lower(last.expected).startsWith(lower(last.typed))
  ) {
    last.kind = 'partial';
    last.type = 'unfinished';
    attempted -= 1;
  }

  const full = ops.filter((o) => o.kind === 'full').length;
  const half = ops.filter((o) => o.kind === 'half').length;
  const correct = ops.filter((o) => o.kind === 'correct').length;
  const errors = full + half / 2;
  const minutes = Math.max(elapsedMs, 1) / 60000;
  const keyDepressions = countKeys(typed);
  const grossWpm = keyDepressions / 5 / minutes;
  const netWpm = Math.max(0, (keyDepressions / 5 - errors) / minutes);
  const errorPercent = attempted > 0 ? (errors / attempted) * 100 : 0;

  return {
    ops,
    passageWords: P.length,
    typedWords: T.length,
    attemptedWords: attempted,
    reachedEnd: consumed >= P.length,
    correctWords: correct,
    fullMistakes: full,
    halfMistakes: half,
    errors,
    errorPercent,
    accuracy: Math.max(0, 100 - errorPercent),
    keyDepressions,
    kdph: (keyDepressions / minutes) * 60,
    grossWpm,
    netWpm,
    elapsedMs,
  };
}

/**
 * Check a result against an exam standard.
 * @param {object} result output of evaluate()
 * @param {{targetKeys: number, maxErrorPercent: number}} standard
 */
export function qualify(result, { targetKeys, maxErrorPercent }) {
  const speedOk = result.keyDepressions >= targetKeys;
  const errorsOk = result.attemptedWords > 0 && result.errorPercent <= maxErrorPercent;
  return { speedOk, errorsOk, passed: speedOk && errorsOk };
}
