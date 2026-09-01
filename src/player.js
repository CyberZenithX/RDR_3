/**
 * player.js — movement, grounding, collision, and the locomotion animation
 * state machine. Owns the player's THREE.Vector3 position; main.js reads it
 * for the camera and HUD.
 *
 * No vectors are allocated inside update() — everything reusable is a
 * module-level/instance scratch object, per the performance budget rule.
 */

import * as THREE from 'three';
import { PLAYER, ANIM, TOWN, BOUNDARY, SPAWN } from './config.js';
import { isKeyDown, isPointerLocked } from './input.js';
import { resolveCollisions } from './collision.js';

// Reused every mounted frame — nothing here allocates. See setSaddle().
const _rideEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _rideQuat = new THREE.Quaternion();
const _hipOffset = new THREE.Vector3();

function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/** Speed → locomotion state with hysteresis so it doesn't chatter at the threshold. */
function classifySpeed(speed, prevState) {
  const half = ANIM.blendBand / 2;
  if (prevState === 'run') {
    if (speed < ANIM.runThreshold - half) return speed < ANIM.idleThreshold ? 'idle' : 'walk';
    return 'run';
  }
  if (prevState === 'idle') {
    return speed > ANIM.idleThreshold ? 'walk' : 'idle';
  }
  // prevState === 'walk'
  if (speed > ANIM.runThreshold + half) return 'run';
  if (speed < ANIM.idleThreshold) return 'idle';
  return 'walk';
}

export class Player {
  constructor(character, world) {
    this.character = character;
    this.world = world;

    this.position = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
    this.position.y = world.groundHeightAt(this.position.x, this.position.z);
    this.velocityXZ = new THREE.Vector3();
    this.velocityY = 0;
    this.grounded = true;
    this.speed = 0;
    this.meshYaw = SPAWN.yaw;
    this.animState = 'idle';
    this.boundaryProximity = 0; // 0..1, for the UI edge-of-map fade
    this.mounted = false; // true while riding the horse — see mount()/dismount() and horse.js
    // Ride state, written by setSaddle() each mounted frame (see horse.js's
    // getSaddleTransform) and read by update()'s mounted branch.
    this.rideBlend = 0;
    this.rideRoll = 0;
    this.ridePitch = 0;
    this.rideSway = 0;
    this.rideJump = 0;

    this._coyoteTimer = 0;
    this._jumpBufferTimer = 0;
    this._prevSpaceDown = false;

    this._moveDir = new THREE.Vector3();
    this._desiredVel = new THREE.Vector3();
    this._diff = new THREE.Vector3();

    character.root.position.copy(this.position);
    character.root.rotation.y = this.meshYaw + PLAYER.meshYawOffset;
  }

  /** Called by horse.js when a mount succeeds. Physics stop; main.js now drives this.position/meshYaw from the saddle transform each frame. */
  mount() {
    this.velocityXZ.set(0, 0, 0);
    this.velocityY = 0;
    this.grounded = true;
    this.mounted = true;
    // Space means "the horse jumps" from here on (horse-jump.js reads it). Drop
    // any press already in flight so swinging into the saddle mid-stride does
    // not leave a buffered on-foot jump waiting to fire at the next dismount.
    this._jumpBufferTimer = 0;
    this._prevSpaceDown = false;
  }

  /**
   * Takes this frame's saddle transform from horse.getSaddleTransform(). The
   * saddle's `y` is a *seat* height — where the rider's hips belong — so the
   * rig's own measured hip height comes off it: a seated rider is placed by
   * their pelvis, not by feet that aren't carrying them.
   */
  setSaddle(saddle) {
    this.position.copy(saddle.position);
    // The offset comes off along the *rider's own* up axis, not the world's.
    // The rig rotates about its root, which is a whole hip height below the
    // seat, so dropping straight down and then rolling swings the hips off the
    // saddle by `hipHeight * sin(roll)` — measured 0.20 at the 0.25rad lean
    // limit, against a barrel only 0.33 wide. That, with the seat not banking
    // either (see horse.js's getSaddleTransform), is what threw the rider's
    // legs off the horse on every turn. Rotating the offset instead pins the
    // hips to the saddle point and makes roll and pitch pivot there, which is
    // where a rider actually hinges.
    //
    // Scaled by the mount blend, not applied outright: the blend runs from
    // where the player stood on the ground to the seat, and taking a whole hip
    // height off at t=0 would drop them through the terrain for the first
    // frame of it. At t=1 this is the full offset, which is what seats them.
    _rideEuler.set(saddle.pitch, saddle.yaw + PLAYER.meshYawOffset, saddle.roll, 'YXZ');
    _rideQuat.setFromEuler(_rideEuler);
    _hipOffset.set(0, (this.character.hipHeight ?? 0) * saddle.blend, 0).applyQuaternion(_rideQuat);
    this.position.sub(_hipOffset);
    this.meshYaw = saddle.yaw;
    this.rideBlend = saddle.blend;
    this.rideRoll = saddle.roll;
    this.ridePitch = saddle.pitch;
    this.rideSway = saddle.sway;
    this.rideJump = saddle.jump;
  }

  /** Called by horse.js on dismount, with a ground-level drop-off point already resolved. */
  dismount(x, y, z, yaw) {
    this.mounted = false;
    this.position.set(x, y, z);
    this.meshYaw = yaw;
    this.velocityXZ.set(0, 0, 0);
    this.velocityY = 0;
    this.grounded = true;
    this.rideBlend = 0;
    this.rideRoll = 0;
    this.ridePitch = 0;
    this.rideSway = 0;
    this.rideJump = 0;
    // Space was the horse's jump while mounted — see mount() for the mirror.
    this._jumpBufferTimer = 0;
    this._prevSpaceDown = false;
    this.character.setRidingPose(0, 0, 0);
    this.character.root.rotation.set(0, this.meshYaw + PLAYER.meshYawOffset, 0);
  }

  update(dt, camera) {
    if (this.mounted) {
      // Position/meshYaw are already set by main.js from horse.getSaddleTransform()
      // this frame — this just keeps the visual rig in sync and poses it into
      // the saddle. The idle clip keeps playing underneath; riding-pose.js
      // overwrites the bones it writes, every frame, after the mixer runs.
      this.speed = 0;
      this.boundaryProximity = 0;
      this.character.setLocomotion('idle', 0);
      this.character.setAirborne(false);
      this.character.setRidingPose(this.rideBlend, this.rideSway, this.rideJump);
      // The root transform is written *before* character.update(), unlike the
      // on-foot branch below. riding-pose.js authors every angle in the root's
      // own frame and converts it through the root's live world rotation, so
      // posing first would convert this frame's angles through last frame's
      // lean — a frame of skew that only grows as the bank does.
      this.character.root.position.copy(this.position);
      // YXZ so roll is applied about the rider's own forward axis and pitch
      // about their own right axis, whichever way they happen to be facing —
      // with the default XYZ order both would be taken about world axes and
      // the lean would swing wrongly as the horse turns.
      this.character.root.rotation.order = 'YXZ';
      this.character.root.rotation.set(
        this.ridePitch,
        this.meshYaw + PLAYER.meshYawOffset,
        this.rideRoll,
      );
      this.character.update(dt);
      return;
    }

    const inputActive = isPointerLocked();

    // ------------------------------------------------------------- input ---
    const ix = inputActive ? (isKeyDown('KeyD') ? 1 : 0) - (isKeyDown('KeyA') ? 1 : 0) : 0;
    const iz = inputActive ? (isKeyDown('KeyW') ? 1 : 0) - (isKeyDown('KeyS') ? 1 : 0) : 0;
    const sprinting = inputActive && (isKeyDown('ShiftLeft') || isKeyDown('ShiftRight'));
    const spaceDown = inputActive && isKeyDown('Space');
    if (spaceDown && !this._prevSpaceDown) this._jumpBufferTimer = PLAYER.jumpBuffer;
    this._prevSpaceDown = spaceDown;

    this._moveDir.set(0, 0, 0);
    if (ix !== 0 || iz !== 0) {
      this._moveDir
        .addScaledVector(camera.getRight(), ix)
        .addScaledVector(camera.getForward(), iz);
      if (this._moveDir.lengthSq() > 0) this._moveDir.normalize();
    }

    // ------------------------------------------------------- horizontal ---
    const targetSpeed = this._moveDir.lengthSq() > 0 ? (sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed) : 0;
    this._desiredVel.copy(this._moveDir).multiplyScalar(targetSpeed);

    const accelerating = targetSpeed > this.velocityXZ.length();
    const rate = (accelerating ? PLAYER.acceleration : PLAYER.deceleration) * (this.grounded ? 1 : PLAYER.airControl);
    this._diff.copy(this._desiredVel).sub(this.velocityXZ);
    const maxDelta = rate * dt;
    if (this._diff.length() > maxDelta) this._diff.setLength(maxDelta);
    this.velocityXZ.add(this._diff);

    this.position.x += this.velocityXZ.x * dt;
    this.position.z += this.velocityXZ.z * dt;

    // Prop collision, then the hard world-boundary clamp (belt and suspenders
    // on top of the boundary ridge terrain itself — see BOUNDARY in config.js).
    resolveCollisions(this.position, PLAYER.radius);
    const distFromCenter = Math.hypot(this.position.x - TOWN.centerX, this.position.z - TOWN.centerZ);
    if (distFromCenter > BOUNDARY.playerLimit) {
      const scale = BOUNDARY.playerLimit / distFromCenter;
      this.position.x = TOWN.centerX + (this.position.x - TOWN.centerX) * scale;
      this.position.z = TOWN.centerZ + (this.position.z - TOWN.centerZ) * scale;
    }
    this.boundaryProximity = THREE.MathUtils.clamp(
      (distFromCenter - BOUNDARY.warnAt) / Math.max(1, BOUNDARY.playerLimit - BOUNDARY.warnAt),
      0, 1,
    );

    // ------------------------------------------------------------ jump ---
    this.velocityY += PLAYER.gravity * dt;
    this._coyoteTimer = this.grounded ? PLAYER.coyoteTime : this._coyoteTimer - dt;
    this._jumpBufferTimer -= dt;
    if (this._jumpBufferTimer > 0 && this._coyoteTimer > 0) {
      this.velocityY = PLAYER.jumpSpeed;
      this._jumpBufferTimer = 0;
      this._coyoteTimer = 0;
      this.grounded = false;
    }
    this.position.y += this.velocityY * dt;

    const groundY = this.world.groundHeightAt(this.position.x, this.position.z);
    if (this.velocityY <= 0 && this.position.y - groundY <= PLAYER.groundSnap) {
      this.position.y = groundY;
      this.velocityY = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    if (this.position.y < PLAYER.respawnBelowY) this.respawn();

    // -------------------------------------------------------- facing ---
    // meshYaw is always the pure logical facing angle (matches movement
    // direction, no offset baked in) — PLAYER.meshYawOffset is applied
    // exactly once, below, when it's turned into a render rotation. Baking
    // it in here too would double it up the moment the player moves.
    this.speed = this.velocityXZ.length();
    if (this._moveDir.lengthSq() > 0.0001) {
      const targetYaw = Math.atan2(-this._moveDir.x, -this._moveDir.z);
      this.meshYaw = lerpAngle(this.meshYaw, targetYaw, Math.min(1, PLAYER.turnRate * dt));
    }

    // ---------------------------------------------------------- anim ---
    this.animState = classifySpeed(this.speed, this.animState);
    const animSpeed = this.grounded ? this.speed : this.speed * ANIM.airTimeScale;
    this.character.setLocomotion(this.animState, animSpeed);
    this.character.setAirborne(!this.grounded);
    this.character.update(dt);

    // ------------------------------------------------------- transform ---
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.meshYaw + PLAYER.meshYawOffset;
  }

  respawn() {
    this.position.set(SPAWN.x, 0, SPAWN.z);
    this.position.y = this.world.groundHeightAt(this.position.x, this.position.z);
    this.velocityXZ.set(0, 0, 0);
    this.velocityY = 0;
    this.grounded = true;
    this.meshYaw = SPAWN.yaw;
  }
}
