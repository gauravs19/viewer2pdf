import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

/**
 * Launch a real, visible Chromium with a PERSISTENT profile so the login you do
 * the first time is remembered on later runs. Returns { context, page, close }.
 *
 * Requires the chromium binary: run `npx playwright install chromium` once.
 *
 * @param {object} o
 * @param {string} o.profileDir  directory to store the persistent profile (cookies, localStorage)
 * @param {string} [o.url]       initial URL to open
 * @param {string} [o.channel]   e.g. 'chrome' to use installed Google Chrome instead of bundled Chromium
 */
export async function launchBrowser({ profileDir, url, channel }) {
  if (!profileDir) throw new Error('profileDir is required');
  if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: channel || undefined,
    viewport: null,                       // use the real window size
    args: ['--no-first-run', '--no-default-browser-check', '--start-maximized'],
  });

  const page = context.pages()[0] || (await context.newPage());
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});

  return {
    context,
    page,
    close: () => context.close().catch(() => {}),
  };
}

/**
 * Attach to an already-running Chrome started with --remote-debugging-port=<port>.
 * Handy if you prefer to manage the browser yourself. Returns { context, page, close }.
 */
export async function attachBrowser({ cdpUrl }) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());
  return {
    context,
    page,
    close: () => browser.close().catch(() => {}),
  };
}
