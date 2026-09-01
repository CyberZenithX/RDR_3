# ASSETS.md — models, licences, scaling, and what this environment can't fetch

Related: [ANIMATION.md](ANIMATION.md) (the rigs and their clips) ·
[HORSE.md](HORSE.md) (`HORSE.modelScale`) · [DECISIONS.md](DECISIONS.md)

---

## The rule

**CC0 only.** Commercial use fine, no attribution required, no login. A model
that is merely "free" or CC-BY does not qualify — a rigged, western-adjacent
find ("Cops and Robbers") was correctly ruled out for being CC-BY 3.0.

`node scripts/verify-models.mjs` prints a size / mesh / skin / clip-name report
for every `models/*.glb`. Run it after touching models.

---

## Inventory

All three are **Quaternius, CC0 1.0**.

| File | Source model | Origin | KB | Meshes | Skins |
|---|---|---|---|---|---|
| `models/player.glb` | "Farmer" (Ultimate Modular Men Pack) | `poly.pizza/m/7pn3R6hPvE` | 1338 | 4 | 4 |
| `models/bandit.glb` | "Punk" (Ultimate Modular Men Pack) | `poly.pizza/m/BTALZymknF` | 1342 | 4 | 4 |
| `models/horse.glb` | "Horse" (Animated Animal Pack) | `poly.pizza/m/qvTrSG9pZF` | 1082 | 1 | 1 |

`audio/` is **empty**. Round 3 needs `gunshot.ogg`, `reload.ogg`, `hit.ogg`;
round 7 the rest.

### A fourth model that is not here

`anim-source-jump.glb` ("Man", Animated Men Pack, CC0) was loaded purely to
harvest a `Man_Jump` clip and skeleton for retargeting — never rendered
itself. Removed with the feature, and **never committed**: neither the GLB nor
`src/retarget.js` appears anywhere in this repo's history. Re-fetching the
model is a human-side task (`poly.pizza` is 403'd here). See
[DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md#the-retargeted-jump-clip-built-verified-removed).

---

## The Farmer swap (post-round-1)

`player.glb` was "Worker" and is now "Farmer" — the human wanted something
more appropriate for a western than a hardhat-and-hi-vis construction worker.

**Verified before swapping**, because a model swap that changes the rig breaks
everything downstream:

- Same Quaternius "Ultimate Modular Men Pack" family.
- **Identical 85-node skeleton** — `Wrist.R` / `Hips` / `Chest` all present,
  same names.
- **Identical 24-clip `CharacterArmature|`-prefixed animation set.**

So this was a same-rig reskin, not a new asset integration: `findClip`,
bone-name lookups, and round 3's hand-bone gun attachment all needed no
change. Mesh names differ slightly (`Farmer_Feet/Pants/Body/Head` vs
`Worker_Feet/Legs/Body/Head`), which doesn't matter because `enableShadows()`
and `measureHeight()` traverse generically, not by name.

**Do the same three checks before any future model swap.**

"Adventurer" (browns/greens, satchel, arguably reads more frontier) was the
considered alternative — same pack, same rig, also verified. The human picked
Farmer. No genuinely cowboy-styled *rigged* CC0 model could be found anywhere
searched (poly.pizza, Quaternius, Kenney, itch.io): the models literally named
"Cowboy"/"Cowgirl" are unrigged (`"Animated": false`).

---

## `measureHeight()` lies on skinned meshes

`assets.js`'s `measureHeight()` is correct for `player.glb` and is the only
sanctioned way to measure a GLB — it fixes the stale-`matrixWorld` bug that
once rendered the player at 5cm
([DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md#the-player-was-rendering-at-5cm-tall)).
**It is still not trustworthy for every rig, and `horse.glb` is the proof.**

`horse.glb` measures **4.824** high × **5.676** deep via `Box3.setFromObject`.
Two things were verified directly rather than assumed:

1. **`Box3.setFromObject` on a `SkinnedMesh` only ever reads the geometry's
   bind-pose position attribute.** It never applies bone or skin matrices.
   Playing `Idle`'s first frame through an `AnimationMixer` and calling
   `mixer.update(0)` before measuring changed **nothing** — confirmed
   byte-identical rest-pose vs. idle-pose bounding boxes. Skinning is GPU-side;
   the CPU-side box does not know about it. So "measure with a neutral clip
   applied" would not have helped even if the bind pose *were* the problem.
2. **The bind pose is a normal standing pose, not reared or mid-gallop.**
   Confirmed by reading real bone *world* positions
   (`bone.getWorldPosition()` after `updateMatrixWorld(true)`, which does
   reflect the rest pose, since that's just node transforms with no skinning
   involved): front/back hoof bones sit ~0.40 above the mesh's actual ground
   contact, legs are vertical columns, body roughly horizontal.

**The oversized box is a real property of the asset** — an
`AnimalArmature`/`Horse` node scale of literally **100** baked into the source
file.

**Consequences, and the rules that follow:**

- `HORSE.modelScale = 0.58` is hardcoded, computed from the withers bone
  (`Torso2`, world Y ≈ 2.746 above the mesh's true ground line ≈ -0.011)
  against a real-world target of ~1.6m at the withers, then visually confirmed
  next to the player.
- **Before trusting `measureHeight()` on any new `SkinnedMesh`, check that
  playing an animation actually moves its measured box.** For `player.glb` the
  bind pose happens to already read as correctly scaled. Don't assume the next
  model is so lucky.
- **For "where is the *surface* of this skinned mesh?", raycast, don't
  measure.** In three.js r160 `SkinnedMesh.raycast` **does** apply bone
  transforms, so it hits the animated silhouette you can actually see. This is
  how `HORSE.saddleOffset.y` (2.06), the barrel half-width (0.33) and
  `HORSE.bellyHeight` (1.10) were all obtained — reading the geometry buffer
  instead put the back ~0.4 too high.
- If a future round swaps the horse, **redo the bone-world-position
  measurement**, the same way.

---

## What this environment cannot fetch

The egress proxy 403s these by org policy — not a transient failure, and
`HTTPS_PROXY` does not help, because the proxy itself is what denies the host:

`poly.pizza` · `quaternius.com` · `mixamo.com` · `helpx.adobe.com` ·
`cdn.jsdelivr.net`

The npm registry **is** allow-listed, which is how three.js got vendored
(ADR-007).

There is also **no Blender and no FBX toolchain installed.**

**So: any asset acquisition is a human-side task.** Say that plainly rather
than silently shipping without the asset. BUILD-PLAN.md's appendix is the
human's manual-download fallback.

**Untested for round 3's audio:** `freesound.org` and `kenney.nl` have not
been tried. Attempt the fetch yourself first, per BUILD-PLAN.md's round-0
pattern; if blocked, hand it to the human — a silent gunfight is explicitly
called out in BUILD-PLAN.md as feeling broken.

---

## The Mixamo option

The one asset move that would genuinely pay off is **not** downloading a
clip — it is re-rigging the Farmer mesh through Mixamo's auto-rigger and
taking the whole animation set at once, which also closes the missing `Reload`.
Costs, licence caveat, and why it must be the human doing it: **ADR-021** in
[DECISIONS.md](DECISIONS.md).
