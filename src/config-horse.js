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
  // feet-at-origin convention) instead. Visually checked via a mounted-view
  // screenshot and reads correctly (rider sits on the saddle, not floating
  // or sunk in) — see CLAUDE.md. Still a first-pass guess; nudge to taste.
  saddleOffset: { x: 0, y: 1.32, z: 0.08 },

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
