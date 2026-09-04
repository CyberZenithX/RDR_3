/**
 * combat-ray.js — what a bullet hits. Split out of combat.js under
 * BUILD-PLAN.md's 400-line cap; combat.js owns the gun's state machine, this
 * file owns the geometry query.
 *
 * NO MESH RAYCASTS. The terrain is a 131k-triangle mesh with no spatial
 * index — stock THREE.Raycaster is a linear scan — and props are instanced.
 * Camera occlusion already solved the same problem the same way (ADR-002),
 * and this reuses that shape: colliders are tested analytically as vertical
 * cylinders, and the terrain is marched against the analytic `heightAt`
 * rather than against the mesh built from it.
 *
 * That falls out of the collision contract rather than fighting it: every
 * collider already carries the world Y of its own top (ADR-012), which is
 * exactly the height a shot has to pass over to miss. So rocks, cacti, trees
 * and round 3's barrels are all shootable without registering anything new.
 *
 * The one thing that needs its own test is a target standing ON something —
 * a bottle on a barrel lid is not grounded, so its collider's implicit
 * "extends down forever" is wrong for it. `raycastCylinder` takes an explicit
 * base for that; targets.js passes one.
 */

import * as THREE from 'three';
import { COMBAT } from './config-combat.js';
import { colliders } from './collision.js';
import { heightAt, normalAt } from './terrain.js';

const _n = new THREE.Vector3();

/** A reusable hit record. Callers own one and pass it in — nothing here allocates. */
export function makeHit() {
  return {
    hit: false,
    distance: Infinity,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    collider: null,
    kind: null, // 'terrain' | collider meta.kind | whatever targets.js sets
    ref: null, // caller-defined back-reference (a target instance, say)
  };
}

export function resetHit(out) {
  out.hit = false;
  out.distance = Infinity;
  out.collider = null;
  out.kind = null;
  out.ref = null;
  return out;
}

/**
 * Ray against an upright cylinder: circle `r` about (cx, cz), spanning world
 * Y from `base` to `top`. Writes into `out` and returns true ONLY if the hit
 * is nearer than whatever `out` already holds, so callers can test many
 * things against one record and keep the closest.
 *
 * Both end caps are tested, not just the wall — shooting down onto a barrel
 * lid from horseback is a normal thing to do, and a wall-only test lets that
 * shot pass straight through.
 */
export function raycastCylinder(origin, dir, maxDist, cx, cz, base, top, r, out) {
  const ox = origin.x - cx;
  const oz = origin.z - cz;
  const a = dir.x * dir.x + dir.z * dir.z;
  const c = ox * ox + oz * oz - r * r;

  let best = Infinity;
  let capNormalY = 0;

  if (a > 1e-9) {
    const b = ox * dir.x + oz * dir.z;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / a, (-b + sq) / a]) {
        if (t < 0 || t > maxDist || t >= best) continue;
        const y = origin.y + dir.y * t;
        if (y >= base && y <= top) { best = t; capNormalY = 0; }
      }
    }
  }

  // End caps: the plane at `top` (or `base`), clipped to the circle.
  if (Math.abs(dir.y) > 1e-9) {
    for (const [planeY, ny] of [[top, 1], [base, -1]]) {
      if (!Number.isFinite(planeY)) continue;
      const t = (planeY - origin.y) / dir.y;
      if (t < 0 || t > maxDist || t >= best) continue;
      const hx = origin.x + dir.x * t - cx;
      const hz = origin.z + dir.z * t - cz;
      if (hx * hx + hz * hz <= r * r) { best = t; capNormalY = ny; }
    }
  }

  if (best === Infinity || best >= out.distance) return false;

  out.hit = true;
  out.distance = best;
  out.point.set(origin.x + dir.x * best, origin.y + dir.y * best, origin.z + dir.z * best);
  if (capNormalY !== 0) {
    out.normal.set(0, capNormalY, 0);
  } else {
    _n.set(out.point.x - cx, 0, out.point.z - cz);
    out.normal.copy(_n.lengthSq() > 1e-9 ? _n.normalize() : _n.set(0, 1, 0));
  }
  return true;
}

/**
 * Every registered collider, as an upright cylinder running from the ground
 * up to its own `top`. `ignore` is a Set — combat.js always puts the horse's
 * collider in it, because while mounted the muzzle sits inside that circle
 * and every shot would otherwise hit the animal being ridden.
 *
 * Colliders with `top: Infinity` are unlimited-height by contract, which is
 * the right reading here too: you cannot shoot over a building.
 */
/**
 * Ray against a sphere, written into `out` only if it beats what `out` already
 * holds — the same contract as `raycastCylinder`.
 *
 * This exists because a collider circle is not a silhouette. A rock's collider
 * is an upright cylinder at its widest radius, which is right for walking into
 * and wrong for shooting past: a round crossing that cylinder a metre above the
 * rock's shoulder would "hit" it and spark in mid-air. A sphere is a far better
 * fit for a lumpy ball, and costs the same quadratic.
 */
export function raycastSphere(origin, dir, maxDist, cx, cy, cz, r, out) {
  const ox = origin.x - cx;
  const oy = origin.y - cy;
  const oz = origin.z - cz;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  // Pointing away from a sphere it is already outside of.
  if (c > 0 && b > 0) return false;
  const disc = b * b - c;
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq; // origin inside the sphere
  if (t < 0 || t > maxDist || t >= out.distance) return false;
  out.distance = t;
  out.point.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
  out.normal.set(out.point.x - cx, out.point.y - cy, out.point.z - cz).normalize();
  return true;
}

/**
 * Ray against an upright, Y-rotated box: `w` × `d` in plan, running from the
 * ground up to `top`. Same "only if it beats what `out` holds" contract as
 * `raycastCylinder`.
 *
 * ROUND 5'S WALLS. Until now `raycastColliders` skipped boxes outright, which
 * was harmless while nothing in the world had an inside: a building's collider
 * was the only box in the game and a shot at one was resolved by the terrain
 * behind it. The saloon changed that — docs/ROADMAP.md flagged it before the
 * round started: "A shot fired inside the saloon will go straight through the
 * walls until that is written." This is that. ADR-032.
 *
 * A slab test rather than four quad tests: transform the ray into the box's own
 * frame and intersect three pairs of parallel planes, keeping the latest entry
 * and earliest exit. The Y slab runs from -Infinity to `top`, which is the same
 * reading `raycastCylinder` gives a grounded collider — you cannot shoot under a
 * wall, and `top: Infinity` (which every building keeps, per the collision
 * contract) means you cannot shoot over one either.
 *
 * `rot` is the box's own rotation about +Y, the same sense `Object3D.rotation.y`
 * and `collision.js`'s `resolveBox` use.
 */
export function raycastBox(origin, dir, maxDist, cx, cz, w, d, rot, top, out) {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const dx = origin.x - cx;
  const dz = origin.z - cz;
  // World → box space, for both the origin and the direction.
  const ox = dx * cos - dz * sin;
  const oz = dx * sin + dz * cos;
  const rx = dir.x * cos - dir.z * sin;
  const rz = dir.x * sin + dir.z * cos;

  let tEnter = -Infinity;
  let tExit = Infinity;
  // 0 = box X face, 1 = box Z face, 2 = the top cap.
  let enterAxis = 0, enterSign = 1, exitAxis = 0, exitSign = 1;

  // The two horizontal slabs.
  const slabs = [[ox, rx, w / 2, 0], [oz, rz, d / 2, 1]];
  for (const [o, r, half, id] of slabs) {
    if (Math.abs(r) < 1e-9) {
      if (Math.abs(o) > half) return false; // parallel and outside
      continue;
    }
    const inv = 1 / r;
    let t0 = (-half - o) * inv;
    let t1 = (half - o) * inv;
    let s0 = -1; // which face of this slab t0 is on, in box space
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; s0 = 1; }
    if (t0 > tEnter) { tEnter = t0; enterAxis = id; enterSign = s0; }
    if (t1 < tExit) { tExit = t1; exitAxis = id; exitSign = -s0; }
    if (tEnter > tExit) return false;
  }

  // The top cap. There is no bottom: a grounded box extends down forever, which
  // is the same reading raycastCylinder gives a collider with no explicit base.
  if (Number.isFinite(top)) {
    if (Math.abs(dir.y) < 1e-9) {
      if (origin.y > top) return false;
    } else {
      const t = (top - origin.y) / dir.y;
      if (dir.y < 0) {
        // Coming down onto the cap: it is the entry plane.
        if (t > tEnter) { tEnter = t; enterAxis = 2; enterSign = 1; }
      } else if (t < tExit) {
        // Climbing: the cap is where the ray leaves.
        tExit = t; exitAxis = 2; exitSign = 1;
      }
      if (tEnter > tExit) return false;
    }
  }

  if (tExit < 0) return false; // the whole box is behind the muzzle
  // A muzzle already INSIDE the box (a shooter pressed against a wall with the
  // barrel poking into it) has no entry face to strike, so the round punches out
  // of the far one — at most a wall's thickness away. Reporting the entry at
  // t=0 instead would put the spark and the decal inside the shooter's own hand,
  // and returning nothing would be the wall not stopping the shot at all, which
  // is the bug this function exists to fix.
  const inside = tEnter < 0;
  const t = inside ? tExit : tEnter;
  const axis = inside ? exitAxis : enterAxis;
  const sign = inside ? exitSign : enterSign;
  if (t > maxDist || t >= out.distance) return false;

  out.hit = true;
  out.distance = t;
  out.point.set(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
  if (axis === 2) {
    out.normal.set(0, 1, 0);
  } else {
    // The face normal in box space, rotated back out to the world.
    const nx = axis === 0 ? sign : 0;
    const nz = axis === 1 ? sign : 0;
    out.normal.set(nx * cos + nz * sin, 0, -nx * sin + nz * cos);
  }
  return true;
}

export function raycastColliders(origin, dir, maxDist, ignore, out) {
  let found = false;
  for (const col of colliders) {
    if (ignore && ignore.has(col)) continue;
    if (col.type === 'box') {
      // Broad phase, as below: the box's own half-diagonal covers any rotation.
      const bxx = col.x - origin.x;
      const bzz = col.z - origin.z;
      const boxReach = maxDist + Math.hypot(col.w, col.d) * 0.5;
      if (bxx * bxx + bzz * bzz > boxReach * boxReach) continue;
      if (raycastBox(origin, dir, maxDist, col.x, col.z, col.w, col.d, col.rot, col.top, out)) {
        out.collider = col;
        out.kind = col.meta?.kind ?? 'prop';
        out.ref = col.meta?.target ?? null;
        found = true;
      }
      continue;
    }
    if (col.type !== 'circle') continue;
    // Broad phase: nothing further away than the ray is long can be crossed by
    // it. Five flops, and it is what makes round 4's SHORT rays cheap — every
    // bandit casts three 3.4m avoidance rays and a line-of-sight ray every
    // frame against a list of ~600 colliders, and this rejects almost all of
    // them before the quadratic. A 220m shot is unaffected, as it should be.
    const bx = col.x - origin.x;
    const bz = col.z - origin.z;
    const reach = maxDist + col.r;
    if (bx * bx + bz * bz > reach * reach) continue;
    // A rock carries a sphere that follows what you can actually see; a pillar
    // (cactus, tree, building) is a cylinder all the way up. See props.js.
    const sphere = col.meta?.hitSphere;
    const hit = sphere
      ? raycastSphere(origin, dir, maxDist, col.x, sphere.cy, col.z, sphere.r, out)
      : raycastCylinder(origin, dir, maxDist, col.x, col.z, -Infinity, col.top, col.r, out);
    if (hit) {
      out.collider = col;
      out.kind = col.meta?.kind ?? 'prop';
      out.ref = col.meta?.target ?? null;
      found = true;
    }
  }
  return found;
}

/**
 * The ground, by marching the analytic height function. The step GROWS with
 * distance: a shot 3m away wants centimetre precision, one 200m away does
 * not, and a fixed fine step would cost ~370 fbm evaluations per trigger
 * pull. Once a step lands under the surface the crossing is bisected back to
 * precision, so the growth costs nothing in accuracy.
 */
export function raycastTerrain(origin, dir, maxDist, out) {
  let t = 0;
  let step = COMBAT.terrainMarchStep;
  let prevT = 0;
  let prevAbove = origin.y - heightAt(origin.x, origin.z) > 0;
  // A muzzle that starts underground (spawned inside a hill) has nothing
  // meaningful to march toward — bail rather than reporting a hit at t=0.
  if (!prevAbove) return false;

  while (t < maxDist) {
    t = Math.min(t + step, maxDist);
    step *= COMBAT.terrainMarchGrowth;
    const y = origin.y + dir.y * t;
    const ground = heightAt(origin.x + dir.x * t, origin.z + dir.z * t);
    if (y <= ground) {
      // Bisect the bracket [prevT, t], which is known to straddle the surface.
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < COMBAT.terrainRefineSteps; i++) {
        const mid = (lo + hi) * 0.5;
        const my = origin.y + dir.y * mid;
        if (my <= heightAt(origin.x + dir.x * mid, origin.z + dir.z * mid)) hi = mid;
        else lo = mid;
      }
      if (hi >= out.distance) return false;
      out.hit = true;
      out.distance = hi;
      out.point.set(origin.x + dir.x * hi, origin.y + dir.y * hi, origin.z + dir.z * hi);
      out.normal.copy(normalAt(out.point.x, out.point.z));
      out.collider = null;
      out.kind = 'terrain';
      out.ref = null;
      return true;
    }
    prevT = t;
  }
  return false;
}
