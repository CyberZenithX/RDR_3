/**
 * config-combat.js — every round-3 tunable: the revolver, aiming, the shot
 * itself, the effects it throws off, the shootable targets, and the audio.
 *
 * Split out of config.js for the same reason config-horse.js was (ADR-009 /
 * ADR-023): config.js was already at 354 of BUILD-PLAN.md's 400-line cap, and
 * combat is the largest single block of tunables in the game. Still just
 * numbers, no logic, and still "every tunable in one findable place" — the
 * rule is one file per system, not one file total.
 *
 * The one combat number that is NOT here is the mounted accuracy penalty: it
 * lives in config-horse.js with the rest of the horse's own tunables, because
 * it is a property of shooting *from a horse*, not of the gun. See ADR-009.
 *
 * Units: 1 unit = 1 metre. Angles in radians. Times in seconds.
 */

// ----------------------------------------------------------------- revolver ---

/**
 * The gun's own shape and where it sits in the hand. Modelled on a Colt
 * Single Action Army: 190mm barrel, 280mm overall.
 *
 * `holdPosition` and `muzzleOffset` are in METRES, in the hand bone's own
 * axes, and are divided by the bone's live world scale at attach time — this
 * rig carries a large baked armature scale a parented mesh would otherwise
 * inherit (the same trap reins.js sidesteps by not parenting at all). So
 * these read as real-world sizes whatever the armature is scaled by.
 */
export const GUN = {
  // Runtime bone names, dots already stripped by GLTFLoader ('Wrist.R' ->
  // 'WristR') — see docs/ANIMATION.md. Tried in order; the later ones are the
  // names other rigs use, so a model swap has a chance of just working.
  handBoneCandidates: ['WristR', 'RightHand', 'HandR', 'hand_r', 'mixamorigRightHand', 'Bip01_R_Hand'],

  barrelLength: 0.19,
  barrelRadius: 0.0115,
  cylinderLength: 0.042,
  cylinderRadius: 0.023,
  frameLength: 0.075,
  frameHeight: 0.052,
  frameWidth: 0.026,
  gripLength: 0.115,
  gripRadius: 0.019,
  gripRake: 0.42, // radians the grip sweeps back from vertical
  hammerSize: 0.018,
  radialSegments: 10,

  // Where the gun sits relative to the hand bone, and how it is turned there.
  // These are the numbers to nudge if the revolver floats off the fist or
  // points the wrong way — BUILD-PLAN.md promised they would be wrong first,
  // and they were: at (0,0,0) the barrel came out of the fist sideways,
  // pointing (-0.89, 0.45, 0.09) in the character's own frame.
  //
  // MEASURED, NOT EYEBALLED. `WristR`'s rest orientation on this rig is
  // arbitrary (it is a baked-IK rig — docs/ANIMATION.md), so there is no
  // readable angle to guess at. Both numbers were solved off the live
  // skeleton with the aim pose applied:
  //   holdRotation — the bone-space rotation that sends the gun's own +Z
  //     (the barrel) onto the character root's forward axis, with world up as
  //     the roll reference.
  //   holdPosition — the offset that lands the GRIP (not the gun's origin,
  //     which is the back of the frame) in the middle of the palm, 55% of the
  //     way from the wrist joint to the knuckles. Wrist-to-knuckles measured
  //     0.146m on this rig.
  // Re-derive both if AIM_POSE's arm angles change materially.
  holdPosition: { x: -0.062, y: 0.104, z: -0.017 },
  holdRotation: { x: -1.467, y: 0.557, z: 1.984 },

  // The empty the muzzle flash and the raycast BOTH come from, relative to the
  // gun's own origin (the back of the frame). Not the camera — BUILD-PLAN.md
  // is explicit about this, and smoke.mjs checks the parent chain.
  muzzleOffset: { x: 0, y: 0, z: 0.30 },

  colorSteel: 0x4a4a52,
  colorBlued: 0x2e2f36,
  colorWood: 0x6b432a,
  roughnessMetal: 0.35,
  metalness: 0.9,
};

// -------------------------------------------------------------- ballistics ---

export const COMBAT = {
  magazine: 6,
  fireInterval: 0.34, // a single-action revolver is not a machine gun
  reloadTime: 1.7, // R is locked out this long; audio/reload.ogg is 0.96s and plays once inside it
  range: 220,

  // Half-angle of the random cone a shot is scattered into. Hip fire is a
  // genuine penalty; aimed fire is near-exact.
  spreadHip: 0.055,
  spreadAim: 0.005,

  // The shot marches heightAt() rather than raycasting the terrain mesh —
  // 131k triangles with no BVH, the same reasoning as ADR-002's camera march.
  terrainMarchStep: 0.6, // first step, near the muzzle, where precision matters
  terrainMarchGrowth: 1.06, // each step is this much longer than the last
  terrainRefineSteps: 6, // bisection passes once a step lands under the surface

  // Recoil, split between the three things it moves.
  recoilPitchKick: 0.055, // radians the camera pitches up per shot
  recoilShake: 0.09, // metres of positional camera shake per shot
  recoilPoseKick: 1.0, // 0..1 into the pose's recoil angles (see AIM_POSE)
  recoilRecover: 7.5, // exponential rate the pose recoil eases back at

  // Nothing has health until round 4, so targets count hits instead.
  barrelHits: 2,
  bottleHits: 1,
};

// --------------------------------------------------------------- aim / pose ---

/**
 * The aiming pose, hand-authored in exactly the idiom riding-pose.js
 * established: angles in the character root's frame (+X left, +Y up,
 * +Z forward), applied after the mixer, from a captured baseline.
 *
 * There IS a real Gun_Shoot clip on this rig, and docs/ANIMATION.md notes no
 * procedural recoil is *needed* on foot. This uses one anyway, deliberately —
 * see ADR-024. A clip cannot point where the crosshair points, and a
 * full-body shoot clip cannot coexist with the seated riding pose, so one
 * pose layer that works in both places beats two that each work in one.
 */
export const AIM_POSE = {
  blendRate: 12, // exponential rate the aim weight eases in/out at

  // Right arm: up from hanging, extended forward, tucked toward the sightline.
  armPitch: 1.42, // toward horizontal
  armIn: 0.30, // across the chest, toward the aim line
  elbowBend: 0.30, // a shooter's arm is not locked straight
  wristPitch: 0.10,

  // Left arm — the supporting hand comes up under the right while on foot.
  // Scaled away while mounted, where the left hand keeps the reins.
  supportArmPitch: 1.20,
  supportArmIn: 0.62,
  supportElbowBend: 0.85,

  // Spine and head lean into the sights.
  chestPitch: 0.10,
  chestYaw: 0.14, // right shoulder turned forward, into the aim line
  headPitch: 0.06,

  // How much of the camera's elevation the arm carries. 1 = the arm tracks the
  // crosshair exactly; less than that leaves some of it to the illusion, which
  // reads better than a shoulder rotated to a physically silly angle.
  elevationFollow: 0.75,
  elevationMin: -0.55,
  elevationMax: 0.5,

  // Recoil, at recoilPoseKick = 1.
  recoilArmPitch: -0.30, // muzzle flips up
  recoilChestPitch: -0.09,

  // The Reload fake, per BUILD-PLAN.md's substitution table: this rig has no
  // Reload clip (docs/ANIMATION.md), so the gun dips below frame instead.
  reloadArmDrop: 1.05, // positive: unwinds armPitch, dropping the gun below frame
  reloadArmIn: 0.35,
  reloadElbowBend: 0.75,

  // Fingers close around the grip via RidingPose's own grip machinery, which
  // already solved the hard part — the naive knuckle axis is the zero vector
  // on this rig (docs/ANIMATION.md).
  gripCurl: 0.85,
  thumbCurl: 0.5,
};

// -------------------------------------------------------------------- vfx ---

export const VFX = {
  flashDuration: 0.055,
  flashSize: 0.17,
  flashColor: 0xffd28a,
  flashLightIntensity: 9,
  flashLightDistance: 7,

  tracerDuration: 0.06,
  tracerRadius: 0.011,
  tracerColor: 0xffe9b0,
  // Ring sizes, both round 4's. One shooter needed neither: a revolver cannot
  // outrun COMBAT.fireInterval. A camp of four bandits can, so a single tracer
  // mesh would be handed round and only ever show one shot in flight, and the
  // parented player flash cannot also be at a bandit's barrel (see vfx.js).
  tracerCount: 4,
  enemyFlashCount: 3,

  sparkCount: 9,
  sparkDuration: 0.28,
  sparkSize: 0.05,
  sparkSpeed: 3.4,
  sparkGravity: -9,
  sparkColor: 0xffb257,

  decalCount: 24, // ring buffer; the 25th shot reuses the 1st decal
  decalRadius: 0.055,
  decalLift: 0.012, // pushed off the surface so it does not z-fight
  decalColor: 0x1a1410,
  decalOpacity: 0.8,

  // A revolver ejects its whole cylinder at once, so shells drop on RELOAD,
  // not per shot — which is also what makes the reload read from outside.
  shellCount: 12, // pool size: two full cylinders in flight
  shellLength: 0.028,
  shellRadius: 0.0055,
  shellColor: 0xb08d3f,
  shellLife: 2.4,
  shellSpeed: 1.7,
  shellSpin: 9,
  shellGravity: -13,
  shellBounce: 0.35,

  debrisCount: 14, // per destroyed target
  debrisSize: 0.075,
  debrisLife: 1.6,
  debrisSpeed: 3.2,
  debrisGravity: -12,
};

// --------------------------------------------------------------- targets ---

/**
 * Shootable barrels, and bottles standing on top of them. Hand-placed rather
 * than scattered: BUILD-PLAN.md asks for something to test on, and a test
 * range you have to go looking for is not one. Every coordinate is on the town
 * plateau near SPAWN and well inside BOUNDARY.playerLimit.
 *
 * Barrels get a real collider `top` (ADR-012) because they are low enough for
 * the horse to jump; bottles ride on barrel lids, so nothing ever has to walk
 * into one.
 */
export const TARGETS = {
  barrelRadius: 0.34,
  barrelHeight: 0.88,
  barrelBulge: 1.14, // mid-body radius multiplier
  barrelSegments: 12,
  barrelColor: 0x6d4a2a,
  barrelHoopColor: 0x4a4038,
  barrelColliderFactor: 1.05, // × barrelRadius

  bottleHeight: 0.30,
  bottleRadius: 0.043,
  bottleNeckRadius: 0.017,
  bottleSegments: 9,
  bottleColor: 0x2f5e3a,
  bottleOpacity: 0.72,

  // World XZ. Every entry with `bottles: n` stands that many on its lid.
  barrels: [
    { x: 4.0, z: 64.0, bottles: 2 },
    { x: 6.2, z: 63.2, bottles: 1 },
    { x: 8.4, z: 63.8, bottles: 2 },
    { x: 10.6, z: 65.0, bottles: 0 },
    { x: -1.0, z: 65.4, bottles: 1 },
    { x: -3.4, z: 66.6, bottles: 2 },
    { x: 12.4, z: 67.0, bottles: 1 },
    { x: -5.6, z: 68.4, bottles: 0 },
    { x: 15.0, z: 58.0, bottles: 2 },
    { x: 17.2, z: 57.4, bottles: 1 },
    { x: -9.0, z: 57.0, bottles: 2 },
    { x: -11.2, z: 58.2, bottles: 1 },
  ],
  bottleSpacing: 0.16,
};

// ------------------------------------------------------------------ audio ---

/**
 * Every clip is wrapped so a missing file logs one warning and plays silence —
 * BUILD-PLAN.md's rule, and the reason audio.js never throws. All three are
 * CC0; provenance is in docs/ASSETS.md.
 */
export const AUDIO = {
  basePath: '/audio/',
  masterVolume: 0.75,
  files: {
    gunshot: 'gunshot.ogg',
    reload: 'reload.ogg',
    hit: 'hit.ogg',
  },
  // More than one voice per sound: firing again before the tail of the last
  // shot has finished must not cut it off.
  voices: { gunshot: 4, reload: 1, hit: 4 },
  refDistance: 9,
  rolloffFactor: 1.1,
  maxDistance: 320,
  // All three files are peak-normalised to about -4 dBFS, which leaves the
  // headroom Vorbis needs on a sharp transient but does NOT balance them by
  // ear: a gunshot is one short spike with a low average level, while the
  // reload rattle and the wood impact are dense and sit much higher for their
  // peak. Left flat they read as louder than the shot. This is the lever that
  // fixes that, and it is the right place for it — the files stay unclipped
  // and the mix is a number in config.
  volumes: { gunshot: 1.0, reload: 0.55, hit: 0.6 },
  // How many discrete transients each clip is allowed to contain, checked by
  // smoke.mjs against the decoded buffer. This exists because the first
  // gunshot.ogg was THREE gunshots — the CC0 source is a six-shot take and the
  // trim caught three of them (docs/DEVELOPMENT-NOTES.md).
  //
  // It is per-file rather than a blanket "one", because a reload legitimately
  // IS a sequence: the cylinder swinging out, the rounds going in, the snap
  // shut. A gunshot and a bullet impact are single events and anything more is
  // a bad trim. 4 for the reload leaves room for its mechanics while still
  // catching two whole reloads spliced together.
  maxOnsets: { gunshot: 1, reload: 4, hit: 1 },
  // Randomised per shot so a string of six does not sound like a loop.
  pitchJitter: 0.07,
};
