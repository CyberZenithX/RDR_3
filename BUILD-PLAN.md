# Build prompt — "Dust & Iron" (western open-world)

**Save the prompt below as `BUILD-PLAN.md` in an empty project folder. Do not paste it into chat.**

Then, in that folder:

```
claude
> read BUILD-PLAN.md and CLAUDE.md, then do Round 0
```

When the round finishes, `/clear`, and start the next one the same way: `read BUILD-PLAN.md and CLAUDE.md, then do Round 3`.

Round 0 creates a `/round` slash command, so from round 1 onward you can just type `/round 3`.

**One round per session, always a fresh session.** Not seven rounds in one long conversation and not "continue". Two reasons: a long session hits auto-compaction and your spec gets summarized into a vaguer version of itself, and a fresh window means round 5 gets full attention instead of competing with four rounds of dead tool output. `CLAUDE.md` and `BUILD-PLAN.md` reload from disk every time, so nothing is lost — that's the whole point of keeping the plan in a file.

Only exception: if a round ends broken, stay in that session and fix it before clearing.

Appendix at the bottom is for you, not Claude.

---

## THE PROMPT

You are building a third-person western open-world game called **Dust & Iron**. Browser-based, runs locally, no build step. It is built over 7 rounds, described below.

**This file is the spec. You are running one round per session.** Do the round you were asked for, then stop — do not start the next one. If you were not told which round, read `CLAUDE.md` to see what is already done and ask me which round to run.

### Locked tech decisions — do not change these or suggest alternatives

- **three.js 0.160.0**, loaded as ES modules via an import map from `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`, addons from `https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/`
- **No bundler, no React, no TypeScript.** Plain `.js` files served over `http://` with `npx serve .`
- **The game itself has zero runtime dependencies** — three.js from CDN and nothing else. Dev-time node tooling installed with npm is fine and expected (asset verification, headless checks); it lives in `devDependencies` and never ships to the browser.
- **No physics engine.** Ground contact = raycast down onto the terrain mesh. Collision = a flat array of colliders, each either a circle `{type:'circle', x, z, r}` for rocks, trees, barrels and characters, or an axis-aligned box `{type:'box', x, z, w, d, rot}` for buildings and fences. Circles are cheap and used for everything round; boxes exist because a building pushed away by a circle test feels wrong at the corners and lets you clip the walls. Both live in one array with one resolve function.
- **GLTFLoader** for all characters and props. Models are `.glb` files sitting in `/models/`.
- **No backend, no accounts, no network calls.** `localStorage` only for settings and checkpoint position.
- Audio via `THREE.Audio` / `PositionalAudio`, files in `/audio/`.

### File layout

```
index.html
CLAUDE.md           running project memory — see rules below
SMOKE-TEST.md       manual regression checklist — see rules below
/src/config.js      EVERY tunable number in the game, nothing else
/src/main.js        entry, loop, resize
/src/world.js       terrain, sky, lighting, props
/src/player.js      movement, animation state machine
/src/camera.js      third-person rig
/src/horse.js
/src/combat.js
/src/ai.js
/src/ui.js
/models/
/audio/
```

**Use this layout from round 1.** Do not start with everything in `main.js` and refactor later — the refactor round is wasted time and it always breaks something.

**`config.js` is not optional and not a suggestion.** Every number I might want to tune lives there as a named export: movement speeds, gravity, jump force, camera distance and height and damping, mouse sensitivity, `clipReferenceSpeed` per animation, gun hand offsets, recoil amount, fire rate, reload time, bandit sight range and accuracy, stamina drain, fog density, draw distance, terrain scale. No magic numbers anywhere else in the codebase. If I ask you to make the horse faster, the answer should be one line in one file.

**No source file over 400 lines.** When one approaches that, split it — `player.js` into `player.js` + `player-anim.js`, `combat.js` into `combat.js` + `weapons.js`, and so on. Hard limit. Small files mean a later round can read only what it needs instead of pulling 900 lines of unrelated code into context, and targeted edits land cleanly instead of fighting an enormous file.

### Models — code against these exact names

Round 0 puts these in place. Every later round assumes they exist.

| File | What it is | Clip names to look for |
|---|---|---|
| `/models/player.glb` | rigged humanoid | `Idle`, `Walk`, `Run`, `Idle_Gun`, `Run_Gun`, `Shoot`, `Death` |
| `/models/bandit.glb` | rigged humanoid | same as player |
| `/models/horse.glb` | rigged horse | `Idle`, `Walk`, `Gallop`, `Death` |

**Clip names will not match exactly, and some clips will not exist at all.** Free character packs typically ship idle, walk, run, jump and die — and nothing else. Assume the combat and riding clips are missing until Round 0's report proves otherwise.

Write `findClip(gltf, ...candidates)` doing a case-insensitive substring match over `gltf.animations`. **If nothing matches, return `null`.** Never fall back to the first clip — a "shoot" that silently plays Idle sends me debugging combat code that works fine.

When a clip is null, degrade deliberately. These fakes are cheap and read acceptably:

| Missing | What to do instead |
|---|---|
| `Shoot` | Keep the current clip playing, rotate the spine and right upper-arm bones by code for a 0.15s recoil kick, then ease back |
| `Reload` | Dip the gun below frame with a bone rotation for the reload duration |
| `Hit` | 0.2s flinch on the spine + a colour flash on the material |
| `Death` | Tip the whole model over on its side over 0.6s, sink it slightly into the ground, stop the mixer |
| `Idle_Gun` / `Run_Gun` | Play the normal Idle/Run and let the hand-bone gun attachment carry it |
| `Mount` / `Dismount` | Lerp the player's position and rotation onto the saddle point over 0.4s with no clip at all |
| `Walk` or `Run` | This one you cannot fake. Stop and tell me. |

Log one clear warning per missing clip at startup and record every substitution in `CLAUDE.md`, so a later round knows the recoil is procedural and doesn't try to crossfade into a clip that isn't there.

**If a `.glb` is missing or fails to load, do not crash.** Substitute a proportioned capsule-and-limbs placeholder, log a clear warning, and keep the game fully playable. This rule holds for every round.

### Look and feel — this must not look like a blocky voxel game

- `MeshStandardMaterial` everywhere, smooth-shaded, no cube-people, no flat-shaded terrain facets
- `renderer.toneMapping = ACESFilmicToneMapping`, exposure ~1.1, `outputColorSpace = SRGBColorSpace`
- One `DirectionalLight` sun with `PCFSoftShadowMap`, shadow map 2048 max, cascade-faked by keeping the shadow camera tight around the player
- Exponential fog tinted to match the sky, dusty warm palette — ochre, sage, bleached bone, rust
- Subtle camera sway while walking, harder sway while galloping
- Grass and rocks via `InstancedMesh`, thinning out with distance

### Performance budget

60fps on a mid-range laptop. Under ~120 draw calls for the whole scene. Instance anything that appears more than 20 times. Frustum culling on. Never allocate new vectors inside the render loop — reuse module-level scratch objects.

### The 7 rounds

**Round 0 — get your own assets.** Do not ask me to download anything. Run this yourself:

1. `mkdir -p models audio src scripts`, then `git init` and write a `.gitignore` with `node_modules/`
2. `npm i @gltf-transform/core` (only dev dependency in this project — the game itself still has zero dependencies)
3. Fetch a rigged humanoid GLB and a rigged horse GLB. Try in order, stop at the first that works:
   - `curl -sL https://poly.pizza/bundle/Ultimate-Modular-Men-Pack-ZiH8muWqwQ` and `https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS`, read the returned HTML, find the GLTF/GLB asset URLs, follow them. These are CC0.
   - `https://github.com/KhronosGroup/glTF-Sample-Assets` — CC0, has rigged animated models. Not western, but they load and animate.
   - Any other CC0 source you can find and verify the licence of. **CC0 or public domain only. Do not download anything you cannot confirm the licence for.**
4. Save as `models/player.glb`, `models/bandit.glb`, `models/horse.glb`.
5. **Verify every file before trusting it.** Write and run `scripts/verify-models.mjs`:

```js
import { NodeIO } from '@gltf-transform/core';
import { readdirSync, statSync } from 'node:fs';

const io = new NodeIO();
for (const f of readdirSync('models').filter(n => n.endsWith('.glb'))) {
  const p = `models/${f}`;
  try {
    const root = (await io.read(p)).getRoot();
    console.log(f, {
      kb: Math.round(statSync(p).size / 1024),
      meshes: root.listMeshes().length,
      skins: root.listSkins().length,
      clips: root.listAnimations().map(a => a.getName()),
    });
  } catch (e) { console.log(f, 'UNREADABLE:', e.message); }
}
```

A file under 10 KB, or with `skins: 0`, or with an empty `clips` array, is a failed download or an unrigged model. Delete it and try the next source. Do not proceed on a bad file.

6. **If every source fails, do not stop and do not ask me.** Build a procedural stand-in instead: a humanoid assembled from `CapsuleGeometry` and `LatheGeometry` with correct human proportions, a hand-built `Bone` hierarchy (hips → spine → chest → head, plus arms and legs), `SkinnedMesh` binding, and hand-authored `AnimationClip`s for idle, walk, run and shoot built from `QuaternionKeyframeTrack`s. Smooth-shaded, `MeshStandardMaterial`, no cubes. This is a real fallback, not a placeholder — the game must look and animate acceptably with it.

7. Create `CLAUDE.md` with the sections listed under rule A below, filled in for round 0. Install `playwright` as a dev dependency and write `scripts/smoke.mjs` per rule C — for round 0 it need only confirm the page loads with no console errors. Create `SMOKE-TEST.md` with a header explaining it is a manual checklist for the human, and no items yet. Create `.claude/commands/round.md` containing:

```
Read BUILD-PLAN.md and CLAUDE.md. Then do Round $ARGUMENTS of the build plan, following every rule in BUILD-PLAN.md. Stop when that round is complete.
```

8. **Report the animation gap and stop.** Print a table: each model, where it came from, and every clip name found. Then check those against the clips rounds 1–7 need — `Idle`, `Walk`, `Run`, `Shoot`, `Reload`, `Hit`, `Death` for humanoids, `Idle`, `Walk`, `Gallop`, `Death` for the horse — and list plainly which ones are missing and what you would fake instead, per the table above.

Then tell me, in one short paragraph, whether the packs you found are good enough for the combat rounds or whether I should spend 40 minutes on Mixamo first. Be blunt about it. Recommend Mixamo if `Shoot` and `Death` are both missing — those two carry rounds 3, 4 and 6, and no amount of bone-rotation faking makes a gunfight look right without them.

Do not start Round 1. This is a decision I need to make before any code depends on it.

**Round 1 — world and player.** Procedural heightmap terrain (simplex-style noise, ~1500×1500 units), sky dome, sun, fog, scattered rocks/cacti/dead trees. Third-person camera on a spring arm with mouse look and collision-aware zoom. WASD + Shift sprint + Space jump. Player loads from GLB with crossfaded idle/walk/run blending driven by actual velocity.

Three things to build into the terrain now, because retrofitting any of them means regenerating the world and moving everything on it:

- **A flat plateau where the town will go.** Reserve a ~200×200 region, centre coordinates in `config.js`, and blend the noise down to a constant height across it with a smooth falloff at the edges so it doesn't look stamped. Round 5 places buildings there. Without this, round 5 builds a town on a hillside with half the buildings buried and the other half floating, and the only fix at that point is regenerating the terrain.
- **A world boundary.** The map ends. Decide how it ends and say so: ridge of impassable hills, or an invisible wall with a "you are leaving the territory" fade that turns you back. Either is fine, but the player must never reach an edge and fall into black void.
- **A spawn point** in `config.js`, on the plateau, on flat ground. This doubles as the default respawn until checkpoints exist. Face the player toward the most interesting thing on the horizon — a mesa, a ridgeline, a cluster of dead trees. Never toward flat empty ground. The first three seconds decide whether the world reads as a place or a grey plane, and that judgement gets made before the player touches a key.

Two more that are easy to skip and hard to add later:

- **Pointer lock.** Click the canvas → `canvas.requestPointerLock()`. Read mouse look from `movementX`/`movementY` only, never from absolute cursor position. Esc releases it, and the game pauses when lock is lost. Show a "click to play" overlay whenever the pointer is unlocked.
- **Match animation speed to real movement speed.** Set `action.timeScale = actualHorizontalSpeed / clipReferenceSpeed`, where `clipReferenceSpeed` is a per-clip constant I can tune. Without this the feet slide. There is no foot IK in this project, so this is the only thing keeping the walk from looking like it's on ice — do not skip it.

**Round 2 — the horse.** Press `H` to whistle, horse trots to you. `E` to mount/dismount. Gallop with a stamina bar that drains and refills. Camera pulls back and raises when mounted. Horse leans into turns. When unmounted, it wanders nearby and follows you at a distance.

**Round 3 — guns.** Right mouse = over-the-shoulder aim (camera shifts, FOV narrows, crosshair appears). Left mouse = fire. `R` = reload with an animation-timed lockout. Revolver: 6 rounds, ammo counter. Raycast hit detection, muzzle flash, tracer, impact spark + decal, screen-shake recoil, spent-shell drop. Shootable barrels and bottles to test on.

**Sound, now — not in round 7.** Three files in `/audio/`: `gunshot.ogg`, `reload.ogg`, `hit.ogg`. A silent gunfight feels broken in a way no amount of muzzle flash fixes, and rounds 4 through 6 are all built on this shooting. Wrap every sound so a missing file logs a warning and plays silence — the game never breaks because audio is absent. If the files aren't there, fetch CC0 ones the way you fetched the models.

**Mounted shooting: yes, and it is not optional.** A western where you dismount to fight is not the game. While mounted, the horse keeps steering with A/D, aim and fire work as normal, accuracy is reduced by a config value, and reloading is disabled at a gallop. If the animation set has no mounted-shoot clip, blend the upper-body shoot clip over the riding pose using an additive or partial-skeleton mix — spine-up from one clip, hips-down from the other. Say so in `CLAUDE.md` if you had to fake it.

**The revolver must be attached to the hand bone, not floated near the player.** Traverse the loaded skeleton, find the right hand bone by case-insensitive name match (`mixamorigRightHand`, `RightHand`, `hand_r`, `Hand.R`, `Bip01_R_Hand` — try all of these), and `add()` the revolver mesh as a child of that bone. Expose the position, rotation and scale offsets in `config.js`, because the first values will be wrong and I will need to nudge them. Log a loud warning and fall back to attaching to the player root if no hand bone is found. The muzzle flash and the raycast origin both come from an empty `Object3D` parented to the gun barrel tip — not from the camera.

**Round 4 — bandits.** Bandit AI state machine: `patrol → alert → chase → takeCover → shoot → flee → dead`. Line-of-sight checks, they use rocks as cover. Health for player and bandits, hit reactions, death animation that settles onto the terrain. Player health bar, red damage vignette, death and respawn. **Checkpoints do not exist yet** — round 7 adds saving. For now respawn at the config spawn point, or at the last bandit camp you approached, whichever is nearer. Keep the respawn call in one function so round 7 can swap in the real checkpoint without touching combat code. Bandit camps of 3–5 enemies, placed from a coordinate list in `config.js`, well away from the town plateau.

**Aim for this feel:** two body shots kill a bandit, five hits kill the player, and bandits miss often enough that standing in the open is survivable for a few seconds but stupid. Lethal and fast on both sides — this is a western, not a shooter with health sponges. All of it in `config.js` so I can retune it in one place.

**No navmesh, no A\*.** That is a whole round of work and we are not spending it. Instead give each bandit steering-based avoidance: three short raycasts forward (centre, and ±30°) against the collider array, and when one hits, add a sideways steering force away from it. Add a stuck detector — if a bandit's position has moved less than 0.5 units in 2 seconds while it thinks it's chasing, pick a random sidestep direction and commit to it for 1 second. Accept that they will still look dumb in tight spaces. Do not try to fix that in this round.

**Round 5 — the town.** A town of ~10 buildings on a main street: saloon, stable, sheriff's office, gunsmith, church. Walkable interior for the saloon at minimum, with a door trigger that fades in and out. Idle townsfolk NPCs that wander a short patrol and turn to look at you when you pass. Hitching post outside the saloon where the horse waits. Lamps and interior lights that will matter in round 7.

Place buildings by hand from a coordinate list in `config.js`, not procedurally. Ten hand-placed buildings look like a town; ten scattered ones look like a bug.

**Round 6 — a reason to play, duels, and consequences.**

Everything so far is a sandbox with no goal. This round makes it a game, and it needs almost nothing new — just wiring the existing pieces into a loop. A bounty board outside the sheriff's office lists the bandit camps from round 4 by name and reward. Read it to accept one; the target camp gets a marker on the horizon. Clear the camp, ride back, collect. Money is a number in the corner of the screen — it doesn't need to buy anything yet. That's the loop: read, ride, fight, ride back, paid. Three bounties is enough.

**Duels.** Approach a marked NPC, press `F` to challenge. Camera cuts to a face-off shot, both draw stances, tension builds over a randomised 2–5 seconds, then a signal. Timing window on the draw: early = you lose, inside the window = clean kill, late = you take the hit. Slow-motion on the winning shot. Wanted level rises if you shoot innocents, shown as a star meter; deputies spawn and hunt you, and the level decays if you get clear of town.

**Round 7 — polish.** Day/night cycle with a real sun arc and warm sunset light. Wind-swayed grass shader.

**Remaining audio — these exact filenames in `/audio/`, do not invent others:** `wind.ogg` (looping ambient), `crickets.ogg` (looping, night only), `piano.ogg` (positional, inside the saloon), `hoofbeats.ogg` (looping, rate tied to gallop speed). Combat sounds already exist from round 3. Master mute on `M`.

Main menu + pause + settings (mouse sensitivity, shadow quality, draw distance). Checkpoint save to localStorage. Corner minimap. Final performance pass — report your draw call and frame time numbers.

**This round is overloaded and you will not finish all of it well.** Do it in that order and stop when quality drops. If something has to go, drop the minimap first, then the grass shader. Do not drop the day/night cycle — sunset over the desert is the single best-looking thing this game will ever do.

### Rules for every round

1. Do the round you were asked for and stop. Never start the next round, even if there's context left.
2. The game must run and be playable at the end of every single round. No half-wired features, no `// TODO`, no functions that return nothing.
3. Edit files directly with your normal tools. Do not paste whole files into the conversation — but never leave a file in a broken half-edited state either. If a change spans several files, finish all of them before you stop.
4. End every round with, in the conversation: **what to test**, **the full control list**, and **anything you deliberately left rough**.
5. If something in this spec is a bad idea for performance or feel, say so and propose the fix before building it — don't just silently do something else.
6. Do not read files you don't need. Context spent re-reading `world.js` during a combat round is context you don't have for the combat round.

### Three things you must do at the end of every round, before you stop

**A. Update `CLAUDE.md`.** Each round runs in a fresh session with no memory of the last one. `CLAUDE.md` is the only thing that carries forward — treat it as a handoff note to a stranger who has to finish your work tomorrow. Keep these sections current, rewriting rather than only appending: rounds completed; what exists and which file owns it; decisions made and the reason for each; constants other systems depend on; known rough edges and deliberate shortcuts; what the next round should watch out for. Also keep a short **file map** — one line per source file saying what's in it — so the next session knows what to read without opening everything.

If you finish a round and `CLAUDE.md` still describes the previous one, the next session starts blind. This is the most important of the three.

**B. Commit and tag.** `git add -A && git commit -m "round N: <summary>" && git tag round-N`. One tag per round, no exceptions. If a later round goes badly I need to be able to say `git checkout round-3` and have a working game.

**C. Verify what you can, then hand me the rest.** You cannot see the game. You have no eyes on a browser window and you cannot tell whether the horse feels good to ride. Do not claim you tested something you didn't — a fabricated pass is worse than no check at all.

What you *can* and must do automatically: run the game headless and fail the round on any console error or failed asset load. Round 0 installs `playwright` as a dev dependency for exactly this, and writes `scripts/smoke.mjs` — it launches the page, waits for the loader to finish and a few seconds of frames to pass, and exits non-zero if anything logged an error, any texture or GLB 404'd, or the frame loop never started. Run `node scripts/smoke.mjs` before you declare any round done, and extend it each round with whatever else is machine-checkable: object counts, that the player's y-position settles onto the terrain instead of falling forever, that a fired shot registers a hit on a target placed directly in front.

What you cannot check goes in `SMOKE-TEST.md` as a numbered list for me to walk by hand — "horse comes when whistled", "revolver reloads and the count resets to 6", "bandits lose track of you behind a rock". Grow it every round and never delete a line. Print the new items at the end of the round and tell me plainly that these are mine to verify.

If I come back and tell you something on that list is broken, fixing it is the next thing you do, before any new feature. A round is not finished because the new thing works — it is finished when nothing that worked before is broken. This rule exists because round 4 will break the horse and neither of us will notice until round 7.

Then stop. Do not begin the next round.

---

## APPENDIX — manual asset download (only if Round 0's fetching fails)

Round 0 tells Claude to do all of this itself. This is your fallback if it can't. All CC0, commercial use fine, no login on poly.pizza.

**Characters** — `poly.pizza/bundle/Ultimate-Modular-Men-Pack-ZiH8muWqwQ` → click **Download GLTF** → pick two characters (Worker and Punk read closest to western) → rename to `player.glb` and `bandit.glb`, drop in `/models/`.

**Horse** — `poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS` → **Download GLTF** → grab the Horse → rename `horse.glb`.

**Guns and props** — Quaternius has a free "50+ LowPoly Guns" pack and buildings packs on `quaternius.com`. Optional; the prompt tells Claude to build props procedurally.

**Audio** — `kenney.nl/assets` has CC0 audio packs (Impact Sounds, Interface Sounds) with no login. For wind, crickets, piano and hoofbeats, `freesound.org` needs a free account — filter the search by **License → Creative Commons 0**. Convert whatever you get to `.ogg` and use the exact filenames given in rounds 3 and 7. The game runs silent if a file is missing, so you can add them as you go — but get `gunshot.ogg` in before round 4.

**To run:** put everything in one folder, open a terminal there, `npx serve .`, open the URL it prints. Don't open `index.html` by double-clicking — ES modules and GLB loading need `http://`.

**If Round 0 tells you the animation set is too thin** (likely): go to `mixamo.com`, free Adobe account, no payment. Search and download these as FBX — *without* skin, since you already have a character: `Idle`, `Walking`, `Running`, `Pistol Idle`, `Shooting`, `Reloading`, `Hit Reaction`, `Death From Front`, `Standing Draw Arrow` (works as a duel draw). Also grab a character if you'd rather have a rigged human than the pack model.

In Blender: File → Import → FBX for the character, then import each animation FBX on top of it. Each arrives as a separate action in the Action Editor — rename them to match the names in the table above. Then File → Export → glTF 2.0, and tick **Animation → Group by NLA Track** so all actions come through as separate clips in one GLB. Save as `player.glb`, copy it to `bandit.glb`.

Budget 40 minutes the first time. The loader doesn't care where the model came from, so this is a drop-in swap at any point — you can do it after round 1 if you'd rather see the world running first.