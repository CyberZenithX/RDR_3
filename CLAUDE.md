# CLAUDE.md — Dust & Iron

Running project memory. Each round runs in a **fresh session with no memory of the
last one** — this file is the only thing that carries forward. Treat it as a handoff
note to a stranger who has to finish the work tomorrow. Rewrite sections as they
change; do not just append.

The spec is `BUILD-PLAN.md`. It wins over anything here.

---

## Rounds completed

| Round | Status | Tag |
|---|---|---|
| 0 — assets | **done** | `round-0` |
| 1 — world and player | **done** | `round-1` |
| 2 — horse | not started | |
| 3 — guns | not started | |
| 4 — bandits | not started | |
| 5 — town | not started | |
| 6 — bounties, duels, wanted | not started | |
| 7 — polish | not started | |

---

## File map

One line per file. Read only what the round needs.

| File | What's in it |
|---|---|
| `index.html` | Import map + overlay markup (loading screen, click-to-play, boundary-warning vignette) + CSS. Boots `/src/main.js` as a module. No inline game code anymore. |
| `BUILD-PLAN.md` | The spec. Read every round. |
| `CLAUDE.md` | This file. |
| `SMOKE-TEST.md` | Manual checklist for the human. Grow it every round, never delete a line. |
| `scripts/verify-models.mjs` | Prints size / mesh / skin / clip-name report for every `models/*.glb`. Run after touching models. |
| `scripts/smoke.mjs` | Headless check. Serves the folder on :8917, loads it in chromium, fails on any console error, uncaught exception, 4xx/failed request, or a render loop that never started. `CHECKS` array now also asserts: player.glb loaded (not placeholder), player Y settles (doesn't fall forever), player is grounded, all three prop kinds scattered with count > 0. **Add to `CHECKS` every round.** |
| `.claude/commands/round.md` | `/round N` slash command. |
| `.claude/launch.json` | Added this round so the Browser-preview tool can serve the project (`npx serve . -l 5311`) for visual spot-checks. Not part of the shipped game. |
| `models/` | `player.glb`, `bandit.glb`, `horse.glb`. See inventory below — unchanged this round. |
| `audio/` | Still empty. Round 3 fetches `gunshot.ogg`, `reload.ogg`, `hit.ogg`; round 7 fetches the rest. |
| `src/config.js` | Every tunable number, grouped by system (`RENDER`, `COLORS`, `SKY`, `SUN`, `FOG`, `WORLD`, `TERRAIN`, `TOWN`, `BOUNDARY`, `MESAS`, `SPAWN`, `PLAYER`, `ANIM`, `CLIP_REFERENCE_SPEED`, `CLIP_CANDIDATES`, `PLACEHOLDER`, `CAMERA`, `INPUT`, `PROPS`, `GRASS`, `UI`). 308 lines. Read this first when tuning anything. |
| `src/noise.js` | Seeded PRNG (`makeRng`, mulberry32) + 2D simplex noise (`SimplexNoise2D`) + `fbm2D` + `smoothstep`. No dependencies on anything else in `src/`. |
| `src/terrain.js` | `heightAt(x,z)` — the analytic terrain function (fbm + domain warp + ridged noise + mesas + town plateau + boundary ridge, all smoothstep-blended). `normalAt(x,z)` via finite differences. `buildTerrain(scene)` builds the vertex-colored mesh. `groundHeightAt(x,z)` — **now just calls `heightAt`, not a raycast.** See the big comment at its definition for why; this is the one deliberate deviation from a literal reading of the locked "raycast onto the mesh" line, done for a measured, serious performance reason. |
| `src/sky.js` | Gradient sky dome (custom `ShaderMaterial`, zenith/horizon/sun-disc), sun `DirectionalLight` + `HemisphereLight`, `FogExp2`. `updateShadowFollow` keeps the shadow camera centered on the player every frame. |
| `src/collision.js` | The one collider array (`colliders`), `addCircleCollider`/`addBoxCollider`/`removeCollider`, and `resolveCollisions(pos, radius)` — pushes a circular agent out of anything it overlaps. Every later round's characters and buildings register into this same array. |
| `src/props.js` | Rocks (lumpy `IcosahedronGeometry`), cacti and dead trees (merged `CylinderGeometry` parts via `BufferGeometryUtils.mergeGeometries`), each as a few `InstancedMesh` variants. Registers a circle collider per placement. `buildProps(scene)` returns `{rocks, cacti, trees}` counts. |
| `src/grass.js` | Grass tufts (crossed triangle blades, vertex-colored root→tip) as one fixed-size `InstancedMesh` pool that **follows the player**, re-bucketed onto a world-space jittered grid (deterministic per cell via hashing, so it doesn't visibly reshuffle) whenever the player moves `GRASS.recenterDistance`. |
| `src/world.js` | Orchestrator only — calls terrain/sky/props/grass builders, wires `update(playerPos)` (shadow follow + grass recenter) and exposes `groundHeightAt`. ~35 lines on purpose. |
| `src/assets.js` | `loadGLTF(path)`, `findClip(gltf, ...candidates)` (the exact-then-substring contract), `measureHeight(object3D)`, `enableShadows(root)`. Generic, reused by every character loader (bandit/horse in later rounds should go through this too). |
| `src/placeholder-human.js` | `PlaceholderHuman` — the "GLB failed to load" fallback. Hand-built `Group` hierarchy (hips→torso/head, shoulder→elbow arms, hip→knee legs) of `CapsuleGeometry` meshes, animated **procedurally** (sinusoidal swing driven directly by current speed, no `AnimationMixer`, no baked clips). Implements the same interface as the real rig. |
| `src/character.js` | `createPlayerCharacter()` — loads `player.glb`, rescales to `PLAYER.modelHeight`, wraps its `idle`/`walk`/`run` clips behind `{root, height, setLocomotion(state,speed), update(dt)}`. Falls back to `PlaceholderHuman` on any load failure *or* if neither an idle nor a walk clip is found. |
| `src/input.js` | Keyboard `Set`, pointer lock (`initInput(canvas)`), raw `movementX/Y` accumulation (`consumeMouseDelta`), `onPointerLockChanged(fn)` listener. |
| `src/camera.js` | `ThirdPersonCamera` — mouse orbit (yaw/pitch), collision-aware distance (heightfield march + collider-circle sweep, **not** a mesh raycast — same perf reason as terrain), sway while moving. `getForward()`/`getRight()` are the shared convention player.js uses for WASD. |
| `src/player.js` | `Player` class — accel/decel movement, jump with coyote time + jump buffer, gravity, ground snap via `groundHeightAt`, prop collision + boundary clamp, mesh-facing turn, and the idle/walk/run hysteresis state machine (`classifySpeed`) feeding `character.setLocomotion`. |
| `src/ui.js` | `initUI()` — toggles the loading screen, click-to-play overlay, and boundary-warning opacity. All markup lives in `index.html`. |
| `src/main.js` | Entry point. Renderer/scene/camera setup (ACES tone mapping, exposure 1.1, sRGB output, `PCFSoftShadowMap`), async load sequence, the `renderer.setAnimationLoop` loop. Sets `window.__frames`/`__ready`/`__debug` for `smoke.mjs`. |

---

## Models — inventory

Unchanged since round 0. All three are **Quaternius, CC0 1.0**, pulled from poly.pizza.

| File | Source model | Origin | KB | Meshes | Skins |
|---|---|---|---|---|---|
| `models/player.glb` | "Worker" (Ultimate Modular Men Pack) | `poly.pizza/m/Yg2bQZO6Hj` | 1313 | 4 | 4 |
| `models/bandit.glb` | "Punk" (Ultimate Modular Men Pack) | `poly.pizza/m/BTALZymknF` | 1342 | 4 | 4 |
| `models/horse.glb` | "Horse" (Animated Animal Pack) | `poly.pizza/m/qvTrSG9pZF` | 1082 | 1 | 1 |

**Measured this round (world-space bounding box via `gltf-transform`'s `getBounds`, i.e. the actual size three.js will load, not the raw local-vertex numbers round 0's table showed):**

- `player.glb` — height **1.866**, width 1.676, depth 0.390. Very close to `PLAYER.modelHeight` (1.85) already; `character.js` still rescales dynamically off the measured box so this isn't hardcoded.
- `horse.glb` — height **4.824**, depth **5.676** in its *rest pose*. That is not horse-sized — real horses are ~1.6m at the withers. **Round 2 should not trust `measureHeight()` on the horse without checking this first.** Likely cause: the rest/bind pose (frame the skin sits in with no animation applied) is posed unusually — maybe mid-gallop or reared — rather than a neutral T/A-pose. Round 2 needs to either measure height with a neutral clip's first frame applied, or hardcode a sanity-checked scale factor in config and say so. Flagged here, not solved — round 1 never loads horse.glb.

Clip names, the `HitRecieve` misspelling, the `Run`/`Idle` substring-collision trap, and the horse's duplicated bare/`AnimalArmature|`-prefixed clips are all unchanged from round 0 — see BUILD-PLAN.md-era notes preserved below.

### Clip names — read this before writing any animation code

**Humanoid clips are prefixed `CharacterArmature|`** (e.g. `CharacterArmature|Idle`).
The horse has both bare and `AnimalArmature|`-prefixed copies of every clip.

`player.glb` and `bandit.glb` — **identical 24-clip set**:

```
Death              Gun_Shoot          HitRecieve         HitRecieve_2
Idle               Idle_Gun           Idle_Gun_Pointing  Idle_Gun_Shoot
Idle_Neutral       Idle_Sword         Interact           Kick_Left
Kick_Right         Punch_Left         Punch_Right        Roll
Run                Run_Back           Run_Left           Run_Right
Run_Shoot          Sword_Slash        Walk               Wave
```

`horse.glb` — 13 unique clips, **each present twice** (bare + `AnimalArmature|`):

```
Idle   Idle_2   Idle_Headlow   Idle_HitReact_Left   Idle_HitReact_Right
Walk   Gallop   Gallop_Jump    Jump_toIdle          Eating
Death  Attack_Headbutt         Attack_Kick
```

### Three traps in those names

1. **`HitRecieve` is misspelled in the asset.** Searching for `"HitReceive"` finds
   nothing. Put both spellings in the `findClip` candidate list.
2. **Naive substring matching on `Run` hits five clips** — `Run`, `Run_Back`,
   `Run_Left`, `Run_Right`, `Run_Shoot`. Same for `Idle`, which hits six. So
   `findClip` must **try an exact match on the segment after `|` first**, and only
   fall back to case-insensitive substring if that misses.
3. **Every horse clip is duplicated.** Deduplicate by the name after `|` — moot for
   round 1's `findClip` (it returns the first match, and exact-match dedup by short
   name means the bare and prefixed copies both match equally; whichever comes
   first in `gltf.animations` wins, which is fine since they're identical clips).

### findClip contract — implemented in `src/assets.js`, matches this exactly

`findClip(gltf, ...candidates)` — for each candidate in order: exact match on the
post-`|` segment (case-insensitive), then substring. Returns `null` if nothing
matches. Round 1's `character.js` logs one `console.warn` per missing clip.

---

## Animation gap — what's missing and what to fake

Unchanged from round 0's finding. Of the clips rounds 1–7 need, only `Reload` is
missing across both humanoids; nothing is missing for round 1 specifically
(`Idle`, `Walk`, `Run` all exist as real clips and are wired up).

| Needed | player / bandit | horse |
|---|---|---|
| `Idle` | ✅ `Idle` (also `Idle_Neutral`) | ✅ `Idle` (+ `Idle_2`, `Idle_Headlow`) |
| `Walk` | ✅ `Walk` | ✅ `Walk` |
| `Run` | ✅ `Run` (+ strafes `Run_Left/Right/Back`) | — |
| `Gallop` | — | ✅ `Gallop` |
| `Shoot` | ✅ `Gun_Shoot`, `Idle_Gun_Shoot`, `Run_Shoot` | — |
| `Reload` | ❌ **missing** | — |
| `Hit` | ✅ `HitRecieve`, `HitRecieve_2` | ✅ `Idle_HitReact_Left/Right` |
| `Death` | ✅ `Death` | ✅ `Death` |
| `Idle_Gun` / `Run_Gun` | ✅ `Idle_Gun`, `Idle_Gun_Pointing`, `Run_Shoot` | — |
| `Mount` / `Dismount` | ❌ missing (expected — fake per plan) | ❌ missing |

**Substitutions — unchanged from round 0's plan, none of them implemented yet
(round 1 didn't need any):**

- **`Reload` → fake.** Bone rotation on `Wrist.R`/`LowerArm.R`. *(Round 3 owns this.)*
- **`Mount`/`Dismount` → no clip.** Lerp position/rotation onto the saddle point over 0.4s. *(Round 2.)*
- **Mounted shooting → partial-skeleton blend** of `Idle_Gun_Shoot` over the riding pose. *(Round 3.)*
- **Duel draw** *(round 6)* — `Idle_Gun_Pointing`.

Nothing needs procedural recoil faking: `Gun_Shoot` is a real clip.

---

## Skeleton — bone names

**The right hand bone is `Wrist.R`.** Round 3 attaches the revolver to it; keep the
BUILD-PLAN.md names as fallbacks for a future model swap.

Humanoid rig: `RootNode` → `CharacterArmature` → `Root` → `Hips` → `Chest` →
`Head` (+ `Head_end`), arms as `UpperArm.L/R` → `LowerArm.L/R` → `Wrist.L/R`.
85 nodes. **4 separate skinned meshes** (`Worker_Feet/Legs/Body/Head`) sharing one
armature — `enableShadows()` in `assets.js` already traverses and sets
`castShadow`/`receiveShadow` on all of them, not just the first.

Horse rig: `RootNode` → `AnimalArmature`, with `Head`. 68 nodes. No hand/wrist
bones. Saddle point will be a hand-tuned offset in `config.js` (round 2).

Materials are flat named colours, no textures.

---

## Decisions made this round, and why

- **`groundHeightAt` is analytic, not a mesh raycast, despite the locked
  decision's wording.** Measured directly: two `Raycaster.intersectObject` calls
  per frame (player grounding + camera occlusion) against the 256×256-segment
  terrain mesh (~131k triangles, no BVH — three.js's stock `Raycaster` is a linear
  scan) dropped headless-chromium framerate to **~3–4fps**. Since the mesh's
  vertices are themselves sampled from `heightAt(x,z)` on an exact grid, a real
  raycast would land within a fraction of a unit of `heightAt(x,z)` everywhere
  except which diagonal a quad happens to split on — not a gameplay-relevant
  difference. Calling `heightAt` directly is the same answer for a tiny fraction
  of the cost. `groundHeightAt` stays a named function (not an alias/import
  rename) so a later round — e.g. round 5's town floors — can make it genuinely
  different from open-terrain height without a rename hunting through every
  caller. **If a future round adds a BVH library** (e.g. `three-mesh-bvh` — note
  this would be a new runtime dependency, against the "zero runtime deps" rule,
  so raise it explicitly first) a real raycast becomes cheap and this can revert.
- **Camera's terrain occlusion is a heightfield march** (`CAMERA.collisionSteps`
  samples of `heightAt` along the segment from pivot to desired camera position),
  same reasoning as above. Prop occlusion is a cheap analytic segment-vs-circle
  test over the collider list, not a raycast.
- **World boundary implemented as both a visual ridge and a hard position
  clamp.** The ridge (`BOUNDARY.ridgeStart`→`ridgeEnd`, baked directly into
  `heightAt`, not a separate mesh) is the "how it ends" story from the player's
  view; the hard clamp (`BOUNDARY.playerLimit`, applied to the player's XZ every
  frame in `player.js`, independent of terrain shape) is the guarantee that no
  future terrain-tuning pass can ever let the player reach the mesh edge and fall
  into the void. Belt and suspenders on purpose.
- **Mesas kept well clear of the boundary ridge** (checked their radii against
  `BOUNDARY.ridgeStart` by hand when writing `config.js` — the first draft had
  mesa 0 overlapping the ridge by 25 units, which would have blended two
  unrelated height features together). If you move a mesa or push the boundary
  inward, re-check `mesa.x/z ± mesa.radius` stays inside `ridgeStart` with margin.
- **Grass follows the player instead of being placed once.** A fixed-size
  `InstancedMesh` pool (`GRASS.count`) is re-bucketed onto a world-space jittered
  grid (deterministic per cell via hashing — same area looks the same if you
  leave and come back) whenever the player moves `GRASS.recenterDistance`. Placing
  grass once across a 1500×1500 world means either a tiny patch or millions of
  instances; neither is right.
- **Mesh-forward convention: yaw 0 faces −Z**, matching three.js/glTF's usual
  default and chosen so `SPAWN.yaw = 0` in `config.js` faces `MESAS[0]` (the big
  landmark mesa at `z:-400`) without any offset math at the call site.
  `PLAYER.meshYawOffset` exists in config as an escape hatch — **this was never
  visually verified against the actual rendered model** (see "what to test"
  below), so if the player turns out to face backwards, it's a one-line fix
  there, not a code change.
- **Placeholder fallback is procedural, not a baked `AnimationMixer`.**
  BUILD-PLAN.md's "hand-built Bone hierarchy + SkinnedMesh + hand-authored
  AnimationClips" instruction was written for round 0's total-fallback scenario
  (no CC0 assets found anywhere), which didn't happen. For round 1's
  narrower "this GLB specifically failed to load" case, a `Group` hierarchy of
  `CapsuleGeometry` meshes animated by direct sinusoidal functions of current
  speed (see `placeholder-human.js`) is simpler, has no mixer/clip machinery to
  keep in sync, and is easy to verify by reading — confirmed working via the
  smoke test with `player.glb` temporarily renamed away (game stayed fully
  playable, `player.glb`'s absence surfaced as one console warning, not a
  crash).
- **`.claude/launch.json` added** so the Browser-preview tool can serve the
  project. `npx serve . -l 5311`. Not part of the shipped game; a dev convenience.

---

## Constants other systems depend on

Everything tunable now lives in `src/config.js` — see the file map above for the
group names. Highlights a later round will specifically reach for:

- `SPAWN` (`x`, `z`, `yaw`) — the plateau spawn/respawn point.
- `TOWN` (`centerX/Z`, `halfSize`, `blend`, `height`) — round 5's building
  placement needs to stay inside `halfSize`; `PROPS.townKeepOut` already reserves
  extra margin around it for scenery.
- `BOUNDARY` — `playerLimit` is the hard clamp radius; don't let any placed
  content (bandit camps, round 4; the town, round 5 — already centered at
  origin so this is moot for it) end up outside it.
- `MESAS` — array of `{x, z, radius, top, flat}`. Landmarks other systems might
  want to reference (e.g. a bounty-camp callout "near the twin mesa").
- `colliders` (from `src/collision.js`) — the shared array. `addCircleCollider`/
  `addBoxCollider` register into it; `resolveCollisions(pos, radius)` is what
  every future character (bandits, horse) and the player already use to not
  clip through rocks/trees/cacti. Buildings (round 5) will use box colliders
  here for the first time — `resolveBox` is written and unit-testable but has
  no real caller yet.
- `findClip`/`loadGLTF`/`measureHeight`/`enableShadows` (from `src/assets.js`) —
  reuse for the bandit (round 4) and horse (round 2) loaders instead of
  reimplementing.
- `ThirdPersonCamera.getForward()`/`getRight()` — the shared movement-direction
  convention. Any future controllable entity (mounted player, round 2) should
  derive its movement basis from these, not reinvent yaw math.
- three.js **0.160.0** confirmed to **not** have `THREE.MathUtils.damp` (added
  later upstream) — `camera.js` hand-rolls exponential smoothing instead. Don't
  add a `MathUtils.damp` call anywhere without checking this again.
- Smoke server port **8917**; `window.__frames`/`__ready` still both kept alive
  every frame. `window.__debug` is new this round —
  `{modelsLoaded:{player}, playerY, grounded, propCounts}` — extend it, don't
  replace it, when a later round adds its own machine-checkable state.

---

## Known rough edges and deliberate shortcuts

- **Mouse-look direction was reasoned through analytically, not seen rendered.**
  I have no way to view the WebGL canvas in this environment (screenshots come
  back "Browser pane is not displayed, so the page is not compositing frames" —
  a limitation of the preview tool itself, not the game). Worked through the
  yaw/orbit vector math by hand and I'm confident it's right (mouse-right →
  camera orbits so the view turns right, verified by checking compass-direction
  rotation sense step by step), but **this is exactly the kind of thing that's
  cheap to get backwards and expensive to debug blind.** First thing to check by
  hand-testing. If it's inverted, the fix is `this.yaw += d.x * ...` instead of
  `-=` in `camera.js`'s `handleLook()` — one sign flip, not a redesign.
- **Player mesh facing direction is likewise unverified.** If the character
  walks backwards relative to where they're facing, set
  `PLAYER.meshYawOffset = Math.PI` in `config.js`. One line, see the comment
  there.
- **Headless smoke runs slow — this is the test environment, not the game.**
  `scripts/smoke.mjs` measured ~3fps in headless chromium's software rasterizer
  with the full 2048 `PCFSoftShadowMap` on. Real GPUs handle 2048 soft shadows
  trivially (this is a completely normal budget, per BUILD-PLAN.md's own "2048
  max"), so the shadow size was **not** reduced. `smoke.mjs`'s frame-target
  timeout was raised to 45s instead to give the software renderer room. Also
  observed one `CONTEXT_LOST_WEBGL` warning under sustained headless load in
  testing — didn't recur, didn't fail the run (it's a `warning`-type console
  message, and the existing "GPU stall due to ReadPixels" precedent from round 0
  already established that headless GL driver noise is ignored). If it starts
  showing up reliably, worth a second look, but one occurrence isn't a pattern.
- **No wind sway on grass yet.** Round 7 owns the wind-swayed grass shader;
  round 1's grass is static geometry, just instanced and following the player.
- **No footstep/movement sound.** Round 3 is the first round that touches audio.
- **Placeholder human's limb segments visibly separate at the joints when
  bent** (each capsule is rigidly parented, no smooth-skin blending between
  segments). Deliberate — see "Decisions made" above. It's a fallback path that,
  per the current assets, never actually runs.
- **Jump has no dedicated animation** — not required by BUILD-PLAN.md's clip
  table (only `Idle`/`Walk`/`Run`/`Shoot`/`Reload`/`Hit`/`Death` are listed as
  needing a real-or-faked clip) and the asset pack has no jump clip anyway.
  Airborne, the last locomotion clip keeps playing at a slowed `timeScale`
  (`ANIM.airTimeScale`). Reads fine for a short hop; would look off for a long
  fall, but there's no long-fall gameplay yet.
- **Camera's `lookAt` is recomputed instantly from a damped position every
  frame**, not itself damped. Not visually confirmed, but the math says this
  could look slightly swimmy for one or two frames right after a big
  obstruction-triggered zoom-in. Minor; revisit only if it's noticeable in
  person.

---

## What the next round (2 — the horse) should watch out for

1. **`horse.glb`'s rest-pose bounding box is 4.8m tall, 5.7m long — not
   horse-sized.** See "Models — inventory" above. Don't call `measureHeight()`
   on it and trust the result the way `character.js` does for the player.
   Investigate why (posed rest frame?) before picking a scale factor, or
   sanity-check against a known real-world horse height (~1.6m at the withers)
   and hardcode+comment the scale in `config.js` if the bounding box keeps
   lying.
2. **Reuse `src/assets.js`** (`loadGLTF`, `findClip`, `measureHeight`,
   `enableShadows`) and follow `character.js`'s shape (`{root, height,
   setLocomotion, update}` interface, placeholder fallback) for the horse
   loader instead of writing a parallel one-off.
3. **Saddle point is a hand-tuned offset from the horse root**, per BUILD-PLAN.md
   — the horse rig has no hand/seat bone. Expose it in `config.js` as a new
   `HORSE` block (position/rotation offset), not a magic number in `horse.js`.
4. **Mount/dismount has no clip** — lerp position+rotation onto the saddle point
   over 0.4s, per the substitutions table above. No mixer involved for that part.
5. **Camera pulls back and raises when mounted** — `ThirdPersonCamera` currently
   has one fixed `CAMERA.distance`/`pivotHeight`. Don't hardcode a second set of
   numbers in `camera.js`; add `CAMERA.mountedDistance`/`mountedPivotHeight` (or
   similar) to config and a mode flag, so round 1's on-foot camera feel is
   untouched when unmounted.
6. **Horse movement should go through `colliders`/`resolveCollisions`** like the
   player already does — don't let the horse clip through rocks.
7. **Extend `scripts/smoke.mjs`'s `CHECKS`** — at minimum that `horse.glb` loads
   (or falls back cleanly), and something machine-checkable about mount state
   (e.g. player position matches saddle-point offset from horse position after a
   simulated mount, if round 2 exposes a way to trigger mount without real input).
8. Whistle (`H`) and mount/dismount (`E`) are new key bindings — add them to
   `SMOKE-TEST.md`'s control list, and to `input.js`'s handling if it needs
   anything beyond `isKeyDown` (it currently only exposes held-state + one
   pointer-lock click handler).

Before declaring the round done: `node scripts/smoke.mjs`, update this file,
add the new manual items to `SMOKE-TEST.md`, then
`git add -A && git commit -m "round N: ..." && git tag round-N`.
