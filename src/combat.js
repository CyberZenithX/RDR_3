/**
 * combat.js — the revolver's state machine: aim, fire, reload, ammo, and what
 * a shot actually hits. The gun object itself is weapons.js, the geometry
 * query is combat-ray.js, the effects are vfx.js — all three split out under
 * BUILD-PLAN.md's 400-line cap.
 *
 * THE FRAME IS SPLIT IN TWO, AND THE SPLIT IS LOAD-BEARING:
 *
 *   pollInput(dt)  runs FIRST, before horse.update(), because the horse has to
 *                  know whether the rider is aiming before it decides how to
 *                  steer (BUILD-PLAN.md: "the horse keeps steering with A/D"
 *                  while aiming). It reads the mouse and R, moves the aim
 *                  blend, and ticks the reload/cooldown timers. It does NOT
 *                  fire.
 *   update(dt)     runs LAST, after player.update() has posed the rig for this
 *                  frame, because the shot starts at the muzzle empty and the
 *                  muzzle is on the end of a barrel held by a hand that only
 *                  just finished moving. Firing in pollInput() would aim every
 *                  shot from where the hand was last frame.
 *
 * See docs/ARCHITECTURE.md's per-frame order, which this extends.
 *
 * Nothing here reaches into horse.js's internals: the coupling is one `aiming`
 * flag passed *in* to horse.update(), which is what docs/ROADMAP.md asked for.
 */

import * as THREE from 'three';
import { COMBAT, AIM_POSE } from './config-combat.js';
import { HORSE } from './config-horse.js';
import { isKeyDown, isPointerLocked, isMouseDown } from './input.js';
import { makeHit, resetHit, raycastColliders, raycastTerrain } from './combat-ray.js';

// Reused every frame and every shot — nothing in here allocates.
const _muzzlePos = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _end = new THREE.Vector3();
const _side = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _right = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

/** Smooth 0→1→0 over [0,1], so the reload dip eases in and back out. */
function bell(t) {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  const ramp = Math.min(1, Math.min(k, 1 - k) / 0.25);
  return ramp * ramp * (3 - 2 * ramp);
}

export class Combat {
  /**
   * @param {object} deps player, horse, camera (the PerspectiveCamera),
   *   tpCamera, world, targets, vfx, audio — and `weapon`, the Revolver
   *   already attached to the player's hand. A **missing** weapon is
   *   tolerated: the gun simply never fires, rather than throwing. Both rigs
   *   are armed today, so this is a floor against a future one that is not —
   *   BUILD-PLAN.md's "keep the game fully playable" rule applies to every
   *   round, and an unarmed rig took the whole boot down once already.
   */
  constructor({ player, horse, camera, tpCamera, world, targets, bandits, townsfolk, vfx, audio, weapon }) {
    this.player = player;
    this.horse = horse;
    this.camera = camera;
    this.tpCamera = tpCamera;
    this.world = world;
    this.targets = targets;
    this.bandits = bandits;
    this.townsfolk = townsfolk;
    this.vfx = vfx;
    this.audio = audio;
    this.weapon = weapon;

    this.ammo = COMBAT.magazine;
    this.aiming = false;
    this.aimWeight = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.recoil = 0;
    this.shotsFired = 0;
    this.lastHit = null; // the last shot's hit record, for smoke.mjs

    this._cooldown = 0;
    this._pendingShots = 0;
    this._prevReloadDown = false;
    this._shellsDropped = false;
    this._aimOverride = null; // see setAimOverride()

    // The horse is never shot: while mounted the muzzle sits inside its own
    // collider circle, so every shot would hit the animal being ridden. A Set
    // rather than a single reference because round 4's bandits will want to
    // exclude themselves from their own fire the same way.
    this._ignore = new Set();
    if (horse?.collider) this._ignore.add(horse.collider);
    // ...and every bandit's, for a second reason: a bandit's movement collider
    // is `top: Infinity` by the collision contract, so a shot passing well over
    // one would "hit" it. `bandits.raycast()` tests an exact foot-to-head
    // cylinder instead and runs first — see bandits.js's header.
    if (bandits?.rayIgnore) for (const col of bandits.rayIgnore) this._ignore.add(col);
    // ...and round 5's townsfolk, for exactly the same reason: a citizen's
    // movement collider is `top: Infinity` too, so a shot down the street well
    // over someone's hat would "hit" them. `townsfolk.raycast()` tests the same
    // foot-to-head cylinder bandits.js does.
    if (townsfolk?.rayIgnore) for (const col of townsfolk.rayIgnore) this._ignore.add(col);

    this._hit = makeHit();
    this._aimHit = makeHit();
  }

  /** Ammo as a 0..1 fraction, for anything that wants a bar rather than a count. */
  get ammoFraction() {
    return COMBAT.magazine > 0 ? this.ammo / COMBAT.magazine : 0;
  }

  /** 0..1 through the reload lockout; 0 when not reloading. */
  get reloadProgress() {
    return this.reloading ? 1 - this.reloadTimer / COMBAT.reloadTime : 0;
  }

  /**
   * Whether pulling the trigger right now would produce a shot. The exact
   * condition `tryFire()` checks, exposed so a caller can wait for it rather
   * than poll a refusal — round 4's bandits will want it, and smoke.mjs needs
   * it because a shot leaves COMBAT.fireInterval of cooldown behind that the
   * next check would otherwise race.
   */
  get canFire() {
    if (this.player.dead) return false;
    return !!this.weapon && !this.reloading && this._cooldown <= 0 && this.ammo > 0;
  }

  /**
   * Whether a reload would be accepted right now. Gated on the horse's GAIT,
   * not its stamina — `staminaExhausted` is a different signal entirely, and
   * confusing the two is called out in docs/ROADMAP.md. Also refused in
   * mid-air: both hands are busy staying on a jumping horse.
   */
  get canReload() {
    if (this.player.dead) return false;
    if (this.reloading || this.ammo >= COMBAT.magazine) return false;
    if (this.player.mounted && this.horse?.isGalloping) return false;
    if (this.player.mounted && this.horse?.jump?.airborne) return false;
    return true;
  }

  /**
   * Forces the aim state on or off, or hands it back to the mouse with
   * `null`. Public for exactly the reason horse.handleMountToggle is: headless
   * chromium cannot produce the trusted, pointer-locked mouse button the real
   * path reads, and docs/TESTING.md's rule 4 asks for a public entry point
   * rather than a test reaching into private fields.
   */
  setAimOverride(value) {
    this._aimOverride = value;
  }

  /** Public, like horse.handleMountToggle — smoke.mjs fires without a trusted mouse event. */
  tryFire() {
    if (!this.canFire) return false;
    this._pendingShots = 1;
    return true;
  }

  /** Public for the same reason tryFire is. Returns false if the reload was refused. */
  tryReload() {
    if (!this.weapon || !this.canReload) return false;
    this.reloading = true;
    this.reloadTimer = COMBAT.reloadTime;
    this._shellsDropped = false;
    this.audio?.play('reload', this._playerEarPosition());
    return true;
  }

  _playerEarPosition() {
    return this.player.position;
  }

  /**
   * First half of the frame: input, blends and timers. Must run BEFORE
   * horse.update() — see the file header.
   */
  pollInput(dt) {
    const active = isPointerLocked();
    this.aiming = this._aimOverride === null ? (active && isMouseDown(2)) : !!this._aimOverride;

    const target = this.aiming ? 1 : 0;
    this.aimWeight += (target - this.aimWeight) * (1 - Math.exp(-AIM_POSE.blendRate * dt));

    this._cooldown = Math.max(0, this._cooldown - dt);
    this.recoil = Math.max(0, this.recoil - this.recoil * (1 - Math.exp(-COMBAT.recoilRecover * dt)) - 1e-4);

    const reloadDown = active && isKeyDown('KeyR');
    if (reloadDown && !this._prevReloadDown) this.tryReload();
    this._prevReloadDown = reloadDown;

    if (this.reloading) {
      this.reloadTimer -= dt;
      // Brass hits the dirt at the bottom of the dip, not at the start of it.
      if (!this._shellsDropped && this.reloadProgress >= 0.45) {
        this._shellsDropped = true;
        this._ejectShells();
      }
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.reloadTimer = 0;
        this.ammo = COMBAT.magazine;
      }
    } else if (active && this.canFire && isMouseDown(0)) {
      // Held fire at the configured interval — fanning the hammer. The gun
      // cannot outrun COMBAT.fireInterval however fast the mouse is clicked.
      this._pendingShots = 1;
    }
  }

  /**
   * The pose parameters character.js hands to aim-pose.js this frame. Read by
   * player.js, which owns the call — the same shape setRidingPose already has.
   */
  poseState() {
    return {
      weight: this.aimWeight,
      elevation: -this.tpCamera.pitch, // camera pitch is positive looking DOWN
      recoil: this.recoil,
      reload: this.reloading ? bell(this.reloadProgress) : 0,
      // While mounted the left hand keeps the reins, so the support arm is not
      // available. This is the whole of the mounted/on-foot pose difference.
      support: this.player.mounted ? 0 : 1,
    };
  }

  /**
   * Second half of the frame: resolve any shot queued this frame, now that the
   * rig is posed and the muzzle is where it will be rendered.
   */
  update(dt) {
    this.vfx?.update(dt);
    if (this._pendingShots <= 0) return;
    this._pendingShots = 0;
    this._fire();
  }

  _fire() {
    this.ammo--;
    this.shotsFired++;
    this._cooldown = COMBAT.fireInterval;
    this.recoil = COMBAT.recoilPoseKick;

    // The muzzle's world matrix is only current once the skeleton above it has
    // been refreshed — the renderer does not do that until render time.
    this.weapon.syncWorld();
    this.weapon.muzzleWorldPosition(_muzzlePos);

    this._resolveAimPoint();
    _dir.subVectors(_aimPoint, _muzzlePos);
    if (_dir.lengthSq() < 1e-8) this.tpCamera.getForward(_dir);
    _dir.normalize();
    this._applySpread(_dir);

    resetHit(this._hit);
    this.targets?.raycast(_muzzlePos, _dir, COMBAT.range, this._hit);
    this.bandits?.raycast(_muzzlePos, _dir, COMBAT.range, this._hit);
    this.townsfolk?.raycast(_muzzlePos, _dir, COMBAT.range, this._hit);
    raycastColliders(_muzzlePos, _dir, COMBAT.range, this._ignore, this._hit);
    raycastTerrain(_muzzlePos, _dir, COMBAT.range, this._hit);

    if (this._hit.hit) {
      _end.copy(this._hit.point);
    } else {
      _end.copy(_muzzlePos).addScaledVector(_dir, COMBAT.range);
    }
    this.vfx?.fire(_muzzlePos, _end);
    this.audio?.play('gunshot', _muzzlePos);
    this.tpCamera.addRecoil(COMBAT.recoilPitchKick, COMBAT.recoilShake);
    // A camp that is picked apart one man at a time while the rest stand
    // around reads as broken, so a shot is heard, not just seen.
    this.bandits?.hearShot(_muzzlePos.x, _muzzlePos.z);
    // A street of citizens who ignore gunfire reads as broken the same way a
    // camp that ignores it does. They run rather than fight.
    this.townsfolk?.hearShot(_muzzlePos.x, _muzzlePos.z);

    if (this._hit.hit) {
      const groundY = this.world.groundHeightAt(this._hit.point.x, this._hit.point.z);
      this.vfx?.impact(this._hit.point, this._hit.normal, groundY);
      this.audio?.play('hit', this._hit.point);
      let outcome = null;
      if (this._hit.kind === 'bandit') outcome = this.bandits?.hit(this._hit.ref, _muzzlePos.x, _muzzlePos.z) ?? null;
      else if (this._hit.kind === 'townsfolk') outcome = this.townsfolk?.hit(this._hit.ref, _muzzlePos.x, _muzzlePos.z) ?? null;
      else outcome = this.targets?.hit(this._hit.ref) ?? null;
      if (outcome === 'destroyed') {
        this.vfx?.burst(this._hit.point, this._hit.kind === 'bottle' ? 0x2f5e3a : 0x6d4a2a, groundY);
      }
      this.lastHit = {
        kind: this._hit.kind, distance: this._hit.distance, outcome,
        point: { x: this._hit.point.x, y: this._hit.point.y, z: this._hit.point.z },
      };
    } else {
      this.lastHit = { kind: null, distance: Infinity, outcome: null, point: null };
    }
  }

  /**
   * Where the crosshair is pointing, in the world. The shot then travels from
   * the MUZZLE to that point — which is what makes a gun held off to one side
   * still hit what the middle of the screen is on, without the raycast ever
   * originating at the camera (BUILD-PLAN.md is explicit about that, and
   * smoke.mjs checks it).
   */
  _resolveAimPoint() {
    this.camera.getWorldPosition(_camPos);
    this.camera.getWorldDirection(_camDir);
    resetHit(this._aimHit);
    this.targets?.raycast(_camPos, _camDir, COMBAT.range, this._aimHit);
    this.bandits?.raycast(_camPos, _camDir, COMBAT.range, this._aimHit);
    this.townsfolk?.raycast(_camPos, _camDir, COMBAT.range, this._aimHit);
    raycastColliders(_camPos, _camDir, COMBAT.range, this._ignore, this._aimHit);
    raycastTerrain(_camPos, _camDir, COMBAT.range, this._aimHit);
    if (this._aimHit.hit) _aimPoint.copy(this._aimHit.point);
    else _aimPoint.copy(_camPos).addScaledVector(_camDir, COMBAT.range);
  }

  /** Scatters `dir` into a random cone. Mutates in place. */
  _applySpread(dir) {
    const spread = this.currentSpread;
    if (spread <= 0) return;
    // An orthonormal basis about the shot. World up is a fine seed unless the
    // shot is near-vertical, in which case any other axis will do.
    _side.crossVectors(dir, _worldUp);
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
    _side.normalize();
    _perp.crossVectors(dir, _side).normalize();
    const angle = Math.random() * Math.PI * 2;
    // sqrt keeps the scatter uniform over the disc instead of clustering at
    // the middle, which is what makes a spread cone feel like a cone.
    const radius = Math.tan(spread) * Math.sqrt(Math.random());
    dir.addScaledVector(_side, Math.cos(angle) * radius)
      .addScaledVector(_perp, Math.sin(angle) * radius)
      .normalize();
  }

  /**
   * Half-angle of this shot's cone. Aiming is the big lever; riding and being
   * airborne stack multipliers on top, and both of those live in
   * config-horse.js because they are properties of the horse, not the gun
   * (ADR-009).
   */
  get currentSpread() {
    let spread = this.aiming ? COMBAT.spreadAim : COMBAT.spreadHip;
    if (this.player.mounted) {
      spread *= HORSE.mountedAccuracyPenalty;
      if (this.horse?.jump?.airborne) spread *= HORSE.jumpAccuracyPenalty;
    }
    return spread;
  }

  /** Six pieces of brass, thrown out to the gun side and down. */
  _ejectShells() {
    if (!this.weapon) return;
    this.weapon.syncWorld();
    this.weapon.muzzleWorldPosition(_muzzlePos);
    // Out to the shooter's right, away from the body.
    this.tpCamera.getRight(_right);
    const groundY = this.world.groundHeightAt(_muzzlePos.x, _muzzlePos.z);
    this.vfx?.ejectShells(_muzzlePos, _right, COMBAT.magazine, groundY);
  }
}
