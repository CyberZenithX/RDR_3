/**
 * config-ai.js — every round-4 tunable: the bandits, their camps, and the
 * health/lethality numbers that only exist now that something can shoot back.
 *
 * The fourth config file, and the split docs/ROADMAP.md asked for by name.
 * ADR-023's rule is "one file per SYSTEM, and a number lives with the system
 * it is a property of" — bandits are a new system, and `config.js` was at 384
 * of BUILD-PLAN.md's 400-line cap with no room for a block this size. ADR-027
 * records why HEALTH landed here rather than in `config.js` or
 * `config-combat.js`.
 *
 * Units: 1 unit = 1 metre. Angles in radians. Times in seconds.
 */

// ------------------------------------------------------------------ health ---

/**
 * BUILD-PLAN.md's feel target, stated as numbers: "two body shots kill a
 * bandit, five hits kill the player... Lethal and fast on both sides — this is
 * a western, not a shooter with health sponges."
 *
 * Health is counted in HITS, not in an abstract points pool, because that is
 * how the spec states it and because a revolver round is the only damage
 * source in the game. `banditDamage`/`playerDamage` stay separate numbers so a
 * rifle in a later round can hit harder without redefining what a hit point is.
 */
export const HEALTH = {
  playerMax: 5,
  banditMax: 2,
  playerDamage: 1, // what one of the player's rounds takes off a bandit
  banditDamage: 1, // ...and what one of theirs takes off the player

  // How long a bandit is staggered out of the fight by a hit. Long enough to
  // read as a flinch, short enough that two shots in a row still kill.
  hitStagger: 0.42,
  flinchLean: 0.38, // radians the PROCEDURAL placeholder rocks back on a hit

  // Death, shared by both rigs. The real rig plays its own `Death` clip and
  // ignores `tipTime`; the procedural placeholder has no clips, so it falls
  // back to BUILD-PLAN.md's substitution ("tip the whole model over on its
  // side over 0.6s, sink it slightly into the ground").
  tipTime: 0.6,
  sink: 0.12,

  // The player's own death: how long the body lies there before respawn, and
  // how long the red damage vignette holds after each hit.
  respawnDelay: 2.6,
  damageFlashTime: 0.6,
};

// ----------------------------------------------------------------- bandits ---

export const BANDIT = {
  modelPath: '/models/bandit.glb',
  modelHeight: 1.85, // rescaled to this, same as the player
  // Radians added to the mesh's facing so its modelled axis lines up with its
  // heading. Same asset family as player.glb, so the same value — but its own
  // number, so a different bandit model is one line rather than a shared edit.
  meshYawOffset: Math.PI,
  radius: 0.38, // movement radius, matches PLAYER.radius
  colliderRadius: 0.42, // what other agents are pushed out by
  hitRadius: 0.34, // the cylinder a bullet has to cross to count
  chestHeight: 1.30, // where a bandit aims FROM and where the player aims AT

  // Movement. Deliberately slower than PLAYER.sprintSpeed (5.5) — running is
  // a real escape, and a chase you cannot break is not a fight, it is a
  // treadmill.
  walkSpeed: 1.9,
  runSpeed: 4.5,
  acceleration: 18,
  deceleration: 24,
  turnRate: 9, // rad/s the body yaws toward its heading
  aimTurnRate: 7, // ...or toward the player, while shooting
  groundSnap: 0.4,

  // ------------------------------------------------------------ perception ---
  sightRange: 62,
  sightHalfAngle: 1.2, // ~69° either side of facing; behind them is a blind spot
  closeSenseRange: 7, // ...except this close, where they notice you regardless
  alertTime: 0.5, // the beat between spotting you and reacting
  loseSightTime: 4.5, // how long they keep hunting your last known position
  hearingRange: 70, // a gunshot this near wakes a whole camp

  // ---------------------------------------------------------------- combat ---
  fireRange: 45,
  preferredRange: 16, // they close to this and hold
  tooCloseRange: 7, // ...and back off inside this
  fireInterval: 1.5,
  fireIntervalJitter: 0.9, // added at random, so a camp never fires in lockstep
  magazine: 6,
  reloadTime: 2.2,

  /**
   * Half-angle of a bandit's shot cone. BUILD-PLAN.md: "bandits miss often
   * enough that standing in the open is survivable for a few seconds but
   * stupid." Derived rather than guessed: a shot lands uniformly in a disc of
   * radius d·tan(spread), and the player presents roughly a 0.45m disc, so the
   * hit chance is about (0.45 / (d·tan spread))². At 0.042 that is ~29% at
   * 20m and ~7% at 40m, which with four shooters at this fire rate kills a
   * player standing still in the open in about seven seconds.
   */
  spread: 0.042,
  movingSpreadFactor: 2.1, // firing on the move is much worse
  aimSettleTime: 0.35, // gun comes up before the first shot of an engagement
  playerHitRadius: 0.36, // the cylinder a bandit's round has to cross to hit you

  // Line of sight is two raycasts, run by every bandit that can see this far.
  // Recomputing it 60 times a second per bandit is wasted work — a man does
  // not step behind a rock in 140ms — so the answer is cached this long.
  losInterval: 0.14,

  // ----------------------------------------------------------------- cover ---
  coverSearchRadius: 20,
  coverMinRadius: 0.9, // a pebble is not cover
  coverStandoff: 0.9, // how far off the rock's edge they stand
  /**
   * Cover points are NOT directly behind the rock — that blocks the bandit's
   * own line of sight, which sends them straight back out to chase and makes
   * cover a loop. They stand at its shoulder: this far around from the
   * straight-away direction, on whichever side is nearer.
   */
  coverPeekAngle: 1.0,
  coverArriveDistance: 1.1,
  coverHoldTime: 4.0, // how long a chosen rock is committed to before re-picking

  // ----------------------------------------------------------------- flight ---
  fleeAliveThreshold: 1, // the last man of a camp runs for it
  fleeDistance: 90, // ...and settles down again once this far from the player

  // --------------------------------------------------------------- patrol ---
  patrolRadius: 9,
  patrolIntervalMin: 3.0,
  patrolIntervalMax: 7.5,
  patrolArriveDistance: 1.2,

  /**
   * BUILD-PLAN.md: "No navmesh, no A*." Three short rays forward (centre and
   * ±`avoidRayAngle`) against the collider array; a blocked ray adds a
   * sideways steering force. Plus a stuck detector, because steering alone
   * corners itself.
   */
  avoidRayLength: 3.4,
  avoidRayAngle: 0.52, // 30°, per the spec
  avoidStrength: 1.5,
  stuckDistance: 0.5,
  stuckTime: 2.0,
  sidestepTime: 1.0,

  /**
   * Bandits further than this from the player skip their whole update — brain
   * and rig both. Twelve posed humanoids is real per-frame cost and only one
   * camp is ever near you. They stay rendered (frustum culling handles what is
   * off screen); they are simply frozen mid-idle, which at 160m in this fog is
   * not something you can see.
   */
  activeRadius: 160,

  /**
   * Where the player is put back after dying near a camp. BUILD-PLAN.md says
   * "at the last bandit camp you approached", which taken literally drops you
   * inside a live camp and into a death loop — so it is a stand-off ring at
   * this radius, on the town side of the camp.
   */
  campApproachRadius: 70, // coming this close arms that camp as the respawn
  respawnStandoff: 55,
};

// ------------------------------------------------------------------- camps ---

/**
 * Hand-placed, well outside `PROPS.townKeepOut` (118) and comfortably inside
 * `BOUNDARY.playerLimit` (610). Every site was probed against `heightAt` /
 * `normalAt` over its own footprint before being written down: each is under
 * 4.1m of height spread and 0.04 of slope across a 12m radius, so the camp
 * sits on ground, not on a cliff. `alt D` at (-60, -330) measured 38m of
 * spread and was thrown out for exactly that reason.
 *
 * BUILD-PLAN.md asks for "3–5 enemies" per camp; 4/4/3 is eleven bandits.
 * Round 6's bounty board reads `name` straight off this list.
 */
export const CAMPS = [
  { name: 'Coyote Wash', x: -330, z: 60, count: 4, radius: 7 },
  { name: 'Buzzard Rock', x: 360, z: -60, count: 4, radius: 7 },
  { name: 'Dry Fork', x: -150, z: 330, count: 3, radius: 6 },
];

/** The dead fire each camp is built around — enough to make it read as a place. */
export const CAMP_PROPS = {
  stoneCount: 9, // ring of stones about the ashes
  stoneRadius: 0.17,
  stoneRingRadius: 0.62,
  stoneColor: 0x8a8071,
  logCount: 4,
  logRadius: 0.075,
  logLength: 1.05,
  logColor: 0x4a3524,
  ashRadius: 0.5,
  ashColor: 0x2b2620,
  colliderRadius: 0.75, // you cannot walk through a campfire
};
