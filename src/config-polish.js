/**
 * config-polish.js — round 7's tunables: the day/night cycle, the wind-swayed
 * grass, the main-menu / pause / settings shell, the checkpoint, and the
 * corner minimap.
 *
 * The EIGHTH config file (ADR-039), and the same call ADR-023 / ADR-035 made
 * every time before it: `config.js` was at 390 of BUILD-PLAN.md's 400-line cap
 * and round 7 is a fistful of new systems' worth of numbers. ADR-023's rule is
 * "one file per system" and ADR-035's precedent is "a round's cohesive set may
 * share one file" — round 7's polish pass is that set.
 *
 * The one round-7 block NOT here is the four looping ambient clips: those live
 * with the rest of the sound layer in `config-combat.js`'s `AUDIO`, because a
 * loop is still the audio system's concern whichever round added it.
 *
 * Units: 1 unit = 1 metre. Angles in radians. Times in seconds.
 */

// -------------------------------------------------------------- day / night ---

/**
 * A real sun arc: the light rises in the east, crosses overhead, and sets warm
 * in the west, and the sky, the fog, the exposure and the town's lamps all
 * follow it. `daynight.js` reads a single scalar `t` in [0, 1) — fraction of a
 * full day — advances it in real time, maps it to a sun elevation, and lerps
 * between the three palettes below.
 *
 * The palettes are keyed to sun *elevation*, not to `t`, so tuning the arc
 * shape never desynchronises the colours from it:
 *   - `night`  — the sun is well below the horizon.
 *   - `golden` — the sun is on or near the horizon (dawn AND dusk).
 *   - `day`    — the sun is high. These values are the round 0–6 look, so at
 *                midday the game renders exactly as it always has.
 *
 * Every colour is a hex int; every other field is a scalar. `daynight.js`
 * blends two adjacent palettes into a scratch each frame — see `_lerpPalette`.
 */
export const DAYNIGHT = {
  dayLengthSec: 210, // real seconds for a full dawn→dusk→dawn cycle
  startT: 0.30, // where the clock starts on boot — mid-morning, full daylight
  // Elevation (sin of the sun angle, −1..1) band edges. Below `nightBelow` it
  // is fully night; above `dayAbove` fully day; `golden` peaks between them.
  nightBelow: -0.14,
  goldenAt: 0.06, // elevation at which `golden` is at full strength
  dayAbove: 0.32,
  // The lamps and the crickets come on when the sun drops below this elevation
  // (with a little hysteresis applied in daynight.js so a lamp never strobes at
  // the exact threshold).
  lampsOnBelow: 0.03,
  // The moon is faked: below the horizon the directional light is lerped toward
  // this fixed gentle angle and this cool colour so night shadows stay sane
  // rather than raking infinitely along the ground.
  moonDir: { x: 0.28, y: 0.62, z: 0.2 },
  minLightElevation: 0.16, // the light's own dir.y is never allowed below this

  day: {
    sunColor: 0xffe3b4, sunIntensity: 2.5,
    // Nudged up from round 0–6's 0.62: the saloon's point lights now go OUT in
    // daylight (that is the whole point of round 7's lamps), so the ambient
    // fill has to carry a readable interior on its own. SMOKE-TEST.md flags it.
    hemiSky: 0xbed3e8, hemiGround: 0xa2743e, hemiIntensity: 0.72,
    skyZenith: 0x4d7fb4, skyHorizon: 0xe8caa0, skyLowHaze: 0xa07c50,
    sunDiscStrength: 2.4, sunHaloStrength: 0.35, sunTint: 0xfff3d6,
    fogColor: 0xd7bd94, fogDensity: 0.00165,
    exposure: 1.1,
  },
  golden: {
    sunColor: 0xff8a3d, sunIntensity: 2.15,
    hemiSky: 0xe6a463, hemiGround: 0x4e2f1b, hemiIntensity: 0.5,
    skyZenith: 0x395069, skyHorizon: 0xff9a48, skyLowHaze: 0xd35a27,
    sunDiscStrength: 3.7, sunHaloStrength: 0.72, sunTint: 0xff9a4a,
    fogColor: 0xd88a52, fogDensity: 0.00205,
    exposure: 1.05,
  },
  night: {
    // Moonlight. Kept low — a dark night is the point — but not so low the
    // player mesh (no emissive) becomes a void at true midnight. SMOKE-TEST.md
    // item flags whether this reads right; hemiIntensity is the lever.
    sunColor: 0x3d5478, sunIntensity: 0.24,
    hemiSky: 0x1b2740, hemiGround: 0x0d1120, hemiIntensity: 0.4,
    skyZenith: 0x090f1e, skyHorizon: 0x1b2338, skyLowHaze: 0x121826,
    sunDiscStrength: 0.0, sunHaloStrength: 0.05, sunTint: 0x2a3a5a,
    fogColor: 0x131b2c, fogDensity: 0.00245,
    exposure: 0.95,
  },
};

// -------------------------------------------------------------- grass wind ---

/**
 * The grass sway, injected into `grass.js`'s `MeshStandardMaterial` through
 * `onBeforeCompile`: a per-vertex offset that scales with height up the blade
 * (the root stays planted, the tip travels) and is phased by the tuft's own
 * world XZ so a field ripples rather than pulsing in unison.
 *
 * These are baked into the shader as literals at build time — there is no
 * runtime need to retune them and no uniform churn for it. Only the clock is a
 * uniform. `STREET.grassKeepOut` is unaffected: grass.js already never PLACES a
 * tuft on the street, so there is nothing there for the wind to move.
 */
export const WIND = {
  amplitude: 0.09, // metres the tip travels at full sway
  frequency: 0.9, // spatial: radians of phase per metre of world distance
  speed: 1.5, // temporal: radians per second
  gustAmplitude: 0.05, // a slower second wave, so it is not a clean sine
  gustSpeed: 0.35,
};

// -------------------------------------------------------------------- menu ---

/**
 * The main menu, the pause menu (the same overlay, reopened by Esc mid-game)
 * and the settings panel. All markup is in index.html; `menu.js` only toggles
 * classes and reads the controls. Defaults here are also the fallback when
 * localStorage is empty or unreadable.
 */
export const MENU = {
  storageKey: 'dust-and-iron.settings',
  defaults: {
    sensitivity: 1.0, // multiplier on INPUT.mouseSensitivity (0.25×–3×)
    invertY: false,
    shadowQuality: 'medium', // 'off' | 'low' | 'medium' | 'high'
    drawDistance: 'far', // 'near' | 'medium' | 'far' — a fog-density multiplier
    masterVolume: 0.75, // 0–1, the live value of AUDIO.masterVolume
    muted: false,
  },
  sensitivityRange: [0.25, 3.0],
  // Sun-shadow map sizes. BUILD-PLAN.md's cap is "2048 max", so 'high' is 2048
  // and the ladder steps down from there; 'off' disables the shadow map.
  shadowSizes: { off: 0, low: 1024, medium: 2048, high: 2048 },
  shadowHighBias: -0.0004, // 'high' also tightens the bias for crisper contact
  // Fog-density multiplier applied on top of whatever the day/night cycle has
  // computed for this moment. Higher = thicker air = less draw distance. 'far'
  // is 1.0 so the default look is exactly the day/night cycle's own fog.
  drawDistanceFog: { near: 1.9, medium: 1.35, far: 1.0 },
};

// ----------------------------------------------------------------- minimap ---

/**
 * The corner minimap. A 2D canvas redrawn each frame (cheap at this size),
 * north-up, showing the town, the bandit camps, an accepted bounty, the horse
 * and the player. BUILD-PLAN.md lists it last and says to drop it first if
 * something must go — it is deliberately the smallest, most severable piece.
 */
export const MINIMAP = {
  size: 150, // px, square
  range: 300, // world metres from edge to edge is 2× this
  playerColor: '#f2c869',
  horseColor: '#8fbcd4',
  campColor: '#c4553a',
  bountyColor: '#5fe08a',
  deputyColor: '#6ea8ff',
  townColor: 'rgba(217, 164, 65, 0.35)',
  ringColor: 'rgba(232, 217, 184, 0.5)',
  bgDay: 'rgba(20, 14, 10, 0.55)',
  bgNight: 'rgba(8, 10, 20, 0.66)',
};
