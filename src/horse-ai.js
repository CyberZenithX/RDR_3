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
 * Round 5 added the hitching post as the next entry in the `mode` machine —
 * see `setHitchPost`.
 */

import * as THREE from 'three';
import { HORSE } from './config-horse.js';

export class HorseAI {
  /** @param {object} horse the Horse whose movement this steers while unmounted */
  constructor(horse) {
    // Bolting after being shot at while riderless. Panic overrides every other
    // mode, costs no stamina, and blocks being caught until it passes — see
    // HEALTH.horseMax and HORSE.spook*.
    this.spookT = 0;
    this.spookRecoverT = 0;
    this._spookHeading = 0;
    this.horse = horse;
    this.mode = 'wander'; // 'wander' | 'follow' | 'coming' | 'hitched'
    this.whistled = false;
    this.wanderTarget = new THREE.Vector3().copy(horse.position);
    this.timer = 0;
    /** The rail outside the saloon, once round 5's town has been built. */
    this.hitch = null;
    /** A yaw to settle on while standing still, or null — horse.js reads it. */
    this.holdYaw = null;
  }

  /**
   * Round 5's hitching post. BUILD-PLAN.md: "Hitching post outside the saloon
   * where the horse waits."
   *
   * The rule is deliberately *"you walked off and left it"* rather than
   * *"you are in town"*: the horse heads for the rail once the player is near
   * the post AND has put more than `followSettleDistance` between them. So you
   * ride in, step down, walk toward the saloon, and the animal takes itself to
   * the rail behind you — but whistling it over in the middle of the street
   * keeps it there, because you are standing next to it. Without that second
   * clause, a whistle in town is answered and then immediately undone, which
   * reads as the horse ignoring you.
   *
   * @param {{x:number,z:number,yaw:number,callRadius:number,arriveDistance:number}|null} point
   */
  setHitchPost(point) {
    this.hitch = point;
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
  /** True while running from something; horse.js refuses mounting and whistles. */
  get spooked() {
    return this.spookT > 0;
  }

  /** Sets it running straight away from (fromX, fromZ). */
  spook(fromX, fromZ) {
    this.spookT = HORSE.spookTime;
    this.spookRecoverT = HORSE.spookRecoverTime;
    const h = this.horse;
    this._spookHeading = Math.atan2(-(h.position.x - fromX), -(h.position.z - fromZ)) + Math.PI;
  }

  update(dt, player, outDir) {
    if (this.spookT > 0) {
      this.spookT -= dt;
      outDir.set(-Math.sin(this._spookHeading), 0, -Math.cos(this._spookHeading));
      return HORSE.gallopSpeed;
    }
    if (this.spookRecoverT > 0) this.spookRecoverT -= dt;

    const pos = this.horse.position;
    this.holdYaw = null;

    // ------------------------------------------------------ hitching post ---
    if (this.hitch && !this.whistled) {
      const playerToPost = Math.hypot(player.position.x - this.hitch.x, player.position.z - this.hitch.z);
      const playerToHorse = this._distanceTo(player.position);
      // The "walked off and left it" clause gates ENTERING the mode, not staying
      // in it: once the animal is at the rail, standing next to it must not send
      // it wandering off again, which is what an un-hystereticised test of this
      // caught immediately (the horse arrived, the player was then 3m away, and
      // the rule undid itself).
      const engage = this.mode === 'hitched' || playerToHorse > HORSE.followSettleDistance;
      if (playerToPost <= this.hitch.callRadius && engage) {
        this.mode = 'hitched';
        const d = Math.hypot(pos.x - this.hitch.x, pos.z - this.hitch.z);
        if (d <= this.hitch.arriveDistance) {
          this.holdYaw = this.hitch.yaw; // stand nose-in to the rail
          outDir.set(0, 0, 0);
          return 0;
        }
        outDir.set(this.hitch.x - pos.x, 0, this.hitch.z - pos.z).normalize();
        return HORSE.approachSpeed;
      }
      if (this.mode === 'hitched') {
        this.mode = 'wander';
        this._pickWanderTarget(player.position);
      }
    }

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
