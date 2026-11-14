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

// The alignment table is reused between calls (re-marking runs while the candidate types, and the
// server marks many attempts), so it is not allocated and zeroed every time. A cell counts only if it
// was written in the current pass (pass[k] === run), so nothing ever has to be cleared.
let tables = null;
let runs = 0;
function table(cells, rows) {
  if (!tables || tables.cost.length < cells) {
    const n = Math.max(cells, tables ? tables.cost.length * 2 : 0);
    tables = { cost: new Float64Array(n), op: new Uint8Array(n), pass: new Uint32Array(n), lo: tables?.lo, hi: tables?.hi };
    runs = 0;
  }
  if (!tables.lo || tables.lo.length < rows) {
    tables.lo = new Int32Array(rows * 2);
    tables.hi = new Int32Array(rows * 2);
  }
  return tables;
}
function nextRun() {
  runs += 1;
  if (runs === 0xffffffff) {
    tables.pass.fill(0);
    runs = 1;
  }
  return runs;
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

  // Every string the table compares is turned into a small integer first, so the inner loop compares
  // numbers and never builds strings. The scoreboard re-marks attempts on the server, where CPU time
  // per request is tight, so this loop has to be fast.
  const ids = new Map();
  const id = (s) => {
    let v = ids.get(s);
    if (v === undefined) {
      v = ids.size;
      ids.set(s, v);
    }
    return v;
  };
  const Pl = P.slice(0, N).map(lower);
  const Tl = T.map(lower);
  const Pe = Int32Array.from(P.slice(0, N), id);
  const Te = Int32Array.from(T, id);
  const PlId = Int32Array.from(Pl, id);
  const TlId = Int32Array.from(Tl, id);
  const PbId = Int32Array.from(P.slice(0, N), (w) => id(bare(w)));
  const TbId = Int32Array.from(T, (w) => id(bare(w)));
  const Pfirst = Int32Array.from(Pl, (w) => w.charCodeAt(0));
  const Plast = Int32Array.from(Pl, (w) => w.charCodeAt(w.length - 1));
  const Tfirst = Int32Array.from(Tl, (w) => w.charCodeAt(0));
  const Tlast = Int32Array.from(Tl, (w) => w.charCodeAt(w.length - 1));
  // Two passage words joined (for spacing mistakes), and two typed words joined.
  const PlPair = Int32Array.from(Pl, (w, i) => (i + 1 < N ? id(w + Pl[i + 1]) : -1));
  const TlPair = Int32Array.from(Tl, (w, j) => (j + 1 < m ? id(w + Tl[j + 1]) : -1));

  const { cost, op, pass, lo, hi } = table((N + 1) * W, N + 1);
  let run = 0;

  // Fill the table, expanding only cells whose cost is at most `limit`. Costs never fall along a path,
  // so every cell whose true cost is within the limit still gets exactly its true cost and the same
  // step as with no limit, and cells over the limit can never tie with them. If the best end cost is
  // within the limit, the alignment is therefore identical to filling the whole table, at a fraction
  // of the work. Otherwise the caller doubles the limit and tries again.
  // The steps run in the same order as the original, clearer version of this loop, and keep the first
  // of equal-cost steps, so every mark is unchanged.
  const fill = (limit) => {
    run = nextRun();
    lo.fill(W, 0, N + 1);
    hi.fill(-1, 0, N + 1);
    cost[0] = 0;
    pass[0] = run;
    lo[0] = 0;
    hi[0] = 0;
    // Offer cost v to cell t (row r, column col) by step o.
    const offer = (t, v, o, r, col) => {
      if (pass[t] !== run || v < cost[t]) {
        pass[t] = run;
        cost[t] = v;
        op[t] = o;
        if (v <= limit) {
          if (col < lo[r]) lo[r] = col;
          if (col > hi[r]) hi[r] = col;
        }
      }
    };
    for (let i = 0; i <= N; i++) {
      const row = i * W;
      // hi[i] can grow while this row runs (extra words move along the row).
      for (let j = lo[i]; j <= hi[i]; j++) {
        const k = row + j;
        if (pass[k] !== run) continue;
        const c = cost[k];
        if (c > limit) continue;
        if (i < N && j < m) {
          let step;
          if (Pe[i] === Te[j]) step = COST.exact;
          else if (PlId[i] === TlId[j] || PbId[i] === TbId[j]) step = COST.half;
          else step = Pfirst[i] === Tfirst[j] || Plast[i] === Tlast[j] ? COST.similar : COST.dissimilar;
          offer(k + W + 1, c + step, OP_SUB, i + 1, j + 1);
        }
        if (i + 1 < N && j < m && TlId[j] === PlPair[i]) offer(k + 2 * W + 1, c + COST.half, OP_MERGE, i + 2, j + 1);
        if (i < N && j + 1 < m && PlId[i] === TlPair[j]) offer(k + W + 2, c + COST.half, OP_SPLIT, i + 1, j + 2);
        if (i + 1 < N && j + 1 < m && Pe[i] !== Pe[i + 1] && Pe[i] === Te[j + 1] && Pe[i + 1] === Te[j]) {
          offer(k + 2 * W + 2, c + COST.half, OP_SWAP, i + 2, j + 2);
        }
        if (i < N) offer(k + W, c + COST.gap, OP_OMIT, i + 1, j);
        if (j < m) offer(k + 1, c + COST.gap, OP_ADD, i, j + 1);
      }
    }
    let best = Infinity;
    for (let i = 0; i <= N; i++) {
      const k = i * W + m;
      if (pass[k] === run && cost[k] < best) best = cost[k];
    }
    return best;
  };

  // The best alignment never costs more than m (every typed word read as an extra word), so a limit
  // of m or more always succeeds. Start at about 8% of the words typed, which covers most attempts in
  // one pass.
  for (let limit = Math.max(16, Math.ceil(m / 12)); ; limit *= 2) {
    if (fill(limit) <= limit || limit >= m) break;
  }

  // Free end: the candidate may stop anywhere in the passage. On a tie, prefer covering more of the
  // passage, so a final word is read as an attempt at the next passage word rather than an extra word.
  const at = (i) => (pass[i * W + m] === run ? cost[i * W + m] : Infinity);
  let end = 0;
  for (let i = 1; i <= N; i++) {
    if (at(i) <= at(end)) end = i;
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
