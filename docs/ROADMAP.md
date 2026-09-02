# ROADMAP.md — what each remaining round must watch out for

Forward-looking handoff notes. **BUILD-PLAN.md is the spec** — it says what
each round must build. This file says what will bite you while building it,
based on what already exists.

Rounds 0, 1, 2, 2b, 2c, 2d, 3 are done. Round 4 is next.

---

## Round 4 — bandits

### 0. Almost everything a bandit needs already exists

Round 3 built its combat generically on purpose. Reuse rather than rebuild:

- `createRevolver(rig)` is written against **any** loaded skeleton and
  `bandit.glb` shares `player.glb`'s rig bone for bone, so arming a bandit is
  one call.
- `combat-ray.js` is the line-of-sight query. `raycastColliders` already
  answers "is there a rock between these two points, and how far along";
  BUILD-PLAN.md's three-raycast steering avoidance is the same function.
- `aim-pose.js` needs a `RidingPose` only for its grip machinery. A bandit
  that never rides still needs one constructed to capture the grip axes —
  or lift `_captureGripAxes()`/`_grip()` somewhere shared, which is the
  third-use trigger ADR-010 named.
- `vfx.js` and `audio.js` are global and pooled. A bandit firing costs no new
  allocation; `VFX` pool sizes were chosen for one shooter, so check them.
- `Combat` currently hardcodes `player` and `tpCamera`. **A bandit does not
  have a camera.** Either generalise `_resolveAimPoint()` (its only real
  camera use, plus `getRight()` for shell ejection) or give bandits their own
  smaller firing path that shares `combat-ray.js` and `vfx.js`. Decide before
  writing, not after.

### 1. Health does not exist yet

Nothing in the game has hit points. `targets.js` counts hits against a
`maxHits` and that is all. BUILD-PLAN.md's round-4 feel target — two body
shots kill a bandit, five hits kill the player — is a new system, and
`COMBAT.barrelHits`/`bottleHits` are the shape to copy, not to extend.

### 2. `combat.js`'s ignore Set is how a shooter avoids itself

The player's shots skip the horse's collider because the muzzle sits inside
it while mounted. Every bandit needs the same treatment against its own
collider, and `_ignore` is already a Set rather than a single reference for
exactly that reason.

### 3. Removing a collider is now a real operation

`targets.js` calls `removeCollider` when something is destroyed. Anything that
caches a collider reference across frames has to tolerate it disappearing —
a dead bandit's collider included.

### 3b. Two files are nearly at the 400-line cap

`riding-pose.js` is at **398** and `config.js` at **384**. Neither has room
for a round-4 addition. `riding-pose.js`'s obvious seam is the grip machinery
(`_captureGripAxes` / `_grip`), which `aim-pose.js` already borrows and which a
bandit would be the third user of — that is ADR-010's stated trigger. For
`config.js`, follow ADR-023: a `config-ai.js` for bandits, not a bigger
`config.js`.

### 4. The rig interface changed in round 3

`setLocomotion(state, speed, aiming)` grew an argument and `setAimPose()` is
new. Both placeholders implement them. Re-run the GLB-renamed placeholder
verification if round 4 changes the interface again — see
[TESTING.md](TESTING.md).

### 5. Space, and the rest of round 3's answered questions

For the record, so round 4 does not re-open them: firing mid-jump is allowed,
reloading mid-jump is not, Space still jumps while aiming, and being airborne
stacks `HORSE.jumpAccuracyPenalty` on the mounted one.

### 6. The original round-4 notes

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
  us will notice until round 7.** Re-run the whole `SMOKE-TEST.md` list — it is
  now long enough that this is a real sitting, not a glance.

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

- **The draw is already half-built.** ADR-026 says there is no holster: the
  revolver is permanently in the fist, and `aim-pose.js` takes a `hold` weight
  separate from its aim weight precisely so a real draw can animate it. The
  gun also has `setVisible()`. Neither is used yet.
- Duel draw is `Idle_Gun_Pointing` (a real clip).
- `MESAS` entries are the landmarks a bounty callout can reference — "the camp
  near the twin mesa" needs no new placement system, just an entry index.

## Round 7 — polish

- Wind-swayed grass shader (grass is currently static geometry).
- The remaining audio. `audio.js` plays **one-shots only**; round 7's four
  files are looping and mostly ambient, so it wants a `loop()` alongside
  `play()` rather than a reshape. The master mute on `M` maps to the existing
  `setEnabled(false)`.
  - **Add each new file to `AUDIO.maxOnsets`**, or the onset check will apply
    its default of 1 and fail every looping ambience immediately. A loop is
    not a one-shot and probably wants the onset assertion skipped entirely —
    decide that deliberately rather than by widening the number until it
    passes.
  - Round 3's audio bug is worth two minutes of your time before you fetch
    anything: a CC0 SFX file is very often several takes in a row, and
    `loudnorm` is the wrong tool for a transient
    ([ASSETS.md](ASSETS.md), [DEVELOPMENT-NOTES.md](DEVELOPMENT-NOTES.md)).
- **Round 3's whole feel is unjudged.** Everything in `SMOKE-TEST.md`'s
  round-3 block was tuned from measurements and static screenshots, exactly
  like the horse before it — and the horse's numbers caught two real bugs that
  way. Fixing anything the human reports comes first.
- BUILD-PLAN.md's own priority note: if something must go, drop the minimap
  first, then the grass shader. **Do not drop the day/night cycle.**
- Everything in [HORSE.md](HORSE.md)'s "open issues and tuning levers" that
  the human hasn't ridden yet is fair game here — but fixing a reported break
  always comes first.
