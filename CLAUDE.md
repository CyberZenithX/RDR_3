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
| 1 — world and player | not started | |
| 2 — horse | not started | |
| 3 — guns | not started | |
| 4 — bandits | not started | |
| 5 — town | not started | |
| 6 — bounties, duels, wanted | not started | |
| 7 — polish | not started | |

**Round 0 ended on a decision point for the human** (Mixamo or not). See
"Animation gap" below — the answer came back *good enough, no Mixamo needed*.

---

## File map

One line per file. Read only what the round needs.

| File | What's in it |
|---|---|
| `index.html` | Import map (three 0.160.0 from jsdelivr) + a **placeholder** round-0 boot page with an inline module. **Round 1 replaces the inline script with `<script type="module" src="/src/main.js">`.** |
| `BUILD-PLAN.md` | The spec. Read every round. |
| `CLAUDE.md` | This file. |
| `SMOKE-TEST.md` | Manual checklist for the human. Grow it every round, never delete a line. |
| `scripts/verify-models.mjs` | Prints size / mesh / skin / clip-name report for every `models/*.glb`. Run after touching models. |
| `scripts/smoke.mjs` | Headless check. Serves the folder on :8917, loads it in chromium, fails on any console error, uncaught exception, 4xx/failed request, or a render loop that never started. Has a `CHECKS` array — **add to it every round**. |
| `.claude/commands/round.md` | `/round N` slash command. |
| `models/` | `player.glb`, `bandit.glb`, `horse.glb`. See inventory below. |
| `audio/` | **Empty.** Round 3 fetches `gunshot.ogg`, `reload.ogg`, `hit.ogg`; round 7 fetches the rest. |
| `src/` | **Empty.** Round 1 creates `config.js`, `main.js`, `world.js`, `player.js`, `camera.js` per the layout in BUILD-PLAN.md. |

Not yet created (round 1 owns them): `src/config.js` and everything else under `src/`.

---

## Models — inventory

All three are **Quaternius, CC0 1.0**, pulled from poly.pizza.

| File | Source model | Origin | KB | Meshes | Skins |
|---|---|---|---|---|---|
| `models/player.glb` | "Worker" (Ultimate Modular Men Pack) | `poly.pizza/m/Yg2bQZO6Hj` | 1313 | 4 | 4 |
| `models/bandit.glb` | "Punk" (Ultimate Modular Men Pack) | `poly.pizza/m/BTALZymknF` | 1342 | 4 | 4 |
| `models/horse.glb` | "Horse" (Animated Animal Pack) | `poly.pizza/m/qvTrSG9pZF` | 1082 | 1 | 1 |

Poly.pizza serves the raw file at `https://static.poly.pizza/<ResourceID>.glb`, where
`ResourceID` comes out of the `window.__SERVER_APP_STATE__` JSON blob on the model
page. There is no `.glb` link in the page HTML — that is why a naive scrape finds
nothing. Recorded here so a later round can re-fetch or grab more props the same way.

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
   fall back to case-insensitive substring if that misses. Straight substring
   matching, as written naively, silently gives you `Run_Back` for `Run`.
3. **Every horse clip is duplicated.** Deduplicate by the name after `|` or you can
   end up with two mixer actions fighting over the same skeleton.

### findClip contract (per BUILD-PLAN.md)

`findClip(gltf, ...candidates)` — for each candidate in order: exact match on the
post-`|` segment (case-insensitive), then substring. **Return `null` if nothing
matches. Never fall back to the first clip.** Log one warning per missing clip at
startup.

---

## Animation gap — what's missing and what to fake

The pack is **much richer than BUILD-PLAN.md assumed**. Of the clips rounds 1–7
need, exactly one is missing across all three models.

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

**Substitutions to implement (record any change here when you build it):**

- **`Reload` → fake.** Per BUILD-PLAN.md: dip the gun below frame with a bone
  rotation on `Wrist.R` / `LowerArm.R` for `reloadTime`, then ease back. Keep the
  `Idle_Gun` clip playing underneath. *(Round 3 owns this.)*
- **`Mount` / `Dismount` → no clip.** Lerp the player's position and rotation onto
  the saddle point over 0.4s. *(Round 2 owns this.)*
- **Mounted shooting → partial-skeleton blend.** No mounted-shoot clip exists.
  Blend `Idle_Gun_Shoot` spine-up over the riding pose, hips-down from the seated
  pose. *(Round 3 owns this — BUILD-PLAN.md says this is not optional.)*
- **Duel draw** *(round 6)* — `Idle_Gun_Pointing` reads as a draw-and-level. Use it.

Nothing here needs procedural recoil faking: **`Gun_Shoot` is a real clip.** Do not
write bone-rotation recoil for the shot itself and then wonder why it double-kicks.

---

## Skeleton — bone names

**The right hand bone is `Wrist.R`.** None of the names BUILD-PLAN.md lists
(`mixamorigRightHand`, `RightHand`, `hand_r`, `Hand.R`, `Bip01_R_Hand`) exist in
this rig. Round 3 attaches the revolver to `Wrist.R`; add it to the front of the
candidate list and keep the others as fallbacks for a future model swap.

Humanoid rig, useful nodes: `RootNode` → `CharacterArmature` → `Root` → `Hips` →
`Chest` → `Head` (+ `Head_end`), arms as `UpperArm.L/R` → `LowerArm.L/R` →
`Wrist.L/R`. 85 nodes total.

Horse rig: `RootNode` → `AnimalArmature`, with `Head`. 68 nodes. No hand/wrist
bones, obviously — the saddle point will have to be a hand-tuned offset from the
horse root, exposed in `config.js`.

**The humanoids are 4 separate skinned meshes** (`Worker_Feet`, `Worker_Legs`,
`Worker_Body`, `Worker_Head`) sharing one armature — hence `skins: 4`. Anything that
traverses for a `SkinnedMesh` and stops at the first one will only get the feet. Set
`castShadow` on all four. Same structure on the bandit.

Materials are flat named colours (`Skin`, `Brown`, `Worker_Vest`, …), no textures.
Recolouring the bandit is a one-line material tweak if the two need to read
differently at distance.

---

## Decisions made, and why

- **poly.pizza over the Khronos sample assets.** Khronos models are CC0 and rigged
  but carry one or two clips each; the Quaternius packs carry 24 including
  `Gun_Shoot` and `Death`. The whole point of round 0 was the combat clips.
- **"Worker" as player, "Punk" as bandit.** Both read closest to western in the
  pack, and BUILD-PLAN.md's appendix names the same two.
- **`smoke.mjs` runs its own `node:http` static server** rather than shelling out to
  `npx serve`. Keeps the check to one command with no port-race or orphaned process,
  and the game still has zero runtime dependencies.
- **Playwright chromium, not the full browser set.** `npx playwright install
  chromium` only. WebGL works in the headless shell (confirmed — 192 frames rendered
  with tone mapping on), so no `--use-gl` flags are needed.
- **`index.html` boots an inline module, not `src/main.js`.** There is no `src/` code
  yet and rule 2 says the game must run at the end of every round. Round 1 swaps the
  inline block for the real entry point.

---

## Constants other systems depend on

Nothing is in `config.js` yet — round 1 creates it. What round 0 fixes:

- three.js **0.160.0**, import map names `three` and `three/addons/`.
- Renderer setup already proven in `index.html`: `ACESFilmicToneMapping`, exposure
  `1.1`, `outputColorSpace = SRGBColorSpace`. Carry these into `main.js`.
- Smoke server port **8917**; smoke expects `window.__frames` to increment every
  frame and `window.__ready` to go true. **Keep both globals alive in every round**
  or the smoke test fails for the wrong reason.
- Model paths are exactly `/models/player.glb`, `/models/bandit.glb`,
  `/models/horse.glb`.

---

## Known rough edges and deliberate shortcuts

- `index.html` is a placeholder scene (rotating torus knot). Intentional. Round 1
  deletes it.
- `audio/` and `src/` are empty directories. Git does not track empty directories,
  so they will not survive a fresh clone until a round puts files in them.
- No `.glb`-missing fallback path has been written yet. BUILD-PLAN.md requires a
  capsule-and-limbs placeholder if a model fails to load — **round 1 must build
  that** when it writes the loader, not later.
- Headless chromium logs `GPU stall due to ReadPixels` warnings. Harmless, ignored
  by the smoke test (warnings are printed, not failed on).
- The sandbox in this environment blocked process spawning partway through round 0;
  shell calls had to run unsandboxed. Not a project problem, but expect it.

---

## What the next round should watch out for

Round 1 specifically:

1. **Use the file layout from the start.** `config.js`, `main.js`, `world.js`,
   `player.js`, `camera.js`. No "everything in main.js, refactor later".
2. **No source file over 400 lines. No magic numbers outside `config.js`.**
3. `findClip` per the contract above — exact-then-substring, `null` on miss. The
   `Run`/`Run_Back` collision is the one that will bite.
4. Traverse **all four** skinned meshes on the humanoid, not just the first.
5. `clipReferenceSpeed` per clip in `config.js` and
   `action.timeScale = actualHorizontalSpeed / clipReferenceSpeed`, or the feet
   slide. There is no foot IK in this project.
6. Terrain must include the **town plateau** (~200×200, centre in `config.js`), a
   **world boundary**, and a **spawn point on the plateau facing something
   interesting**. Retrofitting any of these means regenerating the world.
7. Pointer lock via `movementX`/`movementY` only; pause when lock is lost.
8. Extend `scripts/smoke.mjs`'s `CHECKS` array — at minimum: the player's y settles
   onto the terrain instead of falling forever, and the GLBs actually loaded.
9. Check the model's normals when you first render it. These are low-poly stylized
   meshes; if they come in flat-shaded, the "must not look like a blocky voxel game"
   rule may need `computeVertexNormals()` or a smoothing pass on the terrain at
   minimum.

Before declaring the round done: `node scripts/smoke.mjs`, update this file,
add the new manual items to `SMOKE-TEST.md`, then
`git add -A && git commit -m "round N: ..." && git tag round-N`.
