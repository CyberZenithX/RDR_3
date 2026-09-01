# ROADMAP.md — what each remaining round must watch out for

Forward-looking handoff notes. **BUILD-PLAN.md is the spec** — it says what
each round must build. This file says what will bite you while building it,
based on what already exists.

Rounds 0, 1, 2, 2b, 2c, 2d are done. Round 3 is next.

---

## Round 3 — guns

### 0. The horse can now jump, and Space is already taken

`horse-jump.js` reads Space **unconditionally whenever mounted**, which will
collide with any Space binding round 3 wants. `horse.jump.airborne` is the
flag. Open questions this round has to answer: firing mid-jump, reloading
mid-jump, whether Space should be read at all while aiming, and whether being
airborne carries an accuracy penalty (a natural companion to item 6's
`HORSE.mountedAccuracyPenalty`). The seated pose owns the arms during a jump
the same way it does at rest, so item 5's composition problem applies doubly
mid-air.

### 1. Mounted steering must narrow while aiming

`horse.js`'s `_updateMounted` currently reads full camera-relative WASD,
exactly like on-foot movement. BUILD-PLAN.md's round-3 text is explicit: "the
horse keeps steering with **A/D**" while aiming/firing — W/S, and probably
gallop, should be disabled or reduced in that state.

This needs round 3's aim/fire state (owned by whatever `combat.js` /
`weapons.js` becomes) to reach `horse.js`, which today has **zero** awareness
of combat. **Design that coupling deliberately** — a passed-in `aiming` flag,
or a shared mounted-combat state object — rather than reaching into private
fields from a new file.

### 2. Reload is disabled at a gallop — check the right signal

`horse.staminaExhausted` is **not** "currently galloping". Gate on
`horse.animState === 'gallop'`, or add a clear `horse.isGalloping` flag
(`this.speed` crossing `HORSE_ANIM.gallopThreshold` is the closest existing
proxy). Not stamina.

### 3. The revolver attaches to `WristR`

Source name `Wrist.R`; **runtime name `WristR`, dots stripped by
`GLTFLoader`** — re-read [ANIMATION.md](ANIMATION.md#runtime-vs-source-bone-names)
before writing the attachment, this cost a round already.

**The hand-closing problem is already solved**: reuse
`RidingPose._captureGripAxes()` / `_grip()` rather than re-deriving. The naive
grip axis (across the knuckles) is the **zero vector** on this rig. Note the
hands are flat-splayed at rest, so a gun in an ungripped hand will look wrong
by default.

`bandit.glb` shares the identical rig, so **write the attachment generically
against any loaded skeleton**, not hardcoded to the player.

### 4. Most shooting clips are real; `Reload` is not

`Gun_Shoot` / `Idle_Gun` / `Idle_Gun_Pointing` / `Run_Shoot` all exist — no
procedural recoil fake needed on foot. `Reload` is genuinely missing; fake it
per BUILD-PLAN.md's table (bone rotation on `WristR` / `LowerArmR`), or close
the gap properly via ADR-021.

### 5. Mounted shooting must compose with the seated pose

`riding-pose.js` owns the arms, spine and legs **every frame after the mixer
runs**, so a shooting pose cannot simply play a clip — the riding pose will
overwrite the arms immediately after. Two viable shapes:

- drive the arms from the combat state **through** the riding pose (pass an
  aim weight/target into `apply()` and let it own the blend), or
- split which bones each system claims.

Doing this well is the partial-skeleton blend BUILD-PLAN.md calls for
("spine-up from one clip, hips-down from the other"). **This project has
exactly one prior attempt at cross-clip/partial-skeleton blending — the
removed retargeted jump clip — and it was pulled after several tuning passes
never read as right.** Budget real time, and seriously consider whether a
simpler fake (play `Idle_Gun_Shoot` on the whole body while mounted, accept
some stiffness) is good enough first.

### 6. Mounted gating already has its flag

`player.mounted` is exposed. A `HORSE.mountedAccuracyPenalty`-style constant
belongs in `config-horse.js`, not `config.js` (ADR-009).

### 7. Audio may be unreachable

Try fetching `gunshot.ogg` / `reload.ogg` / `hit.ogg` yourself first;
`freesound.org` and `kenney.nl` are untested here, while several other asset
hosts are hard-blocked. If blocked, **say so plainly** — see
[ASSETS.md](ASSETS.md#what-this-environment-cannot-fetch).

### 8. `reins.js`'s strand builder is reusable

It writes square tubes along an arbitrary polyline into one shared buffer each
frame. Use it for a rifle sling, a holster belt, a hitching rope — and note it
is **the** pattern for anything spanning two skeletons, since parenting to a
bone inherits that rig's baked armature scale.

### 9. Shootable barrels and bottles are half-new ground

Follow `props.js`'s pattern (`InstancedMesh` beyond ~20 instances, a circle
collider per placement, **plus a real `top`** — a barrel is low enough to be
jumpable — and a `meta.kind`). But they need per-instance **destructible**
state, which rocks/cacti/trees don't, so that part is genuinely new, not reuse.

### 10. Aim mode should follow the `setMounted` pattern

A mode flag plus dedicated config fields (`CAMERA.aimDistance` / `aimFov` /
…), not hardcoded numbers inline in `camera.js`. **Aim and mounted can be
simultaneous**, so make the two modes compose rather than one silently
overriding the other.

### 11. Extend `scripts/smoke.mjs`

At minimum: a fired shot raycast registers a hit on a target placed directly
in front; ammo decrements and resets correctly across a reload; and something
machine-checkable about the muzzle-flash / raycast-origin empty actually being
parented to the gun barrel tip, **not** the camera. Read
[TESTING.md](TESTING.md) first — two harness gotchas there have each produced
a false pass.

### 12. New bindings go in `SMOKE-TEST.md`

Aim (right mouse), fire (left mouse), reload (`R`) — add them to the control
list.

---

## Round 4 — bandits

- `bandit.glb` shares `player.glb`'s **identical rig**, so everything in
  [ANIMATION.md](ANIMATION.md) applies unchanged — including the foot trap if
  bandits ever get a hand-authored pose.
- Bandits are the second **moving** collider. Follow the horse's pattern:
  `addCircleCollider` once, mutate `.x`/`.z` in place, never re-add/remove
  (see [ARCHITECTURE.md](ARCHITECTURE.md#collision-contract)).
- Characters keep the default `top: Infinity` — they should not be jumpable.
- Bandit camps must stay inside `BOUNDARY.playerLimit`.
- Check `player.mounted` before assuming the player is on foot with normal
  physics.
- ADR-010's duplicated helpers are up for review if bandits need the same
  shapes a third time.
- BUILD-PLAN.md's own warning: **round 4 will break the horse and neither of
  us will notice until round 7.** Re-run the whole `SMOKE-TEST.md` list.

## Round 5 — town

- Buildings are the first real users of `resolveBox` — written and
  unit-testable, no caller yet.
- Stay inside `TOWN.halfSize`; `PROPS.townKeepOut` already reserves scenery
  margin.
- Building colliders keep `top: Infinity`.
- This is the round that may want `groundHeightAt` to become genuinely
  different from open-terrain height (ADR-001) — it is already a separately
  named function for exactly this.

## Round 6 — bounties, duels, wanted

- Duel draw is `Idle_Gun_Pointing` (a real clip).
- `MESAS` entries are the landmarks a bounty callout can reference — "the camp
  near the twin mesa" needs no new placement system, just an entry index.

## Round 7 — polish

- Wind-swayed grass shader (grass is currently static geometry).
- The remaining audio.
- BUILD-PLAN.md's own priority note: if something must go, drop the minimap
  first, then the grass shader. **Do not drop the day/night cycle.**
- Everything in [HORSE.md](HORSE.md)'s "open issues and tuning levers" that
  the human hasn't ridden yet is fair game here — but fixing a reported break
  always comes first.
