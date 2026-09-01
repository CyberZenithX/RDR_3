/**
 * config.js — EVERY tunable number in Dust & Iron, and nothing else.
 *
 * Rule from BUILD-PLAN.md: no magic numbers anywhere else in src/. If you want
 * the horse faster, the walk cycle slower or the fog thicker, it is one line in
 * this file. Anything that is a *derived* value (a normalised vector, a bounding
 * box measured off a loaded model) may be computed elsewhere; anything that is a
 * judgement call lives here.
 *
 * Units: 1 unit = 1 metre. Angles in radians. Times in seconds.
 */

// ---------------------------------------------------------------- renderer ---

export const RENDER = {
  fov: 58,
  near: 0.15,
  far: 1800,
  maxPixelRatio: 2,
  exposure: 1.1,
  shadowMapSize: 2048,
  shadowHalfExtent: 42, // sun shadow box, kept tight around the player
  shadowNear: 1,
  shadowFar: 340,
  shadowBias: -0.0007,
  shadowNormalBias: 0.035,
  maxDeltaTime: 0.05, // never step the sim more than this in one frame
};

// ------------------------------------------------------------------ palette ---
// Dusty warm western: ochre, sage, bleached bone, rust.

export const COLORS = {
  sunLight: 0xffe3b4,
  hemiSky: 0xbed3e8,
  hemiGround: 0xa2743e,
  skyZenith: 0x4d7fb4,
  skyHorizon: 0xe8caa0,
  skyLowHaze: 0xa07c50,
  sunDisc: 0xfff3d6,
  fog: 0xd7bd94,
  terrainLow: 0xa78a5c, // ochre dust
  terrainHigh: 0xc9b795, // bleached bone
  terrainSlope: 0x8d5f3a, // rust rock face
  terrainSage: 0x77804f, // sage scrub in the hollows
  rock: 0x9b8a74,
  cactus: 0x5d7345,
  cactusShade: 0x46592f,
  deadWood: 0x6d573a,
  grassRoot: 0x8f8a4e, // lightened from 0x7e7a44 — the darker value read as near-black on backlit blades
  grassTip: 0xd4c48a,
  placeholderBody: 0xb07f4e,
  placeholderSkin: 0xd8a877,
};

export const SKY = {
  domeRadiusFactor: 0.46, // × RENDER.far
  widthSegments: 32,
  heightSegments: 20,
  horizonPower: 2.6,
  lowHazePower: 3.4,
  sunDiscPower: 340,
  sunDiscStrength: 2.4,
  sunHaloPower: 7,
  sunHaloStrength: 0.35,
};

export const SUN = {
  intensity: 2.5,
  hemiIntensity: 0.62,
  // Unnormalised direction from the world toward the sun. Late afternoon.
  dirX: -0.52,
  dirY: 0.6,
  dirZ: 0.61,
  distance: 190, // how far up the shadow-casting light sits from the player
};

export const FOG = { density: 0.00165 };

// -------------------------------------------------------------------- world ---

export const WORLD = {
  size: 1500, // 1500 × 1500 units of terrain
  segments: 256, // grid resolution; cell = size / segments
  seed: 20250810,
};

export const TERRAIN = {
  octaves: 5,
  baseFrequency: 0.00125,
  baseAmplitude: 44,
  lacunarity: 2.06,
  gain: 0.47,
  ridgeFrequency: 0.0029,
  ridgeAmplitude: 24,
  detailFrequency: 0.019,
  detailAmplitude: 0.65,
  warpFrequency: 0.00085,
  warpAmplitude: 110,
  sageNoiseFrequency: 0.006,
  // vertex-colour blending thresholds
  colorLowHeight: 4,
  colorHighHeight: 52,
  slopeRockStart: 0.28, // 1 - normal.y above which rust rock shows through
  slopeRockFull: 0.62,
  sageStrength: 0.55,
};

/** The flat region round 5 builds the town on. Reserved now; retrofitting is a rebuild. */
export const TOWN = {
  centerX: 0,
  centerZ: 0,
  halfSize: 100, // 200 × 200 flat
  blend: 90, // smooth falloff outside halfSize so it does not look stamped
  height: 8,
};

/**
 * World boundary — DECISION: a ridge of impassable hills, backed by a hard
 * clamp partway up the slope so the player can never crest it or reach the edge
 * of the mesh. A "you are leaving the territory" fade shows from `warnAt`.
 */
export const BOUNDARY = {
  ridgeStart: 560,
  ridgeEnd: 740,
  ridgeHeight: 140,
  ridgeNoiseAmplitude: 20,
  playerLimit: 610, // hard stop, partway up the inner face of the ridge
  warnAt: 560,
};

/** Flat-topped mesas, all well clear of the boundary ridge. The first one is what the spawn point faces. */
export const MESAS = [
  { x: 0, z: -400, radius: 120, top: 78, flat: 0.55 },
  { x: -420, z: -150, radius: 95, top: 58, flat: 0.5 },
  { x: 420, z: 220, radius: 100, top: 63, flat: 0.5 },
  { x: 180, z: -260, radius: 65, top: 44, flat: 0.45 },
];

/** On the plateau, on flat ground, yaw 0 = facing -Z = facing MESAS[0]. */
export const SPAWN = { x: 6, z: 76, yaw: 0 };

// ------------------------------------------------------------------- player ---

export const PLAYER = {
  modelPath: '/models/player.glb',
  modelHeight: 1.85, // loaded model is rescaled to exactly this
  radius: 0.38,
  walkSpeed: 2.0,
  sprintSpeed: 5.5,
  acceleration: 24,
  deceleration: 28,
  airControl: 0.3,
  turnRate: 13, // rad/s the mesh yaws toward its movement direction
  // Radians added to the mesh's facing so its modelled -Z axis lines up with
  // its movement direction. Confirmed from a real screenshot: the loaded
  // player.glb faces +Z, not -Z, so it rendered backwards (facing the camera
  // instead of away from it). Math.PI flips it.
  meshYawOffset: Math.PI,
  gravity: -22,
  jumpSpeed: 7.2,
  groundSnap: 0.35, // distance below the feet that still counts as grounded
  coyoteTime: 0.12,
  jumpBuffer: 0.15,
  respawnBelowY: -60, // fell through the world somehow: put them back
};

export const ANIM = {
  fadeTime: 0.22,
  idleThreshold: 0.35, // below this speed the player is idle
  runThreshold: 3.4, // above this we blend to the run clip
  blendBand: 1.2, // width of the walk↔run crossfade band
  minTimeScale: 0.5,
  maxTimeScale: 2.0,
  // No dedicated jump clip (see character.js's file header and
  // docs/DEVELOPMENT-NOTES.md for the removal story) -- this is what makes a
  // jump read as "airborne" at all: player.js multiplies the locomotion clip's
  // driving speed by this before handing it to setLocomotion(), so the
  // idle/walk/run pose that was already playing holds and slows down while
  // in the air instead of continuing at full ground pace.
  airTimeScale: 0.3,
};

/**
 * Metres per second each clip is authored at. `action.timeScale` is set to
 * actualHorizontalSpeed / clipReferenceSpeed so the feet do not slide — there is
 * no foot IK in this project, so these are the only thing keeping the walk off
 * the ice. Tune by eye.
 */
export const CLIP_REFERENCE_SPEED = { idle: 1, walk: 1.5, run: 4.5 };

/** Candidates per logical clip, best first. See findClip() in assets.js. */
export const CLIP_CANDIDATES = {
  idle: ['Idle', 'Idle_Neutral'],
  walk: ['Walk', 'Walk_Forward'],
  run: ['Run', 'Run_Forward', 'Sprint'],
};

/** Jump pose for the procedural PlaceholderHuman fallback (no GLTF skeleton to retarget onto). Rotation.x only, positive = bent, same convention as its walk/run swing code. */
export const JUMP = {
  poseBlendRate: 20, // exponential blend rate, same formula as camera.js
  placeholderHipBend: 0.35,
  placeholderKneeBend: 0.7,
};

/** Proportions for the capsule-and-limbs stand-in used if a GLB fails to load. */
export const PLACEHOLDER = {
  headRadius: 0.115,
  torsoRadius: 0.16,
  torsoLength: 0.5,
  hipHeight: 0.92,
  armRadius: 0.055,
  armLength: 0.56,
  legRadius: 0.075,
  legLength: 0.9,
  shoulderWidth: 0.19,
  hipWidth: 0.1,
  swingAmplitude: 0.85, // rad at full sprint
  swingFrequency: 1.05, // cycles per metre travelled
  bobAmplitude: 0.05,
  idleBreathAmplitude: 0.018,
  idleBreathFrequency: 1.1,
};

// --------------------------------------------------------------------- horse ---
// Split into config-horse.js to keep this file under the 400-line cap — see
// that file's header. Still "every tunable number", just not in this file.

// ------------------------------------------------------------------- camera ---

export const CAMERA = {
  distance: 5.2,
  minDistance: 1.3,
  pivotHeight: 1.55,
  shoulderOffset: 0.35,
  lookAheadHeight: 0.1,
  positionDamping: 16, // exponential; higher = stiffer
  pitchMin: -0.5, // looking up
  pitchMax: 1.1, // looking down
  collisionMargin: 0.5,
  collisionSteps: 14,
  zoomInSpeed: 60, // snap in fast when terrain intrudes
  zoomOutSpeed: 7, // ease back out slowly
  swayWalk: 0.014,
  swayRun: 0.032,
  swayFrequency: 5.6,
  swayRollFactor: 0.55,
  // Pulled back and raised while mounted, per round 2 — same rig, no second
  // camera. ThirdPersonCamera.setMounted(true) swaps distance/pivotHeight to
  // these instead of the on-foot ones above; everything else (collision
  // march, sway, damping) is shared.
  mountedDistance: 7.6,
  mountedPivotHeight: 2.0,
  mountedSwayRun: 0.045, // galloping sways harder than sprinting on foot
  // The pivot's height is chased rather than copied, so a horse jump (1.5m of
  // arc in under a second) reads as the camera being left slightly behind
  // instead of the whole world dropping rigidly with the rider. Deliberately
  // stiff: terrain undulation at any ground speed is far slower than this and
  // is followed essentially exactly.
  pivotFollowRate: 11,
  // ...but a teleport is not motion. Anything bigger than this (respawn, the
  // drop off the side of the horse) snaps rather than sweeping the camera
  // vertically across the gap.
  pivotSnapDistance: 3,
};

export const INPUT = {
  mouseSensitivity: 0.0022, // rad per pixel of movementX/Y
  invertY: false,
};

// -------------------------------------------------------------------- props ---

export const PROPS = {
  seed: 991,
  scatterRadius: 540, // keep everything inside the boundary ridge, off the impassable slopes
  townKeepOut: 118, // round 5 needs the plateau clear
  spawnKeepOut: 10,
  maxSlope: 0.42, // 1 - normal.y above which nothing is placed
  rock: {
    count: 320,
    minScale: 0.55,
    maxScale: 3.2,
    detail: 1,
    lumpiness: 0.34,
    sinkFactor: 0.28, // fraction of the radius buried in the ground
    // One collider factor per geometry variant in props.js's rockGeos array
    // (base lumpiness, x0.7, x1.3, in that order) -- NOT a single shared
    // value like cactus/tree use below. Rocks are lumpy, so their visual XZ
    // radius varies per variant; a single undersized factor (0.8, the old
    // value) let the player walk visibly into large rocks since it was
    // smaller than even the *unbumped* base geometry radius (1.0), let alone
    // a lump bulging outward. Measured directly (max XZ vertex radius across
    // 40 generated samples per variant): 1.34 / 1.24 / 1.44. These values add
    // a small safety margin above that.
    colliderFactors: [1.38, 1.28, 1.48],
  },
  cactus: {
    count: 150,
    minScale: 0.8,
    maxScale: 1.55,
    trunkRadius: 0.2,
    trunkHeight: 2.6,
    armRadius: 0.14,
    armLength: 0.85,
    armHeight: 1.5,
    radialSegments: 9,
    colliderRadius: 0.5,
  },
  tree: {
    count: 110,
    minScale: 0.85,
    maxScale: 1.75,
    trunkRadiusTop: 0.1,
    trunkRadiusBottom: 0.24,
    trunkHeight: 3.4,
    branchCount: 5,
    branchRadius: 0.06,
    branchLength: 1.5,
    radialSegments: 7,
    colliderRadius: 0.45,
  },
};

/**
 * Grass is a fixed pool of instances recentred on the player, with the radial
 * distribution biased so density thins out with distance. Recentring only runs
 * when the player has moved `recenterDistance`, not every frame.
 */
export const GRASS = {
  count: 2600,
  radius: 48,
  radialBias: 0.72, // r = radius * u^bias; <1 thins with distance
  recenterDistance: 9,
  playerKeepOut: 1.4, // grass follows the player continuously; without this it spawns on top of/right behind them and blocks the third-person view
  minScale: 0.55,
  maxScale: 1.3,
  bladesPerTuft: 4,
  bladeHeight: 0.55,
  bladeWidth: 0.075,
  bladeLean: 0.35,
  maxSlope: 0.5,
  townDensityFactor: 0.45, // sparser on the town plateau
  ambientFloor: 0.16, // emissive strength so backlit blades read as dark grass, not near-black spikes
};

// ----------------------------------------------------------------------- ui ---

export const UI = {
  hudInterval: 0.25, // seconds between HUD text updates
  boundaryFadeIn: 3.5, // opacity units per second
  boundaryFadeOut: 1.6,
  boundaryMaxOpacity: 0.85,
};
