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

  /**
   * The horse had no health at all until now — nothing could hurt it and
   * nothing tested it. It has some, but ONLY while riderless.
   *
   * That restriction is the whole design. While the horse is being ridden its
   * collider stays in the bandits' ray-ignore set, so shots pass through it to
   * the rider; letting the animal soak rounds aimed at a mounted player would
   * be the invulnerability that set exists to prevent, and it would change a
   * lethality the human has now confirmed in play reads right. A riderless
   * horse standing in a firefight is a different case, and one where being
   * shootable is simply true.
   *
   * A horse never dies here. Killing the player's only transport at a camp
   * 300m from anywhere is a punishment the game has no answer for, so instead
   * it bolts, and recovers on its own — see HORSE.spook* in config-horse.js.
   */
  horseMax: 6,
  horseDamage: 1,

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

  /**
   * How much a bandit leads a moving target. 0 aims where you are, 1 aims
   * where you would be if you held your course for the whole flight time.
   *
   * Until now this was 0 in all but name: a bandit aimed a straight line at
   * your chest with no allowance for movement at all, which made a galloping
   * rider far harder to hit than the spread numbers suggest. It is deliberately
   * PARTIAL rather than perfect — a man snap-shooting with a revolver leads
   * badly — and deliberately modest, because the human has now confirmed in
   * play that a camp is dangerous enough as it stands. Raising it toward 1
   * makes riding past a camp much more punishing; 0 restores the old behaviour
   * exactly.
   */
  aimLead: 0.3,
  aimLeadBulletSpeed: 90, // notional flight speed the lead is computed against
  horseHitRadius: 0.95, // riderless-horse cylinder a round has to cross
  horseHitHeight: 2.0,

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

  /**
   * What happens to a body once its Death clip has clamped.
   *
   * Before this, a corpse was permanent: it went on being mixer-updated every
   * frame inside `activeRadius` (a posed skeleton's cost, paid forever, for a
   * clip that had already stopped moving) and went on costing its draw calls.
   * Both compound with play time, and draw calls are the budget round 5 has to
   * fit a town inside — see CLAUDE.md.
   *
   * The clip still plays out in full, and the body still lies there long
   * enough to read as the aftermath of a fight; it just stops costing anything
   * once nobody is looking at it changing.
   */
  corpseFreezeGrace: 0.15, // extra seconds of mixer after the clip's own duration, so it clamps cleanly
  corpseLinger: 25, // how long a body lies there in full before it starts to go
  corpseSinkTime: 3, // seconds spent sinking into the ground
  corpseSinkDepth: 1.4, // far enough under that no part of the body shows
  maxCorpses: 6, // bodies kept at once; the oldest goes early rather than piling up
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
 *
 * `radius` is where the men stand, and it must clear
 * `CAMP_PROPS.colliderRadius` (3.0) with room to spare — bandits.js places
 * them between 0.9× and 1.4× of it. It was 6–7 when the fire was a pebble
 * ring; a man spawned inside the bonfire would be shoved out by
 * `resolveCollisions` on frame one, which works and looks like a bug.
 */
export const CAMPS = [
  { name: 'Coyote Wash', x: -330, z: 60, count: 4, radius: 9 },
  { name: 'Buzzard Rock', x: 360, z: -60, count: 4, radius: 9 },
  { name: 'Dry Fork', x: -150, z: 330, count: 3, radius: 8 },
];

/**
 * The signal fire each camp is built around. **This is the camp's landmark,
 * not its decoration** — the human's note after round 4 was "I didn't even
 * know there was a campfire here", and they were right: the first version was
 * a 1.2m ring of pebbles, invisible past about thirty metres.
 *
 * Making the *ring* bigger does not fix that. A fire pit is a ground-level
 * object, and at 300m a ground-level object is behind a hill, under the
 * grass, or lost in `FOG.density`. What carries is **height**, and mostly the
 * smoke: a 30m column stands above the terrain, is the one dark vertical in a
 * landscape of horizontals, and is exactly how you find a camp in a western.
 *
 * So there are three tiers here, each visible at a different range:
 *   the pyre and its boulders   — close, tells you what you are standing at
 *   the flame                   — mid, `fog: false` so it stays a bright
 *                                 beacon rather than fading into the haze
 *   the smoke column            — long, and the only one that survives 300m
 */
export const CAMP_PROPS = {
  // --- the pit itself ----------------------------------------------------
  stoneCount: 14, // ring of boulders about the ashes
  stoneRadius: 0.52,
  stoneRingRadius: 2.8,
  stoneColor: 0x8a8071,
  ashRadius: 2.4,
  ashColor: 0x2b2620,

  // --- the pyre: logs leaning inward to a teepee -------------------------
  logCount: 8,
  logRadius: 0.17,
  logLength: 3.4,
  logLean: 0.42, // radians off vertical; apex ends up ~3.1m up
  logBaseRadius: 1.45, // how far out each log's foot stands
  logColor: 0x4a3524,

  // --- flame -------------------------------------------------------------
  // Unlit (MeshBasicMaterial) and deliberately NOT fogged, so it reads as a
  // light source at range instead of dissolving into the dust like geometry.
  //
  // NINE narrow tongues, not four fat ones. The first pass used six wide cones
  // and it read as exactly that — flat triangles. What makes fire read is a
  // RAGGED SILHOUETTE: many thin tongues at different heights, leaning out at
  // different angles, flickering out of phase, so the outline never resolves
  // into a shape you can name.
  flameCount: 9, // tongues per fire
  flameHeight: 5.2,
  flameRadius: 0.82, // per tongue; wide enough that neighbours MERGE at the base
  flameSpread: 0.85, // how far the outer tongues sit from the axis
  flameLean: 0.3, // radians the outer tongues lick outward
  flameHot: 0xffc247, // base
  flameTip: 0xbb2f0c, // ...to tip
  flameOpacity: 0.8,
  flameFlicker: 0.34, // ± fraction of height, per tongue
  flameFlickerRate: 7.5,
  flameSpin: 0.5, // rad/s the tongues turn, so it never looks like a still

  // --- smoke: the thing you actually see from the ridge -------------------
  // ROUND, not quads. The first pass used the crossed-quad trick vfx.js uses
  // for the muzzle flash, and at seven metres across it read as a stack of
  // grey slabs — a 55ms flash gets away with a hard rectangular edge, a
  // thirty-metre column standing in the sky does not. A low-poly sphere has no
  // silhouette to give itself away, needs no billboarding, and a lot of them
  // overlapping at low opacity is what a smoke column actually is.
  // SEVENTY METRES, and that number is the whole feature. Measured from a
  // screenshot at 320m: a 34m column subtends about 6°, most of which the
  // intervening ridge ate, leaving a dark tick you would never notice — and at
  // 120m the camp sat in a hollow and the column was hidden outright. A camp is
  // 335m from the plateau; the smoke has to clear the terrain between, not just
  // clear the camp.
  smokeCount: 34, // puffs in flight per fire — enough to keep 85m continuous
  smokeRise: 85,
  smokeSpeed: 0.045, // column loops per second (≈22s from base to top)
  smokeStartSize: 2.4,
  smokeEndSize: 18.0, // it spreads as it climbs
  smokeJitter: 3.0, // per-puff wander off the axis, so it is not a bead string
  smokeDrift: 16, // metres the column leans downwind over its full rise
  smokeDriftAngle: 2.2, // radians; the same "wind" for every camp
  // Dark, and it STAYS dark. The first pass paled out to 0xa9a094 and the top
  // of the column — the only part visible over a ridge — disappeared into an
  // ochre sky. Smoke reads by contrast against the horizon, and this sky is
  // bright, so the landmark has to be the dark half.
  smokeNear: 0x2a251f, // dense at the fire...
  smokeFar: 0x4d4639, // ...thinning, but never toward the sky
  // Above this fraction of the rise a puff dissolves into COLORS.fog instead
  // of vanishing when it recycles. An eighteen-metre sphere blinking out at
  // the top of the column is the one thing that would give the whole trick
  // away — but keep the fade LATE. At 0.72 it dissolved the top quarter, which
  // is the only quarter that clears a ridge from 335m: measured from the
  // plateau, the plume had gone the same colour as the sky at exactly the
  // range the whole feature exists for.
  smokeFadeFrom: 0.9,
  smokeOpacity: 0.34,

  // You cannot walk through a bonfire. It carries a real `top` (ADR-012) at
  // the pyre's apex rather than the default Infinity: a shot should pass over
  // a fire, and the flame above the logs is not what stops a bullet.
  colliderRadius: 3.0,
};
