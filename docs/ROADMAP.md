# ROADMAP.md — what each remaining round must watch out for

Forward-looking handoff notes. **BUILD-PLAN.md is the spec** — it says what
each round must build. This file says what will bite you while building it,
based on what already exists.

Rounds 0, 1, 2, 2b, 2c, 2d, 3, 4 are done. Round 5 is next.

---

## Round 5 — town

### 0. What round 4 leaves you

- **The draw-call budget is now the binding constraint.** 39–45 at spawn,
  **110** with one bandit camp, its signal fire, the horse and the player in
  frame, against BUILD-PLAN.md's ~120. Ten buildings on a street is exactly the
  kind of thing that spends the rest of it. Two smoke checks watch the number
  now (at spawn and at a camp); add a third at the town when it exists, and
  instance or merge by material from the start rather than as a rescue. Round
  4's own rescue — merging the revolver's seven part-meshes into three — is the
  worked example, and the signal fire immediately spent four of what it saved.
- **`campfire.js` is a reusable light/particle rig, not just a bandit thing.**
  Round 5's "lamps and interior lights that will matter in round 7" can take
  its flame tier as-is: an unlit vertex-coloured cone with `fog: false`, one
  `InstancedMesh` for every lamp in town, flickering off a shared clock.
- **`config.js` is at 389 of the 400-line cap.** A `config-town.js` is the
  fifth config file; ADR-027's closing note says that is the point to re-read
  the one-findable-place rule rather than re-apply it.
- **`character.js` is the generic humanoid rig now**, not the player's.
  Townsfolk NPCs are `createRigFromGLTF(cloneRig(gltf.scene), spec)` and a
  small brain, exactly as bandits are — and `bandit.js` / `bandit-ai.js` are
  the shape to copy. If a townsfolk brain wants the same wander/steering, that
  is the **third** copy of it and worth extracting.
- **`Health`, `playHit()` and `setDead()` exist and are generic.** A townsfolk
  NPC that can be shot needs no new system — and round 6's wanted level is
  built on shooting them, so give them health rather than making them
  invulnerable props.

### 1. The original round-5 notes

- Buildings are the first real users of `resolveBox` — written and
  unit-testable, no caller yet.
- Stay inside `TOWN.halfSize`; `PROPS.townKeepOut` already reserves scenery
  margin. Bandit camps are 335–365m out and nowhere near it.
- Building colliders keep `top: Infinity` — same as characters, and for the
  same reason (see the collision contract).
- This is the round that may want `groundHeightAt` to become genuinely
  different from open-terrain height (ADR-001) — it is already a separately
  named function for exactly this.
- A saloon interior is the first thing in this game with an *inside*. Nothing
  in `combat-ray.js` knows about walls that a bullet should not cross: a
  building's collider is a box, and `raycastColliders` currently skips boxes
  outright (`col.type !== 'circle'`). **A shot fired inside the saloon will go
  straight through the walls until that is written.**
- Bandits and townsfolk share the collider array. If a bandit ever wanders into
  town, `bandit-ai.js`'s cover search will happily pick a building — it filters
  on `col.r >= coverMinRadius` and excludes only `'bandit'` and `'horse'`.

### 2. BUILD-PLAN.md's standing warning

**"Round 4 will break the horse and neither of us will notice until round 7."**
Round 4 changed `main.js`'s frame order (a dead rider is dismounted before
`horse.update`), the character interface (`playHit` / `setDead`), and
`weapons.js`'s geometry. The whole `SMOKE-TEST.md` list is the human's to walk
— it is now long enough that this is a real sitting, not a glance.

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
- **Rounds 3 and 4's whole feel is unjudged**, exactly like the horse's before
  them — and the horse's numbers caught two real bugs that way. Round 3: the
  gunfight. Round 4: how fast a camp wakes, whether the cover shuffle reads as
  cover, the strength of the damage vignette, whether dying in ~8 seconds
  standing in the open is right. All of it is in `SMOKE-TEST.md` and all of it
  was set from measurements and static screenshots. Fixing anything the human
  reports comes first.
- BUILD-PLAN.md's own priority note: if something must go, drop the minimap
  first, then the grass shader. **Do not drop the day/night cycle.**
- Everything in [HORSE.md](HORSE.md)'s "open issues and tuning levers" that
  the human hasn't ridden yet is fair game here — but fixing a reported break
  always comes first.
