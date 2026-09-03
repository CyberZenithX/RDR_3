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

---

## Round 3 — guns

**Controls added this round:** **right mouse** aim (hold) · **left mouse** fire
(hold to fan the hammer) · **R** reload. Everything from earlier rounds is
unchanged: WASD move, Shift sprint, Space jump, H whistle horse, E
mount/dismount, mouse look, Esc to release the pointer.

**Nobody has fired a shot in real play.** The poses were checked against
screenshots and the gun's hold offsets were solved numerically off the live
skeleton, but every *feel* number below is unwatched — the same state the horse
was in before your play sessions caught two real bugs. Levers are in
`src/config-combat.js` unless noted.

### The gun itself

1. **The revolver is in the right fist, life-sized, and points where the
   character does.** It is procedural — there is no CC0 revolver model this
   session could fetch (`quaternius.com` is blocked). If it floats off the
   hand, sits at the wrong angle, or is the wrong size, `GUN.holdPosition` /
   `GUN.holdRotation` are the two lines. They were *measured*, not guessed, so
   a gross error means something upstream moved.
2. **The gun is never holstered.** It stays in the hand at all times, including
   while walking, riding and idling. That is deliberate (ADR-026) and no round
   needs a draw until round 6 — but say so if it looks wrong just standing
   around.

### Aiming

3. **Right mouse pulls the camera in, narrows the FOV, and slides the view over
   the right shoulder**, with a crosshair appearing at the centre. Levers:
   `CAMERA.aimDistance`, `aimFov`, `aimShoulderShift`, `fovLerpRate`.
4. **While aiming, the character turns to face the camera**, so strafing means
   moving sideways while still covering what you are looking at. Releasing the
   button returns to "face the way you are running". `PLAYER.aimTurnRate`.
5. **The gun tracks the crosshair up and down.** Look up and the arm should
   raise with it; look down and it should drop. It follows 75% of the camera's
   pitch on purpose (`AIM_POSE.elevationFollow`) — a full 100% put the shoulder
   at a physically silly angle. Say if the gun visibly lags the crosshair.
6. **The left hand comes up to support the gun on foot** — but it does not
   actually touch it. There is no IK; both arms are posed, and the gap between
   the hands varies with elevation. Worst at extreme up/down angles.

### Firing

7. **Shots land where the crosshair is.** The ray starts at the muzzle, not the
   camera, so at very close range against a target off to one side the two can
   disagree slightly. That is expected; a large disagreement is not.
8. **Six rounds, then nothing.** The counter bottom-right shows pips plus a
   numeral. An empty gun does not click, fire or go negative — it simply does
   nothing until you reload.
9. **Fire rate**: holding left mouse fans the hammer at `COMBAT.fireInterval`
   (0.34s). If that feels machine-gun-ish for a single-action revolver, that is
   the lever — or make it one shot per click.
10. **Recoil** is three things at once: the camera pitches up
    (`COMBAT.recoilPitchKick`), the whole view jolts
    (`recoilShake`, capped by `CAMERA.shakeMax`), and the gun arm flips up
    (`AIM_POSE.recoilArmPitch`). If it is too much, they are separable.
11. **Muzzle flash, tracer, impact spark and a decal** on every shot. The flash
    throws a brief point light — worth checking at the far end of the day when
    the light is low, because that is when it will read most.
12. **Accuracy**: hip fire scatters noticeably (`COMBAT.spreadHip`), aimed fire
    is near-exact (`spreadAim`). Standing still and hip-firing at a bottle 15m
    away should miss often enough to be worth aiming.

### Reloading

13. **R reloads over 1.7s, and the gun is dead for all of it.** The count jumps
    to 6 only when the lockout *ends*, not at the start.
14. **The reload has no clip** — this rig has no `Reload` animation. The gun
    dips below frame instead, per BUILD-PLAN.md's substitution table. Six shells
    drop to the ground partway through (a revolver ejects the whole cylinder at
    once, which is why they come on reload and not per shot).
15. **Spent shells bounce and settle**, then fade after ~2.4s.

### Shootable targets

16. **Twelve barrels with green bottles on top**, hand-placed on the plateau a
    little south of spawn. They are a test range; move them by editing
    `TARGETS.barrels` if they are in an awkward spot.
17. **A bottle breaks in one hit. A barrel takes two.** Destroying a barrel
    takes its bottles with it — they were standing on a lid that no longer
    exists.
18. **A barrel is low enough for the horse to jump.** Ride at one at a gallop
    and press Space; it should clear like a rock. This fell out of the existing
    collider contract and is worth confirming once.
19. **A destroyed target stops blocking movement** — walk through where it was.

### Mounted shooting

20. **Aim and fire work from the saddle**, with the left hand still on the
    reins and the legs still astride. This is the part with the most novel
    machinery behind it (two pose layers owning different bones), so it is the
    most likely to look subtly wrong in motion even though it measures right.
21. **While aiming, W/S and the gallop stop responding and A/D steer the
    horse.** This is BUILD-PLAN.md's requirement, and it is a real change of
    meaning: unaimed, A/D point the horse where the camera looks; aimed, they
    rein it left and right while the barrel tracks independently. If it feels
    unresponsive, `HORSE.aimTurnRate` / `aimMaxSpeed` / `aimSpeedDecay`.
22. **Shooting from horseback is much less accurate** —
    `HORSE.mountedAccuracyPenalty` (2.4×), and `jumpAccuracyPenalty` (1.9×)
    stacks on top while the horse is over an obstacle. Firing mid-jump is
    allowed on purpose.
23. **R is refused at a gallop.** Slow to a walk and it works. It is also
    refused in mid-air. Note this is gated on the *gait*, not on stamina — an
    exhausted horse at a walk still lets you reload.
24. **The mounted aim camera is its own framing**, not the on-foot one and not
    the ordinary mounted one. `CAMERA.mountedAimDistance` /
    `mountedAimPivotHeight`.

### Sound

25. **Three sounds: the shot, the reload, and the impact.** All CC0 —
    provenance is in `docs/ASSETS.md`. The gunshot is a real black-powder
    recording, which is the right era.
26. **Audio needs a click first.** Browsers hold the audio context suspended
    until a user gesture; the click that takes pointer lock is it. If the first
    shot after a page load is silent but later ones are not, that is the
    gesture not having landed — worth reporting.
27. **The shot is positional.** Fire, then turn: it should sound like it came
    from where you were pointing, not from inside your head.
28. **Mute is not implemented.** `M` does nothing until round 7.

## Round 3 follow-up — the gunshot was three gunshots

Reported after the round was tagged: *"the gunshot audio sounds like 3
consecutive ticks."* Correct, and it was a real bug — the CC0 source file is a
**six-shot take**, and the trim that produced `gunshot.ogg` caught three of
them. Every trigger pull fired a burst. Two smaller defects in the same
pipeline are fixed with it: all three clips had been run through `loudnorm`,
which flattens a one-shot's transient and had left them clipping at 0 dBFS.

Items 25–27 of the round-3 list still stand. New things to listen for:

29. **One shot per trigger pull.** A single crack with a short tail, not a
    burst. `smoke.mjs` now decodes each file and counts onsets, so this
    specific failure cannot ship again silently — but confirm it by ear. The
    budget is per file (`AUDIO.maxOnsets`): the reload is *allowed* to be
    several clicks, because a cylinder closing is a sequence.
30. **The crack should be sharp, not a dull tick.** The files are now
    peak-normalised with real headroom instead of loudness-normalised. If it
    still reads thin, the source itself is a dry, distant black-powder
    recording; `docs/ASSETS.md` lists the other CC0 candidates that were
    fetched (`22 Magnum`, `22 Pistol`, a Ruger Single Six revolver from the
    Prepared SFX Library) and swapping is a re-encode, not a code change.
31. **The three sounds should balance.** Peak-normalising does NOT balance
    them by ear — a gunshot has a much lower average level for its peak than a
    reload rattle does. `AUDIO.volumes` is the lever and is now
    `{gunshot: 1.0, reload: 0.55, hit: 0.6}`. If the reload still drowns the
    shot, that line is the fix.
32. **Nothing should distort at close range**, especially firing while
    mounted, where the muzzle is nearest the listener.

### Between rounds 3 and 4 — the gunshot was swapped

Items 29–32 above still stand, but the file behind them changed and was never
committed until round 4 picked it up. `gunshot.ogg` is now a cut from the
`22 Magnum.wav` track of the same CC0 pack, not `Black Powder.wav`: the black
powder cut read as a muffled low boom rather than a revolver. Full provenance,
including the exact trim and why the encode carries `volume=-4dB`, is in
`docs/ASSETS.md`. So item 30's "if it still reads thin, the source is a dry,
distant black-powder recording" has already been acted on — judge the new one
on its own terms.

---

## Round 4 — bandits

Three camps, hand-placed, all a long ride out. Their coordinates are in
`src/config-ai.js`:

| Camp | Where | Men |
|---|---|---|
| **Coyote Wash** | x −330, z 60 — due west of the plateau | 4 |
| **Buzzard Rock** | x 360, z −60 — due east | 4 |
| **Dry Fork** | x −150, z 330 — south-west, behind you at spawn | 3 |

Each is built round a dead campfire, which is what makes it findable. Ride
out; you cannot miss them once you are within about 60m.

**Everything below was set from measurements and three static screenshots.
Nobody has fought a bandit in real play.** What *was* seen in a screenshot:
bandits stand and animate instead of T-posing, each has the revolver in his
fist, the campfire reads as a camp, tracers and the HUD show. Everything about
how it *feels* is yours.

### The camp, before anything happens

33. **Bandits stand around the fire and wander a little.** They should look
    like men loitering, not like statues and not like they are pacing a
    treadmill. Levers: `BANDIT.patrolRadius`, `patrolIntervalMin/Max`.
34. **A camp seen from a distance should look like people.** Bandits more than
    160m away are deliberately frozen mid-idle (`BANDIT.activeRadius`) to save
    the frame. Check whether that is visible from the ridge — if you can see
    them freeze and unfreeze as you ride in, that number needs raising.
35. **The campfire should sit ON the ground**, not float or sink, on all three
    camps. You cannot walk through it.

    *Superseded by items 56–60 — the fire was rebuilt after you said you never
    saw it. Item 35 still stands as written; there is just much more of it.*

### Being seen

36. **Walk up in front of them and they notice you** — a beat of hesitation
    (`BANDIT.alertTime`), then they come. Walk up behind them and they should
    *not*; there is a real blind spot (`sightHalfAngle`, ±69°).
37. **Fire a shot near a camp and the whole camp reacts**, not just the two men
    facing you. This was a real bug and is now checked automatically, but the
    *timing* is yours: `BANDIT.hearingRange` is 70m.
38. **Break line of sight behind a big rock and they lose you** — they should
    keep hunting your last known position for a few seconds
    (`loseSightTime`), not stand still and not track you through the rock.

### The fight

39. **Two rounds drop a bandit.** Confirm by feel that it is two, and that the
    first one produces a visible **flinch** — the real `HitRecieve` clip
    plays and he stops shooting for about 0.4s.
40. **The death should read.** He falls, the body settles on the ground and
    stays there. Watch for a body sinking into a slope or standing back up.
41. **Five hits kill you.** The red vignette flashes on each. **Judge its
    strength** — it was softened once already without being watched, and the
    lever is `#damageFlash`'s gradient in `index.html` plus
    `HEALTH.damageFlashTime`.
42. **Standing still in the open at a camp should kill you in under ten
    seconds** and feel obviously stupid. If you can stand there indefinitely,
    `BANDIT.spread` is too wide; if you die in three, it is too tight.
43. **Taking cover behind a rock should actually work.** Their shots should
    stop landing.
44. **Watch them use cover.** A hurt bandit, or one who has lost sight of you,
    goes to the *shoulder* of a nearby rock and shoots from there. Judge
    whether that reads as cover or as milling about — this is the single
    least-confident piece of the round. Levers: `coverSearchRadius`,
    `coverPeekAngle`, `coverStandoff`, `coverHoldTime`.
45. **Kill all but one and the last man runs.** He should keep running until
    he is a long way off (`fleeDistance`, 90m) and then settle down again.
46. **They should not walk through rocks**, and they should not get visibly
    stuck on one for long. BUILD-PLAN.md explicitly accepts that they look
    dumb in tight spaces; what is *not* acceptable is a man grinding against a
    cactus forever. Levers: `avoidRayLength`, `avoidStrength`, `stuckDistance`.
47. **You can outrun them.** Their run is 4.5 against your sprint of 5.5.
48. **Fight a camp from horseback.** This is the round-3 promise cashed in.
    The horse should still steer on A/D, the accuracy penalty should be
    noticeable, and — importantly — **the horse should not be soaking up their
    bullets**. Their shots deliberately ignore it, so a mounted rider is
    hittable; check it does not feel like the opposite.
49. **A dead rider comes off the horse.** Get killed while mounted: the body
    should be put down on the ground, not left sitting in the saddle.

### Dying and coming back

50. **Death and respawn.** You fall, the screen says so, and after a couple of
    seconds you are back at full health with a full cylinder.
51. **Where you come back matters.** Die near a camp you have approached and
    you should reappear about 55m from it, on the town side, facing it —
    close enough to walk straight back in, far enough that they are not
    already shooting. Die near the plateau and you go back to spawn.
52. **The horse should still be findable after a respawn.** Press H.

### Things round 4 changed that were working before

BUILD-PLAN.md's standing warning is that round 4 breaks the horse. These are
the specific places it touched:

53. **The whole round-2 horse list still passes** — mount, ride, bank, gallop,
    stamina, jump, dismount. The frame order changed (a dead rider is
    dismounted before `horse.update`) and the revolver's geometry was rebuilt.
54. **The revolver still looks right in the hand**, on foot and mounted. Its
    seven parts were merged into three meshes for the draw-call budget; the
    hold offsets were not touched, but the geometry was.
55. **The reins, the riding pose and the aiming pose are unchanged** and
    should look exactly as they did in round 3.

### After round 4 — the signal fire

You said you didn't even know there was a campfire. There is now a bonfire
with an 85m smoke column, and it is meant to be the thing that tells you where
a camp is from across the map. All of `CAMP_PROPS` in `src/config-ai.js` is
the lever set.

What I could verify from screenshots: the plume is visible and unmistakable
from the spawn plateau, 335m from Coyote Wash, and from 120m it is a clear
dark column standing out of the hollow. What I could not: whether it looks
right in motion, which is all of the below.

56. **Can you find a camp by its smoke?** Stand at spawn, look west toward
    Coyote Wash. There should be one vertical dark mark on the horizon and it
    should be obvious that it is smoke. This is the whole point of the change
    — if it does not read from there, `CAMP_PROPS.smokeRise` (85) and
    `smokeFadeFrom` (0.9, how late the top dissolves) are the two levers, in
    that order.
57. **Ride toward it.** The column should stay readable the whole way in, and
    the flame should start to carry somewhere in the middle distance. The
    flame is deliberately unfogged so it stays bright at range — if that reads
    as cheating, it is `fog: false` on the flame material in `campfire.js`.
58. **Does the fire look like fire?** Nine tongues flickering out of phase.
    Judge it in motion; a still frame is the one thing I could see and the one
    thing that cannot show whether the flicker rate is right
    (`flameFlickerRate`, `flameFlicker`, `flameSpin`).
59. **Does the smoke look like smoke?** It is thirty-four spheres rising,
    spreading and paling. Watch for the recycle: a puff should have dissolved
    into the haze before it vanishes and reappears at the bottom. If you can
    see one pop, `smokeFadeFrom` is too late.
60. **The fire should not be in anyone's way.** Bandits stand outside it, you
    cannot walk into it, and a shot should pass *over* it rather than being
    swallowed — its collider stops at the top of the pyre, not at the top of
    the flame.
