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
