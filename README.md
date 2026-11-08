# Type Out

Typing practice for SSC skill tests: CHSL English and Hindi typing, and the CGL Data Entry Speed Test (DEST).
It uses an exam-style timer and marks your work the way SSC describes it, with full and half mistakes. It is built to be
usable with a keyboard alone, with screen readers, and with large text or high contrast.

Live at **https://typeout.wondrellabs.com** once deployed.

## Features

- **Exam patterns**: SSC CHSL English (10 min, 35 WPM), SSC CHSL Hindi (10 min, 30 WPM), SSC CGL DEST (15 min, 2,000 key depressions), a 2-minute quick drill, and a custom pattern.
- **Two modes**: *Exam simulation* has no highlighting and no pause, like the SSC software. *Practice* highlights the current word, marks wrong words as you type and lets you pause.
- **SSC-style marking**: your text is lined up with the passage word by word. Missed, extra and wrong words are full mistakes. Spacing, capital letters, punctuation and word order are half mistakes. You get gross and net WPM, KDPH, error percentage and a pass or fail against your target and error limit.
- **Mistake review**: a table of every mistake, plus the passage with your mistakes marked inline (shown with symbols and text, not colour alone).
- **Rules you can set**: backspace on or off, timer starting on the first key press, compensatory time for PwBD candidates (20 min per hour), and the error limit (UR 7%, reserved categories 10%, or a custom value).
- **Passages**: 8 English and 4 Hindi passages written for this app, or paste your own.
- **Progress**: history, averages, a chart of net speed and CSV export. Everything is stored in the browser's `localStorage`, and nothing is sent anywhere.
- **Accessibility**: the target is WCAG 2.2 AA. It has semantic landmarks, a skip link, focus management between views, a labelled timer, screen-reader announcements (time left, results, optional mistake alerts) and reading aids (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>/<kbd>W</kbd>/<kbd>S</kbd>/<kbd>T</kbd>/<kbd>P</kbd>) that read the passage aloud while you type. Light, dark and high-contrast themes are included, along with adjustable text size, spacing and typeface, reduced motion, and support for forced colours.
- **Offline**: a service worker caches the app after the first visit, and it can be installed as a PWA.

## Project layout

```
site/                 ← everything that gets deployed (static, no build step)
  index.html
  404.html            redirects unknown paths to the app
  CNAME               custom domain: typeout.wondrellabs.com
  manifest.webmanifest, sw.js
  assets/css/styles.css
  assets/js/app.js       UI, routing, test engine
  assets/js/scoring.js   word alignment and SSC-style evaluation (pure, tested)
  assets/js/passages.js  passage bank
  assets/js/presets.js   exam patterns and error limits
  assets/js/storage.js   localStorage wrapper
tests/scoring.test.mjs   Node test suite for the scoring engine
.github/workflows/deploy.yml
```

## Run locally

You need nothing beyond Node (for the tests) and any static file server.

```bash
npm test
```

```bash
npm start
```

Then open http://localhost:8080. `npm start` uses Python's built-in server. You can also run `npx serve site` or any other static server. The service worker is turned off on localhost, so your edits always show.

## Deploy to GitHub Pages with the custom subdomain

1. **Create a GitHub repository** (for example `typeout`) and push this folder to its `main` branch:

   ```bash
   git init -b main
   ```

   ```bash
   git add . && git commit -m "Type Out"
   ```

   ```bash
   git remote add origin https://github.com/<your-account>/typeout.git
   ```

   ```bash
   git push -u origin main
   ```

2. **Turn on Pages**: in the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. The workflow in `.github/workflows/deploy.yml` runs the tests and then deploys the `site/` folder on every push to `main`.

3. **Add the DNS record** where `wondrellabs.com` is managed:

   | Type  | Name / Host | Value / Target              |
   |-------|-------------|-----------------------------|
   | CNAME | `typeout`   | `<your-account>.github.io`  |

   Use your GitHub user or organisation name, without the repository name. If you use Cloudflare, set the record to **DNS only** (grey cloud) until GitHub has issued the certificate.

4. **Set the custom domain**: in **Settings → Pages → Custom domain**, enter `typeout.wondrellabs.com` and save. When the DNS check passes, tick **Enforce HTTPS**. The certificate can take a few minutes, and sometimes up to an hour.

5. **Recommended: verify the domain** at **GitHub → your profile or organisation Settings → Pages → Add a domain** (`wondrellabs.com`). This stops anyone else from claiming your subdomains on GitHub Pages.

With an Actions-based deploy, GitHub uses the custom domain saved in the repository settings, so step 4 is required. `site/CNAME` is kept so the domain is also recorded in the repository.

To use another subdomain, change `site/CNAME`, the DNS record and the Pages setting.

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
