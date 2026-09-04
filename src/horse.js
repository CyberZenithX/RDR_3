/**
 * horse.js — the horse's position/movement/AI/mount state, the counterpart
 * to player.js. Owns the horse's THREE.Vector3 position and a circle
 * collider that stays registered in collision.js for the horse's whole
 * lifetime (position mutated in place each frame, never re-added/removed).
 *
 * Three movement modes, chosen each frame by `this.mounted` and whether the
 * rider is aiming:
 *  - unmounted: a small wander/follow/whistle AI (horse-ai.js)
 *  - mounted: WASD steering read directly from input.js, same
 *    camera-relative convention player.js uses, gallop gated by stamina.
 *  - mounted and aiming: A/D become a direct yaw rate and W/S drop out
 *    entirely — see `_updateMountedAiming`, and BUILD-PLAN.md's round 3.
 *
 * Mount/dismount has no animation clip (per BUILD-PLAN.md's fake table): a
 * mount eases onto the saddle over HORSE.mountLerpTime, a dismount is instant,
 * and main.js copies `getSaddleTransform()` onto the Player every mounted
 * frame. Three neighbours own the rest of the animal, all split out under the
 * 400-line cap — horse-jump.js the vertical axis, horse-seat.js where the rider
 * sits, horse-ai.js what it does when nobody is on it. Semantics and the
 * measured invariants: docs/HORSE.md.
 *
 * No vectors are allocated inside update() — everything reusable is an
 * instance scratch object, per the performance budget rule.
 */

import * as THREE from 'three';
import { TOWN, BOUNDARY, SPAWN } from './config.js';
import { HORSE, HORSE_ANIM } from './config-horse.js';
import { HEALTH } from './config-ai.js';
import { Health } from './health.js';
import { isKeyDown, isPointerLocked } from './input.js';
import { addCircleCollider, resolveCollisions } from './collision.js';
import { HorseJump } from './horse-jump.js';
import { HorseSeat } from './horse-seat.js';
import { HorseAI } from './horse-ai.js';

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

    // Riderless-only, and it never kills — see HEALTH.horseMax. The bolt it
    // triggers is unmounted behaviour, so horse-ai.js owns it.
    this.health = new Health(HEALTH.horseMax);

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

    this.riderPitch = 0; // radians the rider leans forward, eased in with speed
    this.jump = new HorseJump(this); // owns position.y — see horse-jump.js
    this.seat = new HorseSeat(this); // owns where the rider sits — see horse-seat.js
    this.ai = new HorseAI(this); // owns the unmounted wander/follow/whistle — see horse-ai.js

    character.root.position.copy(this.position);
    character.root.rotation.y = this.yaw + HORSE.meshYawOffset;
    // 'YXZ' so the bank is about the horse's own longitudinal axis and the jump
    // pitch about its own lateral one, whichever way it faces. Under the default
    // 'XYZ' the pitch is a world-X rotation, which tips an eastbound horse over.
    character.root.rotation.order = 'YXZ';
    this.seat.captureRest();
  }

  /**
   * Stamina as a 0..1 fraction of the tank, which is what the UI bar wants.
   * `ui.js` is generic and knows nothing about horses, so the normalisation
   * lives here with the number it normalises against rather than as a hardcoded
   * assumption that `HORSE.staminaMax` is 1 — which is what broke when it wasn't.
   */
  get staminaFraction() {
    return HORSE.staminaMax > 0 ? this.stamina / HORSE.staminaMax : 0;
  }

  /** Called on an H-key press (edge-detected here, not by the caller). */
  _handleWhistle() {
    // A bolting horse does not come when called.
    if (!this.mounted && !this.spooked) this.ai.whistle();
  }

  /** True while the horse is running from something and will not be caught. */
  get spooked() {
    return this.ai.spooked;
  }

  /**
   * A round landing on a riderless horse. Returns 'spooked' | 'hit' | null,
   * the same three-way shape Bandits.hit() uses. Refuses outright while
   * mounted — see HEALTH.horseMax for why that matters.
   */
  damage(amount, fromX, fromZ) {
    if (this.mounted || this.spooked) return null;
    const outcome = this.health.damage(amount);
    if (!this.health.dead) return outcome ? 'hit' : null;
    this.health.reset();
    this.ai.spook(fromX, fromZ);
    return 'spooked';
  }

  /** Straight-line distance from the horse to a world XZ point. */
  _distanceTo(pos) {
    return Math.hypot(this.position.x - pos.x, this.position.z - pos.z);
  }

  /**
   * "Currently at a gallop", which is NOT the same signal as
   * `staminaExhausted` — combat.js gates the reload on this, and confusing the
   * two is called out in docs/ROADMAP.md. Reads the gait the animation state
   * machine settled on, hysteresis and all, rather than re-deriving it from a
   * raw speed that chatters across the threshold.
   */
  get isGalloping() {
    return this.animState === 'gallop';
  }

  /**
   * @param {boolean} aiming whether the rider currently has the gun up. Passed
   *   IN by main.js rather than read from combat state here — horse.js has no
   *   awareness of combat and docs/ROADMAP.md asked for the coupling to be one
   *   deliberate flag rather than a new file reaching into private fields.
   */
  update(dt, camera, player, aiming = false) {
    const hDown = isPointerLocked() && isKeyDown('KeyH');
    if (hDown && !this._prevHDown) this._handleWhistle();
    this._prevHDown = hDown;

    const eDown = isPointerLocked() && isKeyDown('KeyE');
    if (eDown && !this._prevEDown) this.handleMountToggle(player);
    this._prevEDown = eDown;

    if (this.mounted) {
      if (aiming) this._updateMountedAiming(dt);
      else this._updateMounted(dt, camera);
    } else {
      this._updateUnmounted(dt, player);
    }

    this._updateStamina(dt);

    // Anything whose top is under the horse's belly is skipped while it is in
    // the air — that, plus the `top` props now record, is the whole of "the
    // horse can jump over it". On the ground the clearance is -Infinity and
    // the collision list is honoured in full, exactly as before.
    resolveCollisions(this.position, HORSE.colliderRadius, this.collider, this.jump.clearance());
    const distFromCenter = Math.hypot(this.position.x - TOWN.centerX, this.position.z - TOWN.centerZ);
    if (distFromCenter > BOUNDARY.playerLimit) {
      const scale = BOUNDARY.playerLimit / distFromCenter;
      this.position.x = TOWN.centerX + (this.position.x - TOWN.centerX) * scale;
      this.position.z = TOWN.centerZ + (this.position.z - TOWN.centerZ) * scale;
    }
    // Vertical last, against the terrain under wherever the horse ended up.
    this.jump.update(dt, this.world.groundHeightAt(this.position.x, this.position.z));
    this.collider.x = this.position.x;
    this.collider.z = this.position.z;

    if (this._mountBlendT < HORSE.mountLerpTime) this._mountBlendT += dt;

    // While airborne the one-shot jump clip owns the rig and setLocomotion
    // stands aside; animState still tracks the gait underneath so the landing
    // fades straight back into it.
    this.animState = classifyHorseSpeed(this.speed, this.animState);
    this.character.setAirborne(this.jump.airborne, this.jump.airTime);
    this.character.setLocomotion(this.animState, this.speed);
    this.character.update(dt);

    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw + HORSE.meshYawOffset;
    this.character.root.rotation.x = this.jump.pitch; // order is 'YXZ' — see the constructor
    this.character.root.rotation.z = this.lean;

    // After the transform above, so the bone sample reflects this frame's pose
    // rather than last frame's.
    this.seat.sample(this.jump.airborne);

    // How far forward the rider carries themselves — eased rather than snapped,
    // so breaking into a gallop leans them in over a few frames.
    const gallopFraction = THREE.MathUtils.clamp(this.speed / HORSE.gallopSpeed, 0, 1);
    this.riderPitch += (gallopFraction * HORSE.riderGallopPitch - this.riderPitch)
      * (1 - Math.exp(-HORSE.riderPitchRate * dt));
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

  /**
   * Steering while the rider is aiming. BUILD-PLAN.md: "the horse keeps
   * steering with A/D, aim and fire work as normal" — so W/S and the gallop
   * are dropped, and A/D become a direct yaw rate rather than a
   * camera-relative direction.
   *
   * That change of meaning is the point. Unaimed steering points the horse
   * wherever the camera is looking, which is exactly wrong here: while aiming,
   * the camera IS the gun, and having the horse chase it would make it
   * impossible to look at anything you were not also riding at. Reining left
   * or right while the barrel tracks independently is the whole feel of
   * shooting from horseback.
   */
  _updateMountedAiming(dt) {
    const inputActive = isPointerLocked();
    const turn = inputActive ? (isKeyDown('KeyA') ? 1 : 0) - (isKeyDown('KeyD') ? 1 : 0) : 0;

    const prevYaw = this.yaw;
    this.yaw += turn * HORSE.aimTurnRate * dt;

    // Keep the pace it had, eased down to the aiming cap. A horse under a
    // rider who has just drawn does not stop dead, and it does not gallop.
    const capped = Math.min(this.speed, HORSE.aimMaxSpeed);
    const target = capped * Math.exp(-HORSE.aimSpeedDecay * dt);
    this._moveDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._integrateMovement(dt, target);
    this._isDrainingStamina = false;

    // Lean comes from the same yaw-rate maths the normal path uses, but the
    // yaw was already written above, so this must not turn again — hence the
    // explicit prevYaw rather than a call to _turnToward().
    let yawDelta = ((this.yaw - prevYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    const yawRate = dt > 0 ? yawDelta / dt : 0;
    const desiredLean = THREE.MathUtils.clamp(-yawRate * HORSE.leanFactor, -HORSE.leanMax, HORSE.leanMax);
    this.lean += (desiredLean - this.lean) * (1 - Math.exp(-HORSE.leanDamping * dt));
  }

  /**
   * Unmounted movement. The decision (where to go, how fast) is horse-ai.js's;
   * the integration, turning and lean are the same ones the mounted path uses,
   * which is what stops the two drifting apart.
   */
  _updateUnmounted(dt, player) {
    this._isDrainingStamina = false;
    const targetSpeed = this.ai.update(dt, player, this._moveDir);
    this._integrateMovement(dt, targetSpeed);
    this._turnToward(dt, targetSpeed > 0);
  }

  /** Where the hitching rail is; the public entry point, per ADR-011. Null un-hitches. */
  setHitchPost(point) {
    this.ai.setHitchPost(point);
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
    } else if (!this.mounted && this.ai.holdYaw !== null) {
      // Standing at the hitching rail: settle onto the yaw a hitched horse stands
      // at rather than whatever heading it arrived on. Guarded on `mounted` —
      // horse-ai.js does not run with a rider up, so holdYaw would be stale.
      this.yaw = lerpAngle(this.yaw, this.ai.holdYaw, Math.min(1, HORSE.turnRate * 0.4 * dt));
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
   * docs/TESTING.md and the "mount attaches..." check in smoke.mjs.
   */
  handleMountToggle(player) {
    if (this.mounted) {
      // Stepping off mid-jump would drop the rider through the arc onto the
      // ground the instant they let go. Ignore it; they land in a moment.
      if (this.jump.airborne) return;
      this._dismount(player);
    } else if (HORSE.spookMountBlock && this.spooked) {
      // Bolting. It will not stand to be mounted until it settles.
    } else if (this._distanceTo(player.position) <= HORSE.mountRange) {
      this._premountPos.copy(player.position);
      this._premountYaw = player.meshYaw;
      this._mountBlendT = 0;
      this.mounted = true;
      this.jump.reset(); // Space is the player's own jump on foot — don't inherit a stale press
      player.mount();
    }
  }

  /**
   * Jump. Public for the same reason handleMountToggle is: scripts/smoke.mjs
   * needs to exercise it without the trusted pointer-locked keypress headless
   * chromium cannot produce. In real play horse-jump.js reads Space itself.
   */
  handleJump() {
    this.jump.request();
  }

  _dismount(player) {
    this.mounted = false;
    this.jump.reset();
    const sideX = Math.cos(this.yaw + Math.PI / 2);
    const sideZ = Math.sin(this.yaw + Math.PI / 2);
    const x = this.position.x + sideX * HORSE.dismountDistance;
    const z = this.position.z + sideZ * HORSE.dismountDistance;
    const y = this.world.groundHeightAt(x, z);
    player.dismount(x, y, z, this.yaw);
  }

  /**
   * Everything the rider needs to sit on this horse this frame — position,
   * facing, mount blend, bank, pitch, gait sway and jump weight. The whole
   * computation lives in horse-seat.js; this stays here as the public entry
   * point main.js and scripts/smoke.mjs already call.
   */
  getSaddleTransform(outPos) {
    return this.seat.transform(outPos);
  }
}
