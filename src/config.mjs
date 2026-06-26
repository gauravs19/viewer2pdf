import { readFileSync, existsSync } from 'node:fs';

/**
 * Default capture behaviour. Everything here can be overridden by:
 *   1. a config file (--config file.json), optionally selecting a named site (--site name)
 *   2. individual CLI flags (highest precedence)
 */
export const DEFAULTS = {
  // --- what to capture ---
  // 'auto' tries canvas first, then a large/data-URL <img>, then element screenshot.
  captureMode: 'auto',            // 'auto' | 'canvas' | 'img' | 'screenshot'
  captureSelector: null,          // optional CSS selector to force the element to capture

  // --- pagination ---
  // The tool clicks the first visible element whose trimmed text equals one of these.
  nextLabels: ['Next', 'Next Page', '›', '>', '→', 'chevron_right'],
  prevLabels: ['Prev', 'Previous', 'Prev Page', '‹', '<', '←', 'chevron_left'],
  navMethod: 'button',            // 'button' | 'key' | 'scroll'
  nextKey: 'ArrowRight',          // used when navMethod === 'key'
  prevKey: 'ArrowLeft',
  rewindFirst: true,              // click Prev to reach page 1 before capturing
  maxPages: 200,                  // hard safety cap

  // --- "Page X of Y" detection (informational; capture stops on repeated frame, not on this) ---
  pageIndicatorRegexes: [
    '^Page\\s*(\\d+)\\s*of\\s*(\\d+)$',
    '^(\\d+)\\s*/\\s*(\\d+)$',
    '^(\\d+)\\s*of\\s*(\\d+)$'
  ],

  // --- render quality / timing ---
  // A frame is "ready" when its non-white pixel ratio is within [blankMin, blankMax]
  // (skips all-white blank frames AND all-black/not-yet-painted frames) and is
  // stable across two consecutive reads.
  blankMin: 0.012,
  blankMax: 0.999,
  pollMs: 250,                    // delay between readiness polls
  maxPollsPerPage: 80,            // polls before giving up waiting for a page to render
  settleMsAfterNav: 250,          // small pause right after clicking Next

  // --- output ---
  imageFormat: 'png',             // canvas is read as png; jpg also supported for <img> sources
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) out[k] = v;
    else if (v && typeof v === 'object') out[k] = deepMerge(base[k] || {}, v);
    else out[k] = v;
  }
  return out;
}

/**
 * Build the effective config from defaults + (config file [+ site]) + CLI overrides.
 * @param {object} cli  parsed CLI options (only defined keys override)
 */
export function buildConfig(cli = {}) {
  let fileCfg = {};
  if (cli.config) {
    if (!existsSync(cli.config)) throw new Error(`Config file not found: ${cli.config}`);
    const parsed = JSON.parse(readFileSync(cli.config, 'utf8'));
    if (cli.site) {
      const sites = parsed.sites || {};
      if (!sites[cli.site]) throw new Error(`Site "${cli.site}" not found in ${cli.config}. Available: ${Object.keys(sites).join(', ') || '(none)'}`);
      // a site profile inherits top-level "defaults" in the file, then its own keys
      fileCfg = deepMerge(parsed.defaults || {}, sites[cli.site]);
    } else {
      fileCfg = parsed.defaults || parsed;
    }
  }

  // CLI overrides: only keys the user actually passed
  const cliOver = {};
  const passthrough = ['captureMode', 'captureSelector', 'navMethod', 'rewindFirst', 'maxPages', 'imageFormat'];
  for (const k of passthrough) if (cli[k] !== undefined) cliOver[k] = cli[k];
  if (cli.next) cliOver.nextLabels = cli.next.split(',').map(s => s.trim());
  if (cli.prev) cliOver.prevLabels = cli.prev.split(',').map(s => s.trim());

  return deepMerge(deepMerge(DEFAULTS, fileCfg), cliOver);
}
