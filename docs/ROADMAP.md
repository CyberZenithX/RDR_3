# ROADMAP.md — what each remaining round must watch out for

Forward-looking handoff notes. **BUILD-PLAN.md is the spec** — it says what
each round must build. This file says what will bite you while building it,
based on what already exists.

Rounds 0, 1, 2, 2b, 2c, 2d, 3, 4, 5 are done. Round 6 is next.

---

## Round 6 — bounties, duels, wanted

### What round 5 leaves you

- **The town is where the loop lives, and it is built.** The sheriff's office
  is at (15, 22) facing the street; a bounty board outside it is a
  `PartBuilder` push into the town's merged mesh plus a trigger volume, and
  `town.isInsideSaloon()` is the worked example of a trigger written in a
  building's own frame. `BUILDINGS` carries a `name` per entry the way `CAMPS`
  does.
- **Do not add a mesh to the town. Add a part.** Everything static in town is
  one merged, vertex-coloured mesh (ADR-033) and the budget has headroom
  precisely because of that. `town-geo.js`'s `PartBuilder` is the tool; three
  smoke checks watch the number.
- **Townsfolk already carry `Health` and can be shot** (ADR-034), which is the
  whole foundation of the wanted level: `townsfolk.hit()` returns
  `'hit' | 'dead'` and `combat.js` already dispatches on `kind === 'townsfolk'`.
  What does not exist is anyone *noticing* — they run (`hearShot`), and that is
  all. Deputies are `bandit.js` + `bandit-ai.js` with a different spawn source;
  `character.js` is generic and `HEALTH` already has the numbers.
- **A duel needs a camera that is not the third-person rig.** `camera.js` has
  `setMounted` / `setAiming` as its two mode switches and they *compose* by
  lerping between pairs — a third mode should follow that pattern rather than
  bolting on a second camera object.
- **`combat.js` is at 366 of the 400-line cap and `horse.js` is at exactly
  400.** Neither has room for a feature. Split along a real seam before adding.
- **A citizen is not a bandit and the code knows it.** `bandit-ai.js`'s cover
  search still filters on `col.type === 'circle'`, so a fight in town will
  never pick a *building* as cover. That is correct today (a building is not a
  rock to peek round) and is the first thing to revisit if deputies fight in
  the street.

### The original round-6 notes

- **The draw is already half-built.** ADR-026 says there is no holster: the
  revolver is permanently in the fist, and `aim-pose.js` takes a `hold` weight
  separate from its aim weight precisely so a real draw can animate it. The
  gun also has `setVisible()`. Neither is used yet.
- Duel draw is `Idle_Gun_Pointing` (a real clip).
- `MESAS` entries are the landmarks a bounty callout can reference — "the camp
  near the twin mesa" needs no new placement system, just an entry index.

## Round 7 — polish

- **The lamps are wired and waiting.** `StreetLamps.setLit(bool)` darkens the
  glow instances and zeroes the three `PointLight`s in one call, and nothing
  calls it. That is the day/night cycle's switch, already tested.
  Three `PointLight`s is itself a budget: every one is compiled into every
  standard material's shader in the scene (~10% of headless frame rate for
  these three), and they cast no shadow, so their `distance` cutoff is the only
  thing keeping saloon light out of the street.
- Wind-swayed grass shader (grass is currently static geometry). Note
  `STREET.grassKeepOut` — the street is deliberately bare dirt, and a wind
  shader must not reintroduce tufts there.
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
- **Rounds 3, 4 and 5's whole feel is unjudged**, exactly like the horse's
  before them — and the horse's numbers caught two real bugs that way. Round 3:
  the gunfight. Round 4: how fast a camp wakes, whether the cover shuffle reads
  as cover, the strength of the damage vignette, whether dying in ~8 seconds
  standing in the open is right. Round 5: whether the door fade reads as a
  transition or an interruption, whether the saloon is dim or dark, whether the
  townsfolk read as people or as five of the player. All of it is in `SMOKE-TEST.md` and all of it
  was set from measurements and static screenshots. Fixing anything the human
  reports comes first.
- BUILD-PLAN.md's own priority note: if something must go, drop the minimap
  first, then the grass shader. **Do not drop the day/night cycle.**
- Everything in [HORSE.md](HORSE.md)'s "open issues and tuning levers" that
  the human hasn't ridden yet is fair game here — but fixing a reported break
  always comes first.
