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
      const props = colliders.filter((c) => c.meta?.kind && c.meta.kind !== 'horse');
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
