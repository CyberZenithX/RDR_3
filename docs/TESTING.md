# TESTING.md — what gets verified, how, and what can't be

Two halves, and they must not be confused:

- **`scripts/smoke.mjs`** — everything machine-checkable. Run it before
  declaring any round done. Extend it every round.
- **`SMOKE-TEST.md`** — everything only a human with eyes can judge. Grow it
  every round, never delete a line.

> **A fabricated pass is worse than no check at all.** You cannot see the game.
> You cannot tell whether the horse feels good to ride. Do not claim you tested
> something you didn't — say plainly which items are the human's to verify.

---

## Running it

```bash
node scripts/smoke.mjs
```

Serves the repo folder on **port 8917** via `node:http`, loads it in chromium,
and **fails the run on any** of:

- a console error
- an uncaught exception
- a 4xx or failed network request
- a render loop that never started

then runs the `CHECKS` array against `window.__debug`.

**Headless is slow, and that's the environment, not the game.** ~3fps in
chromium's software rasterizer with the full 2048 `PCFSoftShadowMap`. The
shadow map was **not** reduced — 2048 soft shadows is a completely normal
budget on a real GPU (BUILD-PLAN.md's own "2048 max"). The frame-target
timeout was raised to 45s instead. One `CONTEXT_LOST_WEBGL` warning has been
seen under sustained headless load; it didn't recur and doesn't fail the run
(it's a `warning`-type message, and headless GL driver noise was already
established as ignorable in round 0 with "GPU stall due to ReadPixels").

### Chromium discovery

`launchChromium()` falls back through: Playwright's own browser build →
`PLAYWRIGHT_BROWSERS_PATH` → any `/usr/bin/chromium*` on disk → whatever
`SMOKE_CHROMIUM=/path/to/chrome` names. Sandboxes often ship a pre-installed
chromium whose build number doesn't match `node_modules`.

---

## Three harness gotchas that produce measurements you cannot trust

### 1. `page.waitForFunction()` with an `async` predicate resolves on its first poll

In this Playwright version, a predicate that does `await import(...)` inside
resolves immediately **regardless of its real return value**. Confirmed
directly: a mount-lerp-completion check "resolved" after one poll while the
real condition was still false, and a follow-up read showed the unfinished
value. The check reported a false pass with the saddle lerp ~25% complete.

**Fix**: fetch anything needing a dynamic `import()` in a separate, plain
`await page.evaluate()` first, then pass the result *in* as a
`waitForFunction` argument, so the polled predicate itself is synchronous.

### 2. Sample fast motion from **inside** the render loop, not by polling

Headless renders at ~3fps, so a 0.89s jump is roughly 17 frames — an outside
poll from node misses the apex entirely. The round-2d jump checks wrap the
per-frame update and sample from within it (see the next gotcha for *which*
update). Anything transient (an arc, a crossfade, a one-shot clip) needs the
same treatment.

### 3. Sampling both rigs from one wrapper reads one of them a frame stale

`main.js` runs `horse.update()` → `player.setSaddle()` → `player.update()`, so
anything measured from inside a wrapper on **`horse.update`** compares *this*
frame's horse against *last* frame's rider. On a real GPU that is 16ms and
invisible; at headless's ~3fps it is a full 0.05s step, and the jump clip moves
the horse's spine ~0.5 of body-frame height in that time. Measured, it put the
rider's hips 0.36 away from a seat they are in fact welded to — a difference
large enough to have masked a real bug or invented a fake one.

**Fix**: take cross-rig snapshots from a wrapper on **`player.update`**, after
both rigs are posed for the frame. The round-2d jump checks do horse-only
bookkeeping (peak lift, clearance) in the horse wrapper and every body-frame
snapshot in the player one.

Related: **`Body` is too noisy to measure small displacements against** —
see [ANIMATION.md](ANIMATION.md#body-is-unusable-as-a-reference-for-small-vertical-measurements).
Pick a bone no clip translates, or measure a large angle instead.

---

## Rules for adding checks

1. **Extend `CHECKS` every round.** This is not optional; BUILD-PLAN.md
   requires it.
2. **Verify the check actually fails on the pre-fix code.** A check that
   passes on both the broken and the fixed version is worse than nothing.
   Round 2c's seat check was confirmed to fail with "the seat sits 0.44 off
   the horse's spine" when `horse.js`/`player.js` were reverted.
3. **Skip skeleton checks when a placeholder rig is in play** — the round-2b,
   2c and 2d pose checks self-skip, because `PlaceholderHorse`/
   `PlaceholderHuman` have no skeleton to assert against.
4. **Drive gameplay through the sanctioned public entry points**
   (`horse.handleMountToggle(player)`, `horse.handleJump()`,
   `horse.jump.request()`), not by simulating pointer-locked input, which
   headless cannot produce as a trusted gesture. Add new ones as *public*
   methods rather than poking underscore-prefixed internals from a test.
   The mount recipe: teleport `player.position` to within `HORSE.mountRange`,
   call `handleMountToggle`, then poll — with a **synchronous** predicate —
   until `horse._mountBlendT` reaches `HORSE.mountLerpTime`.
5. **Measure in the body frame** for anything positional on the horse — see
   [HORSE.md](HORSE.md).

---

## What `CHECKS` currently covers

**Round 1 — world and player**

- `player.glb` loaded (not the placeholder)
- player Y settles (doesn't fall forever) and is grounded
- all three prop kinds scattered, count > 0
- character scale within `[0.3, 3]` and mesh-yaw-offset sane *(this exists
  because the player once rendered at 5cm —
  see [DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md#the-player-was-rendering-at-5cm-tall))*
- rock `colliderFactors` all ≥ 1.2 *(a cheap regression floor against
  "someone changed this back to a single undersized number")*
- no leftover jump-clip action

**Round 2 — the horse**

- `horse.glb` loaded (not the placeholder); model scale sane (not the raw
  4.8m bind-pose box)
- horse Y settles; horse stays inside the boundary
- mount attaches the player to the saddle within tolerance
- the mounted camera doesn't collapse onto the horse's own collider
- dismount lands the player on the ground
- the horse's collider is registered **exactly once**, even across a
  mount/dismount cycle
- stamina stays in `[0, staminaMax]`, and the **stamina bar's rendered width**
  is a 0..1 fraction of its track. Passing the raw value renders the bar at
  150% — confirmed to fail that way before the fix, when `staminaMax` was 1.5.
  The tank is back to 1, where raw and fraction are the same number, so the
  check now resizes and fills the tank itself for one frame and restores it
  afterwards; without that it would silently pass on the buggy path.

**Round 2b — the seated pose**

- the rider is posed seated, not standing: knee forward of the hip, shin
  hanging, both knees outside the horse's measured barrel half-width, knees
  roughly mirrored, spine leaning forward not back, hands out on the reins,
  finger-grip axes derivable
- the pose is **idempotent across frames** (guards the compounding-delta bug)
- dismounting releases it, including the bones no clip reclaims
- the reins actually span from the horse's muzzle to the rider's fist — both
  ends checked against live bones, reading the shared strand buffer directly

**Round 2c — the rider stays seated through a turn**

Forces a steady turn by swapping out `horse._updateMounted` (same reason the
mount check calls `handleMountToggle` directly), waits for `|lean| > 0.15`,
then measures the rider **in the horse's own banked body frame** — undo
`horseRig.matrixWorld`, divide out its scale — where a correctly seated rider
reads the same as they do standing still:

- saddle point within **0.05** of the horse's spine
- hips within **0.10** of it
- both boots still straddling the barrel
- the two boots within **0.15** of each other in height

**Round 2d — the jump**

- `Gallop_Jump` is wired as a real one-shot and `setAirborne` is present
- every scattered prop records a finite, plausible `top`, with cacti and trees
  provably *above* the horse's reach and 50–98% of rocks below it
- the clearance rule itself, exercised directly on a synthetic collider at
  three different agent undersides
- a whole jump end to end: peak lift against the configured apex, the
  clearance the **real** `update()` handed `resolveCollisions` at the apex,
  `-Infinity` while grounded, a clean landing back on the terrain, the
  two-point seat released
- the rider measured in the horse's body frame **mid-flight**: hips on the
  spine, boots straddling and level, hips not left fore/aft of where they sit
  on the ground, and the torso genuinely *folded* into the two-point seat
  (head-forward-of-hips vs. the same reading on the ground)
- the rider measured again **at the apex**, this time against the horse's own
  saddle bone rather than a nominal height, in both axes. This is the check
  that catches the rider being swallowed by the horse
  ([HORSE.md](HORSE.md#the-rider-was-swallowed-by-the-horse-at-the-apex)):
  the mid-flight snapshot above is taken as soon as the two-point seat blends
  in, a quarter of the way up, and saw nothing. Confirmed to fail on the
  pre-fix code from *either* cause alone — "sits 0.38 lower on the horse's
  spine" with the follow/clamp reverted, "0.38 fore/aft" with the seat's pitch
  reverted.

The last three sample the arc from **inside** the render loop.

**Round 3 — guns**

- all three `.ogg` files actually loaded. `audio.js` never throws on a missing
  file (BUILD-PLAN.md's rule), so *asking what it failed to load* is the only
  way a silent gunfight gets noticed
- the revolver hangs off `WristR` — the dot-stripped runtime name — and its
  world scale is life-sized, which is the check that the armature's baked scale
  is being divided back out rather than inherited
- the muzzle empty is **not** under the camera, and turning the character
  moves it. The second half matters: a muzzle welded to the world would pass a
  pure ancestry test while aiming every shot from a fixed point in space
- aiming narrows the FOV and pulls the camera in, read off the camera's own
  live values so the easing path is covered too
- barrel colliders carry a real, finite `top` (so the horse can still jump
  one) and a `meta.target` back-reference
- **a fired shot hits a target directly in front**, end to end through the
  real `tryFire()` → muzzle → `combat-ray` path
- ammo decrements per shot, the cylinder does not refill until the lockout
  *ends*, the gun refuses to fire mid-reload, and an empty gun does not go
  negative
- a bottle breaks in one hit and a barrel in two; a destroyed target is
  unregistered from the collider list **and** its instance matrix is zeroed
- the reload gate reads the **gait**, not stamina — asserted in both
  directions: refused at a gallop with a full tank, allowed at a walk with an
  exhausted one. That second half is the one with teeth
- aiming raises the gun hand in the horse's body frame **without** moving the
  knees, which is the partial-skeleton split (ADR-024) measured rather than
  assumed
- the aim pose is idempotent across frames, the same compounding-delta guard
  the riding pose carries
- spread is a real cone and rides in the right order: aimed < hip, and each
  gets worse in the saddle

Two recipes worth reusing:

- **Forcing the aim state.** Headless cannot produce a trusted pointer-locked
  mouse button, so `combat.setAimOverride(true|false|null)` is a public entry
  point in the same spirit as `horse.handleMountToggle` (rule 4 below).
- **Aiming a shot at something.** Do **not** solve the camera onto the target.
  The camera looks at its own pivot plus `CAMERA.shoulderOffset`, so a yaw/pitch
  derived analytically from a target position misses by more than a barrel's
  width at 14m. Instead read the camera's LIVE `getWorldDirection()` and move
  the target onto that ray. Zero `COMBAT.spreadHip`/`spreadAim` for the
  duration (restore after) so the check tests the aiming chain, not the dice.
- **Cooldowns bite the next check, not this one.** A shot leaves
  `COMBAT.fireInterval` behind it; the ammo check timed out once because it
  fired immediately after the hit check. Wait on `combat.canFire` first.

---

## Screenshots without the Browser pane

The Browser-preview MCP pane's `computer{action:"screenshot"}` fails in this
environment with "the Browser pane is not displayed, so the page is not
compositing frames".

**A plain Playwright script works fine.** Same pattern as `smoke.mjs`: launch
chromium headless, serve the folder over `node:http`, `page.goto`, wait for
`window.__ready`, then `page.screenshot({path})` — and open the PNG with the
Read tool. This is how the sun-shader, mesh-facing, rock-shape and
mounted-camera bugs were actually *seen* rather than reasoned about.

Write these as throwaway scripts (`scripts/_shot-something.mjs`) and **delete
them when done** — don't leave one-off screenshot scripts committed.

### Framing a shot

`window.__debug` exposes live object references, not snapshots:

- `tpCamera` — set `.yaw` / `.pitch` / `.currentDistance` directly, bypassing
  mouse-look. **`.snap(pos)` recalculates `.currentDistance` itself** via
  occlusion checks and will clobber a value you just set — set position fields;
  don't rely on `snap()` preserving a chosen distance.
- `player` — `.position` is a live `Vector3`; teleport by mutating in place.
- `scene` — traverse to find world positions (e.g. an `InstancedMesh`'s
  per-instance matrix via `getMatrixAt(i, m)`) when you need to frame
  something specific rather than whatever's near spawn.

**The camera direction math, written down because it was derived backwards
twice:** the camera's *position offset from the pivot* is
`dirX = sin(yaw)·cos(pitch)`, `dirY = sin(pitch)`, `dirZ = cos(yaw)·cos(pitch)`,
and the camera **views in the opposite direction**, `-(dirX, dirY, dirZ)`. To
aim at a target:

```js
viewDir = normalize(target - eye)
pitch   = asin(-viewDir.y)
yaw     = atan2(-viewDir.x, -viewDir.z)
```

---

## Verifying the placeholder path

Both placeholder rigs are real fallbacks, and both have been verified end to
end by **temporarily renaming the GLB away** and running `node
scripts/smoke.mjs`:

- `player.glb` renamed (round 1): game stayed fully playable, absence surfaced
  as one console warning, not a crash.
- `player.glb` renamed (round 3): **it did not.** The game showed "failed to
  start", rendered zero frames, and failed sixteen checks — because
  `main.js` parented the muzzle flash to `character.weapon.muzzle` and the
  placeholder rig had no weapon. `init()` threw and everything after it never
  ran. Fixed by arming the placeholder and guarding the attach; written up in
  [DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md). **This procedure is the only
  thing that catches that class of bug, and it very nearly got skipped.**
  Re-run after the fix: 16 failures down to **3**, and all three are the ones
  inherent to deleting the file — the 404, its console error, and the check
  whose whole purpose is asserting the real GLB loaded. Every round-3 check
  passed against the capsule rig, guns included.
- `horse.glb` renamed (rounds 2 and 2d): mount, ride, bank, jump, clearance,
  rider-in-the-saddle and dismount all passed against `PlaceholderHorse`. The
  only failures were the four inherent to deleting the file — the 404 itself
  and the checks whose whole purpose is asserting the real GLB loaded.

Do this again whenever a round changes the character interface
(`setLocomotion` / `setAirborne` / `setRidingPose` / `setAimPose` /
`hipHeight`), because the placeholders implement that interface independently.
**Round 3 changed it**: `setLocomotion` grew an `aiming` argument,
`setAimPose` is new, and `PlaceholderHuman` now carries `WristR`/`WristL`
empties purely so `weapons.js`'s generic bone search finds a hand on it too.
The round-3 skeleton checks self-skip on the placeholder rig, as the round-2b/
2c/2d ones do.

---

## Things that are not smoke-testable, and how they were verified instead

- **Geometry/topology defects** (the shattered rocks) — reproduced in
  standalone scripts with the exact seed and params of the real config, fixed
  in isolation, then applied to the real file. Those scripts *were* the
  regression tests and were thrown away, not committed. A scalar debug field
  can't catch a shape bug.
- **Collision tuning** — a script that calls `resolveCollisions` in a loop
  exactly like `player.js`'s real per-frame flow, walking a simulated player
  toward a real placed rock instance, asserting it stops at
  `colliderRadius + playerRadius`.
- **Module-level logic with no debug field** (grass keep-out) — a direct
  module test against a fake scene.
- **Feel** — nothing. It goes in `SMOKE-TEST.md` and gets said out loud at the
  end of the round.
