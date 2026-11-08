import { evaluate, qualify, tokenize, countKeys, align } from './scoring.js';
import { passagesFor, findPassage } from './passages.js';
import { PRESETS, ERROR_LIMITS, LANG_LABEL, findPreset, resolveConfig } from './presets.js';
import * as store from './storage.js';

/* ------------------------------------------------------------------ helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

const srOnly = (text) => h('span', { class: 'sr-only', text });

const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

const plural = (n, one, many = `${one}s`) => `${nf0.format(n)} ${n === 1 ? one : many}`;

function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${String(mm).padStart(2, '0')}:${ss}`;
}

/** "13 minutes 20 seconds" – used both on screen and for screen readers. */
function fmtSpoken(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return plural(r, 'second');
  return r ? `${plural(m, 'minute')} ${plural(r, 'second')}` : plural(m, 'minute');
}

function fmtHours(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

/* ------------------------------------------------------------------ state */

let settings = store.loadSettings();
let setup = store.loadSetup();
let session = null; // the test in progress
let lastResult = null; // the most recent finished test, shown on the results view
let lastPassageId = null;

const MODE_LABEL = { exam: 'Exam simulation', practice: 'Practice' };

/* ------------------------------------------------------------------ announcements */

const announceTimers = new Map();
function announce(message, { assertive = false } = {}) {
  const el = $(assertive ? '#announce-assertive' : '#announce-polite');
  clearTimeout(announceTimers.get(el));
  el.textContent = '';
  // Clearing then setting after a short delay makes screen readers repeat identical messages.
  announceTimers.set(el, setTimeout(() => { el.textContent = message; }, 80));
}

/* ------------------------------------------------------------------ dialog */

function confirmDialog({ title, body, confirm = 'OK', cancel = 'Cancel', danger = false, focus = 'cancel' }) {
  const dialog = $('#dialog');
  const okBtn = $('#dialog-confirm');
  const cancelBtn = $('#dialog-cancel');
  const opener = document.activeElement;
  $('#dialog-title').textContent = title;
  $('#dialog-body').textContent = body;
  okBtn.textContent = confirm;
  cancelBtn.textContent = cancel;
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  dismissDialog?.(false);

  // Resolve from the buttons and Escape directly rather than the dialog's 'close' event, which some
  // embedded browsers only deliver once the page paints.
  return new Promise((resolve) => {
    const finish = (ok) => {
      okBtn.onclick = cancelBtn.onclick = dialog.onkeydown = dialog.oncancel = null;
      dismissDialog = null;
      if (dialog.open) dialog.close();
      if (!ok && opener && document.contains(opener)) opener.focus();
      resolve(ok);
    };
    dismissDialog = finish;
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
    dialog.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };
    dialog.oncancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    dialog.showModal();
    (focus === 'confirm' ? okBtn : cancelBtn).focus();
  });
}

let dismissDialog = null;

function closeDialog() {
  dismissDialog?.(false);
}

/* ------------------------------------------------------------------ settings */

const FONT_STACKS = {
  sans: 'var(--font-ui)',
  serif: 'Georgia, Cambria, "Times New Roman", "Noto Serif", serif',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
  wide: 'Verdana, "DejaVu Sans", Tahoma, sans-serif',
};
const LINE_HEIGHTS = { normal: 1.55, relaxed: 1.85, spacious: 2.25 };

function applySettings() {
  const root = document.documentElement;
  if (settings.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  if (settings.reduceMotion) root.dataset.reduceMotion = 'true';
  else delete root.dataset.reduceMotion;
  root.style.setProperty('--text-size', `${settings.textSize}px`);
  root.style.setProperty('--line-height', String(LINE_HEIGHTS[settings.lineHeight] ?? 1.85));
  root.style.setProperty('--font-passage', FONT_STACKS[settings.font] ?? FONT_STACKS.sans);
}

const prefersReducedMotion = () =>
  settings.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function initSettingsView() {
  const form = $('#settings-form');
  const sync = () => {
    form.elements.theme.value = settings.theme;
    form.elements.textSize.value = settings.textSize;
    form.elements.lineHeight.value = settings.lineHeight;
    form.elements.font.value = settings.font;
    for (const name of ['showLiveStats', 'announceTime', 'announceMistakes', 'reduceMotion']) {
      form.elements[name].checked = Boolean(settings[name]);
    }
    $('#text-size-out').textContent = `${settings.textSize} px`;
    form.elements.textSize.setAttribute('aria-valuetext', `${settings.textSize} pixels`);
  };
  form.addEventListener('input', () => {
    settings = {
      ...settings,
      theme: form.elements.theme.value,
      textSize: Number(form.elements.textSize.value),
      lineHeight: form.elements.lineHeight.value,
      font: form.elements.font.value,
      showLiveStats: form.elements.showLiveStats.checked,
      announceTime: form.elements.announceTime.checked,
      announceMistakes: form.elements.announceMistakes.checked,
      reduceMotion: form.elements.reduceMotion.checked,
    };
    store.saveSettings(settings);
    applySettings();
    sync();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#reset-settings').addEventListener('click', () => {
    settings = { ...store.DEFAULT_SETTINGS };
    store.saveSettings(settings);
    applySettings();
    sync();
    announce('Default settings restored.');
  });
  sync();
  return sync;
}

/* ------------------------------------------------------------------ set-up view */

function presetMeta(p) {
  const parts = [];
  if (p.minutes) parts.push(`${p.minutes} min`);
  if (p.targetKeys) parts.push(`${nf0.format(p.targetKeys)} keys`);
  else if (p.targetWpm) parts.push(`${p.targetWpm} WPM`);
  parts.push(p.lang ? LANG_LABEL[p.lang] : p.id === 'custom' ? 'Your choice' : 'English or Hindi');
  return parts.join(' · ');
}

function initSetupView() {
  const form = $('#setup-form');

  $('#preset-options').append(
    ...PRESETS.map((p) =>
      h('label', { class: 'option-card' },
        h('input', { type: 'radio', name: 'presetId', value: p.id, 'aria-describedby': `preset-${p.id}-meta preset-${p.id}-desc` }),
        h('span', { class: 'option-body' },
          h('span', { class: 'option-name', text: p.name }),
          h('span', { class: 'option-meta', id: `preset-${p.id}-meta`, text: presetMeta(p) }),
          h('span', { class: 'option-desc', id: `preset-${p.id}-desc`, text: p.note }),
        ),
      ),
    ),
  );

  $('#error-limit').append(
    ...ERROR_LIMITS.map((l) => h('option', { value: l.id, text: l.percent == null ? l.label : `${l.label} – ${l.percent}%` })),
  );

  const fill = () => {
    form.elements.presetId.value = setup.presetId;
    form.elements.lang.value = setup.lang;
    form.elements.customMinutes.value = setup.customMinutes;
    form.elements.customWpm.value = setup.customWpm;
    form.elements.mode.value = setup.mode;
    form.elements.ownPassage.value = setup.ownPassage;
    form.elements.backspace.checked = setup.backspace;
    form.elements.startOnType.checked = setup.startOnType;
    form.elements.compensatoryTime.checked = setup.compensatoryTime;
    form.elements.errorLimitId.value = setup.errorLimitId;
    form.elements.customErrorPercent.value = setup.customErrorPercent;
    refresh();
  };

  const read = () => {
    setup = {
      ...setup,
      presetId: form.elements.presetId.value || setup.presetId,
      lang: form.elements.lang.value || setup.lang,
      customMinutes: form.elements.customMinutes.value,
      customWpm: form.elements.customWpm.value,
      mode: form.elements.mode.value || 'exam',
      passageId: form.elements.passageId.value || 'random',
      ownPassage: form.elements.ownPassage.value,
      backspace: form.elements.backspace.checked,
      startOnType: form.elements.startOnType.checked,
      compensatoryTime: form.elements.compensatoryTime.checked,
      errorLimitId: form.elements.errorLimitId.value,
      customErrorPercent: form.elements.customErrorPercent.value,
    };
    store.saveSetup(setup);
  };

  const renderPassageOptions = (lang) => {
    const select = $('#passage-select');
    if (select.dataset.lang === lang) return;
    select.dataset.lang = lang;
    const list = passagesFor(lang);
    select.replaceChildren(
      h('option', { value: 'random', text: 'Random passage' }),
      h('optgroup', { label: `${LANG_LABEL[lang]} passages` },
        ...list.map((p) => h('option', { value: p.id, text: p.title, lang: p.lang })),
      ),
      h('option', { value: 'own', text: 'My own passage…' }),
    );
    const keep = setup.passageId === 'own' || list.some((p) => p.id === setup.passageId);
    select.value = keep ? setup.passageId : 'random';
  };

  const refresh = () => {
    const preset = findPreset(setup.presetId);
    const config = resolveConfig(setup);
    $('#custom-fields').hidden = preset.lang != null;
    $('#custom-numbers').hidden = preset.id !== 'custom';
    renderPassageOptions(config.lang);
    $('#own-passage-field').hidden = $('#passage-select').value !== 'own';
    $('#own-passage').lang = config.lang;
    const ownWords = tokenize(setup.ownPassage).length;
    $('#own-passage-count').textContent = ownWords ? `${plural(ownWords, 'word')}.` : '';
    $('#custom-error-field').hidden = setup.errorLimitId !== 'custom';

    const targetText = config.targetWpm
      ? `${nf0.format(config.targetKeys)} key depressions (${config.targetWpm} WPM)`
      : `${nf0.format(config.targetKeys)} key depressions`;
    const rows = [
      ['Pattern', config.presetName],
      ['Language', LANG_LABEL[config.lang]],
      ['Time', fmtSpoken(config.durationMs / 1000)],
      ['Target', targetText],
      ['Error limit', `${nf1.format(config.maxErrorPercent)}%`],
      ['Mode', MODE_LABEL[config.mode]],
      ['Backspace', config.backspace ? 'Allowed' : 'Not allowed'],
    ];
    $('#setup-summary').replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
  };

  form.addEventListener('input', () => {
    $('#setup-error').textContent = '';
    read();
    refresh();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    read();
    const error = validateSetup();
    if (error) {
      $('#setup-error').textContent = error.message;
      error.field?.focus();
      return;
    }
    const config = resolveConfig(setup);
    startTest(config, choosePassage(config));
  });

  fill();
}

function validateSetup() {
  const preset = findPreset(setup.presetId);
  const form = $('#setup-form');
  if (preset.id === 'custom') {
    const m = Number(setup.customMinutes);
    if (!Number.isInteger(m) || m < 1 || m > 60) {
      return { message: 'Enter a duration between 1 and 60 minutes.', field: form.elements.customMinutes };
    }
    const w = Number(setup.customWpm);
    if (!Number.isFinite(w) || w < 5 || w > 150) {
      return { message: 'Enter a target speed between 5 and 150 words per minute.', field: form.elements.customWpm };
    }
  }
  if (setup.errorLimitId === 'custom') {
    const p = Number(setup.customErrorPercent);
    if (setup.customErrorPercent === '' || !Number.isFinite(p) || p < 0 || p > 100) {
      return { message: 'Enter an error limit between 0 and 100 percent.', field: form.elements.customErrorPercent };
    }
  }
  if (setup.passageId === 'own' && tokenize(setup.ownPassage).length < 5) {
    return { message: 'Your passage needs at least 5 words.', field: form.elements.ownPassage };
  }
  return null;
}

function choosePassage(config, { avoid = lastPassageId } = {}) {
  if (setup.passageId === 'own') {
    return { id: 'own', title: 'Your own passage', lang: config.lang, text: setup.ownPassage.trim() };
  }
  const chosen = findPassage(setup.passageId);
  if (chosen && chosen.lang === config.lang) return chosen;
  const pool = passagesFor(config.lang);
  const fresh = pool.filter((p) => p.id !== avoid);
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(Math.random() * list.length)];
}

/* ------------------------------------------------------------------ test view */

const input = () => $('#typing-input');

function startTest(config, passage) {
  stopClock();
  lastPassageId = passage.id;
  session = {
    config,
    passage,
    words: tokenize(passage.text),
    spans: [],
    state: 'ready', // ready | running | paused | done
    startedAt: 0,
    elapsedBefore: 0,
    inserts: 0,
    deletions: 0,
    lastSecond: null,
    announced: new Set(),
    currentIndex: 0,
    typedCount: 0,
    keys: 0,
    completed: 0,
    painted: 0,
    marks: [], // practice mode: '' | 'done' | 'bad' per passage word
    base: { typed: 0, passage: 0 }, // last full alignment: typed words → passage words reached
    alignTimer: 0,
    endNotified: false,
    frame: 0,
    tick: 0,
  };
  renderTest();
  navigate('test');
}

function renderTest() {
  const { config, passage } = session;
  $('#test-heading').textContent = config.presetName;
  $('#test-meta').replaceChildren(`${MODE_LABEL[config.mode]} · `, h('span', { lang: passage.lang, text: passage.title }));

  const box = $('#passage');
  box.lang = passage.lang;
  box.scrollTop = 0;
  let i = 0;
  const paragraphs = passage.text.split(/\n\s*\n/u).map((para) => {
    const p = h('p');
    tokenize(para).forEach((word, k) => {
      if (k) p.append(' ');
      const span = h('span', { class: 'w', text: word });
      session.spans[i++] = span;
      p.append(span);
    });
    return p;
  });
  box.replaceChildren(...paragraphs);

  const field = input();
  field.value = '';
  field.readOnly = false;
  field.lang = passage.lang;

  const pause = $('#pause-btn');
  pause.hidden = config.mode !== 'practice';
  pause.disabled = true;
  pause.textContent = 'Pause';

  $('#live-stats').hidden = !settings.showLiveStats;
  $('#live-wpm').textContent = '0';
  $('#live-keys').textContent = '0';
  $('#live-target').textContent = ` / ${nf0.format(config.targetKeys)}`;
  $('#timer').textContent = fmtClock(config.durationMs / 1000);
  $('#timer').classList.remove('is-low');
  setStatus(config.startOnType ? 'The timer starts when you begin typing.' : '');
  if (config.mode === 'practice') paintWords();
}

function setStatus(text, { alert = false } = {}) {
  const el = $('#test-status');
  el.textContent = text;
  el.classList.toggle('is-alert', alert);
}

function onTestShown() {
  const { config, passage } = session;
  input().focus();
  if (!config.startOnType) startClock();
  announce(
    `${config.presetName}, ${MODE_LABEL[config.mode]}. ${fmtSpoken(config.durationMs / 1000)}. ` +
    `Passage: ${passage.title}, ${plural(session.words.length, 'word')}. ` +
    (config.startOnType ? 'The timer starts when you begin typing.' : 'The timer has started.'),
  );
}

const elapsed = () =>
  session.elapsedBefore + (session.state === 'running' ? performance.now() - session.startedAt : 0);

function startClock() {
  session.state = 'running';
  session.startedAt = performance.now();
  session.tick = setInterval(onTick, 200);
  $('#pause-btn').disabled = false;
  if (session.config.startOnType) setStatus('');
  onTick();
}

function stopClock() {
  if (session?.tick) clearInterval(session.tick);
  if (session) session.tick = 0;
}

function onTick() {
  if (!session || session.state !== 'running') return;
  const remainingMs = session.config.durationMs - elapsed();
  const secs = Math.ceil(Math.max(0, remainingMs) / 1000);
  if (secs !== session.lastSecond) {
    session.lastSecond = secs;
    $('#timer').textContent = fmtClock(secs);
    $('#timer').classList.toggle('is-low', secs <= 60);
    updateLiveStats();
    announceTime(secs);
  }
  if (remainingMs <= 0) finishTest({ byTimer: true });
}

function announceTime(secs) {
  const total = Math.round(session.config.durationMs / 1000);
  if (!settings.announceTime || secs >= total || session.announced.has(secs)) return;
  if ((secs > 0 && secs % 60 === 0) || secs === 30 || secs === 10) {
    session.announced.add(secs);
    announce(`${fmtSpoken(secs)} left.`);
  }
}

function updateLiveStats() {
  const mins = elapsed() / 60000;
  $('#live-wpm').textContent = mins > 0.05 ? nf0.format(session.keys / 5 / mins) : '0';
  $('#live-keys').textContent = nf0.format(session.keys);
}

function togglePause() {
  if (!session || session.config.mode !== 'practice') return;
  const btn = $('#pause-btn');
  if (session.state === 'running') {
    session.elapsedBefore = elapsed();
    session.state = 'paused';
    stopClock();
    input().readOnly = true;
    btn.textContent = 'Resume';
    setStatus('Paused. Select Resume to carry on.');
    announce('Test paused.');
  } else if (session.state === 'paused') {
    session.state = 'running';
    session.startedAt = performance.now();
    session.tick = setInterval(onTick, 200);
    input().readOnly = false;
    btn.textContent = 'Pause';
    setStatus('');
    announce('Test resumed.');
    input().focus();
  }
}

const BLOCKED_INSERTS = new Set(['insertFromPaste', 'insertFromDrop', 'insertFromPasteAsQuotation', 'insertFromYank']);

function initTestView() {
  const field = input();

  field.addEventListener('beforeinput', (e) => {
    if (!session || session.state === 'done' || session.state === 'paused') {
      e.preventDefault();
      return;
    }
    const t = e.inputType || '';
    if (BLOCKED_INSERTS.has(t)) {
      e.preventDefault();
      setStatus('Pasting is turned off during the test.', { alert: true });
      announce('Pasting is turned off during the test.', { assertive: true });
    } else if (!session.config.backspace && (t.startsWith('delete') || t.startsWith('history'))) {
      e.preventDefault();
      setStatus('Backspace is turned off for this test.', { alert: true });
    }
  });
  for (const type of ['paste', 'drop']) field.addEventListener(type, (e) => e.preventDefault());

  field.addEventListener('keydown', (e) => {
    if (session && !session.config.backspace && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      setStatus('Backspace is turned off for this test.', { alert: true });
    }
  });

  field.addEventListener('input', (e) => {
    if (!session || session.state === 'done') return;
    const t = e.inputType || '';
    if (t.startsWith('delete')) session.deletions += 1;
    else if (t !== 'insertCompositionText') session.inserts += Math.max(1, Array.from(e.data ?? '').length);
    if (session.state === 'ready') startClock();
    if (!session.frame) session.frame = requestAnimationFrame(onTextChanged);
  });
  field.addEventListener('compositionend', (e) => {
    if (session) session.inserts += Array.from(e.data ?? '').length;
  });

  $('#pause-btn').addEventListener('click', togglePause);
  $('#submit-btn').addEventListener('click', requestSubmit);

  document.addEventListener('keydown', (e) => {
    if (!session || currentView !== 'test') return;
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    const aid = { KeyN: 'next', KeyW: 'word', KeyS: 'spell', KeyT: 'time', KeyP: 'progress' }[e.code];
    if (aid) {
      e.preventDefault();
      readingAid(aid);
    }
  });
  $$('[data-aid]').forEach((btn) => btn.addEventListener('click', () => readingAid(btn.dataset.aid)));

  window.addEventListener('beforeunload', (e) => {
    if (session && session.state !== 'ready') {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function onTextChanged() {
  if (!session) return;
  session.frame = 0;
  const text = input().value;
  const typed = tokenize(text);
  const completed = /\s$/u.test(text) || !typed.length ? typed.length : typed.length - 1;
  const { words, config } = session;
  const previous = session.completed;

  // Where is the candidate in the passage? Start from the last full alignment and assume word-for-word
  // after it; a debounced re-alignment corrects this once they pause (skipped or extra words).
  if (completed < session.base.typed) realign(typed.slice(0, completed));
  const offset = session.base.passage - session.base.typed;
  session.completed = completed;
  session.currentIndex = Math.min(Math.max(0, completed + offset), words.length);
  session.typedCount = typed.length;
  session.keys = countKeys(text);

  if (config.mode === 'practice') {
    const { marks } = session;
    for (let k = session.base.typed; k < completed; k++) {
      const p = k + offset;
      if (p >= 0 && p < words.length) marks[p] = typed[k] === words[p] ? 'done' : 'bad';
    }
    marks.length = Math.min(marks.length, session.currentIndex);
    if (settings.announceMistakes && completed === previous + 1) {
      const p = completed - 1 + offset;
      if (p >= 0 && p < words.length && typed[completed - 1] !== words[p]) {
        announce(`Mistake. Expected ${words[p]}.`, { assertive: true });
      }
    }
    paintWords();
  }
  clearTimeout(session.alignTimer);
  if (completed > session.base.typed) {
    session.alignTimer = setTimeout(() => {
      if (!session || session.state === 'done') return;
      realign(tokenize(input().value).slice(0, session.completed));
      if (session.config.mode === 'practice') paintWords();
    }, 350);
  }

  if (session.currentIndex >= words.length && !session.endNotified) {
    session.endNotified = true;
    setStatus('You have reached the end of the passage. Submit when you are ready.');
    announce('End of passage. Submit when you are ready.');
  }
  updateLiveStats();
}

/** Align the completed words with the passage using the scoring engine, and record per-word marks. */
function realign(typedWords) {
  const { ops, consumed } = align(session.words, typedWords);
  const marks = [];
  let p = 0;
  for (const o of ops) {
    for (let k = 0; k < o.pw; k++) marks[p + k] = o.kind === 'correct' ? 'done' : 'bad';
    p += o.pw;
  }
  session.marks = marks;
  session.base = { typed: typedWords.length, passage: consumed };
  session.currentIndex = Math.min(consumed + (session.completed - typedWords.length), session.words.length);
}

/** Practice mode: show finished words, wrong words and the current word in the passage. */
function paintWords() {
  const { spans, marks, currentIndex } = session;
  const upto = Math.min(Math.max(session.painted, currentIndex + 1), spans.length);
  for (let i = 0; i < upto; i++) {
    const cls = i === currentIndex ? 'w current' : marks[i] ? `w ${marks[i]}` : 'w';
    if (spans[i].className !== cls) spans[i].className = cls;
  }
  session.painted = currentIndex + 1;
  const current = spans[currentIndex];
  if (current) keepInView(current);
}

function keepInView(span) {
  const box = $('#passage');
  const b = box.getBoundingClientRect();
  const r = span.getBoundingClientRect();
  if (r.top < b.top + 8 || r.bottom > b.bottom - 8) {
    box.scrollTo({
      top: box.scrollTop + (r.top - b.top) - box.clientHeight / 3,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }
}

const SPOKEN_MARKS = {
  ',': 'comma', '.': 'full stop', ';': 'semicolon', ':': 'colon', '-': 'hyphen', '–': 'dash', '—': 'dash',
  "'": 'apostrophe', '’': 'apostrophe', '‘': 'opening quote', '"': 'quote', '“': 'opening quote',
  '”': 'closing quote', '(': 'opening bracket', ')': 'closing bracket', '?': 'question mark',
  '!': 'exclamation mark', '।': 'purna viram', '/': 'slash', '&': 'ampersand', '%': 'percent',
};

function spell(word) {
  return Array.from(word)
    .map((ch) => SPOKEN_MARKS[ch] ?? (ch !== ch.toLowerCase() ? `capital ${ch}` : ch))
    .join(', ');
}

function readingAid(kind) {
  if (!session) return;
  const { words, currentIndex, config } = session;
  const word = words[currentIndex];
  switch (kind) {
    case 'next': {
      const next = words.slice(currentIndex, currentIndex + 8);
      announce(next.length ? next.join(' ') : 'End of passage.', { assertive: true });
      break;
    }
    case 'word':
      announce(word ? `Current word: ${word}` : 'End of passage.', { assertive: true });
      break;
    case 'spell':
      announce(word ? spell(word) : 'End of passage.', { assertive: true });
      break;
    case 'time': {
      const left = (config.durationMs - elapsed()) / 1000;
      const msg = session.state === 'ready'
        ? `The timer has not started. You will have ${fmtSpoken(left)}.`
        : `${fmtSpoken(left)} left${session.state === 'paused' ? ', paused' : ''}.`;
      announce(msg, { assertive: true });
      break;
    }
    case 'progress': {
      const mins = elapsed() / 60000;
      const wpm = mins > 0.05 ? Math.round(session.keys / 5 / mins) : 0;
      announce(
        `${plural(session.typedCount, 'word')} typed. ${nf0.format(session.keys)} of ` +
        `${nf0.format(config.targetKeys)} key depressions. ${wpm} words per minute.`,
        { assertive: true },
      );
      break;
    }
  }
}

async function requestSubmit() {
  if (!session) return;
  const nothingTyped = !input().value.trim();
  if (nothingTyped) {
    const leave = await confirmDialog({
      title: 'Leave this test?',
      body: 'You have not typed anything yet, so there is nothing to mark.',
      confirm: 'Leave test',
      cancel: 'Keep going',
    });
    if (leave && session) {
      abandonTest();
      navigate('practice');
    }
    return;
  }
  const left = (session.config.durationMs - elapsed()) / 1000;
  const ok = await confirmDialog({
    title: 'Submit your test?',
    body: `You still have ${fmtSpoken(left)}. You cannot change your text after submitting.`,
    confirm: 'Submit',
    cancel: 'Keep typing',
    focus: 'confirm',
  });
  if (ok && session && session.state !== 'done') finishTest({ byTimer: false });
  else if (session) input().focus();
}

function abandonTest() {
  stopClock();
  if (session?.frame) cancelAnimationFrame(session.frame);
  if (session) clearTimeout(session.alignTimer);
  session = null;
}

function finishTest({ byTimer }) {
  if (!session || session.state === 'done') return;
  closeDialog();
  const elapsedMs = byTimer ? session.config.durationMs : elapsed();
  stopClock();
  clearTimeout(session.alignTimer);
  session.state = 'done';
  input().readOnly = true;
  const { config, passage } = session;
  const typedText = input().value;
  const result = evaluate({ passage: passage.text, typed: typedText, elapsedMs, endedByTimer: byTimer });
  const verdict = qualify(result, config);

  lastResult = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date: new Date().toISOString(),
    config,
    passage,
    typedText,
    byTimer,
    keystrokes: session.inserts + session.deletions,
    corrections: session.deletions,
    result,
    verdict,
  };

  if (result.typedWords > 0) {
    store.addHistory({
      id: lastResult.id,
      date: lastResult.date,
      presetId: config.presetId,
      presetName: config.presetName,
      mode: config.mode,
      lang: config.lang,
      passageId: passage.id,
      passageTitle: passage.title,
      durationMs: config.durationMs,
      elapsedMs,
      netWpm: result.netWpm,
      grossWpm: result.grossWpm,
      kdph: result.kdph,
      keyDepressions: result.keyDepressions,
      errorPercent: result.errorPercent,
      fullMistakes: result.fullMistakes,
      halfMistakes: result.halfMistakes,
      targetKeys: config.targetKeys,
      targetWpmEquivalent: config.targetKeys / 5 / (config.minutes),
      maxErrorPercent: config.maxErrorPercent,
      passed: verdict.passed,
    });
  }

  session = null;
  navigate('results');
  const r = result;
  announce(
    `${byTimer ? 'Time is up. ' : ''}${verdict.passed ? 'You meet the standard.' : 'Not at the standard yet.'} ` +
    `Net speed ${nf1.format(r.netWpm)} words per minute. Errors ${nf1.format(r.errorPercent)} percent.`,
  );
}

/* ------------------------------------------------------------------ results view */

const TYPE_LABEL = {
  spelling: 'Wrong word or spelling',
  omission: 'Missed word',
  addition: 'Extra word',
  spacing: 'Spacing',
  capitalization: 'Capital letters',
  punctuation: 'Punctuation',
  transposition: 'Word order',
};

function icon(kind) {
  const path = kind === 'pass'
    ? 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.4-5.4 1.4 1.4-6.8 6.8Z'
    : 'M12 2 1 21h22L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V9h2v4Z';
  return svg('svg', { class: 'verdict-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: path, fill: 'currentColor' }));
}

function renderResults() {
  const { config, passage, result: r, verdict, byTimer } = lastResult;
  const lang = config.lang;
  $('#results-meta').replaceChildren(
    `${config.presetName} · ${MODE_LABEL[config.mode]} · `,
    h('span', { lang: passage.lang, text: passage.title }),
    ` · ${dateFmt.format(new Date(lastResult.date))}`,
  );

  // Verdict
  const short = config.targetKeys - r.keyDepressions;
  const reasons = [];
  if (!r.typedWords) {
    reasons.push('No words were typed, so there is nothing to mark.');
  } else {
    reasons.push(verdict.speedOk
      ? `Speed met: ${nf0.format(r.keyDepressions)} key depressions against a target of ${nf0.format(config.targetKeys)}.`
      : `Speed not met: ${nf0.format(r.keyDepressions)} key depressions, ${nf0.format(short)} short of ${nf0.format(config.targetKeys)}.`);
    reasons.push(verdict.errorsOk
      ? `Errors within the limit: ${nf1.format(r.errorPercent)}% against ${nf1.format(config.maxErrorPercent)}% allowed.`
      : `Errors over the limit: ${nf1.format(r.errorPercent)}% against ${nf1.format(config.maxErrorPercent)}% allowed.`);
  }
  reasons.push(byTimer
    ? 'The test ended when the time ran out.'
    : `You submitted with ${fmtSpoken((config.durationMs - r.elapsedMs) / 1000)} left.`);
  const v = $('#verdict');
  v.className = `verdict ${verdict.passed ? 'pass' : 'fail'}`;
  v.replaceChildren(
    icon(verdict.passed ? 'pass' : 'fail'),
    h('div', {},
      h('h2', { text: verdict.passed ? `You meet the ${config.presetShort} standard` : 'Not at the standard yet' }),
      h('ul', {}, ...reasons.map((t) => h('li', { text: t }))),
    ),
  );

  // Headline numbers
  const tile = (label, value, unit, sub) =>
    h('div', { class: 'stat' },
      h('p', { class: 'stat-label', text: label }),
      h('p', { class: 'stat-value' }, value, unit ? h('small', { text: unit }) : null),
      sub ? h('p', { class: 'stat-sub', text: sub }) : null,
    );
  $('#result-tiles').replaceChildren(
    tile('Net speed', nf1.format(r.netWpm), 'WPM', 'After deducting errors'),
    tile('Gross speed', nf1.format(r.grossWpm), 'WPM', 'Key depressions ÷ 5 per minute'),
    tile('Error rate', `${nf1.format(r.errorPercent)}%`, null, `${nf1.format(r.errors)} errors in ${plural(r.attemptedWords, 'word')}`),
    tile('Key depressions', nf0.format(r.keyDepressions), null, `Target ${nf0.format(config.targetKeys)}`),
    tile('Per hour (KDPH)', nf0.format(r.kdph), null, 'Key depressions per hour'),
  );

  // Details
  const rows = [
    ['Time taken', fmtSpoken(r.elapsedMs / 1000)],
    ['Time allowed', fmtSpoken(config.durationMs / 1000)],
    ['Words typed', nf0.format(r.typedWords)],
    ['Passage words attempted', `${nf0.format(r.attemptedWords)} of ${nf0.format(r.passageWords)}`],
    ['Correct words', nf0.format(r.correctWords)],
    ['Full mistakes', nf0.format(r.fullMistakes)],
    ['Half mistakes', nf0.format(r.halfMistakes)],
    ['Total errors', nf1.format(r.errors)],
    ['All key presses, including corrections', nf0.format(lastResult.keystrokes)],
    ['Corrections (backspace or delete)', nf0.format(lastResult.corrections)],
  ];
  $('#result-details').replaceChildren(
    h('tbody', {}, ...rows.map(([k, val]) => h('tr', {}, h('th', { scope: 'row', text: k }), h('td', { text: val })))),
  );

  // Mistakes by type
  const counts = {};
  for (const o of r.ops) if (o.kind === 'full' || o.kind === 'half') counts[o.type] = (counts[o.type] ?? 0) + 1;
  const typeRows = Object.entries(TYPE_LABEL).map(([type, label]) => {
    const half = ['spacing', 'capitalization', 'punctuation', 'transposition'].includes(type);
    return h('tr', {},
      h('th', { scope: 'row', text: label }),
      h('td', {}, h('span', { class: `tag ${half ? 'tag-half' : 'tag-full'}`, text: half ? 'Half' : 'Full' })),
      h('td', { class: 'num', text: nf0.format(counts[type] ?? 0) }),
    );
  });
  $('#mistake-summary').replaceChildren(
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col', text: 'Type' }), h('th', { scope: 'col', text: 'Counts as' }),
      h('th', { scope: 'col', class: 'num', text: 'Number' }))),
    h('tbody', {}, ...typeRows),
  );

  // Mistake list
  const mistakes = r.ops.filter((o) => o.kind === 'full' || o.kind === 'half');
  const list = $('#mistake-list');
  list.parentElement.classList.toggle('tall', mistakes.length > 12);
  if (!mistakes.length) {
    list.replaceChildren(h('tbody', {}, h('tr', {}, h('td', { text: r.typedWords ? 'No mistakes. Well done.' : 'Nothing was typed.' }))));
  } else {
    list.replaceChildren(
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col', class: 'num', text: 'No.' }),
        h('th', { scope: 'col', text: 'Passage' }),
        h('th', { scope: 'col', text: 'You typed' }),
        h('th', { scope: 'col', text: 'Mistake' }),
        h('th', { scope: 'col', text: 'Counts as' }))),
      h('tbody', {}, ...mistakes.map((o, i) => h('tr', {},
        h('td', { class: 'num', text: String(i + 1) }),
        h('td', { class: 'expected-cell', lang }, o.expected ?? h('span', { 'aria-label': 'nothing', text: '—' })),
        h('td', { class: 'typed-cell', lang }, o.typed ?? h('span', { 'aria-label': 'nothing', text: '—' })),
        h('td', { text: TYPE_LABEL[o.type] }),
        h('td', {}, h('span', { class: `tag tag-${o.kind}`, text: o.kind === 'full' ? 'Full' : 'Half' })),
      ))),
    );
  }

  renderAnnotated(r, lang);
}

function renderAnnotated(r, lang) {
  const box = $('#annotated');
  box.lang = lang;
  const parts = [];
  for (const o of r.ops) {
    if (parts.length) parts.push(' ');
    if (o.kind === 'correct') {
      parts.push(o.typed);
    } else if (o.kind === 'partial') {
      parts.push(h('span', { class: 'mk mk-partial' }, o.typed, srOnly(' (unfinished when time ran out)')));
    } else if (o.type === 'omission') {
      parts.push(h('span', { class: 'mk mk-omit' }, srOnly('Missed word: '), o.expected));
    } else if (o.type === 'addition') {
      parts.push(h('span', { class: 'mk mk-add' }, srOnly('Extra word: '), o.typed));
    } else {
      const half = o.kind === 'half';
      parts.push(h('span', { class: `mk ${half ? 'mk-half' : 'mk-full'}` },
        srOnly(`${TYPE_LABEL[o.type]}, ${half ? 'half' : 'full'} mistake. You typed `),
        h('s', { text: o.typed }),
        srOnly('. Passage has'),
        ' ',
        h('span', { class: 'exp', text: o.expected }),
        srOnly('.'),
      ));
    }
  }
  const rest = r.passageWords - r.attemptedWords - (r.ops.at(-1)?.kind === 'partial' ? 1 : 0);
  const nodes = [h('p', {}, ...parts)];
  if (!r.ops.length) nodes[0].textContent = 'Nothing was typed.';
  if (rest > 0 && r.ops.length) nodes.push(h('p', { class: 'hint', lang: 'en', text: `${plural(rest, 'passage word')} not reached.` }));
  box.replaceChildren(...nodes);
}

function initResultsView() {
  $('#retry-btn').addEventListener('click', () => {
    if (lastResult) startTest(lastResult.config, lastResult.passage);
  });
  $('#new-passage-btn').addEventListener('click', () => {
    if (!lastResult) return;
    const { config, passage } = lastResult;
    const next = passage.id === 'own'
      ? passage
      : (() => {
        const pool = passagesFor(config.lang).filter((p) => p.id !== passage.id);
        return pool[Math.floor(Math.random() * pool.length)] ?? passage;
      })();
    startTest(config, next);
  });
}

/* ------------------------------------------------------------------ progress view */

function initProgressView() {
  $('#progress-filter').addEventListener('change', renderProgress);
  $('#export-btn').addEventListener('click', exportCsv);
  $('#clear-btn').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete all results?',
      body: 'This removes every saved attempt from this browser. It cannot be undone.',
      confirm: 'Delete all',
      danger: true,
    });
    if (ok) {
      store.clearHistory();
      renderProgress();
      announce('All results deleted.');
      $('#progress-heading').focus();
    }
  });
  let width = 0;
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (w !== width && currentView === 'progress') {
      width = w;
      renderProgress({ chartOnly: true });
    }
  }).observe($('#progress-chart'));
}

function renderProgress({ chartOnly = false } = {}) {
  const all = store.loadHistory();
  $('#progress-empty').hidden = all.length > 0;
  $('#progress-content').hidden = all.length === 0;
  if (!all.length) return;

  const filter = $('#progress-filter');
  if (!chartOnly) {
    const used = PRESETS.filter((p) => all.some((e) => e.presetId === p.id));
    const keep = filter.value;
    filter.replaceChildren(
      h('option', { value: 'all', text: 'All patterns' }),
      ...used.map((p) => h('option', { value: p.id, text: p.name })),
    );
    filter.value = used.some((p) => p.id === keep) ? keep : 'all';
  }
  const entries = filter.value === 'all' ? all : all.filter((e) => e.presetId === filter.value);

  const recent = entries.slice(-30);
  const targets = new Set(recent.map((e) => Math.round(e.targetWpmEquivalent * 10)));
  const target = targets.size === 1 ? recent[0].targetWpmEquivalent : null;
  renderChart($('#progress-chart'), recent, target);
  $('#chart-title').textContent = `Net speed, last ${plural(recent.length, 'test')}`;
  if (chartOnly) return;

  const last10 = entries.slice(-10);
  const avg = (list, key) => list.reduce((s, e) => s + e[key], 0) / list.length;
  const tile = (label, value, sub) => h('div', { class: 'stat' },
    h('p', { class: 'stat-label', text: label }), h('p', { class: 'stat-value', text: value }),
    sub ? h('p', { class: 'stat-sub', text: sub }) : null);
  $('#progress-tiles').replaceChildren(
    tile('Tests', nf0.format(entries.length), `${nf0.format(entries.filter((e) => e.passed).length)} met the standard`),
    tile('Best net speed', `${nf1.format(Math.max(...entries.map((e) => e.netWpm)))} WPM`),
    tile('Average net speed', `${nf1.format(avg(last10, 'netWpm'))} WPM`, `Last ${plural(last10.length, 'test')}`),
    tile('Average error rate', `${nf1.format(avg(last10, 'errorPercent'))}%`, `Last ${plural(last10.length, 'test')}`),
    tile('Time practised', fmtHours(entries.reduce((s, e) => s + e.elapsedMs, 0))),
  );

  $('#history-table').replaceChildren(
    h('thead', {}, h('tr', {},
      ...['Date', 'Pattern', 'Mode', 'Net WPM', 'Gross WPM', 'Errors', 'Key depressions', 'Result'].map((t, i) =>
        h('th', { scope: 'col', class: i >= 3 && i <= 6 ? 'num' : null, text: t })))),
    h('tbody', {}, ...[...entries].reverse().map((e) => h('tr', {},
      h('td', { text: dateFmt.format(new Date(e.date)) }),
      h('th', { scope: 'row', text: e.presetName }),
      h('td', { text: MODE_LABEL[e.mode] }),
      h('td', { class: 'num', text: nf1.format(e.netWpm) }),
      h('td', { class: 'num', text: nf1.format(e.grossWpm) }),
      h('td', { class: 'num', text: `${nf1.format(e.errorPercent)}%` }),
      h('td', { class: 'num', text: nf0.format(e.keyDepressions) }),
      h('td', {}, h('span', { class: `tag ${e.passed ? 'tag-pass' : 'tag-fail'}`, text: e.passed ? 'Met' : 'Not met' })),
    ))),
  );
}

function niceMax(v) {
  const step = v <= 40 ? 10 : v <= 100 ? 20 : 50;
  return Math.ceil(v / step) * step;
}

function renderChart(container, entries, target) {
  const W = Math.max(280, container.clientWidth || 640);
  const H = W < 480 ? 200 : 240;
  const m = { t: 18, r: 16, b: 30, l: 40 };
  const values = entries.map((e) => e.netWpm);
  const max = niceMax(Math.max(10, ...values, target ?? 0) * 1.1);
  const x = (i) => entries.length === 1 ? (m.l + W - m.r) / 2 : m.l + (i * (W - m.l - m.r)) / (entries.length - 1);
  const y = (v) => H - m.b - (v / max) * (H - m.t - m.b);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const best = Math.max(...values);
  const chart = svg('svg', {
    viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
    'aria-label': `Line chart of net speed over ${plural(entries.length, 'test')}. ` +
      `Latest ${nf1.format(values.at(-1))} words per minute, best ${nf1.format(best)}.` +
      (target ? ` Target ${nf1.format(target)}.` : ''),
  },
  svg('g', { class: 'grid' }, ...ticks.map((t) => svg('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }))),
  svg('g', { class: 'axis', 'aria-hidden': 'true' },
    ...ticks.map((t) => svg('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, String(t))),
    svg('text', { x: x(0), y: H - 8, 'text-anchor': entries.length === 1 ? 'middle' : 'start' }, shortDate.format(new Date(entries[0].date))),
    entries.length > 1 ? svg('text', { x: x(entries.length - 1), y: H - 8, 'text-anchor': 'end' }, shortDate.format(new Date(entries.at(-1).date))) : null,
  ),
  target ? svg('g', { 'aria-hidden': 'true' },
    svg('line', { class: 'target', x1: m.l, x2: W - m.r, y1: y(target), y2: y(target) }),
    svg('text', { class: 'target-label', x: W - m.r, y: y(target) - 6, 'text-anchor': 'end' }, `Target ${nf0.format(target)} WPM`),
  ) : null,
  entries.length > 1 ? svg('path', { class: 'series', d: values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('') }) : null,
  svg('g', { 'aria-hidden': 'true' }, ...values.map((v, i) => svg('circle', { class: 'dot', cx: x(i), cy: y(v), r: 4 }))),
  );

  const crosshair = svg('line', { class: 'crosshair', y1: m.t, y2: H - m.b, visibility: 'hidden' });
  const hit = svg('rect', { x: m.l, y: 0, width: W - m.l - m.r + 1, height: H, fill: 'transparent' });
  chart.append(crosshair, hit);
  const tip = h('div', { class: 'chart-tooltip', hidden: true, 'aria-hidden': 'true' });
  const dots = [...chart.querySelectorAll('.dot')];

  hit.addEventListener('pointermove', (ev) => {
    const box = chart.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    let i = 0;
    for (let k = 1; k < entries.length; k++) if (Math.abs(x(k) - px) < Math.abs(x(i) - px)) i = k;
    const e = entries[i];
    crosshair.setAttribute('x1', x(i));
    crosshair.setAttribute('x2', x(i));
    crosshair.setAttribute('visibility', 'visible');
    dots.forEach((d, k) => d.classList.toggle('active', k === i));
    tip.replaceChildren(
      h('strong', { text: `${nf1.format(e.netWpm)} WPM` }),
      `${dateFmt.format(new Date(e.date))} · ${nf1.format(e.errorPercent)}% errors`,
    );
    tip.hidden = false;
    tip.style.left = `${(x(i) / W) * box.width}px`;
    tip.style.top = `${(y(e.netWpm) / H) * box.height}px`;
  });
  hit.addEventListener('pointerleave', () => {
    tip.hidden = true;
    crosshair.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.classList.remove('active'));
  });

  container.replaceChildren(chart, tip);
}

function exportCsv() {
  const rows = store.loadHistory();
  const cols = ['date', 'presetName', 'mode', 'lang', 'passageTitle', 'elapsedMs', 'netWpm', 'grossWpm', 'kdph',
    'keyDepressions', 'errorPercent', 'fullMistakes', 'halfMistakes', 'targetKeys', 'maxErrorPercent', 'passed'];
  const esc = (v) => {
    const s = typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `typeout-results-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ routing */

const VIEW_TITLES = {
  practice: 'Set up a test',
  test: 'Typing test',
  results: 'Your result',
  progress: 'Progress',
  settings: 'Settings',
  guide: 'Guide',
};
let currentView = null;
let syncSettingsForm = () => {};

function routeFromHash() {
  const name = (location.hash.match(/^#\/([\w-]+)/u) || [])[1];
  return VIEW_TITLES[name] ? name : 'practice';
}

function navigate(name) {
  if (location.hash === `#/${name}`) show(name);
  else location.hash = `#/${name}`;
}

function show(requested) {
  let name = requested;
  if (name === 'test' && !session) name = 'practice';
  if (name === 'results' && !lastResult) name = 'progress';
  if (name !== requested) {
    history.replaceState(null, '', `#/${name}`);
  }

  const first = currentView === null;
  currentView = name;
  for (const view of $$('[data-view]')) view.hidden = view.dataset.view !== name;
  for (const link of $$('[data-nav]')) {
    if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${VIEW_TITLES[name]} – Type Out`;

  if (name === 'results') renderResults();
  if (name === 'progress') renderProgress();
  if (name === 'settings') syncSettingsForm();

  window.scrollTo(0, 0);
  if (name === 'test') onTestShown();
  else if (!first) $(`[data-view="${name}"] h1`)?.focus();
}

async function onHashChange() {
  const name = routeFromHash();
  if (session && session.state !== 'done' && name !== 'test') {
    const leave = session.state === 'ready' && !input().value
      ? true
      : await confirmDialog({
        title: 'Leave the test?',
        body: 'Your test is still running. If you leave now, it will not be marked or saved.',
        confirm: 'Leave test',
        cancel: 'Stay',
        danger: true,
      });
    if (!leave) {
      history.replaceState(null, '', '#/test');
      input().focus();
      return;
    }
    abandonTest();
  }
  show(name);
}

/** In-page links (#main, guide contents) must not be mistaken for routes. */
function onDocumentClick(e) {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (href.startsWith('#/')) return;
  const target = document.getElementById(href.slice(1));
  if (!target) return;
  e.preventDefault();
  if (!target.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) {
    target.setAttribute('tabindex', '-1');
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/* ------------------------------------------------------------------ start */

function registerServiceWorker() {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !local) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

applySettings();
initSetupView();
initTestView();
initResultsView();
initProgressView();
syncSettingsForm = initSettingsView();
document.addEventListener('click', onDocumentClick);
window.addEventListener('hashchange', onHashChange);
show(routeFromHash());
registerServiceWorker();
