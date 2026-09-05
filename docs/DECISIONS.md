# DECISIONS.md — architecture decision records

Every non-obvious choice, why it was made, and what it costs. If you are about
to "clean up" something that looks odd, look for it here first — several of
these encode a bug that was already paid for once.

Status key: **Accepted** (current) · **Open** (unresolved / human-side) ·
**Superseded** (listed at the bottom with what replaced it).

---

### ADR-001 — `groundHeightAt` is analytic, not a mesh raycast — *Accepted*

**Context.** BUILD-PLAN.md's locked decision says "raycast onto the mesh".
Measured: two `Raycaster.intersectObject` calls per frame (player grounding +
camera occlusion) against the 256×256-segment terrain mesh — ~131k triangles,
no BVH, and three.js's stock `Raycaster` is a linear scan — dropped headless
chromium to **~3–4fps**.

**Decision.** `groundHeightAt(x,z)` calls `heightAt(x,z)` directly. The mesh's
vertices are themselves sampled from `heightAt` on an exact grid, so a real
raycast would land within a fraction of a unit everywhere except which
diagonal a quad splits on — not a gameplay-relevant difference.

**Consequences.** This is the project's one deliberate deviation from a
literal reading of a locked decision, and it is documented at the function
itself. It stays a separately named function (not an alias) so round 5's town
floors can make it genuinely different without renaming every call site. If a
future round adds a BVH library (`three-mesh-bvh`), a real raycast becomes
cheap and this can revert — **but that is a new runtime dependency against the
zero-deps rule, so raise it explicitly first.**

### ADR-002 — Camera occlusion is a heightfield march, not a raycast — *Accepted*

Same reasoning as ADR-001. `CAMERA.collisionSteps` samples of `heightAt` along
the pivot→camera segment, plus a cheap analytic segment-vs-circle test over
the collider list for props.

### ADR-003 — The world boundary is both a visual ridge and a hard clamp — *Accepted*

The ridge (`BOUNDARY.ridgeStart`→`ridgeEnd`, baked into `heightAt`, not a
separate mesh) is the "how the world ends" story. The clamp
(`BOUNDARY.playerLimit`, applied to XZ every frame, independent of terrain
shape) is the guarantee that no future terrain-tuning pass can let anything
reach the mesh edge and fall into the void. Belt and suspenders on purpose.
The horse is clamped by the same radius and the same formula.

### ADR-004 — Grass follows the player instead of being placed once — *Accepted*

A fixed-size `InstancedMesh` pool re-bucketed onto a world-space jittered grid
(deterministic per cell via hashing, so the same area looks the same if you
leave and come back) whenever the player moves `GRASS.recenterDistance`.
Placing grass once across a 1500×1500 world means either a tiny patch or
millions of instances; neither is right. It does **not** follow the horse —
round 5/7 territory if that's ever wanted.

### ADR-005 — Rotation conventions: yaw 0 faces −Z, and Euler order is explicit — *Accepted*

**Mesh-forward is −Z at yaw 0**, matching three.js/glTF's usual default, and
chosen so `SPAWN.yaw = 0` faces `MESAS[0]` (the landmark mesa at z=-400)
without offset math at the call site. `PLAYER.meshYawOffset` is the escape
hatch and is currently `Math.PI`; it must be applied by one textually
identical expression at every site (see
[DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md)).

**Any character root that takes a third rotation axis must set
`rotation.order` explicitly first.** Under the default `'XYZ'`, adding
`rotation.x` to a root that already uses `.y` and `.z` takes the pitch about
the **world** X axis — tipping an east-bound horse sideways instead of
nose-up. `horse.js` uses `'YXZ'`; `player.js`'s mounted branch uses `'YXZ'`.
This trap has now been hit twice, in rounds 2c and 2d.

### ADR-006 — Placeholder rigs are procedural, not baked clips — *Accepted*

BUILD-PLAN.md's "hand-built Bone hierarchy + SkinnedMesh + hand-authored
AnimationClips" was written for round 0's total-fallback scenario (no CC0
assets found anywhere), which didn't happen. For the narrower "this GLB
specifically failed to load" case, a `Group` of `CapsuleGeometry` meshes
animated by direct sinusoids of current speed is simpler, has no mixer/clip
machinery to keep in sync, and is easy to verify by reading.

**Cost:** limb segments visibly separate at the joints when bent (rigid
parenting, no smooth skinning). Accepted — this path never runs with the
current assets, and it is verified to keep the game playable
([TESTING.md](TESTING.md)).

### ADR-007 — three.js is vendored into the repo — *Accepted*

CDN-hosted three.js made `scripts/smoke.mjs` unrunnable in egress-restricted
sessions. `vendor/three/` holds 0.160.0's four needed files as committed
sources. Full story and the how-to-extend rules:
[DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md#cdn-threejs-made-the-smoke-test-unrunnable),
[ARCHITECTURE.md](ARCHITECTURE.md).

### ADR-008 — No player jump clip; airborne is `ANIM.airTimeScale` — *Accepted*

A real retargeted jump clip was built, debugged to correctness, and still
never read as good motion. It was removed rather than shipped broken.
`character.setAirborne()` is a no-op on the real rig. Full history:
[DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md#the-retargeted-jump-clip-built-verified-removed).

Investigated alternatives and why they don't help:

- **A Quaternius jump doesn't exist.** `player.glb`'s pack ships exactly the
  24 clips we already have — the poly.pizza export is the whole set. "A jump
  from Quaternius" means a *different pack*, i.e. a different skeleton, i.e.
  the same cross-rig retarget that was already rejected.
- **Mixamo is a better source but the same trap** — its rig is FK with the
  lift in `Hips.translation`, which maps to `Body` here, and it still needs
  synthesised `Foot.L/R` tracks. **The difficulty is the target rig, not the
  source clip.**
- **The one Mixamo play worth making is not a jump clip** — see ADR-021.

### ADR-009 — Horse tunables live in `config-horse.js` — *Accepted*

Split out purely to keep `config.js` under BUILD-PLAN.md's 400-line cap — the
same pattern BUILD-PLAN.md itself names ("player.js into player.js +
player-anim.js"). Still just numbers, no logic. Round 3's
`HORSE.mountedAccuracyPenalty`-style constants belong here, not in
`config.js`.

### ADR-010 — Small helpers are duplicated between player and horse — *Accepted*

`lerpAngle`, the accel/decel integrator and the speed-hysteresis classifier
exist in both `player.js` and `horse.js` rather than in a shared module. Each
is under 10 lines, the horse's version has horse-specific thresholds baked in,
and this project prefers three similar lines over a premature abstraction.
**Reviewed in round 4 and left alone.** `bandit.js` is the third copy of
`lerpAngle` and of the accel/decel integrator, and the second of `bell()` — all
still under ten lines, all with different constants. What round 4 did *not*
duplicate is the one thing that would have hurt: the grip machinery. A bandit
rig constructs a `RidingPose` it never rides with, purely because `AimPose`
borrows `_captureGripAxes()` / `_grip()` from it — reuse of one object, not a
third copy of the maths, so the trigger this ADR named was not pulled.

### ADR-011 — Test entry points are public methods — *Accepted*

`Horse.handleMountToggle(player)` and `Horse.handleJump()` carry no underscore
**deliberately**: they are what `scripts/smoke.mjs` calls to exercise mounting
and jumping without simulating pointer-locked input, which headless Playwright
cannot produce as a trusted gesture. Same spirit as poking
`window.__debug.tpCamera.yaw` for screenshot framing. Future debug-callable
entry points should follow this pattern rather than having tests reach into
underscore-prefixed internals.

### ADR-012 — Colliders carry a `top`; `resolveCollisions` takes a `clearY` — *Accepted*

**Context.** `collision.js`'s circles were 2D and treated as infinitely tall,
so **nothing in this world could ever be jumped over** — the horse jump would
have been a purely cosmetic hop. This, not the animation, was the real work of
round 2d.

**Decision.** `top` defaults to `Infinity` (the old behaviour, so every
existing caller is unchanged); `clearY` defaults to honouring the whole list.
Props derive `top` from their own geometry bounding box, which is exact
because every prop geometry here is authored with its base at local y=0.

**And the clearance is gated on being genuinely airborne, not on belly
height.** `HORSE.bellyHeight` is 1.10, so "skip anything under the belly"
would let a *standing* horse walk through any rock under a metre.
`clearance()` returns `-Infinity` while grounded. Smoke asserts both
directions.

### ADR-013 — The seat rides the horse's spine bone, measured in the body frame — *Accepted*

A constant saddle height floats at one gait and sinks at another (the back
travels 0.006 / 0.058 / 0.146 through idle / walk / gallop, with different
means). The seat samples `Torso2` and takes `HORSE.saddleFollow` (0.72) of
that travel; the same signal drives rein-hand and torso sway, so that motion
is in phase with the horse **by construction**.

**0.72 is a gait fraction and applies only on the ground.** `Gallop_Jump` moves
that same bone **1.157** in the body frame — eight times a gallop stride —
because it rears the forehand about a ground-level root. `HORSE.jumpSaddleFollow`
is therefore **1.0** while airborne: nothing a rider does absorbs three quarters
of a metre, and following less is the horse's back rising through them.
`jumpBobLimit` is a safety clamp above that measured travel, not a lever.

**Every such measurement is a projection onto the horse's own up (and, since
round 2d, forward) axis — never a world axis.** Measuring world Y makes a bank
read as the back dropping. Details and the three bugs this fixed:
[HORSE.md](HORSE.md).

### ADR-014 — `saddleOffset.y` is a seat height; rider offsets are along the body's up axis — *Accepted*

`HORSE.saddleOffset.y` is where the rider's **hips** go, and `player.js`
subtracts the rig's measured `hipHeight` — **scaled by the mount blend**
(subtracting it outright drops the player through the ground on the first
frame) and **rotated into the rider's own frame** (`applyQuaternion`), so roll
and pitch pivot at the seat rather than at the rig root a hip-height below it.

**Generalises**: `character.hipHeight` is a distance along the *seated body's*
up axis, not the world's. Anything that seats a character on a moving, banking
body needs this.

### ADR-015 — `HORSE.modelScale` is a hardcoded constant — *Accepted*

0.58, derived once from a bone-world-position measurement, not from
`measureHeight()` at runtime — which cannot work for this rig
([ASSETS.md](ASSETS.md#measureheight-lies-on-skinned-meshes)). If the model is
ever swapped, redo the measurement.

### ADR-016 — `main.js` calls `horse.update()` first and reads `player.mounted` fresh — *Accepted*

The natural-looking alternative (branch on `horse.mounted` *before* calling
`horse.update()`) is a real same-frame bug: a dismount flips the flags and
computes the drop-off inside that call, but the outer branch has already
committed to the mounted path and overwrites it with a stale saddle-sync,
which `player.update()` then runs on-foot physics from. **If this ordering is
ever "cleaned up", re-verify that a dismount doesn't teleport the player back
onto the horse for one frame.**

### ADR-017 — The mounted camera must ignore the horse's own collider — *Accepted*

Otherwise it collapses to `CAMERA.minDistance`, inside the rider's head. Any
future entity that is both a camera pivot and a persistent collider needs the
same treatment. Root cause:
[DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md#the-mounted-camera-collapsed-into-the-players-head).

### ADR-018 — Mount/dismount are faked; `Jump_toIdle` stays unwired — *Accepted*

Neither rig has a mount or dismount clip, so `getSaddleTransform()` eases the
rider onto the saddle point over `HORSE.mountLerpTime` (0.4s) and dismount is
instant. `Jump_toIdle` exists but is a jump-to-**halt** transition: landing
into it would stop the horse dead. Wiring it needs a "was the throttle
released" signal that doesn't exist yet.

### ADR-019 — The jump arc is a fixed impulse; mid-air dismount is refused — *Accepted*

Scaling the arc with ground speed would make the clearance rule
speed-dependent and much harder to reason about, so a jump at a walk hangs as
long as a jump at a gallop (see [HORSE.md](HORSE.md) for the cheap fix if that
reads as floaty). Dismounting mid-air is **ignored** rather than handled,
because `player.dismount()` resolves a ground-level drop-off and stepping off
at the apex would teleport the rider down; refusing for 0.89s is simpler and
better behaved than inventing a falling-rider state nothing supports.

### ADR-020 — The horse is three files, not one — *Accepted*

`horse.js` was at 397 lines against the hard 400 cap, and the jump wiring
alone would have taken it past 450. Splitting only the jump out would have
left it at ~375 with no room for round 3's combat coupling, so the seat came
out too. The split follows a real seam: **`horse-jump.js` is the vertical
axis, `horse-seat.js` is the rider interface, `horse.js` is everything
horizontal.**

### ADR-021 — A Mixamo re-rig is the sanctioned path for the animation gap — *Open, human-side*

Not "import a jump clip" — re-rig the Farmer mesh through Mixamo's auto-rigger
and take the **whole** animation set on the Mixamo skeleton as a new
`player.glb`. Then there is no retargeting anywhere, and it also closes the
**`Reload` gap round 3 genuinely has**.

**Costs:** an Adobe login and Blender (Mixamo exports FBX/Collada, never
glTF); the repo stops being 100% CC0 (Mixamo is royalty-free but forbids
redistributing raw character/animation files as standalone assets —
committing the GLB to a public repo is a grey area worth the human's own
read); and `bandit.glb` must be swapped with it or the two humanoids stop
sharing a rig, which round 4 assumes.

BUILD-PLAN.md's appendix explicitly sanctions this as a ~40-minute manual
human task. It is **not** something Claude can do unattended here:
`mixamo.com` and `helpx.adobe.com` are 403'd by the egress proxy and there is
no Blender/FBX toolchain installed. **If it happens, do it once, for the whole
set, before round 3 — not for a jump.**

### ADR-022 — Documentation is a small index plus deep docs — *Accepted*

`CLAUDE.md` had grown past 120k characters — larger than the entire `src/`
tree — so every session paid for all of it whether or not the round touched
animation, or the horse, or the test harness. It is now a ~15k index: rounds
completed, the file map, the invariants a session must know *before* it can
safely start reading code, and pointers into `docs/`.

**Rule for future rounds: new detail goes in the matching `docs/` file, and
`CLAUDE.md` gets at most a line.** If a fact is only safe when read *before*
touching a file, it belongs in that file's "Before modifying" block in
`CLAUDE.md`; everything else belongs in `docs/`. The failure mode this guards
against is the old one — a handoff note nobody can afford to read in full.

### ADR-023 — Combat tunables live in `config-combat.js` — *Accepted*

The same split ADR-009 made for the horse, for the same reason and with the
same rule. `config.js` was at 354 of BUILD-PLAN.md's 400-line cap before round
3, and combat is the largest single block of tunables in the game (the gun,
ballistics, the aim pose, six kinds of effect, the target range and the audio).

**Decision.** `src/config-combat.js` holds `GUN`, `COMBAT`, `AIM_POSE`, `VFX`,
`TARGETS` and `AUDIO`. `config.js` keeps the round-3 numbers that belong to
systems it already owned — `CAMERA`'s aim framing, `PLAYER.aimTurnRate`, the
gun entries in `CLIP_CANDIDATES` / `CLIP_REFERENCE_SPEED`.

**The dividing line, restated:** a number lives with the *system it is a
property of*, not with the round that introduced it. So the mounted and
airborne accuracy penalties are in **`config-horse.js`**, because they are
properties of shooting from a horse, not properties of the gun — a rifle added
in round 6 would use the same penalties unchanged.

BUILD-PLAN.md's rule is "every tunable in one findable place", and three files
named after their systems still satisfies it. Four would start not to; if
round 5 needs another, consider whether it is really a new system first.

### ADR-024 — Aiming is a hand-authored pose layer, not the rig's shoot clips — *Accepted*

**Context.** `player.glb` ships `Gun_Shoot`, `Idle_Gun`, `Idle_Gun_Pointing`
and `Run_Shoot` — real, good clips. ANIMATION.md's own substitution table says
no procedural recoil is *needed*. Using them for the whole of aiming looks
like the obvious call.

**Decision.** The clips carry the **base** — `character.js` swaps in
`Idle_Gun_Pointing` / `Run_Shoot` underneath while aiming on foot, so the legs
and stance are real animation. The **upper body** is a hand-authored pose,
`src/aim-pose.js`, applied after the mixer in exactly riding-pose.js's idiom.
Recoil and the missing `Reload` are angles on that same layer.

**Why.** Three reasons, in order of weight:

1. **A clip points where it was authored.** Round 3's aim mode is
   over-the-shoulder with a crosshair; a gun that ignores the camera's pitch
   is not aiming, it is posing. Only a driven pose can track the crosshair.
2. **A full-body shoot clip cannot coexist with the seated riding pose**,
   which reclaims the arms every frame after the mixer runs. Mounted shooting
   is explicitly not optional in BUILD-PLAN.md, so a clip-only path would need
   a second, different implementation for the saddle. One layer that works in
   both places beats two that each work in one.
3. **This project has one success and one failure at this.** The failure was
   cross-clip retargeting (ADR-008, removed after several tuning passes). The
   success was `riding-pose.js`. ROADMAP.md's round-3 notes said to budget
   real time for the blend and to consider the simpler shape first; this is
   that shape.

**Consequences.** The partial-skeleton blend BUILD-PLAN.md asks for
("spine-up from one clip, hips-down from the other") is done **by bone
ownership** rather than by mixing clip weights: riding-pose.js owns the legs,
feet, `Torso` and the left rein arm; aim-pose.js owns `Chest`, `Head`, the
right arm and — on foot only — the left support arm. The two never write the
same bone in the same frame with different intentions, so there is no blend to
tune. `Gun_Shoot` and `Idle_Gun_Shoot` end up unused; round 6's duel draw
still has `Idle_Gun_Pointing` available as a real clip.

**The cost:** the aiming upper body is authored numbers, not animation, so it
is only as good as those numbers — and nobody has watched it move. It is on
`SMOKE-TEST.md` for the human.

### ADR-025 — Shots are analytic against colliders and the heightfield — *Accepted*

**Context.** BUILD-PLAN.md says "raycast hit detection". The same measurement
behind ADR-001 and ADR-002 applies: the terrain is 131k triangles with no BVH,
props are `InstancedMesh`, and `THREE.Raycaster` is a linear scan.

**Decision.** `combat-ray.js` tests colliders as upright cylinders (circle +
the `top` ADR-012 already gave them) and marches the analytic `heightAt` for
the ground, taking the nearest hit. No mesh raycast anywhere in the shot path.

**Why it is not a compromise here.** Every collider already carries the world
Y of its own top, which is exactly the height a shot has to clear — so rocks,
cacti, trees and barrels became shootable with no new registration at all.
The march's step **grows with distance** (a shot 3m away wants centimetre
precision, one 200m away does not) and the crossing is bisected afterwards, so
a 220m shot costs ~90 height samples rather than ~370.

**The known inaccuracy:** a collider circle is not the prop's silhouette, so a
shot can clip the corner of a rock's collider without visually touching the
rock — the same approximation the player already walks into. Bottles stand on
barrel lids and are therefore *not* grounded, which the collider list cannot
express (its cylinders implicitly run to the ground), so `targets.js` ray-tests
its own items with an explicit base and runs before the collider pass.

### ADR-026 — The revolver is always in hand; there is no holster — *Accepted*

BUILD-PLAN.md asks for the gun to be attached to the hand bone and never
mentions holstering, and no round needs a drawn/holstered distinction until
round 6's duel — which is about *timing the shot*, not about where the gun was
a second earlier.

**Consequences.** `aim-pose.js` takes a `hold` weight separate from its aim
weight, applied even at weight 0: this rig's rest pose is a flat splayed palm,
so without a permanent grip the revolver sits in an open hand any time the arm
is down. If round 6 wants a real draw, `hold` is already the parameter to
animate, and the gun's `setVisible()` is already there.

### ADR-027 — `config-ai.js` holds the bandits **and** the health model — *Accepted*

The fourth config file, and ADR-023 warned that four "would start not to"
satisfy BUILD-PLAN.md's one-findable-place rule. It is still the right split:
`config.js` was at 384 of the 400-line cap, bandits are unambiguously a new
system, and docs/ROADMAP.md named this file in advance.

The real question was `HEALTH`. Player hit points are not obviously a property
of the bandits. But they are not a property of the *gun* either (a rifle in a
later round would not change how much a man can take), and `config.js` had no
room. What decided it: BUILD-PLAN.md states the target as **one sentence** —
"two body shots kill a bandit, five hits kill the player" — so player health,
bandit health and both damage numbers are one tuning knob with four dials on
it. Splitting them across two files to satisfy a filing rule would make the
one thing the human actually wants to retune harder to find, which is the
opposite of what the rule is for.

`HEALTH` also carries the death timings (`tipTime`, `sink`) that
`placeholder-human.js` reads, on the same reasoning: how long a body takes to
go down is a property of dying, not of a rig.

**Round 5 should not add a fifth.** If the town needs tunables, a
`config-town.js` is the fifth file — which is the point at which "every
tunable in one findable place" is worth re-reading rather than re-applying.

### ADR-028 — Bandits get their own firing path, not `combat.js` — *Accepted*

**Context.** docs/ROADMAP.md asked for this decision to be made *before*
writing: "`Combat` currently hardcodes `player` and `tpCamera`. **A bandit does
not have a camera.** Either generalise `_resolveAimPoint()` … or give bandits
their own smaller firing path."

**Decision.** Their own, in `bandit.js` — about forty lines over the parts that
were already generic: `weapons.js` (the revolver attaches to any skeleton),
`combat-ray.js` (the geometry query), and the pooled `vfx.js` / `audio.js`.

**Why.** Half of `Combat` is the *player's* half and has no bandit meaning:
`_resolveAimPoint()` exists because a third-person crosshair is not where the
gun is, `addRecoil` shakes a camera, `poseState()` feeds a HUD, `_ejectShells`
needs `tpCamera.getRight()`, and the reload gate reads the horse. Generalising
it would have meant threading a null camera through all of that, in a file
already at 350 of the 400-line cap. What a bandit actually needs — a muzzle, a
spread cone, a ray, a hit — is small, and it needs its *own* accuracy model
anyway (BUILD-PLAN.md: "bandits miss often enough that standing in the open is
survivable for a few seconds but stupid").

**Consequences.** Two `_applySpread` implementations and two `bell()`s, both
under ten lines, both covered by ADR-010. `combat.js` grew by fifteen lines: a
`bandits` dependency, one extra `raycast` in the shot path and one in the aim
path, and a `hearShot` broadcast. If round 6's duel needs a third shooter,
*that* is the moment to extract a shared `fireShot(origin, dir, ignore)`.

### ADR-029 — A hand-written skinned clone, not `SkeletonUtils` — *Accepted*

Eleven bandits share one 1.37MB `bandit.glb`. `Object3D.clone()` cannot do
that alone: it copies a `SkinnedMesh`'s `skeleton` **by reference**, so every
clone would be driven by the original's bones and the whole camp would move as
one body. three.js ships `SkeletonUtils.clone()` for exactly this — and it is
not in `vendor/three/`, and this session cannot fetch it (CLAUDE.md's
environment facts).

The alternative was loading the GLB once per bandit: correct, and eleven
copies of every buffer in RAM and on the GPU. `src/rig-clone.js` is twenty
lines of well-understood bone remapping instead, guarded by a smoke check that
was confirmed to fail with the rebind reverted ("two bandits share one
Skeleton object"). Materials and geometry stay shared by reference, which is
the whole memory win — and is why a bandit's hit reaction is the `HitRecieve`
clip rather than BUILD-PLAN.md's "colour flash on the material", which would
light up all eleven at once.

If a later round vendors another addon, `SkeletonUtils` is worth taking at the
same time and this file can go.

### ADR-030 — Respawn stands off from the camp rather than landing in it — *Accepted*

BUILD-PLAN.md: "respawn at the config spawn point, or at the last bandit camp
you approached, whichever is nearer." Read literally, that puts the player
back in the middle of the four men who just killed them, at full health,
inside their sight range — a death loop, not a checkpoint.

So "at the camp" is a stand-off ring `BANDIT.respawnStandoff` (55m) out on the
**town side** of it, which is also the way home. That is outside
`BANDIT.fireRange` (45) but inside `BANDIT.campApproachRadius` (70), so the
camp stays armed as the checkpoint rather than un-arming itself the moment it
is used. The smoke check asserts both bounds, because a stand-off that drifts
outside the approach radius is the spawn point with extra steps.

The spirit of the requirement — do not make a player ride 400m back to a fight
— is kept intact. `player.respawn()` remains the single function round 7
replaces.

### ADR-031 — `groundHeightAt` finally differs from `heightAt`: floor plates — *Accepted*

Round 1 split `groundHeightAt` out of `heightAt` as a named seam and noted "in
case a later round needs it to differ, e.g. round 5 town interiors with a floor
height". Round 5 is that round: the boardwalks and the saloon's floorboards
stand `TOWN_BUILD.floorStep` (0.22m) above the dirt.

The mechanism is a list of **floor plates** — rotated rectangles carrying a
world Y — registered by `buildings.js` and honoured only by `groundHeightAt`.
`heightAt` stays pure, so the terrain mesh, the prop scatter and the grass are
untouched by the town's existence.

Two things make this cheap enough to sit in a function the player, the horse and
eleven bandits call every frame: one AABB around the whole plate cluster rejects
every caller who is not in town in four comparisons, and there are eleven plates,
not eleven hundred.

**A plate is a surface, never a collider.** A 22cm step registered as an obstacle
would be an invisible wall down the whole street frontage; as a plate, an agent
walks up onto it with the ordinary `PLAYER.groundSnap` (0.35) and nothing else in
the game has to know it happened.

---

### ADR-032 — A bullet stops at a wall: `raycastBox` — *Accepted*

`raycastColliders` skipped boxes outright (`col.type !== 'circle'`). That was
harmless for four rounds because a building's collider was the only box in the
game and a shot at one was resolved by the terrain behind it. The saloon's
interior ends that: docs/ROADMAP.md flagged it before the round started — "a
shot fired inside the saloon will go straight through the walls until that is
written."

`raycastBox` is a slab test in the box's own frame, with the Y slab running from
`-Infinity` to the collider's `top` — the same reading `raycastCylinder` gives a
grounded collider. You cannot shoot under a wall, and `top: Infinity` (which
every building keeps, per the collision contract) means you cannot shoot over one
either. A ray whose origin is already *inside* a box reports the exit face rather
than a hit at zero distance: a shooter pressed against a wall with the barrel
poking into it should spark on the far side, not inside their own hand.

The same gap existed in **`camera.js`'s occlusion sweep**, and mattered more
there: with the pivot inside the saloon and the camera outside it, the shot is
framed on the back of a wall. `segmentBoxHit` closes it.

While fixing this, `collision.js`'s `resolveBox` had its rotation convention
**flipped** to match: `rot` now means what `Object3D.rotation.y` means. It had no
caller, and every building in town sits at 0, ±π/2 or π where a box is symmetric
enough that the two conventions are indistinguishable — so it was corrected
rather than documented as a trap. The smoke check that guards it uses a
deliberately non-cardinal box for exactly that reason.

---

### ADR-033 — The town is one merged, vertex-coloured mesh — *Accepted*

Round 4 left the draw-call budget as the binding constraint and docs/ROADMAP.md
was explicit: "instance or merge by material from the start rather than as a
rescue." Ten buildings, eight lamps, the boardwalks, a hitching rail and a
saloon's furniture, split by material (planks, roof, trim, stone, paint), is five
or six meshes — doubled again by the shadow pass.

So the town does what `rig-merge.js` does to a character: every part's flat
colour is baked into a `color` attribute and the whole lot is merged into **one**
geometry drawn with one white `vertexColors` material, plus one more for the
glass (which needs transparency and therefore its own material). Measured: **55
draw calls standing in the middle of the street**, 58 at spawn, against
BUILD-PLAN.md's ~120 — the town itself costs about four.

The cost is that the town is one object with one bounding box, so frustum culling
can never skip part of it. That is the right trade at this scale: it is a few
thousand triangles either way, and a triangle drawn needlessly is far cheaper
than a draw call issued needlessly. `town-geo.js`'s `PartBuilder` is the tool,
and it is reusable — round 6's bounty board and round 7's props should go through
it rather than adding meshes.

**The shop signs are the third mesh, and the same argument put twice.** The
human's note on the first pass was that it was "hard to even identify what each
building is supposed to be": every sign was a blank coloured board. Lettering
needs a texture, and a textured surface cannot join a merge whose material has
no `map` and whose geometry has no UVs — so ten signs would have been ten
materials, ten meshes and ten more shadow draws.

Instead every sign's face is drawn into ONE canvas atlas (`signs.js`), one
horizontal strip per building, and each sign quad is given UVs pointing at its
own strip. `PartBuilder` gained a `textured` mode that keeps `uv` and drops
`color`; the signs go into their own builder and their own merge, and **the
whole town's signage is one draw call**. The board colour is baked into the
cell behind the lettering, so the quad is opaque — no blending, no sorting, no
second pass. Measured: 55 draw calls became 56.

---

### ADR-034 — Townsfolk are `player.glb` with cloned materials — *Accepted*

There is no third humanoid GLB and none can be fetched (docs/ASSETS.md), so the
townsfolk had to be the player's model or the bandit's. Dressing them in the
**enemy** silhouette would put five men who read as bandits in the middle of
town, in a round whose whole job is making the town read as a place — so they are
`player.glb`.

That leaves five identical twins, which is why each body clones its own
**materials** (not its geometry) and multiplies a per-person tint through them.
This is safe here and forbidden on a bandit for one reason: `cloneRig` shares
materials by reference, so recolouring in place would change every body at once —
that is why a bandit's hit reaction is a clip rather than a colour flash
(ADR-029). Cloning first is what makes it per-person; geometry stays shared,
which is where the memory actually is.

They are unarmed via `weapon.setVisible(false)` — the first caller of a switch
`weapons.js` has carried unused since round 3 — and they carry `Health` and are
shootable, because round 6's wanted level is built on shooting innocents and an
invulnerable prop is a worse foundation than a man who bleeds.

---

---

## Superseded decisions

| Decision | Why it changed |
|---|---|
| Rider stands in the `idle` pose at the saddle point (round 2) | Read as a man standing on a horse in real play. Replaced round 2b by a hand-authored seated pose (`riding-pose.js`). |
| A retargeted `Man_Jump` clip for the player (post-round-1) | Never read as good motion after several honest tuning passes. Removed; ADR-008. |
| three.js loaded from `cdn.jsdelivr.net` | Blocked by the egress proxy, which made the smoke test unrunnable. Vendored; ADR-007. |
| A single `PROPS.rock.colliderFactor` of 0.8 | Smaller than the rock's own base radius — the player could walk metres into large rocks. Replaced by per-variant measured `colliderFactors`. |
| `measureHeight()` without `updateMatrixWorld(true)` | Returned 63.8 instead of 1.83 and rendered the player at 5cm. |
| `PROPS.rock` geometry displaced before `mergeVertices()` / with UVs intact | Tore the mesh open at every seam, then left a structural notch. |
