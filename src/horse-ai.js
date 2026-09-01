/**
 * horse-ai.js — what the horse does when nobody is riding it: wander near the
 * player, close the gap when it drifts too far, come when whistled, and get
 * out of the way if the player walks into it.
 *
 * Split out of horse.js under BUILD-PLAN.md's 400-line cap when round 3's
 * aiming steering pushed that file to 407 lines. It is the same seam
 * horse-jump.js and horse-seat.js were cut along: horse.js keeps the state,
 * the movement integration and the mount/dismount surface, and each
 * neighbouring file owns one whole behaviour.
 *
 * This owns NO position and NO velocity. It decides a direction and a speed;
 * horse.js integrates them, resolves collision, clamps to the boundary and
 * turns the animal. That is what keeps the mounted and unmounted paths going
 * through exactly the same physics rather than drifting apart.
 *
 * Round 5's hitching post is the obvious next entry in the `mode` machine.
 */

import * as THREE from 'three';
import { HORSE } from './config-horse.js';

export class HorseAI {
  /** @param {object} horse the Horse whose movement this steers while unmounted */
  constructor(horse) {
    this.horse = horse;
    this.mode = 'wander'; // 'wander' | 'follow' | 'coming'
    this.whistled = false;
    this.wanderTarget = new THREE.Vector3().copy(horse.position);
    this.timer = 0;
  }

  /** Called on an H-key press. Ignored while mounted — you are already on it. */
  whistle() {
    this.whistled = true;
    this.mode = 'coming';
  }

  /** Straight-line XZ distance from the horse to a world point. */
  _distanceTo(pos) {
    return Math.hypot(this.horse.position.x - pos.x, this.horse.position.z - pos.z);
  }

  _pickWanderTarget(anchor) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * HORSE.wanderRadius;
    this.wanderTarget.set(anchor.x + Math.cos(angle) * r, 0, anchor.z + Math.sin(angle) * r);
    this.timer = THREE.MathUtils.lerp(HORSE.wanderIntervalMin, HORSE.wanderIntervalMax, Math.random());
  }

  /**
   * Advances the state machine and writes this frame's heading into
   * `outDir` (normalised, or zeroed if standing).
   *
   * @returns {number} the target speed horse.js should integrate toward. Zero
   *   means "stand still", and horse.js reads that as "do not turn either".
   */
  update(dt, player, outDir) {
    const pos = this.horse.position;

    if (this.mode === 'coming') {
      if (this._distanceTo(player.position) < HORSE.whistleArriveDistance) {
        this.whistled = false;
        this.mode = 'wander';
        this._pickWanderTarget(player.position);
      }
    } else if (this._distanceTo(player.position) > HORSE.followTriggerDistance) {
      this.mode = 'follow';
    } else if (this.mode === 'follow' && this._distanceTo(player.position) < HORSE.followSettleDistance) {
      this.mode = 'wander';
      this._pickWanderTarget(player.position);
    } else if (this.mode === 'wander') {
      this.timer -= dt;
      const arrived = this._distanceTo(this.wanderTarget) < HORSE.wanderArriveDistance;
      if (this.timer <= 0 || arrived) this._pickWanderTarget(player.position);
    }

    outDir.set(0, 0, 0);
    let targetSpeed = 0;
    if (this.mode === 'coming' || this.mode === 'follow') {
      outDir.set(player.position.x - pos.x, 0, player.position.z - pos.z);
      targetSpeed = HORSE.approachSpeed;
    } else if (this._distanceTo(player.position) < HORSE.playerAvoidRadius) {
      // Standing on the player's toes: step away rather than through them.
      outDir.set(pos.x - player.position.x, 0, pos.z - player.position.z);
      targetSpeed = HORSE.walkSpeed;
    } else {
      outDir.set(this.wanderTarget.x - pos.x, 0, this.wanderTarget.z - pos.z);
      targetSpeed = HORSE.walkSpeed;
    }

    if (outDir.lengthSq() > 0.0004) {
      outDir.normalize();
      return targetSpeed;
    }
    outDir.set(0, 0, 0);
    return 0;
  }
}
