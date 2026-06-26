#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { buildConfig } from './config.mjs';
import { launchBrowser, attachBrowser } from './browser.mjs';
import { captureDocument, assemblePdf, dumpPngs } from './capture.mjs';

// ---------- tiny arg parser ----------
function parseArgs(argv) {
  const o = {}; const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const next = () => a[++i];
    switch (k) {
      case '-h': case '--help': o.help = true; break;
      case '--url': o.url = next(); break;
      case '--out': o.out = next(); break;
      case '--outdir': o.outdir = next(); break;
      case '--profile': o.profile = next(); break;
      case '--config': o.config = next(); break;
      case '--site': o.site = next(); break;
      case '--cdp': o.cdp = next(); break;
      case '--channel': o.channel = next(); break;
      case '--multi': o.multi = true; break;
      case '--wait-selector': o.waitSelector = next(); break;
      case '--wait-ms': o.waitMs = parseInt(next(), 10); break;
      case '--next': o.next = next(); break;
      case '--prev': o.prev = next(); break;
      case '--capture-mode': o.captureMode = next(); break;
      case '--capture-selector': o.captureSelector = next(); break;
      case '--nav-method': o.navMethod = next(); break;
      case '--max-pages': o.maxPages = parseInt(next(), 10); break;
      case '--no-rewind': o.rewindFirst = false; break;
      case '--png': o.png = true; break;
      case '--keep-open': o.keepOpen = true; break;
      default: console.error(`Unknown option: ${k}`); o.help = true;
    }
  }
  return o;
}

const HELP = `
viewer2pdf — capture a canvas/image document viewer (that blocks download/print) into a PDF.

USAGE
  viewer2pdf --url <url> --out <file.pdf> [options]
  viewer2pdf --url <url> --outdir <dir> --multi        # capture several docs in one session

HOW IT WORKS
  1. Launches a real Chromium window with a saved profile (you log in once; it's remembered).
  2. You navigate to the document and open the viewer on screen.
  3. Press ENTER (or use --wait-selector/--wait-ms) and it walks every page and builds the PDF.

COMMON OPTIONS
  --url <url>            Page to open on launch
  --out <file.pdf>       Output PDF (single capture)
  --outdir <dir>         Output folder for --multi mode
  --multi                Interactive loop: name + capture several documents, then 'q' to finish
  --profile <dir>        Persistent browser profile dir (default: ./.profile)
  --png                  Also dump each page as PNG next to the PDF
  --keep-open            Leave the browser open after finishing

SITE TUNING (or put these in a --config JSON, see configs/)
  --config <file> --site <name>   Load overrides from a config file / named site profile
  --next "Next,›"        Comma-separated labels for the "next page" control
  --prev "Prev,‹"        Comma-separated labels for the "previous page" control
  --nav-method <m>       button | key | scroll        (default: button)
  --capture-mode <m>     auto | canvas | img | screenshot   (default: auto)
  --capture-selector <css>   Force the element to capture
  --max-pages <n>        Safety cap (default 200)
  --no-rewind            Don't rewind to page 1 before capturing

NON-INTERACTIVE TRIGGERS
  --wait-selector <css>  Wait for this selector to appear, then capture (no ENTER prompt)
  --wait-ms <n>          Wait n ms, then capture

ATTACH MODE (instead of launching)
  --cdp <url>            Attach to a Chrome started with --remote-debugging-port (e.g. http://localhost:9222)

SETUP
  npm install
  npx playwright install chromium     # one-time browser download
`;

async function trigger(page, cli, rl, promptMsg) {
  if (cli.waitSelector) {
    process.stdout.write(`Waiting for selector ${cli.waitSelector} ...\n`);
    await page.waitForSelector(cli.waitSelector, { timeout: 0 });
  } else if (cli.waitMs) {
    await page.waitForTimeout(cli.waitMs);
  } else if (rl) {
    await rl.question(promptMsg);
  }
}

async function main() {
  const cli = parseArgs(process.argv);
  if (cli.help || (!cli.url && !cli.cdp)) { console.log(HELP); process.exit(cli.help ? 0 : 1); }

  const cfg = buildConfig(cli);
  const profileDir = resolve(cli.profile || './.profile');

  const interactive = !cli.waitSelector && !cli.waitMs;
  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;

  let br;
  if (cli.cdp) {
    console.log(`Attaching to ${cli.cdp} ...`);
    br = await attachBrowser({ cdpUrl: cli.cdp });
    if (cli.url) await br.page.goto(cli.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  } else {
    console.log(`Launching Chromium (profile: ${profileDir}) ...`);
    br = await launchBrowser({ profileDir, url: cli.url, channel: cli.channel });
  }
  const { page, close } = br;

  try {
    if (cli.multi) {
      const outdir = resolve(cli.outdir || './captures');
      console.log(`\nMULTI mode. PDFs will be saved in: ${outdir}`);
      console.log(`Log in if needed. For each document: open it on screen, then enter a filename.\n`);
      for (;;) {
        const name = rl ? (await rl.question(`Filename for the open document (no extension), or 'q' to finish: `)).trim() : 'q';
        if (!name || name.toLowerCase() === 'q') break;
        const out = join(outdir, name.replace(/[^\w.-]+/g, '_') + '.pdf');
        console.log(`Capturing "${name}" ...`);
        const { pages, indicator } = await captureDocument(page, cfg, (m) => console.log(m));
        if (!pages.length) { console.log('  No pages captured — is the document open and visible?'); continue; }
        await assemblePdf(pages, out);
        if (cli.png) dumpPngs(pages, out.replace(/\.pdf$/i, '_png'));
        console.log(`  -> ${out}  (${pages.length} pages${indicator ? ', viewer said ' + indicator : ''})`);
      }
    } else {
      const out = resolve(cli.out || './document.pdf');
      await trigger(page, cli, rl, '\nOpen the document on screen, then press ENTER to capture... ');
      console.log('Capturing ...');
      const { pages, indicator } = await captureDocument(page, cfg, (m) => console.log(m));
      if (!pages.length) { console.error('No pages captured — is the document open and visible? Try --capture-mode or --capture-selector.'); }
      else {
        await assemblePdf(pages, out);
        if (cli.png) dumpPngs(pages, out.replace(/\.pdf$/i, '_png'));
        console.log(`\nDone: ${out}  (${pages.length} pages${indicator ? ', viewer said ' + indicator : ''})`);
      }
    }
  } finally {
    rl?.close();
    if (cli.keepOpen) console.log('Leaving browser open (--keep-open).');
    else await close();
  }
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
