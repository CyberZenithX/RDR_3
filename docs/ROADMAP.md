# ROADMAP.md — what each remaining round must watch out for

Forward-looking handoff notes. **BUILD-PLAN.md is the spec** — it says what
each round must build. This file says what will bite you while building it,
based on what already exists.

Rounds 0, 1, 2, 2b, 2c, 2d, 3, 4, 5, 6 are done. Round 7 is next.

---

## Round 6 — bounties, duels, wanted — DONE

Built with almost no new geometry, as BUILD-PLAN.md promised. What it leaves
round 7:

- **The bounty board is parts in the town mesh** (`bounties.js`
  `buildBountyBoard()`), its camp names appended to the one sign atlas after
  the shop signs. Still three meshes named `town*`.
- **The wanted level never touched `combat.js`** — it counts `townsfolk.hit()`s
  via `townsfolk.crimeCount` and `deputies.js` reads the delta (ADR-038).
  `combat.js` gained six lines only so a shot can hit a **deputy**.
- **Deputies are parked `Bandit`s** at `(4000, 4000)` (ADR-036), teleported in
  on a star spike and stood down — not killed — when it clears. A dead deputy
  is spent for the session; the pool is six.
- **The duel is scripted, main.js does the freezing.** `player.js` (393) and
  `horse.js` (400) had no room, so `main.js` calls `duel.poseParticipants()`
  in place of the horse/player update while `duel.freezesPlayer`. Slow-mo is a
  global `dt *= duel.timeScale`. The face-off camera composes by lerp in
  `camera.js._applyDuelShot()`.
- **The whole feel is unjudged** — reward balance, `DUEL.window`, the wanted
  decay rate, deputy pressure, whether the slow-mo reads. All in
  `SMOKE-TEST.md`.

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
- **Round 6 added six more `bandit.glb` clones** (the deputy pool), parked
  invisible until a wanted spike. That is 17 humanoid rigs loaded against
  round 4's 11 — memory and clone cost, not draw calls (parked = `visible:
  false` = zero). Draw calls at spawn measured 66 (was ~58) with the pool
  present; the three budget checks still pass comfortably under 120, but the
  real performance pass is round 7's, and the deputy pool size
  (`DEPUTY.poolSize`) is a lever if it bites.
- **Rounds 3, 4, 5 and 6's whole feel is unjudged**, exactly like the horse's
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
