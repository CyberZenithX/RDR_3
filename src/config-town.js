/**
 * config-town.js — every round-5 tunable: the buildings and where they stand,
 * the street they stand on, the saloon's interior, the hitching post, the
 * lamps, and the townsfolk.
 *
 * The FIFTH config file, and docs/ROADMAP.md asked for it by name: `config.js`
 * was at 389 of BUILD-PLAN.md's 400-line cap with a town's worth of numbers
 * still to write. ADR-023's rule holds — one file per SYSTEM, and a number
 * lives with the system it is a property of — so the town's own geometry is
 * here while `TOWN` (the plateau it stands on, reserved back in round 1) stays
 * in `config.js`, because the plateau is a property of the terrain.
 *
 * Units: 1 unit = 1 metre. Angles in radians. Times in seconds.
 */

// ------------------------------------------------------------------ street ---

/**
 * The main street runs along **Z**, and that is not arbitrary: `SPAWN` is at
 * (6, 76) facing yaw 0 = -Z, straight at `MESAS[0]`. A street laid along Z puts
 * the whole town in front of the player on the first frame, with the church
 * closing the far end and the mesa standing behind it — BUILD-PLAN.md's "the
 * first three seconds decide whether the world reads as a place", cashed in.
 *
 * `southEnd` clears round 3's target range (barrels at z 57–68), so the
 * practice barrels stay on the town's outskirts rather than in its high street.
 */
export const STREET = {
  halfWidth: 8, // the dirt you walk on: |x| < 8
  frontOffset: 10, // world |x| of a building's front wall
  boardwalkDepth: 2.0, // the raised walk between street edge and building front
  southEnd: 48, // where the street opens, coming down off the spawn rise
  northEnd: -52, // ...and where the church's front steps close it

  // No grass on a packed dirt street or under the boardwalks. grass.js reads
  // this; a hard rectangle is cheaper and reads better than trying to test
  // every building footprint per tuft.
  grassKeepOut: { halfX: 26, minZ: -74, maxZ: 52 },
};

// ---------------------------------------------------------------- geometry ---

/**
 * Shared building proportions. Every building is procedural (there is no
 * building GLB to fetch — see docs/ASSETS.md), assembled from boxes,
 * cylinders and cones by buildings.js, and **merged into one vertex-coloured
 * mesh for the whole town**. That is why there is no per-material split here:
 * a part's colour is a vertex attribute, so the entire town costs ONE opaque
 * draw call plus one for the glass. See town-geo.js.
 */
export const TOWN_BUILD = {
  floorStep: 0.22, // how far the boardwalks and the saloon floor stand proud of the dirt
  wallThickness: 0.3,
  doorWidth: 2.6,
  doorHeight: 2.5,
  doorInset: 0.06, // how far a painted-on door panel sits proud of the wall
  windowWidth: 1.25,
  windowHeight: 1.45,
  windowSill: 1.2,
  windowFrame: 0.1,
  roofOverhang: 0.42,
  roofThickness: 0.26,
  falseFrontRise: 1.35, // the parapet that makes a one-storey shed look like a shop
  falseFrontThickness: 0.32,
  porchDepth: 2.3, // the awning over the boardwalk
  porchDrop: 0.35, // how far below the wall top the awning sits
  porchPostRadius: 0.085,
  porchPostSpacing: 4.2, // one post per this much frontage, minimum two
  signHeight: 0.72,
  signThickness: 0.1,
  gableRise: 0.42, // ridge height as a fraction of the HALF-depth (rise over run)
  steepleWidth: 3.2,
  steepleHeight: 7.5,
  steepleSpire: 4.6,
  crossHeight: 1.5,
  crossBar: 0.75,
  crossThickness: 0.12,
  stepDepth: 0.6, // church front steps
  // How close to a frontage you have to be for the HUD to name the building.
  // The painted sign is the real answer to "what is this place"; this is the
  // backstop for standing under an awning where the sign is directly overhead.
  // Deliberately SHORT: at 8 it reached the middle of the street and named a
  // shop you were merely walking past, which is a different claim.
  labelRange: 4.5,
  labelSideMargin: 1.5,
  segments: 8, // radial segments on posts and spires
};

/**
 * The palette. Deliberately inside `COLORS`'s dusty warm range (ochre, sage,
 * bleached bone, rust) rather than a second scheme — the town has to look like
 * it grew on this terrain.
 */
export const TOWN_COLORS = {
  plank: 0x8a6a45,
  plankDark: 0x6a4f34,
  plankPale: 0xa8916c,
  roof: 0x453a30,
  roofPale: 0x5b4d40,
  trim: 0xd3c8ac,
  stone: 0x9a9184,
  door: 0x59402a,
  glass: 0x8fa9b8,
  boardwalk: 0x7d6244,
  iron: 0x4a4a4a,
  lampGlass: 0xffd98a,
  water: 0x3f5c5e,
};

/**
 * The painted lettering on the shop signs — `signs.js` draws all of it into one
 * canvas atlas, so the whole town's signage is one draw call.
 *
 * A blank coloured board is not a shop sign: the human's note after the first
 * pass was that it is "hard to even identify what each building is supposed to
 * be", and they were right — every building was distinguishable only by the
 * colour of a rectangle.
 *
 * There is no font to fetch here (docs/ASSETS.md), so this is whatever serif the
 * browser already has, tracked out by hand and shrunk to fit its board.
 */
export const SIGNS = {
  cellWidth: 1024, // one 8:1 strip of the atlas per sign
  cellHeight: 128,
  fontFamily: 'Georgia, "Times New Roman", "Liberation Serif", serif',
  fontWeight: 'bold',
  maxFontSize: 92,
  minFontSize: 30,
  padding: 46, // horizontal breathing room inside a cell
  tracking: 0.07, // extra letter spacing, in em — this is most of the period feel
  baselineNudge: 2, // px; optical centring beats metric centring on capitals
  inkLight: 0xf4e8cc,
  inkDark: 0x241b12,
  inkLuminanceThreshold: 0.62, // above this the board is light, so use dark ink
  shadowOffset: 3,
  shadowAlpha: 0.34,
  borderColor: 0x000000,
  borderAlpha: 0.22,
  borderWidth: 5,
  borderInset: 11,
  anisotropy: 8, // a sign is nearly always seen at a grazing angle down the street
  faceOffset: 0.014, // how far the painted face stands proud of the board
};

/**
 * The ten buildings, **hand-placed**. BUILD-PLAN.md: "Place buildings by hand
 * from a coordinate list in config.js, not procedurally. Ten hand-placed
 * buildings look like a town; ten scattered ones look like a bug."
 *
 * `side` resolves to a centre and a facing in buildings.js — 'west' and 'east'
 * put the front wall on `STREET.frontOffset` and face it at the street, 'north'
 * stands a building across the far end looking back down it. Writing the side
 * rather than the centre is what guarantees the frontages actually line up;
 * `z` is the centre of the frontage, and every footprint here was checked to
 * leave an alley of at least 7m to its neighbours.
 *
 * All five buildings BUILD-PLAN.md names by name are here (saloon, stable,
 * sheriff's office, gunsmith, church) plus five more, because a street with
 * only the plot-relevant buildings on it reads as a set rather than a town.
 */
export const BUILDINGS = [
  {
    // `signText` overrides `name` on the board: "The Iron Horse" is what the
    // place is called, "THE IRON HORSE SALOON" is what tells you what it is —
    // which is the entire point of putting lettering up there.
    kind: 'saloon', name: 'The Iron Horse', signText: 'The Iron Horse Saloon', side: 'west', z: 16,
    w: 18, d: 14, wallHeight: 3.9, storeys: 2,
    interior: true, porch: true, falseFront: true, windows: 3,
    wall: 0x8a6a45, sign: 0xb5541f,
  },
  {
    kind: 'gunsmith', name: 'Gunsmith', side: 'west', z: 38,
    w: 10, d: 10, wallHeight: 3.4, porch: true, falseFront: true, windows: 2,
    wall: 0x7f6a4e, sign: 0x6b7a4a,
  },
  {
    kind: 'general', name: 'General Store', side: 'west', z: -8,
    w: 12, d: 11, wallHeight: 3.5, porch: true, falseFront: true, windows: 2,
    wall: 0xa8916c, sign: 0x8a5a2c,
  },
  {
    kind: 'stable', name: 'Livery Stable', side: 'west', z: -30,
    w: 15, d: 13, wallHeight: 4.2, gable: true, bigDoor: true, windows: 1,
    wall: 0x6a4f34, sign: 0x50412c,
  },
  {
    kind: 'bank', name: 'Bank', side: 'east', z: 40,
    w: 10, d: 10, wallHeight: 3.7, falseFront: true, stoneBase: true, windows: 2,
    wall: 0x9a9184, sign: 0x3f5c5e,
  },
  {
    kind: 'sheriff', name: "Sheriff's Office", side: 'east', z: 22,
    w: 12, d: 10, wallHeight: 3.4, porch: true, falseFront: true, windows: 2,
    wall: 0x7f6a4e, sign: 0x8a7a3a,
  },
  {
    kind: 'hotel', name: 'Hotel', side: 'east', z: 0,
    w: 13, d: 12, wallHeight: 6.4, storeys: 2, porch: true, windows: 3,
    wall: 0xa8916c, sign: 0x9a4a3a,
  },
  {
    kind: 'barber', name: 'Barber', side: 'east', z: -20,
    w: 8, d: 9, wallHeight: 3.3, porch: true, falseFront: true, windows: 1,
    wall: 0x8a6a45, sign: 0xcfc0a0,
  },
  {
    kind: 'telegraph', name: 'Telegraph', side: 'east', z: -36,
    w: 8, d: 9, wallHeight: 3.3, falseFront: true, windows: 1,
    wall: 0x7f6a4e, sign: 0x5a6a7a,
  },
  {
    // Closes the north end of the street on the axis, which is what makes the
    // street read as a street instead of a gap between two rows of sheds.
    kind: 'church', name: 'Church', side: 'north', x: 0, frontZ: STREET.northEnd,
    w: 13, d: 18, wallHeight: 5.0, gable: true, steeple: true, stoneBase: true, windows: 3,
    wall: 0xbdb096, sign: 0xd3c8ac,
  },
];

/**
 * The saloon's inside — the one walkable interior BUILD-PLAN.md requires ("at
 * minimum"), and the first thing in this game that has an *inside* at all.
 *
 * Two consequences, both handled rather than discovered later:
 *  - the floor stands `TOWN_BUILD.floorStep` above the dirt, so `groundHeightAt`
 *    is now genuinely different from open-terrain height (ADR-031, and the seam
 *    terrain.js has kept named since round 1 for exactly this);
 *  - a bullet must not cross a wall, which is what `raycastBox` is for
 *    (ADR-032). Before it, `raycastColliders` skipped boxes outright.
 */
export const SALOON = {
  ceilingHeight: 3.4,
  ceilingThickness: 0.22,
  barLength: 9.5,
  barDepth: 0.85,
  barHeight: 1.15,
  barTopOverhang: 0.12,
  bottleShelfHeight: 1.8,
  tableCount: 3,
  tableRadius: 0.72,
  tableHeight: 0.78,
  tableTopThickness: 0.1,
  stoolRadius: 0.2,
  stoolHeight: 0.5,
  stoolsPerTable: 3,
  /** Interior point lights. Round 7's day/night owns when these come on. */
  lightHeight: 3.0,
  lightIntensity: 5.5,
  lightDistance: 14,
  lightColor: 0xffc27a,
};

/**
 * The hitching post outside the saloon, and the spot the horse waits on.
 *
 * `standX`/`standZ` is deliberately clear of the rail rather than against it:
 * the rail carries a real collider (with a real `top`, so a shot passes over
 * it), and a wait point inside that circle would have `resolveCollisions`
 * shoving the animal sideways the moment it arrived — which works, and looks
 * exactly like a bug. The horse noses in toward the rail from the street side.
 */
export const HITCH = {
  x: -7.4, // just off the saloon's boardwalk, at the street's edge
  // NORTH of the saloon's doorway, not across it. The doorway lane runs from
  // about z 14 to 18 and the rail, its posts, its trough and the lamp beside it
  // all carry colliders — put any of them on that lane and walking out of the
  // saloon means walking into a hitching post. Found by a smoke check that
  // could not get through the door at all.
  z: 24,
  length: 7, // rail runs along Z
  postRadius: 0.11,
  railRadius: 0.075,
  railHeight: 1.12,
  colliderRadius: 0.45, // per post

  standX: -5.0,
  standZ: 24,
  standYaw: Math.PI / 2, // nose-in to the rail (facing -X)
  /**
   * The horse walks to the rail when the player is inside this radius of the
   * town centre and not riding. Generous on purpose: the point is that you
   * dismount anywhere on the street and find the animal at the post when you
   * come out of the saloon, not that you have to park it precisely.
   */
  callRadius: 70,
  arriveDistance: 1.6,

  troughLength: 2.6,
  troughWidth: 1.0,
  troughHeight: 0.55,
  troughWall: 0.12,
};

/**
 * Street lamps, and the glow tier that makes them read at range.
 *
 * The flame half is `campfire.js`'s, deliberately: an unlit vertex-coloured
 * cone with `fog: false`, one `InstancedMesh` for every lamp in town,
 * flickering off a shared clock (docs/ROADMAP.md pointed at it by name). Two
 * draw calls for the whole street.
 */
export const LAMPS = {
  height: 3.2,
  postRadius: 0.07,
  baseRadius: 0.16,
  baseHeight: 0.3,
  housingSize: 0.42,
  housingHeight: 0.55,
  capOverhang: 0.09,
  glowRadius: 0.3,
  glowHeight: 0.7,
  glowOpacity: 0.85,
  flicker: 0.12, // ± fraction of glow scale
  flickerRate: 4.2,
  colliderRadius: 0.22,

  /** Alternating sides down the street, so the eye reads a line rather than a fence. */
  posts: [
    { x: -8.6, z: 40 },
    { x: 8.6, z: 28 },
    { x: -8.6, z: 10 },
    { x: 8.6, z: 4 },
    { x: -8.6, z: -8 },
    { x: 8.6, z: -20 },
    { x: -8.6, z: -32 },
    { x: 8.6, z: -44 },
  ],

  /**
   * Real `PointLight`s, kept to a hard three. Every one of these is compiled
   * into every standard material's shader in the scene, so this is a number to
   * be stingy with — the eight lamps above carry the *look* of a lit street
   * with unlit glow geometry, and these three are the light that will actually
   * matter when round 7 takes the sun down.
   */
  // `y` is above the floor the light hangs over, and `intensity` is in CANDELA:
  // three r160 runs with `useLegacyLights = false`, so a point light falls off
  // as 1/d². The first cut hung these at 3.0 under a 3.4m ceiling at intensity
  // 5.5 and the whole saloon was black except for two blown-out discs on the
  // ceiling forty centimetres above them. They hang lower and burn much harder
  // now, and `distance` is deliberately short: these lights cast no shadow (a
  // shadowed point light is six more render passes), so their cutoff sphere is
  // the only thing stopping them lighting the street straight through the wall.
  points: [
    { x: -16, y: 2.6, z: 12.5, intensity: 40, distance: 8.5, color: 0xffc27a }, // saloon, over the tables
    { x: -16, y: 2.6, z: 20, intensity: 40, distance: 8.5, color: 0xffc27a }, // saloon, over the bar end
    { x: -8.4, y: 3.1, z: 16, intensity: 18, distance: 7, color: 0xffb867 }, // over the saloon porch
  ],
};

/**
 * The saloon door trigger. BUILD-PLAN.md: "a door trigger that fades in and
 * out."
 *
 * The saloon is genuinely walkable — you push through the doorway, no teleport,
 * no second scene — so the fade is a transition flourish over a threshold you
 * could simply have walked across. Kept SHORT for that reason, and metered:
 * `deadBand` stops standing in the doorway from strobing it, and `cooldown`
 * stops a nervous player from stuttering it. If the fade reads as intrusive in
 * play, `enabled: false` is the whole lever and the doorway still works.
 */
export const DOOR = {
  enabled: true,
  fadeOut: 0.22, // to black
  fadeHold: 0.06,
  fadeIn: 0.3, // ...and back
  maxOpacity: 0.92,
  deadBand: 0.45, // metres either side of the threshold plane
  width: 3.4, // how wide the trigger is, a little wider than the doorway itself
  cooldown: 0.6,
};
