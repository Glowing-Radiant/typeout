# Type Out

Typing practice for SSC skill tests: CHSL English and Hindi typing, and the CGL Data Entry Speed Test (DEST).
It uses an exam-style timer and marks your work the way SSC describes it, with full and half mistakes. It is built to be
usable with a keyboard alone, with screen readers, and with large text or high contrast.

Live at **https://typeout.wondrellabs.com** once deployed.

## Features

- **Exam patterns**: SSC CHSL English (10 min, 35 WPM), SSC CHSL Hindi (10 min, 30 WPM), SSC CGL DEST (15 min, 2,000 key depressions), a 2-minute quick drill, and a custom pattern.
- **Two modes**: *Exam simulation* has no highlighting and no pause, like the SSC software. *Practice* highlights the current word, marks wrong words as you type and lets you pause.
- **SSC-style marking**: your text is lined up with the passage word by word. Missed, extra and wrong words are full mistakes. Spacing, capital letters, punctuation and word order are half mistakes. You get gross and net WPM, KDPH, error percentage and a pass or fail against your target and error limit.
- **Dictation**: the passage is read aloud in parts (a sentence or a set number of words). Each part is read once you have typed every word of the one before it; an option reads it a chosen number of words early instead, so there is no gap. Choose **Device voice** (speech synthesis only, nothing sent to screen readers), **My screen reader** (parts go to the screen reader through a live region, device voice silent) or **Off**. An idle timer either repeats the part, reads the next part anyway, or waits. You can hide the passage to type only from what you hear, have punctuation spoken, and pick the device voice and speed.
- **Mistake review**: a table of every mistake, plus the passage with your mistakes marked inline (shown with symbols and text, not colour alone).
- **Rules you can set**: backspace on or off, timer starting on the first key press, compensatory time for PwBD candidates (20 min per hour), and the error limit (UR 7%, reserved categories 10%, or a custom value).
- **Passages that never run out**: *New passage each time* (the default) takes a fresh passage from English or Hindi Wikipedia for every test, on exam-style subjects (economy, environment, science, governance, history and so on). It is cleaned for typing and credited under CC BY-SA 4.0. There are also 8 English and 4 Hindi passages written for this app, which are used offline, or you can paste your own.
- **Scoreboard**: after a test on CHSL English, CHSL Hindi, CGL DEST or the Quick drill (English and Hindi boards), you can choose to share your score under a display name. Exam simulation and Practice have separate scoreboards. The page shows the top 10 names for each pattern and mode, all time or for the last 7 days. The server marks the typed text again, so the numbers can't simply be made up.
- **Progress**: history, averages, a chart of net speed and CSV export, stored in the browser's `localStorage`. Nothing leaves the browser unless you share a score.
- **Accessibility**: the target is WCAG 2.2 AA. It has semantic landmarks, a skip link, focus management between views, a labelled timer, screen-reader announcements (time left, results, optional mistake alerts) and reading aids (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>/<kbd>W</kbd>/<kbd>S</kbd>/<kbd>T</kbd>/<kbd>P</kbd>) that read the passage aloud while you type. Light, dark and high-contrast themes are included, along with adjustable text size, spacing and typeface, reduced motion, and support for forced colours.
- **Offline**: a service worker caches the app after the first visit, and it can be installed as a PWA.

## Project layout

```
site/                 ← the app (static, no framework); copied to dist/ by the build
  index.html
  404.html            shown for unknown paths
  _headers            security headers for the static files (Workers static assets)
  manifest.webmanifest, sw.js
  assets/css/styles.css
  assets/js/app.js       UI, routing, test engine
  assets/js/scoring.js   word alignment and SSC-style evaluation (pure, tested)
  assets/js/passages.js  passage bank
  assets/js/presets.js   exam patterns and error limits
  assets/js/storage.js   localStorage wrapper
  assets/js/dictation.js read-aloud dictation (Web Speech API)
  assets/js/online.js    online passages (fetched ahead, kept in localStorage) and scoreboard calls
  assets/js/leaderboard.js scoreboard rules and name checks, shared with the server
  assets/js/theme-init.js applies the saved theme before first paint
server/worker.js         Cloudflare Worker entry: sends /api/* to the API, everything else is static
wrangler.jsonc           Worker configuration: static assets from dist/, the D1 binding
server/api.js            the API: passages, scores, re-marking, rate limit, D1 schema
server/wikipedia.js      fetches and cleans Wikipedia passages
scripts/build.mjs        builds dist/ for deployment
scripts/serve.mjs        local server for the site and the API
scripts/dev-d1.mjs       local stand-in for D1 (Node's built-in SQLite)
tests/                   Node tests: scoring engine, build, dictation, API
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

`npm run preview` builds the site and serves `dist/` the same way, to check the production build.

Then open http://localhost:8080. `npm start` runs a small Node server (`scripts/serve.mjs`) that turns caching off and applies the same security headers as production, so policy problems show up before you deploy. The service worker is turned off on localhost.

The same server runs the API. Passages come from the real Wikipedia, and scores are kept in `.dev/typeout.sqlite` (ignored by git; delete it to start over). The local database needs Node 22.13 or later. On older Node versions the scoreboard says it is not set up, and the database tests are skipped.

`npm run build` runs the tests and writes the deployable site to `dist/`. It adds `?v=<build>` to every script and stylesheet reference (HTML, module imports and the service worker's file list), so visitors never get a mix of old and new files after a deploy, and it fails if any reference is left unversioned.

### How updates reach visitors

- Pages are fetched from the network first; the offline copy is only used when there is no connection.
- Scripts and styles are cached by their versioned URL, so a fresh page always loads its own build.
- Each deploy installs a new service worker with a new cache and deletes the old one.
- A tab left open checks for a newer build every 30 minutes and when it comes back into view, and offers **Reload to update**. The notice never appears during a test.

## Deploy to Cloudflare Workers

The site runs as a Cloudflare Worker with static assets, configured in `wrangler.jsonc`. The files in `dist/` are served directly. Only `/api/*` runs the Worker script (`server/worker.js`), which uses a D1 database for the scoreboard. All of this fits the Workers Free plan. `wondrellabs.com` is on Cloudflare DNS, so the subdomain connects in one step.

1. Create the database (already done for the live site): in the Cloudflare dashboard, open **Storage & Databases → D1 SQL Database → Create**, name it `typeout`, and copy its **Database ID**.
2. Put that ID in `database_id` in `wrangler.jsonc` (it holds the live database's ID now; change it only if you use a different database). Check that `name` matches the Worker's name in the dashboard; otherwise the deploy creates a second Worker. The ID is not a secret.
3. Connect the repository: **Workers & Pages → Create → Import a repository**, choose `Glowing-Radiant/typeout`, and use these build settings (on an existing Worker they are under **Settings → Build**):

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` |

   No environment variables are needed. If the build complains about the Node version, add `NODE_VERSION` = `22`.
4. Push, or retry the latest build. The deploy reads `wrangler.jsonc`, uploads `dist/` and the script, and attaches the database. The tables are created on first use, so there is no schema to run.
5. Under the Worker's **Settings → Domains & Routes**, add the custom domain `typeout.wondrellabs.com`. Cloudflare creates the DNS record and the certificate.
6. Optional: under **Settings → Variables and Secrets**, add a secret `SCORE_SALT` set to any random text. It goes into the daily code used for rate limiting.

Bindings come from `wrangler.jsonc`, not the dashboard. Each deploy replaces what is in the dashboard with what is in the file.

Every push to `main` then redeploys automatically. Builds run on Cloudflare, so they do not use GitHub Actions minutes.

`site/_headers` sets the security headers, including a strict Content Security Policy with no inline scripts or styles. Keep scripts and styles in files under `site/assets/`, or the policy will block them.

The GitHub Actions workflow (`.github/workflows/test.yml`) only runs the tests.

## Online passages and the scoreboard

**Passages.** `GET /api/passage?lang=en|hi` picks a random exam-style topic (listed in `server/wikipedia.js`), runs a random-order Wikipedia search on it, and takes a long article from the results. It then cleans the text:

- It removes headings, reference and "See also" sections, bracketed asides, lists, captions, formulas, and paragraphs heavy with figures. English passages must be plain ASCII after cleaning, and Hindi passages Devanagari only.
- It replaces curly quotes, long dashes and ellipses with ordinary keys.
- It keeps 300 to 800 words.

Articles whose text matches a short filter of unsuitable subjects are skipped. Every passage is stored in D1 so scores on it can be checked later. If Wikipedia can't be reached, a passage stored earlier is served instead. The page keeps two passages per language in `localStorage`, so tests start instantly and work offline for a while, and it falls back to the built-in passages when it has none.

Wikipedia isn't written in SSC style, so expect more names and technical terms than in the built-in passages. The topic search keeps subjects educational, but it can't guarantee every article suits an exam. Political or other sensitive subjects can occasionally come up. To change what comes up, adjust `TOPICS` and `UNSUITABLE` in `server/wikipedia.js`.

**Scores.** `POST /api/scores` receives the name, pattern, passage id, typed text, time taken and key-press count. It doesn't take a score from the browser. The server re-marks the text with `site/assets/js/scoring.js` and applies the rules in `site/assets/js/leaderboard.js`:

- Exam simulation or Practice, on a built-in or stored online passage in the pattern's language. Each pattern and mode has its own scoreboard. Scores are stored under the board id for Exam simulation and the board id plus `-practice` for Practice. Board ids are `chsl-en`, `chsl-hi`, `cgl-dest`, `quick-en` and `quick-hi`; the Quick drill has one board per language.
- The test ran until time was up or reached the end of the passage, and lasted at least a minute.
- The attempt met the target key depressions with at most 10% errors.
- Gross speed is 200 WPM or less.
- There are at most 6 shares per visitor per hour. Visitors are identified by a daily-changing hash of their IP address. The address itself isn't stored.

`GET /api/scores?board=chsl-en|chsl-hi|cgl-dest|quick-en|quick-hi&mode=exam|practice&period=all|week` returns the top 10 names, each with its best score.

**Limits.** Without accounts, a determined person could still send typed text and a time they made up. Re-marking, the speed cap, the key-press check and the rate limit make that hard, not impossible. To remove a score, run SQL in the D1 console, for example `DELETE FROM scores WHERE name = 'Some name';`.

**CPU time.** Re-marking a full attempt takes roughly 10–20 ms of CPU. The scoring engine was optimised for this, and gives the same results as before. That is around the Workers Free plan's 10 ms per request, which Cloudflare allows to be exceeded occasionally. Shares are rare compared with page views, so this should be fine. If shares start failing with "Worker exceeded resource limits" (error 1102), the Workers Paid plan raises the limit.

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
