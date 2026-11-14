// Online passages from Wikipedia (English and Hindi).
//
// A random long article on an exam-style topic is fetched as plain text and cleaned into something fair to type: headings,
// reference sections, bracketed asides, lists, captions, formulas and number-heavy paragraphs are
// dropped, and typographic punctuation is replaced with keys found on an ordinary keyboard.
// Wikipedia text is licensed CC BY-SA 4.0, so every passage carries its source and licence.

const USER_AGENT = 'TypeOut/1.0 (https://typeout.wondrellabs.com; typing practice for SSC skill tests)';

export const LICENSE = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' };

// Article size in bytes of wikitext. Devanagari takes three bytes a character, so Hindi needs more.
const MIN_ARTICLE_BYTES = { en: 15000, hi: 24000 };
const TARGET_WORDS = 600; // stop adding paragraphs after this
const MAX_WORDS = 800;
const MIN_WORDS = 300;
const MIN_PARAGRAPH_WORDS = { en: 25, hi: 20 };
const MAX_DIGIT_SHARE = 0.04;

const STOP_SECTIONS = {
  en: /^(see also|references|notes|notes and references|external links|further reading|bibliography|sources|citations|footnotes|works cited|gallery|filmography|discography|awards|awards and honours|honours|honors|selected works|publications|works)$/i,
  hi: /^(सन्दर्भ|संदर्भ|सन्दर्भ सूची|संदर्भ सूची|बाहरी कड़ियाँ|बाहरी कडियाँ|बाहरी कड़ियां|बाहरी सूत्र|इन्हें भी देखें|इन्हे भी देखें|यह भी देखें|टीका टिप्पणी|टिप्पणी|टिप्पणियाँ|स्रोत|ग्रन्थसूची|ग्रंथसूची)$/,
};

/** Clean one paragraph, or return null if it is not fair or pleasant to type. */
export function cleanParagraph(line, lang) {
  let s = line.normalize('NFC');
  // Bracketed asides (pronunciations, dates, translations, citations); repeat for nested brackets.
  for (let k = 0; k < 3; k++) s = s.replace(/\s*\([^()]*\)/gu, '').replace(/\s*\[[^[\]]*\]/gu, '');
  s = s
    .replace(/[  -​  　]/gu, ' ')
    .replace(/[‌‍­﻿]/gu, '')
    .replace(/[‘’‚‛′]/gu, "'")
    .replace(/[“”„‟″]/gu, '"')
    .replace(/[‐‑‒–]/gu, '-')
    .replace(/\s*—\s*/gu, ', ')
    .replace(/…/gu, '...');
  // Accented Latin letters (café, Pradesh with macrons) become plain letters in English passages.
  if (lang === 'en') s = s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  s = s
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?।])/gu, '$1')
    .replace(/,(\s*,)+/gu, ',')
    .replace(/([,;:])(?=[.;:!?।])/gu, '')
    .trim();

  if (/[{}<>\\|=_^~`#@*[\]()]/u.test(s)) return null; // leftover markup, formulas or brackets
  if (lang === 'en' && /[^\x20-\x7E]/u.test(s)) return null;
  if (lang === 'hi') {
    if (/[A-Za-z]/u.test(s)) return null;
    if (/[^ऀ-ॿ0-9 .,;:?!'"\-/%]/u.test(s)) return null;
  }
  if (!/[.?!।]$/u.test(s)) return null; // lists and captions rarely end like a sentence
  if (s.split(' ').length < MIN_PARAGRAPH_WORDS[lang]) return null;
  const digits = (s.match(/[0-9०-९]/gu) ?? []).length;
  if (digits / s.length > MAX_DIGIT_SHARE) return null;
  return s;
}

const countWords = (s) => s.split(' ').filter(Boolean).length;

/** Turn a plain-text article extract into a passage, or null if too little of it is usable. */
export function cleanExtract(extract, lang) {
  const paragraphs = [];
  let words = 0;
  for (const raw of String(extract ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^=+\s*(.*?)\s*=+$/u);
    if (heading) {
      if (STOP_SECTIONS[lang].test(heading[1])) break;
      continue;
    }
    const p = cleanParagraph(line, lang);
    if (!p) continue;
    const n = countWords(p);
    if (words + n > MAX_WORDS) {
      // Keep whole sentences from the paragraph that would run over.
      const kept = [];
      for (const sentence of p.split(/(?<=[.?!।])\s+/u)) {
        const k = countWords(sentence);
        if (words + k > MAX_WORDS) break;
        kept.push(sentence);
        words += k;
      }
      if (kept.length) paragraphs.push(kept.join(' '));
      break;
    }
    paragraphs.push(p);
    words += n;
    if (words >= TARGET_WORDS) break;
  }
  return words >= MIN_WORDS ? paragraphs.join('\n\n') : null;
}

async function api(lang, params, fetchImpl) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) url.searchParams.set(k, v);
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  return res.json();
}

// Topics in the spirit of SSC skill-test passages. Each request searches one at random and takes a
// random long article from the results, which keeps passages varied but on subjects fit for exam
// practice. Fully random articles were tried first and too often landed on unsuitable subjects.
export const TOPICS = {
  en: [
    'Indian economy', 'agriculture in India', 'renewable energy', 'water conservation', 'climate change',
    'biodiversity', 'national parks of India', 'public health', 'education in India', 'Constitution of India',
    'Indian Space Research Organisation', 'Indian Railways', 'monsoon', 'rivers of India', 'Indian independence movement',
    'Mughal architecture', 'classical music of India', 'Indian festivals', 'banking in India', 'rural development',
    'urban planning', 'waste management', 'forest conservation', 'digital infrastructure', 'local self-government',
    'science and technology in India', 'history of science', 'astronomy', 'geography of India', 'cooperative movement',
    'handicrafts of India', 'tourism in India', 'Indian cuisine', 'Olympic sports', 'world heritage sites in India',
    'ocean', 'volcano', 'earthquake engineering', 'nutrition', 'vaccination', 'public library', 'postal service',
  ],
  hi: [
    'भारतीय अर्थव्यवस्था', 'कृषि', 'नवीकरणीय ऊर्जा', 'जल संरक्षण', 'जलवायु परिवर्तन', 'जैव विविधता', 'राष्ट्रीय उद्यान',
    'सार्वजनिक स्वास्थ्य', 'शिक्षा', 'भारत का संविधान', 'भारतीय अंतरिक्ष अनुसंधान संगठन', 'भारतीय रेल', 'मानसून',
    'भारत की नदियाँ', 'भारतीय स्वतंत्रता संग्राम', 'स्थापत्य कला', 'भारतीय शास्त्रीय संगीत', 'त्योहार', 'बैंक',
    'ग्रामीण विकास', 'पंचायती राज', 'वन संरक्षण', 'पर्यावरण', 'विज्ञान', 'खगोल विज्ञान', 'भारत का भूगोल',
    'हस्तशिल्प', 'पर्यटन', 'हिन्दी साहित्य', 'खेल', 'विश्व धरोहर', 'महासागर', 'पोषण', 'टीकाकरण', 'पुस्तकालय', 'डाक सेवा',
  ],
};

// Subjects that do not belong in a practice passage, whatever the topic search returns.
const UNSUITABLE = {
  en: /(sex|sexual|sexually|porn|pornograph\w*|erotic\w*|nude|nudity|rape[ds]?|prostitut\w*|incest|p(a)?edophil\w*|lolicon|genocide|massacre\w*|torture\w*|beheading|suicide\w*|terroris\w*)/iu,
  hi: /(यौन|सेक्स|अश्लील|बलात्कार|वेश्या|नग्न|नरसंहार|आत्महत्या|आतंकवाद|यातना)/u,
};

async function topicCandidates(lang, fetchImpl) {
  const topics = TOPICS[lang];
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const data = await api(lang, {
    action: 'query',
    list: 'search',
    srsearch: topic,
    srsort: 'random',
    srnamespace: '0',
    srlimit: '20',
    srprop: 'size|wordcount',
  }, fetchImpl);
  return (data.query?.search ?? [])
    .filter((p) => p.size >= MIN_ARTICLE_BYTES[lang] && !/^lists? of|सूची/iu.test(p.title) && !UNSUITABLE[lang].test(p.title));
}

/**
 * Fetch a random article on an exam-style topic and clean it into a passage.
 * @param {'en'|'hi'} lang
 * @returns {Promise<object|null>} {id, lang, title, text, source} or null if none was usable
 */
export async function fetchWikipediaPassage(lang, { fetch: fetchImpl = fetch, rounds = 3 } = {}) {
  for (let round = 0; round < rounds; round++) {
    const candidates = (await topicCandidates(lang, fetchImpl)).slice(0, 2);
    for (const candidate of candidates) {
      const data = await api(lang, {
        action: 'query',
        prop: 'extracts|info',
        explaintext: '1',
        exsectionformat: 'wiki',
        inprop: 'url',
        pageids: String(candidate.pageid),
      }, fetchImpl);
      const page = data.query?.pages?.[0];
      const text = page?.extract ? cleanExtract(page.extract, lang) : null;
      if (!text || UNSUITABLE[lang].test(text)) continue;
      return {
        id: `wiki-${lang}-${page.pageid}-${page.lastrevid}`,
        lang,
        title: page.title,
        text,
        source: {
          name: 'Wikipedia',
          url: page.fullurl || `https://${lang}.wikipedia.org/?curid=${page.pageid}`,
          license: LICENSE.name,
          licenseUrl: LICENSE.url,
        },
      };
    }
  }
  return null;
}
