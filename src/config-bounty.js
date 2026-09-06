/**
 * config-bounty.js — every round-6 tunable: the bounty loop, the duel, the
 * wanted level and the deputies it spawns.
 *
 * The SEVENTH config file. ADR-023's rule still holds — one file per SYSTEM,
 * and a number lives with the system it is a property of — and round 6 is one
 * system's worth of numbers (a read/ride/fight/collect loop, a scripted duel,
 * a star meter and the lawmen it calls). `config.js` was at 389 of the
 * 400-line cap, so it could not land there anyway.
 *
 * What is NOT here, on purpose: the reward is a property of the bounty, but a
 * deputy's toughness is a property of a man with a gun — so deputies reuse
 * `HEALTH.banditMax` / `HEALTH.playerDamage` from `config-ai.js` unchanged,
 * exactly as a rifle in a later round would.
 *
 * Units: 1 unit = 1 metre. Angles in radians. Times in seconds. Money in
 * whole dollars.
 */

// ------------------------------------------------------------------ bounty ---

/**
 * The bounty board outside the sheriff's office, and the loop it drives:
 * read (press B at the board), ride to the marked camp, clear it, ride back,
 * collect. `rewards` is indexed by `CAMPS` order in config-ai.js; there are
 * three camps and three bounties, which BUILD-PLAN.md says is enough.
 */
export const BOUNTY = {
  rewards: [150, 175, 120], // one per CAMPS entry
  defaultReward: 120, // if a camp is added without a reward line

  // The board itself — pushed into the town's merged mesh as PARTS, never a
  // new mesh (ADR-033). It stands just off the sheriff's boardwalk on the
  // street side, clear of the doorway lane.
  boardW: 3.4,
  boardH: 2.1,
  boardThickness: 0.14,
  postRadius: 0.1,
  postHeight: 1.35,
  sideOffset: 3.4, // local +X from the sheriff's centre — clears the doorway lane
  standoff: 0.9, // how far the board stands off the front of the boardwalk
  boardColor: 0x5c4632,
  frameColor: 0xd3c8ac,
  readRadius: 3.4, // press B within this of the board's trigger point

  // The marker over the accepted camp. One translucent unlit beam plus a
  // spinning ring — `fog: false` so it carries to the horizon, `depthWrite:
  // false` so it never occludes the world. Two draw calls, and only while a
  // bounty is active.
  markerHeight: 130,
  markerRadius: 1.5,
  markerColor: 0xe0a43a, // "ride here"
  markerClearedColor: 0x5fae62, // "done — go collect"
  markerOpacity: 0.24,
  markerRingRadius: 3.4,
  markerSpin: 0.6,
};

// -------------------------------------------------------------------- duel ---

/**
 * The stand-and-draw. Fully scripted — there is no duel AI (ADR-037). The
 * opponent is a townsperson flagged `duelist` in config-townsfolk.js, marked
 * to the player by openly carrying a revolver where every other citizen is
 * unarmed. Press F within `challengeRange` to start it.
 */
export const DUEL = {
  challengeRange: 6.0,
  faceoffTime: 1.1, // camera cut + both squaring up, before the tension timer
  tensionMin: 2.0, // BUILD-PLAN.md: "a randomised 2-5 seconds"
  tensionMax: 5.0,
  window: 0.55, // fire within this long of the signal = a clean kill
  opponentDrawTime: 0.85, // no shot from you by now and the opponent beats you
  penaltyDamage: 2, // hits taken for drawing early or late — survivable, not a kill

  slowMoScale: 0.22, // dt multiplier on the winning shot
  slowMoTime: 0.8, // held at full slow-mo this long...
  slowMoRamp: 0.55, // ...then eased back to normal over this
  holdTime: 2.4, // how long 'resolved' holds the shot before handing control back
  cooldown: 2.5, // after a duel ends, before another can be started

  readyAimWeight: 0.5, // gun half-raised through the stand-off
  turnRate: 8, // rad/s both figures swing to face each other
  recoilPitch: 0.06,
  recoilShake: 0.06,

  // The face-off camera. A third framing that COMPOSES the way aim and mounted
  // do (ADR-037): camera.js lerps the ordinary damped position toward this one
  // by `duel.cameraWeight`, rather than being a second camera object.
  camSide: 4.4, // metres to the side of the line between the two
  camHeight: 1.95,
  camBack: 1.6, // ...and this far behind the player along that line
  camLookHeight: 1.35,
  camBlendRate: 5.0,
};

// ------------------------------------------------------------ wanted level ---

/**
 * BUILD-PLAN.md: "Wanted level rises if you shoot innocents... and the level
 * decays if you get clear of town." Counted in whole stars. The rise is
 * driven off `Townsfolk`'s own crime tally (ADR-038), so `combat.js` is never
 * touched by this round.
 */
export const WANTED = {
  maxStars: 4,
  perCrime: 1, // stars added per innocent hit (a wounding counts, not only a kill)
  clearRadius: 145, // beyond this from TOWN.center the level starts to decay
  decayInterval: 6.0, // one star shed per this many seconds while clear of town
};

// --------------------------------------------------------------- deputies ---

/**
 * The lawmen a wanted level calls out. They are `Bandit` instances
 * (bandit.js + bandit-ai.js) with a different spawn source (ADR-036): parked
 * far out of the world until needed, teleported in around the player when the
 * star meter rises, and stood back down — not killed — when it clears. Dead
 * deputies are spent for the session; the pool is sized so a couple of waves
 * are covered.
 */
export const DEPUTY = {
  poolSize: 6,
  maxActive: 3, // never more than this hunting you at once
  spawnStars: 1, // deputies appear at or above this star count
  spawnRadius: 34, // how far from the player a fresh deputy drops in
  despawnRadius: 95, // ...and how far it has to get before it is parked once stood down
  parkX: 4000, // where an inactive deputy waits — outside the world, colliders and all
  parkZ: 4000,

  corpseLinger: 12, // a downed deputy lies here this long before sinking
  corpseSinkTime: 3,
  corpseSinkDepth: 1.4,
};
