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
Revisit only if round 4's bandits need the exact same shapes and the
duplication starts actually hurting.

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
