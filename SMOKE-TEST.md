# SMOKE-TEST.md

**This is a manual checklist for the human.** Claude cannot see the game running —
it has no eyes on a browser window and cannot tell whether the horse feels good to
ride. Everything machine-checkable lives in `scripts/smoke.mjs` and runs
automatically. Everything below is yours to walk by hand.

Run the game first:

```bash
npx serve .
```

Then open the URL it prints. Do not double-click `index.html` — ES modules and GLB
loading need `http://`.

Lines are added every round and never deleted. If something here breaks, say so —
fixing it comes before any new feature.

---

## Round 0 — assets

1. ~~Page loads at the served URL and shows the **DUST & IRON** title over a dark
   ochre background, with a slowly rotating bronze torus knot.~~ Superseded by
   round 1's real world — see below. (Rule: never delete a line, so this is
   struck through, not removed.)
2. ~~The status line reads `three.js r160 — running`, not `booting…`.~~
   Superseded — round 1 replaced the status line with a proper loading screen.
3. Browser console is clean — no red errors. **Still applies every round.**

---

## Round 1 — world and player

Controls: **WASD** move, **Shift** sprint, **Space** jump, **mouse** look
(after clicking to lock the pointer), **Esc** releases the pointer.

1. Page shows a "DUST & IRON — loading…" screen briefly, then a "click to
   play" overlay. Click the canvas: the overlay fades out and the pointer
   locks (cursor disappears, mouse now steers the camera instead of the OS
   pointer).
2. Press **Esc**: pointer unlocks, the "click to play" overlay fades back in,
   and WASD/Space stop moving the player (mouse and keys are inert until you
   click again).
3. **The world looks like a place, not a grey plane**, the moment it loads —
   rolling dusty terrain in ochre/bone/rust tones, a gradient sky with a
   visible sun, fog on the horizon, scattered rocks/cacti/dead trees, and
   grass around your feet. Nothing should look flat-shaded or "blocky voxel".
4. **Spawn facing**: on load you should be looking at a large flat-topped mesa
   in the distance, not empty ground.
   - Player model is **"Farmer"** (Quaternius), not the hardhat-and-hi-vis
     "Worker" round 1 originally shipped — swapped post-round-1 for a more
     western-appropriate look, same rig/animations underneath. Character
     should face and walk in the direction of movement, not backwards (this
     was broken and fixed post-round-1 — flag it if it's somehow still wrong).
5. **Mouse look** feels natural: moving the mouse right turns the view right,
   moving it up tilts the view up (or down, if it feels inverted — flag it,
   there's an `INPUT.invertY` config flag for this).
6. **WASD** moves relative to the camera, not fixed world axes — turn the
   camera with the mouse, W should always mean "forward from here".
7. **Walk vs. run**: tapping a direction key walks; holding Shift while moving
   sprints, visibly faster, with a run animation, not just a faster walk
   animation. The transition between idle/walk/run should crossfade smoothly,
   not pop.
8. **Feet should not slide.** Watch the player's feet against the ground while
   walking and while sprinting — if they're skating rather than planting,
   that's the `clipReferenceSpeed`/`timeScale` system misbehaving.
9. **Jump** (Space) has a believable arc and lands back on the terrain
   cleanly, including on a gentle slope, without clipping through the ground
   or hanging in the air.
   - There is **no dedicated jump animation clip.** One was built (retargeted
     at load time from a different CC0 pack) and tuned across several
     rounds — a crouch/anticipation dip, a mid-air tuck, knee/foot fixes —
     but never read as right in real play (legs that hooked, smeared boots,
     an exaggerated sideways sweep, and even once those were fixed, still
     "abrupt" and unnatural), so it was pulled out entirely rather than
     shipped broken. See CLAUDE.md's "Known rough edges" for the full
     history if it's ever worth revisiting (the code is in git history, not
     in the current `src/`). What you should see instead: whatever
     idle/walk/run pose was already playing holds and plays back slower
     while airborne (`ANIM.airTimeScale` in `config.js`), then crossfades
     normally back to full speed on landing. Not dynamic, but not broken
     either — flag it only if the landing crossfade itself pops or the
     character clips through the ground.
10. **Camera collision**: walk the camera into a hillside or close behind a
    large rock — it should pull in smoothly rather than clipping through
    geometry or showing you the inside of the terrain.
11. **Prop collision**: walk straight into a rock, cactus, or dead tree — you
    should be stopped/deflected around it, not walk through it.
12. **World boundary**: head toward the map edge in any direction. Hills
    should rise and get impassable-feeling well before any edge; a reddish
    vignette with "YOU ARE LEAVING THE TERRITORY" text should fade in as you
    approach, and you should never be able to walk off the mesh into empty
    space or fall into a void.
13. Performance should feel smooth on a normal machine — no obvious stutter
    walking around, no console errors while playing for a couple of minutes.

---

## Round 2 — the horse

Controls added this round: **H** whistle the horse, **E** mount/dismount
(only works within a few units of the horse).

1. **Horse is visible near spawn** and looks proportioned like a real horse
   standing next to the player — not tiny, not towering. (An earlier
   in-progress measurement of the raw asset suggested it might render ~3x
   too tall; verified via screenshot this round that the shipped scale
   looks correct, but worth a second human look.)
2. **Whistle (H)**: press it from a distance — the horse should stop
   whatever it's doing and trot/walk over to you, then stop and idle nearby
   once it arrives. Try it while the horse is far away and while it's close.
3. **Wander/follow when not whistled**: leave the horse alone for a while —
   it should amble around nearby on its own (not stand frozen, not
   wander off to the horizon), and if you walk far away it should notice
   and catch up rather than being left behind permanently.
4. **Mount (E)**: stand near the horse and press E. The player should ease
   onto the horse's back over a fraction of a second (not teleport
   instantly), ending up sitting reasonably on the saddle — not floating
   above it, not sunk into its back, not offset to one side.
5. **Camera while mounted**: should pull back and rise compared to the
   on-foot view, showing both rider and horse. It should **not** be jammed
   up against the back of the player's head or clipped into the horse's own
   body — if the camera looks broken/too-close specifically right after
   mounting, that's a real regression (this exact bug was found and fixed
   this round).
6. **Riding controls**: WASD should steer the horse the same way WASD steers
   the player on foot (camera-relative — turn the camera, W still means
   "forward from here"). Holding Shift should gallop — visibly faster, with
   a distinct gallop animation, not just a faster walk animation.
7. **Horse leans into turns** while ridden at speed — watch from behind
   while turning sharply at a trot/gallop. (Flagged as not visually
   re-confirmed after implementation — say if it leans the wrong way, or
   not at all.)
8. **Stamina bar**: appears only while mounted, drains while galloping,
   refills when not galloping. Try to gallop it all the way to empty — the
   game should refuse to gallop again (falls back to a slower pace) until
   it's recovered somewhat, not let you gallop forever or get stuck unable
   to move at all.
9. **Dismount (E while mounted)**: player should land beside the horse, on
   the ground, under normal on-foot control again immediately (WASD/Space/
   Shift all work right away, camera back to the on-foot distance).
10. **Horse collision**: the horse (mounted or not) should be stopped by
    rocks/trees like the player is, not clip through them. While unmounted,
    walking into the horse itself should stop you, not pass through it.
11. **World boundary applies to the horse too** — try to ride it toward the
    map edge; same impassable-ridge/hard-clamp behavior as on foot.
12. No console errors through a whistle → mount → ride around → gallop →
    dismount cycle, repeated a few times.
