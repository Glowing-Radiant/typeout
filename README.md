# Type Out

Typing practice for SSC skill tests: CHSL English and Hindi typing, and the CGL Data Entry Speed Test (DEST).
It uses an exam-style timer and marks your work the way SSC describes it, with full and half mistakes. It is built to be
usable with a keyboard alone, with screen readers, and with large text or high contrast.

Live at **https://typeout.wondrellabs.com** once deployed.

## Features

- **Exam patterns**: SSC CHSL English (10 min, 35 WPM), SSC CHSL Hindi (10 min, 30 WPM), SSC CGL DEST (15 min, 2,000 key depressions), a 2-minute quick drill, and a custom pattern.
- **Two modes**: *Exam simulation* has no highlighting and no pause, like the SSC software. *Practice* highlights the current word, marks wrong words as you type and lets you pause.
- **SSC-style marking**: your text is lined up with the passage word by word. Missed, extra and wrong words are full mistakes. Spacing, capital letters, punctuation and word order are half mistakes. You get gross and net WPM, KDPH, error percentage and a pass or fail against your target and error limit.
- **Dictation**: the passage is read aloud in parts (a sentence or a set number of words), a few words ahead of you. Choose **Device voice** (speech synthesis only, nothing sent to screen readers), **My screen reader** (parts go to the screen reader through a live region, device voice silent) or **Off**. An idle timer either repeats the part, reads the next part anyway, or waits. You can hide the passage to type only from what you hear, have punctuation spoken, and pick the device voice and speed.
- **Mistake review**: a table of every mistake, plus the passage with your mistakes marked inline (shown with symbols and text, not colour alone).
- **Rules you can set**: backspace on or off, timer starting on the first key press, compensatory time for PwBD candidates (20 min per hour), and the error limit (UR 7%, reserved categories 10%, or a custom value).
- **Passages**: 8 English and 4 Hindi passages written for this app, or paste your own.
- **Progress**: history, averages, a chart of net speed and CSV export. Everything is stored in the browser's `localStorage`, and nothing is sent anywhere.
- **Accessibility**: the target is WCAG 2.2 AA. It has semantic landmarks, a skip link, focus management between views, a labelled timer, screen-reader announcements (time left, results, optional mistake alerts) and reading aids (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>/<kbd>W</kbd>/<kbd>S</kbd>/<kbd>T</kbd>/<kbd>P</kbd>) that read the passage aloud while you type. Light, dark and high-contrast themes are included, along with adjustable text size, spacing and typeface, reduced motion, and support for forced colours.
- **Offline**: a service worker caches the app after the first visit, and it can be installed as a PWA.

## Project layout

```
site/                 ← the app (static, no framework); copied to dist/ by the build
  index.html
  404.html            shown for unknown paths
  _headers            security headers for Cloudflare Pages
  manifest.webmanifest, sw.js
  assets/css/styles.css
  assets/js/app.js       UI, routing, test engine
  assets/js/scoring.js   word alignment and SSC-style evaluation (pure, tested)
  assets/js/passages.js  passage bank
  assets/js/presets.js   exam patterns and error limits
  assets/js/storage.js   localStorage wrapper
  assets/js/dictation.js read-aloud dictation (Web Speech API)
  assets/js/theme-init.js applies the saved theme before first paint
scripts/build.mjs        builds dist/ for deployment
tests/scoring.test.mjs   Node test suite for the scoring engine
.github/workflows/test.yml
```

## Run locally

You need nothing beyond Node (for the tests and build) and any static file server.

```bash
npm test
```

```bash
npm start
```

Then open http://localhost:8080. `npm start` runs a small Node server (`scripts/serve.mjs`) that turns caching off and applies the same security headers as production, so policy problems show up before you deploy. The service worker is turned off on localhost.

`npm run build` runs the tests and writes the deployable site to `dist/`, stamping the service worker cache with the commit.

## Deploy to Cloudflare Pages

`wondrellabs.com` is on Cloudflare DNS, so the subdomain connects in one step.

1. In the Cloudflare dashboard, open **Workers & Pages → Create → Pages → Connect to Git**, and choose the `Glowing-Radiant/typeout` repository.
2. Use these build settings:

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

   No environment variables are needed. If the build complains about the Node version, add `NODE_VERSION` = `22`.
3. **Save and Deploy.** The first build runs the tests and publishes to `typeout.pages.dev` (or a similar `*.pages.dev` name).
4. Open the project's **Custom domains** tab, select **Set up a custom domain**, enter `typeout.wondrellabs.com` and activate it. Cloudflare creates the DNS record and the certificate for you.

Every push to `main` then redeploys automatically. Pull requests get their own preview URLs. Builds run on Cloudflare, so they do not use GitHub Actions minutes.

`site/_headers` sets the security headers, including a strict Content Security Policy with no inline scripts or styles. Keep scripts and styles in files under `site/assets/`, or the policy will block them.

The GitHub Actions workflow (`.github/workflows/test.yml`) only runs the tests.

## How marking works

See the in-app **Guide** for the full explanation. In short:

- Errors = full mistakes + half mistakes ÷ 2
- Error % = errors ÷ passage words attempted × 100. Untyped text after your last word is not counted.
- Gross WPM = key depressions ÷ 5 ÷ minutes. Net WPM = (key depressions ÷ 5 − errors) ÷ minutes.
- You meet the standard when you reach the target key depressions in the time allowed and stay within the error limit.

SSC rules and error limits change between exams and years. The defaults follow recent notices. Candidates should check
the notice for their own exam and adjust the pattern or error limit to match.

## Adding passages

Add an entry to `site/assets/js/passages.js` with a unique `id`, `lang` (`en` or `hi`), a `title` and the `text`.
Separate paragraphs with a blank line. Aim for 400 words or more, so that a fast typist does not finish early. Only use text you have the rights to publish.

## Disclaimer

Type Out is an independent practice tool. It is not affiliated with the Staff Selection Commission.
