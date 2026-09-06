/**
 * player.js — movement, grounding, collision, the locomotion animation state
 * machine, and (since round 4) health, dying and coming back. Owns the
 * player's THREE.Vector3 position; main.js reads it for the camera and HUD.
 *
 * `respawn()` IS THE ONE FUNCTION. BUILD-PLAN.md: "Keep the respawn call in
 * one function so round 7 can swap in the real checkpoint without touching
 * combat code." Nothing else in the codebase decides where the player goes
 * back to — bandits.js only calls `markCamp()` to say which camp is nearest.
 *
 * No vectors are allocated inside update() — everything reusable is a
 * module-level/instance scratch object, per the performance budget rule.
 */

import * as THREE from 'three';
import { PLAYER, ANIM, TOWN, BOUNDARY, SPAWN } from './config.js';
import { BANDIT, HEALTH } from './config-ai.js';
import { isKeyDown, isPointerLocked } from './input.js';
import { resolveCollisions } from './collision.js';
import { Health } from './health.js';
import { loadCheckpoint } from './checkpoint.js';

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
    this.health = new Health(HEALTH.playerMax);
    this.dead = false;
    this.deathTimer = 0;
    this.damageFlash = 0; // 0..1, drives the red vignette; ui.js reads it
    this._lastCamp = null; // the last bandit camp approached — see markCamp()
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

  /**
   * @param {object|null} combat round 3's Combat, or null. Passed in rather
   *   than imported so the player still runs standalone (and so smoke.mjs can
   *   drive it without one). It supplies two things: the aiming flag, which
   *   changes what the character faces and which clips play, and the pose
   *   state handed straight through to the rig — see combat.js's poseState().
   */
  update(dt, camera, combat = null) {
    const aiming = !!combat?.aiming && !this.dead;
    if (combat && !this.dead) this.character.setAimPose(combat.poseState());
    if (this.damageFlash > 0) {
      this.damageFlash = Math.max(0, this.damageFlash - dt / HEALTH.damageFlashTime);
    }

    if (this.dead) {
      // Everything stops except gravity and the death clip. main.js has already
      // asked the horse to put the body down, so this only runs on foot.
      this.speed = 0;
      this.velocityXZ.set(0, 0, 0);
      this.velocityY += PLAYER.gravity * dt;
      this.position.y += this.velocityY * dt;
      const deadGroundY = this.world.groundHeightAt(this.position.x, this.position.z);
      if (this.position.y <= deadGroundY) {
        this.position.y = deadGroundY;
        this.velocityY = 0;
        this.grounded = true;
      }
      this.character.update(dt);
      this.character.root.position.copy(this.position);
      this.character.root.rotation.set(0, this.meshYaw + PLAYER.meshYawOffset, 0);
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.respawn();
      return;
    }

    if (this.mounted) {
      // Position/meshYaw are already set by main.js from horse.getSaddleTransform()
      // this frame — this just keeps the visual rig in sync and poses it into
      // the saddle. The idle clip keeps playing underneath; riding-pose.js
      // overwrites the bones it writes, every frame, after the mixer runs.
      this.speed = 0;
      this.boundaryProximity = 0;
      // Mounted, the base clip stays the plain idle whether or not the gun is
      // up: the riding pose overwrites the whole body anyway, and swapping in
      // a standing gun clip underneath it changes nothing you can see while
      // costing a crossfade every time the trigger finger moves.
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
    if (aiming) {
      // Over-the-shoulder aiming turns the body to the camera, not to the
      // direction of travel: the gun has to point at the crosshair, and the
      // crosshair is the camera. Strafing away from where you are looking is
      // then a real, deliberate difference from unaimed movement rather than
      // a bug — it is what backing away from something while covering it is.
      this.meshYaw = lerpAngle(this.meshYaw, camera.yaw, Math.min(1, PLAYER.aimTurnRate * dt));
    } else if (this._moveDir.lengthSq() > 0.0001) {
      const targetYaw = Math.atan2(-this._moveDir.x, -this._moveDir.z);
      this.meshYaw = lerpAngle(this.meshYaw, targetYaw, Math.min(1, PLAYER.turnRate * dt));
    }

    // ---------------------------------------------------------- anim ---
    this.animState = classifySpeed(this.speed, this.animState);
    const animSpeed = this.grounded ? this.speed : this.speed * ANIM.airTimeScale;
    this.character.setLocomotion(this.animState, animSpeed, aiming);
    this.character.setAirborne(!this.grounded);
    this.character.update(dt);

    // ------------------------------------------------------- transform ---
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.meshYaw + PLAYER.meshYawOffset;
  }

  /**
   * Takes a hit. Returns 'dead' | 'hit' | null, the same three-way answer
   * bandits get, so a caller can pick an effect without tracking state.
   * BUILD-PLAN.md's feel target is five of these.
   */
  damage(amount = HEALTH.banditDamage) {
    if (this.dead) return null;
    const outcome = this.health.damage(amount);
    if (!outcome) return null;
    this.damageFlash = 1;
    if (outcome === 'dead') {
      this.dead = true;
      this.deathTimer = HEALTH.respawnDelay;
      this.velocityXZ.set(0, 0, 0);
      this.character.setAimPose({ weight: 0 });
      this.character.setRidingPose(0, 0, 0);
      this.character.setDead(true);
    } else {
      this.character.playHit();
    }
    return outcome;
  }

  /**
   * "You have been to this camp." Called by bandits.js whenever the player is
   * within `BANDIT.campApproachRadius` of one. Stored, not acted on — the
   * decision of where to reappear belongs to `respawn()` alone.
   */
  markCamp(camp) {
    this._lastCamp = camp;
  }

  /**
   * THE respawn. A saved checkpoint (checkpoint.js — round 7) wins outright;
   * failing that, the spawn point or the last camp approached, whichever is
   * nearer to where you died. "At the camp" is a stand-off ring
   * `BANDIT.respawnStandoff` out on the town side, because taken literally it
   * drops you among the men who just killed you.
   */
  respawn() {
    let x = SPAWN.x;
    let z = SPAWN.z;
    let yaw = SPAWN.yaw;
    const cp = loadCheckpoint();
    const camp = this._lastCamp;
    if (cp) {
      ({ x, z, yaw } = cp);
    } else if (camp) {
      const toSpawn = Math.hypot(this.position.x - SPAWN.x, this.position.z - SPAWN.z);
      const toCamp = Math.hypot(this.position.x - camp.x, this.position.z - camp.z);
      if (toCamp < toSpawn) {
        // Stand off toward the town, which is also the way home.
        const dx = TOWN.centerX - camp.x;
        const dz = TOWN.centerZ - camp.z;
        const len = Math.max(1e-3, Math.hypot(dx, dz));
        x = camp.x + (dx / len) * BANDIT.respawnStandoff;
        z = camp.z + (dz / len) * BANDIT.respawnStandoff;
        yaw = Math.atan2(-(camp.x - x), -(camp.z - z)); // facing the camp
      }
    }
    this.position.set(x, 0, z);
    this.position.y = this.world.groundHeightAt(this.position.x, this.position.z);
    this.velocityXZ.set(0, 0, 0);
    this.velocityY = 0;
    this.grounded = true;
    this.meshYaw = yaw;
    this.health.reset();
    this.dead = false;
    this.deathTimer = 0;
    this.damageFlash = 0;
    this.character.setDead(false);
  }
}
