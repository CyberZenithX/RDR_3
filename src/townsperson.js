/**
 * townsperson.js — one citizen's body and their small brain, split out of
 * townsfolk.js under BUILD-PLAN.md's 400-line cap along the same seam
 * bandit.js/bandits.js is cut on: this file owns a position, a collider, a rig
 * and a state machine, and `townsfolk.js` owns everything that is a property of
 * the group.
 *
 * The brain is `idle -> stroll -> watch -> flee -> dead` and lives in here
 * rather than in a third file, because it is thirty lines with no cover
 * search, no shooting and no navmesh — a bandit's is its own file because a
 * bandit's is genuinely a machine. It still keeps horse-ai.js's discipline of
 * deciding a heading and a speed and letting one movement path integrate them.
 *
 * WHY A CITIZEN IS NOT A BANDIT: see docs/DECISIONS.md ADR-034.
 */

import * as THREE from 'three';
import { ANIM } from './config.js';
import { TOWNSFOLK } from './config-town.js';
import { HEALTH } from './config-ai.js';
import { addCircleCollider, removeCollider, resolveCollisions } from './collision.js';
import { Health } from './health.js';

// Reused by every townsperson, every frame — nothing in here allocates.
const _dir = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _diff = new THREE.Vector3();

/** Duplicated from player.js/bandit.js per ADR-010 — ten lines, and it is the shared idiom. */
function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export class Townsperson {
  constructor({ character, world, group, spawn }) {
    this.character = character;
    this.world = world;
    this.group = group;
    this.name = `townsfolk-${spawn.x.toFixed(0)}-${spawn.z.toFixed(0)}`;

    this.position = new THREE.Vector3(spawn.x, world.groundHeightAt(spawn.x, spawn.z), spawn.z);
    this.anchor = new THREE.Vector3().copy(this.position);
    this.target = new THREE.Vector3().copy(this.position);
    this.velocityXZ = new THREE.Vector3();
    this.speed = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.animState = 'idle';
    this.state = 'idle';
    this.health = new Health(TOWNSFOLK.maxHealth);

    // Registered once, mutated in place every frame, per the collision contract.
    this.collider = addCircleCollider(spawn.x, spawn.z, TOWNSFOLK.colliderRadius,
      { kind: 'townsfolk', person: this });

    this._pauseT = Math.random() * TOWNSFOLK.pauseMax;
    this._strollT = 0;
    this._watchT = 0;
    this._panicT = 0;
    this._staggerT = 0;
    this._stuckT = TOWNSFOLK.patrolIntervalMin;
    this._stuckFrom = new THREE.Vector3().copy(this.position);

    // Unarmed: the revolver character.js builds for every rig is simply not
    // drawn. `setVisible` has existed since round 3 with no caller.
    this.character.weapon?.setVisible(false);
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw + TOWNSFOLK.meshYawOffset;
    // Posed once at construction, so someone never inside `activeRadius` still
    // stands in their idle pose rather than in the GLB's bind T-pose.
    this.character.setLocomotion('idle', 0, false);
    this.character.update(0);
  }

  get alive() {
    return !this.health.dead;
  }

  /** "Something happened over there" — a gunshot within earshot. */
  panic(fromX, fromZ) {
    if (!this.alive) return;
    this._panicT = TOWNSFOLK.panicTime;
    // Straight away from it, out of the street, and re-picked as they run.
    const dx = this.position.x - fromX;
    const dz = this.position.z - fromZ;
    const len = Math.max(1e-3, Math.hypot(dx, dz));
    this.target.set(
      this.position.x + (dx / len) * 30,
      0,
      this.position.z + (dz / len) * 30,
    );
  }

  /** Returns 'dead' | 'hit' | null — the same three-way answer bandits give. */
  damage(amount, fromX, fromZ) {
    const outcome = this.health.damage(amount);
    if (!outcome) return null;
    if (outcome === 'dead') {
      this.deathClipT = (this.character.setDead(true) || HEALTH.tipTime) + 0.15;
      this._deadT = 0;
      this.state = 'dead';
      this.velocityXZ.set(0, 0, 0);
      this.speed = 0;
      if (this.collider) {
        removeCollider(this.collider);
        this.collider = null;
      }
      this.position.y = this.world.groundHeightAt(this.position.x, this.position.z);
      this.character.root.position.copy(this.position);
      return 'dead';
    }
    this._staggerT = this.character.playHit() || HEALTH.hitStagger;
    if (fromX !== undefined) this.panic(fromX, fromZ);
    return 'hit';
  }

  update(dt, player) {
    if (!this.alive) {
      // The clip plays out and clamps, then the body stops costing a posed
      // skeleton every frame — bandits.js's rule, minus the sinking, because a
      // dead townsperson is evidence and round 6 will want it lying there.
      this._deadT += dt;
      if (this._deadT <= this.deathClipT) this.character.update(dt);
      return;
    }

    if (this._staggerT > 0) this._staggerT -= dt;
    const staggered = this._staggerT > 0;
    const targetSpeed = staggered ? 0 : this._think(dt, player);
    this._move(dt, targetSpeed);
    this._face(dt, player, staggered);
    this._pose(dt);
  }

  /**
   * The whole brain. Writes `_dir` (this frame's heading) and returns the speed
   * to integrate toward — the same "owns no position" split horse-ai.js and
   * bandit-ai.js use.
   */
  _think(dt, player) {
    const T = TOWNSFOLK;
    _dir.set(0, 0, 0);

    if (this._panicT > 0) {
      this._panicT -= dt;
      this.state = 'flee';
      _dir.set(this.target.x - this.position.x, 0, this.target.z - this.position.z);
      if (_dir.lengthSq() < 1.5) {
        // Reached the bolt-hole: keep going in the same direction rather than
        // stopping dead in the open.
        this.target.set(this.position.x + _dir.x * 12, 0, this.position.z + _dir.z * 12);
      }
      if (_dir.lengthSq() > 1e-6) _dir.normalize();
      return T.panicSpeed;
    }

    const dist = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);
    if (dist <= T.lookRadius && !player.dead) this._watchT = T.lookHoldTime;
    else this._watchT = Math.max(0, this._watchT - dt);

    if (this._watchT > 0) {
      // Turning to look at you IS the behaviour BUILD-PLAN.md asks for, so it
      // stops the stroll rather than sharing it: someone who watches you go past
      // while still walking somewhere else is not watching you.
      this.state = 'watch';
      this._pauseT = Math.max(this._pauseT, T.pauseMin);
      return 0;
    }

    if (this._pauseT > 0) {
      this._pauseT -= dt;
      this.state = 'idle';
      return 0;
    }

    if (this.state !== 'stroll') this._pickTarget();
    this.state = 'stroll';
    this._strollT -= dt;
    _dir.set(this.target.x - this.position.x, 0, this.target.z - this.position.z);
    const arrived = _dir.lengthSq() < T.patrolArriveDistance * T.patrolArriveDistance;
    // Bumping into a wall for a while is the same thing as arriving, as far as
    // an idler is concerned. No steering rays: a townsperson is in a street,
    // and BUILD-PLAN.md's "no navmesh" applies here at least as strongly.
    this._stuckT -= dt;
    if (this._stuckT <= 0) {
      const moved = this._stuckFrom.distanceTo(this.position);
      this._stuckFrom.copy(this.position);
      this._stuckT = 1.5;
      if (moved < 0.35) {
        this._pauseT = THREE.MathUtils.lerp(T.pauseMin, T.pauseMax, Math.random());
        this.state = 'idle';
        return 0;
      }
    }
    if (arrived || this._strollT <= 0) {
      this._pauseT = THREE.MathUtils.lerp(T.pauseMin, T.pauseMax, Math.random());
      this.state = 'idle';
      return 0;
    }
    _dir.normalize();
    return T.walkSpeed;
  }

  _pickTarget() {
    const T = TOWNSFOLK;
    const a = Math.random() * Math.PI * 2;
    const r = 1 + Math.random() * (T.patrolRadius - 1);
    this.target.set(this.anchor.x + Math.cos(a) * r, 0, this.anchor.z + Math.sin(a) * r);
    this._strollT = THREE.MathUtils.lerp(T.patrolIntervalMin, T.patrolIntervalMax, Math.random());
    this._stuckT = 1.5;
    this._stuckFrom.copy(this.position);
  }

  _move(dt, targetSpeed) {
    const T = TOWNSFOLK;
    _desired.copy(_dir).multiplyScalar(targetSpeed);
    const rate = targetSpeed > this.velocityXZ.length() ? T.acceleration : T.deceleration;
    _diff.copy(_desired).sub(this.velocityXZ);
    const maxDelta = rate * dt;
    if (_diff.length() > maxDelta) _diff.setLength(maxDelta);
    this.velocityXZ.add(_diff);

    this.position.x += this.velocityXZ.x * dt;
    this.position.z += this.velocityXZ.z * dt;
    resolveCollisions(this.position, T.radius, this.collider);
    this.position.y = this.world.groundHeightAt(this.position.x, this.position.z);
    this.speed = this.velocityXZ.length();
    if (this.collider) {
      this.collider.x = this.position.x;
      this.collider.z = this.position.z;
    }
  }

  _face(dt, player, staggered) {
    const T = TOWNSFOLK;
    let targetYaw = null;
    let rate = T.turnRate;
    if (!staggered && this.state === 'watch') {
      targetYaw = Math.atan2(-(player.position.x - this.position.x), -(player.position.z - this.position.z));
      rate = T.lookTurnRate;
    } else if (this.speed > ANIM.idleThreshold * 0.5 && _dir.lengthSq() > 1e-4) {
      targetYaw = Math.atan2(-_dir.x, -_dir.z);
    }
    if (targetYaw !== null) this.yaw = lerpAngle(this.yaw, targetYaw, Math.min(1, rate * dt));
  }

  _pose(dt) {
    if (this.speed < ANIM.idleThreshold) this.animState = 'idle';
    else if (this.speed > ANIM.runThreshold) this.animState = 'run';
    else this.animState = 'walk';
    this.character.setLocomotion(this.animState, this.speed, false);
    this.character.setAirborne(false);
    this.character.setRidingPose(0, 0, 0);
    this.character.setAimPose({ weight: 0 });
    this.character.update(dt);
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw + TOWNSFOLK.meshYawOffset;
  }
}
