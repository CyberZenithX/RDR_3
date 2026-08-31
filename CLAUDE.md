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
| `index.html` | Import map (points `three`/`three/addons/` at `/vendor/three/`, not a CDN — see "Known rough edges") + overlay markup (loading screen, click-to-play, boundary-warning vignette) + CSS + a data-URI favicon. Boots `/src/main.js` as a module. No inline game code anymore. |
| `vendor/three/` | three.js **0.160.0**, vendored from the npm package (not a submodule, not `node_modules` — committed files). Only what the codebase imports: `build/three.module.js`, `examples/jsm/loaders/GLTFLoader.js`, `examples/jsm/utils/BufferGeometryUtils.js`, `LICENSE`. See "Known rough edges" for why (CDN-loaded three.js made `scripts/smoke.mjs` unrunnable in egress-restricted sessions) and how to extend it if a later round imports another addon. |
| `BUILD-PLAN.md` | The spec. Read every round. |
| `CLAUDE.md` | This file. |
| `SMOKE-TEST.md` | Manual checklist for the human. Grow it every round, never delete a line. |
| `scripts/verify-models.mjs` | Prints size / mesh / skin / clip-name report for every `models/*.glb`. Run after touching models. |
| `scripts/smoke.mjs` | Headless check. Serves the folder on :8917, loads it in chromium, fails on any console error, uncaught exception, 4xx/failed request, or a render loop that never started. `CHECKS` array now also asserts: player.glb loaded (not placeholder), player Y settles (doesn't fall forever), player is grounded, all three prop kinds scattered with count > 0, character scale/mesh-yaw-offset sane, rock collider factors floor, and that no jump-clip action ever gets constructed (the retarget pipeline was removed — see "Known rough edges"). **Add to `CHECKS` every round.** Launches chromium through a fallback (`launchChromium()`): if Playwright's own browser build is missing it tries every chromium actually on disk (`PLAYWRIGHT_BROWSERS_PATH`, then `/usr/bin/chromium*`), or whatever `SMOKE_CHROMIUM=/path/to/chrome` names — needed because sandboxes ship a pre-installed chromium whose build number doesn't match `node_modules`. |
| `.claude/commands/round.md` | `/round N` slash command. |
| `.claude/launch.json` | Added this round so the Browser-preview tool can serve the project (`npx serve . -l 5311`) for visual spot-checks. Not part of the shipped game. |
| `models/` | `player.glb`, `bandit.glb`, `horse.glb`. See inventory below. |
| `audio/` | Still empty. Round 3 fetches `gunshot.ogg`, `reload.ogg`, `hit.ogg`; round 7 fetches the rest. |
| `src/config.js` | Every tunable number, grouped by system (`RENDER`, `COLORS`, `SKY`, `SUN`, `FOG`, `WORLD`, `TERRAIN`, `TOWN`, `BOUNDARY`, `MESAS`, `SPAWN`, `PLAYER`, `ANIM`, `CLIP_REFERENCE_SPEED`, `CLIP_CANDIDATES`, `JUMP`, `PLACEHOLDER`, `CAMERA`, `INPUT`, `PROPS`, `GRASS`, `UI`). No jump-clip retarget config anymore (`ANIM_SOURCE`/`HIP_FOLLOW`/`KNEE_FOLLOW` were removed along with the feature — see "Known rough edges"); `JUMP` is placeholder-only fallback pose constants. Read this first when tuning anything. |
| `src/noise.js` | Seeded PRNG (`makeRng`, mulberry32) + 2D simplex noise (`SimplexNoise2D`) + `fbm2D` + `smoothstep`. No dependencies on anything else in `src/`. |
| `src/terrain.js` | `heightAt(x,z)` — the analytic terrain function (fbm + domain warp + ridged noise + mesas + town plateau + boundary ridge, all smoothstep-blended). `normalAt(x,z)` via finite differences. `buildTerrain(scene)` builds the vertex-colored mesh. `groundHeightAt(x,z)` — **now just calls `heightAt`, not a raycast.** See the big comment at its definition for why; this is the one deliberate deviation from a literal reading of the locked "raycast onto the mesh" line, done for a measured, serious performance reason. |
| `src/sky.js` | Gradient sky dome (custom `ShaderMaterial`, zenith/horizon/sun-disc), sun `DirectionalLight` + `HemisphereLight`, `FogExp2`. `updateShadowFollow` keeps the shadow camera centered on the player every frame. |
| `src/collision.js` | The one collider array (`colliders`), `addCircleCollider`/`addBoxCollider`/`removeCollider`, and `resolveCollisions(pos, radius)` — pushes a circular agent out of anything it overlaps. Every later round's characters and buildings register into this same array. |
| `src/props.js` | Rocks (lumpy `IcosahedronGeometry`), cacti and dead trees (merged `CylinderGeometry` parts via `BufferGeometryUtils.mergeGeometries`), each as a few `InstancedMesh` variants. Registers a circle collider per placement. `buildProps(scene)` returns `{rocks, cacti, trees}` counts. |
| `src/grass.js` | Grass tufts (crossed triangle blades, vertex-colored root→tip) as one fixed-size `InstancedMesh` pool that **follows the player**, re-bucketed onto a world-space jittered grid (deterministic per cell via hashing, so it doesn't visibly reshuffle) whenever the player moves `GRASS.recenterDistance`. |
| `src/world.js` | Orchestrator only — calls terrain/sky/props/grass builders, wires `update(playerPos)` (shadow follow + grass recenter) and exposes `groundHeightAt`. ~35 lines on purpose. |
| `src/assets.js` | `loadGLTF(path)`, `findClip(gltf, ...candidates)` (the exact-then-substring contract), `measureHeight(object3D)`, `enableShadows(root)`. Generic, reused by every character loader (bandit/horse in later rounds should go through this too). |
| `src/placeholder-human.js` | `PlaceholderHuman` — the "GLB failed to load" fallback. Hand-built `Group` hierarchy (hips→torso/head, shoulder→elbow arms, hip→knee legs) of `CapsuleGeometry` meshes, animated **procedurally** (sinusoidal swing driven directly by current speed, no `AnimationMixer`, no baked clips). Implements the same interface as the real rig, including `setAirborne(bool)` for its own simple procedural jump-crouch overlay — unaffected by the real rig's jump-clip removal below, this was always a separate, simpler mechanism. |
| `src/character.js` | `createPlayerCharacter()` — loads `player.glb`, rescales to `PLAYER.modelHeight`, wraps its `idle`/`walk`/`run` clips behind `{root, height, setLocomotion(state,speed), setAirborne(bool), update(dt)}`. **No jump clip** — `setAirborne` is a no-op; player.js's `ANIM.airTimeScale` already slows the current locomotion clip while airborne, which is all that ships now (see "Known rough edges" for what was tried and removed). Falls back to `PlaceholderHuman` on any load failure *or* if neither an idle nor a walk clip is found. |
| `src/input.js` | Keyboard `Set`, pointer lock (`initInput(canvas)`), raw `movementX/Y` accumulation (`consumeMouseDelta`), `onPointerLockChanged(fn)` listener. |
| `src/camera.js` | `ThirdPersonCamera` — mouse orbit (yaw/pitch), collision-aware distance (heightfield march + collider-circle sweep, **not** a mesh raycast — same perf reason as terrain), sway while moving. `getForward()`/`getRight()` are the shared convention player.js uses for WASD. |
| `src/player.js` | `Player` class — accel/decel movement, jump with coyote time + jump buffer, gravity, ground snap via `groundHeightAt`, prop collision + boundary clamp, mesh-facing turn, and the idle/walk/run hysteresis state machine (`classifySpeed`) feeding `character.setLocomotion`. |
| `src/ui.js` | `initUI()` — toggles the loading screen, click-to-play overlay, and boundary-warning opacity. All markup lives in `index.html`. |
| `src/main.js` | Entry point. Renderer/scene/camera setup (ACES tone mapping, exposure 1.1, sRGB output, `PCFSoftShadowMap`), async load sequence, the `renderer.setAnimationLoop` loop. Sets `window.__frames`/`__ready`/`__debug` for `smoke.mjs`. |

---

## Models — inventory

All three are **Quaternius, CC0 1.0**.

| File | Source model | Origin | KB | Meshes | Skins |
|---|---|---|---|---|---|
| `models/player.glb` | "Farmer" (Ultimate Modular Men Pack) | `poly.pizza/m/7pn3R6hPvE` | 1338 | 4 | 4 |
| `models/bandit.glb` | "Punk" (Ultimate Modular Men Pack) | `poly.pizza/m/BTALZymknF` | 1342 | 4 | 4 |
| `models/horse.glb` | "Horse" (Animated Animal Pack) | `poly.pizza/m/qvTrSG9pZF` | 1082 | 1 | 1 |

A fourth model, `anim-source-jump.glb` ("Man", Animated Men Pack, CC0), was
loaded purely to harvest a `Man_Jump` clip + skeleton for retargeting onto
`player.glb` — never rendered itself. Removed along with the whole
retargeted-jump-clip feature (see "Known rough edges"). **It was never
committed** — neither the GLB nor `src/retarget.js` appears anywhere in this
repo's history, so re-fetching the model and rewriting the code is the only
way back. `poly.pizza` is 403'd by this environment's egress proxy, so that
re-fetch is a human-side task too.

**`player.glb` swapped post-round-1 from "Worker" to "Farmer"** — the human
asked for something more appropriate for a western/horse game than a
hardhat-and-hi-vis construction worker. Verified before swapping: same
Quaternius "Ultimate Modular Men Pack" family, **identical 85-node skeleton**
(`Wrist.R`/`Hips`/`Chest` all present, same names) and **identical 24-clip
`CharacterArmature|`-prefixed animation set** as the old `player.glb` — this
was a same-rig reskin, not a new asset integration, so nothing downstream
(`findClip`, bone-name lookups, round 3's hand-bone gun attachment) needed to
change. Mesh names differ slightly (`Farmer_Feet/Pants/Body/Head` vs
`Worker_Feet/Legs/Body/Head`) but `enableShadows()`/`measureHeight()` both
traverse generically, not by name, so this doesn't matter. Considered
"Adventurer" (browns/greens, satchel, arguably reads more frontier/western)
as an alternative — same pack, same rig, also verified — human picked Farmer.
No genuinely cowboy-styled *rigged* CC0 model could be found anywhere
searched (poly.pizza, Quaternius, Kenney, itch.io): the only models literally
named "Cowboy"/"Cowgirl" (poly.pizza, by mastjie) are unrigged
(`"Animated": false`), and the one rigged-looking western-adjacent find
("Cops and Robbers") is CC-BY 3.0, not CC0, so it was correctly ruled out
per the CC0-only rule.

**Measured round 1 (world-space bounding box via `gltf-transform`'s
`getBounds`):**

- Old `player.glb` ("Worker") — height **1.866**. Not re-measured for
  "Farmer" since it doesn't matter: `character.js` rescales dynamically off
  `measureHeight()`'s live reading (now trustworthy — see the matrixWorld fix
  under "known rough edges"), never off a hardcoded number.
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

- **`Reload` → fake.** Bone rotation on `Wrist.R`/`LowerArm.R` — at runtime that's
  `getObjectByName('WristR')`/`('LowerArmR')`, dots stripped; see the gotcha in
  "Skeleton — bone names". *(Round 3 owns this.)*
- **`Mount`/`Dismount` → no clip.** Lerp position/rotation onto the saddle point over 0.4s. *(Round 2.)*
- **Mounted shooting → partial-skeleton blend** of `Idle_Gun_Shoot` over the riding pose. *(Round 3.)*
- **Duel draw** *(round 6)* — `Idle_Gun_Pointing`.

Nothing needs procedural recoil faking: `Gun_Shoot` is a real clip.

---

## Skeleton — bone names

**The right hand bone is `Wrist.R`.** Round 3 attaches the revolver to it; keep the
BUILD-PLAN.md names as fallbacks for a future model swap.

**GOTCHA, found post-round-1 while building the jump pose: those dotted names
are the *source-file* names, not what's queryable at runtime.** `GLTFLoader`
strips every dot from node names on load — `UpperArm.L` becomes `UpperArmL`,
`Wrist.R` becomes `WristR` — because a dot is the path separator inside an
`AnimationClip` track's target string (`"boneName.quaternion"`), so a dot
*inside* a bone name would be ambiguous there. Confirmed directly: loaded
`player.glb` fresh and traversed the resulting scene graph, printing every
node's `.name` — `root.getObjectByName('UpperArm.L')` returns `undefined`,
`root.getObjectByName('UpperArmL')` returns the bone. **Any future
`getObjectByName()` call against a loaded GLTF — round 3's `Wrist.R` gun
attachment included — needs the dot-less form**, even though this file (and
the BUILD-PLAN.md-era notes) write the dotted form everywhere, because that's
the form that shows up in a `gltf-transform`/Blender node dump, which is a
*different* naming stage than what `GLTFLoader` hands back at runtime.

Humanoid rig: `RootNode` → `CharacterArmature` → `Root` → `Body` → `Hips` →
`Abdomen` → `Torso` → `Chest` → `Neck` → `Head` (+ `Head_end`), arms as
`Shoulder.L/R` → `UpperArm.L/R` → `LowerArm.L/R` → `Wrist.L/R` (source names —
see gotcha above for the runtime, dot-less form). 85 nodes.
**4 separate skinned meshes** (`Farmer_Feet/Pants/Body/Head`) sharing one
armature — `enableShadows()` in `assets.js` already traverses and sets
`castShadow`/`receiveShadow` on all of them, not just the first.
(An earlier version of this line wrote the spine as `Root → Hips → Chest →
Head`, skipping `Body`/`Abdomen`/`Torso`/`Neck` — corrected here after
re-dumping the node list straight out of the GLB.)

**This is an IK rig baked flat on export — that is the single most important
structural fact about it.** Measured across all 24 clips in `player.glb`
(`@gltf-transform/core`, reading every animation channel's target node and
path):

| Bone | Parent | Animated by | Carries |
|---|---|---|---|
| `Body` | `Root` | **all 24 clips** | `translation` (all 24) + `rotation` (19) — this is the de-facto pelvis |
| `Hips` | `Body` | **zero clips** | nothing, ever — it is a dead pass-through bone on this rig |
| `Foot.L/R` | `Root` | 13 clips | `translation` **and** `rotation`, in `Root` space |
| `PT.L/R` | `Root` | 13 clips | `translation` (+ `rotation` in 3 clips) — Blender **pole targets** (knee direction), exported as real bones |
| `Abdomen` | `Hips` | 5 clips | `rotation` only (`Kick_*`, `Punch_*`, `Roll`) |

So `Root` has **five** direct children — `Body`, `Foot.L`, `Foot.R`, `PT.L`,
`PT.R` — and the legs' whole story is told by `Body.translation` plus
hand-placed feet, not by an FK hip→knee→ankle chain. Every external rig you
might import a clip from (Mixamo, Quaternius' other packs, anything) is a
plain FK chain with the vertical motion in `Hips.translation`. On this rig
that maps to **`Body`, not `Hips`** — writing it to `Hips` animates literally
nothing, because nothing downstream of `Hips` is a leg. See "Should we add a
jump clip…" under "Decisions made" for what this costs.

**THE LEG "CHAIN" IS NOT A CHAIN — read this before animating legs.** An
earlier version of this file said legs "hang off `UpperLeg.L/R` →
`LowerLeg.L/R` → `Foot.L/R`". That is wrong about the foot, and the mistake
cost two failed fixes. Measured directly (traversing the loaded rig and
printing `.parent.name`, then empirically rotating a bone and reading world
positions):

```
Body → UpperLegL → LowerLegL → LowerLegL_end
Root → FootL → FootL_end          ← the foot is its OWN top-level bone
Body → Hips → Abdomen → …         ← Hips is a SIBLING of UpperLeg, not its parent
```

Rotating `UpperLegL` by 57° moves `LowerLegL` **0.415 units** in world space
and moves `FootL` by **exactly 0.0**. Rotating `Hips` moves `UpperLegL` by
**exactly 0.0**. So:

- **Any clip that animates the legs must ALSO author `Foot.L/R` tracks —
  both `.position` and `.quaternion`.** The foot will not follow the shin,
  because it is not attached to it. `player.glb`'s own `Walk`/`Run`/`Idle`
  clips all author `FootL.position` *and* `FootL.quaternion` every frame
  (both verified `varying: true`) precisely because the animator had to
  place the foot by hand. A rotation-only track is not enough: the foot is
  positioned in `Root`'s space, so keeping it attached to a swinging shin
  requires moving it, not just turning it.
- **Leaving the foot un-animated does not leave it in a neutral pose** — it
  leaves it welded in place while the shin swings away, and the skin between
  them smears into a long curved "boomerang boot". This is a *skinning
  stretch*, not a rotation error, which is why it is so easy to misdiagnose
  (see "Known rough edges").
- A technique for exactly this problem (`addVirtualParentTracks()`: bake the
  tracks a bone would need to follow another bone as if it were its child)
  was built in `src/retarget.js` for the now-removed retargeted jump clip
  (see "Known rough edges") and deleted along with it. If a future round
  (round 4's bandit shares this exact skeleton) needs to animate the legs
  again — via retargeting or any other method that produces a `Foot.L/R`-
  driving clip — this problem will resurface.
  **CORRECTION, verified: that code is NOT in git history.** This file said
  twice that `src/retarget.js` was "sitting in git history, not lost". It
  isn't. `git log --all --pretty=format: --name-only | sort -u` lists every
  path this repo has ever tracked, and neither `src/retarget.js` nor
  `models/anim-source-jump.glb` is among them — the whole retarget effort
  lived and died inside one uncommitted session, and the human's `50df173
  "Pre-jump addition"` commit captured only the *post-removal* end state.
  **Reviving it means rewriting it from scratch, not `git show`-ing it.**
  Budget accordingly, and don't promise a future round a fallback that
  doesn't exist.
- `Hips` being a sibling of the legs is a latent version of the same trap.
  It happened not to bite on the removed jump clip (measured at the time:
  `Hips` rotated **0°** and `Abdomen` **0°** across that clip, `Torso` only
  3.5°), so it was deliberately left alone rather than destabilise
  verified-good leg motion. **A future clip that genuinely rotates the
  pelvis will need the same follow-the-parent treatment on `UpperLegL/R` →
  `Hips` too.** Measure before assuming it's fine.

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
- **"Should we add a jump clip from the Quaternius pack or from Mixamo?" —
  investigated, answer: neither, not as a single imported clip.** Findings,
  all measured rather than recalled:
  - **The Quaternius option does not exist.** `player.glb`'s pack (Ultimate
    Modular Men Pack) ships **exactly the 24 clips we already have** — the
    poly.pizza export is the whole set, not a subset, so there is no unused
    `Jump` hiding in the upstream download. "A jump from Quaternius"
    therefore means *a different Quaternius pack*, i.e. a different
    skeleton, i.e. the exact cross-rig retarget that was already built,
    tuned, and rejected (that's what `anim-source-jump.glb` was).
  - **Mixamo is a better source but the same trap.** Its rig is a
    conventional FK chain (`mixamorig:Hips → UpLeg → Leg → Foot`) with the
    jump's whole vertical lift in `Hips.translation`. This rig has no such
    chain: the feet are `Root`-space siblings and **`Hips` is animated by
    zero of the 24 clips** (see the IK-bake table under "Skeleton — bone
    names"). So a Mixamo clip needs the same hip-remap + synthesised
    `Foot.L/R` translation tracks that the Quaternius one did. **The
    difficulty was never the source clip — it is the target rig**, and it is
    identical for both.
  - **The one Mixamo play that is actually worth it is not a jump clip.**
    Re-rig the Farmer mesh through Mixamo's auto-rigger and take the *whole*
    animation set on the Mixamo skeleton as a new `player.glb`. Then there
    is no retargeting anywhere, and it also closes the **`Reload` gap that
    round 3 genuinely has** (see the animation-gap table). Costs: an Adobe
    login + Blender (Mixamo exports FBX/Collada, never glTF), the repo stops
    being 100% CC0 (Mixamo is royalty-free but forbids redistributing raw
    character/animation files as standalone assets — committing the GLB to a
    public repo is a grey area worth the human's own read), and `bandit.glb`
    should be swapped with it or the two humanoids stop sharing a rig, which
    round 4 currently assumes. **BUILD-PLAN.md's appendix explicitly sanctions
    this as a ~40-minute manual human task** — it is not a rule violation,
    but it is not a thing Claude can do unattended either.
  - **Not doable in this environment regardless**: `poly.pizza`,
    `quaternius.com`, `mixamo.com` and `helpx.adobe.com` are all 403'd by the
    session's egress proxy (org policy, not a transient failure), and there
    is no Blender or FBX toolchain installed. Any asset acquisition here is a
    human-side task.
  - **Recommendation**: leave `ANIM.airTimeScale` as the jump. If the pose
    bothers the human in play, the cheap next attempt is a stylised jump
    authored *in this rig's own idiom* — `Body.translation` + explicit
    `Foot.L/R` `translation`+`rotation` in `Root` space, optionally sampled
    from `Roll` (1.33s, 58 channels, the only full-body airborne-ish clip on
    the correct skeleton, feet included) via `AnimationUtils.subclip` — which
    needs no second GLB, no licence question and no retarget code at all.
    Note the earlier procedural leg-tuck attempt almost certainly failed for
    this exact reason: rotating leg bones without writing `Foot.*`
    translation produces the boomerang-boot smear, not a tuck. **And if a
    Mixamo trip happens anyway, do it once, for the whole set, before round
    3 — not now, for a jump.**

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
  every frame. `window.__debug`'s shape has grown across this round's fixes —
  current fields: `modelsLoaded:{player}`, `playerY`, `grounded`, `propCounts`,
  `scene`/`tpCamera`/`player` (live object refs, see below), `characterScale`,
  `characterWorldBBoxHeight`, `playerPos`, `cameraPos`,
  `cameraDistanceToPlayer`, `cameraCurrentDistance`, `cameraFov`,
  `characterRotationY`. (`jumpClipLoaded`/`jumping` existed for one round
  while there was a retargeted jump clip to report on — removed along with
  the feature, see "Known rough edges".) Extend it, don't replace it, when a
  later round adds its own machine-checkable state — and if you add a field
  here, update this list, it's already fallen out of sync with `main.js`
  once this round.

---

## Known rough edges and deliberate shortcuts

- **Fixed post-round-1, the real one: the player character was rendering at
  ~5cm tall.** Two rounds of screenshots from the human both showed no visible
  character in the third-person view. First pass (grass near-black, no
  player-keepout on grass) turned out to be a real but minor issue — fixed,
  see below — but didn't explain the missing character. Chased it with direct
  in-browser diagnostics (Playwright scripts dumping live `Box3`/matrix state,
  not guessing) and found the actual cause: `assets.js`'s `measureHeight()`
  called `Box3().setFromObject()` on a **freshly-loaded GLTF scene that had
  never been added to a `Scene` or rendered** — its `matrixWorld` chain was
  stale, and `Box3.setFromObject`'s own internal per-node updates aren't
  sufficient to fix that for this rig's shape (13 `SkinnedMesh` primitives —
  see below — under sibling armature/mesh branches, one of them carrying a
  baked 90° corrective rotation). Measured directly: without an explicit
  update this returned **63.8** for `player.glb` instead of the correct
  **~1.83**. `character.js` then computed `scale = 1.85 / 63.8 ≈ 0.029`
  instead of `≈ 0.99`, rendering the player at roughly 5cm tall — invisible
  from the normal ~5-unit third-person camera distance. The "verification"
  reading I did after the first fix attempt used the *same* buggy method and
  falsely confirmed 1.85m — a broken ruler agreeing with itself twice is not
  a working ruler. **Fix**: `measureHeight()` now calls
  `object3D.updateMatrixWorld(true)` before measuring (`src/assets.js`).
  Re-verified end to end: `characterScale` is now `1.009`,
  `characterWorldBBoxHeight` is a truthfully-correct `1.85`. Added a smoke
  check (`scripts/smoke.mjs`, "player character rendered at a plausible human
  scale") asserting `characterScale` stays within `[0.3, 3]` so this exact
  class of bug can't silently recur. **If any future round loads another GLB
  and measures it (bandit, horse — round 2/4), route it through this same
  `measureHeight()`, don't reimplement bounding-box measurement.**
- **Also fixed: grass rendered near-black, and had no player keep-out.**
  Real, minor issues found from the same screenshots, not the cause of the
  missing character above, but worth keeping fixed:
  - Grass blades are flat single-triangle cards. A blade whose face normal
    points away from the sun gets zero direct light, and relied on the
    hemisphere light alone — which read as near-black in practice. Fixed with
    `GRASS.ambientFloor` (0.16), a small constant `emissive` on the grass
    material (`grass.js`'s `buildGrass`), plus lightened
    `COLORS.grassRoot`/`grassTip`.
  - Grass had no keep-out around the player's own (continuously-updating)
    position, so it could spawn right on top of/immediately behind the
    character. Fixed with `GRASS.playerKeepOut` (1.4 units) in
    `recenterGrass()`. Verified programmatically (module-level test against a
    fake scene), not visually.
  Neither of these has been visually re-confirmed after the character-scale
  fix above — the human should check both on the next look, since a correctly
  sized character standing in grass is a genuinely different scene than what
  either screenshot showed.
- **Correction to an earlier note in this file: screenshots ARE possible, just
  not through the Browser-preview tool.** The Browser-preview MCP pane's
  `computer{action:"screenshot"}` still fails with "the Browser pane is not
  displayed, so the page is not compositing frames" in this environment — but
  a **plain Playwright script** (same pattern as `scripts/smoke.mjs`: launch
  chromium headless, serve the folder over `node:http`, `page.goto`, wait for
  `window.__ready`) works fine and `page.screenshot({path: ...})` produces a
  real PNG you can then open with the Read tool. This is how the sun-shader
  and mesh-facing bugs below were actually *seen*, not just reasoned about.
  Write throwaway scripts for this (`scripts/_shot-something.mjs`), delete
  them when done — don't leave one-off screenshot scripts committed. For
  camera control during a screenshot, `main.js` exposes three debug hooks on
  `window.__debug`, all live object references, not snapshots:
  `tpCamera` (set `.yaw`/`.pitch`/`.currentDistance` directly, bypassing
  mouse-look — but note `.snap(pos)` **recalculates `.currentDistance` itself**
  via occlusion checks and will clobber a value you just set, so set position
  fields, don't rely on `snap()` preserving a chosen distance), `player`
  (`.position` is a live `Vector3` you can teleport by mutating in place),
  and `scene` (traverse it to find object world positions — e.g. an
  `InstancedMesh`'s per-instance matrix via `getMatrixAt(i, m)` — when you
  need to frame something specific rather than whatever's near spawn). Also:
  the camera direction math is `dirX=sin(yaw)cosPitch, dirY=sin(pitch),
  dirZ=cos(yaw)cosPitch` for the **camera's position offset from the pivot**,
  and the camera **views in the opposite direction**, `-(dirX,dirY,dirZ)` —
  to aim at a target, compute `viewDir = normalize(target - eye)` then
  `pitch = asin(-viewDir.y)`, `yaw = atan2(-viewDir.x, -viewDir.z)`. Got this
  backwards twice this session before landing on it — write it down instead
  of re-deriving it next time.
- **Fixed: the sky's sun rendered as a jagged, non-circular blob instead of a
  clean disc.** Confirmed visually (see above — this is the first round a
  screenshot pipeline actually existed) by pointing the debug camera straight
  at the sun direction: before the fix the disc had a pointed, star-like,
  asymmetric edge; after, a clean circle with a soft halo. Root cause in
  `sky.js`'s fragment shader: `vWorldDir` is a per-vertex unit vector,
  interpolated *linearly* across each triangle by the rasterizer before the
  fragment shader ever sees it — linear interpolation of unit vectors does
  not preserve unit length, so the interpolated value shrinks away from 1.0
  toward the middle of large triangles. The sky dome is coarse (32×20
  segments), so this shrinkage is real, and `sunDiscPower` (340) amplifies
  even a tiny dot-product error enormously (`pow(x, 340)` is extremely
  sensitive near `x=1`). Measured directly with a small standalone vector-math
  script: at the midpoint of a typical triangle edge nearest the sun, the
  un-normalized dot product gave a sun-term of `0.122` vs. the correct
  `0.350` — a 3x error, and the error is non-monotonic across the dome's
  triangulation, which is exactly what produces a blotchy/pointed shape
  instead of a smooth circular falloff. **Fix**: `normalize(vWorldDir)` once
  at the top of the fragment shader (`src/sky.js`), used for both the sun
  terms and the horizon/haze gradient (`h = dir.y`). The gradient terms use
  much lower powers (2.6, 3.4) so they were far less visibly affected, but
  there was no reason to leave them on the same unnormalized quantity.
- **Fixed: a second, older mesh-facing bug, independent of the model swap.**
  After swapping to Farmer, the character still faced the camera even with
  `PLAYER.meshYawOffset` correctly set to `Math.PI`. Root cause was in
  `player.js`, present since round 1: the constructor correctly set
  `character.root.rotation.y = this.meshYaw + PLAYER.meshYawOffset`, but the
  **per-frame update()** at the bottom of the file set
  `character.root.rotation.y = this.meshYaw` — no offset — and since
  `update()` runs from frame 1 onward, it overwrote the constructor's correct
  value almost immediately. The offset only ever "worked" because the
  movement-turning code (`targetYaw = atan2(...) + PLAYER.meshYawOffset`)
  baked the offset *into* `meshYaw` itself the first time the player moved —
  so the bug was invisible during normal play (you're always in motion by
  the time you look) but very visible at spawn or right after any respawn
  (`meshYaw` resets to the un-offset `SPAWN.yaw` there too). **Fix**: made
  `meshYaw` consistently a *pure logical facing angle* with no offset baked
  in anywhere (removed the offset from the `targetYaw` calculation), and
  apply `PLAYER.meshYawOffset` using one consistent formula everywhere (both the
  constructor and the per-frame transform use the identical
  `this.meshYaw + PLAYER.meshYawOffset` formula now, so it can never be
  applied zero or two times depending on movement state). Confirmed via
  screenshot: the character now shows its back at the default spawn camera
  position, front at 180° around, matching third-person convention.
- **Fixed: rocks rendered as shattered/exploded fragments instead of lumpy
  solids — two separate bugs, found in two passes.** Confirmed from a real
  screenshot — rocks looked like a jumbled pile of disconnected, floating
  triangle shards, not the intended "lumpy `IcosahedronGeometry`" look.
  - **Bug 1 (the dramatic one).** `IcosahedronGeometry` (like all three.js
    Platonic-solid geometries) is **non-indexed** — a corner shared by
    several triangles is stored as separate duplicate position entries, one
    per triangle. The lump-displacement loop in `makeRockGeometry()` called
    `rng()` independently **per buffer entry**, so duplicate copies of what
    should be the same shared corner got different random offsets and moved
    apart — tearing the mesh open at every seam. Fixed with `mergeVertices()`
    before the displacement loop, collapsing coincident positions into one
    indexed vertex so every real corner moves exactly once.
  - **Bug 2 (the subtle one, found because the human looked again after the
    first fix and said "some rocks are still weird").** After bug 1's fix,
    most rocks looked right, but *every single rock* still had one small,
    consistently-placed dark notch — same rough location regardless of seed
    or lumpiness, which is the tell that this isn't random bad luck, it's
    structural. Measured directly: `mergeVertices()` compares **all**
    attributes together, not just position, and `IcosahedronGeometry` has a
    UV seam where position-identical vertices carry *different* UV
    coordinates (needed for texture-coordinate wrapping around the sphere).
    Because the UVs differ, those seam vertices never merge — confirmed by
    counting: 57 vertices where the correct count is 42, with 12 defective
    **degree-2** vertices (a proper closed-mesh vertex needs degree ≥3). One
    of those low-degree seam vertices is always the topmost point, and
    displacing a degree-2 vertex reliably folds into a visible notch no
    matter what random value it gets — which is why turning lumpiness down
    didn't help (tested 4 lumpiness levels × 6 seeds; the notch was in all
    24). This material has no texture map (`rockMat` is a flat color, no
    `map`), so the UV attribute is dead weight — `raw.deleteAttribute('uv')`
    before `mergeVertices()` lets the seam actually collapse. Re-verified:
    42 vertices, clean degree-5/6 distribution only, and the same
    3-lumpiness × 6-seed grid (18 rocks) came back completely clean, no
    notches anywhere.
  Both bugs reproduced and fixed in isolation (standalone scripts with the
  exact same seed/params as the real config, `props.js` untouched during
  testing) before being applied to the real file — screenshots sent to the
  human as proof at each stage. **Cacti and dead trees were never at risk of
  either bug** — they're rigid `CylinderGeometry` pieces glued together with
  `mergeGeometries`, no per-vertex random displacement and no meaningful UV
  seam duplication for this use. Not added to `smoke.mjs` — these are
  shape/topology defects, not something a scalar debug field can catch; the
  isolated repro scripts were the regression tests, all thrown away after
  use, not committed. **If a future round adds another randomly-displaced
  non-indexed geometry** (Platonic solids: Icosahedron/Octahedron/
  Tetrahedron/Dodecahedron all default to non-indexed): `mergeVertices()`
  before displacing, not after — **and if the material has no texture map,
  delete the `uv` attribute first**, or the UV seam will silently defeat the
  merge and leave the exact same structural notch.
- **Fixed: player could walk visibly into large rocks.** A third rock bug,
  found by the human after the two shape fixes above — "I can still walk
  into rocks," with a screenshot showing the character overlapping a big
  rock's visible surface. This one was a pure tuning mismatch, not a shape
  bug: `PROPS.rock.colliderFactor` was a single value, `0.8`, smaller than
  even the rock's *unbumped* base radius (`IcosahedronGeometry(1, detail)`
  has radius exactly `1.0`), before any lumpiness bulging outward is
  considered. Measured directly (max XZ vertex radius across 40 generated
  samples per lumpiness variant, matching `props.js`'s `rockGeos` order —
  base/×0.7/×1.3): **1.34 / 1.24 / 1.44** — the old `0.8` collider was
  undersized by up to `0.64 × scale`, which for a large rock (`maxScale`
  3.2) is over 2 world units of walkable visual overlap, more than the
  player's own diameter. **Fix**: replaced the single `colliderFactor` with
  `colliderFactors`, an array with one value per geometry variant (`[1.38,
  1.28, 1.48]` — the measured maximums plus a small safety margin), and
  `scatterInstanced()` in `props.js` now indexes into it the same way it
  indexes `geometries` (`i % geometries.length`), instead of applying one
  shared factor to every variant regardless of its actual lumpiness. Kept
  backward compatible: `colliderRadius` in `scatterInstanced` still accepts
  a plain scalar too (cactus/tree pass one, since they're rigid
  `CylinderGeometry` shapes with near-identical footprint regardless of
  variant — no mismatch to fix there). Verified two ways: (1) a script that
  calls `resolveCollisions` in a loop exactly like `player.js`'s real
  per-frame flow, walking a simulated player toward a real placed rock
  instance — confirmed it stops at exactly `colliderRadius + playerRadius`
  from the rock's center, and that the resolved collider radius divided by
  the rock's instance scale equals the expected per-variant factor (1.38 for
  that instance); (2) a screenshot from that stopped position showing clean
  separation, no overlap. Added a `smoke.mjs` check (`colliderFactors` must
  all be ≥1.2) as a cheap regression floor — it doesn't reproduce the full
  geometry measurement, but it catches "someone changed this back to a
  single undersized number" cheaply.
- **Fixed post-round-1: "click to play" did nothing.** `input.js` bound the
  pointer-lock click listener to `canvas` only, but `#clickToPlay` sits on top
  of the canvas in paint order (later in the DOM) with `pointer-events: auto`
  in `index.html`'s CSS — so the overlay, not the canvas, received every click,
  and `canvas.requestPointerLock()` was never called. Fixed by binding the
  listener to `document` instead, so it fires regardless of which element (the
  overlay or the canvas underneath it) the click actually landed on. Verified
  the routing via a synthetic `.click()` in a live page: it now correctly
  attempts `requestPointerLock()` and gets a `pointerlockerror` back (expected —
  synthetic clicks aren't a trusted user gesture; a real mouse click will lock
  normally). **If any future round adds more overlay UI that should intercept
  clicks without triggering pointer lock** (a pause menu button, say), this
  document-level listener will need a guard (e.g. check `e.target` isn't
  inside that UI) — it currently assumes any click anywhere means "start
  playing."
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
- **Fixed post-round-1: player mesh faced the camera instead of away from
  it.** Confirmed from a real screenshot — the character was walking/facing
  backwards relative to its movement direction. This was the exact
  `PLAYER.meshYawOffset` escape hatch flagged (but untested) at the end of
  round 1. Set to `Math.PI` in `config.js`; both call sites that apply it
  (`player.js`'s constructor spawn-facing line and the movement-direction
  `targetYaw` calculation) add the same constant, so this flips the mesh
  consistently everywhere, not just on spawn. Not re-verified visually (see
  "I cannot get a screenshot" above) but the math is unambiguous here — no
  further lever if it's somehow still wrong, just double-check the sign.
- **Removed post-round-1: the real retargeted jump clip, after extensive
  work, never read as right — pulled out entirely rather than shipped
  broken.** Long history, condensed (this summary is the *only* surviving
  record — the work was never committed, see the correction under "Skeleton —
  bone names"): round 1 shipped airborne as
  just holding the last locomotion clip at a slowed `timeScale`
  (`ANIM.airTimeScale`). A procedural hand-tuned leg-tuck overlay replaced
  that, then was itself replaced by a genuinely real motion-authored clip
  (`Man_Jump`, Quaternius "Animated Men Pack", CC0), retargeted at load time
  from that separate GLB's skeleton onto `player.glb`'s own via a new
  `src/retarget.js` (local-space delta-from-rest quaternion retargeting,
  plus same-skeleton "follower" techniques for bones the cross-skeleton
  retarget distorted).
  - Verifying it "looked right" failed repeatedly in ways worth remembering
    for any future animation work: a 6-point sample missed a real hooked-
    ankle bug that only showed up across ~30-70% of the clip from a true
    side view; two rounds of "fixed" reports turned out to have changed
    nothing because the actual bug was the feet (separate top-level bones
    on this rig, not attached to the legs — still true, see "Skeleton — bone
    names" below) never being driven at all, a *skinning smear* that looks
    like a rotation bug and isn't one; a "fixed" verification pass once
    nearly reported a false regression that was actually a test script
    bypassing the game's own crossfade logic. Each time, the fix that
    actually worked came from measuring the live rig directly (dumping the
    real parent hierarchy, rotating a bone and reading world positions)
    rather than trusting notes or a prior diagnosis.
  - Even after every distortion/smear bug was genuinely fixed and verified
    through the real Space-triggered gameplay path, further tuning passes
    (softer knee bend, softer hip swing, slower clip playback for a less
    "abrupt" feel) still didn't land — the human's final verdict was "this
    is not working at all." **Decision: remove the feature.**
    `character.js` no longer loads a second GLB or constructs a `jump`
    action; `setAirborne()` is a no-op on the real rig. Airborne motion is
    now, again, just whatever locomotion clip was already playing, held and
    slowed via `ANIM.airTimeScale` — not dynamic, but not broken either.
    `src/retarget.js` and `models/anim-source-jump.glb` were deleted (their
    only purpose was this feature); `ANIM_SOURCE`/`HIP_FOLLOW`/`KNEE_FOLLOW`/
    `ANIM.jumpTimeScale` were removed from `config.js`.
  - **If this is ever revisited**: the technique (delta-from-rest
    retargeting + same-skeleton follower bends for bones whose
    cross-skeleton retarget distorts + `addVirtualParentTracks` for
    detached bones like this rig's feet) is sound and well-verified — but
    **it must be rewritten from scratch; it is NOT recoverable from git**
    (verified — see the correction under "Skeleton — bone names"; an earlier
    version of this bullet said otherwise and was wrong). What was missing
    wasn't correctness, it was ever
    actually reading as good motion to a human watching it in real play,
    across several honest tuning attempts. A different source clip, or
    accepting a simpler/more stylized jump pose instead of chasing
    photorealistic motion capture, are both more promising directions than
    another round of retarget-parameter tuning.
- **Fixed: `node scripts/smoke.mjs` couldn't pass in an egress-restricted
  session because the page itself was offline-hostile — three.js is now
  vendored into the repo instead of loaded from a CDN.** `index.html`'s
  import map used to pull three.js and its addons from `cdn.jsdelivr.net`,
  and that host (like `poly.pizza`/`quaternius.com`/`mixamo.com`) is 403'd by
  some sessions' egress proxy — every module import failed, the render loop
  never started, and every round-1 `__debug` check reported `undefined`.
  Routing chromium through `HTTPS_PROXY` didn't help, since the proxy itself
  was what denied the host. **Fix**: `npm pack three@0.160.0` (npm's registry
  is allow-listed even where jsdelivr isn't) and copied only the four files
  the codebase actually imports into `vendor/three/` — `build/three.module.js`,
  `examples/jsm/loaders/GLTFLoader.js`, `examples/jsm/utils/BufferGeometryUtils.js`,
  and `LICENSE` (MIT). Checked both addon files' own `import` lines first:
  neither pulls in DRACOLoader, MeshoptDecoder, or any other addon beyond
  `three` itself and each other, so nothing more needed vendoring.
  `index.html`'s import map now points `"three"` and `"three/addons/"` at
  `/vendor/three/...` instead of the CDN. **1.4MB added to the repo** — worth
  it since this is the actual game dependency, not a dev-only tool.
  `scripts/smoke.mjs`'s static file server already served anything under
  `ROOT`, so no server change was needed — only the import map. Re-verified
  end to end: `node scripts/smoke.mjs` now reports **`smoke PASSED`**, all 8
  round-1 checks green, fully offline, no CDN reachability required. (Also
  fixed in the same pass, unrelated but blocking a clean run: `index.html`
  had no `<link rel="icon">`, so Chromium's automatic `/favicon.ico` request
  404'd and tripped smoke's "any 4xx" rule — added a trivial inline
  `data:image/svg+xml` favicon rather than a binary asset file.) **If a
  future round adds another `three/addons/...` import** (OrbitControls,
  DRACOLoader, anything), it needs the same treatment: check its own import
  lines for further addon dependencies, copy the whole chain into
  `vendor/three/examples/jsm/...` preserving the relative path layout (the
  addons import each other by relative path, e.g. `../utils/...`), and it'll
  resolve automatically through the existing `three/addons/` map entry — no
  `index.html` change needed unless the addon needs something outside
  `examples/jsm/`.
  Bumping the three.js version later means re-running the same `npm pack`
  step and re-copying these same files, not a version-string edit anywhere
  — there's no `package.json` dependency on three.js, only the vendored copy
  and the import map pointing at it.
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
- **Camera's `lookAt` is recomputed instantly from a damped position every
  frame**, not itself damped. Not visually confirmed, but the math says this
  could look slightly swimmy for one or two frames right after a big
  obstruction-triggered zoom-in. Minor; revisit only if it's noticeable in
  person.

---

## What the next round (2 — the horse) should watch out for

1. **`horse.glb`'s rest-pose bounding box is 4.8m tall, 5.7m long — not
   horse-sized.** See "Models — inventory" above. That number came from
   `gltf-transform`'s static analysis and is unrelated to the
   `measureHeight()` matrixWorld bug fixed this round (see "known rough
   edges") — `measureHeight()` is now trustworthy (verified: gives 1.83–1.85
   for `player.glb`, matching reality), so if the horse still measures ~4.8m
   through it, that's a genuine property of the asset's rest pose, not a
   measurement bug. Investigate why (posed rest frame?) before picking a
   scale factor, or sanity-check against a known real-world horse height
   (~1.6m at the withers) and hardcode+comment the scale in `config.js` if
   the bounding box keeps lying.
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
