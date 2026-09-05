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

**Headless is slow, and that's the environment, not the game.** ~2.7fps in
chromium's software rasterizer with the full 2048 `PCFSoftShadowMap` — it was
~3fps before round 5's town added three `PointLight`s, which every standard
material in the scene then evaluates per fragment. The shadow map was **not**
reduced — 2048 soft shadows is a completely normal budget on a real GPU
(BUILD-PLAN.md's own "2048 max"). The frame-target timeout was raised instead:
45s in round 2, and **60s** in round 5 after one run missed it on a loaded
machine (sixty frames at 2.7fps is 22s; the headroom is the point). One `CONTEXT_LOST_WEBGL` warning has been
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

### 3b. A check that measures the scenery is not measuring your feature

The aim-camera check compares the camera's distance with and without the gun
up. It passed for several runs, then failed reading **1.30 -> 1.30** — both
clamped to `CAMERA.minDistance` — because the horse had wandered up beside the
player and the on-foot camera does not ignore its collider. Nothing about
aiming had changed; a slower check earlier in the list had given the horse a
few more seconds to walk over.

Camera distance is the *output* of an occlusion sweep, so a check that reads it
wherever the previous checks happened to leave the player is sampling the
world, not the feature. Two fixes, both worth copying:

- **Set the stage explicitly.** Teleport the player to open ground and push the
  horse away before measuring, the way the shot check moves its target.
- **Assert you measured something.** If the "before" reading is already at
  `minDistance`, fail with *that*, rather than letting a clamped comparison
  decide the result.

### 2b. Headless does not just render slowly — it *simulates* slowly

`main.js` clamps `dt` to `RENDER.maxDeltaTime` (0.05). At headless's ~3fps that
is **0.15 seconds of simulation per real second**: sixteen seconds of
`page.waitForTimeout` buys under two and a half seconds of game. Round 4 found
this the hard way — a camp watched for sixteen real seconds had fired one round
each and the AI looked broken when it was merely slow.

**Fix**: for anything that has to run for a while, drive the system directly at
a fixed step from inside one `page.evaluate` —
`for (let i = 0; i < 1800; i++) bandits.update(1/60, player)`. It is
deterministic, it is fast, and it is exactly the loop `main.js` runs. Reserve
the render loop for things that must actually be *rendered* (draw calls,
camera framing, anything reading `__frames`).

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
1b. **"The asset loaded" is not "the asset is correct."** Round 0 learned this
   for models and wrote `verify-models.mjs` (a GLB under 10KB, or with
   `skins: 0`, is a failed download). Round 3 gave audio a loader and no
   verifier, and shipped a gunshot that was three gunshots. Any binary asset a
   round adds needs a check on its **content**, not just its presence.
2. **Verify a REGRESSION check fails on the pre-fix code** — and only a
   regression check. A check guarding a bug that actually happened is worth
   nothing until you have seen it go red; round 2c's seat check was confirmed
   with "the seat sits 0.44 off the horse's spine", and round 3's audio check
   with "contains 3 separate hits (at 0s, 0.69s, 1.4s)". Those failure strings
   are also the best description of the bug you will ever write.

   **Do not do this for a check that cannot trivially pass** — a draw-call
   budget, a file loading, a collider being registered once. Inverting those
   costs a run and proves something you already know. This used to read as a
   blanket rule and that was the expensive part of it.

   Use `--only` (below). Confirming one check is **~30s**, not the ~2 minutes
   the full suite takes.
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
6. **A check stages the state it depends on.** Round 3's aim-camera check
   relied on wherever the previous checks left the player, and started failing
   when an unrelated check earlier in the list got slower and gave the horse
   time to wander into shot — it was sampling the scenery, not the feature.
   Position the player, push the horse away, set the camera, *then* measure.
   Re-mounting when you need a mounted rider is fine and cheap; inheriting a
   mount you did not ask for is not. This is also what makes `--only`
   trustworthy, which is what keeps rule 2 cheap.

   **Round 4 paid this three times in one sitting**, and the failures are worth
   knowing because none of them looked like staging problems:
   a line-of-sight check failed on a real cactus between two bodies; a
   shoot-the-bandit check reported `"barrel"` because the previous check had
   left the player near the test range; and a collider-movement check reported
   "nothing moved" because the men were already standing on the player and had
   nowhere to chase to — and again, in the `--placeholder` run only, because
   bandits outside `BANDIT.activeRadius` are not ticked at all. The fix each
   time was to put both bodies on the town plateau (flat by construction,
   prop-free by `PROPS.townKeepOut`) or back at their camp, and *then* measure.

6a. **An `activeRadius` gate is part of the staging.** Round 5 repeated round
   4's mistake exactly: a townsfolk-wander check parked the player 400m away so
   nobody would be *watching* them, and read back "nobody moved in 30 seconds".
   Past `TOWNSFOLK.activeRadius` nobody is ticked at all, so the check was
   measuring the freeze, not the wander. Park the observer **out of the
   behaviour's own range but inside the activation radius**, and say which is
   which in the comment.

6b. **Freezing a system is a legitimate stage.** `bandits.update = () => {}`
   around a measurement, restored after, is the same recipe round 2c uses on
   `horse._updateMounted`. But freeze the *whole* object: round 4's
   over-the-head shot check moved a bandit's body onto the camera ray and
   forgot its collider, so the infinitely tall cylinder it was meant to be
   ignoring stayed back at camp — and the check passed with the fix reverted.
   A staged object usually has more than one piece.

---

### A check that walks the route finds what a check that measures cannot

Round 5's "walk in through the saloon door" check takes sixty 10cm steps at the
doorway, calling `resolveCollisions` each step exactly as `player.js` does, and
asserts it ends up inside. It failed immediately — and the bug was not in the
saloon at all. A street lamp stood dead centre of the doorway and the hitching
rail ran across it, so the approach was blocked by the round's own street
furniture. Nothing about the layout looked wrong in a screenshot; a lamp and a
rail were exactly where a lamp and a rail belong.

**Simulate the thing a player does, not the thing you built.** The same check
written as "assert the doorway gap is wider than the player" would have passed.

---

## Running one check instead of forty-three

The full suite is ~2 minutes and 40+ lines of output, and roughly 30s of that
is unavoidable boot. Iterating on a single check by running all of them was the
most expensive habit this harness had, so it no longer requires it:

```bash
node scripts/smoke.mjs --list                    # instant, no browser
node scripts/smoke.mjs --only "shot hits"        # ~30s, substring, case-insensitive
node scripts/smoke.mjs --placeholder player.glb  # boot on the fallback rig
```

`--only` reports an error if the pattern matches nothing, so a typo cannot
look like a pass.

`--placeholder` withholds a model from the harness's own web server, which is
[the renamed-GLB procedure](#verifying-the-placeholder-path) without the
rename — no `mv` to forget to undo, the deliberate 404 does not count as a
failure, and the checks that exist to assert *that model loaded* are skipped
rather than failed.

**Run the whole suite before declaring a round done.** These flags are for the
loop in between, not a substitute for the final run.

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
- **no sound is an accidental burst, and none of them clip.** The file is
  decoded with the Web Audio API, reduced to a 10ms envelope, and its onsets
  counted — a window above 35% of the file's peak following 250ms of quiet.
  This check exists because the shipped `gunshot.ogg` was **three** gunshots:
  the source is a six-shot take and the trim caught three of them, so every
  trigger pull went "tick tick tick". Confirmed to fail on the pre-fix file.
  It also catches a full-scale peak, because `loudnorm` had left all three at
  0 dBFS and Vorbis overshoots on a transient.

  The budget is **per file** (`AUDIO.maxOnsets`), not a blanket "one". The
  first cut of this check *was* a blanket one and immediately failed
  `reload.ogg`, which legitimately contains two clicks 300ms apart — a
  cylinder closing is a sequence, a gunshot is not. That was the check being
  wrong rather than the file, and it is worth remembering when writing the
  next content assertion: **encode the invariant that actually holds, not the
  one that happens to hold for the file in front of you.**
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

**Round 4 — bandits**

- `bandit.glb` loaded, three camps of 3–5, none on the placeholder rig
- **every bandit is an independent skeleton clone** — separate `Skeleton`
  objects *and* separate `Bone` objects, with geometry still shared. Confirmed
  to fail with `rig-clone.js`'s rebind reverted ("two bandits share one
  Skeleton object"), which is the bug that would have made a camp move as one
  body
- camps sit on ground, not a hillside: height spread and slope sampled over
  each camp's own footprint, plus the boundary clamp and the town keep-out
- a bandit carries its own revolver on its own hand bone at life size — the
  first test of `weapons.js`'s "written against any skeleton" claim, and of
  the armature scale being divided out on a *cloned* rig
- `Death` and `HitRecieve` wired as one-shots, and `setLocomotion` standing
  aside while either owns the rig
- **a shot two metres over a bandit's head misses, one at its chest hits.**
  Both halves: the miss is the `top: Infinity` trap, the hit is
  `bandits.raycast()` being in the shot path at all. Confirmed to fail with
  combat's ignore-set line reverted
- two rounds drop a bandit, a third on the corpse does nothing, the collider
  is unregistered and the camp's alive count falls
- line of sight is clear at 20m in the open, blocked by a boulder half way,
  and clear again when the boulder is removed (which also proves the
  `BANDIT.losInterval` cache is not stale-sticky)
- **gunfire wakes the whole camp.** Confirmed to fail on the pre-fix code:
  the men parked past `sightRange` but inside `hearingRange` all slept
  through it. This is the round's one real behavioural bug
- a camp closes, shoots, and kills a player standing in the open — measured at
  2–10 seconds, against BUILD-PLAN.md's "survivable for a few seconds but
  stupid". Driven at a fixed step, not by wall clock (gotcha 2b)
- five hits drop the player; a dead player cannot fire or reload; respawn
  restores full health and the ability to fight
- respawn picks the nearer of spawn and the last camp, and lands on the
  stand-off ring — asserted against `campApproachRadius` too, since a
  stand-off outside it would un-arm the checkpoint that just used it
- bandit colliders are registered once, mutate in place, and are never
  re-added — with the "assert you measured something" guard that at least one
  actually moved
- **draw calls with a whole camp on screen**, not just at spawn. The existing
  budget check samples at the plateau where no bandit is visible and would
  never have noticed round 4's 126
- **the signal fire is a landmark, and its smoke column has no gaps.** Height,
  flame size, and a collider that stops at the pyre rather than the flame —
  plus the gap assertion, which is a confirmed regression check: per-puff
  phases were `Math.random()` and thirty uniform samples on a line clump, so
  the column rendered as two isolated blobs with a 10–18m hole under them.
  Stratifying bounds the worst gap at 1.7x the average *by construction*,
  which is why the threshold can be 1.9x and mean something. Reverting fails
  three runs out of three

**Round 5 — the town**

- ten hand-placed buildings, all five that BUILD-PLAN.md names by name, every
  footprint on flat plateau (height spread sampled over its own corners) and
  inside `TOWN.halfSize`
- the whole town is **three** meshes (opaque + glass + signs), the first two
  carrying vertex colours and the third a `map` and UVs and neither of the
  other's attributes — ADR-033's draw-call discipline asserted structurally
  rather than by watching a number — plus a third draw-call budget sample, down
  the main street
- **every building has its name painted on its sign**, checked by reading
  pixels back out of the atlas canvas: a cell that is one flat tone has no
  lettering on it however correctly it is wired up. This is rule 1b applied to
  a generated asset rather than a downloaded one — "the texture exists" is not
  "the texture says anything". It also asserts the UV rows are distinct, since
  ten boards sharing one cell would render ten identical signs
- the HUD names the building whose frontage you are standing at, for every one
  of the ten, and names nothing from the middle of the street
- **a box collider pushes an agent out along its own axes**, tested at a
  deliberately NON-cardinal yaw. `resolveBox`'s first caller in four rounds,
  and the only thing that can see a sign error in the rotation convention:
  every building sits at 0, ±π/2 or π, where a box is too symmetric to tell.
  Confirmed to fail with the old sign ("pushed to local z=0.732, still inside")
- **you can walk in through the saloon door** — sixty 10cm steps through the
  real `resolveCollisions`, which is what caught a lamp post standing in the
  doorway — and the floor inside reads `TOWN.height + floorStep` while the dirt
  under it still reads `TOWN.height`, with open terrain 350m away unaffected
- **a shot inside the saloon stops at the wall**, in all four directions, fired
  from off the doorway lane (a ray straight out of the open door correctly hits
  the street). Confirmed to fail with the box branch reverted: "hit null at
  Infinity" — the round went through the wall and out into the desert
- **the camera does not walk through a saloon wall** either, read off `snap()`
  (which recomputes the occlusion distance itself, so this needs no frames),
  with a control reading in the open street. Confirmed to fail reverted
- the door trigger fades to black and back on the way in and on the way out,
  driven at a fixed step because the whole cycle is 0.58s
- **townsfolk are independent bodies with their own materials** — separate
  `Skeleton`s and `Bone`s, shared geometry, and *no* shared material, which is
  what makes the per-person tint safe (ADR-034). Also that none is visibly armed
- they stroll a short patrol, stay inside `patrolRadius` of their anchor, do
  not watch a player who is far away, and stop and turn to face one who is close
- a townsperson is hit at chest height and missed two metres over their hat,
  their collider is in combat's ignore set, and two rounds put them down and
  unregister them
- **the horse takes itself to the hitching rail** and settles facing it, and a
  whistle in town is not overridden by the rail
- street lamps: one glow instance per post, `setLit(false)`/`(true)` really
  darkens and relights, and every lamp collider carries a finite `top`

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

```bash
node scripts/smoke.mjs --placeholder player.glb
```

The harness withholds that file from its own web server, so the procedural
fallback rig is what boots. Nothing on disk moves — the older way was to
`mv` the GLB aside and remember to put it back, which is one interrupted
session away from a confusing repo.

Both placeholder rigs are real fallbacks, and both have been verified end to
end this way:

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

- `bandit.glb` withheld (round 4): the game boots, eleven capsule bandits man
  the camps, and every round-4 check passes except the skeleton-clone one,
  which self-skips. This run is also what caught the collider-movement check
  measuring nothing (see rule 6).

Do this again whenever a round changes the character interface
(`setLocomotion` / `setAirborne` / `setRidingPose` / `setAimPose` /
`playHit` / `setDead` / `hipHeight`), because the placeholders implement that
interface independently.
**Round 3 changed it**: `setLocomotion` grew an `aiming` argument,
`setAimPose` is new, and `PlaceholderHuman` now carries `WristR`/`WristL`
empties purely so `weapons.js`'s generic bone search finds a hand on it too.
**Round 4 changed it again**: `playHit()` and `setDead(bool)` are new on both
rigs, and `PlaceholderHuman` implements BUILD-PLAN.md's substitution for them
(rock back on a hit, tip over and sink on death) since it has no clips.
`--placeholder bandit.glb` is now a second run worth making, because it is the
only thing that exercises `bandits.js`'s own fallback path.
The round-3 and round-4 skeleton checks self-skip on the placeholder rig, as
the round-2b/2c/2d ones do.

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
