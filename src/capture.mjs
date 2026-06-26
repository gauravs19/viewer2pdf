import { PDFDocument } from 'pdf-lib';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (page, ms) => page.waitForTimeout(ms);

/**
 * Read ONE frame from the page. Returns { url, tail, nw, w, h } or null.
 *  - canvas  -> toDataURL + non-white ratio (nw)
 *  - data:img -> the data URL + nw (if drawable)
 *  - otherwise -> Node-side screenshot of the element's box (nw = null; stability + size used instead)
 */
async function readFrameOnce(page, cfg) {
  const r = await page.evaluate((cfg) => {
    const nwOf = (drawable) => {
      try {
        const t = document.createElement('canvas'); t.width = 24; t.height = 32;
        const tc = t.getContext('2d'); tc.drawImage(drawable, 0, 0, 24, 32);
        const d = tc.getImageData(0, 0, 24, 32).data; let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) n++;
        return n / (d.length / 4);
      } catch (e) { return -1; }
    };
    // intersection area of a rect with the viewport
    const vpArea = (r) => {
      const W = innerWidth, H = innerHeight;
      const x = Math.max(0, Math.min(W, r.right) - Math.max(0, r.left));
      const y = Math.max(0, Math.min(H, r.bottom) - Math.max(0, r.top));
      return x * y;
    };
    // pick the element most visible in the viewport; when useNw, prefer non-blank ones
    // (handles viewers like pdf.js that keep several canvases, some blank/placeholder)
    const pick = (sel, useNw) => {
      const cands = [];
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 60 || r.height < 60) continue;
        const va = vpArea(r); if (va <= 0) continue;
        let nw = 1; if (useNw) { nw = nwOf(el); if (nw < 0) nw = 1; }
        cands.push({ el, box: r, va, nw });
      }
      if (!cands.length) return null;
      const nonblank = cands.filter((c) => c.nw > cfg.blankMin);
      const pool = (nonblank.length ? nonblank : cands).sort((a, b) => b.va - a.va);
      return { el: pool[0].el, box: pool[0].box };
    };

    let target = null;
    if (cfg.captureSelector) {
      const el = document.querySelector(cfg.captureSelector);
      if (el) { const b = el.getBoundingClientRect(); target = { el, box: b }; }
    }
    const tryCanvas = () => pick('canvas', true);
    const tryImg = () => pick('img', false);

    // choose by mode
    let chosen = target;
    if (!chosen) {
      if (cfg.captureMode === 'canvas') chosen = tryCanvas();
      else if (cfg.captureMode === 'img') chosen = tryImg();
      else if (cfg.captureMode === 'screenshot') chosen = tryCanvas() || tryImg();
      else chosen = tryCanvas() || tryImg(); // auto
    }
    if (!chosen) return null;
    const { el, box } = chosen;
    const bx = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };

    if (el.tagName === 'CANVAS' && cfg.captureMode !== 'screenshot') {
      try {
        const url = el.toDataURL('image/png');
        return { url, tail: url.slice(-28), nw: nwOf(el, el.width, el.height), w: el.width, h: el.height };
      } catch (e) { /* tainted -> fall through to screenshot */ }
    }
    if (el.tagName === 'IMG' && (el.src || '').startsWith('data:') && cfg.captureMode !== 'screenshot') {
      let nw = -1; try { nw = nwOf(el, el.naturalWidth, el.naturalHeight); } catch (e) {}
      return { url: el.src, tail: el.src.slice(-28), nw, w: el.naturalWidth, h: el.naturalHeight };
    }
    // need a Node-side screenshot of this box
    return { needScreenshot: true, box: bx };
  }, cfg);

  if (!r) return null;
  if (r.url) return r;
  if (r.needScreenshot) {
    const clip = { x: r.box.x, y: r.box.y, width: r.box.w, height: r.box.h };
    if (clip.width < 2 || clip.height < 2) return null;
    const buf = await page.screenshot({ clip });
    const url = 'data:image/png;base64,' + buf.toString('base64');
    return { url, tail: url.slice(-28), nw: null, w: r.box.w, h: r.box.h, bytes: buf.length };
  }
  return null;
}

const frameReady = (f, cfg) => {
  if (!f || !f.url) return false;
  if (f.nw === null) return (f.bytes ?? f.url.length) > 4000;   // screenshot path: skip tiny/blank frames
  return f.nw > cfg.blankMin && f.nw < cfg.blankMax;             // canvas/img path: skip all-white & all-black
};

/** Poll until a fully-rendered, stable frame appears (optionally different from notTail). */
async function readReady(page, cfg, notTail = null) {
  let prev = null;
  for (let i = 0; i < cfg.maxPollsPerPage; i++) {
    const f = await readFrameOnce(page, cfg);
    if (frameReady(f, cfg) && f.tail === prev && (notTail === null || f.tail !== notTail)) return f;
    prev = f?.tail;
    await sleep(page, cfg.pollMs);
  }
  return await readFrameOnce(page, cfg);
}

/** Click the first visible element whose trimmed text equals one of `labels`. */
function clickLabel(page, labels) {
  return page.evaluate((labels) => {
    const els = [...document.querySelectorAll('button,a,[role=button],span,div,mat-icon,i')];
    for (const e of els) {
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      const al = (e.getAttribute('aria-label') || '').trim();
      const ti = (e.getAttribute('title') || '').trim();
      if (labels.includes(t) || labels.includes(al) || labels.includes(ti)) {
        const el = e.closest('button') || e;
        if (el.getBoundingClientRect().width > 0) { el.click(); return true; }
      }
    }
    return false;
  }, labels);
}

async function navNext(page, cfg) {
  if (cfg.navMethod === 'key') { await page.keyboard.press(cfg.nextKey); return true; }
  if (cfg.navMethod === 'scroll') { return page.evaluate(() => { window.scrollBy(0, window.innerHeight); return true; }); }
  return clickLabel(page, cfg.nextLabels);
}
async function navPrev(page, cfg) {
  if (cfg.navMethod === 'key') { await page.keyboard.press(cfg.prevKey); return true; }
  if (cfg.navMethod === 'scroll') { return page.evaluate(() => { window.scrollBy(0, -window.innerHeight); return true; }); }
  return clickLabel(page, cfg.prevLabels);
}

/**
 * Walk the open document and capture every page.
 * @returns {Promise<{pages: Array<{url,w,h}>, indicator: string}>}
 */
export async function captureDocument(page, cfg, log = () => {}) {
  // optional: rewind to the first page
  if (cfg.rewindFirst) {
    let last = (await readReady(page, cfg))?.tail;
    for (let i = 0; i < cfg.maxPages; i++) {
      if (!(await navPrev(page, cfg))) break;
      const f = await readReady(page, cfg);
      if (!f || f.tail === last) break;
      last = f.tail;
    }
  }

  const pages = [];
  const seen = new Set();
  let cur = await readReady(page, cfg);
  while (cur?.url && pages.length < cfg.maxPages) {
    if (seen.has(cur.tail)) break;            // looped back to a page we already have => done
    seen.add(cur.tail);
    pages.push({ url: cur.url, w: cur.w, h: cur.h });
    log(`  captured page ${pages.length}`);
    await sleep(page, cfg.settleMsAfterNav);
    if (!(await navNext(page, cfg))) break;
    const nxt = await readReady(page, cfg, cur.tail);
    if (!nxt?.url || nxt.tail === cur.tail) break;   // image didn't change => last page
    cur = nxt;
  }
  let indicator = '';
  try { indicator = await page.evaluate(() => (document.body.innerText.match(/Page\s*\d+\s*of\s*\d+|\d+\s*\/\s*\d+/i) || [''])[0]); } catch (e) {}
  return { pages, indicator };
}

/** Assemble captured frames (data URLs) into a single PDF, one frame per page at native size. */
export async function assemblePdf(pages, outPath) {
  const pdf = await PDFDocument.create();
  for (const p of pages) {
    const b64 = p.url.split(',')[1];
    const bytes = Buffer.from(b64, 'base64');
    const img = /image\/jpe?g/i.test(p.url) ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    const pg = pdf.addPage([img.width, img.height]);
    pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  writeFileSync(outPath, await pdf.save());
  return pages.length;
}

/** Optionally dump each captured frame as a PNG into a directory. */
export function dumpPngs(pages, dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  pages.forEach((p, i) => {
    const ext = /image\/jpe?g/i.test(p.url) ? 'jpg' : 'png';
    writeFileSync(join(dir, `page-${String(i + 1).padStart(3, '0')}.${ext}`), Buffer.from(p.url.split(',')[1], 'base64'));
  });
}
