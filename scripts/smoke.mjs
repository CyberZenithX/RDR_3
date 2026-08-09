// Headless smoke test. Serves the project over http://, loads the page in
// chromium, and fails on any console error, page exception, failed network
// request, or a render loop that never started.
//
// Run: node scripts/smoke.mjs
// Each round adds its machine-checkable assertions to the CHECKS list below.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 8917;
const FRAME_TARGET = 60;      // frames that must render before we call it alive
const SETTLE_MS = 4000;       // how long we watch for late errors

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = normalize(url === '/' ? 'index.html' : url.slice(1)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { 'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
});

await new Promise((r) => server.listen(PORT, r));

const problems = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  if (m.type() === 'warning') console.log(`  (warn) ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
});

console.log(`smoke: loading http://localhost:${PORT}/`);
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 30000 });

// The render loop must actually start and keep going. Timeout is generous
// (45s) because headless chromium's software rasterizer renders a 2048
// PCFSoftShadowMap far slower than any real GPU does — measured ~3fps here
// vs. 60fps target on real hardware. See CLAUDE.md "known rough edges".
try {
  await page.waitForFunction((n) => window.__frames > n, FRAME_TARGET, { timeout: 45000 });
} catch {
  problems.push(`render loop never reached ${FRAME_TARGET} frames`);
}
await page.waitForTimeout(SETTLE_MS);

// Round-by-round assertions. Each entry: [label, async fn -> string|null].
// Returning a string marks a failure with that message.
const CHECKS = [
  ['frames still advancing', async () => {
    const a = await page.evaluate(() => window.__frames);
    await page.waitForTimeout(500);
    const b = await page.evaluate(() => window.__frames);
    return b > a ? null : `frame counter stalled at ${a}`;
  }],

  // Round 1 ----------------------------------------------------------------
  ['player.glb loaded (not the capsule placeholder)', async () => {
    const loaded = await page.evaluate(() => window.__debug?.modelsLoaded?.player);
    return loaded === true ? null : `modelsLoaded.player was ${JSON.stringify(loaded)}`;
  }],
  ['player y settles onto the terrain (not falling forever)', async () => {
    const y0 = await page.evaluate(() => window.__debug?.playerY);
    await page.waitForTimeout(800);
    const y1 = await page.evaluate(() => window.__debug?.playerY);
    if (typeof y0 !== 'number' || typeof y1 !== 'number' || !Number.isFinite(y1)) {
      return `playerY not numeric (${y0} -> ${y1})`;
    }
    if (y1 < -50) return `playerY is ${y1} — looks like it's still falling`;
    return Math.abs(y1 - y0) < 0.5 ? null : `playerY still moving fast at rest: ${y0} -> ${y1}`;
  }],
  ['player is grounded', async () => {
    const grounded = await page.evaluate(() => window.__debug?.grounded);
    return grounded === true ? null : `grounded was ${JSON.stringify(grounded)}`;
  }],
  ['props scattered across the terrain', async () => {
    const counts = await page.evaluate(() => window.__debug?.propCounts);
    if (!counts) return 'propCounts missing';
    const bad = Object.entries(counts).filter(([, n]) => !(n > 0));
    return bad.length === 0 ? null : `zero-count prop kinds: ${bad.map(([k]) => k).join(', ')}`;
  }],
  ['player character rendered at a plausible human scale', async () => {
    // Regression guard for a real bug: measureHeight() on a freshly-loaded,
    // not-yet-updated GLTF scene returned a garbage bounding box (63.8
    // instead of ~1.83), so character.js computed scale = 1.85/63.8 = 0.029
    // and rendered the player at ~5cm tall — invisible from the normal
    // camera distance. Fixed in assets.js's measureHeight() by forcing
    // updateMatrixWorld(true) before measuring. This check would have
    // caught it: a real human character's root scale should be within a
    // sane band of 1 (the model is already close to real-world scale before
    // any rescale), not two orders of magnitude off.
    const scale = await page.evaluate(() => window.__debug?.characterScale);
    const bboxHeight = await page.evaluate(() => window.__debug?.characterWorldBBoxHeight);
    if (typeof scale !== 'number' || typeof bboxHeight !== 'number') {
      return `characterScale/characterWorldBBoxHeight missing (${scale}, ${bboxHeight})`;
    }
    if (scale < 0.3 || scale > 3) return `characterScale is ${scale} — model rescale looks broken`;
    if (bboxHeight < 1.2 || bboxHeight > 2.5) return `characterWorldBBoxHeight is ${bboxHeight}m — not human-sized`;
    return null;
  }],
];

for (const [label, fn] of CHECKS) {
  const fail = await fn().catch((e) => `threw: ${e.message}`);
  console.log(`  ${fail ? 'FAIL' : 'ok  '}  ${label}${fail ? ` — ${fail}` : ''}`);
  if (fail) problems.push(`check "${label}": ${fail}`);
}

const frames = await page.evaluate(() => window.__frames);
console.log(`smoke: ${frames} frames rendered`);

await browser.close();
server.close();

if (problems.length) {
  console.error(`\nsmoke FAILED (${problems.length}):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\nsmoke PASSED');
