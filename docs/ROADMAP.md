# ROADMAP.md — what each remaining round must watch out for

Forward-looking handoff notes. **BUILD-PLAN.md is the spec** — it says what
each round must build. This file says what will bite you while building it,
based on what already exists.

Rounds 0, 1, 2, 2b, 2c, 2d, 3, 4, 5, 6, 7 are done. **The build is complete.**

Anything after this is polish-of-polish and bug response, not a new feature
round. The one thing that has never happened is a human playing the finished
game start to finish — `SMOKE-TEST.md` is the list, and every round from 3 on
has feel that was set from numbers and never watched.

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

## Round 7 — polish — DONE

Everything on the list shipped: day/night, grass wind, the four looping
ambiences (real CC0 files), master mute, main menu + pause + settings,
localStorage checkpoint, minimap, and a performance pass. What it leaves:

- **The day/night palette is keyed to sun ELEVATION, not `t`** (ADR-040), so
  the arc (`DAYNIGHT.dayLengthSec`, the azimuth formula) and the three palettes
  (`night` / `golden` / `day`) retune independently. `day` = the round 0–6
  static `SKY`/`SUN`/`FOG` values, so midday is unchanged.
- **`StreetLamps.setLit()` is now driven, from `daynight.js` only**, with
  hysteresis. Consequence: the saloon's three interior `PointLight`s (they are
  `LAMPS.points`, and `setLit` is all-or-nothing) go dark in daylight.
  `DAYNIGHT.day.hemiIntensity` was raised 0.62 → 0.72 to compensate; whether
  the daytime interior is bright enough is a `SMOKE-TEST.md` item, and the
  clean fix if not is to split the two saloon lights off the street lamps.
- **`main.js` was over 400** with the round-7 wiring inline, so it split:
  `src/shell.js` owns the menu / settings / checkpoint / day-night / ambience /
  minimap and hands `main.js` `isPaused()` / `beforeFrame` / `afterFrame`
  (ADR-041). The pause freeze is a top-of-loop early-out; the boot main menu
  does NOT freeze.
- **The ambiences loop by a tail-over-head `acrossfade`** (no ffmpeg loop-point
  concept). A faint seam may survive on wind / crickets / piano — a re-encode,
  not code. `hoofbeats` is a trot loop pitched up with the gallop.
- **Draw calls: 63 at night with the lamps lit**, 61 down the street, 59 at a
  camp, against ~120. Comfortable; no further pass planned.
- **Everything from rounds 3–7 that a human has never watched** is in
  `SMOKE-TEST.md`. A reported break there comes before anything new — that rule
  has not changed and matters more now than ever, since there is no round 8 to
  absorb it.
