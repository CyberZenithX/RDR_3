/**
 * horse.js — the horse's position/movement/AI/mount state, the counterpart
 * to player.js. Owns the horse's THREE.Vector3 position and a circle
 * collider that stays registered in collision.js for the horse's whole
 * lifetime (position mutated in place each frame, never re-added/removed).
 *
 * Two movement modes, chosen each frame by `this.mounted`:
 *  - unmounted: a small wander/follow/whistle AI (see _updateUnmounted)
 *  - mounted: WASD steering read directly from input.js, same
 *    camera-relative convention player.js uses, gallop gated by stamina.
 *
 * Mount/dismount has no animation clip (per BUILD-PLAN.md's fake table) —
 * mounting eases the player's rendered position onto the saddle point over
 * HORSE.mountLerpTime; dismounting is instant. main.js reads
 * `getSaddleTransform()` every frame the player is mounted and copies it
 * onto the Player instance; player.js's own on-foot physics do not run
 * while `player.mounted` is true (see its update()).
 *
 * No vectors are allocated inside update() — everything reusable is an
 * instance scratch object, per the performance budget rule.
 */

import * as THREE from 'three';
import { TOWN, BOUNDARY, SPAWN } from './config.js';
import { HORSE, HORSE_ANIM } from './config-horse.js';
import { isKeyDown, isPointerLocked } from './input.js';
import { addCircleCollider, resolveCollisions } from './collision.js';
import { smoothstep } from './noise.js';

function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/** Speed → locomotion state with hysteresis, same idea as player.js's classifySpeed. */
function classifyHorseSpeed(speed, prevState) {
  const half = HORSE_ANIM.blendBand / 2;
  if (prevState === 'gallop') {
    if (speed < HORSE_ANIM.gallopThreshold - half) return speed < HORSE_ANIM.idleThreshold ? 'idle' : 'walk';
    return 'gallop';
  }
  if (prevState === 'idle') {
    return speed > HORSE_ANIM.idleThreshold ? 'walk' : 'idle';
  }
  if (speed > HORSE_ANIM.gallopThreshold + half) return 'gallop';
  if (speed < HORSE_ANIM.idleThreshold) return 'idle';
  return 'walk';
}

export class Horse {
  constructor(character, world) {
    this.character = character;
    this.world = world;

    this.position = new THREE.Vector3(SPAWN.x + HORSE.spawnOffset.x, 0, SPAWN.z + HORSE.spawnOffset.z);
    this.position.y = world.groundHeightAt(this.position.x, this.position.z);
    this.velocityXZ = new THREE.Vector3();
    this.yaw = SPAWN.yaw + Math.PI; // face roughly back toward where the player spawns
    this.lean = 0;
    this.speed = 0;
    this.animState = 'idle';

    this.mounted = false;
    this.stamina = HORSE.staminaMax;
    this.staminaExhausted = false;

    // Unmounted AI state.
    this._mode = 'wander'; // 'wander' | 'follow' | 'coming'
    this._whistled = false;
    this._wanderTarget = new THREE.Vector3().copy(this.position);
    this._wanderTimer = 0;

    // Mount transition.
    this._mountBlendT = HORSE.mountLerpTime; // start "arrived" (fully unmounted, nothing to blend)
    this._premountPos = new THREE.Vector3();
    this._premountYaw = 0;
    this._prevEDown = false;
    this._prevHDown = false;

    this.collider = addCircleCollider(this.position.x, this.position.z, HORSE.colliderRadius, { kind: 'horse' });

    this._moveDir = new THREE.Vector3();
    this._desiredVel = new THREE.Vector3();
    this._diff = new THREE.Vector3();
    this._saddlePos = new THREE.Vector3();
    this._saddleLocal = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    character.root.position.copy(this.position);
    character.root.rotation.y = this.yaw + HORSE.meshYawOffset;
  }

  /** Called on an H-key press (edge-detected here, not by the caller). */
  _handleWhistle() {
    if (!this.mounted) {
      this._whistled = true;
      this._mode = 'coming';
    }
  }

  /** Straight-line distance from the horse to a world XZ point. */
  _distanceTo(pos) {
    return Math.hypot(this.position.x - pos.x, this.position.z - pos.z);
  }

  update(dt, camera, player) {
    const hDown = isPointerLocked() && isKeyDown('KeyH');
    if (hDown && !this._prevHDown) this._handleWhistle();
    this._prevHDown = hDown;

    const eDown = isPointerLocked() && isKeyDown('KeyE');
    if (eDown && !this._prevEDown) this.handleMountToggle(player);
    this._prevEDown = eDown;

    if (this.mounted) {
      this._updateMounted(dt, camera);
    } else {
      this._updateUnmounted(dt, player);
    }

    this._updateStamina(dt);

    resolveCollisions(this.position, HORSE.colliderRadius, this.collider);
    const distFromCenter = Math.hypot(this.position.x - TOWN.centerX, this.position.z - TOWN.centerZ);
    if (distFromCenter > BOUNDARY.playerLimit) {
      const scale = BOUNDARY.playerLimit / distFromCenter;
      this.position.x = TOWN.centerX + (this.position.x - TOWN.centerX) * scale;
      this.position.z = TOWN.centerZ + (this.position.z - TOWN.centerZ) * scale;
    }
    this.position.y = this.world.groundHeightAt(this.position.x, this.position.z);
    this.collider.x = this.position.x;
    this.collider.z = this.position.z;

    if (this._mountBlendT < HORSE.mountLerpTime) this._mountBlendT += dt;

    this.animState = classifyHorseSpeed(this.speed, this.animState);
    this.character.setLocomotion(this.animState, this.speed);
    this.character.update(dt);

    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw + HORSE.meshYawOffset;
    this.character.root.rotation.z = this.lean;
  }

  /** Reads WASD relative to the camera, exactly like player.js, and steers the horse as a vehicle. */
  _updateMounted(dt, camera) {
    const inputActive = isPointerLocked();
    const ix = inputActive ? (isKeyDown('KeyD') ? 1 : 0) - (isKeyDown('KeyA') ? 1 : 0) : 0;
    const iz = inputActive ? (isKeyDown('KeyW') ? 1 : 0) - (isKeyDown('KeyS') ? 1 : 0) : 0;
    const wantsGallop = inputActive && (isKeyDown('ShiftLeft') || isKeyDown('ShiftRight'));

    this._moveDir.set(0, 0, 0);
    if (ix !== 0 || iz !== 0) {
      this._moveDir.addScaledVector(camera.getRight(), ix).addScaledVector(camera.getForward(), iz);
      if (this._moveDir.lengthSq() > 0) this._moveDir.normalize();
    }

    const moving = this._moveDir.lengthSq() > 0.0001;
    const galloping = moving && wantsGallop && !this.staminaExhausted;
    this._isDrainingStamina = galloping;

    const targetSpeed = moving ? (galloping ? HORSE.gallopSpeed : HORSE.approachSpeed) : 0;
    this._integrateMovement(dt, targetSpeed);
    this._turnToward(dt, moving);
  }

  /** Wander near the player, close the gap if too far, or come running when whistled. */
  _updateUnmounted(dt, player) {
    this._isDrainingStamina = false;

    if (this._mode === 'coming') {
      if (this._distanceTo(player.position) < HORSE.whistleArriveDistance) {
        this._whistled = false;
        this._mode = 'wander';
        this._pickWanderTarget(player.position);
      }
    } else if (this._distanceTo(player.position) > HORSE.followTriggerDistance) {
      this._mode = 'follow';
    } else if (this._mode === 'follow' && this._distanceTo(player.position) < HORSE.followSettleDistance) {
      this._mode = 'wander';
      this._pickWanderTarget(player.position);
    } else if (this._mode === 'wander') {
      this._wanderTimer -= dt;
      const arrived = this._distanceTo(this._wanderTarget) < HORSE.wanderArriveDistance;
      if (this._wanderTimer <= 0 || arrived) this._pickWanderTarget(player.position);
    }

    this._moveDir.set(0, 0, 0);
    let targetSpeed = 0;
    if (this._mode === 'coming' || this._mode === 'follow') {
      this._moveDir.set(player.position.x - this.position.x, 0, player.position.z - this.position.z);
      targetSpeed = HORSE.approachSpeed;
    } else if (this._distanceTo(player.position) < HORSE.playerAvoidRadius) {
      this._moveDir.set(this.position.x - player.position.x, 0, this.position.z - player.position.z);
      targetSpeed = HORSE.walkSpeed;
    } else {
      this._moveDir.set(this._wanderTarget.x - this.position.x, 0, this._wanderTarget.z - this.position.z);
      targetSpeed = HORSE.walkSpeed;
    }
    const moving = this._moveDir.lengthSq() > 0.0004;
    if (moving) this._moveDir.normalize(); else targetSpeed = 0;

    this._integrateMovement(dt, targetSpeed);
    this._turnToward(dt, moving);
  }

  _pickWanderTarget(anchor) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * HORSE.wanderRadius;
    this._wanderTarget.set(anchor.x + Math.cos(angle) * r, 0, anchor.z + Math.sin(angle) * r);
    this._wanderTimer = THREE.MathUtils.lerp(HORSE.wanderIntervalMin, HORSE.wanderIntervalMax, Math.random());
  }

  /** Shared accel/decel integration + XZ position update for both movement modes. */
  _integrateMovement(dt, targetSpeed) {
    this._desiredVel.copy(this._moveDir).multiplyScalar(targetSpeed);
    const accelerating = targetSpeed > this.velocityXZ.length();
    const rate = accelerating ? HORSE.acceleration : HORSE.deceleration;
    this._diff.copy(this._desiredVel).sub(this.velocityXZ);
    const maxDelta = rate * dt;
    if (this._diff.length() > maxDelta) this._diff.setLength(maxDelta);
    this.velocityXZ.add(this._diff);

    this.position.x += this.velocityXZ.x * dt;
    this.position.z += this.velocityXZ.z * dt;
    this.speed = this.velocityXZ.length();
  }

  /** Shared yaw-toward-movement + lean-into-the-turn, used by both movement modes. */
  _turnToward(dt, moving) {
    const prevYaw = this.yaw;
    if (moving) {
      const targetYaw = Math.atan2(-this._moveDir.x, -this._moveDir.z);
      this.yaw = lerpAngle(this.yaw, targetYaw, Math.min(1, HORSE.turnRate * dt));
    }
    // Wrapped yaw delta this frame (turning through the +-PI seam should not
    // spike the lean), then a per-second rate.
    let yawDelta = ((this.yaw - prevYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    const yawRate = dt > 0 ? yawDelta / dt : 0;
    const desiredLean = THREE.MathUtils.clamp(-yawRate * HORSE.leanFactor, -HORSE.leanMax, HORSE.leanMax);
    this.lean += (desiredLean - this.lean) * (1 - Math.exp(-HORSE.leanDamping * dt));
  }

  _updateStamina(dt) {
    if (this._isDrainingStamina) {
      this.stamina = Math.max(0, this.stamina - HORSE.staminaDrainRate * dt);
    } else {
      this.stamina = Math.min(HORSE.staminaMax, this.stamina + HORSE.staminaRegenRate * dt);
    }
    if (this.stamina <= HORSE.staminaExhaustedFloor) this.staminaExhausted = true;
    else if (this.stamina >= HORSE.staminaExhaustedRecover) this.staminaExhausted = false;
  }

  /**
   * Mount if unmounted and in range, dismount if mounted. Public (not an
   * underscore-prefixed internal) because it's also the hook smoke.mjs uses
   * to exercise mounting without simulating real pointer-locked input — see
   * CLAUDE.md's round 2 notes and the "mount attaches..." check there.
   */
  handleMountToggle(player) {
    if (this.mounted) {
      this._dismount(player);
    } else if (this._distanceTo(player.position) <= HORSE.mountRange) {
      this._premountPos.copy(player.position);
      this._premountYaw = player.meshYaw;
      this._mountBlendT = 0;
      this.mounted = true;
      player.mount();
    }
  }

  _dismount(player) {
    this.mounted = false;
    const sideX = Math.cos(this.yaw + Math.PI / 2);
    const sideZ = Math.sin(this.yaw + Math.PI / 2);
    const x = this.position.x + sideX * HORSE.dismountDistance;
    const z = this.position.z + sideZ * HORSE.dismountDistance;
    const y = this.world.groundHeightAt(x, z);
    player.dismount(x, y, z, this.yaw);
  }

  /**
   * World-space {position, yaw} for the rider this frame. During the
   * post-mount blend window this eases from wherever the player stood at
   * mount time onto the true saddle point, per BUILD-PLAN.md's "lerp onto
   * the saddle point over 0.4s, no clip" fake for Mount/Dismount.
   */
  getSaddleTransform(outPos) {
    this._saddleLocal.set(HORSE.saddleOffset.x, 0, HORSE.saddleOffset.z).applyAxisAngle(this._up, this.yaw);
    this._saddlePos.set(
      this.position.x + this._saddleLocal.x,
      this.position.y + HORSE.saddleOffset.y,
      this.position.z + this._saddleLocal.z,
    );

    const t = smoothstep(0, HORSE.mountLerpTime, this._mountBlendT);
    outPos.lerpVectors(this._premountPos, this._saddlePos, t);
    const yaw = lerpAngle(this._premountYaw, this.yaw, t);
    return { position: outPos, yaw };
  }
}
