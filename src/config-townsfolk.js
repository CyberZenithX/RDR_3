/**
 * config-townsfolk.js — every tunable for the town's citizens.
 *
 * The SIXTH config file, and split from `config-town.js` under BUILD-PLAN.md's
 * 400-line cap on the same seam `config-ai.js` was cut on: the bandits are a
 * system with their own file, and so are the townsfolk. `config-town.js` keeps
 * the built fabric — the street, the buildings, their signage, the saloon, the
 * rail and the lamps — because those are properties of the town, not of the
 * people standing in it.
 *
 * Units: 1 unit = 1 metre. Angles in radians. Times in seconds.
 */

/**
 * Idle townsfolk. BUILD-PLAN.md: "Idle townsfolk NPCs that wander a short
 * patrol and turn to look at you when you pass."
 *
 * They are `player.glb`, not `bandit.glb`, and that is a deliberate choice
 * rather than a coin toss: there is no third humanoid to fetch (docs/ASSETS.md),
 * and dressing the townsfolk in the enemy silhouette would have five men who
 * read as bandits standing in the middle of town. Each one clones its own
 * MATERIALS (not its geometry) and multiplies a `tint` through them, which is
 * safe precisely where recolouring a bandit is not — a bandit shares one
 * material by reference across eleven bodies (rig-clone.js), a townsperson owns
 * its own copies.
 *
 * They carry `Health` and are shootable, per docs/ROADMAP.md: round 6's wanted
 * level is built on shooting innocents, and an invulnerable prop is a worse
 * starting point than a man who can be shot.
 */
export const TOWNSFOLK = {
  modelPath: '/models/player.glb',
  modelHeight: 1.82,
  meshYawOffset: Math.PI, // same asset family as the player, so the same value
  radius: 0.36,
  colliderRadius: 0.4,
  hitRadius: 0.34,
  chestHeight: 1.28,
  maxHealth: 2,

  walkSpeed: 1.15, // a stroll, not a patrol
  acceleration: 10,
  deceleration: 14,
  turnRate: 6,
  lookTurnRate: 4.5,

  patrolRadius: 4.5,
  patrolIntervalMin: 3.5,
  patrolIntervalMax: 9.0,
  patrolArriveDistance: 0.8,
  pauseMin: 1.5, // they stand still between strolls — they are idling, not marching
  pauseMax: 5.0,

  /** Inside this they stop and turn to watch you go past. */
  lookRadius: 9,
  lookHoldTime: 1.6, // ...and keep watching this long after you leave it

  /** Gunfire this close sends them running. */
  panicHearingRange: 45,
  panicTime: 9,
  panicSpeed: 3.6,

  activeRadius: 130, // past this they are frozen mid-idle, exactly as bandits are

  tints: [
    0xffffff,
    0xd8c9b4,
    0xc9b8a0,
    0xe6d2b8,
    0xb9ad9a,
  ],

  /** Where each one idles. Anchors, not paths — the wander is around these. */
  spawns: [
    { x: -9.0, z: 21, tint: 0 }, // on the saloon's boardwalk
    { x: -5.5, z: -6, tint: 1 }, // outside the general store
    { x: 9.0, z: 22, tint: 2 }, // outside the sheriff's office
    { x: 2.0, z: 8, tint: 3 }, // crossing the street
    { x: -7.5, z: -27, tint: 4 }, // by the stable
  ],
};
