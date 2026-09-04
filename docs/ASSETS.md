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
| | *Round 5's **townsfolk** load this a second time and clone a rig per citizen, exactly as the bandits do. There is no third humanoid to fetch, and dressing the town in the enemy silhouette would read as five bandits standing in the street (ADR-034). Each body clones its own **materials** and tints them — safe here and forbidden on a bandit, because a townsperson owns its copies and eleven bandits share one.* | | | | |
| `models/bandit.glb` | "Punk" (Ultimate Modular Men Pack) | `poly.pizza/m/BTALZymknF` | 1342 | 4 | 4 |
| | *Round 4 loads this **once** and clones a rig per bandit (`src/rig-clone.js`, ADR-029) — eleven men, one download, one set of GPU buffers. Geometry and materials are shared by reference, so **nothing may recolour a bandit's material in place**.* | | | | |
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

**Audio hosts ARE reachable** — tested in round 3: `kenney.nl`,
`freesound.org` and `opengameart.org` all returned 200. The block list above
is specific to those five hosts, not to the whole internet, so **try the fetch
before assuming**.

**There is no media toolchain on the box, but there is one on npm.** No
`ffmpeg`, no `sox`, no python audio module — but `npm i --no-save
ffmpeg-static` pulls a working `ffmpeg.exe` and the registry is allow-listed.
That is a dev-time tool, not a runtime dependency, which BUILD-PLAN.md
explicitly permits. Windows also ships 7-Zip at
`C:\Program Files-Zipz.exe`, which is how a `.7z` sample library got
opened.

---

## Audio — what is in `audio/`, and where it came from

Three files, added round 3. **All CC0.** All re-encoded to mono 44.1kHz Ogg
Vorbis (`libvorbis -q:a 4`) and loudness-normalised, because `PositionalAudio`
does not pan a stereo buffer and the raw sources were 96kHz multi-megabyte
WAVs.

| File | Source | Licence | Notes |
|---|---|---|---|
| `gunshot.ogg` | OpenGameArt "Gunshots" by *kurt*, the `22 Magnum.wav` track | **CC0** | Swapped post-round-3: the `Black Powder.wav` cut was a muffled low boom that did not read as a revolver. `.22 WMR` is a cartridge revolver round — a sharp crack that fits the game's Colt SAA. **The source is a 3-shot take** (≈2.16s; reports at ≈0.24 / 0.94 / 1.66s) — shot 1 is cut out, 0.18–0.78s, with a 100ms fade over the tail. Source hard-clips at 0 dBFS, so the encode is `volume=-4dB` and no dynamics; decodes to −3.3 dBFS. 0.60s, 8KB. `AUDIO.volumes.gunshot` stays 1.0. |
| `reload.ogg` | OpenGameArt "2 Gun Reloads" by *starninjas*, `gun_reload.1.ogg` | **CC0** | Already Ogg at source, and **clipped**: it decodes to +4.97 dBFS, so it needs -12 dB rather than the -7 that "reduce by a few dB" would suggest. 0.96s, which is why `COMBAT.reloadTime` is 1.7 — the clip plays once inside the lockout rather than looping. 14KB. |
| `hit.ogg` | Kenney "Impact Sounds", `impactPlank_medium_000.ogg` | **CC0** | Wood impact — barrels are the main thing being shot. Already Ogg at source. 0.78s, 11KB. |

### Two rules for adding audio, both learned the hard way

**1. Count the onsets before you trim.** A four-second SFX file is very often
several takes in a row, not one event with a long tail. The first cut of
`gunshot.ogg` assumed a 4s file was one shot, trimmed the first 1.6s, and
shipped **three** consecutive reports — every trigger pull sounded like
"tick tick tick". It survived review because the only check at the time asked
whether the file loaded. `scripts/smoke.mjs` now decodes each one-shot and
fails if it contains more than one onset.

**2. Do not use `loudnorm` on a one-shot; peak-normalise instead.** Single-pass
`loudnorm` rides the gain to hit an *integrated* target, which on a file that
is one spike and a lot of near-silence means flattening the spike and lifting
the noise floor — the opposite of what a gunshot needs. It also left all three
files at or above 0 dBFS, and **Vorbis overshoots on a sharp transient**, so
the gunshot clipped on decode. All three are now a plain `volume=<n>dB` to
about **-4 dBFS peak**, with no dynamics processing at all.

Measure the *true* peak with `astats` on a float pipeline
(`-af "aformat=sample_fmts=fltp,astats"`), not `volumedetect` — the latter
clamps its report at 0.0 dB and will tell you a file that decodes to +5 dBFS
is fine.

Peak-normalising does not balance the three by ear (a gunshot has a far lower
average level for its peak than a reload rattle). `AUDIO.volumes` in
`config-combat.js` is the lever for that, deliberately — the files stay
unclipped and the mix stays a number in config.

**One licence trap worth recording:** OpenGameArt's "Gunshot Sounds" entry is
*listed* as CC0 on its page, but the `creativecommons.txt` inside its own zip
says **CC-BY 3.0**. It was not used. Open the archive and read the licence file
before trusting the listing.

Round 7 needs `wind.ogg`, `crickets.ogg`, `piano.ogg` and `hoofbeats.ogg` —
same sources, same pipeline, and `audio.js` will need a `loop()` alongside its
one-shot `play()`.

## No gun model, and why the revolver is procedural

Quaternius's gun packs are on `quaternius.com`, which is in the blocked list
above, and no CC0 revolver turned up anywhere reachable. `weapons.js` therefore
builds one from `CylinderGeometry`/`BoxGeometry`/`TorusGeometry` — frame,
cylinder, barrel, ejector rod, hammer spur, raked grip, trigger guard —
proportioned on a Colt Single Action Army (190mm barrel, 280mm overall). Every
dimension is in `GUN` in `config-combat.js`.

This is the same "build it rather than ship without it" call BUILD-PLAN.md
makes for the character fallback, and it is a **drop-in swap**: point
`weapons.js`'s `buildRevolverMesh()` at a loaded GLB instead and the
attachment, the muzzle empty and every offset keep working unchanged.

---

## The Mixamo option

The one asset move that would genuinely pay off is **not** downloading a
clip — it is re-rigging the Farmer mesh through Mixamo's auto-rigger and
taking the whole animation set at once, which also closes the missing `Reload`.
Costs, licence caveat, and why it must be the human doing it: **ADR-021** in
[DECISIONS.md](DECISIONS.md).
