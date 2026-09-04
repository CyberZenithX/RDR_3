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
import { StrapMesh, SEGMENTS } from './strap.js';

const _head = new THREE.Vector3();
const _earL = new THREE.Vector3();
const _earR = new THREE.Vector3();
const _up = new THREE.Vector3();
const _side = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();


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

    this.straps = new StrapMesh(scene, STRANDS, { color: TACK.color, name: 'tack' });
    // Kept reachable at the old names: scripts/smoke.mjs reads the strand
    // buffer directly to check that both ends of a rein land where they should.
    this.mesh = this.straps.mesh;
    this.geometry = this.straps.geometry;
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

  /** Fills the strap curve with a ring around the muzzle at a given distance along the head. */
  _buildNoseband(forward, up, radiusSide, radiusUp) {
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      this._headPoint(this.straps.curve[i], forward, up + Math.cos(a) * radiusUp, Math.sin(a) * radiusSide);
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
    this.straps.write('noseband', TACK.strapRadius);

    this.straps.sag(
      this._headPoint(_a, TACK.nosebandForward, TACK.nosebandUp, TACK.nosebandHalfWidth * 0.9),
      this._headPoint(_b, TACK.crownForward, TACK.crownUp, TACK.crownHalfWidth),
      0,
    );
    this.straps.write('cheekL', TACK.strapRadius);
    this.straps.sag(
      this._headPoint(_a, TACK.nosebandForward, TACK.nosebandUp, -TACK.nosebandHalfWidth * 0.9),
      this._headPoint(_b, TACK.crownForward, TACK.crownUp, -TACK.crownHalfWidth),
      0,
    );
    this.straps.write('cheekR', TACK.strapRadius);

    this.straps.sag(
      this._headPoint(_a, TACK.crownForward, TACK.crownUp, TACK.crownHalfWidth),
      this._headPoint(_b, TACK.crownForward, TACK.crownUp, -TACK.crownHalfWidth),
      0.06,
    );
    this.straps.write('browband', TACK.strapRadius);

    // Then the reins themselves, from each side of the bit.
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? 1 : -1;
      this._headPoint(_a, TACK.bitForward, TACK.bitUp, TACK.bitHalfWidth * sign);
      const hand = side === 'L' ? this.handL : this.handR;
      if (mounted && hand) {
        hand.getWorldPosition(_b);
        this.straps.sag(_a, _b, TACK.reinSag, this._crestY());
      } else if (this.neckBone) {
        this.neckBone.getWorldPosition(_b);
        _b.addScaledVector(_side, TACK.neckDrapeSide * sign);
        this.straps.sag(_a, _b, TACK.reinDrapeSag);
      } else {
        continue;
      }
      this.straps.write(side === 'L' ? 'reinL' : 'reinR', TACK.reinRadius);
    }

    this.straps.flush();
  }
}

