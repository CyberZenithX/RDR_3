/**
 * strap.js — the shared builder for leather: reins, bridle cheekpieces, girth,
 * stirrup leathers. Anything that is a thin strip following a line through the
 * world and has to be rebuilt every frame.
 *
 * Extracted from reins.js when the saddle needed the same thing, and named in
 * CLAUDE.md as the pattern to copy for any future strap-like geometry — a rifle
 * sling, a holster belt, a hitching rope.
 *
 * WHY REBUILD RATHER THAN PARENT. These straps span two skeletons (a rein runs
 * from the horse's mouth to the rider's fist) and both rigs carry large baked
 * armature scales that a parented mesh would inherit and have to undo. Writing
 * world-space vertices into one shared buffer sidesteps both problems, and one
 * buffer for every strap on a horse is also one draw call rather than six.
 */

import * as THREE from 'three';

const _tangent = new THREE.Vector3();
const _ringSide = new THREE.Vector3();
const _ringUp = new THREE.Vector3();
const _point = new THREE.Vector3();
const _control = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

/** Rings along each strand, and how many sides each ring has. */
export const SEGMENTS = 12;
const SIDES = 4;
const RING_COUNT = SEGMENTS + 1;
const VERTS_PER_STRAND = RING_COUNT * SIDES;

/**
 * A fixed set of straps sharing one geometry and one material.
 *
 * Strand slots are allocated by name up front, because the index buffer is
 * built once and never rewritten — only vertex positions change per frame.
 */
export class StrapMesh {
  /**
   * @param {THREE.Scene} scene
   * @param {string[]} names one slot per strap, order fixed for the life of the mesh
   * @param {{color:number, roughness?:number, metalness?:number, name?:string}} look
   */
  constructor(scene, names, look) {
    this.names = names;
    this.slot = new Map(names.map((n, i) => [n, i]));

    const positions = new Float32Array(names.length * VERTS_PER_STRAND * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
    this.geometry.setIndex(buildIndices(names.length));
    // Everything here moves every frame and is never far from the camera while
    // it matters, so culling against a stale bounding volume would make straps
    // blink out rather than save anything.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    this.mesh = new THREE.Mesh(this.geometry, new THREE.MeshStandardMaterial({
      color: look.color,
      roughness: look.roughness ?? 0.75,
      metalness: look.metalness ?? 0.05,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; // strips this thin only add shadow-map noise
    this.mesh.receiveShadow = true;
    this.mesh.name = look.name ?? 'straps';
    scene.add(this.mesh);

    this._pos = this.geometry.getAttribute('position');
    this._nrm = this.geometry.getAttribute('normal');
    this.curve = [];
    for (let i = 0; i < RING_COUNT; i++) this.curve.push(new THREE.Vector3());
  }

  /**
   * Fills `curve` with a quadratic Bezier from `from` to `to`, sagging under
   * its own weight. Straight straps read like wire; a little droop reads like
   * leather, and it grows with the span so slack hangs more than taut.
   *
   * @param {number|null} clearY if given, the curve's midpoint is lifted to
   *   clear this height — how a rein is kept lying over a horse's neck rather
   *   than cutting through the crest when the head drops.
   */
  sag(from, to, sag, clearY = null) {
    const drop = from.distanceTo(to) * sag;
    _control.copy(from).add(to).multiplyScalar(0.5);
    _control.y -= drop;
    if (clearY !== null) {
      // The curve at t=0.5 is (from + 2C + to)/4, hence the factor of two.
      const needed = 2 * clearY - 0.5 * (from.y + to.y);
      if (needed > _control.y) _control.y = needed;
    }
    for (let i = 0; i < RING_COUNT; i++) {
      const t = i / SEGMENTS;
      const inv = 1 - t;
      this.curve[i]
        .copy(from).multiplyScalar(inv * inv)
        .addScaledVector(_control, 2 * inv * t)
        .addScaledVector(to, t * t);
    }
    return this;
  }

  /** Extrudes a square tube of `radius` along whatever is currently in `curve`. */
  write(name, radius) {
    const strand = this.slot.get(name);
    if (strand === undefined) return;
    const base = strand * VERTS_PER_STRAND;
    for (let i = 0; i < RING_COUNT; i++) {
      const here = this.curve[i];
      const next = this.curve[Math.min(i + 1, SEGMENTS)];
      const prev = this.curve[Math.max(i - 1, 0)];
      _tangent.copy(next).sub(prev);
      if (_tangent.lengthSq() < 1e-10) _tangent.set(0, 0, 1);
      _tangent.normalize();

      _ringSide.crossVectors(_tangent, _worldUp);
      // A vertical strand has no unique side vector; any perpendicular will do.
      if (_ringSide.lengthSq() < 1e-8) _ringSide.set(1, 0, 0);
      _ringSide.normalize();
      _ringUp.crossVectors(_ringSide, _tangent).normalize();

      for (let s = 0; s < SIDES; s++) {
        const a = (s / SIDES) * Math.PI * 2;
        _point.copy(_ringSide).multiplyScalar(Math.cos(a)).addScaledVector(_ringUp, Math.sin(a));
        const v = base + i * SIDES + s;
        this._nrm.setXYZ(v, _point.x, _point.y, _point.z);
        this._pos.setXYZ(v,
          here.x + _point.x * radius,
          here.y + _point.y * radius,
          here.z + _point.z * radius);
      }
    }
  }

  /** Call once after all strands for this frame have been written. */
  flush() {
    this._pos.needsUpdate = true;
    this._nrm.needsUpdate = true;
  }
}

/** Index buffer for `count` square tubes; built once, never rewritten. */
function buildIndices(count) {
  const perStrand = SEGMENTS * SIDES * 6;
  const indices = new Uint16Array(count * perStrand);
  let n = 0;
  for (let strand = 0; strand < count; strand++) {
    const base = strand * VERTS_PER_STRAND;
    for (let i = 0; i < SEGMENTS; i++) {
      for (let s = 0; s < SIDES; s++) {
        const next = (s + 1) % SIDES;
        const a = base + i * SIDES + s;
        const b = base + i * SIDES + next;
        const c = base + (i + 1) * SIDES + next;
        const d = base + (i + 1) * SIDES + s;
        indices[n++] = a; indices[n++] = b; indices[n++] = c;
        indices[n++] = a; indices[n++] = c; indices[n++] = d;
      }
    }
  }
  return new THREE.BufferAttribute(indices, 1);
}
