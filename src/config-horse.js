/**
 * config-horse.js — every horse-specific tunable, split out of config.js
 * purely to keep that file under BUILD-PLAN.md's 400-line hard cap (the same
 * split BUILD-PLAN.md itself names as the pattern: "player.js into player.js
 * + player-anim.js"). Still a config file, not game logic — nothing here
 * does anything besides declare numbers. See horse.js/horse-character.js/
 * placeholder-horse.js for behavior.
 */

/**
 * The horse. See horse.js/horse-character.js for behavior, docs/HORSE.md and
 * docs/ASSETS.md for the round-1 scale flag this round resolves.
 */
export const HORSE = {
  modelPath: '/models/horse.glb',
  // NOT measureHeight()-derived like the player — that lies for this rig.
  // Hardcoded from a real-bone-world-position measurement instead; see
  // docs/ASSETS.md for the full writeup and how to redo it for a model
  // swap. Visually confirmed at this value via screenshot.
  modelScale: 0.58,
  // The rig's local +Z (nose) is the opposite of this game's yaw-0-faces--Z
  // convention (same mismatch player.glb had). Confirmed by direct render
  // (isolated top-down shot with a -Z compass arrow, nose lined up exactly),
  // not just inferred from bone coordinates — see docs/DECISIONS.md ADR-005.
  meshYawOffset: Math.PI,
  colliderRadius: 0.95,
  spawnOffset: { x: 7, z: -5 }, // relative to SPAWN, where the horse starts

  // No hand/seat bone on this rig (BUILD-PLAN.md expects this) — a hand-tuned
  // offset from the horse's root (ground/hoof level, matching PLAYER's own
  // feet-at-origin convention) instead. `y` here is where the rider's *hips*
  // sit, not their feet: the rider is posed seated (see riding-pose.js), so
  // player.js subtracts the rig's own hip height before placing the root.
  // Set against a real measurement, not by eye: raycasting straight down onto
  // the horse's *animated* mesh (SkinnedMesh.raycast applies bone transforms,
  // unlike reading the geometry buffer, which reports the bind pose and is
  // ~0.4 too high) puts the back surface at 1.98 above the horse's origin, and
  // the pelvis rides a little above that so the seat itself lands on the back.
  saddleOffset: { x: 0, y: 2.06, z: -0.02 },

  // The saddle point rides the horse's own spine bone rather than a fixed
  // height, so the rider bobs in sync with whatever clip is actually playing.
  // Measured directly (stepping each clip through its cycle and reading the
  // bone's world Y): this bone travels 0.006 through idle, 0.058 through walk
  // and 0.146 through gallop, and its *mean* height differs per gait too
  // (~1.53 idle, ~1.42 walk) — so any fixed offset necessarily floats at one
  // gait and sinks at another. See docs/HORSE.md.
  saddleBone: 'Torso2',
  // How much of the back's vertical travel the rider actually takes. A real
  // rider absorbs part of it through hip/knee flex rather than being welded to
  // the saddle; 1.0 reads like a sack of flour strapped on.
  saddleFollow: 0.72,
  saddleBobLimit: 0.16, // hard clamp on inherited bob, so a wild clip can't launch the rider

  // Rider body reacting to the horse underneath it.
  riderLean: 0.8, // fraction of the horse's own bank angle the rider shares
  riderGallopPitch: 0.15, // radians of forward lean at full gallop
  riderPitchRate: 3.5, // smoothing rate on that lean, so it eases in/out of a gallop
  riderBobSway: 0.5, // how strongly the gait bob drives the rein-hand/torso motion

  walkSpeed: 2.4, // casual wander / ridden trot-equivalent (no Trot clip exists — see HORSE_CLIP_CANDIDATES)
  approachSpeed: 4.2, // closing the gap when whistled or catching up to the player
  gallopSpeed: 9.2,
  acceleration: 11,
  deceleration: 13,
  turnRate: 2.8, // rad/s the horse body yaws toward its desired heading
  leanFactor: 0.85, // roll radians per rad/s of yaw rate, before clamping
  leanMax: 0.32,
  leanDamping: 8, // exponential smoothing rate on the lean angle itself

  wanderRadius: 13, // random-target radius around the player when idly grazing nearby
  wanderIntervalMin: 3,
  wanderIntervalMax: 7,
  wanderArriveDistance: 1, // close enough to a wander target to pick a new one
  followTriggerDistance: 16, // beyond this, stop wandering and close the gap
  followSettleDistance: 6, // close enough after a follow chase to resume wandering
  whistleArriveDistance: 3, // close enough after being whistled to stop and wait
  playerAvoidRadius: 1.6, // steers gently away from the player at this range so it doesn't stand on top of them

  mountRange: 3.4, // must be within this of the horse to mount with E
  mountLerpTime: 0.4,
  dismountDistance: 1.8, // how far to the side of the horse the player lands

  // -- jumping (Space, while mounted) -- see horse-jump.js -------------------
  // The arc is integrated, not read from the clip. `Gallop_Jump` exists on this
  // rig (so no retargeting problem, unlike the player's removed jump) but is a
  // leg tuck: measured off the GLB, its Body bone rises only 0.231 world units
  // across the whole 1.458s clip, against 0.134 for one ordinary Gallop stride.
  // apex = jumpSpeed^2 / (2*|gravity|) = 1.70m, airTime = 2*jumpSpeed/|gravity|
  // = 0.89s, which at a gallop covers about 8.2m of ground — roughly the width
  // of a median rock's collider plus the horse's own. Chosen against the actual
  // rock population rather than by feel: tops run 0.6-3.6m (see props.js), and
  // belly + apex has to land inside that range or the jump is either useless or
  // makes every boulder in the world irrelevant.
  jumpSpeed: 7.6,
  gravity: -17, // weaker than the player's -22: a big animal hangs a little longer
  groundSnap: 0.3, // distance below the hooves that still counts as landed
  coyoteTime: 0.12, // ...still jumpable this long after leaving the ground
  jumpBuffer: 0.18, // ...and a press this early still fires on landing
  jumpMinSpeed: 1.0, // must be moving at least at a walk; no pogo-sticking on the spot
  jumpStaminaCost: 0.1,

  // Underside of the barrel, above the horse's own root. Measured by raycasting
  // UP into the *animated* mesh (SkinnedMesh.raycast applies bone transforms;
  // the geometry buffer would report the bind pose): 1.10 at the narrowest
  // point under the barrel, rising to 1.42 toward the quarters. The low reading
  // is the one that matters. Cross-checked in the same pass — the back surface
  // read 1.88-1.97 against the 1.98 the saddle offset was set from.
  bellyHeight: 1.1,
  jumpClearMargin: 0.12, // an obstacle must clear the belly by this to be passed

  jumpPitchTakeoff: 0.3, // radians nose-UP while rising (negated in horse-jump.js)
  jumpPitchLanding: 0.24, // ...and nose-down over the descent
  jumpPitchRate: 6, // smoothing rate on that pitch
  jumpPoseBlendRate: 9, // how fast the rider's two-point seat blends in and out
  riderJumpFollow: 0.75, // fraction of the horse's jump pitch the rider shares
  jumpSeatRise: 0.11, // metres the rider lifts out of the saddle at full jump weight
  // The saddle bone's travel through Gallop_Jump, measured the way the gait
  // figures above were — stepping the clip and reading `Torso2` in the horse's
  // own body frame — is 1.157 (-0.408 to +0.750 against its captured rest).
  // That is EIGHT times the gallop's 0.144, because the clip rears the whole
  // forehand up about a root pinned at ground level.
  //
  // Both numbers below were originally set from the 0.231 docs/HORSE.md quotes
  // for the `Body` bone, which is not the bone the seat samples, and both were
  // therefore far too tight: the seat pegged at 0.30 while the back kept rising
  // to 0.75, and the horse came up through the rider around the apex.
  jumpSaddleFollow: 1, // no hip flex absorbs 0.75m — while airborne, follow the back outright
  jumpBobLimit: 0.85, // safety clamp only: clear of the measured 0.750, not a tuning lever
  // Clamp on how far the seat tracks the spine bone longitudinally. Gallop_Jump
  // carries 1.146 world units of baked forward travel on Body, which would
  // otherwise leave the rider sitting over the rump halfway through the arc.
  saddleDriftLimit: 1.4,

  // The size of the tank, in the same units the rates below are per-second in.
  // Briefly raised to 1.5 and then put back to 1 on the human's call: a gallop
  // runs 4.55s from full and a full refill takes 7.7s. This is still NOT
  // assumed to be a 0..1 fraction anywhere — the stamina bar takes
  // `horse.staminaFraction`, not `horse.stamina`, precisely so this number can
  // move without the UI needing to know, and that stays true at 1.
  // What a riderless horse does when it has taken too many rounds (HEALTH.horseMax).
  // It bolts rather than dying — see the note on horseMax in config-ai.js.
  spookTime: 6, // seconds of flat-out running away from whatever hit it
  spookRecoverTime: 12, // ...then this long to get its nerve (and health) back
  spookMountBlock: true, // it will not be caught or mounted while bolting

  staminaMax: 1,
  staminaDrainRate: 0.22, // per second at a gallop
  staminaRegenRate: 0.13, // per second at anything less than a gallop
  // Both thresholds are absolute, not fractions of the tank, and were left
  // where they are: the post-exhaustion lockout stays the same ~1.7s however
  // big the tank gets, rather than the punishment scaling with the buff.
  staminaExhaustedFloor: 0.04, // gallop is refused at/below this...
  staminaExhaustedRecover: 0.22, // ...until stamina climbs back above this (hysteresis, no flicker)

  // ------------------------------------------------------ mounted combat ---
  // Round 3. These live here rather than in config-combat.js because they are
  // properties of shooting FROM A HORSE, not properties of the gun (ADR-009).

  // Multipliers on the shot's spread cone, so they scale hip fire and aimed
  // fire together instead of flattening the difference between them.
  mountedAccuracyPenalty: 2.4,
  jumpAccuracyPenalty: 1.9, // stacked on top, while the horse is over an obstacle

  // While the rider is aiming, W/S and the gallop are dropped and the horse
  // steers on A/D alone (BUILD-PLAN.md: "the horse keeps steering with A/D").
  // It keeps whatever pace it had, capped, rather than coasting to a halt —
  // stopping dead the moment the gun comes up is not what a horse does.
  aimTurnRate: 1.35, // rad/s of yaw from a held A or D
  aimMaxSpeed: 5.2, // the pace an aiming rider is held to, m/s
  aimSpeedDecay: 0.55, // per second, toward that cap
};

/** Speed → locomotion state hysteresis, mirrors player.js's classifySpeed but with the horse's own thresholds. */
export const HORSE_ANIM = {
  fadeTime: 0.25,
  idleThreshold: 0.3,
  gallopThreshold: 6.4,
  blendBand: 1.6,
  minTimeScale: 0.55,
  maxTimeScale: 1.8,
};

/**
 * Candidates per logical clip. horse.glb has no Trot — see docs/ANIMATION.md's
 * clip inventory.
 *
 * `jump` is a one-shot, not a locomotion state: horse-character.js plays it
 * through setAirborne() and setLocomotion() stands aside for the duration.
 * The rig also ships `Jump_toIdle` (1.708s), which is a jump-to-halt
 * transition — wrong for landing back into a gallop, so it is deliberately
 * left unwired rather than blended into the landing.
 */
export const HORSE_CLIP_CANDIDATES = {
  idle: ['Idle', 'Idle_2', 'Idle_Headlow'],
  walk: ['Walk'],
  gallop: ['Gallop'],
  jump: ['Gallop_Jump'],
};

/** Metres/second each horse clip is authored at — same feet-don't-slide reasoning as CLIP_REFERENCE_SPEED. Tuned by eye. */
export const HORSE_CLIP_REFERENCE_SPEED = { idle: 1, walk: 2.4, gallop: 7 };

/**
 * The seated riding pose, in radians, authored in the *character root's* frame
 * (+X = the rider's left, +Y = up, +Z = the way they face — confirmed by
 * reading real bone positions out of the live rig, not assumed). riding-pose.js
 * converts each of these into the bone's own local space at runtime, because
 * this rig's rest orientations are baked-IK arbitrary and hand-authoring angles
 * in bone-local space is unreadable.
 *
 * player.glb has no seated clip of any kind (see docs/ANIMATION.md's list —
 * all 24 are standing/combat), so this pose is the whole of "sitting on a
 * horse". It is applied *after* mixer.update() every frame, which is what lets
 * it win over the idle clip still playing underneath.
 */
export const RIDING_POSE = {
  thighPitch: 0.92, // thigh swings forward from hanging, to sit astride
  // This rig's two legs are NOT mirror images of each other at rest: measured
  // on the live skeleton, the right hip sits 0.11 further forward than the
  // left and its knee 0.25 further forward, in the bind pose and in every
  // clip. A mirrored angle therefore produces an unmirrored leg — the right
  // knee ended up buried inside the horse while the left cleared it. These
  // trims are the right leg's correction, solved for numerically against the
  // left leg's mirrored knee and foot rather than eyeballed.
  rightPitchTrim: -0.6,
  rightSpreadTrim: 0.1,
  rightKneeTrim: -0.1,
  thighSpread: 0.42, // ...and outward, to clear the barrel: measured half-width
  //                     at the saddle is 0.33, so the knee has to reach past that
  kneeBend: 1.02, // shin folds back down so the lower leg hangs by the girth
  anklePitch: 0.12, // toe up, heel down — how a boot sits in a stirrup
  armPitch: 0.42, // upper arm forward from hanging, elbows staying near the ribs
  armIn: 0.20, // ...and tucked in toward the body's centreline
  elbowBend: 0.95, // forearm forward and level, hands meeting over the withers
  torsoPitch: 0.12, // slight forward carriage; a bolt-upright rider reads stiff
  headPitch: -0.04, // chin fractionally up so the rider looks ahead, not down
  gripCurl: 0.62, // fingers closed around the reins — the rest pose has them splayed flat
  thumbCurl: 0.34, // thumb lies over the top, less closed than the fingers

  // Gait-driven motion layered on top of the static pose, driven by the same
  // spine-bone bob the saddle point uses (so it is in phase with the horse by
  // construction, not by a guessed sine wave).
  swayElbow: 0.16, // rein hands give with each stride
  swayTorso: 0.05,
  swayThigh: 0.05, // legs absorb a little of the motion the seat doesn't

  // The jumping (two-point) seat, blended in by HORSE.jumpPoseBlendRate while
  // airborne and added on top of the angles above. A rider over a jump comes
  // up out of the saddle, folds forward at the hip with their weight in the
  // heels, and pushes their hands up the neck so the horse can stretch its
  // head and neck out over the obstacle. The vertical part of "coming up out
  // of the saddle" is HORSE.jumpSeatRise, not an angle — see horse-seat.js.
  jumpTorsoPitch: 0.34, // fold forward at the hip, on top of torsoPitch
  jumpThighPitch: -0.18, // thigh comes back under the rider, out of the sitting angle
  jumpKneeBend: 0.3, // ...and the knee closes to take the weight
  jumpArmPitch: 0.3, // hands go forward up the neck...
  jumpElbowBend: -0.35, // ...by opening the elbow, not by lifting the shoulder alone
  jumpHeadPitch: -0.1, // eyes up, looking past the obstacle rather than down at it
};

/**
 * The bridle and reins (src/reins.js). Every head measurement is expressed in
 * the horse's *own head frame* — `forward` toward the muzzle, `up` toward the
 * ears, `side` across them — because that frame is rebuilt from the ear and
 * head bones each frame and so stays right through every head movement.
 *
 * The numbers come from raycasting the animated head: the muzzle reaches 0.50
 * forward of the head bone and about 0.20 below it, and is roughly 0.17 wide
 * and 0.30 deep where the noseband sits.
 */
export const TACK = {
  color: 0x2b1d13, // dark oiled leather

  bitForward: 0.44, // where the rein leaves the mouth, along the head's forward axis
  bitUp: -0.2,
  bitHalfWidth: 0.11,

  nosebandForward: 0.3,
  nosebandUp: -0.12,
  nosebandHalfWidth: 0.15,
  nosebandHalfHeight: 0.18,

  crownForward: -0.03, // the strap over the poll, just in front of the ears
  crownUp: 0.05,
  crownHalfWidth: 0.13,

  strapRadius: 0.012,
  reinRadius: 0.014,
  reinSag: 0.1, // droop as a fraction of the span — leather, not wire
  reinDrapeSag: 0.16, // reins lie slacker when nobody is holding them
  neckDrapeSide: 0.12, // how far to either side of the neck they rest when unmounted
  // How far above the neck bone the reins are held clear. Without this the
  // straight run from bit to hands cuts through the crest of the neck whenever
  // the horse lowers its head, which it does hard at a gallop.
  neckClearance: 0.28,
};

/** Proportions for the procedural quadruped stand-in used if horse.glb fails to load. */
export const PLACEHOLDER_HORSE = {
  bodyRadius: 0.42,
  bodyLength: 1.5, // half-length of the body capsule
  bodyHeight: 1.35, // ground to spine
  neckLength: 0.65,
  neckRadius: 0.22,
  headLength: 0.5,
  headRadius: 0.18,
  legRadius: 0.13,
  upperLegLength: 0.62,
  lowerLegLength: 0.62,
  legSpreadX: 0.34,
  tailLength: 0.7,
  tailRadius: 0.08,
  swingAmplitude: 0.75,
  swingFrequency: 0.9, // cycles per metre
  bobAmplitude: 0.05,
  idleBreathAmplitude: 0.02,
  idleBreathFrequency: 0.8,
  // Airborne pose. No mixer here, so this is a held pose rather than a clip —
  // all four legs tucked, the same way the real rig's Gallop_Jump reads.
  jumpTuckHip: -0.5,
  jumpTuckKnee: 1.0,
  jumpTuckRise: 0.06,
};
