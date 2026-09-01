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

---

## Two harness bugs that produced false passes

Both live in [TESTING.md](TESTING.md) because they will bite the next check
written, not just the ones they hit:

- `page.waitForFunction()` with an **async** predicate resolves on its first
  poll regardless of the real result, in this Playwright version. It reported
  the mount check as passing with the saddle lerp ~25% complete.
- Polling a ~0.89s event from node at ~3fps headless misses it. Sample from
  inside the render loop.
