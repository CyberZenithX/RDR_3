/**
 * reins.js — the tack that connects the rider's fists to the horse's mouth: a
 * simple bridle (noseband and cheekpieces) plus two rein straps.
 *
 * Round 2b posed the rider's hands correctly but left them holding air —
 * `horse.glb` carries no bridle and no reins, so there was nothing between the
 * fists and the animal. This closes that.
 *
 * Everything is rebuilt from live bone positions every frame rather than being
 * parented into either skeleton. That is deliberate: both rigs carry large
 * baked scales inside the armature (the horse's is literally 100), so a mesh
 * parented to a bone inherits that scale and needs undoing; and the reins have
 * to span *two* skeletons anyway, which no single parent can express. Writing
 * world-space vertices into one shared buffer sidesteps both problems.
 *
 * The horse's head frame comes from its own bones — up toward the ears, side
 * across them, forward from their cross product — so the bit stays on the
 * muzzle through every head movement in every clip, rather than tracking a
 * yaw-derived guess that would slide off whenever the horse lowers its head.
 */

import * as THREE from 'three';
import { TACK } from './config-horse.js';

const _head = new THREE.Vector3();
const _earL = new THREE.Vector3();
const _earR = new THREE.Vector3();
const _up = new THREE.Vector3();
const _side = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _ringSide = new THREE.Vector3();
const _ringUp = new THREE.Vector3();
const _point = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

/** Rings along each strand, and how many sides each ring has. */
const SEGMENTS = 12;
const SIDES = 4;
const RING_COUNT = SEGMENTS + 1;
const VERTS_PER_STRAND = RING_COUNT * SIDES;

/** One entry per strap this builds; order is fixed so `_writeStrand` can index it. */
const STRANDS = ['reinL', 'reinR', 'noseband', 'cheekL', 'cheekR', 'browband'];

export class Reins {
  /**
   * @param {THREE.Scene} scene
   * @param {{root: THREE.Object3D}} horseCharacter
   * @param {{root: THREE.Object3D}} playerCharacter
   */
  constructor(scene, horseCharacter, playerCharacter) {
    this.horseRoot = horseCharacter.root;
    this.playerRoot = playerCharacter.root;

    this.headBone = this.horseRoot.getObjectByName('Head') ?? null;
    this.earL = this.horseRoot.getObjectByName('Ear1L') ?? null;
    this.earR = this.horseRoot.getObjectByName('Ear1R') ?? null;
    // Where the reins rest when nobody is riding: draped forward over the neck.
    this.neckBone = this.horseRoot.getObjectByName('Neck2')
      ?? this.horseRoot.getObjectByName('Neck1') ?? null;

    // The rein runs through the closed fist, so it wants the hand itself rather
    // than the wrist joint — the middle finger's second knuckle sits where a
    // held rein actually passes. Falls back through the wrist to nothing.
    this.handL = this._find(this.playerRoot, ['Middle2L', 'WristL']);
    this.handR = this._find(this.playerRoot, ['Middle2R', 'WristR']);

    this.available = !!(this.headBone && this.earL && this.earR);
    if (!this.available) {
      // The procedural placeholder horse has no skeleton at all; riding still
      // works, it just has no tack.
      console.warn('[reins] horse rig has no Head/Ear bones — riding without a bridle');
      this.group = null;
      return;
    }

    const positions = new Float32Array(STRANDS.length * VERTS_PER_STRAND * 3);
    const normals = new Float32Array(positions.length);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geometry.setIndex(buildIndices(STRANDS.length));
    // The straps move every frame and are never off-camera while riding, so
    // culling them against a stale bounding volume would make them blink out.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    this.mesh = new THREE.Mesh(this.geometry, new THREE.MeshStandardMaterial({
      color: TACK.color,
      roughness: 0.75,
      metalness: 0.05,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; // straps this thin only add shadow-map noise
    this.mesh.receiveShadow = true;
    this.mesh.name = 'tack';
    scene.add(this.mesh);

    this._pos = this.geometry.getAttribute('position');
    this._nrm = this.geometry.getAttribute('normal');
    this._curve = [];
    for (let i = 0; i < RING_COUNT; i++) this._curve.push(new THREE.Vector3());
  }

  _find(root, names) {
    for (const name of names) {
      const found = root.getObjectByName(name);
      if (found) return found;
    }
    return null;
  }

  /** Rebuilds the head's own frame from its bones: up toward the ears, side across them. */
  _readHeadFrame() {
    this.headBone.getWorldPosition(_head);
    this.earL.getWorldPosition(_earL);
    this.earR.getWorldPosition(_earR);
    _up.copy(_earL).add(_earR).multiplyScalar(0.5).sub(_head);
    if (_up.lengthSq() < 1e-8) return false;
    _up.normalize();
    _side.copy(_earL).sub(_earR);
    if (_side.lengthSq() < 1e-8) return false;
    _side.normalize();
    _forward.crossVectors(_side, _up).normalize();
    return true;
  }

  /** A point on the head, in the head's own frame. */
  _headPoint(out, forward, up, side) {
    return out.copy(_head)
      .addScaledVector(_forward, forward)
      .addScaledVector(_up, up)
      .addScaledVector(_side, side);
  }

  /**
   * Fills `_curve` with a quadratic Bezier from `from` to `to`, sagging under
   * its own weight. Straight reins read like wire; a little droop reads like
   * leather, and it grows with the span so slack reins hang more than taut ones.
   */
  _buildSag(from, to, sag, clearY = null) {
    const drop = from.distanceTo(to) * sag;
    _c.copy(from).add(to).multiplyScalar(0.5);
    _c.y -= drop;
    // A rein from the bit to the rider's hands passes straight over the horse's
    // neck, and when the head drops — which it does hard at a gallop — the
    // straight line cuts through the crest. Lifting the control point so the
    // curve's own midpoint clears that height makes the rein lie over the neck
    // instead of through it. The curve at t=0.5 is (from + 2C + to)/4, hence
    // the factor of two.
    if (clearY !== null) {
      const needed = 2 * clearY - 0.5 * (from.y + to.y);
      if (needed > _c.y) _c.y = needed;
    }
    for (let i = 0; i < RING_COUNT; i++) {
      const t = i / SEGMENTS;
      const inv = 1 - t;
      this._curve[i]
        .copy(from).multiplyScalar(inv * inv)
        .addScaledVector(_c, 2 * inv * t)
        .addScaledVector(to, t * t);
    }
  }

  /** Fills `_curve` with a ring around the muzzle at a given distance along the head. */
  _buildNoseband(forward, up, radiusSide, radiusUp) {
    for (let i = 0; i < RING_COUNT; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      this._headPoint(this._curve[i], forward, up + Math.cos(a) * radiusUp, Math.sin(a) * radiusSide);
    }
  }

  /** Extrudes a square tube along whatever is currently in `_curve`. */
  _writeStrand(name, radius) {
    const strand = STRANDS.indexOf(name);
    const base = strand * VERTS_PER_STRAND;
    for (let i = 0; i < RING_COUNT; i++) {
      const here = this._curve[i];
      const next = this._curve[Math.min(i + 1, SEGMENTS)];
      const prev = this._curve[Math.max(i - 1, 0)];
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
        const cos = Math.cos(a), sin = Math.sin(a);
        _point.copy(_ringSide).multiplyScalar(cos).addScaledVector(_ringUp, sin);
        const v = base + i * SIDES + s;
        this._nrm.setXYZ(v, _point.x, _point.y, _point.z);
        this._pos.setXYZ(v,
          here.x + _point.x * radius,
          here.y + _point.y * radius,
          here.z + _point.z * radius);
      }
    }
  }

  /** Height the reins must clear to lie over the horse's neck rather than through it. */
  _crestY() {
    if (!this.neckBone) return null;
    this.neckBone.getWorldPosition(_c);
    return _c.y + TACK.neckClearance;
  }

  /**
   * @param {boolean} mounted whether the player is currently riding — reins run
   *   to the rider's hands when they are, and lie draped over the neck when
   *   they are not (rather than stretching across the map to a distant player).
   */
  update(mounted) {
    if (!this.available) return;
    this.horseRoot.updateMatrixWorld(true);
    if (!this._readHeadFrame()) return;
    if (mounted) this.playerRoot.updateMatrixWorld(true);

    // Bridle first, all of it measured out in the head's own frame.
    this._buildNoseband(TACK.nosebandForward, TACK.nosebandUp, TACK.nosebandHalfWidth, TACK.nosebandHalfHeight);
    this._writeStrand('noseband', TACK.strapRadius);

    this._buildSag(
      this._headPoint(_a, TACK.nosebandForward, TACK.nosebandUp, TACK.nosebandHalfWidth * 0.9),
      this._headPoint(_b, TACK.crownForward, TACK.crownUp, TACK.crownHalfWidth),
      0,
    );
    this._writeStrand('cheekL', TACK.strapRadius);
    this._buildSag(
      this._headPoint(_a, TACK.nosebandForward, TACK.nosebandUp, -TACK.nosebandHalfWidth * 0.9),
      this._headPoint(_b, TACK.crownForward, TACK.crownUp, -TACK.crownHalfWidth),
      0,
    );
    this._writeStrand('cheekR', TACK.strapRadius);

    this._buildSag(
      this._headPoint(_a, TACK.crownForward, TACK.crownUp, TACK.crownHalfWidth),
      this._headPoint(_b, TACK.crownForward, TACK.crownUp, -TACK.crownHalfWidth),
      0.06,
    );
    this._writeStrand('browband', TACK.strapRadius);

    // Then the reins themselves, from each side of the bit.
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? 1 : -1;
      this._headPoint(_a, TACK.bitForward, TACK.bitUp, TACK.bitHalfWidth * sign);
      const hand = side === 'L' ? this.handL : this.handR;
      if (mounted && hand) {
        hand.getWorldPosition(_b);
        this._buildSag(_a, _b, TACK.reinSag, this._crestY());
      } else if (this.neckBone) {
        this.neckBone.getWorldPosition(_b);
        _b.addScaledVector(_side, TACK.neckDrapeSide * sign);
        this._buildSag(_a, _b, TACK.reinDrapeSag);
      } else {
        continue;
      }
      this._writeStrand(side === 'L' ? 'reinL' : 'reinR', TACK.reinRadius);
    }

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
