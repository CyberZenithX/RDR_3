# ANIMATION.md — the rigs, the clips, and every trap in them

Read this **before writing any code that touches a bone, a clip, or a pose.**
Everything here was measured on the live rigs, not recalled from documentation.

Related: [ASSETS.md](ASSETS.md) (where the models came from, scaling) ·
[HORSE.md](HORSE.md) (the riding pose in practice) ·
[DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md) (the failed jump-retarget saga)

---

## The five invariants

1. **`GLTFLoader` strips dots from node names at load.** `Wrist.R` in the
   source file is `WristR` at runtime. Every `getObjectByName()` call needs the
   dot-less form.
2. **`Foot.L/R` are top-level children of `Root`, not children of the shins.**
   Rotating a leg does not move the foot.
3. **`Hips` is not the pelvis on this rig.** `Body` is. `Hips` is animated by
   zero of the 24 clips.
4. **A per-frame bone delta only works on a bone some clip rewrites every
   frame.** Otherwise it compounds. Pose from a captured baseline.
5. **A foreign clip is not compatible with this rig**, however humanoid it
   looks — see "Why retargeting is hard here".

---

## Runtime vs. source bone names

A dot is the path separator inside an `AnimationClip` track target string
(`"boneName.quaternion"`), so a dot *inside* a bone name would be ambiguous
there. `GLTFLoader` therefore strips every dot on load.

Confirmed directly by loading `player.glb` fresh and traversing the resulting
scene graph:

```js
root.getObjectByName('UpperArm.L')  // undefined
root.getObjectByName('UpperArmL')   // the bone
```

This file (and BUILD-PLAN.md) write the **dotted, source-file** form
everywhere, because that is what a `gltf-transform` or Blender node dump
shows. **The runtime form is different.** This bit round 1 hard and will bite
round 3's `Wrist.R` → `WristR` revolver attachment if not re-read.

---

## Clip inventory

**Humanoid clips are prefixed `CharacterArmature|`** (e.g.
`CharacterArmature|Idle`). The horse has both bare and `AnimalArmature|`-
prefixed copies of every clip.

`player.glb` and `bandit.glb` — **identical 24-clip set**:

```
Death              Gun_Shoot          HitRecieve         HitRecieve_2
Idle               Idle_Gun           Idle_Gun_Pointing  Idle_Gun_Shoot
Idle_Neutral       Idle_Sword         Interact           Kick_Left
Kick_Right         Punch_Left         Punch_Right        Roll
Run                Run_Back           Run_Left           Run_Right
Run_Shoot          Sword_Slash        Walk               Wave
```

`horse.glb` — 13 unique clips, **each present twice** (bare + prefixed):

```
Idle   Idle_2   Idle_Headlow   Idle_HitReact_Left   Idle_HitReact_Right
Walk   Gallop   Gallop_Jump    Jump_toIdle          Eating
Death  Attack_Headbutt         Attack_Kick
```

### Three traps in those names

1. **`HitRecieve` is misspelled in the asset.** Searching `"HitReceive"` finds
   nothing. Put both spellings in the candidate list.
2. **Naive substring matching on `Run` hits five clips** — `Run`, `Run_Back`,
   `Run_Left`, `Run_Right`, `Run_Shoot`. `Idle` hits six.
3. **Every horse clip is duplicated.** Deduplicate by the name after `|`. Moot
   for `findClip` (it returns the first match and the copies are identical),
   but it will matter to anything that enumerates clips.

### `findClip` contract — `src/assets.js`

`findClip(gltf, ...candidates)` — for each candidate **in order**: exact match
on the post-`|` segment (case-insensitive) **first**, then case-insensitive
substring. Returns `null` if nothing matches. `character.js` logs one
`console.warn` per missing clip.

The exact-first ordering is what makes trap 2 harmless. Do not "simplify" it
to a substring search.

---

## The humanoid rig — structure

85 nodes. **4 separate skinned meshes** (`Farmer_Feet` / `Pants` / `Body` /
`Head`) sharing one armature — `enableShadows()` traverses generically, so it
covers all of them.

Spine: `RootNode` → `CharacterArmature` → `Root` → `Body` → `Hips` →
`Abdomen` → `Torso` → `Chest` → `Neck` → `Head` (+ `Head_end`).
Arms: `Shoulder.L/R` → `UpperArm.L/R` → `LowerArm.L/R` → `Wrist.L/R`.
(Source names — strip the dots at runtime.)

### This is an IK rig baked flat on export

Measured across all 24 clips with `@gltf-transform/core`, reading every
animation channel's target node and path:

| Bone | Parent | Animated by | Carries |
|---|---|---|---|
| `Body` | `Root` | **all 24 clips** | `translation` (24) + `rotation` (19) — the de-facto pelvis |
| `Hips` | `Body` | **zero clips** | nothing, ever — a dead pass-through bone |
| `Foot.L/R` | `Root` | 13 clips | `translation` **and** `rotation`, in `Root` space |
| `PT.L/R` | `Root` | 13 clips | `translation` (+ `rotation` in 3) — Blender **pole targets** (knee direction), exported as real bones |
| `Abdomen` | `Hips` | 5 clips | `rotation` only (`Kick_*`, `Punch_*`, `Roll`) |

So `Root` has **five** direct children: `Body`, `Foot.L`, `Foot.R`, `PT.L`,
`PT.R`. The legs' whole story is `Body.translation` plus hand-placed feet, not
an FK hip→knee→ankle chain.

### The leg "chain" is not a chain

```
Body → UpperLegL → LowerLegL → LowerLegL_end
Root → FootL → FootL_end          ← the foot is its OWN top-level bone
Body → Hips → Abdomen → …         ← Hips is a SIBLING of UpperLeg, not its parent
```

Measured empirically (rotate a bone, read world positions):

- Rotating `UpperLegL` by 57° moves `LowerLegL` **0.415** units and moves
  `FootL` by **exactly 0.0**.
- Rotating `Hips` moves `UpperLegL` by **exactly 0.0**.

Consequences:

- **Any clip that animates the legs must also author `Foot.L/R` tracks — both
  `.position` and `.quaternion`.** Rotation alone is not enough: the foot is
  positioned in `Root` space, so keeping it attached to a swinging shin
  requires moving it. `player.glb`'s own `Walk`/`Run`/`Idle` all author both
  every frame (verified `varying: true`) precisely because the animator had to
  place the foot by hand.
- **Leaving the foot un-animated does not leave it neutral** — it leaves it
  welded in place while the shin swings away, and the skin between them smears
  into a long curved "boomerang boot". This is a **skinning stretch, not a
  rotation error**, which is why it is so easy to misdiagnose. Two separate
  "fixes" were shipped against the wrong diagnosis before this was measured.
- **`Hips` being a sibling of the legs is a latent version of the same trap.**
  It happened not to bite the removed jump clip (measured then: `Hips` rotated
  0°, `Abdomen` 0°, `Torso` only 3.5°). A future clip that genuinely rotates
  the pelvis needs the same follow-the-parent treatment on `UpperLegL/R` →
  `Hips`. **Measure before assuming it's fine.**

### `Body` is unusable as a reference for small vertical measurements

`Body` carries a `translation` track in **all 24 clips**, so the idle clip
jitters it a few centimetres every frame. A smoke check that tried to assert
an 0.11 hip rise out of the saddle read **-0.039** on one code path because
the noise is the same order as the signal. **Any check wanting a small
displacement off this rig should pick a bone no clip translates, or measure a
large angle instead** (that check was replaced with the torso *fold* —
head-forward-of-hips, ~0.2m — which is far above the noise floor).

---

### Parenting anything into this rig inherits a 101x scale

Measured directly on the live skeleton: `WristR`'s **world scale is 101.45**.
The GLB has a scale of ~100 baked into the armature, and the character root's
own rescale-to-`PLAYER.modelHeight` does not undo it — it compounds with it.

Anything `add()`ed to a bone inherits that. `reins.js` sidesteps the problem
by refusing to parent at all (a rein spans both rigs anyway); round 3's
revolver cannot, because it has to follow the fist exactly, so `weapons.js`
measures `handBone.getWorldScale()` at attach time and divides it straight back
out. That is what lets `GUN.holdPosition` and `GUN.muzzleOffset` be written in
plain metres.

**A bone's rest orientation is equally unreadable** — this is a baked-IK rig,
so `WristR`'s axes are arbitrary (measured: its local +Z points
`(-0.89, 0.45, 0.09)` in the character's own frame, i.e. out to the side).
There is no sensible angle to guess for a held object. `GUN.holdRotation` was
**solved numerically** off the live skeleton: the bone-space rotation that
sends the gun's barrel axis onto the character root's forward axis. Do the same
for anything else placed in a hand — a rifle, a bottle, a lantern.

Useful measurements while you are there: wrist to knuckles is **0.146m** on
this rig, and the finger direction in the wrist's own frame is
`(-0.013, 0.109, -0.096)`.

## The horse rig

`RootNode` → `AnimalArmature`, with `Head`. 68 nodes, 1 skinned mesh. **No
hand/wrist bones.** The saddle point is a hand-tuned offset
(`HORSE.saddleOffset`), and the seat samples the spine bone `Torso2`
(`Body → Back → Torso → Torso2`) — see [HORSE.md](HORSE.md).

Materials on both rigs are flat named colours, no textures.

---

## What's missing, and what to fake

Of the clips rounds 1–7 need, only **`Reload`** is genuinely missing.

| Needed | player / bandit | horse |
|---|---|---|
| `Idle` | ✅ `Idle` (also `Idle_Neutral`) | ✅ `Idle` (+ `Idle_2`, `Idle_Headlow`) |
| `Walk` | ✅ `Walk` | ✅ `Walk` |
| `Run` | ✅ `Run` (+ `Run_Left/Right/Back`) | — |
| `Gallop` | — | ✅ `Gallop` |
| `Shoot` | ✅ `Gun_Shoot`, `Idle_Gun_Shoot`, `Run_Shoot` | — |
| `Reload` | ❌ **missing** | — |
| `Hit` | ✅ `HitRecieve`, `HitRecieve_2` | ✅ `Idle_HitReact_Left/Right` |
| `Death` | ✅ `Death` | ✅ `Death` |
| `Idle_Gun` / `Run_Gun` | ✅ `Idle_Gun`, `Idle_Gun_Pointing`, `Run_Shoot` | — |
| `Mount` / `Dismount` | ❌ missing (faked) | ❌ missing |
| `Jump` | ❌ missing (see below) | ✅ `Gallop_Jump` (+ `Jump_toIdle`, unwired) |

**Substitutions:**

- **`Reload` → fake** by bone rotation on `WristR` / `LowerArmR`. Round 3 owns
  this; not implemented.
- **`Mount`/`Dismount` → no clip.** Implemented round 2 as a 0.4s positional
  lerp onto the saddle point (`HORSE.mountLerpTime`); dismount is instant.
- **Seated riding posture → hand-authored**, `src/riding-pose.js`, round 2b —
  all 24 clips are standing or combat. This is the project's first successful
  hand-authored pose on this skeleton.
- **Horse jump → the clip is real, the arc is not.** `Gallop_Jump` supplies
  legs only; the ballistic arc is integrated in code. See [HORSE.md](HORSE.md).
- **Aiming and mounted shooting → a hand-authored pose layer**,
  `src/aim-pose.js`, round 3. Not a clip blend: the clips carry the *base*
  (`Idle_Gun_Pointing` when still, `Run_Shoot` when moving, on foot only) and
  the upper body is authored. The partial-skeleton split BUILD-PLAN.md asks
  for is done **by bone ownership**, not by mixing clip weights — riding-pose
  keeps the legs, feet, `Torso` and the left rein arm; aim-pose takes `Chest`,
  `Head`, the right arm and (on foot) the left support arm. Full reasoning in
  [DECISIONS.md](DECISIONS.md) ADR-024. `Gun_Shoot` and `Idle_Gun_Shoot` end
  up unused as a result.
- **`Reload` → the gun dips below frame**, per BUILD-PLAN.md's table, as
  angles on that same aim layer rather than as a separate bone hack.
- **Recoil → procedural after all.** This file used to say none was needed
  because `Gun_Shoot` is real. It is real, and it is still not used: one
  recoil that works both on foot and in the saddle beats a clip on foot plus
  a pose in the saddle. Same ADR.
- **Duel draw (round 6)** → `Idle_Gun_Pointing`.
- **Airborne on foot** → no clip. `ANIM.airTimeScale` slows whatever
  locomotion clip is playing. `character.setAirborne()` is a no-op on the real
  rig (the placeholder has its own procedural crouch).

---

## Hand-authoring a pose on this skeleton — the four rules

Learned building `riding-pose.js` (round 2b). Every one of these will apply
again to round 3's revolver grip and round 4's bandits.

1. **Capture a baseline and slerp back to it before applying angles.**
   `captureBaseline()` records every posed bone's rest rotation at load,
   *before the mixer has ever run*. `apply()` restores that, then applies the
   configured angles. Without this, a delta on a bone no clip rewrites
   compounds frame after frame: `Torso` is in no idle track, and the rider
   slowly folded over backwards until he lay flat on the horse looking at the
   sky. **The result must depend only on the configured angles, never on how
   long you have been posing.** Smoke guards this ("riding pose is idempotent
   across frames").
2. **Release explicitly.** Nothing puts a bone back that no clip owns. A
   dismounted rider kept the forward lean while standing still and only
   straightened once he walked (walk/run *do* animate `Torso`). `apply()` has a
   weight-0 branch that restores the baseline once and then stays out of the
   mixer's way. Also smoke-guarded.
3. **If you touch legs, re-place the feet.** `_placeFeet()` re-derives each
   foot from its shin every frame using a shin-relative transform captured at
   baseline. This is the live version of the `addVirtualParentTracks` idea from
   the removed retarget work.
4. **The two legs are not mirror images.** Measured on the live skeleton: the
   right hip sits **0.11** further forward than the left and its knee **0.25**
   further forward — in the bind pose *and* in every clip. A mirrored angle
   produces an unmirrored leg (the right knee ended up buried inside the
   horse). `RIDING_POSE.rightPitchTrim` / `rightSpreadTrim` / `rightKneeTrim`
   are the correction, solved numerically by grid search against the left leg's
   mirrored knee and foot — not eyeballed. A residual asymmetry remains: the
   right knee cannot quite reach the left's lateral reach, which is why smoke's
   straddle floor is 0.26 rather than the barrel's 0.30–0.33.

### Closing the hand — the finger roots are coincident

The obvious grip axis (the line across the knuckles) is the **zero vector** on
this rig: `Index1L` and `Pinky1L` sit at exactly the same world position. All
five digits are zero-length hub bones at the wrist, with the splay carried in
rotations.

`_captureGripAxes()` therefore derives each finger's hinge from the *fan* the
fingers make — their directions span the flat hand's plane, and each finger
hinges perpendicular to itself within it — and settles the bend direction from
which side of that plane the **thumb tip** lies on. That last part also gets
the mirrored right hand right with no per-hand sign.

Without a grip the rider holds the reins with two splayed open palms: the rest
pose is flat-handed and the idle clip curls only the left hand's fingers.
**Round 3's revolver grip reuses `_captureGripAxes()` / `_grip()`** rather
than re-deriving this — `aim-pose.js` holds a reference to the rig's
`RidingPose` and calls `_grip(curl, thumbCurl, ['R'])` for the gun hand alone
(the `sides` argument was added for exactly that). The grip is driven by a
`hold` weight *independent of the aim weight*, because the revolver is in the
fist whether or not it is raised (ADR-026) and the rest pose is a flat open
palm.

---

## Why retargeting is hard here

Every external rig you might import a clip from (Mixamo, other Quaternius
packs, anything) is a plain FK chain with the jump's vertical motion in
`Hips.translation`. On this rig that maps to **`Body`, not `Hips`** — writing
it to `Hips` animates literally nothing, because nothing downstream of `Hips`
is a leg. And the source clip carries no `Foot.L/R` tracks in `Root` space,
because on its own rig the feet were children of the shins.

So a foreign jump clip needs a hip remap **plus** synthesised `Foot.L/R`
translation+rotation tracks. **The difficulty was never the source clip — it
is the target rig, and it is identical for every source.**

This was built once (delta-from-rest quaternion retargeting +
`addVirtualParentTracks()` for detached bones), verified correct, and still
never read as good motion to the human. It was removed, and **the code is not
recoverable from git** — it lived and died inside one uncommitted session.
Full history and the "if it's ever revisited" advice:
[DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md#the-retargeted-jump-clip-built-verified-removed).

Cheaper directions than another retarget, if a player jump pose is ever wanted:

- Author it **in this rig's own idiom** — `Body.translation` + explicit
  `Foot.L/R` `translation`+`rotation` in `Root` space — optionally sampling
  `Roll` (1.33s, 58 channels, the only full-body airborne-ish clip on the
  correct skeleton, feet included) via `AnimationUtils.subclip`. No second GLB,
  no licence question, no retarget code.
- Or re-rig the Farmer mesh through Mixamo for the *whole* set at once, which
  also closes the `Reload` gap — see [ASSETS.md](ASSETS.md#the-mixamo-option)
  for the costs and why it is a human-side task.
