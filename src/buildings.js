/**
 * buildings.js — one building, from a spec in `config-town.js`'s `BUILDINGS`
 * list, assembled out of boxes and prisms by `town-geo.js`.
 *
 * Everything here is authored in the building's OWN frame — local X across the
 * frontage, local Z into the depth, front wall at local -Z, origin on the floor
 * at the plateau's height — and `PartBuilder.setFrame()` puts it in the world.
 * That is what lets a spec say `side: 'west'` and get a front wall that lines up
 * with its neighbours to the centimetre.
 *
 * THREE THINGS THIS FILE OWNS BESIDES GEOMETRY, and each of them is the reason
 * a building is not just scenery:
 *
 *  - **Box colliders** — round 5 is `resolveBox`'s first real caller, written
 *    back in round 1 and unused since. A solid building is one box on its
 *    footprint; the saloon is five, because a front wall with a doorway in it is
 *    two walls. Every one keeps `top: Infinity` per the collision contract: a
 *    building is not something to be jumped over, or shot over.
 *  - **Floor plates** — the boardwalks and the saloon's floorboards stand
 *    `TOWN_BUILD.floorStep` above the dirt, and `terrain.js`'s `groundHeightAt`
 *    honours them (ADR-031). A plate is a surface, never a collider: a 22cm step
 *    registered as an obstacle would be an invisible wall down the whole street.
 *  - **The saloon's inside** — the first thing in this game with an interior.
 *    Its walls are real geometry with real thickness, so the doorway reads as a
 *    doorway from both sides, and its floor is simply the top face of the sill
 *    box the building stands on.
 */

import { TOWN } from './config.js';
import { STREET, TOWN_BUILD, TOWN_COLORS, SALOON } from './config-town.js';
import { addBoxCollider } from './collision.js';
import { addFloorPlate } from './terrain.js';

/**
 * Where a spec stands, and which way it looks. Yaw follows the game's
 * convention (yaw 0 faces -Z), so a building's front direction is the same
 * expression `camera.getForward()` uses.
 */
export function resolvePlacement(spec) {
  const half = spec.d / 2;
  if (spec.side === 'west') return { cx: -(STREET.frontOffset + half), cz: spec.z, yaw: -Math.PI / 2 };
  if (spec.side === 'east') return { cx: STREET.frontOffset + half, cz: spec.z, yaw: Math.PI / 2 };
  // 'north' — across the far end of the street, looking back down it.
  return { cx: spec.x ?? 0, cz: spec.frontZ - half, yaw: Math.PI };
}

/** Registers a collider for a part described in the builder's current local frame. */
function localBoxCollider(b, lx, lz, w, d, meta) {
  const p = b.toWorld(lx, lz);
  return addBoxCollider(p.x, p.z, w, d, b.yaw, meta);
}

/** Registers a walkable plate described in the builder's current local frame. */
function localFloorPlate(b, lx, lz, w, d, y) {
  const p = b.toWorld(lx, lz);
  return addFloorPlate(p.x, p.z, w, d, b.yaw, y);
}

/** Evenly spaced offsets across a frontage of `w`, `n` of them, inset from the corners. */
function spread(w, n, inset) {
  const out = [];
  const span = w - inset * 2;
  if (n <= 1) return [0];
  for (let i = 0; i < n; i++) out.push(-span / 2 + (span * i) / (n - 1));
  return out;
}

/**
 * Builds one building into the shared opaque and glass builders.
 *
 * @param {object} spec an entry from `BUILDINGS`
 * @param {object} ctx `{ opaque, glass }` — two `PartBuilder`s, because glass
 *   needs a transparent material and therefore its own merged mesh.
 * @returns {object} the placement plus the pieces other systems need: the
 *   interior box (the saloon's, for the door trigger) and the frontage.
 */
export function buildBuilding(spec, ctx) {
  const t = TOWN_BUILD;
  const { opaque, glass } = ctx;
  const { cx, cz, yaw } = resolvePlacement(spec);
  const baseY = TOWN.height; // the plateau is dead flat inside TOWN.halfSize
  const baseH = spec.stoneBase ? 0.5 : t.floorStep;
  const w = spec.w;
  const d = spec.d;
  const wallTop = baseH + spec.wallHeight;
  const front = -d / 2;
  // A gable's ridge height, as a fraction of the HALF-depth: a roof's pitch is
  // rise over run, and the run from eave to ridge is half the building.
  const gableRise = spec.gable ? (d / 2) * t.gableRise : 0;

  opaque.setFrame(cx, baseY, cz, yaw);

  // ------------------------------------------------------------- the sill ---
  // Slightly oversized, so the walls read as standing ON something. Its top
  // face IS the interior floor — no separate floorboards needed.
  opaque.box(w + 0.24, baseH, d + 0.24, 0, baseH / 2, 0,
    spec.stoneBase ? TOWN_COLORS.stone : TOWN_COLORS.plankDark);

  // --------------------------------------------------------------- walls ---
  const interiorBox = spec.interior
    ? { hw: w / 2 - t.wallThickness, hd: d / 2 - t.wallThickness, floorY: baseY + baseH }
    : null;

  if (spec.interior) {
    const th = t.wallThickness;
    const h = spec.wallHeight;
    const doorW = t.doorWidth;
    const flankW = (w - doorW) / 2;
    const flankX = (w + doorW) / 4;
    opaque.box(w, h, th, 0, baseH + h / 2, d / 2 - th / 2, spec.wall); // back
    opaque.box(th, h, d, -w / 2 + th / 2, baseH + h / 2, 0, spec.wall); // left
    opaque.box(th, h, d, w / 2 - th / 2, baseH + h / 2, 0, spec.wall); // right
    opaque.box(flankW, h, th, -flankX, baseH + h / 2, front + th / 2, spec.wall);
    opaque.box(flankW, h, th, flankX, baseH + h / 2, front + th / 2, spec.wall);
    // The lintel over the doorway. No collider: a shot through the gap above a
    // door is a rounding error next to a wall a bullet used to ignore entirely.
    opaque.box(doorW, h - t.doorHeight, th, 0, baseH + t.doorHeight + (h - t.doorHeight) / 2, front + th / 2, spec.wall);
    // The batwing doors themselves — two short leaves, swung open.
    for (const s of [-1, 1]) {
      opaque.box(doorW / 2 - 0.12, 1.15, 0.07, s * (doorW / 2 - 0.35), baseH + 1.35, front + 0.34, TOWN_COLORS.door);
    }
    opaque.box(w, SALOON.ceilingThickness, d, 0, baseH + SALOON.ceilingHeight + SALOON.ceilingThickness / 2, 0, TOWN_COLORS.plankDark);

    localBoxCollider(opaque, 0, d / 2 - th / 2, w, th, { kind: 'building', name: spec.name, part: 'back' });
    localBoxCollider(opaque, -w / 2 + th / 2, 0, th, d, { kind: 'building', name: spec.name, part: 'left' });
    localBoxCollider(opaque, w / 2 - th / 2, 0, th, d, { kind: 'building', name: spec.name, part: 'right' });
    localBoxCollider(opaque, -flankX, front + th / 2, flankW, th, { kind: 'building', name: spec.name, part: 'frontL' });
    localBoxCollider(opaque, flankX, front + th / 2, flankW, th, { kind: 'building', name: spec.name, part: 'frontR' });
    localFloorPlate(opaque, 0, 0, w - th, d - th, baseY + baseH);
  } else {
    opaque.box(w, spec.wallHeight, d, 0, baseH + spec.wallHeight / 2, 0, spec.wall);
    localBoxCollider(opaque, 0, 0, w, d, { kind: 'building', name: spec.name });
    // A closed door, painted on. `bigDoor` is the stable's wagon opening.
    const dw = spec.bigDoor ? Math.min(w * 0.55, 5.2) : t.doorWidth * 0.72;
    const dh = spec.bigDoor ? Math.min(spec.wallHeight - 0.4, 3.4) : t.doorHeight;
    opaque.box(dw, dh, t.doorInset, 0, baseH + dh / 2, front - t.doorInset / 2, TOWN_COLORS.door);
    if (spec.bigDoor) {
      // A cross-brace on each leaf, so it reads as boards rather than a slab.
      for (const s of [-1, 1]) {
        opaque.box(dw / 2 - 0.1, 0.13, t.doorInset + 0.03, s * dw / 4, baseH + dh * 0.55, front - t.doorInset, TOWN_COLORS.plankPale);
      }
    }
  }

  // ---------------------------------------------------------------- roof ---
  const ov = t.roofOverhang;
  if (spec.gable) {
    opaque.prism(d / 2 + ov, gableRise, w + ov * 2, 0, wallTop, 0, TOWN_COLORS.roof);
  } else {
    opaque.box(w + ov * 2, t.roofThickness, d + ov * 2, 0, wallTop + t.roofThickness / 2, 0, TOWN_COLORS.roof);
  }

  // --------------------------------------------------------- false front ---
  // The parapet that makes a one-storey shed read as a shop, and the single
  // most "western" line on the whole street.
  let signY = wallTop - 0.55;
  if (spec.falseFront) {
    const ft = t.falseFrontThickness;
    const rise = t.falseFrontRise * (spec.storeys === 2 ? 1.25 : 1);
    opaque.box(w + 0.1, rise, ft, 0, wallTop + rise / 2, front + ft / 2 - 0.06, spec.wall);
    opaque.box(w + 0.2, 0.2, ft + 0.1, 0, wallTop + rise - 0.1, front + ft / 2 - 0.06, TOWN_COLORS.trim);
    signY = wallTop + rise * 0.42;
  }

  // --------------------------------------------------------------- porch ---
  if (spec.porch) {
    const pd = t.porchDepth;
    const py = wallTop - t.porchDrop;
    opaque.box(w + 0.2, 0.16, pd, 0, py, front - pd / 2, TOWN_COLORS.roofPale);
    const posts = Math.max(2, Math.round(w / t.porchPostSpacing));
    for (const px of spread(w, posts, 0.5)) {
      opaque.post(t.porchPostRadius, t.porchPostRadius * 1.15, py - 0.08 - t.floorStep,
        px, t.floorStep, front - pd + 0.35, TOWN_COLORS.trim, t.segments);
    }
    signY = spec.falseFront ? signY : py + 0.22;
  }

  // ------------------------------------------------------------- windows ---
  const rows = spec.storeys === 2 ? 2 : 1;
  const count = spec.windows ?? 0;
  if (count > 0) {
    // Every building has a door in the middle of its frontage — a real opening
    // on the saloon, a painted panel on the rest — so the window run is laid out
    // as `count + 1` slots and whatever lands on the door is dropped. Doing it
    // the other way (space `count` slots and hope) puts a pane over the door on
    // every building with an odd number of windows.
    const doorHalf = (spec.bigDoor ? Math.min(w * 0.55, 5.2) : t.doorWidth) / 2
      + t.windowWidth / 2 + 0.15;
    const xs = spread(w, count + 1, 1.1).filter((x) => Math.abs(x) > doorHalf).slice(0, count);
    glass.setFrame(cx, baseY, cz, yaw);
    for (let row = 0; row < rows; row++) {
      const sill = baseH + t.windowSill + row * (spec.wallHeight / rows);
      if (sill + t.windowHeight > wallTop - 0.2) continue;
      for (const x of xs) {
        // Frame in the opaque pass, pane in the glass one.
        opaque.box(t.windowWidth + t.windowFrame * 2, t.windowHeight + t.windowFrame * 2, 0.07,
          x, sill + t.windowHeight / 2, front - 0.035, TOWN_COLORS.trim);
        glass.box(t.windowWidth, t.windowHeight, 0.04, x, sill + t.windowHeight / 2, front - 0.07, TOWN_COLORS.glass);
      }
    }
  }

  // ---------------------------------------------------------------- sign ---
  const signW = Math.min(w * 0.78, 6.4);
  opaque.box(signW, t.signHeight, t.signThickness, 0, signY, front - t.signThickness / 2 - 0.03, spec.sign);
  opaque.box(signW + 0.16, 0.09, t.signThickness + 0.04, 0, signY + t.signHeight / 2 + 0.05, front - t.signThickness / 2 - 0.03, TOWN_COLORS.trim);
  opaque.box(signW + 0.16, 0.09, t.signThickness + 0.04, 0, signY - t.signHeight / 2 - 0.05, front - t.signThickness / 2 - 0.03, TOWN_COLORS.trim);

  // -------------------------------------------------------- steeple/steps ---
  if (spec.steeple) {
    const sw = t.steepleWidth;
    const sh = t.steepleHeight;
    const towerZ = front + sw / 2 + 0.3;
    opaque.box(sw, sh, sw, 0, baseH + sh / 2, towerZ, spec.wall);
    opaque.box(sw + 0.3, 0.18, sw + 0.3, 0, baseH + sh, towerZ, TOWN_COLORS.trim);
    opaque.pyramid(sw / 2 + 0.1, t.steepleSpire, 0, baseH + sh + 0.18, towerZ, TOWN_COLORS.roof);
    const crossY = baseH + sh + 0.18 + t.steepleSpire;
    opaque.box(t.crossThickness, t.crossHeight, t.crossThickness, 0, crossY + t.crossHeight / 2, towerZ, TOWN_COLORS.trim);
    opaque.box(t.crossBar, t.crossThickness, t.crossThickness, 0, crossY + t.crossHeight * 0.68, towerZ, TOWN_COLORS.trim);
    // No collider: the tower stands inside the church's own footprint box, so
    // it is already solid. A second collider entirely enclosed by the first is
    // pure per-frame cost for every agent in the game.
  }
  if (spec.side === 'north') {
    // Steps instead of a boardwalk: this one faces down the street, not across it.
    const stepW = w * 0.55;
    opaque.box(stepW, t.floorStep, t.stepDepth * 2, 0, t.floorStep / 2, front - t.stepDepth, TOWN_COLORS.plankDark);
    localFloorPlate(opaque, 0, front - t.stepDepth, stepW, t.stepDepth * 2, baseY + t.floorStep);
  } else {
    // The boardwalk. Slightly wider than the frontage so neighbours nearly meet
    // and the street reads as one continuous walk broken by alleys.
    const bw = w + 1.2;
    const bd = STREET.boardwalkDepth;
    opaque.box(bw, t.floorStep, bd, 0, t.floorStep / 2, front - bd / 2, TOWN_COLORS.boardwalk);
    localFloorPlate(opaque, 0, front - bd / 2, bw, bd, baseY + t.floorStep);
  }

  // ------------------------------------------------------------- chimney ---
  if (spec.stoneBase || spec.storeys === 2) {
    // Tall enough to clear the roof it comes through, which for a gable means
    // clearing the ridge rather than the eave.
    const ch = gableRise + 1.3;
    opaque.box(0.72, ch, 0.72, w * 0.3, wallTop - 0.4 + ch / 2, d * 0.22, TOWN_COLORS.stone);
  }

  return { spec, cx, cz, yaw, interiorBox, frontZ: front };
}

/**
 * The saloon's furniture. Separate from the shell because it is the one thing
 * in here that only exists for a building you can walk into, and because a
 * room with nothing in it reads as a box rather than as a saloon.
 */
export function buildSaloonInterior(placement, ctx) {
  const s = SALOON;
  const t = TOWN_BUILD;
  const { opaque, glass } = ctx;
  const { cx, cz, yaw, spec } = placement;
  const baseH = t.floorStep;
  const w = spec.w;
  const d = spec.d;
  opaque.setFrame(cx, TOWN.height, cz, yaw);

  // The bar, along the back wall, its serving side toward the door.
  const barZ = d / 2 - t.wallThickness - s.barDepth / 2 - 0.4;
  opaque.box(s.barLength, s.barHeight, s.barDepth, -0.8, baseH + s.barHeight / 2, barZ, TOWN_COLORS.plankDark);
  opaque.box(s.barLength + s.barTopOverhang * 2, 0.09, s.barDepth + s.barTopOverhang * 2,
    -0.8, baseH + s.barHeight + 0.045, barZ, TOWN_COLORS.plankPale);
  // Back shelf, with bottles on it.
  opaque.box(s.barLength * 0.85, 0.08, 0.3, -0.8, baseH + s.bottleShelfHeight, d / 2 - t.wallThickness - 0.2, TOWN_COLORS.plankPale);
  glass.setFrame(cx, TOWN.height, cz, yaw);
  for (let i = 0; i < 7; i++) {
    const bx = -0.8 - s.barLength * 0.36 + (s.barLength * 0.72 * i) / 6;
    glass.post(0.035, 0.045, 0.26, bx, baseH + s.bottleShelfHeight + 0.04, d / 2 - t.wallThickness - 0.2, TOWN_COLORS.glass, 6);
  }
  opaque.setFrame(cx, TOWN.height, cz, yaw);

  // Tables with stools round them, kept clear of the doorway lane.
  for (let i = 0; i < s.tableCount; i++) {
    const tx = -w / 2 + 3.2 + (i * (w - 6.4)) / Math.max(1, s.tableCount - 1);
    const tz = -d / 2 + 4.2 + (i % 2) * 2.6;
    opaque.post(0.11, 0.13, s.tableHeight, tx, baseH, tz, TOWN_COLORS.plankDark, 6);
    opaque.post(s.tableRadius, s.tableRadius, s.tableTopThickness, tx, baseH + s.tableHeight, tz, TOWN_COLORS.plank, 10);
    for (let k = 0; k < s.stoolsPerTable; k++) {
      const a = (k / s.stoolsPerTable) * Math.PI * 2 + i;
      const sx = tx + Math.cos(a) * (s.tableRadius + 0.55);
      const sz = tz + Math.sin(a) * (s.tableRadius + 0.55);
      opaque.post(s.stoolRadius, s.stoolRadius * 0.8, s.stoolHeight, sx, baseH, sz, TOWN_COLORS.plankDark, 7);
    }
  }
}
