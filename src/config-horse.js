/**
 * config-horse.js — every horse-specific tunable, split out of config.js
 * purely to keep that file under BUILD-PLAN.md's 400-line hard cap (the same
 * split BUILD-PLAN.md itself names as the pattern: "player.js into player.js
 * + player-anim.js"). Still a config file, not game logic — nothing here
 * does anything besides declare numbers. See horse.js/horse-character.js/
 * placeholder-horse.js for behavior.
 */

/**
 * The horse. See horse.js/horse-character.js for behavior, CLAUDE.md's
 * "Models — inventory" for the round-1 flag this round resolves.
 */
export const HORSE = {
  modelPath: '/models/horse.glb',
  // NOT measureHeight()-derived like the player — that lies for this rig.
  // Hardcoded from a real-bone-world-position measurement instead; see
  // CLAUDE.md's "Models — inventory" for the full writeup and how to redo it
  // for a model swap. Visually confirmed at this value via screenshot.
  modelScale: 0.58,
  // The rig's local +Z (nose) is the opposite of this game's yaw-0-faces--Z
  // convention (same mismatch player.glb had). Confirmed by direct render
  // (isolated top-down shot with a -Z compass arrow, nose lined up exactly),
  // not just inferred from bone coordinates — see CLAUDE.md.
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
  // gait and sinks at another. See CLAUDE.md.
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

  staminaMax: 1,
  staminaDrainRate: 0.22, // per second at a gallop
  staminaRegenRate: 0.13, // per second at anything less than a gallop
  staminaExhaustedFloor: 0.04, // gallop is refused at/below this...
  staminaExhaustedRecover: 0.22, // ...until stamina climbs back above this (hysteresis, no flicker)
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

/** Candidates per logical clip. horse.glb has no Trot — see CLAUDE.md's clip inventory. */
export const HORSE_CLIP_CANDIDATES = {
  idle: ['Idle', 'Idle_2', 'Idle_Headlow'],
  walk: ['Walk'],
  gallop: ['Gallop'],
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
 * player.glb has no seated clip of any kind (see CLAUDE.md's clip inventory —
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
};
