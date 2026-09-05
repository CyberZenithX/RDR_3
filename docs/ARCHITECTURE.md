# ARCHITECTURE.md — how the code fits together

Read this when you need to know **which file owns what**, how a frame is
assembled, or what public surface another system may rely on.

Related: [ANIMATION.md](ANIMATION.md) (rig/clip mechanics) ·
[HORSE.md](HORSE.md) (riding) · [DECISIONS.md](DECISIONS.md) (why) ·
[TESTING.md](TESTING.md) (the smoke harness)

---

## Hard structural rules

- **No runtime dependencies except three.js**, which is *vendored* (see below).
  Adding a runtime dep — even `three-mesh-bvh` — is a decision to raise with
  the human first, not to make silently.
- **400 lines per source file, hard cap** (BUILD-PLAN.md). This is why
  `config-horse.js`, `horse-jump.js`, `horse-seat.js`, `horse-ai.js`,
  `config-combat.js`, `combat-ray.js` and `weapons.js` exist as separate
  files. When a file approaches the cap, split along a real seam and leave
  room for the *next* round, not just this one.
- Everything tunable is a named constant in `src/config.js`,
  `src/config-horse.js` or `src/config-combat.js`. No magic numbers inline.
  A number lives with the **system it is a property of**, not with the round
  that added it — which is why the mounted accuracy penalty is in the horse's
  file, not the gun's (ADR-009, ADR-023).

---

## Boot and per-frame order

`index.html` → import map → `src/main.js` (module entry).

`main.js` does renderer/scene/camera setup (ACES tone mapping, exposure 1.1,
sRGB output, `PCFSoftShadowMap`), the async load sequence, and owns the
`renderer.setAnimationLoop` loop. It sets `window.__frames` / `__ready` /
`__debug` for `scripts/smoke.mjs`.

**The per-frame order is load-bearing. Do not "simplify" it:**

1. `combat.pollInput()` — reads the mouse and `R`, moves the aim blend, ticks
   the reload/cooldown timers. **Does not fire.** It runs first because step 2
   needs `combat.aiming` to decide how the horse steers.
2. `horse.update(dt, camera, player, aiming)` — may flip `player.mounted` in
   *either* direction this frame (it owns the E key and calls `player.mount()`
   / `player.dismount()`).
3. `if (player.mounted)` — read **fresh**, after step 2 — sync
   `player.position` / `meshYaw` / `setSaddle()` from
   `horse.getSaddleTransform()`.
4. `player.update(dt, camera, combat)` — full on-foot physics, or the mounted
   early-return branch. Either way it hands `combat.poseState()` to the rig,
   so `character.update()` poses the arms for this frame.
5. `reins.update(player.mounted)` — after **both** rigs are posed, so the
   straps land on this frame's mouth and fists.
6. `combat.update()` — **fires** any shot queued in step 1. It runs here, not
   in step 1, because a shot starts at the muzzle empty and the muzzle is on
   the end of a barrel held by a hand that only just finished moving. Firing
   in `pollInput()` aims every shot from last frame's hand position.
7. `bandits.update(dt, player)` — **after** combat, so the player's round
   resolves before the return fire. Each bandit thinks, moves, poses its own
   rig and then fires from its own muzzle, in that order: the same rule step 6
   obeys for the player, applied per bandit inside one loop.
8. `town.update(dt, player)` — after combat for the same reason step 7 is: a
   round fired at a citizen resolves before that citizen decides to run. Also
   ticks the street lamps and the saloon's door trigger, which reads the
   player's **final** position for this frame.
9. `tpCamera.setMounted(...)` / `setAiming(...)` / `ui.setMounted(...)` /
   `setAiming(...)` / `updateAmmo(...)` / `updateHealth(...)` /
   `updateDamageFlash(...)` / `setDead(...)` — called unconditionally every
   frame off live state; all idempotent, no edge detection.

There is one more line before step 1: **a dead rider does not stay in the
saddle**, so `main.js` calls `horse.handleMountToggle(player)` when
`player.dead && player.mounted`. It uses the sanctioned public method (ADR-011)
and that method refuses mid-air (ADR-019), so it simply retries next frame.

**Combat's frame is deliberately split in two around the rest of the world**
(steps 1 and 6). Collapsing it into one call breaks one of those two things:
early, and the horse steers as though nobody is aiming; late, and every shot
is aimed a frame stale.

The obvious-looking alternative (branch on `horse.mounted` *before* calling
`horse.update()`) was tried and is a real same-frame bug: a dismount flips the
flags and computes the drop-off position *inside* `horse.update()`, but the
outer branch has already committed to the "still mounted" path and overwrites
the fresh drop-off with a stale saddle-sync, which `player.update()` then runs
on-foot physics from. See [DECISIONS.md](DECISIONS.md) ADR-016.

Inside `player.js`'s mounted branch the order also matters: `character.root`'s
position **and rotation** are written *before* `character.update()`, because
`riding-pose.js` converts angles through the root's live world rotation — pose
first and you convert this frame's angles through last frame's lean.

---

## File map in full

`index.html` — import map (points `three` / `three/addons/` at `/vendor/three/`,
not a CDN) + overlay markup (loading screen, click-to-play, boundary-warning
vignette, stamina bar) + CSS + a data-URI favicon. Boots `/src/main.js` as a
module. No inline game code.

`vendor/three/` — three.js **0.160.0**, vendored from the npm package as
committed files (not a submodule, not `node_modules`). Only what the codebase
imports: `build/three.module.js`,
`examples/jsm/loaders/GLTFLoader.js`,
`examples/jsm/utils/BufferGeometryUtils.js`, `LICENSE` (MIT). ~1.4MB.
**Adding another addon**: check its own `import` lines for further addon
dependencies, copy the whole chain into `vendor/three/examples/jsm/...`
preserving the relative path layout (addons import each other by relative
path, e.g. `../utils/...`), and it resolves through the existing
`three/addons/` map entry — no `index.html` change needed unless the addon
needs something outside `examples/jsm/`. Bumping the three.js version means
re-running `npm pack three@<version>` and re-copying these files; there is no
`package.json` dependency on three.js, only the vendored copy and the import
map. Why vendored: [DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md#cdn-threejs-made-the-smoke-test-unrunnable).

### World

`src/noise.js` — seeded PRNG (`makeRng`, mulberry32) + 2D simplex
(`SimplexNoise2D`) + `fbm2D` + `smoothstep`. No dependencies on anything else
in `src/`.

`src/terrain.js` — `heightAt(x,z)`, the analytic terrain function (fbm +
domain warp + ridged noise + mesas + town plateau + boundary ridge, all
smoothstep-blended). `normalAt(x,z)` via finite differences.
`buildTerrain(scene)` builds the vertex-colored mesh. `groundHeightAt(x,z)`
**is not a raycast** (ADR-001) — and since round 5 it is no longer just
`heightAt` either: it also honours the town's **floor plates**
(`addFloorPlate`, `floorPlates`), the rotated rectangles the boardwalks and the
saloon's floorboards register to stand 0.22m above the dirt (ADR-031). One AABB
around the whole plate cluster rejects every caller who is not in town. A plate
is a *surface*, never a collider. `heightAt` stays pure, so the terrain mesh,
the prop scatter and the grass are untouched by the town's existence. The horse
and the bandits use `groundHeightAt` too, same as the player.

`src/sky.js` — gradient sky dome (custom `ShaderMaterial`, zenith/horizon/
sun-disc), sun `DirectionalLight` + `HemisphereLight`, `FogExp2`.
`updateShadowFollow` keeps the shadow camera centered on the player every
frame — **not** the horse when mounted, and that needs no change, because the
player's position tracks the saddle every frame anyway.

`src/props.js` — rocks (lumpy `IcosahedronGeometry`), cacti and dead trees
(merged `CylinderGeometry` parts via `BufferGeometryUtils.mergeGeometries`),
each as a few `InstancedMesh` variants. Registers a circle collider per
placement, carrying the prop's real `top` height (the geometry's own bounding
box max — exact, because every prop geometry here is authored with its base at
local y=0) and a `meta.kind` of `'rock'` / `'cactus'` / `'tree'`.
`buildProps(scene)` returns `{rocks, cacti, trees}` counts.
Measured populations: rock tops 0.6–3.6m (median **2.50**), cacti median
**3.10**, trees median **5.20**.

`src/grass.js` — (also honours `STREET.grassKeepOut`: nothing grows on a
packed dirt street or under a boardwalk, tested as one rectangle rather than
per building footprint) grass tufts (crossed triangle blades, vertex-colored
root→tip) as one fixed-size `InstancedMesh` pool that **follows the player**,
re-bucketed onto a world-space jittered grid (deterministic per cell via
hashing, so it doesn't visibly reshuffle) whenever the player moves
`GRASS.recenterDistance`. `GRASS.playerKeepOut` (1.4) stops it spawning on top
of the character. Does not follow the horse.

`src/world.js` — orchestrator only. Calls the terrain/sky/props/grass
builders, wires `update(playerPos)` (shadow follow + grass recenter), exposes
`groundHeightAt`. ~35 lines on purpose.

`src/collision.js` — the one collider array (`colliders`),
`addCircleCollider` / `addBoxCollider` / `removeCollider`, and
`resolveCollisions(pos, radius, ignore, clearY)`. See the contract below.

### Town

`src/town.js` — the orchestrator, world.js's role for round 5. Owns no geometry:
it draws the sign atlas, runs `buildings.js`, `town-props.js` and
`townsfolk.js` into three shared part builders (opaque, glass, signs),
`finish()`es them, and owns the two things that belong to the town as
a whole — the saloon's **door trigger** (`inside`, `placeName`, `fade`, a metered
black-out with a dead band and a cooldown; `DOOR.enabled = false` switches it
off without touching the doorway) and the **hitching post** the horse waits at
(`town.hitch`, handed to `horse.setHitchPost()` by main.js). `buildTown()` never
rejects.

`src/signs.js` — `buildSignAtlas()`: every shop's lettering drawn into ONE
canvas, one horizontal strip per building, with the board colour baked in
behind it (so the quad is opaque and needs no blending or sorting). Ink is
picked light-or-dark from the board's luminance, the string is tracked out by
hand and shrunk to fit, and each cell is drawn through a horizontal scale that
cancels the difference between the cell's fixed 8:1 and the board's real
aspect. **There is no font to fetch** (docs/ASSETS.md) — this is whatever serif
the browser already has.

`src/town-geo.js` — `PartBuilder`: the vertex-coloured box/cylinder/cone/prism/
pyramid pushers, `facePlate()` (an atlas-UV'd quad facing local -Z), a
`textured` mode that keeps `uv` and drops `color` for the signs, a local
**frame** (`setFrame(x, y, z, yaw)`, so a building is
authored in its own space with its front at local -Z), and `finish()`, which
merges everything pushed into one mesh. This is why the whole town is **two draw
calls** — ADR-033. Reusable: round 6's bounty board and round 7's props should go
through it rather than adding meshes.

`src/buildings.js` — one building from a `BUILDINGS` spec: `resolvePlacement`
(a `side` of `'west'`/`'east'`/`'north'` becomes a centre and a facing, which is
what makes the frontages line up), the shell, roof, false front, porch, windows,
sign, steeple and boardwalk — plus the three things that make a building more
than scenery: **box colliders** (round 5 is `resolveBox`'s first caller; the
saloon is five walls because a front wall with a doorway in it is two walls),
**floor plates**, and `buildSaloonInterior`.

`src/town-props.js` — the hitching rail, its trough, the boardwalk crates, and
`StreetLamps`. A lamp's post is static and merges with everything else; its glow
is `campfire.js`'s flame tier — one `InstancedMesh`, unlit, `fog: false`,
flickering off a shared clock. `setLit(bool)` is round 7's switch. The three real
`PointLight`s are kept to three deliberately: every one is compiled into every
standard material's shader in the scene.

`src/townsfolk.js` — the citizens as a group, built to bandits.js's shape (one
GLB load, a `rig-clone.js` copy per body over shared geometry, a merged rig, an
`activeRadius` freeze, a shared `rayIgnore`, `hearShot`, an explicit
foot-to-head cylinder for shots). Three deliberate differences, all in ADR-034:
they are `player.glb` rather than `bandit.glb`, they clone their own
**materials** and tint them, and they are unarmed but shootable.

`src/townsperson.js` — one citizen's body and brain, split out under the
400-line cap on bandit.js/bandits.js's seam. `idle → stroll → watch → flee →
dead`, with no cover search, no shooting and no navmesh — which is why the
brain sits in the same file rather than in a third one.

### Characters

`src/assets.js` — `loadGLTF(path)`, `findClip(gltf, ...candidates)`,
`measureHeight(object3D)`, `enableShadows(root)`. Generic, reused by every
character loader. **`measureHeight` is reuse-with-caution** — see
[ASSETS.md](ASSETS.md#measureheight-lies-on-skinned-meshes).

`src/rig-clone.js` — `cloneRig(root)`: a deep copy of a loaded, skinned GLTF
scene with every `SkinnedMesh` rebound to the copy's **own** bones.
`Object3D.clone()` shares the skeleton by reference, which would make eleven
bandits one body. Stands in for `SkeletonUtils`, which is not vendored and
cannot be fetched here (ADR-029). Geometry and materials stay shared — that is
the memory win, and the reason nothing may recolour a bandit's material.

`src/health.js` — `Health(max)`: `current`, `fraction`, `dead`,
`damage(n) -> 'dead'|'hit'|null`, `reset()`. Deliberately knows nothing about
rigs, respawns or who fired. Player, bandits, round 6's deputies.

`src/character.js` — `createPlayerCharacter()` and `createRigFromGLTF(gltf,
spec)`. **Not player-only since round 4**: `bandit.glb` shares this rig bone
for bone, so `bandits.js` passes cloned scenes through the second entry point.
`hit` and `death` are wired as **one-shots** (`playHit()` returns the flinch's
own duration, which the caller uses as its stagger; `setDead(bool)` is
reversible because the player respawns), and `setLocomotion` stands aside while
either owns the rig — the guard is in here so callers stay dumb.
Loads `player.glb`, rescales
to `PLAYER.modelHeight`, wraps `idle`/`walk`/`run` behind
`{root, height, hipHeight, setLocomotion(state,speed), setAirborne(bool),
setRidingPose(weight,sway,jump), update(dt)}`. Owns a `RidingPose`, captures
its baseline *before the mixer ever runs*, measures `hipHeight` off the live
rig, and calls `pose.apply()` unconditionally every frame — including at
weight 0, which is how the pose releases bones no clip reclaims.
`setAirborne` is a **no-op** on the real rig (see ADR-008). Falls back to
`PlaceholderHuman` on any load failure *or* if neither an idle nor a walk clip
is found.

`src/horse-character.js` — `createHorseCharacter()`. Loads `horse.glb`,
rescales by the **hardcoded** `HORSE.modelScale` (not `measureHeight()`),
wires `idle`/`walk`/`gallop` (no `Trot` exists on this rig) behind the same
shape, plus `setAirborne(airborne, airTime)` — a real one-shot `Gallop_Jump`,
`LoopOnce` + `clampWhenFinished`, `timeScale = clipDuration / airTime`.
Deliberately **not** a fourth locomotion state. `horse.js` owns all
position/rotation/AI; this file only plays a requested state.

`src/placeholder-human.js` — `PlaceholderHuman`, the "GLB failed to load"
fallback. Hand-built `Group` hierarchy of `CapsuleGeometry` meshes
(hips→torso/head, shoulder→elbow arms, hip→knee legs), animated
**procedurally** (sinusoids driven by current speed — no `AnimationMixer`, no
clips). Carries `hipHeight` and its own simpler `setRidingPose()` (plain group
rotations, no skeleton to fight) and releases those angles explicitly on
dismount, since it has no mixer to do it. Implements `setAirborne(bool)` as a
procedural jump-crouch overlay.

`src/placeholder-horse.js` — `PlaceholderHorse`: procedural quadruped
(body/neck/head/tail capsules, four two-segment legs in a diagonal trot gait).
Implements `{root, height, setLocomotion(state,speed), setAirborne(bool),
update(dt)}`; `setAirborne` holds a four-legs-tucked pose (a pose, not a clip).

`src/player.js` — `Player`. Accel/decel movement, jump with coyote time +
jump buffer, gravity, ground snap via `groundHeightAt`, prop collision +
boundary clamp, mesh-facing turn, idle/walk/run hysteresis (`classifySpeed`)
feeding `character.setLocomotion`. Mounted state: `mounted` flag,
`mount()` / `setSaddle(saddle)` / `dismount(x,y,z,yaw)` (called by `horse.js`,
never self-called), and an early-return branch in `update()` that skips all
on-foot physics. See [HORSE.md](HORSE.md) for what `setSaddle` does with the
hip offset and rotation order.

`src/horse.js` — `Horse`. Everything **horizontal**: its own
`THREE.Vector3 position`, a persistent circle collider, the unmounted
wander/follow/whistle AI (`_updateUnmounted`), mounted camera-relative WASD
steering (`_updateMounted`), lean-into-turns, stamina, and the public
`handleMountToggle(player)` / `handleJump()`. Holds `this.jump` (a
`HorseJump`) and `this.seat` (a `HorseSeat`). `rotation.order = 'YXZ'` — see
ADR-005. Details in [HORSE.md](HORSE.md).

`src/horse-jump.js` — `HorseJump`: the horse's **vertical** axis. Gravity,
takeoff, arc, landing, nose-up/nose-down pitch, coyote/buffer forgiveness, and
`clearance()`. Reads Space itself while mounted; exposes `request()` for tests.

`src/horse-seat.js` — `HorseSeat`: where the rider sits and how the body under
them moves. Owns spine-bone sampling (`bob` / `sway` / `drift`) and the banked,
gait-following, jump-lifted seat point, and is the whole implementation of
`getSaddleTransform()`. Both readings are taken in the horse's own body frame,
never world axes.

`src/aim-pose.js` — `AimPose`: the upper-body aiming pose — right arm out
along the sightline, elbow soft, spine turned into it, plus the recoil kick
and the reload dip. Runs immediately **after** `RidingPose` and claims a
disjoint set of bones (`Chest`, `Head`, the right arm, and on foot the left
support arm); that bone split, not a clip blend, is how mounted shooting
composes with the seated pose. Borrows `RidingPose._grip()` /
`_captureGripAxes()` for the hand rather than re-deriving them. ADR-024.

`src/riding-pose.js` — `RidingPose`: the seated pose, built bone by bone.
`captureBaseline()` once at load; `apply(weight, sway, jump)` every frame
*after* `mixer.update()`. Also derives the finger-grip axes. Read its header
and [ANIMATION.md](ANIMATION.md) before touching any pose code.

`src/horse-ai.js` — `HorseAI`: what the horse does with nobody on it —
wander / follow / come-when-whistled, plus stepping out of the player's way.
Owns **no** position and no velocity: it writes a direction and returns a
target speed, and `horse.js` integrates both through exactly the same movement
code the mounted path uses. Split out in round 3 when the aiming steering
pushed `horse.js` to 407 lines. Round 5's hitching post is the next entry in
its `mode` machine.

`src/reins.js` — `Reins`: the bridle and rein straps `horse.glb` doesn't ship.
Rebuilds ~6 straps as square tubes into one shared buffer every frame from
live bone positions, rather than parenting anything into either skeleton (a
rein spans *both* rigs, and both carry large baked armature scales a parented
mesh would inherit). **Reusable for any strap-like geometry** — a rifle sling,
a holster belt, a hitching rope.

### Combat

`src/weapons.js` — `Revolver` / `createRevolver(rig)`. Builds the revolver
procedurally (no gun GLB is fetchable — see [ASSETS.md](ASSETS.md)), finds a
hand bone by case-insensitive candidate list, parents the gun to it, and
**divides the bone's live world scale back out** so `GUN.holdPosition` and
`GUN.muzzleOffset` can be written in plain metres. Owns `muzzle`, the empty
that every shot's raycast starts from and the flash is parented to. Written
against *any* loaded skeleton, so round 4 arms a bandit with the same call.

`src/combat.js` — `Combat`. Aim state, fire, reload, ammo, spread, recoil,
and what a shot does when it lands. **Its frame is split in two** —
`pollInput()` before `horse.update()`, `update()` after the rig is posed; see
the per-frame order above. The only coupling to the horse is an `aiming` flag
passed *in* to `horse.update()`. Public test/AI surface: `tryFire()`,
`tryReload()`, `setAimOverride()`, `canFire`, `canReload`, `currentSpread`,
`poseState()`, `lastHit`.

`src/combat-ray.js` — what a bullet hits: `raycastCylinder` (one upright
cylinder, both end caps), `raycastColliders` (the whole collider array, each
running ground-to-`top`), `raycastTerrain` (a growing-step march of `heightAt`
with a bisection refine). No mesh raycasts anywhere — ADR-025. Each writes
into a shared hit record only if it beats what is already there, so a caller
tests targets, colliders and terrain against one object and keeps the nearest.

`src/targets.js` — `Targets`: the shootable barrels and the bottles standing
on them. props.js's pattern plus the thing props do not have — **per-instance
destructible state**. A dead target is hidden by a zero-scale instance matrix
and has its collider unregistered in the same step; killing a barrel takes its
bottles with it. Barrels carry a real `top`, so the horse can jump one.

`src/vfx.js` — muzzle flash (+ point light), tracer, impact sparks, decals,
spent shells and target debris. **Fixed pools allocated once**; nothing is
created or disposed while the game runs, so the whole file is five draw calls
whether the screen is empty or full. The flash is *parented to the muzzle*,
not positioned at it each frame.

`src/audio.js` — `GameAudio` / `createAudio(camera, scene)`. `THREE.AudioListener`
on the camera, round-robined `PositionalAudio` voices per sound.
**Never throws and never rejects**: a missing file is one warning and silence,
so `play()` on a game with an empty `audio/` is a no-op. `resume()` is wired to
the pointer-lock click, which is the user gesture browsers require before an
AudioContext may start. Round 7's looping ambience wants a `loop()` alongside
`play()`, not a reshape of it.

### Bandits

`src/bandits.js` — the camps. Loads `bandit.glb` **once** and clones a rig per
man (`rig-clone.js`); owns `rayIgnore` (every bandit collider plus the
horse's), the `BANDIT.activeRadius` gate, `raycast()` (the foot-to-head
cylinder the player's shots hit), `hit()` and `hearShot()`.
`buildBandits()` **never rejects**: a missing GLB is one warning and eleven
capsule placeholders.

`src/campfire.js` — `Campfires`: the signal fire, in three tiers sized by the
range each has to work at. Pyre and boulders read up close; the flame is
`MeshBasicMaterial` with **`fog: false`** so it stays a beacon at middle
distance; the 85m smoke column is the only tier that survives 335m, and its
top has to stay dark because the top is the part that clears a ridge. Five
`InstancedMesh`es total, shared by every camp, and `update(dt)` runs for all of
them regardless of `BANDIT.activeRadius` — a landmark that only animates once
you are standing in it is not a landmark. Round 5's street lamps and the
saloon's interior lights are the obvious second user of the flame half.

`src/bandit.js` — one bandit's body. Position, a moving circle collider,
`Health`, the rig, and its **own ~40-line firing path** — not `combat.js`
(ADR-028). One movement integrator serves every AI state, the way horse.js
serves both the mounted and unmounted paths. `hasLineOfSight(player)` is two
raycasts, cached for `BANDIT.losInterval`.

`src/bandit-ai.js` — the brain. `patrol → alert → chase → takeCover → shoot →
flee → dead`, three-ray steering avoidance and the stuck detector
BUILD-PLAN.md specifies in place of a navmesh. **Owns no position and no
velocity**: it writes a heading and returns a target speed, exactly as
horse-ai.js does. Cover points are the *shoulder* of a rock, not its far side —
behind it the bandit cannot see either, which turns cover into a loop.

**How anything gets shot.** Neither the player nor a bandit is hit through the
collider list, and for two different reasons: a bandit's collider is
`top: Infinity` by the contract below (so a round ten metres overhead would
"hit" it), and the player registers no collider at all while the horse's
swallows every round aimed at a mounted rider. Both are explicit cylinders —
`Bandits.raycast()` for the player's shots, an inline `raycastCylinder` in
`bandit.js` for theirs — and `bandits.rayIgnore` is folded into `combat.js`'s
own ignore Set at construction. This is the same shape targets.js already uses
for a bottle standing on a barrel lid (ADR-025).

### Camera, input, UI

`src/camera.js` — `ThirdPersonCamera`. Mouse orbit (yaw/pitch),
collision-aware distance (heightfield march + collider-circle sweep, **not** a
mesh raycast — ADR-002), sway while moving. The pivot's *height* is chased,
not copied (`_followPivotY`, `CAMERA.pivotFollowRate` = 11), so a horse jump
reads as the camera being left behind rather than the world dropping;
displacements above `CAMERA.pivotSnapDistance` (respawn, dismount) snap
instead. `getForward()` / `getRight()` are the shared movement-basis
convention `player.js` **and** `horse.js` use for WASD — any future
controllable entity should use them rather than reinventing yaw math.
`setMounted(bool)` swaps `CAMERA.distance`/`pivotHeight`/`swayRun` for the
`mounted*` variants. `snap()` / `update()` take an optional `ignoreCollider`
(main.js passes `horse.collider` while mounted — mandatory, see ADR-017).
`setAiming(weight)` takes combat.js's **0..1 blend**, not a bool, so the
camera, the aim pose and the crosshair all move on one curve. Aim and mounted
**compose**: `_baseDistance()` / `_pivotHeight()` pick the mounted-or-not pair
and then lerp toward its aimed counterpart, so aiming from the saddle is its
own framing rather than one mode overriding the other. `addRecoil(pitch,
shake)` is the shot's kick — additive, so fanning the hammer stacks, capped by
`CAMERA.shakeMax`.

`src/input.js` — keyboard `Set`, **mouse-button `Set`** (`isMouseDown(button)`,
DOM numbering: 0 fire, 2 aim), pointer lock (`initInput(canvas)`), raw
`movementX/Y` accumulation (`consumeMouseDelta`), `onPointerLockChanged(fn)`.
`mouseup` is bound to `window`, not the canvas, so a button released off-canvas
still clears; losing pointer lock clears every held button, so Esc mid-burst
does not resume firing. `contextmenu` is prevented while locked — right mouse
is the aim button.
The pointer-lock click listener is bound to `document`, not the canvas —
**if a future round adds overlay UI that should be clickable without starting
play, that listener needs an `e.target` guard**; it currently assumes any
click anywhere means "start playing."

`src/ui.js` — `initUI()`: toggles the loading screen, click-to-play overlay,
boundary-warning opacity, stamina bar visibility (`setMounted(bool)`) and
fill/exhausted color (`updateStamina(fraction, exhausted)` — a **0..1
fraction**, so `main.js` passes `horse.staminaFraction`; `HORSE.staminaMax` is
1 today, has been 1.5, and this module is not allowed to know either way), the
crosshair (`setAiming(weight)`) and the ammo counter (`updateAmmo(rounds,
reloading)`, guarded so it only touches the DOM when the numbers change). All
markup lives in `index.html` — the one exception is the ammo pips, built from
`COMBAT.magazine` so a bigger cylinder stays one number in one file.

`src/config.js` — every tunable **except the horse's own**, grouped by system:
`RENDER`, `COLORS`, `SKY`, `SUN`, `FOG`, `WORLD`, `TERRAIN`, `TOWN`,
`BOUNDARY`, `MESAS`, `SPAWN`, `PLAYER`, `ANIM`, `CLIP_REFERENCE_SPEED`,
`CLIP_CANDIDATES`, `JUMP`, `PLACEHOLDER`, `CAMERA`, `INPUT`, `PROPS`, `GRASS`,
`UI`. `JUMP` is placeholder-only fallback pose constants.

`src/config-town.js` — the town's built fabric: `STREET`, `TOWN_BUILD`,
`TOWN_COLORS`, `SIGNS`, `BUILDINGS` (the hand-placed coordinate list),
`SALOON`, `HITCH`, `LAMPS`, `DOOR`. The fifth config file. `TOWN` — the
plateau the town stands on — stays in `config.js`, because the plateau is a
property of the terrain.

`src/config-townsfolk.js` — `TOWNSFOLK`, and nothing else. The sixth config
file, split from the one above on exactly the seam `config-ai.js` was cut on:
the bandits are a system with their own file and so are the citizens.

`src/config-horse.js` — every horse tunable: `HORSE`, `HORSE_ANIM`,
`HORSE_CLIP_CANDIDATES`, `HORSE_CLIP_REFERENCE_SPEED`, `RIDING_POSE`, `TACK`,
`PLACEHOLDER_HORSE`. Split out purely to keep `config.js` under the 400-line
cap. Still just numbers, no logic.

### Tooling (not shipped)

`scripts/smoke.mjs` — the headless check. See [TESTING.md](TESTING.md).
`scripts/verify-models.mjs` — prints size / mesh / skin / clip-name report for
every `models/*.glb`. Run after touching models.
`.claude/launch.json` — lets the Browser-preview tool serve the project
(`npx serve . -l 5311`). A dev convenience, not part of the game.
`.claude/commands/round.md` — the `/round N` slash command.

---

## Collision contract

`src/collision.js` holds **one** shared `colliders` array. Everything that
should block anything registers into it.

```js
addCircleCollider(x, z, radius, { top, meta })   // top defaults to Infinity
addBoxCollider(...)                              // written, no real caller yet
removeCollider(c)
resolveCollisions(pos, radius, ignore, clearY)
```

- `top` is the **world Y of the collider's upper surface**. Default `Infinity`
  = the old "unjumpable, infinitely tall" behaviour, so every pre-existing
  caller is unchanged. Anything a round-3+ agent should be able to vault, hop
  or be shot over needs a real `top` at registration; buildings and characters
  should keep the default.
- `clearY` is the **agent's underside**. `resolveCollisions` skips any
  collider whose `top` is at or below it. Pass `-Infinity` (or omit) to honour
  the whole list.
- `ignore` — pass your own collider if you registered one, or you will push
  yourself out of yourself.
- **Moving colliders**: `addCircleCollider` **once**, then mutate the returned
  object's `.x` / `.z` every frame. Never re-add/remove per frame. The horse is
  the reference implementation; round 4's bandits should follow it.
- `meta.kind` is `'rock'` / `'cactus'` / `'tree'` on props and `'barrel'` on
  round 3's targets; the horse's own collider is `'horse'`, round 4's are
  `'bandit'` (carrying `meta.bandit`) and `'campfire'`. Barrel colliders
  also carry `meta.target`, a back-reference to the destructible item, which is
  how a hit is attributed without a second lookup.
- **Characters keep `top: Infinity`** — a man is not something to be jumped
  over. That makes the collider list the *wrong* place to resolve a shot at
  one; see the Bandits section above. A check that wants "everything
  clearable" should use a positive list of scenery kinds, not "everything but
  the horse" — round 4 broke exactly that assumption in smoke.mjs.
- `raycastColliders` has an XZ **broad phase**: a collider further than
  `maxDist + r` is rejected in five flops. It exists for round 4's short rays
  (every active bandit casts three 3.4m avoidance rays and a line-of-sight ray
  every frame against ~600 colliders); a 220m shot is unaffected.
- **Removing a collider is a real operation now.** `targets.js` calls
  `removeCollider` when something is destroyed. Anything holding a collider
  reference across frames must tolerate it disappearing — `combat.js` keeps the
  horse's in an ignore Set, which is safe because the horse is never destroyed.
- **`rot` is the box's own rotation about +Y, read the way
  `Object3D.rotation.y` is.** Round 5 flipped `resolveBox`'s sign to make that
  true (it had no caller, and the cardinal yaws a town is built on cannot tell
  the two conventions apart — ADR-032). `raycastBox` and `terrain.js`'s floor
  plates share the convention, and the smoke check that guards it uses a
  deliberately **non-cardinal** box, because nothing else can see the
  difference.
- **Boxes are now first-class everywhere a circle was**: `resolveCollisions`
  (round 5's buildings, `resolveBox`'s first real caller),
  `raycastColliders` → `raycastBox` (ADR-032, so a shot stops at a wall), and
  `camera.js`'s occlusion sweep → `segmentBoxHit` (so the camera does not frame
  the back of a wall from inside the saloon). Anything else that walks the
  collider list and branches on `type === 'circle'` is now a gap, not a
  simplification — `bandit-ai.js`'s cover search still does, on purpose (a
  building is not a rock to peek round).
- `meta.kind` gained round 5's `'building'` (with `meta.name`, and `meta.part`
  on the saloon's five walls), `'hitch'`, `'trough'`, `'crate'`, `'lamp'` and
  `'townsfolk'` (carrying `meta.person`). Lamps, crates, the rail and the trough
  all carry a real finite `top`; buildings and townsfolk keep `Infinity`.

---

## Constants and public surface other systems depend on

**World placement**

- `SPAWN` (`x`, `z`, `yaw`) — plateau spawn/respawn point.
- `TOWN` (`centerX/Z`, `halfSize`, `blend`, `height`) — round 5's buildings
  must stay inside `halfSize`; `PROPS.townKeepOut` already reserves scenery
  margin around it.
- `BOUNDARY.playerLimit` — the hard clamp radius. The horse is clamped to the
  same radius by the same formula. No placed content (bandit camps, town) may
  end up outside it.
- `STREET` — `halfWidth` / `frontOffset` / `boardwalkDepth` / `southEnd` /
  `northEnd`, plus `grassKeepOut`. The main street runs along **Z** because
  `SPAWN` faces -Z: the town is in front of the player on frame one, with the
  church closing the far end and `MESAS[0]` standing behind it.
- `BUILDINGS` — the hand-placed coordinate list BUILD-PLAN.md requires. A
  `side` (`'west'` / `'east'` / `'north'`) resolves to a centre and a facing in
  `buildings.js`; writing the side rather than the centre is what guarantees the
  frontages line up. Round 6's bounty board can read `name` off it, exactly as
  it reads `CAMPS`.
- `MESAS` — `{x, z, radius, top, flat}[]`. Landmarks other systems can
  reference. If you move one or push the boundary inward, re-check
  `mesa.x/z ± mesa.radius` stays inside `BOUNDARY.ridgeStart` with margin —
  the first draft of `config.js` had mesa 0 overlapping the ridge by 25 units.

**Character/riding surface** — see [HORSE.md](HORSE.md) for semantics.

- `Player.mounted` / `mount()` / `setSaddle(saddle)` / `dismount(x,y,z,yaw)`.
  Round 4's bandit AI and round 6's duels must check `player.mounted` before
  assuming normal on-foot physics.
- `Horse.jump` (`HorseJump`) — `airborne`, `grounded`, `velocityY`, `weight`
  (rider's two-point blend), `pitch` (already signed for `rotation.x`),
  `airTime`, `clearance()`, `request()`. `Horse.handleJump()` is the sanctioned
  test entry point.
- `Horse.seat` (`HorseSeat`) — `bob`, `sway`, `drift`, `transform(outPos)`.
  `Horse.getSaddleTransform(outPos)` remains the public entry point, returning
  `{position, yaw, blend, roll, pitch, sway, jump}`.
- `character.hipHeight` — the rig's measured pelvis height. Anything that seats
  a character (stagecoach seat, saloon chair) positions by hips-minus-this —
  and must take it **along the seated body's own up axis**, never straight down
  in world space.
- `RidingPose._rotate()` / `_captureGripAxes()` / `_grip()` — reusable posing
  machinery for this skeleton, not just for riding. Round 3's revolver grip
  should reuse them.
- `findClip` / `loadGLTF` / `enableShadows` — reuse for the bandit loader.

**Combat surface** (round 4's bandits and round 6's duels build on this)

- `character.weapon` — the `Revolver`. `muzzle` is the empty a shot starts
  from; `syncWorld()` refreshes its matrix from the skeleton up, which must be
  called before reading it mid-frame.
- `character.setAimPose({weight, elevation, recoil, reload, support})` — the
  same shape `setRidingPose` has. Both `PlayerCharacterRig` and
  `PlaceholderHuman` implement it.
- `Combat.tryFire()` / `tryReload()` / `setAimOverride(v)` — public entry
  points, for the same reason `horse.handleMountToggle` is (ADR-011).
- `Combat.canFire` / `canReload` / `currentSpread` / `aiming` / `aimWeight` /
  `ammo` / `reloading` / `lastHit`.
- `Horse.isGalloping` — the **gait**, not `staminaExhausted`. The reload gate
  reads this; confusing the two is backwards in both directions.
- `Targets.raycast(origin, dir, maxDist, out)` / `hit(item)` / `aliveCount`.
- `Bandits.raycast(origin, dir, maxDist, out)` / `hit(bandit, fromX, fromZ)` /
  `hearShot(x, z)` / `aliveCount` / `states` / `rayIgnore` / `camps`. Same
  contract as `Targets`, so `combat.js` tests both against one hit record.
- `Town.hitch` (`{x, z, yaw, callRadius, arriveDistance, railX, railZ}`) /
  `isInsideSaloon(x, z, margin)` / `saloonFloorY` / `inside` / `placeName`
  (the room you are *in*) / `signName` (the frontage you are *at*) / `label`
  (what the HUD shows: the first of those two that is set) / `fade` /
  `buildings` / `saloon` / `lamps` / `townsfolk` / `signAtlas` / `counts`.
  `town.update(dt, player)` is the whole per-frame surface.
- `Horse.setHitchPost(point)` — the sanctioned public entry point (ADR-011);
  `horse.ai.mode` gains `'hitched'` and `horse.ai.holdYaw` is the yaw a
  standing horse settles onto. Pass null to un-hitch the world.
- `Townsfolk.raycast(origin, dir, maxDist, out)` / `hit(person, fromX, fromZ)` /
  `hearShot(x, z)` / `aliveCount` / `count` / `states` / `rayIgnore` / `people`.
  Deliberately the same contract `Targets` and `Bandits` have, so `combat.js`
  tests all three against one hit record. Round 6's wanted level hangs off
  `hit()` returning `'hit' | 'dead'`.
- `StreetLamps.setLit(bool)` — round 7's day/night switch, already wired.
- `raycastBox` / `segmentBoxHit` — the box halves of the geometry query and the
  camera sweep (ADR-032).
- `addFloorPlate(x, z, w, d, rot, y)` / `floorPlates` — raised walkable
  surfaces `groundHeightAt` honours (ADR-031).
- `Bandit.damage(n, fromX, fromZ)` / `alive` / `hasLineOfSight(player)` /
  `ai.state`. `BanditAI.alert(x, z)` is the "something happened over there"
  entry point.
- `Player.health` (a `Health`) / `damage(n)` / `dead` / `damageFlash` /
  `markCamp(camp)` / **`respawn()`** — the one function round 7 replaces with a
  real checkpoint. Nothing else decides where the player comes back.
- `character.playHit()` (returns the flinch duration) / `setDead(bool)`. Both
  rigs implement them; `setLocomotion` is ignored while either is in effect.
- `makeHit()` / `resetHit()` / `raycastCylinder` / `raycastColliders` /
  `raycastTerrain` — the whole geometry query, reusable for bandit
  line-of-sight in round 4.

**three.js version gotcha**: 0.160.0 does **not** have `THREE.MathUtils.damp`
(added upstream later). `camera.js` hand-rolls exponential smoothing. Re-check
before adding a `MathUtils.damp` call anywhere.

---

## `window.__debug` — the machine-readable state

Set every frame by `main.js`. **Extend it, never replace it**, and update this
list when you add a field.

```
modelsLoaded:{player,horse}   playerY        grounded      propCounts
scene  tpCamera  player  horse              (live object references)
characterScale   characterWorldBBoxHeight   characterRotationY
playerPos  cameraPos  cameraDistanceToPlayer
cameraCurrentDistance  cameraFov
horsePos  horseStamina  mounted
horseAirborne  horseVelocityY  horseJumpWeight
aiming  aimWeight  ammo  reloading  shotsFired
targetCounts  targetsAlive  audioMissing
playerHealth  playerDead
banditCounts  banditsAlive  banditStates    drawCalls
townCounts   insideSaloon   screenFade
townsfolkAlive   townsfolkStates   horseHitchMode
targets  combat  bandits  town  renderer     (live object references)
```

`renderer` is there so `renderer.info.render.calls` — BUILD-PLAN.md's ~120
draw-call budget — can be read without wiring it up again. Round 7 owns the
real performance pass; this is a floor that catches a round quietly adding
fifty.

`window.__frames` / `window.__ready` are kept alive every frame for the smoke
harness. `window.__debug.horse` is the live `Horse`; its public
`handleMountToggle(player)` / `handleJump()` are how a test mounts or jumps
without simulating pointer-locked input.

Removed fields (do not expect them): `jumpClipLoaded`, `jumping` — they
existed only while there was a retargeted player jump clip.

---

## Known open gaps at this layer

- **No wind sway on grass** — round 7 owns the shader; grass is static
  geometry, instanced and player-following.
- **Audio is three one-shots only.** `gunshot.ogg` / `reload.ogg` /
  `hit.ogg` are in and wired (all CC0 — provenance in [ASSETS.md](ASSETS.md)).
  Round 7 owns the looping ambience and the master mute.
- **Camera `lookAt` is recomputed instantly from a damped position**, not
  itself damped — could look slightly swimmy for a frame or two right after a
  big obstruction-triggered zoom-in. Not visually confirmed; minor.
- **The draw-call budget has real headroom.** 58 at spawn, **56** standing in
  the middle of the street, 63 with a whole camp on screen, against
  BUILD-PLAN.md's ~120. `rig-merge.js` (round 4) and the town's merged meshes
  (ADR-033) are why; the whole town — buildings, lamps, boardwalks, furniture
  and every painted sign — costs about five calls. Three smoke checks sample
  it: at spawn, at a camp, and down the main street.
- **Three `PointLight`s exist now** (two in the saloon, one over its porch).
  Every one is compiled into every standard material's shader in the scene, so
  that number is a budget in its own right — it cost about 10% of frame rate in
  the headless rasteriser. They cast no shadow, so their `distance` cutoff is
  the only thing stopping them lighting the street through the saloon's walls.
- **Dead bandits are never cleaned up.** The body stays, and its clamped Death
  clip is still mixer-updated whenever the player is inside
  `BANDIT.activeRadius`.
