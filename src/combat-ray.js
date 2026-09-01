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
export function raycastColliders(origin, dir, maxDist, ignore, out) {
  let found = false;
  for (const col of colliders) {
    if (ignore && ignore.has(col)) continue;
    if (col.type !== 'circle') continue; // boxes arrive with round 5's buildings
    if (raycastCylinder(origin, dir, maxDist, col.x, col.z, -Infinity, col.top, col.r, out)) {
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
