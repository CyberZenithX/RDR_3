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
    // pointer-locked keyboard input, per CLAUDE.md's round 2 plan.
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

  ['no leftover jump clip on the real player rig (removed feature)', async () => {
    // Regression guard for the opposite direction now: the retargeted jump
    // clip (retarget.js + config.js's ANIM_SOURCE/HIP_FOLLOW/KNEE_FOLLOW)
    // was built, tuned repeatedly, and ultimately pulled out because it
    // never read as right in real play — see CLAUDE.md's "Known rough
    // edges". character.js should never construct a "jump" action anymore;
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
