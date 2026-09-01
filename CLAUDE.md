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
| 3 — guns | not started | |
| 4 — bandits | not started | |
| 5 — town | not started | |
| 6 — bounties, duels, wanted | not started | |
| 7 — polish | not started | |

**Next round: 3 — guns.** Read [`docs/ROADMAP.md`](docs/ROADMAP.md) before you
start; it has 13 specific things this codebase will do to you, including the
fact that Space is already bound to the horse jump and that the riding pose
owns the arms every frame.

---

## File map

One line per file. Long form in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

| File | What's in it |
|---|---|
| `index.html` | Import map (→ `/vendor/three/`, not a CDN), overlay markup, CSS, data-URI favicon. Boots `/src/main.js`. |
| `vendor/three/` | three.js **0.160.0**, vendored as committed files: the 3 modules we import, plus `LICENSE`. |
| `src/main.js` | Entry point. Renderer/scene setup, load sequence, the animation loop, `window.__debug`. **Frame order is load-bearing** — see below. |
| `src/config.js` | Every tunable except the horse's. |
| `src/config-horse.js` | Every horse tunable: `HORSE`, `HORSE_ANIM`, `RIDING_POSE`, `TACK`, `PLACEHOLDER_HORSE`, clip candidates. |
| `src/noise.js` | Seeded PRNG + simplex + fbm + smoothstep. No internal deps. |
| `src/terrain.js` | `heightAt` / `normalAt` / `buildTerrain` / `groundHeightAt`. |
| `src/sky.js` | Sky dome shader, sun + hemisphere light, fog, shadow follow. |
| `src/props.js` | Rocks, cacti, dead trees as `InstancedMesh`; registers a collider (with `top` and `meta.kind`) per placement. |
| `src/grass.js` | Player-following instanced grass pool. |
| `src/world.js` | Orchestrator only, ~35 lines. |
| `src/collision.js` | The one collider array + `resolveCollisions(pos, radius, ignore, clearY)`. |
| `src/assets.js` | `loadGLTF`, `findClip`, `measureHeight`, `enableShadows`. |
| `src/character.js` | `createPlayerCharacter()` — `player.glb` + locomotion + the riding pose. |
| `src/horse-character.js` | `createHorseCharacter()` — `horse.glb` + locomotion + the one-shot jump clip. |
| `src/placeholder-human.js` | Procedural fallback rig for the player. |
| `src/placeholder-horse.js` | Procedural fallback rig for the horse. |
| `src/player.js` | Movement, jump, gravity, grounding, collision, locomotion state — plus the mounted branch. |
| `src/horse.js` | Everything **horizontal**: AI, steering, lean, stamina, collider, mount toggle. |
| `src/horse-jump.js` | Everything **vertical**: the arc, the pitch, `clearance()`. |
| `src/horse-seat.js` | Where the rider sits: spine sampling (`bob`/`sway`/`drift`), the banked seat point. |
| `src/riding-pose.js` | The hand-authored seated pose, bone by bone. Also the finger-grip axes. |
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

## Before writing or changing a test

Read [`docs/TESTING.md`](docs/TESTING.md). Three harness gotchas produce
measurements you cannot trust: `page.waitForFunction()` with an **async**
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
- **No wind on the grass** (round 7), **no audio at all** (round 3 onward),
  **no saddle/stirrup geometry** — the rider's boots hang where stirrups would
  be, holding nothing.
- **Mouse-look orbit direction** was derived analytically and never watched.
  If inverted, it's one sign flip in `camera.js`'s `handleLook()`.
- **Grass colour and keep-out fixes have not been visually re-confirmed**
  since the character-scale fix — a correctly sized character standing in
  grass is a different scene than the screenshots that prompted them.
- **`resolveBox` has no caller yet** (round 5's buildings will be the first).

---

## Ending a round

Before you declare a round done:

1. `node scripts/smoke.mjs` — and extend its `CHECKS` with whatever this round
   made machine-checkable.
2. **Update the docs.** New detail goes in the matching `docs/` file; this file
   gets at most a line. Update the rounds table, the file map if files changed,
   and the open-rough-edges list. A fact belongs *here* only if it is unsafe to
   open a file without it — everything else belongs in `docs/`.
3. Add the new manual items to `SMOKE-TEST.md` (never delete a line), print
   them at the end of the round, and say plainly that they are the human's to
   verify.
4. `git add -A && git commit -m "round N: ..." && git tag round-N`.

Then stop. Do not begin the next round.
