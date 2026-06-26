# viewer2pdf

Save documents from **canvas/image-based web viewers that block downloading and printing** into a clean, multi-page **PDF**.

Some portals (job sites, HR systems, banking, govt) show your documents in a custom viewer that renders each page to a `<canvas>` or `<img>` and disables right-click / download / print. `viewer2pdf` launches a real browser, lets you log in, then walks the viewer page-by-page, grabs each rendered page at full resolution, and assembles a PDF.

> Use it only on documents you are entitled to access (your own account, with your own login). It automates *your* browser doing what you could do by hand.

---

## How it works

1. **Launches a real Chromium window** with a *persistent profile* — you log in once and it's remembered next time.
2. **You navigate** to the document and open the viewer on screen.
3. **It captures** every page: reads the rendered `<canvas>`/`<img>`, clicks **Next** (or presses an arrow key), waits for each page to finish rendering (skips blank/half-painted frames), and stops when the page stops changing.
4. **Assembles a PDF** (one frame per page, native resolution).

---

## Setup

```bash
npm install
npx playwright install chromium   # one-time browser download (~110 MB)
```

Requires Node 18+.

---

## Quick start

**Single document:**
```bash
node src/cli.mjs --url "https://portal.example.com/mydoc" --out ./MyDoc.pdf
```
A browser opens. Log in, open the document so it's visible, return to the terminal and press **ENTER**. The PDF is written to `--out`.

**Several documents in one session** (like an "Offer Documents" list with multiple files):
```bash
node src/cli.mjs --url "https://portal.example.com" --outdir ./out --multi
```
For each document: open it on screen, type a filename, press ENTER. Type `q` when done.

---

## Options

| Flag | Description |
|------|-------------|
| `--url <url>` | Page to open on launch |
| `--out <file.pdf>` | Output PDF (single capture) |
| `--outdir <dir>` | Output folder for `--multi` |
| `--multi` | Capture several documents interactively |
| `--profile <dir>` | Persistent browser profile (default `./.profile`) — keeps you logged in |
| `--png` | Also dump each page as a PNG next to the PDF |
| `--keep-open` | Leave the browser open after finishing |
| `--config <file> --site <name>` | Load per-site overrides from a JSON config |
| `--next "Next,›"` | Labels for the *next page* control (comma-separated) |
| `--prev "Prev,‹"` | Labels for the *previous page* control |
| `--nav-method <m>` | `button` (default), `key`, or `scroll` |
| `--capture-mode <m>` | `auto` (default), `canvas`, `img`, or `screenshot` |
| `--capture-selector <css>` | Force which element to capture |
| `--max-pages <n>` | Safety cap (default 200) |
| `--no-rewind` | Don't rewind to page 1 before capturing |
| `--wait-selector <css>` | Capture when this selector appears (no ENTER prompt) |
| `--wait-ms <n>` | Capture after a fixed delay (no ENTER prompt) |
| `--cdp <url>` | Attach to a Chrome you started with `--remote-debugging-port` instead of launching |

Run `node src/cli.mjs --help` for the full list.

---

## Tuning a new site

Most viewers fall into one of a few shapes. Start with `auto`; if pages don't advance or come out blank, adjust:

- **Pages don't advance** → the Next button has different text. Inspect it and set `--next "<label>"`, or try `--nav-method key` (arrow keys) or `--nav-method scroll`.
- **Captured pages are blank/black** → the viewer paints slowly; the defaults already skip all-white and all-black frames. If a real page is very light, lower `blankMin`; if it has a dark background, raise `blankMax` toward `1`.
- **Wrong element captured** → set `--capture-mode canvas|img` or pin it with `--capture-selector`.
- **Stops too early / loops** → capture stops when the rendered frame repeats. If a doc has genuinely identical pages, raise `--max-pages` and note dedup may merge them.

Save working settings as a named site in a config file so you don't retype them:

```jsonc
// configs/mysite.json
{
  "defaults": { "captureMode": "canvas", "nextLabels": ["Next"], "prevLabels": ["Prev"] },
  "sites": {
    "mysite": { "url": "https://portal.example.com" }
  }
}
```
```bash
node src/cli.mjs --config configs/mysite.json --site mysite --outdir ./out --multi
```

See [`configs/default.json`](configs/default.json) for the full schema and [`configs/example.json`](configs/example.json) for a worked example.

---

## Project layout

```
viewer2pdf/
  src/
    cli.mjs       # CLI: launch/attach, prompts, single + multi modes
    browser.mjs   # launch (persistent profile) or attach (CDP)
    capture.mjs   # the engine: detect target, navigate, blank/stability-aware capture, build PDF
    config.mjs    # defaults + config-file/site merge + flag overrides
  configs/
    default.json  # reference schema + generic profiles (pdf.js, image slider)
    example.json  # worked example
```

---

## Limitations & notes

- **Resolution** is whatever the viewer renders to the canvas/img (often ~130 DPI). Zooming the viewer in before capturing yields sharper pages.
- **DRM / encrypted streams** that never expose pixels to the page can't be captured this way.
- The output is **image-based** (not selectable text). Run OCR afterward if you need searchable text.
- `screenshot` capture mode falls back to clipping the element and uses frame size for blank detection (less precise than canvas mode).

## License
MIT
