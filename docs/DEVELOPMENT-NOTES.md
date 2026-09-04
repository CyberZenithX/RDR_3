# DEVELOPMENT-NOTES.md — bugs found, root causes, and what they taught

Historical record. Each entry is **symptom → root cause → fix → lesson**.
Read the lesson lines even if you skip the stories; several of these bugs cost
multiple failed fix attempts and will recur in a new guise.

Related: [DECISIONS.md](DECISIONS.md) (what we chose) ·
[TESTING.md](TESTING.md) (how things get verified) ·
[ANIMATION.md](ANIMATION.md) · [HORSE.md](HORSE.md)

---

## The method that actually worked

Stated up front because it is the transferable part:

- **Measure the live thing.** Every bug below that resisted a first fix was
  eventually solved by dumping real state out of a running page — parent
  hierarchies, bone world positions, bounding boxes, collider radii — not by
  reasoning about what the code should do.
- **A broken ruler agreeing with itself twice is not a working ruler.** The
  5cm-player "verification" used the same buggy measurement that caused the
  bug, and falsely confirmed 1.85m.
- **Reproduce in isolation before touching the real file.** The rock bugs were
  fixed in standalone scripts using the exact seed and params of the real
  config, then applied.
- **Confirm a new check fails on the pre-fix code.** See [TESTING.md](TESTING.md).
- **A 6-point sample is not a verification.** It missed a hooked-ankle bug
  that only showed across ~30–70% of a clip from a true side view.

---

## The player was rendering at 5cm tall

**Symptom.** Two rounds of human screenshots showed no visible character in
the third-person view.

**False start.** A first pass blamed grass (near-black, no player keep-out).
Those were real but minor issues — fixed, below — and did not explain the
missing character.

**Root cause.** `assets.js`'s `measureHeight()` called
`new Box3().setFromObject()` on a freshly-loaded GLTF scene that had **never
been added to a `Scene` or rendered**. Its `matrixWorld` chain was stale, and
`Box3.setFromObject`'s own internal per-node updates are not sufficient for
this rig's shape (multiple `SkinnedMesh` primitives under sibling
armature/mesh branches, one carrying a baked 90° corrective rotation).
Measured directly: it returned **63.8** for `player.glb` instead of ~**1.83**.
`character.js` then computed `scale = 1.85 / 63.8 ≈ 0.029` instead of ≈ 0.99 —
a 5cm player, invisible from a ~5-unit camera distance.

**Fix.** `measureHeight()` now calls `object3D.updateMatrixWorld(true)` before
measuring. Re-verified: `characterScale` 1.009, `characterWorldBBoxHeight`
1.85. Guarded by a smoke check asserting `characterScale` stays in `[0.3, 3]`.

**Lesson.** Any future GLB measurement must route through this same
`measureHeight()` — do not reimplement bounding-box measurement. And see
[ASSETS.md](ASSETS.md#measureheight-lies-on-skinned-meshes): it is still not
trustworthy for every rig.

---

## Grass rendered near-black, and spawned on top of the player

**Symptom.** Grass read as a dark mat; tufts appeared right on/behind the
character.

**Root cause (colour).** Blades are flat single-triangle cards. A blade whose
face normal points away from the sun gets zero direct light and relied on the
hemisphere light alone.

**Fix.** `GRASS.ambientFloor` (0.16), a small constant `emissive` on the grass
material, and lightened `COLORS.grassRoot` / `grassTip`.

**Root cause (placement).** No keep-out around the player's continuously
updating position.

**Fix.** `GRASS.playerKeepOut` (1.4) in `recenterGrass()`. Verified
programmatically against a fake scene, not visually.

**Status.** Neither has been visually re-confirmed *after* the character-scale
fix. A correctly sized character standing in grass is a genuinely different
scene than either original screenshot showed.

---

## The sun rendered as a jagged blob instead of a disc

**Symptom.** Pointing the debug camera at the sun direction showed a pointed,
star-like, asymmetric edge.

**Root cause.** In `sky.js`'s fragment shader, `vWorldDir` is a per-vertex
unit vector interpolated **linearly** across each triangle before the fragment
shader sees it — and linear interpolation of unit vectors does not preserve
unit length. The dome is coarse (32×20 segments) so the shrinkage is real, and
`sunDiscPower` (340) amplifies a tiny dot-product error enormously (`pow(x,340)`
is extremely sensitive near x=1). Measured with a standalone vector-math
script: at the midpoint of a typical triangle edge near the sun, the
un-normalized dot gave a sun term of **0.122** against a correct **0.350** — a
3× error, non-monotonic across the triangulation, which is exactly what
produces a blotchy pointed shape rather than smooth circular falloff.

**Fix.** `normalize(vWorldDir)` once at the top of the fragment shader, used
for both the sun terms and the horizon/haze gradient (`h = dir.y`). The
gradient terms use much lower powers (2.6, 3.4) so they were barely affected,
but there was no reason to leave them on an unnormalized quantity.

**Lesson.** Any interpolated direction vector needs re-normalizing in the
fragment shader, and high exponents make small interpolation errors
catastrophic.

---

## The player mesh faced the camera — twice, for two different reasons

**Bug 1.** `PLAYER.meshYawOffset` had never been set. Round 1 flagged it as an
untested escape hatch; it was. Set to `Math.PI`.

**Bug 2 (older, independent of the model swap).** Even with the offset set
correctly, the character still faced the camera. The constructor set
`character.root.rotation.y = this.meshYaw + PLAYER.meshYawOffset`, but the
**per-frame `update()`** set `character.root.rotation.y = this.meshYaw` — no
offset — and overwrote it from frame 1. The offset only ever "worked" because
the movement-turning code baked it *into* `meshYaw` itself
(`targetYaw = atan2(...) + PLAYER.meshYawOffset`) the first time the player
moved. So the bug was invisible during normal play and very visible at spawn
or right after a respawn, where `meshYaw` resets to the un-offset `SPAWN.yaw`.

**Fix.** `meshYaw` is now consistently a **pure logical facing angle** with no
offset baked in anywhere (removed from the `targetYaw` calculation), and
`PLAYER.meshYawOffset` is applied by one identical formula at both sites, so
it can never be applied zero or two times depending on movement state.
Confirmed by screenshot: back to camera at spawn, front at 180° around.

**Lesson.** When a constant is applied at more than one site, make the
expression textually identical at each, or state-dependent double-application
becomes possible.

---

## Rocks rendered as exploded fragments — two bugs, found in two passes

**Symptom.** Rocks looked like a jumbled pile of disconnected floating
triangle shards.

**Bug 1 (the dramatic one).** `IcosahedronGeometry` — like all three.js
Platonic solids — is **non-indexed**: a corner shared by several triangles is
stored as duplicate position entries. The lump-displacement loop in
`makeRockGeometry()` called `rng()` **per buffer entry**, so duplicate copies
of the same corner got different offsets and moved apart, tearing the mesh at
every seam.

**Fix 1.** `mergeVertices()` **before** the displacement loop.

**Bug 2 (the subtle one, found because the human looked again).** After fix 1,
every rock still had one small, consistently-placed dark notch — same rough
location regardless of seed or lumpiness, which is the tell that it's
structural, not bad luck. `mergeVertices()` compares **all** attributes, and
`IcosahedronGeometry` has a UV seam where position-identical vertices carry
different UVs. Those never merge. Confirmed by counting: **57** vertices where
the correct count is **42**, with **12 defective degree-2 vertices** (a closed
mesh needs degree ≥ 3). One of them is always the topmost point, and
displacing a degree-2 vertex reliably folds into a visible notch — which is
why turning lumpiness down didn't help (tested 4 lumpiness levels × 6 seeds;
present in all 24).

**Fix 2.** `rockMat` is a flat colour with no `map`, so the UV attribute is
dead weight: `raw.deleteAttribute('uv')` before `mergeVertices()`. Re-verified
42 vertices, clean degree-5/6 distribution, and a 3-lumpiness × 6-seed grid
came back completely clean.

**Not at risk:** cacti and dead trees are rigid `CylinderGeometry` pieces
glued with `mergeGeometries` — no per-vertex random displacement, no
meaningful UV seam duplication for this use.

**Lesson.** For any randomly-displaced non-indexed geometry (Icosahedron,
Octahedron, Tetrahedron, Dodecahedron all default non-indexed):
`mergeVertices()` **before** displacing, not after — **and if the material has
no texture map, delete the `uv` attribute first**, or the seam silently
defeats the merge.

---

## The player could walk into large rocks

**Symptom.** Human screenshot showing the character overlapping a big rock's
visible surface, after the two shape fixes above.

**Root cause.** Pure tuning mismatch. `PROPS.rock.colliderFactor` was a single
`0.8`, smaller than even the rock's *unbumped* base radius
(`IcosahedronGeometry(1, detail)` has radius exactly 1.0), before any
outward lumpiness. Measured max XZ vertex radius across 40 samples per variant
(base / ×0.7 / ×1.3, matching `props.js`'s `rockGeos` order): **1.34 / 1.24 /
1.44**. The old 0.8 was undersized by up to `0.64 × scale` — for a large rock
(`maxScale` 3.2) over 2 world units of walkable overlap, more than the
player's own diameter.

**Fix.** `colliderFactors`, an array with one value per geometry variant
(`[1.38, 1.28, 1.48]` — measured maxima plus margin), indexed by
`scatterInstanced()` the same way it indexes `geometries`
(`i % geometries.length`). Backward compatible: `colliderRadius` still accepts
a plain scalar, which cactus/tree pass (rigid shapes, near-identical footprint
per variant).

**Verified two ways.** (1) A script calling `resolveCollisions` in a loop
exactly like `player.js`'s real per-frame flow, walking a simulated player
toward a real placed rock — confirmed it stops at
`colliderRadius + playerRadius`, and that the resolved radius ÷ instance scale
equals the expected per-variant factor. (2) A screenshot from that stopped
position showing clean separation.

**Lesson.** A collider factor is a claim about geometry. Measure the geometry.

---

## "Click to play" did nothing

**Root cause.** `input.js` bound the pointer-lock click listener to `canvas`
only, but `#clickToPlay` sits on top of the canvas in paint order with
`pointer-events: auto`, so the overlay received every click and
`canvas.requestPointerLock()` was never called.

**Fix.** Bind the listener to `document`.

**Verified.** A synthetic `.click()` in a live page now reaches
`requestPointerLock()` and gets a `pointerlockerror` back — expected, since
synthetic clicks aren't a trusted gesture; a real mouse click locks normally.

**Lesson / future trap.** The document-level listener assumes **any click
anywhere means "start playing"**. Overlay UI that should be clickable without
starting play (a pause-menu button) needs an `e.target` guard.

---

## The mounted camera collapsed into the player's head

**Symptom.** Screenshot showed the camera pushed into the back of the player's
hat; `cameraCurrentDistance == CAMERA.minDistance`.

**Root cause.** The horse registers one circle collider that stays live for
its whole lifetime. While mounted, the rider's camera pivot sits right on/
inside that collider (the saddle offset is tiny), so every direction
`_maxUnobstructedDistance` swept immediately hit "its own" horse via
`segmentCircleHit`'s pivot-already-inside case.

**Fix.** An `ignoreCollider` argument threaded through
`ThirdPersonCamera._maxUnobstructedDistance` / `snap` / `update`; `main.js`
passes `horse.collider` while `player.mounted`, `null` otherwise.

**Lesson.** Any future entity that is both a camera pivot and a persistent
collider will hit this exact bug. Found by screenshot, not by reasoning —
which is the point.

---

## The rider stood on the horse, then slid off it in turns

Two rounds of the same class of bug: the **pose** was fine, the **placement**
around it was wrong.

- **Round 2b.** Round 2 shipped the player's `idle` pose at the saddle point
  and judged it acceptable from a screenshot. In play it read as a man
  standing on a horse's back with his feet sunk into it. Replaced with a real
  hand-authored seated pose, which then hit four separate rig traps.
- **Round 2c.** The human's play session found one leg swinging horizontally
  into the air whenever they steered. **Measured first, before touching
  anything**: every posed bone's position in the rig's own local frame across
  a straight run and a hard bank agreed to within 0.006 — the pose was stable.
  The three real defects were all world-vs-body-axis mistakes.

Both write-ups, with the measurements and the body-frame verification method,
live in [HORSE.md](HORSE.md). The pose-authoring rules they produced are in
[ANIMATION.md](ANIMATION.md).

**Lesson.** When a posed character looks wrong, measure the pose in its own
local frame *first*. If it's stable there, the bug is in the transform stack
above it, not in the angles.

---

## The rider was swallowed by the horse at the top of every jump

Third round of the same class, and the pose was fine again. Reported from a
play session after round 2d: the rider merges into the horse at the peak of the
jump. Measured: at the apex the rider's pelvis sat **0.61 below** the horse's
back surface, against **0.10 above** it while grounded.

The root cause was a measurement taken on the wrong bone and then trusted twice.
`docs/HORSE.md` records that `Gallop_Jump` lifts the **`Body`** bone 0.231 — and
both constants the seat uses to cope with an airborne clip (`saddleFollow`'s
0.72 share and `jumpBobLimit`'s 0.30 clamp) were sized against that figure. But
the seat samples **`Torso2`**, and stepping the clip shows `Torso2` travelling
**1.157** in the horse's body frame — the clip rears the whole forehand about a
ground-level root. The seat was following at most 0.30 of a 0.75 rise, so the
horse's back came up through the rider. A third, smaller error rode along: the
seat still inherited only the bank and the yaw, never the jump pitch.

The full breakdown, the per-clip travel table and the before/after numbers are
in [HORSE.md](HORSE.md#the-rider-was-swallowed-by-the-horse-at-the-apex).

**Lessons.**

1. **A constant derived from a measurement inherits that measurement's bone.**
   0.231 was a true number about `Body`. It was reused as though it described
   the seat, which rides `Torso2`, and it was wrong by 5×. When a config
   comment cites a measurement, check it was taken on the thing the code
   actually reads.
2. **A clamp set below the range it clamps is invisible until it engages.** The
   0.30 limit was correct for every gait and silently wrong for one clip, for
   the six frames that clip peaked. Clamps meant as safety nets belong clear of
   the measured range, not inside it.
3. **The world-vs-body-axis rule now has a fifth scalp.** Adding a rotation axis
   to a character root means auditing everything positioned relative to it.

---

## The retargeted jump clip: built, verified, removed

**This summary is the only surviving record — the work was never committed.**

Round 1 shipped airborne as "hold the last locomotion clip at a slowed
`timeScale`" (`ANIM.airTimeScale`). That was replaced by a procedural
hand-tuned leg-tuck overlay, then by a genuinely motion-authored clip:
`Man_Jump` from Quaternius' "Animated Men Pack" (CC0), loaded from a separate
`models/anim-source-jump.glb` and retargeted at load time onto `player.glb`'s
skeleton by a new `src/retarget.js` — local-space delta-from-rest quaternion
retargeting, plus same-skeleton "follower" techniques for bones the
cross-skeleton retarget distorted, plus `addVirtualParentTracks()` to bake the
tracks a bone would need in order to follow another bone as if it were its
child (this rig's detached feet).

**How verification kept failing** — worth remembering for any animation work:

- A 6-point sample missed a hooked-ankle bug visible only across ~30–70% of
  the clip from a true side view.
- Two rounds of "fixed" reports had changed nothing, because the real bug was
  that the feet were never driven at all — a **skinning smear that looks like
  a rotation bug** (see [ANIMATION.md](ANIMATION.md)).
- One "fixed" pass nearly reported a false regression that was actually a test
  script bypassing the game's own crossfade logic.
- Each time, the fix that worked came from measuring the live rig — dumping
  the real parent hierarchy, rotating a bone and reading world positions —
  rather than trusting notes or a prior diagnosis.

**Outcome.** Even after every distortion and smear bug was genuinely fixed and
verified through the real Space-triggered gameplay path, further tuning passes
(softer knee bend, softer hip swing, slower playback) still didn't land. The
human's verdict was "this is not working at all." **The feature was removed.**
`character.js` no longer loads a second GLB or constructs a `jump` action;
`setAirborne()` is a no-op on the real rig; airborne motion is again just the
current locomotion clip slowed by `ANIM.airTimeScale`. `src/retarget.js` and
`models/anim-source-jump.glb` were deleted, and
`ANIM_SOURCE`/`HIP_FOLLOW`/`KNEE_FOLLOW`/`ANIM.jumpTimeScale` were removed
from `config.js`.

**It is NOT recoverable from git.** `git log --all --pretty=format: --name-only
| sort -u` lists every path this repo has ever tracked, and neither
`src/retarget.js` nor `models/anim-source-jump.glb` is among them — the whole
effort lived and died inside one uncommitted session, and the human's
"Pre-jump addition" commit captured only the *post-removal* end state. An
earlier version of the project notes claimed twice that it was "sitting in git
history, not lost". That was wrong. Reviving it means **rewriting it from
scratch**, and re-fetching the source model, which this environment cannot
reach. Don't promise a future round a fallback that doesn't exist.

**If it's ever revisited**, the technique was sound and well-verified; what
was missing was ever reading as good motion to a human. A different source
clip, or accepting a simpler/more stylized pose authored in this rig's own
idiom, are both more promising than another round of retarget-parameter
tuning. See [ANIMATION.md](ANIMATION.md#why-retargeting-is-hard-here).

---

## CDN three.js made the smoke test unrunnable

**Symptom.** `node scripts/smoke.mjs` could not pass in an egress-restricted
session: every module import failed, the render loop never started, and every
`__debug` check reported `undefined`.

**Root cause.** `index.html`'s import map pulled three.js and its addons from
`cdn.jsdelivr.net`, which — like `poly.pizza`, `quaternius.com` and
`mixamo.com` — is 403'd by this environment's egress proxy. Routing chromium
through `HTTPS_PROXY` didn't help: the proxy itself was denying the host.

**Fix.** `npm pack three@0.160.0` (npm's registry *is* allow-listed) and
copied only the four files the codebase imports into `vendor/three/`. Checked
both addon files' own `import` lines first: neither pulls in DRACOLoader,
MeshoptDecoder or any other addon, so nothing more needed vendoring.
`smoke.mjs`'s static server already served anything under `ROOT`, so only the
import map changed. **1.4MB added to the repo** — worth it, since this is the
actual game dependency, not a dev-only tool. Re-verified fully offline:
`smoke PASSED`, all round-1 checks green.

**Fixed in the same pass:** `index.html` had no `<link rel="icon">`, so
Chromium's automatic `/favicon.ico` request 404'd and tripped smoke's "any
4xx" rule. Added a trivial inline `data:image/svg+xml` favicon rather than a
binary asset.

**Lesson.** The page must be offline-hostile-proof, because the test harness
runs where the network doesn't. See
[ARCHITECTURE.md](ARCHITECTURE.md#file-map-in-full) for how to add another
addon.


## The revolver came out of the fist sideways

**Round 3.** With `GUN.holdRotation` at `(0, 0, 0)` the gun pointed
`(-0.89, 0.45, 0.09)` in the character's own frame — out to the right and up,
roughly perpendicular to the aim line. In the first screenshots it read as a
dark lump in the hand rather than as a gun.

**Cause, and why it was never going to be guessable.** `player.glb` is a
**baked-IK rig**, so a bone's rest orientation carries no convention at all:
`WristR`'s local +Z happens to point out of the side of the hand. There is no
"obvious" angle for a held object on this skeleton, and no amount of nudging
three Euler numbers by eye converges quickly on one.

**Fix: solve it, don't guess it.** A throwaway probe read the bone's live
world quaternion and computed the bone-space rotation that sends the gun's own
+Z (the barrel) onto the character root's forward axis, with world up as the
roll reference — `(-1.467, 0.557, 1.984)`. The same probe produced
`holdPosition` by asking where the gun's *grip* (not its origin, which is the
back of the frame) has to sit to land in the middle of the palm, 55% of the way
from the wrist joint to the knuckles.

The same probe caught a second thing worth having on record: **`WristR`'s world
scale is 101.45.** The GLB bakes ~100× into the armature and the character
root's rescale-to-1.85m compounds with it rather than cancelling it, so a
parented mesh renders at a hundred times life size. `weapons.js` measures and
divides it out at attach time, which is what lets every offset in `GUN` be
written in plain metres.

**The lesson generalises.** Anything else placed in a hand on this rig — a
rifle, a lantern, a bottle, round 6's duel props — should be solved the same
way rather than eyeballed, and the probe pattern (launch headless, force the
pose, read live world transforms, print numbers) is ten minutes of work.

## An unarmed placeholder rig took the whole boot sequence down

**Round 3, and the most serious bug of the round.** Caught only by
`docs/TESTING.md`'s "rename the GLB away and re-run smoke" procedure — which
is exactly what that procedure is for, and which nearly got skipped.

**Symptom.** With `models/player.glb` renamed away, the game did not fall back
to the capsule placeholder and keep playing. It showed **"failed to start —
see console"**, no frames ever rendered, and *sixteen* smoke checks failed at
once, most of them round-2 checks that had nothing to do with guns.

**Cause.** One line in `main.js`:

```js
vfx.attachToMuzzle(character.weapon.muzzle);
```

`createRevolver()` had been wired into `PlayerCharacterRig` but not into
`PlaceholderHuman`, so on the fallback path `character.weapon` was `undefined`,
that line threw a TypeError, `init()` unwound, and **everything after it never
ran** — audio, combat, the click-to-play handler, the render loop. Round 2's
horse and reins were fine; they simply never got to exist.

**This is precisely the failure BUILD-PLAN.md's rule exists to prevent:** "If a
`.glb` is missing or fails to load, do not crash… keep the game fully playable.
**This rule holds for every round.**"

**Fix, in two parts, because either alone is not enough.**

1. `PlaceholderHuman` is armed too — it already carried `WristR`/`WristL`
   empties so `weapons.js`'s generic bone search finds a hand, so this was one
   `createRevolver(this.root)`. A round-3 game you cannot shoot in is not
   "fully playable" either.
2. `main.js` guards the attach, and `combat.js` tolerates a null weapon
   (`canFire`, `tryReload`, `_ejectShells`). A future rig that cannot hold a
   gun should lose the muzzle flash, not the game.

**The general lesson.** A crash in the boot sequence is a *cliff*, not a
degradation: everything downstream of the throw silently ceases to exist, and
the failures surface far from the cause. Anything `init()` does with an
optional asset needs a guard, and every round that touches the character
interface must re-run the renamed-GLB check — the placeholders implement that
interface independently and nothing else tests them.

## The gunshot was three gunshots

**Round 3, reported by the human after the round was tagged.** "The gunshot
audio sounds like 3 consecutive ticks."

**Cause.** `Black Powder.wav` from OpenGameArt's "Gunshots" is a **six-shot
take** — reports at 0.13, 0.78, 1.45, 2.12, 2.76 and 3.28 seconds. The round-3
encode assumed a 4-second SFX file was one shot with a long tail, trimmed the
first 1.6 seconds, and therefore shipped **three** consecutive reports. Every
trigger pull fired a burst.

Two things let it through. The obvious one: nobody listened, and nobody could —
this session has no ears. The real one: **the only audio check asserted that
the file loaded.** A file that loads and is wrong looks identical to a file
that loads and is right.

**A second, quieter defect in the same file.** All three clips had been run
through single-pass `loudnorm`. That rides the gain toward an *integrated*
loudness target, which on a one-shot — one spike, then near-silence — flattens
the spike and lifts the noise floor, the opposite of what a gunshot wants. It
also left every file at or above 0 dBFS, and Vorbis overshoots on a sharp
transient, so the gunshot **clipped on decode** (measured: +0.3 dBFS). A
clipped crack is its own kind of tick.

`reload.ogg` hid a third: its *source* decodes to **+4.97 dBFS**, so the
obvious "knock a few dB off" was not enough. `volumedetect` reports it as
`0.0 dB` because it clamps — the true figure only shows up in `astats` on a
float pipeline.

**Fix.** One shot cut out of the take (0.115–0.755s, faded over the last 95ms
so it never reaches the next report), no dynamics processing at all, and a
plain `volume=<n>dB` to about **-4 dBFS peak** on all three. `AUDIO.volumes`
does the by-ear balance, because peak-normalising does not.

**The check that now exists.** `smoke.mjs` decodes each one-shot with the Web
Audio API, builds a 10ms envelope, and counts onsets — a window above 35% of
the file's peak following 250ms of quiet. More than one onset fails the round,
as does a peak at full scale. Confirmed to fail on the shipped file before the
fix, which is the point: it reports "contains 3 separate hits (at 0.00s,
0.42s, 0.85s)".

**Two follow-on notes from the check itself**, because both are the kind of
mistake that repeats:

- The first cut of the check asserted **one** onset for every file, and
  immediately failed `reload.ogg` — which legitimately has two clicks 300ms
  apart, because a cylinder closing is a sequence. That was the *check* being
  wrong, not the file. The budget is now per-file in `AUDIO.maxOnsets`. Encode
  the invariant that actually holds, not the one that happens to hold for the
  file you are looking at.
- Adding the check made the run slower, which broke a *different* check: the
  aim-camera comparison started reading `1.30 -> 1.30`, both clamped to
  `CAMERA.minDistance`, because the horse had wandered up beside the player in
  the extra seconds. Camera distance is the output of an occlusion sweep, so
  that check was sampling the scenery. It now stages its own ground and fails
  loudly if the "before" reading is already clamped. See
  [TESTING.md](TESTING.md).

**The general lesson**, and it is not really about audio: *"the asset loaded"
is not *"the asset is correct"*. Round 0 already learned this for models — a
GLB under 10KB or with `skins: 0` is a failed download — and wrote a verifier.
Audio got a loader and no verifier. Any binary asset a round adds needs a
check on its **content**, not just its presence.

## The aiming support hand drifted away from the gun at high elevation

**Round 3, caught in a screenshot.** Aiming level looked right; aiming ~26° up
put the two hands visibly apart, because the left arm was written to follow
only *half* the camera's elevation (`elev * 0.5`) while the right followed all
of it. There is no IK here to close a gap, so the arms have to be swung
together. Changed to the full elevation on both.

It is still a posed approximation, not a solved grip — the hands never actually
touch, and how close they read varies with angle. That is in `SMOKE-TEST.md`
as something for the human to judge rather than something claimed as fixed.

---

## Half a camp slept through the gunfight

**Symptom.** Ten simulated seconds beside a four-man camp: two bandits closed
and opened fire, the other two patrolled placidly through the firefight and
never noticed the player at all.

**Cause.** A bandit only alerts on sight, and sight is gated on a ±69° facing
arc. The two who happened to be looking the right way engaged; the two who
were not had nothing to tell them. `combat.js` broadcasts the *player's* shots
via `bandits.hearShot()`, but a bandit's own shot broadcast nothing.

**Fix.** `Bandit._fire()` calls `group.hearShot(player.x, player.z)` — the
player's position, not the muzzle's. Broadcasting the muzzle would have sent
three men sprinting toward their own friend.

**The lesson.** Perception rules written per-agent produce group behaviour
nobody designed. The check that guards it does not observe a live camp — it
parks the other men past `sightRange` but inside `hearingRange`, so a heard
shot is the *only* thing that can wake them, and it fails cleanly when the
broadcast is removed.

## A regression check that passed on the broken code

**Symptom.** The check that a shot two metres over a bandit's head misses was
written specifically to guard the `top: Infinity` trap, and it passed with the
fix (combat's ignore-set line) reverted.

**Cause.** The check freezes `bandits.update`, moves the bandit's `position`
and its rig root onto the camera ray, and fires. It never moved the bandit's
**collider**, which stayed back at the camp — so the infinitely tall cylinder
the check was supposed to be tripping over was nowhere near the ray.

**Fix.** Move the collider with the body, and restore it afterwards. The check
then fails with the ignore set reverted, as it should.

**The lesson.** docs/TESTING.md's rule 2 says confirm a regression check goes
red on the pre-fix code — this is *why*. A staged object usually has more than
one piece (body, rig root, collider), and a check that only stages some of
them measures a world where the bug cannot occur.

## Eleven armed men cost twenty-four draw calls of nothing

**Symptom.** Round 4 measured 126 draw calls with four bandits, the player and
the horse in frame, against BUILD-PLAN.md's ~120 budget. Spawn was fine at 49.

**Cause.** `weapons.js` built the revolver as seven separate `Mesh`es over
three materials — one per part, each a draw call in the main pass *and* again
in the shadow pass. With one armed character that is invisible; with five in
frame it is forty draws for a gun the size of a hand.

**Fix.** Bake each part's transform into its geometry and `mergeGeometries`
per material: seven meshes become three. 126 → 102 at a camp, 49 → 45 at
spawn. The group's origin and axes are untouched, so `GUN.holdPosition` and
`holdRotation` — both solved numerically off the live skeleton in round 3 —
stay valid.

**The lesson.** A per-object cost that does not matter at one instance is a
budget item at eleven. The existing draw-call check sampled at spawn, where no
bandit is visible, and would never have caught this; there is now a second one
that stands the player in a camp.

## The campfire nobody could see

**Symptom.** The human's first note on round 4: "I didn't even know there was
a campfire here." Three camps were built around a fire ring 1.2m across, and
it was invisible past about thirty metres — so a camp was four men standing in
open desert with nothing to say *this is a place*.

**Cause, and the thing worth remembering.** Not that the ring was small. A
fire pit is a **ground-level object**, and at three hundred metres a
ground-level object is behind a hill, under the grass, or gone into
`FOG.density`. Scaling it up would have fixed thirty metres and nothing else.
What a camp needs at range is **height**, and mostly smoke: a dark vertical
column in a landscape made entirely of horizontals.

**Fix.** `campfire.js`, in three tiers sized by the range each has to work at
— pyre and boulders up close, an unlit `fog: false` flame at middle distance,
and an 85m smoke column that is the only tier surviving 335m. Three attempts
were needed and each failure taught something:

1. **Crossed quads read as stacked grey slabs.** The trick vfx.js uses for the
   muzzle flash is fine for a 55ms flash; at seven metres across, standing
   still in the sky, the rectangular silhouette is obvious. Low-poly spheres
   have no silhouette to give away and still need no billboarding.
2. **`Math.random()` per puff clumps.** Thirty independent uniform samples on
   a line are not evenly spread — measured, they rendered two isolated blobs
   with a 10–18m hole between them and the fire. Stratifying (one puff per
   equal slice, jittered inside its own slice) bounds the worst gap at 1.7×
   the average by construction. This is the round's confirmed regression
   check; reverting it fails three runs out of three.
3. **The column paled out at exactly the wrong end.** Puffs were lerped toward
   the sky colour as they rose, which is what smoke does — but the top is the
   only part that clears a ridge from 335m, so the landmark was dissolving
   precisely where it had to be read. The fade now starts at 0.9 of the rise
   and only hides the recycle.

**The lesson.** "Make it bigger" and "make it visible from far away" are
different problems, and the second one is almost always about height and
contrast rather than size. Every one of the three failures above was found by
taking a screenshot from the distance the feature is *for* — not from where it
was convenient to stand.

## The saloon's door was blocked by its own street furniture

**Symptom.** A new smoke check walked sixty 10cm steps straight at the saloon
doorway, resolving collisions each step exactly as `player.js` does, and ended
back where it started: `still outside the saloon`.

**Cause.** Two of round 5's own props sat on the doorway's lane. A street lamp
stood at (-8.6, 16) — dead centre of the door — and the hitching rail ran from
z 12 to 20 across it. The lamp's collider plus the player's radius is 0.6m, and
walking through its centre line meant being pushed back out every step, forever.

**Fix.** Move the lamp to z=10 and the rail (and its trough) north to z 20.5–27.5,
so the whole run of the frontage from z 14 to 18 carries no collider at all.

**Lesson.** *A door is a lane, not a point.* The first thing in this game with an
inside is also the first thing with an approach, and every collider you place on
a street has to be checked against it. Nothing in the layout looked wrong in a
screenshot — the lamp and the rail are exactly where a lamp and a rail belong.
Only walking it found the problem, which is the whole argument for a check that
simulates the walk rather than measuring the geometry.

---

## The hitching post un-hitched itself when you stood next to it

**Symptom.** The horse walked to the rail and then, on arriving, went back to
`wander` and left again. The check read `mode "wander" instead of hitched`.

**Cause.** The rule was *"the player is near the post AND more than
`followSettleDistance` away from the horse"* — deliberately, so that whistling
the animal over in the street would not be instantly undone by it walking back to
the rail. But the same clause was being evaluated every frame, including after
arrival: the horse parks at the rail, the player is standing three metres from
the rail, and the condition that put it there stops being true.

**Fix.** The distance clause gates **entering** the mode, not staying in it:
`const engage = this.mode === 'hitched' || playerToHorse > followSettleDistance`.

**Lesson.** *A condition written to describe a transition will describe a state
if you let it.* The clause was correct for "should it set off?" and wrong for
"should it stay?", and a state machine evaluated per frame cannot tell the two
apart unless you write the hysteresis in.

---

## The saloon was a black box

**Symptom.** The first interior screenshot showed a room with two blown-out
discs on the ceiling and nothing else legible — the bar, the tables and the floor
were all essentially black.

**Cause.** three r160 runs with `useLegacyLights = false`, so a `PointLight`'s
intensity is in candela and falls off as 1/d². The lights were hung at y=3.0
under a 3.4m ceiling at intensity 5.5: forty centimetres above them the ceiling
received 5.5/0.16 ≈ 34, and the floor 2.8m below received 5.5/7.8 ≈ 0.7 against a
sun of 2.5.

**Fix.** Hang them lower (2.6) and burn much harder (40), with a short
`distance` — these lights cast no shadow, so their cutoff sphere is the only
thing stopping them lighting the street straight through the wall.

**Lesson.** *Check which light model the renderer is actually running.* An
intensity that looks reasonable next to a `DirectionalLight`'s is not, because
one is attenuated and the other is not; and the inverse square means the
distance from a lamp to its own ceiling is the number that decides the exposure.

---

## Two harness bugs that produced false passes

Both live in [TESTING.md](TESTING.md) because they will bite the next check
written, not just the ones they hit:

- `page.waitForFunction()` with an **async** predicate resolves on its first
  poll regardless of the real result, in this Playwright version. It reported
  the mount check as passing with the saddle lerp ~25% complete.
- Polling a ~0.89s event from node at ~3fps headless misses it. Sample from
  inside the render loop.
