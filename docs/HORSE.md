# HORSE.md — the horse, the seat, and the rider on top of it

Everything about rounds 2, 2b, 2c and 2d. Read this before touching
`horse.js`, `horse-seat.js`, `horse-jump.js`, `riding-pose.js`, `reins.js`,
`config-horse.js`, or `player.js`'s mounted branch.

Related: [ANIMATION.md](ANIMATION.md) (rig mechanics, pose-authoring rules) ·
[ARCHITECTURE.md](ARCHITECTURE.md) (frame order, collision contract) ·
[DECISIONS.md](DECISIONS.md)

---

## The one rule that generated three separate bugs

> **"Where is this bone / seat / offset on this animal?" is always a question
> in the horse's own body frame. Never a world axis.**

The horse mesh rolls with `lean` and pitches with the jump, about its own
root, which is **at ground level**. Any measurement or offset taken in world
X/Y/Z is therefore wrong by an amount proportional to how hard the horse is
turning or jumping — invisible when it's standing still, which is exactly how
all three bugs shipped.

Concretely, the three places this is now done right:

| What | Wrong (shipped once) | Right |
|---|---|---|
| Saddle offset | built straight up from `position`, then yawed | side/up pair rotated by `lean` **before** the yaw (roll leaves the forward axis alone, so `saddleOffset.z` is untouched) |
| Rider's hip offset | subtracted straight down in world space | `_hipOffset.applyQuaternion(_rideQuat)` — along the *rider's* up axis |
| Spine-bone height | `boneWorld.y - root.position.y` | project the bone's offset onto the horse's own up axis (`root.quaternion` applied to `(0,1,0)`) |

Round 2d added a fourth: the seat also projects onto the horse's **forward**
axis, to track the spine longitudinally.

And a fifth, found in play after round 2d and fixed since: **the seat itself
was still being built in world axes.** `transform()` rotated the offset by the
bank and the yaw and stopped there, so the jump *pitch* — a third rotation
about the same ground-level root, up to 0.27rad — was simply missing from it.
It now builds the offset in the rig's own axes and turns it by
`character.root.quaternion`, which is the whole rotation in one step. See
[the jump section](#the-rider-was-swallowed-by-the-horse-at-the-apex).

### The measurements behind each (round 2c)

The reported symptom was one leg swinging horizontally into the air while the
rider slid toward the other side, the moment the human steered.

**The pose was not the problem — that was measured first, before touching
anything.** Sampling every posed bone's position in the rig's own local frame
across a straight run and a hard bank gave the same numbers to within
**0.006**. The pose is stable; the rigid placement wrapped around it was not.

1. **The saddle point did not bank with the horse.** A point `saddleOffset.y`
   up an axis rolled about a ground-level root sweeps `y·sin(lean)` sideways
   and drops `y·(1-cos lean)` — **0.64** and **0.10** at the 0.32rad limit.
   Measured mid-bank: the horse's back had moved **0.44** to the side and the
   rider only **0.21**. The barrel slides out from under the rider's legs.
2. **The rider's roll and pitch pivoted at the rig root, not at the seat.**
   `character.root.position` is the seat minus `hipHeight`, i.e. **~0.83 below
   the hips**, and the Euler is applied at the root — so rolling by
   `riderLean · lean` swung the hips `hipHeight·sin(roll)` sideways off the
   saddle. Predicted **0.209**, measured **0.200**, against a barrel only 0.33
   wide.
3. **The gait-bob sampler read world Y, so a bank read as the back dropping.**
   `boneWorld.y - root.position.y` is shortened by `h·(1-cos lean)` — measured
   **0.042** — which sank the seat a further **3cm** for the length of every
   turn and, worse, **pegged `saddleSway` at -1**, holding every gait-driven
   sway term in the riding pose at full deflection through the whole turn.

**The verification method — reuse it.** Express every rider bone in **the
horse's own banked body frame**: invert `horseRig.matrixWorld` and divide out
its baked scale. A correctly seated rider must read *the same at any lean*.
After the fix, at lean -0.09 vs -0.30: hips at side **-0.001 in both** (welded
to the saddle), boots within **0.034**, boot height gap **0.05** where it had
been **0.27**. Confirmed visually by before/after screenshots from directly
behind, and guarded by a smoke check verified to fail on the pre-fix code
([TESTING.md](TESTING.md)).

One ordering fix was taken while in there: `player.js`'s mounted branch now
writes `character.root`'s position **and rotation before** `character.update()`,
because `riding-pose.js` authors every angle in the root's own frame and
converts it through the root's live world rotation — posing first converted
this frame's angles through last frame's lean. A small skew before round 2c;
it would only have grown once the roll became meaningful.

*(Naming note: round 2c's fixes lived in `horse.js` as `_sampleSaddleBob()` /
`_boneHeightAboveRoot()`. Round 2d moved both into `horse-seat.js`'s
`_measure()`, which is where to look now.)*

---

## Model scale — hardcoded on purpose

`HORSE.modelScale = 0.58`, a constant in `config-horse.js`, **not** derived at
runtime from `measureHeight()`.

`horse.glb` measures 4.824 high × 5.676 deep by `Box3.setFromObject`. That is
not a reared bind pose and it is not fixable by playing a clip first — see
[ASSETS.md](ASSETS.md#measureheight-lies-on-skinned-meshes) for the full
investigation. The asset simply has an `AnimalArmature`/`Horse` node scale of
literally **100** baked in.

0.58 comes from the withers bone (`Torso2`, world Y ≈ 2.746 above the mesh's
true ground line ≈ -0.011) against a real-world target of ~1.6m at the
withers, and was visually confirmed against the player. **If a future round
swaps this model, redo the bone-world-position measurement** — do not trust
`measureHeight()` on any `SkinnedMesh`.

---

## Mounting

`H` whistles, `E` mounts/dismounts. `horse.js` reads both keys itself from
`input.js`, the same way `player.js` reads its own.

`handleMountToggle(player)` is **public, no underscore, deliberately** — it is
the entry point `scripts/smoke.mjs` calls to mount without simulating
pointer-locked input, which headless Playwright cannot produce as a trusted
gesture. `handleJump()` is the same pattern for the jump. Future debug entry
points should follow it rather than reaching into underscore-prefixed
internals from a test.

There is no mount clip on either rig. `getSaddleTransform()` eases the rider
from wherever they stood at mount time onto the true saddle point over
`HORSE.mountLerpTime` (0.4s); dismount is instant, no lerp.

**Mid-air dismount is refused.** `player.dismount()` resolves a ground-level
drop-off point, so stepping off at the top of the arc would teleport the rider
straight down. Ignoring the keypress for the 0.89s of flight is simpler and
better behaved than inventing a falling-rider state nothing supports.

---

## The seat — `horse-seat.js`

`HorseSeat` owns everything about *where the rider sits*.
`Horse.getSaddleTransform(outPos)` is the public wrapper and returns
`{position, yaw, blend, roll, pitch, sway, jump}` — everything the rider needs
to sit on and react to the animal underneath them.

### `HORSE.saddleOffset.y` is a SEAT height, not a root height

It is where the rider's **hips** go (2.06, later cross-checked against a
measured back surface of 1.88–1.97). `player.js` subtracts the rig's own
measured `hipHeight` — **scaled by the mount blend**, because taking a whole
hip height off at t=0 drops the player through the terrain for a frame — and
takes it along the rider's own up axis.

The value came from raycasting straight down onto the horse's **animated**
mesh. In three.js r160, `SkinnedMesh.raycast` applies bone transforms, so
unlike reading the geometry buffer (bind pose — put the back ~0.4 too high) it
hits the back you can actually see. **Use a raycast, never `Box3`/geometry
buffers, for any future question about where the surface of a skinned mesh
is.** Barrel half-width was measured the same way: **0.33** at its widest,
~0.30 at knee height.

### The seat rides the spine bone, not a fixed height

Measured by stepping each clip through its cycle and reading `Torso2`'s
height: the back travels **0.006** through idle, **0.058** through walk, and
**0.146** through gallop — and the *mean* height differs per gait too. Any
constant offset floats at one gait and sinks at another.

The rider takes `HORSE.saddleFollow` (**0.72**) of that travel; the rest reads
as the rider absorbing it. 1.0 looks like a sack of flour strapped on.

**That fraction is a gait number and does not survive the jump clip** —
`HORSE.jumpSaddleFollow` is **1.0** while airborne. See below.

The same signal drives the rein-hand and torso sway, so that motion is in
phase with the horse **by construction** rather than by a guessed sine wave,
and stays in phase when the clip's `timeScale` changes with speed.

### `drift` — the longitudinal fix (round 2d)

`Gallop_Jump` carries **1.146 world units of baked forward travel** on `Body`
(against 0.100 for `Gallop`). `Torso2` is `Body → Back → Torso → Torso2`, so
the entire back slides forward underneath a seat pinned to a constant
`saddleOffset.z` — the rider ends up over the rump halfway through the arc.
`horse-seat.js` therefore tracks the spine longitudinally too, clamped by
`HORSE.saddleDriftLimit`.

### Banking

`getSaddleTransform()` rotates the saddle offset about the horse's own
longitudinal axis by `this.lean`, matching what `character.root.rotation.z`
does to the mesh. Without it, a point `saddleOffset.y` up that axis sweeps
`y·sin(lean)` sideways and drops `y·(1-cos lean)` — 0.64 and 0.10 at the
0.32rad limit. Measured mid-bank before the fix: the horse's back had moved
0.44 to the side and the rider only 0.21. The barrel slides out from under the
rider's legs.

`HORSE.riderLean` (0.8) means the rider banks **20% less** than the horse.
That under-rotation is taken about the seat, so it leaves the boots ~4cm off a
perfectly barrel-locked path at full bank. That is the intended "rider stays a
little more upright" look. If exactness is ever wanted, bank the *rig* fully
with the horse and counter-roll `Torso` inside `riding-pose.js` (which already
rotates that bone in the root's frame) rather than under-rotating the whole
rider.

---

## The riding pose — `riding-pose.js`

`player.glb` has no seated clip (all 24 are standing or combat), so the pose
is built bone by bone. **Read [ANIMATION.md](ANIMATION.md)'s four
pose-authoring rules before changing any of it** — baseline capture,
explicit release, foot re-placement, and the rig's left/right asymmetry all
come from this file's development.

`apply(weight, sway, jump)` runs every frame *after* `mixer.update()`:

- `weight` — the mount blend. At 0 it restores the baseline once and stays out
  of the mixer's way.
- `sway` — the gait signal from the seat (see the open issue below).
- `jump` — layers the **two-point seat** on top: forward at the hip, knee
  closed, hands up the neck. The *vertical* half of coming up out of the
  saddle is not an angle at all — it is `HORSE.jumpSeatRise`, applied to the
  seat point in `horse-seat.js`.

Every angle lives in `RIDING_POSE` in `config-horse.js`, including the
right-leg trims and the `jump*` two-point angles.

`player.js` sets the rig's rotation with order **`'YXZ'`** so lean and
forward-carriage are taken about the rider's own axes rather than world ones.

---

## The jump — `horse-jump.js`

Space, while mounted. **The clip is not the jump.**

Measured straight off the GLB (channel by channel, `@gltf-transform/core`,
local translation × the 100 baked armature scale × `HORSE.modelScale`):
`Gallop_Jump`'s `Body` bone rises **0.231** world units across the whole clip,
against **0.134** for one ordinary `Gallop` stride. It is a leg tuck and a
lunge, not a jump.

So the arc is integrated in `horse-jump.js` exactly the way `player.js`
integrates the player's, and the clip is stretched over it
(`timeScale = duration / airTime`) so the tuck lands on the rise. **Do not try
to read lift out of a clip on this rig without measuring it first.**

`Jump_toIdle` is deliberately **left unwired** — it is a jump-to-*halt*
transition and would stop the horse dead on landing. Wiring it properly needs
a "was the throttle released" signal that does not exist yet.

### The numbers

| Quantity | Value | Source |
|---|---|---|
| `HORSE.jumpSpeed` | 7.6 | tuned |
| `HORSE.gravity` | -17 | tuned |
| apex | **1.70 m** | derived |
| air time | **0.89 s** | derived |
| `HORSE.bellyHeight` | **1.10** | measured |
| belly + apex reach | **2.68 m** | derived |

`bellyHeight` was measured, not guessed: raycast straight **up** into the
animated mesh. 1.10 at the narrowest point under the barrel, rising to 1.42
toward the quarters — the low reading is the one that matters. The same pass
read the back surface at 1.88–1.97 against the 1.98 `saddleOffset.y` was set
from, a useful cross-check that the method is sound.

Tuned against the **actual prop population**, not by feel (smoke prints these
every run): rock tops 0.6–3.6m, median **2.50**; cacti median 3.10; trees
5.20. So the jump clears **54% of rocks** and no cactus or tree at all. That
balance is intentional — small and medium rocks are jumpable, big boulders are
obstacles you ride around, and scenery is never passable.

`HORSE.jumpSpeed` is the single lever if the human wants it more generous;
much higher starts to look cartoonish (1.70m is already at the top of real
showjumping). "Make more rocks jumpable" could equally be answered by
shrinking `PROPS.rock.maxScale` — the rocks in this world are *large*, up to
3.6m tall with a 4.4m collider radius.

### The rider was swallowed by the horse at the apex

Reported from a play session after round 2d: *"sometimes the player seems to
merge into the horse during the horse-jump animation briefly, when the horse
reaches the peak."* Reproduced, measured and fixed. Screenshot before the fix:
from behind, the rider is gone — only a forearm shows through the barrel.

**The measurement that mattered was the seat bone's own travel.** Stepping each
clip through its cycle and reading `Torso2` in the horse's body frame, the way
the gait numbers above were taken:

| clip | `Torso2` travel (body frame) |
|---|---|
| `Idle` | 0.009 |
| `Walk` | 0.048 |
| `Gallop` | 0.144 |
| **`Gallop_Jump`** | **1.157** (−0.408 to **+0.750** against its captured rest) |

`Gallop_Jump` rears the whole forehand about a root pinned at ground level, so
it lifts the back **eight times** as far as a gallop stride does. Every
constant the seat used to cope with it had been set from the **0.231 quoted
above for the `Body` bone** — which is not the bone the seat samples. Three
errors stacked, all at their worst at the apex, because the clip is stretched
over `airTime` and so its own peak *is* the top of the arc:

| | at the apex | why |
|---|---|---|
| `saddleFollow` 0.72 applied to a 0.750 rise | −0.20 | the 28% a rider absorbs through hip and knee flex is a *stride*; nothing absorbs three quarters of a metre |
| `bob` clamped at `jumpBobLimit` 0.30 | −0.21 | the clamp was set below the travel it was clamping, so the seat pegged for six frames while the back kept rising |
| the seat never inherited `jump.pitch` | −0.09 and **0.35 forward** | the fifth world-vs-body-axis bug — the true saddle point slid up the withers toward the neck and the seat stayed put |

Measured end to end by raycasting down the horse's own up axis from the
rider's hips onto the animated mesh: grounded, the hips sit **0.10 above** the
back surface; at the apex they sat **0.61 below** it. After the fix the reading
never leaves −0.09..−0.18 for the whole arc (a little clearer than grounded,
which is `jumpSeatRise` doing its job). The rider now holds station on the
spine bone to within 0.01 fore/aft, where it had been 0.34 out.

**The horse itself still flies higher than `jumpSpeed` says**, and that is now
load-bearing: the clip's 0.75 body rise stacks on the integrated 1.51 arc, so
the *visible* back reaches ~2.3 above the ground the root is at. Nobody has
judged whether that reads as a good jump. Cancelling the clip's own rise
instead of following it is the other design available, and it would change how
the jump looks, so it is a human call. Note the collision side is unaffected
and conservative: `clearance()` uses `bellyHeight` measured at rest, so the
horse looks like it clears *more* than the rule lets it pass over, never less.

### The clearance rule

`clearance()` returns the world Y under which an obstacle passes beneath the
horse, and `horse.js` threads it into `resolveCollisions` as `clearY`.

**It returns `-Infinity` while grounded.** Gating on the belly height alone
would let a *standing* horse walk through any rock under 1.10m. On the ground
the collision list is honoured in full, exactly as before. Smoke asserts both
directions.

`HORSE.jumpClearMargin` trades clearable rocks against hooves clipping: only
the **barrel** is considered, and hooves hang below `bellyHeight`, so a rock
cleared by 5cm may show a hoof passing through it.

### Pitch, and the rotation-order trap

`horse.js` sets `rotation.order = 'YXZ'` **before** anything else. It
previously set only `.y` and `.z`, where the default `'XYZ'` happens to give
the intended roll about the horse's own longitudinal axis. Adding
`rotation.x` under `'XYZ'` takes the pitch about the **world** X axis, tipping
an east-bound horse sideways instead of nose-up. This is the identical trap
`player.js` hit in round 2c. **Any future code that adds a third rotation axis
to a character root on this project must set the order explicitly first.**

**Sign convention, written down so it is not re-derived:** the rig's local +Z
is the nose, and a positive rotation about X carries +Z *downward*, so
**nose-up is negative `rotation.x`**. `HORSE.jumpPitchTakeoff` /
`jumpPitchLanding` are stored positive and negated at the point of use.

### Space is shared between two jumps

`player.js` only reads Space in its on-foot branch, which the mounted branch
early-returns past — so a press held across a mount stayed buffered and fired
the instant the player dismounted. `mount()` and `dismount()` both clear
`_prevSpaceDown` / `_jumpBufferTimer`, and `HorseJump.reset()` does the same
on its side.

**Round 3 must decide what Space does while aiming** — `horse-jump.js`
currently reads it unconditionally whenever mounted.

---

## The camera while mounted

`tpCamera.setMounted(true)` swaps in `CAMERA.mountedDistance` /
`mountedPivotHeight` / `mountedSwayRun`.

**`main.js` must pass `horse.collider` as `ignoreCollider` while mounted.**
The horse's collider is persistent (it must block the player on foot and let
the horse avoid rocks), and while mounted the camera pivot sits right on top
of it, so every direction the occlusion sweep checks immediately "hits" it and
the camera collapses to `CAMERA.minDistance` — inside the rider's head. Found
by screenshot, not by reasoning. **Any future mountable entity with its own
persistent collider will hit this exact bug.**

Sway reuses `CAMERA.swayWalk` for the low end but has its own
`CAMERA.mountedSwayRun` for the high end, normalised against
`HORSE.gallopSpeed` rather than `PLAYER.sprintSpeed` — using the player's
sprint speed would under-scale sway at any horse speed above a human sprint,
which is most of them.

The pivot height is damped (`CAMERA.pivotFollowRate` = 11) so the 1.70m jump
reads as the camera being left behind rather than the whole world dropping.
Deliberately stiff, so terrain undulation is still followed essentially
exactly and on-foot framing is unchanged. `CAMERA.pivotSnapDistance` keeps a
teleport (respawn, dismount) from sweeping the camera across the gap.

---

## Tack — `reins.js`

`horse.glb` ships no bridle, reins, saddle, girth or stirrups. `Reins` builds
six straps (two reins, noseband, two cheekpieces, browband) as square tubes
into one shared buffer, rebuilt every frame from live bone positions.

Nothing is parented into either skeleton: a rein spans **both** rigs, and both
carry large baked armature scales a parented mesh would inherit.

Two things to keep in mind if this is extended:

- The bit rides the horse's **own head frame** (up toward the ears, side
  across them, forward from their cross product), so it tracks the head
  through every clip instead of sliding off when the horse lowers its head.
- The rein's Bezier control point is **lifted to clear the neck** — a straight
  run from bit to hands cuts through the crest as soon as the head drops,
  which it does hard at a gallop.

Reins run to the rider's fists while mounted and drape over the neck when not.
There is still **no saddle or stirrup geometry**: the rider's boots hang where
stirrups would be, holding nothing.

All dimensions live in `TACK` in `config-horse.js`, in the horse's head frame.

---

## AI, steering and stamina

`horse.js` branches every frame on `this.mounted`:

- `_updateUnmounted` — wander / follow / whistle AI.
- `_updateMounted` — WASD relative to the camera (`getForward()`/`getRight()`),
  gallop gated by stamina.

**`HORSE.staminaMax` is 1.5, not 1.** It was raised on the human's call after a
play session: a gallop runs **6.8s** from full (was 4.55s) and a full refill
takes **11.5s** (was 7.7s). The two exhaustion thresholds were deliberately
left absolute, so the post-exhaustion lockout stays ~1.7s however big the tank
gets rather than the punishment scaling with the buff. `jumpStaminaCost` is
absolute too, so a jump now costs proportionally less of the bar.

**Nothing outside `horse.js` may assume the tank is 1.** `ui.js` is generic and
documents its argument as a 0..1 fraction, so `main.js` hands it
`horse.staminaFraction`, not `horse.stamina` — passing the raw value rendered
the bar at 150% width, which is what happened on the first cut of this change
and is now guarded by a smoke check that reads the bar's rendered width.

Stamina drains only while galloping and gates whether a gallop request is
honoured. `staminaExhausted` is **not** the same signal as "currently
galloping" — for round 3's reload gate, check `horse.animState === 'gallop'`
(or `this.speed` against `HORSE_ANIM.gallopThreshold`), not stamina.

Lean-into-turns is `this.lean`, applied as `character.root.rotation.z`, from
`-yawRate * HORSE.leanFactor` clamped to `HORSE.leanMax`.

No vectors are allocated inside `update()`.

The horse's small helpers (`lerpAngle`, an accel/decel integrator, a
speed-hysteresis classifier) **duplicate** `player.js`'s rather than importing
shared versions — deliberate, see ADR-010.

---

## Open issues and tuning levers

**Nobody has ridden this.** Every number below was tuned from measurements and
static screenshots. The human's play session is the real test, and has caught
real bugs twice (rounds 2b and 2c both started as "this looks wrong in play").

| Area | Symptom to watch for | Levers |
|---|---|---|
| Horse AI feel | twitchy / sluggish / orbits too tight | `HORSE.wanderRadius`, `wanderIntervalMin/Max`, `followTriggerDistance`, `followSettleDistance` |
| Lean into turns | leans the wrong way, or not at all | sign on `-yawRate * HORSE.leanFactor` in `_turnToward()`, then `leanMax` |
| Stamina | gallop too short/long, recovery unclear | `staminaMax` (the tank, 1.5), `staminaDrainRate`, `staminaRegenRate`, `staminaExhaustedFloor`, `staminaExhaustedRecover` |
| Riding pose in motion | bob amplitude, forward carriage at speed | `HORSE.saddleFollow`, `riderLean`, `riderGallopPitch`, `riderBobSway`, `RIDING_POSE.sway*` |
| Jump feel | arc, 0.89s hang, pitch, camera lag | `jumpSpeed`, `gravity`, `jumpPitch*`, `jumpPoseBlendRate`, `jumpSeatRise`, `riderJumpFollow`, `RIDING_POSE.jump*`, `CAMERA.pivotFollowRate` |
| Horse's own height over a jump | the clip's 0.75 body rise stacks on the 1.51 arc, unjudged | `jumpSpeed`; or cancel the clip's rise rather than following it (a design change, see above) |

**`saddleSway` carries a large constant negative bias while moving, and
clips.** Found while measuring round 2c, *not* caused by it, deliberately left
alone. `_saddleBoneRestY` is captured once at load with the idle clip playing,
but the walk clip's *mean* back height is ~0.11 lower (~1.53 idle vs ~1.42
walk). Normalised by `saddleBobLimit` (0.16) that is a standing **-0.69
offset** on a signal meant to swing -1..1 — measured -0.63 to -0.85 across a
walk cycle, i.e. it spends the bottom of every stride clamped at -1. Effect:
`RIDING_POSE.swayElbow` (0.16 rad) holds the rein hands ~0.11 rad off neutral
for the whole ride, and the sway motion is flattened rather than symmetric.
`saddleBob` inherits the same offset, but there it is arguably *correct* — the
back really is lower at a walk. The honest fix is to make the sway signal
relative to a **running mean** of the bone height rather than a one-shot idle
capture; not done because it changes the feel of a system nobody has watched
in motion.

**A jump at a walk hangs as long as a jump at a gallop.** The arc is a fixed
impulse, so at 2.4m/s the horse covers ~2.1m of ground in the same 0.89s it
uses to cover 8.2m at a gallop, which will read as floaty. Deliberate —
scaling the arc with speed makes the clearance rule speed-dependent and much
harder to reason about. Cheap fix if it bothers the human: a higher
`HORSE.jumpMinSpeed` gate. Real fix: scale `jumpSpeed` with ground speed.
