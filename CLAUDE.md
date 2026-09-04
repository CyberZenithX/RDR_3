# CLAUDE.md — Dust & Iron

Running project memory. Each round runs in a **fresh session with no memory of
the last one**, so this file is where a session starts. It is an **index**, not
the whole story: it carries the facts you must know *before* you can safely
open a file, and points at `docs/` for everything else.

**Reading protocol**

1. **This file, always, first.**
2. **`BUILD-PLAN.md`** — the spec. It wins over anything here.
3. **Only the `docs/` files your round actually needs.** Do not read them all.
   Context spent re-reading the horse docs during a combat round is context you
   don't have for the combat round.

| If you are working on… | Read |
|---|---|
| bones, clips, poses, anything animated | [`docs/ANIMATION.md`](docs/ANIMATION.md) |
| the horse, riding, the seat, the jump | [`docs/HORSE.md`](docs/HORSE.md) |
| which file owns what, collision, config, `__debug` | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| `scripts/smoke.mjs`, verification, screenshots | [`docs/TESTING.md`](docs/TESTING.md) |
| why something odd-looking is the way it is | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| guns, aiming, the shot, targets, effects, audio | [`docs/DECISIONS.md`](docs/DECISIONS.md) ADR-023..026, then [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s Combat section |
| bandits, camps, health, dying, respawn | [`docs/DECISIONS.md`](docs/DECISIONS.md) ADR-027..030, then [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)'s Bandits section |
| a bug that smells familiar | [`docs/DEVELOPMENT-NOTES.md`](docs/DEVELOPMENT-NOTES.md) |
| models, licences, scaling, what can't be fetched | [`docs/ASSETS.md`](docs/ASSETS.md) |
| what the round you're starting must watch out for | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| what the human must check by hand | `SMOKE-TEST.md` |

---

## Rounds completed

| Round | Status | Tag |
|---|---|---|
| 0 — assets | **done** | `round-0` |
| 1 — world and player | **done** | `round-1` |
| 2 — horse | **done** | `round-2` |
| 2b — seated riding pose | **done** | |
| 2c — rider stays seated through a turn | **done** | |
| 2d — horse jump (Space, while mounted) | **done** | |
| 3 — guns | **done** | `round-3` |
| 4 — bandits | **done** | `round-4` |
| 5 — town | not started | |
| 6 — bounties, duels, wanted | not started | |
| 7 — polish | not started | |

**Next round: 5 — town.** Read [`docs/ROADMAP.md`](docs/ROADMAP.md) before you
start. `resolveBox` finally gets its first caller; the plateau has been
reserved since round 1 and `TOWN.halfSize` is the limit. Two things round 4
leaves for it: the draw-call budget is now **genuinely tight** (106 of ~120
with one camp on screen), and `config.js` is at 389 of the 400-line cap, so
town tunables want a `config-town.js` from the start.

---

## File map

One line per file. Long form in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

| File | What's in it |
|---|---|
| `index.html` | Import map (→ `/vendor/three/`, not a CDN), overlay markup, CSS, data-URI favicon. Boots `/src/main.js`. |
| `vendor/three/` | three.js **0.160.0**, vendored as committed files: the 3 modules we import, plus `LICENSE`. |
| `src/main.js` | Entry point. Renderer/scene setup, load sequence, the animation loop, `window.__debug`. **Frame order is load-bearing** — see below. |
| `src/config.js` | Every tunable except the horse's. |
| `src/config-horse.js` | Every horse tunable: `HORSE`, `HORSE_ANIM`, `RIDING_POSE`, `TACK`, `PLACEHOLDER_HORSE`, clip candidates — **plus** the mounted/airborne accuracy penalties and the aiming steer rates. |
| `src/config-combat.js` | Every gun tunable: `GUN`, `COMBAT`, `AIM_POSE`, `VFX`, `TARGETS`, `AUDIO`. |
| `src/config-ai.js` | Every bandit tunable: `BANDIT`, `CAMPS`, `CAMP_PROPS` — **plus `HEALTH`**, the whole game's lethality model (ADR-027). |
| `src/noise.js` | Seeded PRNG + simplex + fbm + smoothstep. No internal deps. |
| `src/terrain.js` | `heightAt` / `normalAt` / `buildTerrain` / `groundHeightAt`. |
| `src/sky.js` | Sky dome shader, sun + hemisphere light, fog, shadow follow. |
| `src/props.js` | Rocks, cacti, dead trees as `InstancedMesh`; registers a collider (with `top` and `meta.kind`) per placement. |
| `src/grass.js` | Player-following instanced grass pool. |
| `src/world.js` | Orchestrator only, ~35 lines. |
| `src/collision.js` | The one collider array + `resolveCollisions(pos, radius, ignore, clearY)`. |
| `src/assets.js` | `loadGLTF`, `findClip`, `measureHeight`, `enableShadows`. |
| `src/rig-clone.js` | Skinned deep-copy. `Object3D.clone()` shares a `SkinnedMesh`'s skeleton; this rebinds it. Stands in for `SkeletonUtils`, which cannot be fetched (ADR-029). |
| `src/health.js` | `Health` — max/current/`damage()`/`reset()`, and nothing else. Player, bandits, round 6's deputies. |
| `src/character.js` | `createPlayerCharacter()` / `createRigFromGLTF()` — the humanoid rig for **both** the player and bandits: locomotion, riding pose, aim pose, plus the `hit`/`death` one-shots. |
| `src/horse-character.js` | `createHorseCharacter()` — `horse.glb` + locomotion + the one-shot jump clip. |
| `src/placeholder-human.js` | Procedural fallback rig for the player. |
| `src/placeholder-horse.js` | Procedural fallback rig for the horse. |
| `src/player.js` | Movement, jump, gravity, grounding, collision, locomotion state, the mounted branch — plus health, dying, and **`respawn()`, the one function** round 7 swaps for a real checkpoint. |
| `src/horse.js` | Everything **horizontal**: steering (normal *and* aiming), lean, stamina, collider, mount toggle. |
| `src/horse-ai.js` | The unmounted wander/follow/whistle brain. Decides a heading and a speed; `horse.js` integrates them. |
| `src/bandits.js` | The camps: one GLB load, a cloned rig per man, the shared ray-ignore set, the activation radius, `raycast()` / `hit()` / `hearShot()`. |
| `src/campfire.js` | The signal fire that makes a camp findable: pyre, flame, and the 85m smoke column. Five draw calls for every fire in the game. |
| `src/bandit.js` | One bandit's body: position, collider, health, rig, and its own small firing path (**not** `combat.js` — ADR-028). |
| `src/bandit-ai.js` | The brain: `patrol → alert → chase → takeCover → shoot → flee → dead`, three-ray avoidance, the stuck detector. Owns no position. |
| `src/horse-jump.js` | Everything **vertical**: the arc, the pitch, `clearance()`. |
| `src/horse-seat.js` | Where the rider sits: spine sampling (`bob`/`sway`/`drift`), the banked seat point. |
| `src/rig-merge.js` | **New.** Collapses a character GLB's one-mesh-per-colour layout (16 on a bandit) into a few meshes grouped by shading, baking each flat material colour into a vertex-colour attribute. Took a camp from **110 draw calls to 63**, and spawn from 49 to 34. Declines to touch anything textured, transparent, double-sided or non-standard. |
| `src/strap.js` | **New.** The shared leather builder — square tubes written along an arbitrary curve into one buffer per frame. Extracted from reins.js when the saddle needed it; the pattern to copy for any strap that spans two skeletons. |
| `src/saddle.js` | **New.** Saddle, girth and stirrups. Rides the same seat point (bob and all) as the rider so the two cannot drift apart; the stirrup iron is placed at the rider's own foot bone while mounted. |
| `src/ik.js` | **New.** `aimBoneAt` and `solveTwoBoneIK`. Aims bones by *direction* rather than by local angle, which is what makes it usable on this baked-IK skeleton at all. |
| `src/bandit-gun.js` | **New.** One bandit's firing path, split out of bandit.js when the aim lead pushed it past the 400-line cap. Still deliberately not combat.js (ADR-028). |
| `src/tuning.js` | **New, debug only.** Live slider panel over the feel constants (F2, or `?tune`), with a Copy button that emits only what changed. Builds no DOM until opened. |
| `src/riding-pose.js` | The hand-authored seated pose, bone by bone. Also the finger-grip axes. |
| `src/aim-pose.js` | The hand-authored **aiming** pose: right arm, `Chest`, `Head`, recoil, the reload dip. Runs after the riding pose and claims a disjoint bone set — that split *is* the mounted-shooting blend. |
| `src/weapons.js` | The procedural revolver, its hand-bone attachment, and the muzzle empty every shot starts from. Generic across skeletons. |
| `src/combat.js` | Aim / fire / reload / ammo / spread / recoil. Its frame is **split in two** around the rest of the world. |
| `src/combat-ray.js` | What a bullet hits: cylinders for colliders, a marched heightfield for the ground. No mesh raycasts. |
| `src/targets.js` | Shootable barrels and the bottles on them — instanced, with per-instance destructible state. |
| `src/vfx.js` | Muzzle flash, tracer, sparks, decals, spent shells, debris. Fixed pools, allocated once. |
| `src/audio.js` | `THREE.Audio` wrapper. A missing file is one warning and silence — it never throws. |
| `src/reins.js` | Bridle and reins, rebuilt each frame from live bones across **both** rigs. |
| `src/camera.js` | `ThirdPersonCamera` — orbit, occlusion, sway, mounted mode, damped pivot height. |
| `src/input.js` | Keyboard set, pointer lock, mouse deltas. |
| `src/ui.js` | Loading screen, click-to-play, boundary vignette, stamina bar. |
| `scripts/smoke.mjs` | The headless check. Extend `CHECKS` every round. |
| `scripts/verify-models.mjs` | Size / mesh / skin / clip report for `models/*.glb`. |

---

## Before modifying animation

Read [`docs/ANIMATION.md`](docs/ANIMATION.md).

Critical invariants:

- **Runtime GLTF bone names have dots stripped** — `Wrist.R` in the file is
  `WristR` at runtime. Every `getObjectByName()` needs the dot-less form.
- **`FootL/R` are top-level `Root`-space bones**, not children of the shins.
  Rotating a leg does not move the foot; leaving the foot alone smears the
  skin into a "boomerang boot" that looks like a rotation bug and isn't one.
- **`Hips` is not the pelvis for this rig** — `Body` is. `Hips` is animated by
  zero of the 24 clips.
- **Do not assume foreign animation clips are compatible.** This is a baked IK
  rig; every external source is FK. One full retarget was built, verified and
  removed, and the code is *not* in git history.
- **Pose from a captured baseline, never a per-frame delta** — deltas compound
  on bones no clip rewrites, and nothing releases a bone no clip owns.
- `findClip` matches **exact-after-`|` first**, then substring; `HitRecieve` is
  misspelled in the asset; `Run` substring-matches five clips.
- **Anything parented into the humanoid rig inherits a ~101× armature scale**,
  and bone rest orientations are arbitrary (baked IK). Measure and divide the
  scale out; *solve* a held object's rotation numerically rather than guessing
  an angle. `weapons.js` is the worked example.
- **Two pose layers now run after the mixer**, in order: `riding-pose.js`
  then `aim-pose.js`. They own disjoint bones on purpose. Do not give a third
  system a bone one of them already claims without deciding who yields.

## Before modifying the horse or the rider

Read [`docs/HORSE.md`](docs/HORSE.md).

Critical invariants:

- **"Where is this on the animal?" is always a body-frame question.** Project
  onto the horse's own up/forward axes (`root.quaternion`), never world X/Y/Z.
  World-axis measurements are correct at rest and wrong in every turn and
  jump — that is exactly how three separate bugs shipped.
- **`character.hipHeight` is a distance along the *seated body's* up axis.**
  Subtract it rotated into the rider's frame, and scale it by the mount blend,
  or the rider slides off in turns / drops through the ground on frame 1.
- **The jump clip is not the jump.** `Gallop_Jump` lifts `Body` 0.231 units;
  the arc is integrated in code and the clip is time-stretched over it. It also
  carries 1.146 units of baked *forward* travel, which the seat must track.
- **That 0.231 is the `Body` bone, and the seat rides `Torso2`, which the same
  clip moves 1.157.** Sizing the seat's follow fraction and bob clamp from the
  wrong bone's number is what buried the rider inside the horse at every apex.
  Any constant taken from a measurement must name the bone it was taken on.
- **`clearance()` returns `-Infinity` while grounded** — a standing horse must
  not walk through low rocks.
- **Set `rotation.order` explicitly** before adding a third rotation axis to
  any character root. Nose-up is **negative** `rotation.x`.
- `HORSE.modelScale` is hardcoded (0.58) and must stay that way; the asset has
  a scale of 100 baked in.

## Before modifying combat

Read [`docs/DECISIONS.md`](docs/DECISIONS.md) ADR-023 through ADR-026.

- **`combat.js`'s frame is split in two on purpose** — `pollInput()` before
  `horse.update()`, `update()` after the rig is posed. Collapse it and either
  the horse steers as if nobody is aiming, or every shot is aimed a frame
  stale. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#boot-and-per-frame-order).
- **The raycast starts at the muzzle empty, never at the camera.** The camera
  only supplies the aim *point* (where the crosshair lands); the shot travels
  from the barrel to it. BUILD-PLAN.md requires this and smoke checks it.
- **Aiming is a pose layer, not the rig's shoot clips** (ADR-024), even though
  `Gun_Shoot` is real. A clip cannot track the crosshair and cannot coexist
  with the seated riding pose. The clips still carry the base on foot.
- **The reload gate reads `horse.isGalloping`, not `staminaExhausted`.** They
  are different signals and swapping them is wrong in both directions.
- Shots are **analytic** against the collider list and the heightfield
  (ADR-025), the same reasoning as ADR-001/ADR-002. No mesh raycasts.
- Mounted/airborne accuracy penalties live in `config-horse.js`, not
  `config-combat.js` — they are properties of the horse, not the gun.

## Before modifying bandits, health or respawn

Read [`docs/DECISIONS.md`](docs/DECISIONS.md) ADR-027 through ADR-030.

- **A bandit does not use `combat.js`** (ADR-028). It has its own ~40-line
  firing path over the same `weapons.js` / `combat-ray.js` / `vfx.js` /
  `audio.js`. `Combat` is the *player's* gun: it resolves its aim point
  through `tpCamera` and drives the crosshair, the shake and the ammo pips.
- **Neither side is hit through the collider list.** A bandit's movement
  collider is `top: Infinity` by the collision contract, so a shot ten metres
  over its head would "hit" it; the player registers no collider at all, and
  the horse's would swallow every round aimed at a mounted rider. Both are
  tested as explicit foot-to-head cylinders — `bandits.raycast()` and
  `bandit.js`'s player test — and every bandit collider plus the horse's is in
  `bandits.rayIgnore`, which `combat.js` folds into its own ignore Set.
- **`player.respawn()` is the one function.** Nothing else decides where the
  player comes back; `bandits.js` only calls `player.markCamp()`.
- **`bandit.glb` is loaded once and cloned** (`rig-clone.js`, ADR-029).
  Materials and geometry are shared by reference on purpose — so **nothing may
  recolour a bandit's material in place**, or all eleven flash at once. That
  is why the hit reaction is the `HitRecieve` clip.
- **`setLocomotion` is ignored while a flinch or a death owns the rig.** The
  guard lives in `character.js`, so callers stay dumb; `playHit()` returns the
  flinch's own duration and the caller uses that as the stagger.
- Bandits beyond `BANDIT.activeRadius` (160) are **not ticked at all** — brain
  and rig both. They stay rendered, frozen mid-idle.
- **The campfire is the camp's landmark, not its decoration** — it is how a
  player 335m away knows where the bandits are, and `campfire.js` updates
  every fire unconditionally for that reason. Height is what carries: the
  smoke column is 85m and its top must stay DARK, because the top is the only
  part that clears a ridge.

## Before modifying collision, or making something jumpable

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#collision-contract).

- One shared `colliders` array. Pass **your own** collider as `ignore` or you
  will push yourself out of yourself.
- Colliders carry a **`top`** (world Y of the upper surface, default
  `Infinity` = unjumpable) and `resolveCollisions` takes a **`clearY`** (the
  agent's underside). Anything meant to be vaulted or shot over needs a real
  `top` at registration; buildings and characters keep the default.
- **Moving colliders**: `addCircleCollider` **once**, then mutate `.x`/`.z` in
  place every frame. Never re-add/remove.

## Before modifying `main.js`'s frame order

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#boot-and-per-frame-order).
`horse.update()` runs **first** and may flip `player.mounted` either way;
`player.mounted` is then read **fresh** to decide whether to sync the saddle;
`reins.update()` runs after both rigs are posed. Reordering this makes a
dismount teleport the player back onto the horse for one frame.

## Before modifying the camera

- The mounted camera **must** be passed `horse.collider` as `ignoreCollider`,
  or it collapses to `minDistance` inside the rider's head.
- `getForward()` / `getRight()` are the shared movement basis. Don't reinvent
  yaw math in a new entity.
- three.js 0.160.0 has **no `THREE.MathUtils.damp`**; `camera.js` hand-rolls
  exponential smoothing.

## Before modifying terrain or the world

- **`groundHeightAt` is analytic, not a raycast** (ADR-001) — a deliberate,
  measured deviation from the locked spec wording. Camera occlusion is a
  heightfield march for the same reason. Two per-frame raycasts against the
  131k-triangle terrain mesh (stock `Raycaster` is a linear scan, no BVH)
  measured at ~3–4fps headless.
- The boundary is **both** a baked visual ridge and a hard XZ clamp
  (`BOUNDARY.playerLimit`). Keep all placed content inside it.
- Randomly displaced non-indexed geometry needs `mergeVertices()` **before**
  displacement, and `deleteAttribute('uv')` first if the material has no map.

## Before touching models

Read [`docs/ASSETS.md`](docs/ASSETS.md). **CC0 only.** `measureHeight()` is the
only sanctioned measurement path, *and* it still cannot be trusted on an
arbitrary `SkinnedMesh` — a CPU-side `Box3` never applies bone transforms. For
"where is the surface", **raycast** (r160's `SkinnedMesh.raycast` does apply
them). Verify a replacement model's skeleton and clip set match before swapping.

## Before adding anything to `main.js`'s load sequence

**A throw in `init()` is a cliff, not a degradation.** Round 3 wired the muzzle
flash to `character.weapon.muzzle` and forgot to arm the placeholder rig, so
with `player.glb` missing the whole boot unwound at that line: no audio, no
combat, no render loop, "failed to start", and sixteen smoke checks — most of
them round 2's — failing at once, far from the cause.

- Guard anything `init()` does with an **optional** asset.
- **Both** character rigs implement the character interface independently.
  Anything added to one must be added to the other.
- Re-run the renamed-GLB check every round that touches that interface
  ([`docs/TESTING.md`](docs/TESTING.md)). Nothing else tests the fallback, and
  it is the only thing standing behind BUILD-PLAN.md's "keep the game fully
  playable" rule.

## Before writing or changing a test

Read [`docs/TESTING.md`](docs/TESTING.md). **"The asset loaded" is not "the
asset is correct"** — round 3 gave audio a loader and no verifier and shipped a
gunshot that was three gunshots, because the CC0 source was a six-shot take.
Any binary asset a round adds needs a check on its *content*. Three harness
gotchas also produce measurements you cannot trust: `page.waitForFunction()` with an **async**
predicate resolves on its first poll regardless of the result; polling a 0.9s
event from node at ~3fps headless misses it entirely (sample from inside the
render loop); and a cross-rig measurement taken inside `horse.update` reads the
rider a whole frame stale (take those from `player.update` instead). Always
confirm a new check **fails on the pre-fix code**.

---

## Environment facts

- **This session cannot fetch assets.** `poly.pizza`, `quaternius.com`,
  `mixamo.com`, `helpx.adobe.com` and `cdn.jsdelivr.net` are 403'd by the
  egress proxy; `HTTPS_PROXY` does not help. npm's registry is allow-listed.
  No Blender, no FBX toolchain. Asset acquisition is a **human-side task** —
  say so plainly rather than shipping silently without it.
- **Screenshots are possible**, just not through the Browser-preview pane
  (which reports "not compositing frames"). A plain throwaway Playwright script
  works — see [`docs/TESTING.md`](docs/TESTING.md#screenshots-without-the-browser-pane).
  Delete such scripts when done.
- **Headless runs at ~3fps** in the software rasterizer. That is the test
  environment, not the game. Don't "optimize" the shadow map for it.
- **Zero runtime dependencies except vendored three.js.** Adding one is a
  decision to raise with the human, not to make silently.
- **400 lines per source file, hard cap** (BUILD-PLAN.md).

---

## Known open rough edges

Fixed bugs live in [`docs/DEVELOPMENT-NOTES.md`](docs/DEVELOPMENT-NOTES.md).
These are still open:

- **Nobody has fired a shot in real play.** Round 3's whole feel — fire rate,
  reload length, spread, recoil kick and shake, the aim camera's distance and
  FOV, how the aiming pose reads in motion, whether steering the horse on A/D
  alone is workable — was set from measurements and static screenshots. The
  poses *were* looked at (screenshots, since deleted), and the gun's hold
  offsets were solved numerically off the live skeleton rather than eyeballed;
  everything else is unwatched. Levers are tabulated in `config-combat.js`.
- **~~The support hand does not touch the gun~~ Fixed.** Two-bone IK (`ik.js`)
  now solves the left arm onto a `support` empty on the revolver. Measured: the
  gap was 0.134 and is now 0.045. The interesting part was *why* fixed angles
  could never close it — this rig's arm is 0.423 long and the grip sits 0.556
  from the left shoulder, so the hand could not reach at all until the off
  shoulder was brought forward (`AIM_POSE.supportShoulder*`), which is what a
  real shooter does anyway.
- **`Gun_Shoot` / `Idle_Gun_Shoot` are now dead clips**, by ADR-024's choice.
  If the procedural recoil reads badly on foot, playing `Gun_Shoot` there is
  still available — but it will not work mounted, so that would be two paths.
- **~~A collider circle is not a silhouette~~ Fixed for rocks.** A rock's
  collider is an upright cylinder at its widest radius — right for walking into,
  wrong for shooting past, since a round could clip it a metre above the rock's
  shoulder. Rocks now carry a `meta.hitSphere` that shots use instead
  (`raycastSphere`), while movement keeps the cylinder. Cacti, trees and
  buildings are genuinely pillar-shaped and still use the cylinder.

- **Nobody has fought a bandit in real play.** Round 4's whole feel — how fast
  a camp wakes, whether the cover shuffle reads as cover or as milling about,
  whether the flinch is visible, whether being killed in ~8 seconds standing
  in the open is right, how strong the damage vignette should be — was set
  from measurements and static screenshots. Levers are tabulated in
  `config-ai.js`. What *was* seen: bandits stand and animate rather than
  T-posing, the revolver is in each man's fist, the tracer and the HUD show,
  and the signal fire reads as a landmark from the spawn plateau 335m away.
- **~~The draw-call budget is genuinely tight~~ Much easier now: 34 at spawn,
  63 with a whole camp** (was 49 and 110), against BUILD-PLAN.md's ~120.
  `rig-merge.js` did it — see its header. Round 5's town has real headroom;
  round 7's performance pass still owns the rest.
  Historical figures, for comparison: 39–45 at spawn, 110 with one camp.
  Merging the revolver's seven parts into one mesh per material took 20 off
  that. Round 5's buildings and round 7's performance pass both have to live
  inside what is left; the camp figure is now a smoke check.
- **The bandit AI is deliberately dumb in tight spaces** — BUILD-PLAN.md says
  so in as many words. Three forward rays and a sidestep timer, no navmesh.
- **~~A dead bandit's body stays forever~~ Fixed.** The mixer stops once the
  Death clip has clamped (`BANDIT.corpseFreezeGrace`), the body lingers, sinks
  and retires, and `BANDIT.maxCorpses` retires the oldest early rather than
  letting them pile up. Ageing is driven by the group, not by the bandit's own
  update, so a body you rode away from is still gone when you come back.
- **~~Bandits cannot hurt the horse~~ Partly fixed.** A *riderless* horse now
  has health, is ray-tested as its own cylinder, and bolts when shot up
  (`HEALTH.horseMax`, `HORSE.spook*`) — it never dies, because stranding the
  player 300m out is a punishment the game has no answer for. A **mounted**
  horse is still deliberately untouchable: its collider stays in the bandits'
  ignore set so shots reach the rider, and the human's play session confirmed
  the current lethality of a camp reads right. Still true: the horse cannot be
  ridden down, and nothing gives it a real injury state.
- **~~A bandit's aim has no lead~~ Fixed, partially by design.** `BANDIT.aimLead`
  (0.3) leads the target by a fraction of the flight time, and reads the
  HORSE's velocity when the player is mounted — the player's own is zero while
  riding, which is why a galloping rider was effectively un-led. Deliberately
  partial: a man snap-shooting leads badly, and the human has confirmed a camp
  is already dangerous enough. **0 restores the old behaviour exactly; toward 1
  makes riding past a camp much harder.** Not yet felt in play at 0.3.

- **Nobody has ridden the horse.** Every feel-related number — AI wander,
  lean-into-turns sign and magnitude, stamina pacing, riding-pose bob and
  carriage, jump arc, hang time, camera lag — was tuned from measurements and
  static screenshots, never watched in motion. Levers are tabulated in
  [`docs/HORSE.md`](docs/HORSE.md#open-issues-and-tuning-levers). The human's
  play sessions have already caught two real bugs this way.
- **The horse's own body rises ~0.75m over a jump, on top of the 1.51m arc**,
  because `Gallop_Jump` rears the forehand about a ground-level root. The rider
  now follows that outright (which is the fix for having been swallowed by the
  horse at every apex), but whether the *animal* reading that tall over a jump
  looks right is unjudged. Cancelling the clip's rise instead is the other
  design available and is a human call — see
  [`docs/HORSE.md`](docs/HORSE.md#the-rider-was-swallowed-by-the-horse-at-the-apex).
- **The jump reaches 2.68m**, clearing ~54% of rocks and no cactus or tree.
  Intended balance, but unjudged by a human. `HORSE.jumpSpeed` is the lever;
  `PROPS.rock.maxScale` is the other end of it. Only the barrel is considered,
  so a rock cleared by 5cm may show a hoof passing through it.
- **A jump at a walk hangs as long as a jump at a gallop** (fixed impulse,
  ADR-019) — will read as floaty if the human notices.
- **`saddleSway` carries a ~-0.69 constant bias while moving and clips at -1**,
  because its rest height was captured against the idle clip. Documented and
  deliberately not fixed; it changes the feel of a system nobody has watched.
- **No wind on the grass** (round 7), **no saddle/stirrup geometry** — the
  rider's boots hang where stirrups would be, holding nothing. Audio is now
  three one-shots (gunshot / reload / hit); round 7 owns the ambience.
- **Mouse-look orbit direction** was derived analytically and never watched.
  If inverted, it's one sign flip in `camera.js`'s `handleLook()`.
- **Grass colour and keep-out fixes have not been visually re-confirmed**
  since the character-scale fix — a correctly sized character standing in
  grass is a different scene than the screenshots that prompted them.
- **`resolveBox` has no caller yet** (round 5's buildings will be the first).

---

## Writing docs — the budget

Measured across rounds 0–3: `docs/` + `CLAUDE.md` + `SMOKE-TEST.md` is **202KB
against 284KB of source**. The reading protocol keeps a session from paying for
all of it, but *writing* and *maintaining* it is now the largest single cost of
finishing a round — larger than the test suite, and much larger than any
individual rule in it.

Three rules, in priority order:

1. **One fact, one home.** A fact belongs in exactly one `docs/` file, plus a
   comment at the point in the code where someone would trip over it. Spot
   checks found single invariants restated in **four to eight** places
   (`clearY`, the muzzle empty, `staminaExhausted`). Every extra copy is
   written once and then maintained forever. Everything else **links**.
2. **The offender is the deep docs, not this index.** Measured: this file's
   combat block is 1.4KB pointing at 5.9KB of ADRs, which is the ratio an
   index *should* have — do not "optimise" these blocks, they are the danger
   you need before opening a file. The duplication is `ARCHITECTURE.md` /
   `HORSE.md` / `DECISIONS.md` each explaining the same invariant in full.
   Pick the one whose subject it is; the others get a link.
3. **A bug writeup is ~150 words**: symptom, cause, fix, and the one lesson
   that generalises. Round 3's entries ran to 600. The extra 450 said the same
   thing more slowly.

Not on the chopping block, because each caught a real bug: the smoke suite,
the placeholder-rig run, the ADRs, and the measured invariants in
[`docs/ANIMATION.md`](docs/ANIMATION.md). **Cut prose, not verification** —
verification is cheap now (`--only`), prose is not.

## Ending a round

Before you declare a round done:

1. `node scripts/smoke.mjs` — the **whole** suite, and extend its `CHECKS`
   with whatever this round made machine-checkable. Use `--only` while you are
   still iterating; run it clean before you tag.
   Also `node scripts/smoke.mjs --placeholder player.glb` if this round touched
   the character interface — that one caught a boot crash in round 3.
2. **Update the docs, to the budget above.** New detail goes in the matching
   `docs/` file; this file gets at most a line. Update the rounds table, the
   file map if files changed, and the open-rough-edges list. A fact belongs
   *here* only if it is unsafe to open a file without it — everything else
   belongs in `docs/`, once.
3. Add the new manual items to `SMOKE-TEST.md` (never delete a line), print
   them at the end of the round, and say plainly that they are the human's to
   verify.
4. `git add -A && git commit -m "round N: ..." && git tag round-N`.

Then stop. Do not begin the next round.
