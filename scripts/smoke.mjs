// Headless smoke test. Serves the project over http://, loads the page in
// chromium, and fails on any console error, page exception, failed network
// request, or a render loop that never started.
//
// Run: node scripts/smoke.mjs
// Each round adds its machine-checkable assertions to the CHECKS list below.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 8917;
const FRAME_TARGET = 60;      // frames that must render before we call it alive
const SETTLE_MS = 4000;       // how long we watch for late errors

// ------------------------------------------------------------------- CLI ---
// The full suite is 40+ checks and takes ~2 minutes, most of it in the
// mount/jump sequences. Iterating on ONE check by running all of them is the
// single most expensive habit this harness encourages, so it doesn't:
//
//   node scripts/smoke.mjs                      the whole suite (CI / end of round)
//   node scripts/smoke.mjs --list               just the labels
//   node scripts/smoke.mjs --only "shot hits"   substring match, case-insensitive
//   node scripts/smoke.mjs --placeholder player.glb
//
// `--placeholder` withholds a model from the server so the procedural fallback
// rig loads, which is docs/TESTING.md's "rename the GLB away" procedure without
// the rename — no `mv` to forget to undo, and the deliberate 404 no longer
// counts as a failure. That procedure caught a boot-sequence crash in round 3
// and is worth making a one-liner.
const argv = process.argv.slice(2);
const argValue = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};
const ONLY = argValue('--only') ?? process.env.SMOKE_ONLY ?? null;
const PLACEHOLDER = argValue('--placeholder') ?? process.env.SMOKE_PLACEHOLDER ?? null;
const LIST_ONLY = argv.includes('--list');

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
  // --placeholder: pretend this asset was never shipped, so the fallback path
  // is what actually boots. See the CLI block above.
  if (PLACEHOLDER && rel.replace(/\\/g, '/').endsWith(PLACEHOLDER)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('withheld by --placeholder');
    return;
  }
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

// --------------------------------------------------------------- chromium ---
// `chromium.launch()` normally finds the browser Playwright downloaded for
// itself. Some sandboxes (Claude Code's web/remote containers among them)
// instead ship a *pre-installed* chromium under PLAYWRIGHT_BROWSERS_PATH whose
// build number doesn't match whatever Playwright version is in node_modules,
// and block `playwright install` from fetching the matching one — so launch()
// dies with "Executable doesn't exist at .../chromium_headless_shell-<n>/...".
// The pre-installed binary runs this page fine, so fall back to any chromium
// actually present on disk rather than failing the whole smoke run.
// Override explicitly with SMOKE_CHROMIUM=/path/to/chrome.

/** Chromium binaries that exist on this machine, best candidate first. */
function chromiumCandidates() {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  // The bare `chromium` entry is a symlink these images provide; the
  // `chromium-<build>/chrome-linux/chrome` entries are Playwright's own layout.
  const paths = [join(browsersPath, 'chromium')];
  try {
    for (const entry of readdirSync(browsersPath)) {
      if (entry.startsWith('chromium-')) paths.push(join(browsersPath, entry, 'chrome-linux', 'chrome'));
    }
  } catch { /* no browsers dir — the system paths below may still hit */ }
  paths.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  return paths.filter((p) => existsSync(p));
}

async function launchChromium() {
  const override = process.env.SMOKE_CHROMIUM;
  if (override) {
    if (!existsSync(override)) throw new Error(`SMOKE_CHROMIUM=${override} does not exist`);
    return chromium.launch({ executablePath: override });
  }
  try {
    return await chromium.launch();
  } catch (err) {
    for (const executablePath of chromiumCandidates()) {
      try {
        const fallback = await chromium.launch({ executablePath });
        console.log(`smoke: playwright's own chromium is missing — using ${executablePath}`);
        return fallback;
      } catch { /* not usable either; try the next candidate */ }
    }
    // Nothing on disk worked, so Playwright's own error is the useful one.
    throw err;
  }
}

const problems = [];

if (LIST_ONLY) {
  // Instant on purpose: no browser, no page load, no waiting. This is how you
  // find the --only pattern you want, so finding it costs nothing.
  //
  // The labels are scraped from this file's own source rather than read off
  // CHECKS, because CHECKS is defined further down — its closures capture
  // `page`, so the array cannot exist until the browser does. A regex over
  // our own source is the honest trade for keeping --list free.
  const src = await readFile(new URL(import.meta.url), 'utf8');
  const labels = [];
  for (const line of src.split(/\r?\n/)) {
    if (!line.startsWith(`  ['`)) continue;
    const end = line.lastIndexOf(`', async`);
    if (end > 4) labels.push(line.slice(4, end).replaceAll(`\\'`, `'`));
  }
  for (const label of labels) console.log(`  ${label}`);
  console.log(`\n${labels.length} checks. Run one with: node scripts/smoke.mjs --only "<substring>"`);
  server.close();
  process.exit(0);
}

const browser = await launchChromium();
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
// vs. 60fps target on real hardware. See docs/TESTING.md.
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
  ['player mesh yaw offset actually applied at spawn', async () => {
    // Regression guard for a real bug: player.js's constructor correctly set
    // rotation.y = meshYaw + PLAYER.meshYawOffset, but the per-frame update()
    // set rotation.y = meshYaw with NO offset — and since update() runs from
    // frame 1, it silently overwrote the constructor's correct value before
    // the game was ever visible. The offset only "worked" once the player
    // had moved at least once (the movement-turning code baked it into
    // meshYaw itself). Invisible during normal play, very visible at spawn.
    // This check would have caught it: at rest, rotation.y should equal
    // SPAWN.yaw + PLAYER.meshYawOffset, not just SPAWN.yaw.
    const info = await page.evaluate(async () => {
      const cfg = await import('/src/config.js');
      return {
        rotationY: window.__debug?.characterRotationY,
        expected: cfg.SPAWN.yaw + cfg.PLAYER.meshYawOffset,
      };
    });
    if (typeof info.rotationY !== 'number') return `characterRotationY missing (${info.rotationY})`;
    const diff = Math.abs(((info.rotationY - info.expected + Math.PI) % (Math.PI * 2)) - Math.PI);
    return diff < 0.01 ? null : `rotation.y is ${info.rotationY}, expected ${info.expected} (meshYawOffset not applied)`;
  }],
  ['rock collider factors comfortably cover the visual geometry', async () => {
    // Regression guard for a real bug: PROPS.rock.colliderFactor was 0.8,
    // smaller than even the *unbumped* base rock radius (IcosahedronGeometry
    // radius 1.0), before any lumpiness bulging outward is considered — the
    // player could walk visibly into large rocks. Measured directly (max XZ
    // vertex radius across 40 generated samples per variant): 1.34 / 1.24 /
    // 1.44. This doesn't reproduce that full measurement (would need
    // mergeVertices in this context), but it catches the class of regression
    // cheaply: every configured factor must clear a safe floor above the
    // known-unbumped base radius of 1.0.
    const factors = await page.evaluate(async () => (await import('/src/config.js')).PROPS.rock.colliderFactors);
    if (!Array.isArray(factors) || factors.length === 0) return `colliderFactors missing or not an array (${JSON.stringify(factors)})`;
    const tooSmall = factors.filter((f) => f < 1.2);
    return tooSmall.length === 0 ? null : `colliderFactors ${JSON.stringify(factors)} has values below the 1.2 safety floor`;
  }],
  // Round 2 ----------------------------------------------------------------
  ['horse.glb loaded (not the capsule placeholder)', async () => {
    const loaded = await page.evaluate(() => window.__debug?.modelsLoaded?.horse);
    return loaded === true ? null : `modelsLoaded.horse was ${JSON.stringify(loaded)}`;
  }],
  ['horse y settles onto the terrain (not falling forever)', async () => {
    const y0 = await page.evaluate(() => window.__debug?.horsePos?.y);
    await page.waitForTimeout(800);
    const y1 = await page.evaluate(() => window.__debug?.horsePos?.y);
    if (typeof y0 !== 'number' || typeof y1 !== 'number' || !Number.isFinite(y1)) {
      return `horsePos.y not numeric (${y0} -> ${y1})`;
    }
    return Math.abs(y1 - y0) < 0.5 ? null : `horsePos.y still moving fast at rest: ${y0} -> ${y1}`;
  }],
  ['horse stays inside the world boundary while wandering', async () => {
    const info = await page.evaluate(async () => {
      const cfg = await import('/src/config.js');
      const p = window.__debug.horse.position;
      const dist = Math.hypot(p.x - cfg.TOWN.centerX, p.z - cfg.TOWN.centerZ);
      return { dist, limit: cfg.BOUNDARY.playerLimit };
    });
    return info.dist <= info.limit + 1 ? null : `horse is ${info.dist.toFixed(1)} from center, past the ${info.limit} boundary clamp`;
  }],
  ['horse model scale is plausibly horse-sized, not the 4.8m raw bind-pose box', async () => {
    // Regression guard for the round-1-flagged bug this round resolves:
    // horse.glb's raw bind-pose bounding box measures 4.83m tall — see
    // HORSE.modelScale's comment in config-horse.js for the full measurement
    // writeup. character.root.scale.x should be the small hardcoded factor
    // (~0.58), not 1 (unscaled) and not some measureHeight()-derived value.
    const scale = await page.evaluate(() => window.__debug?.horse?.character?.root?.scale?.x);
    if (typeof scale !== 'number') return `horse character root scale missing (${scale})`;
    return scale > 0.2 && scale < 0.9 ? null : `horse modelScale is ${scale} — expected roughly HORSE.modelScale (~0.58)`;
  }],
  ['mount attaches the player to the horse\'s saddle', async () => {
    // Exercises mounting via the public Horse.handleMountToggle(player) hook
    // (see its own doc comment in horse.js) instead of simulating real
    // pointer-locked keyboard input, per docs/TESTING.md.
    const before = await page.evaluate(() => {
      const d = window.__debug;
      const h = d.horse;
      d.player.position.set(h.position.x + 1, h.position.y, h.position.z);
      d.player.meshYaw = 0;
      h.handleMountToggle(d.player);
      return { mounted: d.player.mounted };
    });
    if (before.mounted !== true) return `handleMountToggle while in range did not mount (player.mounted=${before.mounted})`;
    // Wait for enough SIMULATED time (not wall-clock — headless chromium's
    // software rasterizer runs at ~3-4fps here, and RENDER.maxDeltaTime caps
    // how much sim time each slow frame can contribute) to finish the 0.4s
    // saddle-lerp. A fixed wall-clock sleep flaked here at ~700ms.
    // NOTE: the predicate must be SYNCHRONOUS — an async predicate (`await
    // import(...)` inside it) resolves waitForFunction on its first poll
    // regardless of the real boolean result in this Playwright version
    // (confirmed directly: it returned after one poll with the condition
    // still false). Fetch the threshold with a plain awaited evaluate first.
    const mountLerpTime = await page.evaluate(async () => (await import('/src/config-horse.js')).HORSE.mountLerpTime);
    await page.waitForFunction((t) => window.__debug.horse._mountBlendT >= t, mountLerpTime, { timeout: 20000 });
    const after = await page.evaluate(async () => {
      const cfg = await import('/src/config-horse.js');
      const h = window.__debug.horse;
      const p = window.__debug.player;
      const dx = p.position.x - h.position.x, dz = p.position.z - h.position.z;
      const horizOffset = Math.hypot(dx, dz);
      const expectedHoriz = Math.hypot(cfg.HORSE.saddleOffset.x, cfg.HORSE.saddleOffset.z);
      // saddleOffset.y is a SEAT height — where the rider's hips go — because
      // the rider is posed seated. player.js places the rig's root that far
      // below it, so the hip height has to be added back before comparing.
      const hipHeight = p.character.hipHeight ?? 0;
      const vertOffset = p.position.y + hipHeight - h.position.y;
      return { mounted: p.mounted, horizOffset, expectedHoriz, vertOffset, hipHeight, expectedVert: cfg.HORSE.saddleOffset.y };
    });
    if (after.mounted !== true) return 'player un-mounted itself unexpectedly while riding';
    if (!(after.hipHeight > 0.4 && after.hipHeight < 1.4)) {
      return `rig hip height measured as ${after.hipHeight.toFixed(2)}, which is not a plausible pelvis height`;
    }
    if (Math.abs(after.horizOffset - after.expectedHoriz) > 0.15) {
      return `saddle horizontal offset is ${after.horizOffset.toFixed(2)}, expected ~${after.expectedHoriz.toFixed(2)}`;
    }
    // Loosened from 0.15 to 0.25: the seat now rides the horse's spine bone, so
    // it legitimately sits up to HORSE.saddleBobLimit off the nominal height
    // depending on where in the gait cycle the sample lands.
    if (Math.abs(after.vertOffset - after.expectedVert) > 0.25) {
      return `saddle vertical offset is ${after.vertOffset.toFixed(2)}, expected ~${after.expectedVert.toFixed(2)}`;
    }
    return null;
  }],
  ['rider is posed seated, not standing on the horse', async () => {
    // The rider has no seated clip, so the pose is built bone by bone
    // (riding-pose.js). Checked in the character root's own frame, where +Y is
    // up and +Z is the way the rider faces: a seated leg has its knee well
    // forward of the hip and its foot well below the knee, which a standing
    // leg — the pose this replaced — does not.
    const pose = await page.evaluate(() => {
      const rig = window.__debug.player.character;
      const root = rig.root;
      root.updateMatrixWorld(true);
      const local = (name) => {
        const bone = root.getObjectByName(name);
        if (!bone) return null;
        const p = bone.getWorldPosition(new bone.position.constructor());
        root.worldToLocal(p);
        return { x: p.x, y: p.y, z: p.z };
      };
      return {
        mounted: window.__debug.player.mounted,
        isPlaceholder: !!rig.isPlaceholder,
        available: !!rig.pose?.available,
        canGrip: !!rig.pose?.canGrip,
        hip: local('UpperLegL'), knee: local('LowerLegL'), foot: local('FootL'),
        kneeR: local('LowerLegR'), wrist: local('WristL'), chest: local('Chest'), body: local('Body'),
      };
    });
    if (pose.mounted !== true) return 'expected player still mounted from the previous check';
    // The capsule placeholder has its own, much simpler seated pose (plain
    // group rotations, no skeleton), so these skeleton assertions do not apply
    // to it — same reason the "player.glb loaded" check above exists.
    if (pose.isPlaceholder) return null;
    if (!pose.available) return 'riding pose reported unavailable — the rig is missing leg bones';
    if (!pose.canGrip) return 'riding pose could not derive finger grip axes — hands will stay splayed open';
    if (!(pose.knee.z - pose.hip.z > 0.15)) {
      return `knee is only ${(pose.knee.z - pose.hip.z).toFixed(2)} forward of the hip — the rider is not sitting`;
    }
    if (!(pose.knee.y - pose.foot.y > 0.3)) {
      return `foot is only ${(pose.knee.y - pose.foot.y).toFixed(2)} below the knee — the shin is not hanging`;
    }
    // Legs must straddle rather than pass through the horse. Barrel half-width
    // measured by raycasting the *animated* mesh: 0.33 at its widest (1.6 above
    // the horse's origin), tapering to ~0.30 at the height the knees ride at.
    // The floor here is a little under that — the rig's two legs are not mirror
    // images (see RIDING_POSE's right-leg trims), so the right knee sits
    // slightly inboard of the left even after correction.
    if (!(pose.knee.x > 0.26 && pose.kneeR.x < -0.26)) {
      return `knees at x=${pose.knee.x.toFixed(2)}/${pose.kneeR.x.toFixed(2)} are buried inside the horse's barrel`;
    }
    // ...and they must stay roughly mirrored, which is what the trims exist for.
    if (Math.abs(pose.knee.x + pose.kneeR.x) > 0.16) {
      return `knees are lopsided: x=${pose.knee.x.toFixed(2)} vs ${pose.kneeR.x.toFixed(2)}`;
    }
    // The spine leans forward, never back — a backwards lean was a real bug
    // (a per-frame delta compounding on a bone no clip rewrites).
    if (!(pose.chest.z >= pose.body.z)) {
      return `chest is ${(pose.body.z - pose.chest.z).toFixed(2)} behind the pelvis — the rider is leaning backwards`;
    }
    if (!(pose.wrist.z > pose.body.z + 0.15)) {
      return `hands are only ${(pose.wrist.z - pose.body.z).toFixed(2)} forward of the pelvis — not out on the reins`;
    }
    return null;
  }],
  ['riding pose is idempotent across frames', async () => {
    // Guards the compounding bug directly: the pose applies deltas, and a bone
    // no clip rewrites (Torso is absent from the idle clip's tracks) would
    // otherwise accumulate them every frame until the rider folded over
    // backwards. Same pose, many frames apart, must land in the same place.
    const first = await page.evaluate(() => {
      const rig = window.__debug.player.character;
      if (rig.isPlaceholder) return 'placeholder';
      const b = rig.root.getObjectByName('Torso');
      return b ? b.quaternion.toArray() : null;
    });
    if (first === 'placeholder') return null; // no skeleton to compound on
    if (!first) return 'Torso bone not found on the player rig';
    await page.waitForFunction((n) => window.__frames > n, await page.evaluate(() => window.__frames + 12), { timeout: 30000 });
    const second = await page.evaluate(() => {
      const b = window.__debug.player.character.root.getObjectByName('Torso');
      return b.quaternion.toArray();
    });
    const drift = Math.max(...first.map((v, i) => Math.abs(v - second[i])));
    return drift < 0.02 ? null : `Torso rotation drifted by ${drift.toFixed(3)} over 12 frames of riding — the pose is compounding, not idempotent`;
  }],
  ['rider stays seated in the saddle while the horse banks into a turn', async () => {
    // The round-2b pose is stable, but the rigid placement around it was not:
    // the seat was built straight up from the horse's *ground-level* origin
    // while the mesh banks about that origin, and the rider's roll pivoted at
    // the rig root a whole hip height below the seat. Both errors only appear
    // once `lean` is non-zero, so this check forces a steady turn and then
    // measures the rider in the horse's OWN BANKED BODY FRAME, where a
    // correctly seated rider reads the same as they do standing still.
    //
    // Steering is driven by replacing _updateMounted for the duration rather
    // than by simulating input, for the same reason the mount check calls
    // handleMountToggle directly — headless has no pointer lock. Restored
    // before returning.
    const approachSpeed = await page.evaluate(async () => (await import('/src/config-horse.js')).HORSE.approachSpeed);
    await page.evaluate((speed) => {
      const h = window.__debug.horse;
      h.__origUpdateMounted = h._updateMounted;
      h._updateMounted = function (dt) {
        const target = this.yaw + 0.9; // hold 0.9rad off the current heading -> a steady turn
        this._moveDir.set(-Math.sin(target), 0, -Math.cos(target));
        this._isDrainingStamina = false;
        this._integrateMovement(dt, speed);
        this._turnToward(dt, true);
      };
    }, approachSpeed);
    // Predicate stays synchronous — see the async-waitForFunction gotcha above.
    let banked = true;
    try {
      await page.waitForFunction(() => Math.abs(window.__debug.horse.lean) > 0.15, null, { timeout: 20000 });
    } catch { banked = false; }

    const m = banked ? await page.evaluate(() => {
      const d = window.__debug;
      const rig = d.player.character.root;
      const hrig = d.horse.character.root;
      rig.updateMatrixWorld(true);
      hrig.updateMatrixWorld(true);
      // Undo the horse's whole world matrix — position, yaw AND bank — then
      // divide out its baked scale, so these read as metres in the horse's own
      // body frame: side across the barrel, up along its spine, fwd to the nose.
      const hInv = hrig.matrixWorld.clone().invert();
      const scale = hrig.scale.x;
      const inHorse = (name) => {
        const bone = rig.getObjectByName(name);
        if (!bone) return null;
        const p = bone.getWorldPosition(new bone.position.constructor());
        p.applyMatrix4(hInv).multiplyScalar(scale);
        return { side: -p.x, up: p.y, fwd: p.z };
      };
      const seat = d.horse.getSaddleTransform(new rig.position.constructor()).position.clone();
      seat.applyMatrix4(hInv).multiplyScalar(scale);
      return {
        isPlaceholder: !!d.player.character.isPlaceholder,
        lean: d.horse.lean,
        seat: { side: -seat.x, up: seat.y },
        hips: inHorse('Body'), footL: inHorse('FootL'), footR: inHorse('FootR'),
      };
    }) : null;

    await page.evaluate(() => {
      const h = window.__debug.horse;
      if (h.__origUpdateMounted) { h._updateMounted = h.__origUpdateMounted; delete h.__origUpdateMounted; }
    });
    try {
      await page.waitForFunction(() => Math.abs(window.__debug.horse.lean) < 0.05, null, { timeout: 20000 });
    } catch { /* the later checks don't care about a residual lean */ }

    if (!banked) return 'the horse never reached a 0.15rad bank, so the turn was never exercised';
    if (m.isPlaceholder) return null; // the capsule fallback has no skeleton to measure
    // The saddle point must track the horse's back, not the world vertical.
    // Before the fix it stayed on the vertical while the back swung
    // saddleOffset.y*sin(lean) — 0.64 at the lean limit — out from under it.
    if (Math.abs(m.seat.side) > 0.05) {
      return `the seat sits ${m.seat.side.toFixed(2)} off the horse's spine at lean ${m.lean.toFixed(2)} — it is not banking with the horse`;
    }
    // ...and the rider's hips must stay on it. Rolling the rig about its root
    // instead of the seat slid them hipHeight*sin(roll) sideways (0.20 measured).
    if (Math.abs(m.hips.side) > 0.10) {
      return `hips are ${m.hips.side.toFixed(2)} off the horse's spine at lean ${m.lean.toFixed(2)} — the rider is sliding off the saddle`;
    }
    // Both boots still straddle the barrel, and at the same height as each
    // other: the tell for the old bug was one boot 0.27 above the other with
    // the horse no longer between them.
    if (!(m.footL.side < -0.30 && m.footR.side > 0.30)) {
      return `boots at ${m.footL.side.toFixed(2)}/${m.footR.side.toFixed(2)} are no longer straddling the barrel mid-turn`;
    }
    if (Math.abs(m.footL.up - m.footR.up) > 0.15) {
      return `boots are ${Math.abs(m.footL.up - m.footR.up).toFixed(2)} apart in height mid-turn — the legs are swinging off the horse`;
    }
    return null;
  }],
  ['mounted camera does not collapse onto the horse\'s own collider', async () => {
    // Regression guard for a real bug: the horse registers a persistent
    // circle collider (for terrain/prop collision, and so a riderless horse
    // blocks the player on foot) that stays live while mounted too — and
    // the rider's camera pivot sits right on/inside it (saddle offset is
    // tiny). Without excluding it, every direction the mounted camera swept
    // immediately "hit" the horse itself and collapsed to CAMERA.minDistance
    // — confirmed via screenshot: the camera was inside the player's head.
    // Fixed by threading an ignoreCollider through
    // ThirdPersonCamera._maxUnobstructedDistance/update (see camera.js).
    const info = await page.evaluate(async () => {
      const cfg = await import('/src/config.js');
      return { mounted: window.__debug.player.mounted, dist: window.__debug.tpCamera.currentDistance, min: cfg.CAMERA.minDistance, target: cfg.CAMERA.mountedDistance };
    });
    if (info.mounted !== true) return `expected player still mounted from the previous check (mounted=${info.mounted})`;
    return info.dist > info.min + 1 ? null : `mounted camera currentDistance is ${info.dist.toFixed(2)}, close to minDistance (${info.min}) — expected near mountedDistance (${info.target})`;
  }],
  ['reins connect the rider\'s hands to the horse\'s mouth', async () => {
    // The rider's fists held nothing until the tack existed (horse.glb ships no
    // bridle). Both ends are checked against live bones: the bit end near the
    // muzzle, the hand end at the fist. Reads the strand buffer directly, since
    // the straps are one shared geometry rewritten each frame rather than
    // objects with their own transforms.
    const info = await page.evaluate(() => {
      const d = window.__debug;
      const reins = d.reins;
      if (!reins?.available) return { available: false };
      const pos = reins.geometry.getAttribute('position');
      const RING = 13, SIDES = 4, PER = RING * SIDES;
      // Average of a ring's four vertices is the curve point it was built around.
      const ringAt = (strand, ring) => {
        let x = 0, y = 0, z = 0;
        for (let s = 0; s < SIDES; s++) {
          const v = strand * PER + ring * SIDES + s;
          x += pos.getX(v); y += pos.getY(v); z += pos.getZ(v);
        }
        return { x: x / SIDES, y: y / SIDES, z: z / SIDES };
      };
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      const V = d.horse.position.constructor;
      const headBone = d.horse.character.root.getObjectByName('Head');
      const head = headBone.getWorldPosition(new V());
      const hand = reins.handR?.getWorldPosition(new V()) ?? null;
      const bitEnd = ringAt(1, 0);           // reinR, bit end
      const handEnd = ringAt(1, RING - 1);   // reinR, hand end
      return {
        available: true,
        mounted: d.player.mounted,
        bitToHead: dist(bitEnd, head),
        handGap: hand ? dist(handEnd, hand) : null,
        strapCount: pos.count / PER,
      };
    });
    if (!info.available) return null; // placeholder horse has no skeleton to hang tack on
    if (info.mounted !== true) return 'expected the player still mounted from the previous check';
    if (info.strapCount < 6) return `only ${info.strapCount} straps in the tack buffer, expected 6 (2 reins + bridle)`;
    // The bit sits on the muzzle, roughly half a head forward of the head bone.
    if (!(info.bitToHead > 0.15 && info.bitToHead < 0.9)) {
      return `rein's bit end is ${info.bitToHead.toFixed(2)} from the head bone — not on the muzzle`;
    }
    if (!(info.handGap !== null && info.handGap < 0.1)) {
      return `rein's other end is ${info.handGap?.toFixed(2)} from the rider's hand — the hands are holding air again`;
    }
    return null;
  }],
  ['horse jump clip is wired as a one-shot, not a locomotion state', async () => {
    // Unlike the player (whose retargeted jump was built, tuned and pulled —
    // see docs/DEVELOPMENT-NOTES.md), horse.glb ships a real Gallop_Jump. It
    // must be a one-shot: setLocomotion loops its action and rescales its
    // timeScale by ground speed, both wrong for a jump.
    const info = await page.evaluate(() => {
      const rig = window.__debug.horse.character;
      if (rig.isPlaceholder) return 'placeholder';
      if (typeof rig.setAirborne !== 'function') return { noSetAirborne: true };
      const jump = rig.actions?.jump;
      if (!jump) return { noAction: true };
      return { clip: jump.getClip().name, duration: jump.getClip().duration };
    });
    if (info === 'placeholder') return null; // the fallback holds a tucked pose instead
    if (info.noSetAirborne) return 'horse rig has no setAirborne() — the one-shot cannot be triggered';
    if (info.noAction) return 'horse-character.js built no "jump" action — HORSE_CLIP_CANDIDATES.jump is unwired';
    if (!/jump/i.test(info.clip)) return `the jump action plays "${info.clip}", which is not a jump clip`;
    return null;
  }],
  ['scattered props record their own top height, so something can be jumped over', async () => {
    // Colliders were pure 2D circles of unlimited height until this round, so
    // nothing in the world could ever be cleared. Props now carry the world Y
    // of their own visual top; that number is the whole basis of the clearance
    // rule, so check it is real rather than defaulted.
    const info = await page.evaluate(async () => {
      const { colliders } = await import('/src/collision.js');
      const { heightAt } = await import('/src/terrain.js');
      const cfg = await import('/src/config-horse.js');
      // A POSITIVE list of the kinds that are meant to be clearable. It used
      // to be "anything that isn't the horse", which round 4 broke by adding
      // eleven bandits and three campfires — all of which keep top: Infinity
      // ON PURPOSE (a character is not something to be jumped over). An
      // exclusion list quietly turns every future unjumpable thing into a
      // failure of this check; an inclusion list says what it means.
      const SCENERY = ['rock', 'cactus', 'tree', 'barrel'];
      const props = colliders.filter((c) => SCENERY.includes(c.meta?.kind));
      const infinite = props.filter((c) => !Number.isFinite(c.top)).length;
      const heights = (kind) => props.filter((c) => !kind || c.meta.kind === kind)
        .map((c) => c.top - heightAt(c.x, c.z)).sort((a, b) => a - b);
      const above = heights(null);
      const med = (a) => a[Math.floor(a.length / 2)];
      const reach = cfg.HORSE.bellyHeight - cfg.HORSE.jumpClearMargin
        + (cfg.HORSE.jumpSpeed * cfg.HORSE.jumpSpeed) / (2 * -cfg.HORSE.gravity);
      return {
        count: props.length,
        infinite,
        min: above[0],
        max: above[above.length - 1],
        medianRock: med(heights('rock')),
        medianCactus: med(heights('cactus')),
        medianTree: med(heights('tree')),
        clearableRocks: heights('rock').filter((h) => h < reach).length,
        rocks: heights('rock').length,
        reach,
      };
    });
    if (info.count < 100) return `only ${info.count} prop colliders registered — the world is not scattered`;
    if (info.infinite > 0) return `${info.infinite} prop colliders still have an infinite top — they can never be jumped`;
    if (!(info.min > 0.05)) return `the shortest prop stands ${info.min?.toFixed(3)} above its ground — tops are not being measured`;
    if (!(info.max > 3)) return `the tallest prop is only ${info.max.toFixed(2)} tall — cacti and trees should be far taller`;
    // Cacti and trees must stay unjumpable however the jump is tuned, or the
    // horse starts sailing through the scenery.
    if (info.medianCactus < info.reach || info.medianTree < info.reach) {
      return `a median cactus (${info.medianCactus.toFixed(2)}) or tree (${info.medianTree.toFixed(2)}) is under the horse's ${info.reach.toFixed(2)} reach`;
    }
    // ...and the feature is only worth having if a good share of rocks are.
    const frac = info.clearableRocks / info.rocks;
    if (!(frac > 0.5 && frac < 0.98)) {
      return `${(frac * 100).toFixed(0)}% of rocks are under the horse's ${info.reach.toFixed(2)} reach — the jump is either useless or trivialises every boulder`;
    }
    console.log(`  (info) prop tops: median rock ${info.medianRock.toFixed(2)}, cactus ${info.medianCactus.toFixed(2)}, tree ${info.medianTree.toFixed(2)}; horse reach ${info.reach.toFixed(2)} clears ${(frac * 100).toFixed(0)}% of rocks`);
    return null;
  }],
  ['an airborne agent passes over a low obstacle, a grounded one does not', async () => {
    // The clearance rule itself, exercised directly rather than through a
    // whole jump: same collider, same agent, three different undersides.
    const r = await page.evaluate(async () => {
      const { addCircleCollider, resolveCollisions, removeCollider } = await import('/src/collision.js');
      const c = addCircleCollider(9000, 9000, 2, { kind: 'smoke-clearance' }, 1);
      const at = () => ({ x: 9000.5, z: 9000 });
      const grounded = at();
      resolveCollisions(grounded, 0.9, null, -Infinity);
      const flying = at();
      resolveCollisions(flying, 0.9, null, 1.5); // underside well above the obstacle's top
      const grazing = at();
      resolveCollisions(grazing, 0.9, null, 0.6); // ...and not high enough to matter
      removeCollider(c);
      const moved = (p) => Math.hypot(p.x - 9000.5, p.z - 9000);
      return { grounded: moved(grounded), flying: moved(flying), grazing: moved(grazing) };
    });
    if (!(r.grounded > 0.5)) return 'a grounded agent was not pushed out of an obstacle it overlaps';
    if (r.flying > 1e-6) return `an agent clear above the obstacle was still pushed ${r.flying.toFixed(3)} — the height test is not applied`;
    if (!(r.grazing > 0.5)) return 'an agent below the obstacle top passed through it anyway — the clearance is too generous';
    return null;
  }],
  ['a jump leaves the ground, clears a rock height, and lands again', async () => {
    // Driven by swapping out _updateMounted (the horse must be moving to jump)
    // and calling the public handleJump() hook, for the same reason the mount
    // and bank checks do it that way: headless has no pointer lock, so the
    // real Space path cannot be triggered.
    //
    // The arc is sampled from *inside* the render loop, not by polling from
    // here — headless chromium renders this scene at ~3fps, so an 0.85s flight
    // is only about 17 frames and an outside poll would miss the apex. The
    // same wrapper takes the mid-flight body-frame snapshot the next check
    // reads, at the moment the rider is fully into the two-point seat.
    const cfg = await page.evaluate(async () => {
      const c = (await import('/src/config-horse.js')).HORSE;
      return { gallopSpeed: c.gallopSpeed, jumpMinSpeed: c.jumpMinSpeed, saddleBone: c.saddleBone };
    });
    await page.evaluate((c) => {
      const h = window.__debug.horse;
      h.__origUpdateMounted = h._updateMounted;
      h._updateMounted = function (dt) {
        this._moveDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        this._isDrainingStamina = false;
        this._integrateMovement(dt, c.gallopSpeed);
        this._turnToward(dt, true);
      };
      h.__peak = 0;
      h.__peakClears = 0;
      h.__groundedClearance = 0;
      h.__wasAirborne = false;
      h.__landed = false;
      h.__groundSnap = null;
      h.__flightSnap = null;
      h.__apexSnap = null;

      // Rider bones expressed in the horse's OWN body frame — undo the horse's
      // whole world matrix (position, yaw, bank AND the new jump pitch), then
      // divide out its baked scale. Round 2c's method: a correctly seated
      // rider reads the same in this frame however the horse is oriented.
      // `spine` is the horse's own saddle bone read the same way, so the rider
      // can be checked against the back they are actually meant to be sitting
      // on rather than against a nominal height the jump clip does not respect.
      const measure = () => {
        const d = window.__debug;
        const rig = d.player.character.root;
        const hrig = d.horse.character.root;
        rig.updateMatrixWorld(true);
        hrig.updateMatrixWorld(true);
        const hInv = hrig.matrixWorld.clone().invert();
        const scale = hrig.scale.x;
        const boneIn = (root, name) => {
          const bone = root.getObjectByName(name);
          if (!bone) return null;
          const p = bone.getWorldPosition(new rig.position.constructor());
          p.applyMatrix4(hInv).multiplyScalar(scale);
          return { side: -p.x, up: p.y, fwd: p.z };
        };
        const seat = d.horse.getSaddleTransform(new rig.position.constructor()).position.clone();
        seat.applyMatrix4(hInv).multiplyScalar(scale);
        return {
          isPlaceholder: !!d.player.character.isPlaceholder,
          seat: { side: -seat.x, up: seat.y, fwd: seat.z },
          hips: boneIn(rig, 'Body'), head: boneIn(rig, 'Head'),
          footL: boneIn(rig, 'FootL'), footR: boneIn(rig, 'FootR'),
          spine: boneIn(hrig, c.saddleBone),
        };
      };

      h.__origUpdate = h.update;
      h.update = function (dt, camera, player) {
        h.__origUpdate.call(this, dt, camera, player);
        const groundY = this.world.groundHeightAt(this.position.x, this.position.z);
        if (this.jump.airborne) {
          h.__wasAirborne = true;
          const lift = this.position.y - groundY;
          if (lift > h.__peak) {
            h.__peak = lift;
            // The clearance the real update() is feeding resolveCollisions at
            // this instant, against the ground directly under the horse — i.e.
            // how tall an obstacle it is passing over right now.
            h.__peakClears = this.jump.clearance() - groundY;
          }
        } else if (h.__wasAirborne) {
          h.__landed = true;
        } else {
          h.__groundedClearance = this.jump.clearance();
        }
      };

      // The body-frame snapshots come off a wrapper on PLAYER.update, not the
      // horse one above. main.js runs horse.update -> setSaddle -> player.update,
      // so anything measured inside horse.update reads the rider's PREVIOUS
      // frame against this frame's horse. At headless's ~3fps that is a full
      // 0.05s step, and the jump clip moves the horse's spine ~0.5 of body-frame
      // height in that time: measured, it put the rider's hips 0.36 away from
      // the seat they are in fact welded to.
      const p = window.__debug.player;
      p.__origUpdate = p.update;
      p.update = function (dt, camera) {
        p.__origUpdate.call(this, dt, camera);
        if (h.jump.airborne) {
          if (!h.__flightSnap && h.jump.weight > 0.9) h.__flightSnap = measure();
          // First frame at or past the top of the arc. The jump clip is
          // stretched over airTime, so its own peak lands there too — which is
          // exactly why the rider sinking into the horse showed up at the apex
          // and nowhere else.
          if (!h.__apexSnap && h.jump.velocityY <= 0) h.__apexSnap = measure();
        } else if (!h.__wasAirborne && !h.__groundSnap && h.speed > 1) {
          h.__groundSnap = measure(); // seated reference: moving, but on the ground
        }
      };
    }, cfg);

    const restore = () => page.evaluate(() => {
      const h = window.__debug.horse;
      const p = window.__debug.player;
      if (h.__origUpdateMounted) { h._updateMounted = h.__origUpdateMounted; delete h.__origUpdateMounted; }
      if (h.__origUpdate) { h.update = h.__origUpdate; delete h.__origUpdate; }
      if (p.__origUpdate) { p.update = p.__origUpdate; delete p.__origUpdate; }
    });

    try {
      // Predicates stay synchronous throughout — see the async-waitForFunction
      // gotcha noted on the mount check.
      await page.waitForFunction((v) => window.__debug.horse.speed > v, cfg.jumpMinSpeed, { timeout: 20000 });
      await page.evaluate(() => window.__debug.horse.handleJump());
      await page.waitForFunction(() => window.__debug.horse.__wasAirborne, null, { timeout: 20000 });
      await page.waitForFunction(() => window.__debug.horse.__landed, null, { timeout: 30000 });
    } catch {
      const state = await page.evaluate(() => {
        const h = window.__debug.horse;
        return { airborne: h.__wasAirborne, landed: h.__landed, speed: h.speed, stamina: h.stamina, mounted: h.mounted };
      });
      await restore();
      if (!state.mounted) return 'expected the player still mounted from the previous checks';
      if (!state.airborne) return `handleJump() never got the horse off the ground (speed ${state.speed.toFixed(2)}, stamina ${state.stamina.toFixed(2)})`;
      return 'the horse went up and never came back down';
    }
    await restore();

    const r = await page.evaluate(async () => {
      const { colliders } = await import('/src/collision.js');
      const { heightAt } = await import('/src/terrain.js');
      const c = (await import('/src/config-horse.js')).HORSE;
      const h = window.__debug.horse;
      const above = colliders.filter((x) => x.meta?.kind === 'rock')
        .map((x) => x.top - heightAt(x.x, x.z)).sort((a, b) => a - b);
      return {
        peak: h.__peak,
        peakClears: h.__peakClears,
        groundedClearance: h.__groundedClearance,
        lift: h.position.y - h.world.groundHeightAt(h.position.x, h.position.z),
        grounded: h.jump.grounded,
        restingClearance: h.jump.clearance(),
        weight: h.jump.weight,
        shortestRock: above[0],
        belly: c.bellyHeight - c.jumpClearMargin,
        apex: (c.jumpSpeed * c.jumpSpeed) / (2 * -c.gravity),
      };
    });
    // The measured peak runs a little under the configured apex because lift is
    // read against the ground beneath the horse, which is moving 8m across
    // sloping terrain during the flight. That is the honest number, so the
    // bound is loose on purpose.
    if (!(r.peak > r.apex * 0.7)) {
      return `the jump only reached ${r.peak.toFixed(2)} against a configured apex of ${r.apex.toFixed(2)}`;
    }
    // The clearance the real update() actually handed resolveCollisions at the
    // top of the arc — the integration, not just the arithmetic in isolation.
    if (r.groundedClearance !== -Infinity) {
      return `a grounded horse reported a clearance of ${r.groundedClearance} — it would walk through low obstacles`;
    }
    if (!(r.peakClears > 2)) {
      return `at its apex the horse only cleared ${r.peakClears.toFixed(2)} above the ground under it — it cannot pass a real rock`;
    }
    if (!(r.peakClears > r.shortestRock)) {
      return `at its apex the horse cleared ${r.peakClears.toFixed(2)}, under even the shortest rock in the world (${r.shortestRock.toFixed(2)})`;
    }
    if (!r.grounded) return `the horse is still ${r.lift.toFixed(2)} off the ground after landing`;
    if (Math.abs(r.lift) > 0.01) return `landed but resting ${r.lift.toFixed(3)} off the terrain`;
    if (r.restingClearance !== -Infinity) return 'the horse is grounded but still reporting a jump clearance';
    if (r.weight > 0.5) return `the two-point seat is still ${r.weight.toFixed(2)} blended in after landing`;
    return null;
  }],
  ['the rider stays in the saddle through the jump', async () => {
    // Reads the snapshots the previous check took inside the render loop. The
    // failure this guards is round 2c's, one axis over: the seat is built from
    // the horse's own root, and a jump moves that root 1.5m vertically while
    // the jump clip slides the spine 1.15m forward underneath it. Either would
    // leave the rider behind.
    const m = await page.evaluate(() => {
      const h = window.__debug.horse;
      return { ground: h.__groundSnap, flight: h.__flightSnap, apex: h.__apexSnap };
    });
    if (!m.flight) return 'no mid-flight sample was taken — the two-point seat never blended past 0.9';
    if (m.flight.isPlaceholder) return null; // the capsule fallback has no skeleton to measure
    if (!m.ground) return 'no grounded reference sample was taken to compare against';
    const f = m.flight;
    if (Math.abs(f.seat.side) > 0.05) {
      return `mid-flight the seat sits ${f.seat.side.toFixed(2)} off the horse's spine`;
    }
    if (Math.abs(f.hips.side) > 0.1) {
      return `mid-flight the rider's hips are ${f.hips.side.toFixed(2)} off the horse's spine`;
    }
    // The spine slides forward under the rider during the jump clip and the
    // seat tracks it (horse-seat.js's drift), so the hips must not end up
    // somewhere different from where they sit at the same gait on the ground.
    const slip = Math.abs(f.hips.fwd - m.ground.hips.fwd);
    if (slip > 0.35) {
      return `mid-flight the rider's hips are ${slip.toFixed(2)} fore/aft of where they sit on the ground — the seat is not tracking the spine`;
    }
    if (!(f.footL.side < -0.26 && f.footR.side > 0.26)) {
      return `mid-flight the boots at ${f.footL.side.toFixed(2)}/${f.footR.side.toFixed(2)} are no longer straddling the barrel`;
    }
    if (Math.abs(f.footL.up - f.footR.up) > 0.15) {
      return `mid-flight the boots are ${Math.abs(f.footL.up - f.footR.up).toFixed(2)} apart in height — a leg is swinging off`;
    }
    // ...and the rider is actually IN the two-point seat rather than sitting
    // there as if nothing happened. Measured as how far the head carries
    // forward of the hips, which is the fold RIDING_POSE.jumpTorsoPitch makes:
    // 0.34rad over the spine is ~0.2m of travel, far above any clip noise.
    // (Deliberately not measured as the hips *rising* out of the saddle: the
    // rise is only HORSE.jumpSeatRise, and `Body` is translated every frame by
    // the idle clip playing underneath — that signal sits inside this rig's own
    // jitter and read as a false failure on the placeholder-horse path.)
    const fold = (f.head.fwd - f.hips.fwd) - (m.ground.head.fwd - m.ground.hips.fwd);
    if (!(fold > 0.06)) {
      return `the rider folded only ${fold.toFixed(3)} further forward than on the ground — the two-point seat is not engaging`;
    }
    // ...and again AT THE APEX, measured against the horse's own saddle bone
    // rather than against a nominal seat height. The snapshot above is taken as
    // soon as the two-point seat blends in, which is a quarter of the way up;
    // the apex is where Gallop_Jump's own rise peaks (the clip is stretched over
    // airTime, so its mid-point is the top of the arc) and it lifts this bone
    // 0.750 in the horse's body frame, five times HORSE.saddleBobLimit. A rider
    // who does not follow that outright is inside the horse for the few frames
    // it lasts — measured at 0.61 of the pelvis buried under the back surface
    // before the fix, which is what the human saw.
    const apex = m.apex;
    if (!apex) return 'no apex sample was taken — the arc never reached the top';
    if (apex.spine && m.ground.spine) {
      const sank = (apex.hips.up - apex.spine.up) - (m.ground.hips.up - m.ground.spine.up);
      if (Math.abs(sank) > 0.2) {
        return sank < 0
          ? `at the apex the rider sits ${(-sank).toFixed(2)} lower on the horse's spine than on the ground — the back is rising through them`
          : `at the apex the rider floats ${sank.toFixed(2)} higher off the horse's spine than on the ground`;
      }
      const slid = (apex.hips.fwd - apex.spine.fwd) - (m.ground.hips.fwd - m.ground.spine.fwd);
      if (Math.abs(slid) > 0.2) {
        return `at the apex the rider sits ${slid.toFixed(2)} fore/aft of the horse's spine bone — the seat is not inheriting the jump pitch`;
      }
    }
    return null;
  }],
  ['dismount releases the player back onto the terrain', async () => {
    const result = await page.evaluate(async () => {
      const cfg = await import('/src/config.js');
      const h = window.__debug.horse;
      const p = window.__debug.player;
      h.handleMountToggle(p); // player was left mounted by the previous check
      const groundY = (await import('/src/terrain.js')).groundHeightAt(p.position.x, p.position.z);
      return { mounted: p.mounted, y: p.position.y, groundY };
    });
    if (result.mounted !== false) return 'handleMountToggle while mounted did not dismount';
    return Math.abs(result.y - result.groundY) < 0.5 ? null : `dismounted player.position.y (${result.y}) is not on the ground (${result.groundY})`;
  }],
  ['dismounting releases the riding pose, including bones no clip reclaims', async () => {
    // The rider stands up again only because riding-pose.js explicitly puts
    // back the bones the idle clip does not animate. `Torso` is the one that
    // bites: it is in no idle track, so without that release a dismounted
    // player keeps a rider's forward lean while standing still, and only
    // straightens up once they walk (walk and run *do* animate it). Reaches
    // into pose._rest for the reference, same latitude smoke already takes with
    // horse._mountBlendT.
    await page.waitForFunction((n) => window.__frames > n, await page.evaluate(() => window.__frames + 4), { timeout: 30000 });
    const info = await page.evaluate(() => {
      const rig = window.__debug.player.character;
      if (rig.isPlaceholder) return 'placeholder';
      const bone = rig.root.getObjectByName('Torso');
      const rest = rig.pose?._rest?.Torso;
      if (!bone || !rest) return null;
      return { mounted: window.__debug.player.mounted, now: bone.quaternion.toArray(), rest: rest.toArray() };
    });
    if (info === 'placeholder') return null; // the placeholder releases its own pose in update()
    if (!info) return 'Torso bone or its captured rest rotation is missing';
    if (info.mounted !== false) return 'expected the player dismounted from the previous check';
    const drift = Math.max(...info.rest.map((v, i) => Math.abs(v - info.now[i])));
    return drift < 0.02 ? null : `Torso is still ${drift.toFixed(3)} from its rest rotation after dismounting — the riding pose was not released`;
  }],
  ['horse collider is registered exactly once, even after a mount/dismount cycle', async () => {
    const count = await page.evaluate(async () => {
      const { colliders } = await import('/src/collision.js');
      return colliders.filter((c) => c.meta?.kind === 'horse').length;
    });
    return count === 1 ? null : `expected exactly 1 horse collider, found ${count}`;
  }],
  ['horse stamina stays within [0, staminaMax]', async () => {
    const info = await page.evaluate(async () => {
      const cfg = await import('/src/config-horse.js');
      return { stamina: window.__debug?.horse?.stamina, max: cfg.HORSE.staminaMax };
    });
    if (typeof info.stamina !== 'number') return `horse.stamina missing (${info.stamina})`;
    return info.stamina >= 0 && info.stamina <= info.max ? null : `horse.stamina is ${info.stamina}, expected within [0, ${info.max}]`;
  }],
  ['the stamina bar is fed a fraction, not raw stamina', async () => {
    // ui.js is generic and documents its argument as 0..1, but HORSE.staminaMax
    // is a tuning lever that has already moved twice (1 -> 1.5 -> 1). At a tank
    // of exactly 1 the raw value and the fraction are the same number, so the
    // check would have no teeth if it just read the bar as it stands: it
    // temporarily resizes the tank, fills it, and renders a frame, so the two
    // paths give different widths whatever the tank is set to. Reading the
    // width the bar actually ends up at covers the whole chain —
    // horse.staminaFraction, main.js's call, and the CSS — rather than just
    // the getter's arithmetic. On the raw-stamina path this renders at 150%.
    const info = await page.evaluate(async () => {
      const cfg = await import('/src/config-horse.js');
      const h = window.__debug?.horse;
      const restoreMax = cfg.HORSE.staminaMax;
      const restoreStamina = h?.stamina;
      try {
        cfg.HORSE.staminaMax = restoreMax * 1.5;
        if (h) h.stamina = cfg.HORSE.staminaMax;
        // Two frames: one for the loop to consume the new values, one to be
        // sure the style landed. Headless runs at ~3fps, so this is ~0.7s.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return {
          fraction: h?.staminaFraction,
          stamina: h?.stamina,
          max: cfg.HORSE.staminaMax,
          width: document.getElementById('staminaFill')?.style?.width ?? null,
        };
      } finally {
        cfg.HORSE.staminaMax = restoreMax;
        if (h) h.stamina = restoreStamina;
      }
    });
    if (typeof info.fraction !== 'number') return `horse.staminaFraction missing (${info.fraction})`;
    if (info.fraction < 0 || info.fraction > 1) {
      return `horse.staminaFraction is ${info.fraction.toFixed(3)}, which is not a 0..1 fraction`;
    }
    if (Math.abs(info.fraction - info.stamina / info.max) > 1e-9) {
      return `horse.staminaFraction (${info.fraction}) is not stamina/staminaMax (${info.stamina / info.max})`;
    }
    const pct = Number.parseFloat(info.width);
    if (!Number.isFinite(pct)) return `the stamina bar has no rendered width (${info.width})`;
    if (pct < 0 || pct > 100) return `the stamina bar is rendering at ${info.width} — it is being fed raw stamina, not a fraction`;
    return null;
  }],

  ['no leftover jump clip on the real player rig (removed feature)', async () => {
    // Regression guard for the opposite direction now: the retargeted jump
    // clip (retarget.js + config.js's ANIM_SOURCE/HIP_FOLLOW/KNEE_FOLLOW)
    // was built, tuned repeatedly, and ultimately pulled out because it
    // never read as right in real play — see docs/DEVELOPMENT-NOTES.md.
    // character.js should never construct a "jump" action anymore;
    // this catches a partial revert that leaves the pipeline half-wired.
    const info = await page.evaluate(() => ({
      isPlaceholder: window.__debug?.modelsLoaded?.player === false,
      hasJumpAction: !!window.__debug?.player?.character?.actions?.jump,
    }));
    if (info.isPlaceholder) return null; // placeholder fallback path, not applicable
    return info.hasJumpAction ? 'character.actions.jump exists — the removed jump-clip pipeline is back' : null;
  }],

  // ============================================================ round 3 ===

  ['character rigs are merged down from one mesh per colour', async () => {
    // These GLBs model one mesh per colour — 16 on a bandit — and each is a
    // draw call in both the colour and the shadow pass. Measured before the
    // merge: 110 draw calls at a camp against a ~120 budget. See rig-merge.js.
    const info = await page.evaluate(() => {
      const d = window.__debug;
      const count = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
      return {
        player: count(d.player.character.root),
        bandit: d.bandits.bandits[0] ? count(d.bandits.bandits[0].character.root) : null,
        horse: count(d.horse.character.root),
        placeholder: d.player.character.isPlaceholder,
        // Each rig falls back independently, so each has to be asked
        // separately — a capsule placeholder has no materials to merge and
        // legitimately carries more meshes than a merged GLB.
        banditPlaceholder: !!d.bandits.bandits[0]?.character.isPlaceholder,
        horsePlaceholder: !!d.horse.character.isPlaceholder,
      };
    });
    if (info.placeholder) return null; // capsules have nothing to merge
    if (!info.horsePlaceholder && !(info.horse <= 2)) return `horse rig is ${info.horse} meshes — the merge did not run`;
    if (!info.banditPlaceholder && info.bandit !== null && !(info.bandit <= 9)) {
      return `bandit rig is ${info.bandit} meshes, expected well under 16`;
    }
    if (!(info.player <= 12)) return `player rig is ${info.player} meshes, expected it merged`;
    return null;
  }],
  ['the support hand reaches the gun instead of hovering near it', async () => {
    // It used to be posed by three fixed angles, which cannot track a target
    // that moves with elevation — measured, the hand sat 0.134 from the grip
    // while the arm is only 0.423 long against a 0.556 reach. See ik.js.
    const info = await page.evaluate(() => {
      const rig = window.__debug.player.character;
      if (rig.isPlaceholder || !rig.weapon?.support) return null;
      const V = window.__debug.player.position.constructor;
      const gaps = [];
      for (const elevation of [-0.4, 0, 0.5]) {
        rig.setAimPose({ weight: 1, elevation, recoil: 0, reload: 0, support: 1, hold: 1 });
        rig.update(0.016);
        rig.root.updateMatrixWorld(true);
        rig.weapon.syncWorld();
        const hand = rig.root.getObjectByName('WristL').getWorldPosition(new V());
        gaps.push(hand.distanceTo(rig.weapon.support.getWorldPosition(new V())));
      }
      rig.setAimPose({ weight: 0 });
      return { worst: Math.max(...gaps) };
    });
    if (!info) return null; // placeholder rig, or an unarmed one
    console.log(`  (info) support hand sits ${info.worst.toFixed(3)} from the gun's grip at worst`);
    return info.worst < 0.08 ? null : `support hand is ${info.worst.toFixed(3)} from the gun — hovering, not holding`;
  }],
  ['a riderless horse can be shot, bolts, and is never killed', async () => {
    const info = await page.evaluate(async () => {
      const { HEALTH } = await import('/src/config-ai.js');
      const d = window.__debug;
      if (d.player.mounted) d.horse.handleMountToggle(d.player);
      d.horse.health.reset();
      d.horse.mounted = true;
      const mountedRefusal = d.horse.damage(HEALTH.horseDamage, 0, 0);
      d.horse.mounted = false;
      const outcomes = [];
      for (let i = 0; i < HEALTH.horseMax + 1; i++) {
        outcomes.push(d.horse.damage(HEALTH.horseDamage, d.horse.position.x + 5, d.horse.position.z));
      }
      const result = { mountedRefusal, outcomes, spooked: d.horse.spooked, health: d.horse.health.current, max: HEALTH.horseMax };
      // Put the animal back. A bolting horse refuses to be mounted for
      // HORSE.spookTime, which is exactly long enough to break every later
      // check that needs to get on it — this check must not leave that behind.
      d.horse.ai.spookT = 0;
      d.horse.ai.spookRecoverT = 0;
      d.horse.health.reset();
      return result;
    });
    if (info.mountedRefusal !== null) return `a mounted horse took damage (${info.mountedRefusal}) — shots at the rider must not be soaked by the animal`;
    if (!info.outcomes.includes('spooked')) return `taking ${info.max + 1} rounds never made it bolt: ${JSON.stringify(info.outcomes)}`;
    if (!info.spooked) return 'the horse is not bolting after being shot up';
    if (!(info.health > 0)) return 'the horse was left on zero health — it should bolt, never die';
    return null;
  }],
  ['draw calls are inside BUILD-PLAN.md\'s ~120 budget', async () => {
    // Not a feel check and not round 7's real performance pass — just a floor
    // that catches a round quietly adding fifty draw calls. vfx.js's pools are
    // fixed-size for exactly this reason, so the number should barely move
    // whether nothing or everything is on screen.
    const info = await page.evaluate(() => {
      const r = window.__debug?.renderer;
      return r ? { calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs?.length ?? null } : null;
    });
    if (!info) return 'window.__debug.renderer is missing — cannot read the draw-call count';
    console.log(`  (info) draw calls ${info.calls}, triangles ${info.triangles.toLocaleString()}, programs ${info.programs}`);
    return info.calls <= 120 ? null : `${info.calls} draw calls, budget is ~120`;
  }],

  ['all three round-3 sounds loaded', async () => {
    // audio.js never throws on a missing file — that is BUILD-PLAN.md's rule
    // and the reason a silent gunfight would otherwise ship unnoticed. The
    // only way to notice is to ask what it failed to load.
    const missing = await page.evaluate(() => window.__debug?.audioMissing ?? null);
    if (missing === null) return 'no audio layer was built at all';
    return missing.length ? `missing audio: ${missing.join(', ')} — the gunfight will be silent` : null;
  }],

  ['no sound is an accidental burst, and none of them clip', async () => {
    // This exists because the shipped gunshot was three shots. The source file
    // (OpenGameArt "Gunshots", Black Powder) is a SIX-SHOT take, and the
    // round-3 trim to 1.6s captured three of them — so every trigger pull
    // played "tick tick tick". It got past a listen-free review because the
    // checks at the time only asked whether the file loaded.
    //
    // Decoding the buffer and counting onsets is the check that would have
    // caught it. Also asserts headroom: loudnorm had left all three sitting at
    // or above 0 dBFS, and Vorbis overshoots on a sharp transient, so the
    // gunshot was clipping on decode — which is its own kind of "tick".
    //
    // The budget is PER FILE (AUDIO.maxOnsets), not a blanket "one": a reload
    // legitimately is a sequence of mechanical clicks, while a gunshot and a
    // bullet impact are single events. A blanket rule failed the reload on its
    // first run, which is the check being wrong rather than the file.
    const report = await page.evaluate(async () => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const AUDIO = (await import('/src/config-combat.js')).AUDIO;
      const out = [];
      for (const [name, file] of Object.entries(AUDIO.files)) {
        const buf = await ctx.decodeAudioData(await (await fetch('/audio/' + file)).arrayBuffer());
        const data = buf.getChannelData(0);
        const win = Math.max(1, Math.round(buf.sampleRate * 0.01)); // 10ms
        const env = [];
        let peak = 0;
        for (let i = 0; i < data.length; i += win) {
          let m = 0;
          for (let j = i; j < Math.min(i + win, data.length); j++) {
            const a = Math.abs(data[j]);
            if (a > m) m = a;
          }
          env.push(m);
          if (m > peak) peak = m;
        }
        // An onset is a window above a fraction of the file's peak that
        // follows a run of quiet ones — so a single crack plus its decay tail
        // counts once, but a second shot 0.4s later counts again.
        const loud = peak * 0.35;
        const quietGap = 25; // 250ms below the threshold separates two events
        let onsets = 0;
        let sinceLoud = quietGap;
        const at = [];
        for (let i = 0; i < env.length; i++) {
          if (env[i] >= loud) {
            if (sinceLoud >= quietGap) { onsets++; at.push(+(i * 0.01).toFixed(2)); }
            sinceLoud = 0;
          } else sinceLoud++;
        }
        out.push({ name, file, onsets, at, peak, max: AUDIO.maxOnsets?.[name] ?? 1, duration: +buf.duration.toFixed(2) });
      }
      await ctx.close();
      return out;
    });
    for (const s of report) {
      if (s.onsets < 1) return `${s.file} has no audible transient at all`;
      if (s.onsets > s.max) {
        return `${s.file} contains ${s.onsets} separate hits (at ${s.at.join('s, ')}s), budget is ${s.max} — bad trim, or the source was a multi-take file`;
      }
      if (s.peak >= 0.999) return `${s.file} peaks at full scale — it clips on decode`;
      if (s.peak < 0.05) return `${s.file} peaks at only ${s.peak.toFixed(3)} — effectively silent`;
    }
    console.log(`  (info) ${report.map((s) => `${s.name} ${s.duration}s peak ${(20 * Math.log10(s.peak)).toFixed(1)}dB`).join(', ')}`);
    return null;
  }],

  ['the revolver hangs off the hand bone at life size, not the armature\'s scale', async () => {
    // Two separate traps in one check. First, GLTFLoader strips dots, so the
    // bone is `WristR` and not `Wrist.R` — getting that wrong attaches the gun
    // to the character root instead (weapons.js warns, but a warning is not a
    // failure). Second, this rig carries a large baked armature scale that any
    // parented mesh inherits; without dividing it back out the revolver
    // renders at some multiple of life size.
    const info = await page.evaluate(() => {
      const d = window.__debug;
      const w = d?.player?.character?.weapon;
      if (!w) return { missing: true };
      const chain = [];
      for (let n = w.group; n; n = n.parent) chain.push(n.name || n.type);
      w.group.updateWorldMatrix(true, false);
      const s = new (w.group.constructor === Object ? Object : Object)(); // placeholder, unused
      const m = w.group.matrixWorld.elements;
      // Column lengths of the world matrix are its world scale.
      const worldScale = Math.hypot(m[0], m[1], m[2]);
      return {
        missing: false,
        attachedToHand: w.attachedToHand,
        boneName: w.handBone?.name ?? null,
        boneWorldScale: w.boneWorldScale?.x ?? null,
        worldScale,
        chain: chain.slice(0, 6),
        isPlaceholder: d.modelsLoaded?.player === false,
      };
    });
    if (info.missing) return 'the player character has no weapon at all';
    if (!info.attachedToHand) return `the revolver fell back to the character root (bone search failed; chain: ${info.chain.join(' < ')})`;
    if (info.isPlaceholder) return null; // the capsule rig has no armature scale to undo
    if (info.boneName !== 'WristR') return `attached to "${info.boneName}", expected the dot-stripped runtime name WristR`;
    // The whole point of the divide-out: the bone's own scale is nowhere near
    // 1, and the gun's ends up very close to it.
    if (!(info.worldScale > 0.5 && info.worldScale < 2)) {
      return `the revolver renders at world scale ${info.worldScale.toFixed(2)} — the armature's baked scale (${info.boneWorldScale?.toFixed?.(2)}) is not being divided out`;
    }
    return null;
  }],

  ['the muzzle empty rides the gun barrel, not the camera', async () => {
    // BUILD-PLAN.md is explicit that the muzzle flash and the raycast origin
    // both come from an Object3D parented to the barrel tip and NOT from the
    // camera, and docs/ROADMAP.md asked for this specifically. Two halves: the
    // camera must not be anywhere in the muzzle's parent chain, and the muzzle
    // must actually MOVE with the rig — a muzzle welded to the world would
    // pass a pure ancestry test while aiming from a fixed point in space.
    const info = await page.evaluate(() => {
      const d = window.__debug;
      const w = d?.player?.character?.weapon;
      const root = d?.player?.character?.root;
      if (!w || !root) return { missing: true };
      const chain = [];
      let sawCamera = false;
      for (let n = w.muzzle; n; n = n.parent) {
        chain.push(n.name || n.type);
        if (n.isCamera) sawCamera = true;
      }
      const before = { x: 0, y: 0, z: 0 };
      w.syncWorld();
      before.x = w.muzzle.matrixWorld.elements[12];
      before.y = w.muzzle.matrixWorld.elements[13];
      before.z = w.muzzle.matrixWorld.elements[14];
      const restore = root.rotation.y;
      root.rotation.y = restore + 1.2;
      root.updateMatrixWorld(true);
      w.syncWorld();
      const moved = Math.hypot(
        w.muzzle.matrixWorld.elements[12] - before.x,
        w.muzzle.matrixWorld.elements[14] - before.z,
      );
      root.rotation.y = restore;
      root.updateMatrixWorld(true);
      return { missing: false, sawCamera, chain: chain.slice(0, 8), moved, reachesRoot: chain.includes(root.name || root.type) };
    });
    if (info.missing) return 'no weapon/muzzle to check';
    if (info.sawCamera) return `the muzzle is parented under the camera (chain: ${info.chain.join(' < ')})`;
    if (!(info.moved > 0.05)) {
      return `turning the character moved the muzzle only ${info.moved.toFixed(3)}m — it is not riding the rig`;
    }
    return null;
  }],

  ['aiming narrows the FOV and pulls the camera in, on foot and mounted alike', async () => {
    // docs/ROADMAP.md item 10: aim and mounted must COMPOSE, not override each
    // other. Reads the camera's own live fov and distance rather than the
    // config, so it covers the easing path too.
    const cfg = await page.evaluate(async () => {
      const c = (await import('/src/config.js')).CAMERA;
      return { aimFov: c.aimFov, aimDistance: c.aimDistance, mountedAimDistance: c.mountedAimDistance, distance: c.distance };
    });
    const read = () => page.evaluate(() => ({
      fov: window.__debug.cameraFov,
      dist: window.__debug.cameraCurrentDistance,
      aimWeight: window.__debug.aimWeight,
      mounted: window.__debug.mounted,
    }));
    // Stand somewhere with nothing behind the camera, and push the horse well
    // away. Distance is the OUTPUT of an occlusion sweep, so a check that just
    // measures wherever the previous checks left the player is measuring the
    // scenery: this failed once reading 1.30 -> 1.30, both clamped to
    // CAMERA.minDistance, because the horse had wandered up beside the player
    // and the on-foot camera does not ignore its collider.
    await page.evaluate(() => {
      const d = window.__debug;
      if (d.player.mounted) d.horse.handleMountToggle(d.player);
      d.player.position.set(0, d.player.world.groundHeightAt(0, 95), 95);
      d.horse.position.set(40, d.horse.world.groundHeightAt(40, 95), 95);
      d.tpCamera.pitch = 0.1;
      d.tpCamera.yaw = 0;
      d.tpCamera.snap(d.player.position);
    });
    await page.evaluate(() => { window.__debug.combat.setAimOverride(false); });
    await page.waitForFunction(() => window.__debug.aimWeight < 0.05, null, { timeout: 20000 });
    const hip = await read();
    await page.evaluate(() => { window.__debug.combat.setAimOverride(true); });
    await page.waitForFunction(() => window.__debug.aimWeight > 0.95, null, { timeout: 20000 });
    const aimed = await read();
    await page.evaluate(() => { window.__debug.combat.setAimOverride(null); });
    if (!(aimed.fov < hip.fov - 5)) {
      return `fov went ${hip.fov.toFixed(1)} -> ${aimed.fov.toFixed(1)} while aiming; expected it to narrow toward ${cfg.aimFov}`;
    }
    // Guard against measuring nothing: if the sweep clamped both samples to
    // minDistance the camera was simply obstructed, and the comparison below
    // would be meaningless either way.
    const cfgMin = await page.evaluate(async () => (await import('/src/config.js')).CAMERA.minDistance);
    if (hip.dist <= cfgMin + 0.01) {
      return `the camera was fully obstructed (${hip.dist.toFixed(2)} = minDistance) before aiming — nothing was measured`;
    }
    if (!(aimed.dist < hip.dist - 0.5)) {
      return `camera distance went ${hip.dist.toFixed(2)} -> ${aimed.dist.toFixed(2)} while aiming; expected it to pull in`;
    }
    return null;
  }],

  ['barrels are shootable AND jumpable — a real, finite collider top', async () => {
    // ADR-012's contract, reused rather than re-invented: barrels are low
    // enough for the horse to clear, so they must carry a real `top` instead
    // of the default Infinity that makes a collider unlimited-height.
    const info = await page.evaluate(async () => {
      const cfg = (await import('/src/config-combat.js')).TARGETS;
      const { colliders } = await import('/src/collision.js');
      const barrels = colliders.filter((c) => c.meta?.kind === 'barrel');
      const t = window.__debug.targets;
      return {
        counts: t?.counts ?? null,
        registered: barrels.length,
        finiteTops: barrels.filter((c) => Number.isFinite(c.top)).length,
        haveTargetRef: barrels.filter((c) => !!c.meta?.target).length,
        height: cfg.barrelHeight,
        minTopAboveGround: Math.min(...barrels.map((c) => c.top - (c.meta.target?.base ?? 0))),
      };
    });
    if (!info.counts) return 'no targets were built';
    if (info.counts.barrels < 1 || info.counts.bottles < 1) {
      return `expected barrels and bottles to shoot at, got ${JSON.stringify(info.counts)}`;
    }
    if (info.registered !== info.counts.barrels) {
      return `${info.counts.barrels} barrels placed but ${info.registered} colliders registered`;
    }
    if (info.finiteTops !== info.registered) {
      return `${info.registered - info.finiteTops} barrel colliders have top: Infinity — the horse cannot jump them`;
    }
    if (info.haveTargetRef !== info.registered) {
      return 'barrel colliders are missing their meta.target back-reference, so a hit cannot be attributed';
    }
    if (Math.abs(info.minTopAboveGround - info.height) > 0.02) {
      return `barrel collider top sits ${info.minTopAboveGround.toFixed(2)} above its base, expected ${info.height}`;
    }
    return null;
  }],

  ['a fired shot hits a target directly in front, from the muzzle', async () => {
    // docs/ROADMAP.md item 11's headline check. The target is moved onto the
    // camera's LIVE view ray rather than the camera being solved onto the
    // target: the camera looks at its own pivot plus a shoulder offset, so an
    // analytically aimed yaw/pitch misses by more than a barrel's width at
    // this range. Spread is zeroed for the duration so the check tests the
    // aiming chain, not the dice — a separate check covers the spread itself.
    const setup = await page.evaluate(async () => {
      const cfg = await import('/src/config-combat.js');
      const d = window.__debug;
      const c = d.combat;
      const t = d.targets;
      const p = d.player;
      const h = d.horse;
      if (p.mounted) h.handleMountToggle(p);

      window.__shotRestore = {
        spreadHip: cfg.COMBAT.spreadHip,
        spreadAim: cfg.COMBAT.spreadAim,
        cfg,
      };
      cfg.COMBAT.spreadHip = 0;
      cfg.COMBAT.spreadAim = 0;

      // Clear plateau, level view: nothing between the muzzle and the target
      // but the 14m of air we are about to put a barrel at the end of.
      p.position.set(0, p.world.groundHeightAt(0, 95), 95);
      d.tpCamera.pitch = 0;
      d.tpCamera.yaw = 0;
      d.tpCamera.snap(p.position);
      return { ok: true };
    });
    if (!setup.ok) return 'could not set up the shot';
    // Let a frame run so the camera settles and the rig is posed.
    const framesAtSetup = await page.evaluate(() => window.__frames);
    await page.waitForFunction((f) => window.__frames > f + 2, framesAtSetup, { timeout: 20000 });

    const result = await page.evaluate(async () => {
      const d = window.__debug;
      const t = d.targets;
      const cam = d.tpCamera.camera;
      const eye = cam.getWorldPosition(new (cam.position.constructor)());
      const dir = cam.getWorldDirection(new (cam.position.constructor)());
      const dist = 14;
      const tx = eye.x + dir.x * dist;
      const ty = eye.y + dir.y * dist;
      const tz = eye.z + dir.z * dist;

      const item = t.items.find((i) => i.kind === 'barrel' && i.alive);
      window.__shotRestore.item = { x: item.x, z: item.z, base: item.base, top: item.top, hits: item.hits };
      window.__shotRestore.collider = { x: item.collider.x, z: item.collider.z, top: item.collider.top };
      window.__shotRestore.ref = item;
      const half = (item.top - item.base) / 2;
      item.x = tx; item.z = tz;
      item.base = ty - half; item.top = ty + half;
      item.collider.x = tx; item.collider.z = tz; item.collider.top = item.top;

      const before = d.combat.shotsFired;
      const fired = d.combat.tryFire();
      return { fired, before, targetPoint: { x: tx, y: ty, z: tz } };
    });
    if (!result.fired) return 'combat.tryFire() was refused with a loaded gun and no reload in progress';
    await page.waitForFunction((n) => window.__debug.shotsFired > n, result.before, { timeout: 20000 });

    const hit = await page.evaluate(() => {
      const d = window.__debug;
      const out = { lastHit: d.combat.lastHit, hitsOnTarget: window.__shotRestore.ref.hits };
      // Put the barrel back where it was placed, un-hit, before anything else
      // looks at it.
      const r = window.__shotRestore;
      Object.assign(r.ref, r.item);
      r.ref.collider.x = r.collider.x;
      r.ref.collider.z = r.collider.z;
      r.ref.collider.top = r.collider.top;
      r.cfg.COMBAT.spreadHip = r.spreadHip;
      r.cfg.COMBAT.spreadAim = r.spreadAim;
      return out;
    });
    if (!hit.lastHit || hit.lastHit.kind === null) return 'the shot hit nothing at all';
    if (hit.lastHit.kind !== 'barrel') {
      return `the shot hit "${hit.lastHit.kind}" at ${hit.lastHit.distance.toFixed(1)}m instead of the barrel directly in front`;
    }
    if (hit.hitsOnTarget < 1) return 'the barrel was hit but recorded no damage';
    return null;
  }],

  ['ammo decrements per shot and a reload refills the cylinder', async () => {
    const cfg = await page.evaluate(async () => (await import('/src/config-combat.js')).COMBAT);
    // The previous check fired a shot, and a shot leaves COMBAT.fireInterval of
    // cooldown behind. Wait it out on the public getter rather than racing it —
    // this check timed out exactly once for want of these two lines.
    await page.waitForFunction(() => window.__debug.combat.canFire, null, { timeout: 30000 });
    const start = await page.evaluate(() => {
      const c = window.__debug.combat;
      c.ammo = 3; // mid-cylinder, so a refill is visibly different from "unchanged"
      return { ammo: c.ammo, shots: c.shotsFired, fired: c.tryFire() };
    });
    if (start.ammo !== 3) return 'could not set the ammo count';
    if (!start.fired) return 'combat.tryFire() was refused immediately after canFire reported true';
    await page.waitForFunction((n) => window.__debug.shotsFired > n, start.shots, { timeout: 30000 });
    const afterShot = await page.evaluate(() => window.__debug.combat.ammo);
    if (afterShot !== 2) return `firing one round took ammo from 3 to ${afterShot}, expected 2`;

    const accepted = await page.evaluate(() => window.__debug.combat.tryReload());
    if (!accepted) return 'a reload was refused on foot with a part-empty cylinder';
    const midReload = await page.evaluate(() => ({
      reloading: window.__debug.combat.reloading,
      ammo: window.__debug.combat.ammo,
      refused: window.__debug.combat.tryFire(),
    }));
    if (!midReload.reloading) return 'tryReload() did not enter the reloading state';
    if (midReload.ammo !== 2) return `ammo jumped to ${midReload.ammo} at the START of the reload; it should only refill when the lockout ends`;
    if (midReload.refused !== false) return 'the gun fired during the reload lockout';

    // COMBAT.reloadTime is 1.7s of SIMULATED time; headless runs ~3fps with dt
    // capped at RENDER.maxDeltaTime, so that is ~34 frames of wall clock.
    await page.waitForFunction(() => window.__debug.combat.reloading === false, null, { timeout: 40000 });
    const done = await page.evaluate(() => window.__debug.combat.ammo);
    if (done !== cfg.magazine) return `after the reload the cylinder holds ${done}, expected ${cfg.magazine}`;
    // Empty gun, no reload: the trigger must do nothing rather than going negative.
    const dry = await page.evaluate(() => {
      const c = window.__debug.combat;
      c.ammo = 0;
      const fired = c.tryFire();
      const ammo = c.ammo;
      c.ammo = 6;
      return { fired, ammo };
    });
    if (dry.fired || dry.ammo !== 0) return `an empty gun fired anyway (fired=${dry.fired}, ammo went to ${dry.ammo})`;
    return null;
  }],

  ['a bottle breaks in one hit, a barrel takes two, and a dead target stops colliding', async () => {
    const info = await page.evaluate(async () => {
      const cfg = (await import('/src/config-combat.js')).COMBAT;
      const { colliders } = await import('/src/collision.js');
      const t = window.__debug.targets;
      const bottle = t.items.find((i) => i.kind === 'bottle' && i.alive);
      const barrel = t.items.find((i) => i.kind === 'barrel' && i.alive && !t.items.some(
        (b) => b.kind === 'bottle' && b.alive && Math.abs(b.base - i.top) < 1e-3
          && Math.hypot(b.x - i.x, b.z - i.z) < 0.5,
      ));
      if (!bottle || !barrel) return { missing: true };

      const bottleOutcome = t.hit(bottle);
      const barrelFirst = t.hit(barrel);
      const barrelSecond = t.hit(barrel);
      const colliderStillListed = colliders.includes(barrel.collider ?? {});
      // A destroyed instance is hidden by a zero-scale matrix, not a rebuilt
      // buffer — read the matrix back to prove it actually happened.
      const m = new Float32Array(16);
      const arr = barrel.mesh.instanceMatrix.array;
      for (let i = 0; i < 16; i++) m[i] = arr[barrel.index * 16 + i];
      const scaleX = Math.hypot(m[0], m[1], m[2]);
      return {
        missing: false, bottleOutcome, barrelFirst, barrelSecond,
        bottleAlive: bottle.alive, barrelAlive: barrel.alive,
        colliderStillListed, scaleX, barrelHits: cfg.barrelHits, bottleHits: cfg.bottleHits,
      };
    });
    if (info.missing) return 'could not find a live bottle and a bottle-free barrel to test on';
    if (info.bottleOutcome !== 'destroyed' || info.bottleAlive) {
      return `a bottle survived ${info.bottleHits} hit(s) (outcome "${info.bottleOutcome}")`;
    }
    if (info.barrelFirst !== 'hit') return `a barrel reported "${info.barrelFirst}" on its first hit, expected "hit"`;
    if (info.barrelSecond !== 'destroyed' || info.barrelAlive) {
      return `a barrel survived ${info.barrelHits} hits (outcome "${info.barrelSecond}")`;
    }
    if (info.colliderStillListed) return 'a destroyed barrel is still registered in the collider list — it blocks movement and catches bullets';
    if (info.scaleX > 1e-6) return `a destroyed barrel's instance matrix still has scale ${info.scaleX} — it is still drawn`;
    return null;
  }],

  ['the reload is gated on the horse\'s GAIT, not on its stamina', async () => {
    // docs/ROADMAP.md item 2 by name: `staminaExhausted` is not "currently
    // galloping", and gating on it would refuse reloads at a standstill and
    // allow them at a gallop — exactly backwards. Both halves are asserted.
    const info = await page.evaluate(async () => {
      const cfg = (await import('/src/config-horse.js')).HORSE;
      const d = window.__debug;
      const h = d.horse;
      const p = d.player;
      const c = d.combat;
      if (!p.mounted) {
        p.position.set(h.position.x + 1, h.position.y, h.position.z);
        h.handleMountToggle(p);
      }
      const restore = { animState: h.animState, stamina: h.stamina, exhausted: h.staminaExhausted, ammo: c.ammo, reloading: c.reloading };
      c.reloading = false;
      c.ammo = 1; // part-empty, so canReload is not refused for being full

      h.animState = 'gallop';
      h.stamina = cfg.staminaMax;
      h.staminaExhausted = false;
      const atGallopFullTank = { galloping: h.isGalloping, canReload: c.canReload, exhausted: h.staminaExhausted };

      h.animState = 'walk';
      h.stamina = 0;
      h.staminaExhausted = true;
      const atWalkEmptyTank = { galloping: h.isGalloping, canReload: c.canReload, exhausted: h.staminaExhausted };

      Object.assign(h, { animState: restore.animState, stamina: restore.stamina, staminaExhausted: restore.exhausted });
      c.ammo = restore.ammo;
      c.reloading = restore.reloading;
      if (p.mounted) h.handleMountToggle(p);
      return { atGallopFullTank, atWalkEmptyTank };
    });
    if (info.atGallopFullTank.canReload) {
      return 'a reload was allowed at a full gallop (with a full stamina tank) — the gate is reading stamina, not gait';
    }
    if (!info.atWalkEmptyTank.canReload) {
      return 'a reload was refused at a walk with an exhausted horse — the gate is reading stamina, not gait';
    }
    return null;
  }],

  ['aiming raises the gun arm without unseating the rider', async () => {
    // The partial-skeleton split BUILD-PLAN.md asks for, measured: while
    // mounted and aiming, aim-pose.js must own the right arm while
    // riding-pose.js keeps the legs. If the two layers fought, either the arm
    // would never come up or the knees would come off the barrel.
    //
    // Measured in the HORSE'S OWN BODY FRAME, like every other cross-rig check
    // here — a world-axis reading is right at rest and wrong in every turn.
    const isPlaceholder = await page.evaluate(() => window.__debug.modelsLoaded.player === false
      || window.__debug.modelsLoaded.horse === false);
    if (isPlaceholder) return null; // no skeleton to assert against
    const mounted = await page.evaluate(() => {
      const d = window.__debug;
      const h = d.horse;
      const p = d.player;
      if (!p.mounted) {
        p.position.set(h.position.x + 1, h.position.y, h.position.z);
        h.handleMountToggle(p);
      }
      return p.mounted;
    });
    if (!mounted) return 'could not remount for the mounted-aim check';
    const mountLerpTime = await page.evaluate(async () => (await import('/src/config-horse.js')).HORSE.mountLerpTime);
    await page.waitForFunction((t) => window.__debug.horse._mountBlendT >= t, mountLerpTime, { timeout: 20000 });

    const sample = () => page.evaluate(() => {
      const d = window.__debug;
      const rig = d.player.character.root;
      const horseRig = d.horse.character.root;
      const THREEv = rig.position.constructor;
      const inv = horseRig.matrixWorld.clone().invert();
      const body = (bone) => {
        const v = new THREEv();
        bone.getWorldPosition(v);
        v.applyMatrix4(inv);
        return { x: v.x, y: v.y, z: v.z };
      };
      const bones = {};
      for (const name of ['WristR', 'LowerLegL', 'LowerLegR', 'Body']) {
        const b = rig.getObjectByName(name);
        if (b) bones[name] = body(b);
      }
      return bones;
    });

    await page.evaluate(() => window.__debug.combat.setAimOverride(false));
    await page.waitForFunction(() => window.__debug.aimWeight < 0.05, null, { timeout: 20000 });
    const down = await sample();
    await page.evaluate(() => window.__debug.combat.setAimOverride(true));
    await page.waitForFunction(() => window.__debug.aimWeight > 0.95, null, { timeout: 20000 });
    const up = await sample();
    await page.evaluate(() => window.__debug.combat.setAimOverride(null));

    if (!down.WristR || !up.WristR) return 'WristR not found on the player rig — the revolver has nothing to hang off';
    // The gun hand comes UP and FORWARD in the horse's own frame.
    const rise = up.WristR.y - down.WristR.y;
    if (!(rise > 0.15)) {
      return `aiming raised the gun hand only ${rise.toFixed(3)} in the horse's body frame — the aim pose is not reaching the arm`;
    }
    // ...and the legs stay exactly where the riding pose put them.
    for (const leg of ['LowerLegL', 'LowerLegR']) {
      if (!down[leg] || !up[leg]) continue;
      const moved = Math.hypot(up[leg].x - down[leg].x, up[leg].y - down[leg].y, up[leg].z - down[leg].z);
      if (moved > 0.12) {
        return `aiming moved ${leg} by ${moved.toFixed(3)} — the aim layer is stealing bones the riding pose owns`;
      }
    }
    return null;
  }],

  ['the aiming pose is idempotent across frames', async () => {
    // The same compounding-delta guard the riding pose carries, for the same
    // reason (docs/ANIMATION.md rule 4): aim-pose.js applies deltas, and the
    // bones it claims are not all rewritten by a clip every frame. If the
    // baseline restore were dropped, the arm would creep a little further
    // every frame and the check below would drift.
    const isPlaceholder = await page.evaluate(() => window.__debug.modelsLoaded.player === false);
    if (isPlaceholder) return null;
    await page.evaluate(() => {
      const d = window.__debug;
      if (d.player.mounted) d.horse.handleMountToggle(d.player);
      d.combat.setAimOverride(true);
    });
    await page.waitForFunction(() => window.__debug.aimWeight > 0.98, null, { timeout: 20000 });
    const read = () => page.evaluate(() => {
      const rig = window.__debug.player.character.root;
      const out = {};
      for (const name of ['UpperArmR', 'LowerArmR', 'Chest']) {
        const b = rig.getObjectByName(name);
        if (b) out[name] = [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w];
      }
      return out;
    });
    const first = await read();
    const frames = await page.evaluate(() => window.__frames);
    await page.waitForFunction((f) => window.__frames > f + 8, frames, { timeout: 25000 });
    const later = await read();
    await page.evaluate(() => window.__debug.combat.setAimOverride(null));
    for (const name of Object.keys(first)) {
      const a = first[name];
      const b = later[name];
      if (!b) return `${name} vanished between samples`;
      const drift = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      // The idle clip underneath keeps moving, so this is not zero — but a
      // compounding delta walks off monotonically and blows straight past it.
      if (drift > 0.06) {
        return `${name} drifted ${drift.toFixed(4)} over 8 frames of a held aim — the pose is compounding, not idempotent`;
      }
    }
    return null;
  }],

  // Round 4 ---------------------------------------------------------------
  ['bandit.glb loaded, and every camp is manned (not the capsule placeholder)', async () => {
    const info = await page.evaluate(() => {
      const b = window.__debug?.bandits;
      if (!b) return null;
      return {
        counts: b.counts,
        alive: b.aliveCount,
        placeholders: b.bandits.filter((x) => x.character.isPlaceholder).length,
        perCamp: b.camps.map((c) => c.count),
      };
    });
    if (!info) return 'window.__debug.bandits is missing — no bandits were built';
    if (info.counts.camps < 3) return `only ${info.counts.camps} camps`;
    if (info.perCamp.some((n) => n < 3 || n > 5)) return `camp sizes ${JSON.stringify(info.perCamp)} — BUILD-PLAN.md asks for 3-5 per camp`;
    if (info.placeholders > 0) return `${info.placeholders} of ${info.counts.bandits} bandits fell back to the capsule placeholder`;
    return info.alive === info.counts.bandits ? null : `${info.alive} alive of ${info.counts.bandits} at boot`;
  }],

  ['every bandit is an independent skeleton clone, not eleven copies of one body', async () => {
    // THE regression guard for rig-clone.js. `Object3D.clone()` copies a
    // SkinnedMesh's `skeleton` BY REFERENCE, so without the rebind every bandit
    // would be driven by the same bones and the whole camp would move as one
    // body. Two things have to be true: separate Skeleton objects, and
    // separate Bone objects inside them.
    const info = await page.evaluate(() => {
      const list = window.__debug.bandits.bandits;
      const skinOf = (b) => {
        let found = null;
        b.character.root.traverse((n) => { if (!found && n.isSkinnedMesh) found = n; });
        return found;
      };
      // Self-skip on the procedural fallback, per docs/TESTING.md rule 3:
      // PlaceholderHuman is a Group of capsules with no skeleton to assert
      // against, and `--placeholder bandit.glb` is a supported run.
      if (list[0].character.isPlaceholder) return { placeholder: true };
      const a = skinOf(list[0]);
      const c = skinOf(list[1]);
      if (!a || !c) return { skinned: false };
      return {
        skinned: true,
        sameSkeleton: a.skeleton === c.skeleton,
        sameBone: a.skeleton.bones[0] === c.skeleton.bones[0],
        boneCount: a.skeleton.bones.length,
        sameGeometry: a.geometry === c.geometry, // SHARED on purpose — that is the memory win
        distinctRoots: list[0].character.root !== list[1].character.root,
      };
    });
    if (info.placeholder) return null;
    if (!info.skinned) return 'no SkinnedMesh found on a bandit rig — this rig cannot be animated per-bandit';
    if (info.sameSkeleton) return 'two bandits share one Skeleton object — every bandit will animate identically';
    if (info.sameBone) return 'two bandits share their bones — the skeleton was cloned but not rebound';
    if (!info.distinctRoots) return 'two bandits share one scene root';
    if (!info.sameGeometry) return 'bandit geometry is NOT shared — the clone is duplicating buffers it should reuse';
    return info.boneCount > 20 ? null : `only ${info.boneCount} bones on a bandit skeleton`;
  }],

  ['bandit camps sit on real ground, inside the boundary and clear of the town', async () => {
    // Placed by hand, so the thing worth checking is that the hand-written
    // numbers still agree with the terrain and with everyone else's limits.
    const info = await page.evaluate(async () => {
      const { CAMPS } = await import('/src/config-ai.js');
      const { heightAt, normalAt } = await import('/src/terrain.js');
      const { TOWN, BOUNDARY, PROPS } = await import('/src/config.js');
      return CAMPS.map((camp) => {
        let minH = Infinity; let maxH = -Infinity; let maxSlope = 0;
        for (let a = 0; a < 12; a++) {
          for (const r of [0, 7, 14]) {
            const x = camp.x + Math.cos((a / 12) * Math.PI * 2) * r;
            const z = camp.z + Math.sin((a / 12) * Math.PI * 2) * r;
            const h = heightAt(x, z);
            minH = Math.min(minH, h); maxH = Math.max(maxH, h);
            maxSlope = Math.max(maxSlope, 1 - normalAt(x, z).y);
          }
        }
        return {
          name: camp.name,
          spread: maxH - minH,
          slope: maxSlope,
          fromTown: Math.hypot(camp.x - TOWN.centerX, camp.z - TOWN.centerZ),
          limit: BOUNDARY.playerLimit,
          keepOut: PROPS.townKeepOut,
        };
      });
    });
    for (const c of info) {
      if (c.fromTown + 15 > c.limit) return `camp "${c.name}" is ${c.fromTown.toFixed(0)} out, past the ${c.limit} boundary clamp`;
      if (c.fromTown < c.keepOut) return `camp "${c.name}" is inside the town keep-out (${c.fromTown.toFixed(0)} < ${c.keepOut})`;
      if (c.spread > 8) return `camp "${c.name}" spans ${c.spread.toFixed(1)}m of height across its footprint — that is a hillside`;
      if (c.slope > 0.25) return `camp "${c.name}" sits on a ${c.slope.toFixed(2)} slope`;
    }
    console.log(`  (info) camps: ${info.map((c) => `${c.name} ${c.fromTown.toFixed(0)}m out, ${c.spread.toFixed(1)}m spread`).join('; ')}`);
    return null;
  }],

  ['the camp signal fire is a landmark, and its smoke column has no gaps', async () => {
    // The human's note after round 4 was "I didn't even know there was a
    // campfire here" — it was a 1.2m ring of pebbles. What replaced it only
    // works if it stays big, so this is a floor under the whole feature.
    //
    // The GAP half is a real regression guard, and the bug it guards was real:
    // per-puff phases were `Math.random()`, and thirty-odd independent uniform
    // samples on a line clump. It rendered two isolated blobs high in the sky
    // with nothing between them and the fire. Stratifying the phase — one puff
    // per equal slice, jittered inside its own slice — bounds the worst gap at
    // 1.7x the average spacing by construction; random bounds nothing.
    const info = await page.evaluate(async () => {
      const THREE = await import('three');
      const { CAMP_PROPS } = await import('/src/config-ai.js');
      const { colliders } = await import('/src/collision.js');
      const d = window.__debug;
      const fires = d.bandits.campfires;
      if (!fires) return null;
      const camp = d.bandits.camps[0];
      const groundY = fires.baseY[0];
      const m = new THREE.Matrix4();
      const v = new THREE.Vector3();

      const heights = [];
      for (let i = 0; i < fires.smoke.count; i++) {
        fires.smoke.getMatrixAt(i, m);
        v.setFromMatrixPosition(m);
        if (Math.hypot(v.x - camp.x, v.z - camp.z) > CAMP_PROPS.smokeDrift + CAMP_PROPS.smokeJitter + 5) continue;
        heights.push(v.y - groundY);
      }
      heights.sort((a, b) => a - b);
      let maxGap = 0;
      for (let i = 1; i < heights.length; i++) maxGap = Math.max(maxGap, heights[i] - heights[i - 1]);

      let flameTop = 0;
      for (let i = 0; i < fires.flames.count; i++) {
        fires.flames.getMatrixAt(i, m);
        v.setFromMatrixPosition(m);
        if (Math.hypot(v.x - camp.x, v.z - camp.z) > CAMP_PROPS.flameSpread + 2) continue;
        // The cone's own height times this instance's Y scale.
        flameTop = Math.max(flameTop, (v.y - groundY) + CAMP_PROPS.flameHeight * m.elements[5]);
      }

      const fire = colliders.find((c) => c.meta?.kind === 'campfire');
      return {
        puffs: heights.length,
        columnTop: heights[heights.length - 1],
        maxGap,
        avgGap: CAMP_PROPS.smokeRise / CAMP_PROPS.smokeCount,
        flameTop,
        colliderR: fire?.r ?? null,
        colliderTop: fire ? fire.top - groundY : null,
        finiteTop: fire ? Number.isFinite(fire.top) : false,
        smokeAnimates: fires.smoke.instanceMatrix.needsUpdate,
      };
    });
    if (!info) return 'no campfires were built';
    if (info.puffs < 20) return `only ${info.puffs} smoke puffs on the near camp — the column cannot be continuous`;
    if (info.columnTop < 60) return `the smoke column tops out ${info.columnTop.toFixed(0)}m above the camp — it will not clear the ridges between here and the plateau`;
    if (info.maxGap > info.avgGap * 1.9) {
      return `a ${info.maxGap.toFixed(1)}m hole in the smoke column (average spacing ${info.avgGap.toFixed(1)}m) — the puff phases are clumping, not stratified`;
    }
    if (info.flameTop < 4) return `the flame is only ${info.flameTop.toFixed(1)}m tall — that is a campfire, not a signal fire`;
    if (!(info.colliderR >= 2.5)) return `the fire's collider is ${info.colliderR} — you could walk through most of the bonfire`;
    if (!info.finiteTop) return 'the campfire collider has an infinite top — a shot should pass over a fire';
    if (info.colliderTop > 6) return `the campfire collider is ${info.colliderTop.toFixed(1)}m tall — that is the flame, not the pyre`;
    console.log(`  (info) signal fire: ${info.puffs} puffs to ${info.columnTop.toFixed(0)}m, worst gap ${info.maxGap.toFixed(1)}m, flame ${info.flameTop.toFixed(1)}m`);
    return null;
  }],

  ['a bandit carries its own revolver on its own hand bone, at life size', async () => {
    // weapons.js was written generically in round 3 against "any loaded
    // skeleton"; this is the first time anything but the player tested that
    // claim, and it is also the check that the armature's baked scale is being
    // divided back out on a CLONED rig rather than only on the original.
    const info = await page.evaluate(() => {
      const b = window.__debug.bandits.bandits[0];
      const w = b.character.weapon;
      if (!w) return { weapon: false };
      w.syncWorld();
      const s = new (b.position.constructor)();
      w.group.getWorldScale(s);
      return {
        weapon: true,
        attached: w.attachedToHand,
        boneName: w.handBone?.name ?? null,
        scale: s.x,
        muzzleUnderRig: w.muzzle.parent === w.group && b.character.root.getObjectByName(w.handBone?.name ?? '') === w.handBone,
      };
    });
    if (!info.weapon) return 'the bandit rig has no weapon at all';
    if (!info.attached) return `the revolver fell back to the rig root (hand bone was ${info.boneName})`;
    if (!info.muzzleUnderRig) return 'the muzzle empty is not under this bandit\'s own hand bone';
    if (!(info.scale > 0.5 && info.scale < 2)) return `the bandit's revolver has world scale ${info.scale} — the armature scale is not being divided out`;
    return null;
  }],

  ['Death and HitRecieve are wired as one-shots, and a dead rig stops taking gait orders', async () => {
    const info = await page.evaluate(async () => {
      const THREE = await import('three');
      const rig = window.__debug.bandits.bandits.find((b) => b.alive).character;
      if (rig.isPlaceholder) return { placeholder: true };
      const have = { death: !!rig.actions.death, hit: !!rig.actions.hit };
      const flinch = rig.playHit();
      const duringFlinch = rig._activeName;
      rig.setLocomotion('run', 5, false);
      const ignoredWhileFlinching = rig._activeName === duringFlinch;
      rig._oneShotT = 0;
      rig.setDead(true);
      const dead = {
        name: rig._activeName,
        loop: rig.actions.death?.loop === THREE.LoopOnce,
        clamp: rig.actions.death?.clampWhenFinished === true,
      };
      rig.setLocomotion('run', 5, false);
      const ignoredWhileDead = rig._activeName === 'death';
      rig.setDead(false);
      return { have, flinch, duringFlinch, ignoredWhileFlinching, dead, ignoredWhileDead, revived: rig._activeName };
    });
    if (info.placeholder) return null; // no skeleton and no clips to assert against
    if (!info.have.death || !info.have.hit) return `missing clips: ${JSON.stringify(info.have)} — HitRecieve is misspelled in the asset, check the candidate list`;
    if (info.duringFlinch !== 'hit') return `playHit() activated "${info.duringFlinch}", not the hit clip`;
    if (!(info.flinch > 0.05)) return `playHit() reported a ${info.flinch}s flinch — the caller uses that as its stagger`;
    if (!info.ignoredWhileFlinching) return 'setLocomotion overrode the flinch — the guard is not holding';
    if (info.dead.name !== 'death') return `setDead(true) activated "${info.dead.name}"`;
    if (!info.dead.loop || !info.dead.clamp) return 'the death clip is not LoopOnce+clampWhenFinished — the body will pop back up';
    if (!info.ignoredWhileDead) return 'setLocomotion overrode the death clip';
    if (info.revived === 'death') return 'setDead(false) left the death clip running — the player cannot respawn';
    return null;
  }],

  ['a shot over a bandit\'s head misses; one at its chest hits', async () => {
    // The `top: Infinity` trap. A bandit's MOVEMENT collider is an infinitely
    // tall cylinder by the collision contract (a character is not something to
    // be jumped over), so if the shot path went through the collider list a
    // round ten metres above one would "hit" it. Both halves matter: the miss
    // proves the collider is being ignored, the hit proves bandits.raycast()
    // put something exact back in its place.
    //
    // Staged on the town plateau looking inward: flat by construction and
    // prop-free by PROPS.townKeepOut, so nothing else can be on the ray. Run
    // from wherever the previous check left the player, this reported "barrel"
    // — measuring the scenery, not the feature (docs/TESTING.md rule 6).
    await page.evaluate(() => {
      const d = window.__debug;
      d.player.position.set(60, 0, 0);
      d.player.position.y = d.player.world.groundHeightAt(60, 0);
      d.tpCamera.yaw = Math.PI / 2; // looking toward -X, into the empty plateau
      d.tpCamera.pitch = 0;
      d.tpCamera.snap(d.player.position);
    });
    const settle = await page.evaluate(() => window.__frames);
    await page.waitForFunction((n) => window.__frames > n + 3, settle, { timeout: 30000 });
    const info = await page.evaluate(async () => {
      const { BANDIT } = await import('/src/config-ai.js');
      const { COMBAT } = await import('/src/config-combat.js');
      const d = window.__debug;
      const bandit = d.bandits.bandits.find((b) => b.alive);
      // Freeze the group so the terrain snap cannot move the body between
      // placing it and firing at it — the same recipe round 2c uses on
      // horse._updateMounted.
      const savedUpdate = d.bandits.update;
      d.bandits.update = () => {};
      const savedSpread = { hip: COMBAT.spreadHip, aim: COMBAT.spreadAim };
      COMBAT.spreadHip = 0;
      COMBAT.spreadAim = 0;
      const savedPos = bandit.position.clone();
      const savedHealth = bandit.health.current;

      const fireAt = (dropBy) => {
        // Read the camera's LIVE direction and move the BANDIT onto that ray —
        // never solve the camera onto a target (docs/TESTING.md).
        const eye = new (savedPos.constructor)();
        const dir = new (savedPos.constructor)();
        d.combat.camera.getWorldPosition(eye);
        d.combat.camera.getWorldDirection(dir);
        const at = eye.clone().addScaledVector(dir, 16);
        bandit.position.set(at.x, at.y - BANDIT.chestHeight - dropBy, at.z);
        bandit.character.root.position.copy(bandit.position);
        // The MOVEMENT COLLIDER has to come too, or the overhead half of this
        // check proves nothing: the infinitely tall cylinder it is supposed to
        // be ignoring would still be back at the camp, nowhere near the ray.
        // Confirmed — with this line missing the check passed even with the
        // ignore set reverted.
        if (bandit.collider) { bandit.collider.x = bandit.position.x; bandit.collider.z = bandit.position.z; }
        bandit.health.current = 99;
        d.combat.lastHit = null;
        d.combat._cooldown = 0;
        d.combat.ammo = COMBAT.magazine;
        d.combat.tryFire();
        d.combat.update(1 / 60);
        return d.combat.lastHit;
      };
      const chest = fireAt(0);
      // Now drop the whole body so the same ray passes two metres over its head.
      const overhead = fireAt(BANDIT.modelHeight + 2);

      bandit.position.copy(savedPos);
      bandit.character.root.position.copy(savedPos);
      if (bandit.collider) { bandit.collider.x = savedPos.x; bandit.collider.z = savedPos.z; }
      bandit.health.current = savedHealth;
      COMBAT.spreadHip = savedSpread.hip;
      COMBAT.spreadAim = savedSpread.aim;
      d.bandits.update = savedUpdate;
      return { chest, overhead };
    });
    if (info.chest?.kind !== 'bandit') return `a shot at the chest reported "${info.chest?.kind}" — bandits.raycast() is not in the shot path`;
    if (info.overhead?.kind === 'bandit') return 'a shot two metres over a bandit\'s head still hit it — the movement collider is not in combat\'s ignore set';
    return null;
  }],

  ['two rounds drop a bandit; the body stops colliding and the camp count falls', async () => {
    // BUILD-PLAN.md's feel target, and the collision contract's "removing a
    // collider is a real operation now", in one check.
    const info = await page.evaluate(async () => {
      const { colliders } = await import('/src/collision.js');
      const d = window.__debug;
      const camp = d.bandits.camps[0];
      const bandit = d.bandits.bandits.find((b) => b.alive && b.camp === camp);
      const before = { alive: camp.alive, colliders: colliders.length };
      const one = d.bandits.hit(bandit, bandit.position.x + 5, bandit.position.z);
      const midHealth = bandit.health.current;
      const two = d.bandits.hit(bandit, bandit.position.x + 5, bandit.position.z);
      const three = d.bandits.hit(bandit, bandit.position.x + 5, bandit.position.z);
      return {
        before, one, two, three, midHealth,
        alive: bandit.alive,
        state: bandit.ai.state,
        campAlive: camp.alive,
        colliders: colliders.length,
        colliderCleared: bandit.collider === null,
      };
    });
    if (info.one !== 'hit') return `the first round reported "${info.one}", not a hit`;
    if (info.midHealth !== 1) return `a bandit was on ${info.midHealth} hit points after one round — BUILD-PLAN.md asks for two body shots`;
    if (info.two !== 'dead') return `the second round reported "${info.two}" — a bandit is taking more than two rounds`;
    if (info.three !== null) return `a third round on a corpse reported "${info.three}" — death is firing twice`;
    if (info.alive) return 'the bandit is still alive after two rounds';
    if (info.state !== 'dead') return `the AI state is "${info.state}", not dead`;
    if (info.campAlive !== info.before.alive - 1) return `camp alive count went ${info.before.alive} -> ${info.campAlive}`;
    if (!info.colliderCleared || info.colliders !== info.before.colliders - 1) {
      return `the body still blocks the road (${info.before.colliders} -> ${info.colliders} colliders)`;
    }
    return null;
  }],

  ['a bandit sees the player, and stops seeing them behind a rock', async () => {
    const info = await page.evaluate(async () => {
      const { addCircleCollider, removeCollider } = await import('/src/collision.js');
      const d = window.__debug;
      const bandit = d.bandits.bandits.find((b) => b.alive);
      const savedUpdate = d.bandits.update;
      d.bandits.update = () => {};
      const savedPlayer = d.player.position.clone();
      const savedBandit = bandit.position.clone();
      // Set the stage rather than measuring the scenery (docs/TESTING.md rule
      // 6): both bodies onto the town plateau, which is flat by construction
      // and prop-free by PROPS.townKeepOut, twenty metres apart. Measured on
      // whatever ground the bandit happened to be standing on, this failed —
      // a real rise or a real cactus between them is not a bug in sight.
      bandit.position.set(40, 0, 20);
      bandit.position.y = d.player.world.groundHeightAt(40, 20);
      d.player.position.set(60, 0, 20);
      d.player.position.y = d.player.world.groundHeightAt(60, 20);
      bandit._losT = 0;
      const clear = bandit.hasLineOfSight(d.player);
      // A boulder tall enough to stand behind, exactly half way.
      const rock = addCircleCollider(50, 20, 2.5, { kind: 'rock' }, bandit.position.y + 4);
      bandit._losT = 0;
      const blocked = bandit.hasLineOfSight(d.player);
      removeCollider(rock);
      bandit._losT = 0;
      const clearAgain = bandit.hasLineOfSight(d.player);
      bandit.position.copy(savedBandit);
      if (bandit.collider) { bandit.collider.x = savedBandit.x; bandit.collider.z = savedBandit.z; }
      d.player.position.copy(savedPlayer);
      d.bandits.update = savedUpdate;
      return { clear, blocked, clearAgain };
    });
    if (!info.clear) return 'a bandit could not see a player standing 20m away in the open';
    if (info.blocked) return 'a bandit saw straight through a 4m boulder — line of sight is not testing the collider list';
    if (!info.clearAgain) return 'sight did not come back when the boulder was removed — the result is cached rather than recomputed';
    return null;
  }],

  ['gunfire wakes the whole camp, not just the men already facing you', async () => {
    // REGRESSION CHECK, confirmed to fail on the pre-fix code: measured at a
    // live camp, only the two bandits who happened to be looking the right way
    // ever joined the fight while the other two patrolled through it, because
    // nothing broadcast a bandit's own shot. Staged rather than observed — the
    // other men are parked past BANDIT.sightRange but inside
    // BANDIT.hearingRange, so a heard shot is the ONLY thing that can wake them.
    const info = await page.evaluate(async () => {
      const { BANDIT } = await import('/src/config-ai.js');
      const d = window.__debug;
      const camp = d.bandits.camps.find((c) => c.alive >= 3);
      const men = d.bandits.bandits.filter((b) => b.camp === camp && b.alive);
      const saved = men.map((m) => m.position.clone());
      const savedPlayer = d.player.position.clone();

      d.player.position.set(camp.x + 14, 0, camp.z);
      d.player.position.y = d.player.world.groundHeightAt(d.player.position.x, d.player.position.z);

      const mid = (BANDIT.sightRange + BANDIT.hearingRange) / 2; // blind to sight, inside earshot
      men.forEach((m, i) => {
        m.ai.alerted = false;
        m.ai.memory = 0;
        m.ai.alertTimer = 0;
        m.ai.state = 'patrol';
        m._losT = 0;
        if (i === 0) {
          // The one who can see: right in front of the player, facing them.
          m.position.set(d.player.position.x - 12, 0, d.player.position.z);
          m.position.y = d.player.world.groundHeightAt(m.position.x, m.position.z);
          m.yaw = Math.atan2(-(d.player.position.x - m.position.x), -(d.player.position.z - m.position.z));
          m._fireTimer = 0;
        } else {
          const a = (i / men.length) * Math.PI * 2;
          m.position.set(d.player.position.x + Math.cos(a) * mid, 0, d.player.position.z + Math.sin(a) * mid);
          m.position.y = d.player.world.groundHeightAt(m.position.x, m.position.z);
        }
        if (m.collider) { m.collider.x = m.position.x; m.collider.z = m.position.z; }
        m.ai.anchor.copy(m.position);
      });

      const startAmmo = men[0].ammo;
      let steps = 0;
      for (; steps < 900; steps++) {
        d.bandits.update(1 / 60, d.player);
        if (men[0].ammo < startAmmo) break;
      }
      const woken = men.slice(1).map((m) => m.ai.alerted);
      const distances = men.slice(1).map((m) => Math.hypot(m.position.x - d.player.position.x, m.position.z - d.player.position.z));

      men.forEach((m, i) => {
        m.position.copy(saved[i]);
        if (m.collider) { m.collider.x = m.position.x; m.collider.z = m.position.z; }
        m.ai.anchor.copy(m.position);
        m.ai.alerted = false;
        m.ai.memory = 0;
      });
      d.player.position.copy(savedPlayer);
      return { steps, fired: men[0].ammo < startAmmo, woken, distances, sight: BANDIT.sightRange, hearing: BANDIT.hearingRange };
    });
    if (!info.fired) return `the bandit in front of the player never fired in ${info.steps} steps — the check proved nothing`;
    if (info.distances.some((x) => x <= info.sight)) {
      return `a "deaf" bandit ended up ${Math.min(...info.distances).toFixed(0)}m away, inside sightRange ${info.sight} — it could have seen the player instead of hearing the shot`;
    }
    const asleep = info.woken.filter((w) => !w).length;
    return asleep === 0 ? null : `${asleep} of ${info.woken.length} men slept through a gunshot ${info.distances[0].toFixed(0)}m away (hearingRange ${info.hearing})`;
  }],

  ['a camp closes, shoots, and puts the player down in a few seconds in the open', async () => {
    // BUILD-PLAN.md: "bandits miss often enough that standing in the open is
    // survivable for a few seconds but stupid." Driven from inside at a fixed
    // step, because headless renders at ~3fps and dt is clamped — sixteen real
    // seconds is under three seconds of simulation (docs/TESTING.md).
    const info = await page.evaluate(async () => {
      const { HEALTH } = await import('/src/config-ai.js');
      const d = window.__debug;
      const camp = d.bandits.camps.find((c) => c.alive >= 3);
      const savedPlayer = d.player.position.clone();
      d.player.health.reset();
      d.player.dead = false;
      d.player.character.setDead(false);
      d.player.position.set(camp.x + 20, 0, camp.z + 20);
      d.player.position.y = d.player.world.groundHeightAt(d.player.position.x, d.player.position.z);
      for (const b of d.bandits.bandits) { b.ai.alerted = false; b.ai.memory = 0; b.ammo = 999; b._losT = 0; }

      const seen = new Set();
      let firstHit = -1;
      let killed = -1;
      const step = 1 / 60;
      for (let i = 0; i < 60 * 30 && killed < 0; i++) {
        d.bandits.update(step, d.player);
        for (const b of d.bandits.bandits) if (b.camp === camp) seen.add(b.ai.state);
        if (firstHit < 0 && d.player.health.current < HEALTH.playerMax) firstHit = i * step;
        if (d.player.dead) killed = i * step;
      }
      d.player.dead = false;
      d.player.health.reset();
      d.player.character.setDead(false);
      d.player.position.copy(savedPlayer);
      for (const b of d.bandits.bandits) { b.ammo = 6; b.ai.alerted = false; b.ai.memory = 0; }
      return { states: [...seen], firstHit, killed };
    });
    if (!info.states.includes('shoot')) return `the camp never reached the shoot state (saw: ${info.states.join(', ')})`;
    if (info.firstHit < 0) return 'thirty seconds of a camp firing and not one round landed';
    if (info.killed < 0) return 'the player survived thirty seconds standing in the open — bandits are not lethal enough';
    if (info.killed < 2) return `the player died in ${info.killed.toFixed(1)}s — "survivable for a few seconds" is not survivable`;
    console.log(`  (info) standing in the open at a camp: first hit ${info.firstHit.toFixed(1)}s, dead ${info.killed.toFixed(1)}s; states ${info.states.join(', ')}`);
    return info.killed <= 20 ? null : `it took ${info.killed.toFixed(1)}s to die in the open — that is a health sponge, not a western`;
  }],

  ['five hits drop the player, and respawn puts them back whole', async () => {
    const info = await page.evaluate(async () => {
      const { HEALTH } = await import('/src/config-ai.js');
      const d = window.__debug;
      const saved = d.player.position.clone();
      d.player.health.reset();
      d.player.dead = false;
      d.player.character.setDead(false);
      const outcomes = [];
      for (let i = 0; i < HEALTH.playerMax + 1; i++) outcomes.push(d.player.damage(HEALTH.banditDamage));
      const died = { dead: d.player.dead, hp: d.player.health.current, flash: d.player.damageFlash, canFire: d.combat.canFire, canReload: d.combat.canReload };
      d.player.respawn();
      const back = { dead: d.player.dead, hp: d.player.health.current, canFire: d.combat.canFire };
      d.player.position.copy(saved);
      return { outcomes, died, back, max: HEALTH.playerMax };
    });
    const expected = [...Array(info.max - 1).fill('hit'), 'dead', null];
    if (JSON.stringify(info.outcomes) !== JSON.stringify(expected)) {
      return `damage outcomes were ${JSON.stringify(info.outcomes)}, expected ${JSON.stringify(expected)}`;
    }
    if (!(info.died.flash > 0)) return 'no damage flash was raised on the killing hit';
    if (info.died.canFire || info.died.canReload) return 'a dead player can still fire or reload';
    if (info.back.dead || info.back.hp !== info.max) return `respawn left the player dead=${info.back.dead} on ${info.back.hp} hit points`;
    if (!info.back.canFire) return 'a respawned player cannot fire';
    return null;
  }],

  ['respawn picks the nearer of spawn and the last camp, and stands off from it', async () => {
    // BUILD-PLAN.md: "respawn at the config spawn point, or at the last bandit
    // camp you approached, whichever is nearer." Taken literally that drops the
    // player inside the camp that just killed them, so it is a stand-off ring —
    // and the check asserts BOTH halves, since a stand-off that is not near the
    // camp is just the spawn point with extra steps.
    const info = await page.evaluate(async () => {
      const { BANDIT } = await import('/src/config-ai.js');
      const { SPAWN } = await import('/src/config.js');
      const d = window.__debug;
      const camp = d.bandits.camps[0];
      const saved = d.player.position.clone();
      const savedCamp = d.player._lastCamp;

      // Never been near a camp: the spawn point, whatever else is true.
      d.player._lastCamp = null;
      d.player.position.set(camp.x, 0, camp.z);
      d.player.respawn();
      const noCamp = { x: d.player.position.x, z: d.player.position.z };

      // Approached the camp and died out there: the camp wins.
      d.player.position.set(camp.x + 5, 0, camp.z + 5);
      d.player.markCamp(camp);
      d.player.respawn();
      const atCamp = { x: d.player.position.x, z: d.player.position.z };

      // ...but died back at the spawn point: the spawn point wins again.
      d.player.position.set(SPAWN.x + 3, 0, SPAWN.z + 3);
      d.player.respawn();
      const nearSpawn = { x: d.player.position.x, z: d.player.position.z };

      d.player._lastCamp = savedCamp;
      d.player.position.copy(saved);
      return {
        noCamp, atCamp, nearSpawn,
        camp: { x: camp.x, z: camp.z },
        spawn: { x: SPAWN.x, z: SPAWN.z },
        standoff: BANDIT.respawnStandoff,
        approach: BANDIT.campApproachRadius,
      };
    });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    if (dist(info.noCamp, info.spawn) > 0.01) return 'with no camp visited, respawn did not use SPAWN';
    if (dist(info.nearSpawn, info.spawn) > 0.01) return 'dying at the spawn point respawned somewhere else';
    const out = dist(info.atCamp, info.camp);
    if (Math.abs(out - info.standoff) > 0.5) return `respawn landed ${out.toFixed(1)}m from the camp, expected the ${info.standoff}m stand-off`;
    if (out > info.approach) return `the stand-off (${out.toFixed(0)}m) is outside campApproachRadius (${info.approach}m) — respawning there un-arms the checkpoint`;
    return null;
  }],

  ['bandit colliders are registered once and mutate in place, never re-added', async () => {
    // The moving-collider half of the collision contract. The horse has had
    // this check since round 2; eleven more moving colliders is eleven more
    // chances to get it wrong.
    const info = await page.evaluate(async () => {
      const { colliders } = await import('/src/collision.js');
      const d = window.__debug;
      // FULLY staged, because two things silently make this check measure
      // nothing: bandits outside BANDIT.activeRadius are not ticked at all,
      // and a bandit already standing on the player's position has nowhere to
      // chase to. Both produced a "no collider moved" failure before the men
      // were put back at their camp and the player pushed out to 50m.
      const camp = d.bandits.camps.find((c) => c.alive >= 2);
      const savedPlayer = d.player.position.clone();
      const live = d.bandits.bandits.filter((b) => b.alive && b.camp === camp);
      const savedPos = live.map((b) => b.position.clone());
      live.forEach((b, i) => {
        const a = (i / live.length) * Math.PI * 2;
        b.position.set(camp.x + Math.cos(a) * camp.radius, 0, camp.z + Math.sin(a) * camp.radius);
        b.position.y = d.player.world.groundHeightAt(b.position.x, b.position.z);
        b.collider.x = b.position.x;
        b.collider.z = b.position.z;
        b.velocityXZ.set(0, 0, 0);
      });
      d.player.position.set(camp.x + 50, 0, camp.z);
      d.player.position.y = d.player.world.groundHeightAt(d.player.position.x, d.player.position.z);
      for (const b of live) b.ai.alert(d.player.position.x, d.player.position.z); // 50m to close: they must move
      const before = colliders.length;
      const refs = live.map((b) => b.collider);
      const startX = live.map((b) => b.collider.x);
      for (let i = 0; i < 240; i++) d.bandits.update(1 / 60, d.player);
      const out = {
        before,
        after: colliders.length,
        sameRefs: live.every((b, i) => b.collider === refs[i]),
        duplicates: refs.filter((c) => colliders.filter((x) => x === c).length !== 1).length,
        tracking: live.every((b) => Math.abs(b.collider.x - b.position.x) < 1e-6 && Math.abs(b.collider.z - b.position.z) < 1e-6),
        moved: live.some((b, i) => Math.abs(b.collider.x - startX[i]) > 0.01),
      };
      live.forEach((b, i) => {
        b.ai.alerted = false;
        b.ai.memory = 0;
        b.position.copy(savedPos[i]);
        if (b.collider) { b.collider.x = b.position.x; b.collider.z = b.position.z; }
        b.ai.anchor.copy(b.position);
      });
      d.player.position.copy(savedPlayer);
      return out;
    });
    if (info.after !== info.before) return `the collider list went ${info.before} -> ${info.after} over four seconds — something is re-adding`;
    if (!info.sameRefs) return 'a bandit swapped its collider object mid-run';
    if (info.duplicates) return `${info.duplicates} bandit colliders appear more or less than once in the array`;
    if (!info.tracking) return 'a bandit collider is not following its body';
    if (!info.moved) return 'no bandit collider moved at all in four seconds — the check proved nothing';
    return null;
  }],

  ['draw calls stay inside budget with a whole camp on screen', async () => {
    // Round 4 is the first round that adds a lot of skinned geometry, and it
    // nearly blew the budget: four bandits, the player and the horse in frame
    // measured 126 calls before the revolver's seven parts were merged into one
    // mesh per material (weapons.js). The existing budget check samples at
    // spawn, where no bandit is visible, so it would never have noticed.
    const camp = await page.evaluate(() => {
      const d = window.__debug;
      const c = d.bandits.camps[0];
      d.player.position.set(c.x + 18, 0, c.z + 18);
      d.player.position.y = d.player.world.groundHeightAt(d.player.position.x, d.player.position.z);
      d.tpCamera.yaw = Math.atan2(-(c.x - d.player.position.x), -(c.z - d.player.position.z));
      d.tpCamera.pitch = 0.12;
      d.horse.position.set(d.player.position.x + 3, d.player.position.y, d.player.position.z);
      return c.name;
    });
    const start = await page.evaluate(() => window.__frames);
    await page.waitForFunction((n) => window.__frames > n + 6, start, { timeout: 30000 });
    const info = await page.evaluate(() => ({
      calls: window.__debug.drawCalls,
      triangles: window.__debug.renderer.info.render.triangles,
      alive: window.__debug.banditsAlive,
    }));
    if (typeof info.calls !== 'number') return 'window.__debug.drawCalls is missing';
    console.log(`  (info) at ${camp}: ${info.calls} draw calls, ${info.triangles.toLocaleString()} triangles, ${info.alive} bandits alive`);
    return info.calls <= 120 ? null : `${info.calls} draw calls with a camp on screen, budget is ~120`;
  }],

  ['dead bandits stop being animated, then are taken away', async () => {
    // Both halves of the leak this closes: a corpse went on being posed every
    // frame forever (a whole skeleton's cost for a clip that had already
    // clamped), and went on costing its draw calls. The timings are shortened
    // here rather than faked — the same code path runs, just on a fast clock,
    // because BANDIT.corpseLinger is 25s and headless renders at ~3fps.
    const setup = await page.evaluate(async () => {
      const { BANDIT } = await import('/src/config-ai.js');
      const d = window.__debug;
      const saved = { linger: BANDIT.corpseLinger, sink: BANDIT.corpseSinkTime, max: BANDIT.maxCorpses };
      // Phase one: nothing is crowded out, so every body lingers and can be
      // sampled. The cap is exercised in phase two below.
      BANDIT.corpseLinger = 30;
      BANDIT.corpseSinkTime = 0.2;
      BANDIT.maxCorpses = 99;
      window.__corpseSaved = saved;
      // Kill a whole camp's worth, more than the cap, so the crowding path runs.
      const victims = d.bandits.bandits.filter((b) => b.alive).slice(0, 5);
      for (const b of victims) b.damage(999, b.position.x + 1, b.position.z);
      return { killed: victims.length, cap: BANDIT.maxCorpses };
    });
    if (setup.killed < 3) return `expected live bandits to kill, found ${setup.killed}`;

    // Let the death clips clamp, then sample a bone twice: past the clip the
    // pose must not change again, which is the "stopped being animated" claim.
    // Wait on the clip actually finishing, not on a frame count: headless runs
    // at ~3fps and RENDER.maxDeltaTime caps how much sim time a slow frame
    // contributes, so N frames is not N/60 seconds of game time.
    await page.waitForFunction(
      () => window.__debug.bandits.bandits.some((b) => !b.alive && b.corpseT > b.deathClipT),
      null, { timeout: 60000 },
    );
    const poseA = await page.evaluate(() => {
      const b = window.__debug.bandits.bandits.find((x) => !x.alive && !x.retired && x.corpseT > x.deathClipT);
      const bone = b?.character.root.getObjectByName('Chest');
      return bone ? { q: bone.quaternion.toArray(), t: b.corpseT, clip: b.deathClipT } : null;
    });
    // The pose-drift half needs a real skeleton; capsule placeholders have no
    // Chest bone. The retirement half below works for either and still runs.
    const banditPlaceholder = await page.evaluate(() => !!window.__debug.bandits.bandits[0]?.character.isPlaceholder);
    if (!poseA && banditPlaceholder) console.log('  (info) bandits are capsule placeholders — skipping the pose-drift half');
    else if (!poseA) return 'no dead bandit found to sample';
    if (poseA && !(poseA.t > poseA.clip)) return `death clip has not finished yet (t=${poseA.t?.toFixed(2)} of ${poseA.clip?.toFixed(2)})`;
    await page.waitForFunction((n) => window.__frames > n, await page.evaluate(() => window.__frames + 6), { timeout: 30000 });
    const poseB = await page.evaluate(() => {
      const b = window.__debug.bandits.bandits.find((x) => !x.alive && x.corpseT > x.deathClipT);
      const bone = b?.character.root.getObjectByName('Chest');
      return bone ? bone.quaternion.toArray() : null;
    });
    if (poseA && poseB) {
      const drift = Math.max(...poseA.q.map((v, i) => Math.abs(v - poseB[i])));
      if (drift > 0.001) return `a finished corpse is still being posed (bone moved ${drift.toFixed(4)} after the clip clamped)`;
    }

    // Phase two: squeeze the cap and drop the linger, and the bodies go.
    await page.evaluate(async () => {
      const { BANDIT } = await import('/src/config-ai.js');
      BANDIT.corpseLinger = 0.1;
      BANDIT.maxCorpses = 2;
    });
    let visible = 99;
    try {
      await page.waitForFunction((cap) => {
        const dead = window.__debug.bandits.bandits.filter((b) => !b.alive);
        return dead.filter((b) => b.character.root.visible).length <= cap;
      }, setup.cap, { timeout: 30000 });
      visible = await page.evaluate(() => window.__debug.bandits.bandits.filter((b) => !b.alive && b.character.root.visible).length);
    } catch {
      visible = await page.evaluate(() => window.__debug.bandits.bandits.filter((b) => !b.alive && b.character.root.visible).length);
      return `${visible} corpses still visible, cap is ${setup.cap} — bodies are piling up`;
    }
    const retired = await page.evaluate(() => window.__debug.bandits.bandits.filter((b) => b.retired).length);
    await page.evaluate(async () => {
      const { BANDIT } = await import('/src/config-ai.js');
      const s = window.__corpseSaved;
      BANDIT.corpseLinger = s.linger; BANDIT.corpseSinkTime = s.sink; BANDIT.maxCorpses = s.max;
    });
    return retired > 0 ? null : 'no corpse was ever retired';
  }],


  ['shot spread is a real cone, and riding widens it', async () => {
    // The accuracy penalty BUILD-PLAN.md requires for mounted fire, read off
    // the same getter the shot uses. Also pins the ordering that makes aiming
    // worth doing at all.
    const info = await page.evaluate(async () => {
      const d = window.__debug;
      const c = d.combat;
      const h = d.horse;
      const p = d.player;
      const wasMounted = p.mounted;
      if (wasMounted) h.handleMountToggle(p);
      c.setAimOverride(false);
      c.aiming = false;
      const hip = c.currentSpread;
      c.aiming = true;
      const aimed = c.currentSpread;

      p.position.set(h.position.x + 1, h.position.y, h.position.z);
      h.handleMountToggle(p);
      const mountedAimed = c.currentSpread;
      c.aiming = false;
      const mountedHip = c.currentSpread;
      if (p.mounted) h.handleMountToggle(p);
      c.setAimOverride(null);
      return { hip, aimed, mountedAimed, mountedHip };
    });
    if (!(info.aimed > 0)) return 'aimed spread is zero — a shot with no cone at all is not a spread';
    if (!(info.hip > info.aimed)) return `hip spread ${info.hip} is not wider than aimed spread ${info.aimed}`;
    if (!(info.mountedAimed > info.aimed)) {
      return `aiming from the saddle (${info.mountedAimed}) is no less accurate than aiming on foot (${info.aimed})`;
    }
    if (!(info.mountedHip > info.hip)) {
      return `hip fire from the saddle (${info.mountedHip}) is no less accurate than on foot (${info.hip})`;
    }
    return null;
  }],
];

let ran = 0;
for (const [label, fn] of CHECKS) {
  // Skipped rather than failed: with a model withheld, the checks whose whole
  // purpose is asserting that model loaded are not telling us anything.
  if (PLACEHOLDER && label.includes(PLACEHOLDER)) {
    console.log(`  skip  ${label} (--placeholder ${PLACEHOLDER})`);
    continue;
  }
  if (ONLY && !label.toLowerCase().includes(ONLY.toLowerCase())) continue;
  ran++;
  const fail = await fn().catch((e) => `threw: ${e.message}`);
  console.log(`  ${fail ? 'FAIL' : 'ok  '}  ${label}${fail ? ` — ${fail}` : ''}`);
  if (fail) problems.push(`check "${label}": ${fail}`);
}
if (ONLY && ran === 0) problems.push(`--only "${ONLY}" matched none of the ${CHECKS.length} checks (try --list)`);

const frames = await page.evaluate(() => window.__frames);
console.log(`smoke: ${frames} frames rendered`);

await browser.close();
server.close();

// Under --placeholder the missing asset is the whole point of the run, so its
// 404 and the console.error chromium logs for it are expected, not failures.
//
// The HTTP entry is matched on the withheld path, so a 404 for anything else
// still fails. The console.error is NOT that precise — chromium's
// "Failed to load resource" text does not carry the URL — so in this mode a
// resource error for some *other* file would also be forgiven. Acceptable
// because --placeholder is a deliberate diagnostic, never CI: the unflagged
// run is the one that has to catch everything, and it still does.
const expected = PLACEHOLDER
  ? (p) => p.includes(PLACEHOLDER) || p.includes('Failed to load resource')
  : () => false;
const forgiven = problems.filter(expected);
const real = problems.filter((p) => !expected(p));
if (forgiven.length) {
  console.log(`  (expected) ${forgiven.length} problem(s) from withholding ${PLACEHOLDER}`);
}

if (real.length) {
  console.error(`\nsmoke FAILED (${real.length}):`);
  for (const p of real) console.error('  - ' + p);
  process.exit(1);
}
console.log('\nsmoke PASSED');
