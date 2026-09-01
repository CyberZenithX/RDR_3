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

Claude's side of this: everything machine-checkable lives in `scripts/smoke.mjs`
(see `docs/TESTING.md`), and the project's technical memory lives in `CLAUDE.md`
plus `docs/`.

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

## Round 2b — the seated riding pose

Added after round 2, when the rider turned out to be *standing* on the horse
rather than sitting on it. Everything under "Round 2" still applies; these are
the extra things to look at.

1. **The rider sits.** Mounted, from any angle: legs astride the barrel with
   knees forward and the shins hanging down either side, boots roughly level
   with the horse's elbow, hips on the horse's back rather than buried in it
   or hovering above it. No leg should pass visibly *through* the horse.
2. **Hands are on the reins**, not open palms held out: closed fists, forward
   and slightly apart above the withers, elbows near the ribs. Look at this
   from three-quarter-front, where the hands are clearest.
3. **Left and right legs match.** This rig's legs are *not* mirror images of
   each other at rest (the right hip sits further forward than the left), and
   the pose corrects for it with per-side trims. If one leg sits noticeably
   further forward, higher, or tighter to the horse than the other, those
   trims (`RIDING_POSE.rightPitchTrim` / `rightSpreadTrim` / `rightKneeTrim`
   in `config-horse.js`) are what to adjust.
4. **The rider moves with the horse, not on top of it.** The seat follows the
   horse's own spine bone, so the rider should rise and fall in time with the
   gait — subtle at a walk, pronounced at a gallop — and never look like a
   figure sliding along above a separately-bouncing animal. The rein hands
   and torso give slightly with each stride.
5. **The rider leans.** Into turns (sharing the horse's own bank), and forward
   as the horse builds to a gallop, easing back upright as it slows.
6. **Mounting eases into the seat.** Over the 0.4s mount blend the rider
   should fold from standing into seated as they move onto the horse — no
   snap into the pose, and no moment where they sink into the ground at the
   start of it.
7. **Dismounting stands them back up properly.** Get off and then *stand
   still* without walking: the rider should be fully upright immediately. If
   they stand there with a forward lean that only straightens out once you
   walk, the pose is not being released (this was a real bug — the spine bone
   is not in the idle clip, so nothing else puts it back).
8. **Ride, dismount, and ride again several times.** The pose is rebuilt from
   a fixed rest pose every frame; if the rider slowly folds over, drifts, or
   looks progressively more wrong the longer you ride, that is the pose
   compounding on itself and is a real regression.

## Round 2b (cont.) — bridle and reins

`horse.glb` ships no tack at all, so the bridle and reins are built at runtime
(`src/reins.js`). Things to look at:

1. **The reins actually connect.** Mounted, the two straps should run from the
   rider's closed fists forward to the corners of the horse's mouth, passing
   *over* the neck. Look from three-quarter-front, and again while turning.
2. **They stay attached when the head moves.** Gallop, and watch the head
   stretch forward and drop: the bit end should stay on the muzzle, not slide
   off the nose or float in front of it. Same when the horse lowers its head.
3. **They lie over the neck, never through it.** The crest of the neck is the
   place to watch, especially at a gallop with the head low — if a rein
   disappears into the neck and comes out the other side, the clearance
   (`TACK.neckClearance`) is too small.
4. **The bridle sits on the head**: a noseband around the muzzle, a strap up
   each cheek, and a browband in front of the ears. It should move with the
   head as one piece, with no strap floating off the face.
5. **Unmounted, the reins drape over the neck** rather than stretching across
   the map toward wherever the player is standing. Dismount and walk away —
   the reins should stay on the horse.
6. **No flicker.** The straps are one continuously rewritten mesh; if they
   vanish at certain camera angles or distances that is a culling problem,
   not a placement one.

## Round 2c — the rider stays seated through a turn

Added after round 2b, when the rider turned out to slide off the saddle and
throw a leg into the air the moment the horse banked into a turn. The seat now
banks with the horse and the rider's lean pivots at the seat rather than at
their own feet. Things to look at, all of them *while turning*, which is the
state none of the round-2b checks covered:

1. **Hold a hard turn.** Ride at a walk and hold `A` or `D` for several
   seconds so the horse settles into a steady bank. The rider should stay
   centred on the horse's back the whole time, with both boots hanging down
   either side of the barrel. This is the exact thing that was broken: one leg
   used to swing out horizontally into the air while the rider slid toward the
   other side.
2. **Watch the seat, not just the legs.** The rider's hips should stay planted
   on the back and bank *with* it. If they appear to hover to one side of the
   spine, or to sink into the barrel on the inside of the turn, the saddle
   point is not tracking the horse's bank.
3. **Turn both ways, and reverse mid-turn.** Swing hard left, then hard right
   without stopping. The rider should follow through the crossover without a
   pop or a lurch as the lean passes through zero.
4. **Turn at a gallop.** Forward carriage (`riderGallopPitch`) and the bank
   compose here, and a gallop banks harder because the horse turns faster.
   The rider should end up leaning forward *and* into the turn, still seated.
5. **Turn while mounting.** Whistle the horse, mount while it is still moving,
   and turn immediately. The hip offset is scaled by the mount blend, so this
   is the one moment the two can disagree — the rider should still arrive in
   the saddle cleanly, with no dip through the horse or the ground.
6. **The reins survive it.** They are rebuilt from live bones, so they should
   follow the hands around the turn without stretching or detaching.
7. **The camera behaves.** The mounted camera pivot now moves with the banking
   rider, so a hard turn swings it slightly. It should read as the camera
   following the horse, not as a lurch — if it feels seasick,
   `CAMERA.mountedPivotHeight` is the lever.

## Round 2d — the horse jump

Controls: **Space** now jumps the *horse* while mounted (it still jumps the
player on foot). The horse must already be moving — at least a walk — and must
have stamina left; a jump costs a little of it.

1. **It jumps.** Ride forward at any pace and press Space. The horse should
   leave the ground in a real arc, hang for about nine tenths of a second, and
   land cleanly back on the terrain. Try it at a walk, at a trot-equivalent
   pace and at a full gallop — the arc is the same height each time, but a
   gallop carries you much further across the ground.
2. **The legs are a real animation, not a pose.** `horse.glb` ships a genuine
   `Gallop_Jump` clip, so the forelegs should fold up on the rise and reach out
   again on the descent. It is stretched to fit the flight, so it should finish
   roughly as the hooves touch down rather than ending early and freezing.
3. **The horse pitches.** Nose up on the way up, nose down over the descent,
   eased rather than snapped. If it ever tips *sideways* instead of nose-up,
   the mesh Euler order has regressed (it must be `YXZ`).
4. **The rider comes up out of the saddle.** Mid-flight they should be in a
   two-point seat — lifted off the saddle, folded forward at the hip over the
   withers, knees closed, hands pushed up the neck — and settle back down into
   the normal seat on landing. They should never be left sitting bolt upright
   as if nothing happened, and never be left behind over the horse's rump.
5. **Jump over an actual rock.** This is the point of the round. Find a rock
   roughly chest-high on the horse or smaller, gallop straight at it, and jump
   as you reach it — you should sail over instead of being stopped.
   - **Big boulders are meant to stop you.** Rocks run from about 0.6m to 3.6m
     tall and the horse's belly clears about 2.7m at the top of its arc, so a
     bit over half of them are jumpable and the largest are genuine obstacles
     you have to ride around. If that balance feels wrong in play,
     `HORSE.jumpSpeed` in `config-horse.js` is the single lever.
   - **Cacti and dead trees are never jumpable** (they are 3-6m tall). If the
     horse ever passes through one, that is a real bug.
6. **You cannot cheat the clearance.** Walk or gallop the horse straight into a
   small rock *without* jumping — it must still stop you dead. The horse only
   passes over things while genuinely in the air.
7. **Land on a slope.** Jump uphill and downhill. The landing should snap onto
   the terrain without the horse sinking into it, hanging above it, or
   bouncing.
8. **The camera does not get seasick.** It follows the arc with a slight lag
   rather than rigidly. If it feels like the world is being yanked up and down,
   `CAMERA.pivotFollowRate` in `config.js` is the lever; if it feels detached
   and floaty, raise it.
9. **Spam it.** Hold Space, mash it, press it mid-air, press it the instant you
   land. You should never double-jump, never get stuck airborne, and never
   pogo on the spot from a standstill (a jump needs forward motion).
10. **Stamina interacts sensibly.** Gallop until the stamina bar is exhausted:
    the horse should refuse to jump as well as refuse to gallop, and both
    should come back together as it recovers.
11. **E does nothing mid-air.** Pressing dismount while the horse is airborne
    should be ignored, not drop the rider through the arc onto the ground.
12. **Space still jumps you on foot.** Dismount and press Space — the player's
    own jump should work exactly as it did in round 1. In particular, holding
    Space while riding and *then* dismounting should not fire a stored jump the
    moment your boots hit the ground.
13. No console errors through a mount → gallop → jump → land → turn → jump →
    dismount cycle, repeated a few times.

## Round 2d (cont.) — the rider at the top of the jump

Added after a play session found the rider merging into the horse at the apex.
Root cause and measurements:
[`docs/HORSE.md`](docs/HORSE.md#the-rider-was-swallowed-by-the-horse-at-the-apex).

1. **The rider stays on top of the horse for the whole arc.** Jump and watch
   the peak specifically — this was invisible on the way up and on the way
   down, and only went wrong for the few frames around the top. Rider and horse
   should never intersect: no torso sinking into the back, no hat disappearing
   into the withers, no boot passing through the barrel.
2. **Watch it from behind and from the side.** From directly behind, the fault
   read as the rider simply vanishing. From the side it read as the horse's
   back rising through them. Both angles are worth one jump each.
3. **The horse's own body rises a long way over a jump, and nobody has judged
   whether that looks right.** `Gallop_Jump` lifts the horse's back about 0.75m
   *on top of* the 1.70m arc the game integrates, so the animal reaches higher
   than `HORSE.jumpSpeed` alone suggests. It is meant to look like a real
   jumping effort — but if it reads as the horse ballooning or as two separate
   motions stacked, say so, because the alternative (cancelling the clip's own
   rise instead of letting the rider follow it) is a design change, not a
   tuning one.
4. **The rider should still look like they are riding it, not glued to it.**
   Now that the seat follows the back outright while airborne
   (`HORSE.jumpSaddleFollow` = 1, against 0.72 on the ground), the rider takes
   all of the horse's vertical motion in the air. If that reads as stiff, the
   lever is that constant — but lowering it is what caused the original bug, so
   it cannot go far.
5. **The seat now inherits the horse's jump pitch.** Over the arc the rider
   should stay square on the back as the horse tips nose-up and then nose-down,
   rather than sliding up the neck at the top and toward the rump on the way
   down.

## Stamina — the tank was resized

`HORSE.staminaMax` went from 1 to 1.5 on the human's call.

1. **A gallop should last about 6.8s from full**, up from 4.55s, and a full
   refill about 11.5s, up from 7.7s. Ride it and say whether that is the right
   trade — a bigger tank also takes proportionally longer to fill.
2. **The stamina bar must still fill the whole width and no more.** It is now
   fed a fraction rather than the raw value; if it ever renders past the end of
   its track, or stops short of full when the horse is rested, that path has
   regressed.
3. **The exhaustion lockout was deliberately not scaled.** After bottoming out,
   the horse should still refuse to gallop for about the same ~1.7s it always
   did before letting you back in — not proportionally longer.
4. **Jumping costs proportionally less of the bar now** (`jumpStaminaCost` is
   absolute and the tank got bigger). If jump-spamming feels too cheap, that
   constant is the lever.

## Stamina — the tank was put back

`HORSE.staminaMax` went back from 1.5 to 1 on the human's call, reversing the
resize above. Items 1 and 4 of that section no longer apply; 2 and 3 still do.

1. **A gallop should last about 4.55s from full again**, and a full refill
   about 7.7s. If that now reads as too short, `staminaMax` is the lever and
   moving it is safe — nothing outside `horse.js` assumes the tank is 1.
2. **The bar should still fill its track exactly at rest and empty at a dead
   stop.** Raw stamina and the fraction are the same number at a tank of 1, so
   a regression on that path would be invisible in play until the tank moves
   again; the smoke check resizes the tank itself to keep catching it.
3. **A jump costs 0.1 of the bar again** — about 10% rather than the ~6.7% it
   cost at 1.5. If jump-spamming now feels punishing, `jumpStaminaCost` is the
   lever, not the tank.
