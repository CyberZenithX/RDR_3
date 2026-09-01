/**
 * targets.js — the shootable barrels and the bottles standing on them.
 *
 * Follows props.js's pattern (an InstancedMesh per kind, a circle collider per
 * placement carrying a real `top` and a `meta.kind`), with the one thing props
 * do not have: PER-INSTANCE DESTRUCTIBLE STATE. A rock is the same rock
 * forever; a bottle exists until it is shot.
 *
 * Destruction is a zero-scale instance matrix rather than a rebuilt buffer —
 * InstancedMesh has no per-instance visibility, and rewriting the whole matrix
 * array to remove one bottle would be the expensive way to do the cheap thing.
 * The collider is unregistered at the same moment, so a dead target stops
 * blocking movement and stops catching bullets in one step.
 *
 * The colliders barrels register carry a real `top` (ADR-012), so the horse
 * can jump a barrel exactly the way it jumps a rock — that fell out of the
 * contract for free and is worth not breaking. Bottles ride on barrel lids, so
 * they are NOT grounded: their `base` is the lid, and they are ray-tested with
 * an explicit base rather than through the collider list, whose cylinders all
 * implicitly run down to the ground. See combat-ray.js.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TARGETS, COMBAT } from './config-combat.js';
import { addCircleCollider, removeCollider } from './collision.js';
import { raycastCylinder } from './combat-ray.js';
import { heightAt } from './terrain.js';

const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _dummy = new THREE.Object3D();

/** A barrel: staves bulging at the middle, two iron hoops. Base at local y = 0. */
function makeBarrelGeometry() {
  const t = TARGETS;
  const r = t.barrelRadius;
  const body = new THREE.CylinderGeometry(r * 0.92, r * 0.92, t.barrelHeight, t.barrelSegments, 3);
  // Push the middle ring out so it reads as staves, not a bin.
  const pos = body.attributes.position;
  const half = t.barrelHeight / 2;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const bulge = 1 + (t.barrelBulge - 1) * (1 - (y / half) * (y / half));
    pos.setX(i, pos.getX(i) * bulge);
    pos.setZ(i, pos.getZ(i) * bulge);
  }
  body.computeVertexNormals();
  body.translate(0, half, 0);
  return body;
}

function makeHoopGeometry() {
  const t = TARGETS;
  const r = t.barrelRadius;
  const parts = [];
  for (const frac of [0.22, 0.78]) {
    const hoop = new THREE.TorusGeometry(r * 1.05, r * 0.045, 5, t.barrelSegments);
    hoop.rotateX(Math.PI / 2);
    hoop.translate(0, t.barrelHeight * frac, 0);
    parts.push(hoop);
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** A whiskey bottle: shoulder, neck, lip. Base at local y = 0. */
function makeBottleGeometry() {
  const t = TARGETS;
  const seg = t.bottleSegments;
  const bodyH = t.bottleHeight * 0.55;
  const shoulderH = t.bottleHeight * 0.16;
  const neckH = t.bottleHeight * 0.29;
  const parts = [];

  const body = new THREE.CylinderGeometry(t.bottleRadius, t.bottleRadius * 0.94, bodyH, seg);
  body.translate(0, bodyH / 2, 0);
  parts.push(body);

  const shoulder = new THREE.CylinderGeometry(t.bottleNeckRadius, t.bottleRadius, shoulderH, seg);
  shoulder.translate(0, bodyH + shoulderH / 2, 0);
  parts.push(shoulder);

  const neck = new THREE.CylinderGeometry(t.bottleNeckRadius * 1.15, t.bottleNeckRadius, neckH, seg);
  neck.translate(0, bodyH + shoulderH + neckH / 2, 0);
  parts.push(neck);

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

export class Targets {
  constructor(scene) {
    this.scene = scene;
    /** @type {{kind:string, x:number, z:number, base:number, top:number, r:number, hits:number, maxHits:number, alive:boolean, mesh:THREE.InstancedMesh, index:number, collider:object|null}[]} */
    this.items = [];
    this._build(scene);
  }

  _build(scene) {
    const t = TARGETS;
    const barrelGeo = makeBarrelGeometry();
    const hoopGeo = makeHoopGeometry();
    const bottleGeo = makeBottleGeometry();

    const barrelMat = new THREE.MeshStandardMaterial({ color: t.barrelColor, roughness: 0.88 });
    const hoopMat = new THREE.MeshStandardMaterial({ color: t.barrelHoopColor, roughness: 0.55, metalness: 0.55 });
    // Glass: translucent, but still a shadow caster so a row of bottles on a
    // lid reads as objects rather than as decals painted on the barrel.
    const bottleMat = new THREE.MeshStandardMaterial({
      color: t.bottleColor, roughness: 0.18, metalness: 0.05,
      transparent: true, opacity: t.bottleOpacity,
    });

    const barrelCount = t.barrels.length;
    const bottleCount = t.barrels.reduce((n, b) => n + (b.bottles ?? 0), 0);

    this.barrelMesh = new THREE.InstancedMesh(barrelGeo, barrelMat, barrelCount);
    this.hoopMesh = new THREE.InstancedMesh(hoopGeo, hoopMat, barrelCount);
    this.bottleMesh = new THREE.InstancedMesh(bottleGeo, bottleMat, Math.max(1, bottleCount));
    for (const m of [this.barrelMesh, this.hoopMesh, this.bottleMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }

    let bottleIndex = 0;
    t.barrels.forEach((spec, i) => {
      const groundY = heightAt(spec.x, spec.z);
      const rotY = (i * 2.399) % (Math.PI * 2); // golden-angle spin so the staves don't line up
      _dummy.position.set(spec.x, groundY, spec.z);
      _dummy.rotation.set(0, rotY, 0);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      this.barrelMesh.setMatrixAt(i, _dummy.matrix);
      this.hoopMesh.setMatrixAt(i, _dummy.matrix);

      const lidY = groundY + t.barrelHeight;
      const colliderR = t.barrelRadius * t.barrelColliderFactor;
      const item = {
        kind: 'barrel', x: spec.x, z: spec.z, base: groundY, top: lidY,
        r: t.barrelRadius * t.barrelBulge, hits: 0, maxHits: COMBAT.barrelHits,
        alive: true, mesh: this.barrelMesh, extraMesh: this.hoopMesh, index: i, collider: null,
      };
      // A real `top`, so the horse can jump a barrel the way it jumps a rock.
      // `meta.target` is the back-reference combat-ray.js hands back on a hit.
      item.collider = addCircleCollider(spec.x, spec.z, colliderR, { kind: 'barrel', target: item }, lidY);
      this.items.push(item);

      const n = spec.bottles ?? 0;
      for (let b = 0; b < n; b++) {
        // Spread across the lid, perpendicular to the barrel's own facing.
        const offset = (b - (n - 1) / 2) * t.bottleSpacing;
        const bx = spec.x + Math.cos(rotY) * offset;
        const bz = spec.z + Math.sin(rotY) * offset;
        _dummy.position.set(bx, lidY, bz);
        _dummy.rotation.set(0, rotY * 1.7, 0);
        _dummy.scale.setScalar(1);
        _dummy.updateMatrix();
        this.bottleMesh.setMatrixAt(bottleIndex, _dummy.matrix);
        this.items.push({
          kind: 'bottle', x: bx, z: bz, base: lidY, top: lidY + t.bottleHeight,
          r: t.bottleRadius, hits: 0, maxHits: COMBAT.bottleHits,
          alive: true, mesh: this.bottleMesh, extraMesh: null, index: bottleIndex, collider: null,
        });
        bottleIndex++;
      }
    });

    // Nothing was placed into the spare slot the max(1, …) above reserves.
    for (let i = bottleIndex; i < this.bottleMesh.count; i++) this.bottleMesh.setMatrixAt(i, _zero);
    this.barrelMesh.instanceMatrix.needsUpdate = true;
    this.hoopMesh.instanceMatrix.needsUpdate = true;
    this.bottleMesh.instanceMatrix.needsUpdate = true;

    this.counts = { barrels: barrelCount, bottles: bottleCount };
  }

  /**
   * Nearest live target along the ray, written into `out` only if it beats
   * whatever `out` already holds — same contract as combat-ray.js's helpers,
   * so a caller can test targets, colliders and terrain against one record.
   *
   * Barrels are ALSO in the collider list and would be found by
   * raycastColliders, but this pass runs first and is exact: it uses the
   * bulged visual radius rather than the padded movement radius, and it is
   * what attaches the `ref` that makes a hit destructible.
   */
  raycast(origin, dir, maxDist, out) {
    let found = false;
    for (const item of this.items) {
      if (!item.alive) continue;
      if (raycastCylinder(origin, dir, maxDist, item.x, item.z, item.base, item.top, item.r, out)) {
        out.kind = item.kind;
        out.ref = item;
        out.collider = item.collider;
        found = true;
      }
    }
    return found;
  }

  /**
   * Registers a hit. Returns 'destroyed' | 'hit' | null so combat.js can pick
   * the right effect without knowing how much punishment a barrel takes.
   */
  hit(item) {
    if (!item || !item.alive) return null;
    item.hits++;
    if (item.hits < item.maxHits) return 'hit';
    this._destroy(item);
    return 'destroyed';
  }

  _destroy(item) {
    item.alive = false;
    // Zero-scale rather than a rebuilt buffer — see the file header.
    item.mesh.setMatrixAt(item.index, _zero);
    item.mesh.instanceMatrix.needsUpdate = true;
    if (item.extraMesh) {
      item.extraMesh.setMatrixAt(item.index, _zero);
      item.extraMesh.instanceMatrix.needsUpdate = true;
    }
    if (item.collider) {
      removeCollider(item.collider);
      item.collider = null;
    }
    // A destroyed barrel takes its bottles with it: they were standing on a
    // lid that no longer exists, and leaving them floating in mid-air is the
    // most obviously wrong thing this system could do.
    if (item.kind === 'barrel') {
      for (const other of this.items) {
        if (other.alive && other.kind === 'bottle' && Math.abs(other.base - item.top) < 1e-3
          && Math.hypot(other.x - item.x, other.z - item.z) < TARGETS.barrelRadius * 1.2) {
          this._destroy(other);
        }
      }
    }
  }

  get aliveCount() {
    let n = 0;
    for (const item of this.items) if (item.alive) n++;
    return n;
  }
}

/** Builds the test range. Returns the Targets instance; main.js keeps it for combat.js. */
export function buildTargets(scene) {
  return new Targets(scene);
}
