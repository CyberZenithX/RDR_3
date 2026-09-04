/**
 * bandit.js — one bandit's body: position, collider, health, rig, revolver,
 * and the firing path. The brain is bandit-ai.js; the camp that owns a group
 * of them is bandits.js.
 *
 * The split is horse.js/horse-ai.js's, exactly: this file integrates a heading
 * and a target speed through ONE movement path, so a patrolling bandit and a
 * charging one obey the same physics, the same collider contract and the same
 * boundary clamp.
 *
 * WHY A BANDIT DOES NOT USE combat.js. docs/ROADMAP.md asked for the decision
 * to be made before writing, not after: `Combat` is the *player's* revolver —
 * it resolves its aim point through `tpCamera`, drives camera recoil and shake,
 * feeds the crosshair and the ammo pips, and is at 350 of the 400-line cap. A
 * bandit has no camera and no HUD; what it shares with the player is the part
 * that was already generic — `weapons.js` (the revolver attaches to any
 * skeleton), `combat-ray.js` (the geometry query) and the pooled `vfx.js` /
 * `audio.js`. So this is its own ~40-line firing path over those, rather than
 * a `Combat` bent into a shape with a camera-shaped hole in it. ADR-028.
 *
 * The player is hit-tested as an explicit cylinder, the way targets.js tests a
 * bottle standing on a barrel lid, and NOT through the collider list — the
 * player registers no collider, and the horse's would swallow every round
 * aimed at a mounted rider.
 */

import * as THREE from 'three';
import { ANIM, TOWN, BOUNDARY } from './config.js';
import { BANDIT, HEALTH } from './config-ai.js';
import { COMBAT } from './config-combat.js';
import { addCircleCollider, removeCollider, resolveCollisions } from './collision.js';
import { makeHit, resetHit, raycastCylinder, raycastColliders, raycastTerrain } from './combat-ray.js';
import { Health } from './health.js';
import { BanditAI } from './bandit-ai.js';
import { fireAt } from './bandit-gun.js';

// Reused by every bandit, every frame — nothing in here allocates.
const _dir = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _diff = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

/** Duplicated from player.js per ADR-010 — ten lines, and the thresholds differ. */
function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/** Smooth 0→1→0, for the reload dip. Same shape combat.js uses. */
function bell(t) {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  const ramp = Math.min(1, Math.min(k, 1 - k) / 0.25);
  return ramp * ramp * (3 - 2 * ramp);
}

export class Bandit {
  /**
   * @param {object} deps character (a rig from character.js or a
   *   PlaceholderHuman), world, group (the Bandits that owns the shared ray
   *   ignore set and the effect pools), camp (its entry in CAMPS, plus a live
   *   `alive` count), x/z where it stands.
   */
  constructor({ character, world, group, camp, x, z }) {
    this.character = character;
    this.world = world;
    this.group = group;
    this.camp = camp;

    this.position = new THREE.Vector3(x, world.groundHeightAt(x, z), z);
    this.velocityXZ = new THREE.Vector3();
    this.speed = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.animState = 'idle';
    this.health = new Health(HEALTH.banditMax);

    // Registered ONCE and mutated in place every frame, per the collision
    // contract — never re-added. `top` stays the default Infinity: a character
    // is not something to be jumped over (docs/ROADMAP.md). Shots do not use
    // it either; bandits.js ray-tests its own bodies with an exact cylinder
    // and puts every one of these in the shared ignore set.
    this.collider = addCircleCollider(x, z, BANDIT.colliderRadius, { kind: 'bandit', bandit: this });

    this.ai = new BanditAI(this);
    this.ammo = BANDIT.magazine;
    this.reloading = false;
    this.reloadTimer = 0;
    this._fireTimer = Math.random() * BANDIT.fireInterval; // camps do not open fire in unison
    this._aimWeight = 0;
    this._aimT = 0;
    this._recoil = 0;
    this._staggerT = 0;
    this._losT = 0;
    this._losResult = false;

    this._hit = makeHit();
    this._los = makeHit();

    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw + BANDIT.meshYawOffset;
    // Pose once at construction so a bandit who is never within
    // BANDIT.activeRadius still stands in its idle pose rather than in the
    // GLB's bind T-pose.
    this.character.setLocomotion('idle', 0, false);
    this.character.update(0);
  }

  get alive() {
    return !this.health.dead;
  }

  /** World Y of this bandit's chest — where it aims from, and is aimed at. */
  get chestY() {
    return this.position.y + BANDIT.chestHeight;
  }

  /**
   * Can this bandit see the player? Cached for `BANDIT.losInterval`: this is
   * two raycasts, eleven bandits run it, and nobody steps behind a rock in
   * 140ms.
   */
  hasLineOfSight(player) {
    if (this._losT > 0) return this._losResult;
    this._losT = BANDIT.losInterval;
    _from.set(this.position.x, this.chestY, this.position.z);
    _to.set(player.position.x, player.position.y + BANDIT.chestHeight, player.position.z);
    _dir.subVectors(_to, _from);
    const dist = _dir.length();
    if (dist < 1e-3) return (this._losResult = true);
    _dir.divideScalar(dist);
    // A hit short of the target is something standing in the way. The small
    // slack stops the player's own near-surface from counting as cover.
    resetHit(this._los);
    raycastColliders(_from, _dir, dist, this.group.rayIgnore, this._los);
    if (this._los.hit && this._los.distance < dist - 0.25) return (this._losResult = false);
    resetHit(this._los);
    raycastTerrain(_from, _dir, dist, this._los);
    this._losResult = !(this._los.hit && this._los.distance < dist - 0.25);
    return this._losResult;
  }

  /**
   * Takes a hit. Returns 'dead' | 'hit' | null, the same three-way answer
   * `Health` gives, so the caller can pick an effect without tracking state.
   */
  damage(amount, fromX, fromZ) {
    const outcome = this.health.damage(amount);
    if (!outcome) return null;
    // Being shot at from somewhere you weren't looking is how a fight starts.
    if (fromX !== undefined) this.ai.alert(fromX, fromZ);
    if (outcome === 'dead') {
      this._die();
      return 'dead';
    }
    this._staggerT = this.character.playHit() || HEALTH.hitStagger;
    return 'hit';
  }

  _die() {
    // How long the body is still worth animating. bandits.js drives everything
    // after that — freeze, linger, sink — see BANDIT.corpseLinger.
    this.deathClipT = (this.character.setDead(true) || 0) + BANDIT.corpseFreezeGrace;
    this.corpseT = 0;
    this.retired = false;
    this.group?.addCorpse?.(this);
    this.character.setAimPose({ weight: 0 });
    this._aimWeight = 0;
    this.velocityXZ.set(0, 0, 0);
    this.speed = 0;
    this.ai.state = 'dead';
    this.camp.alive = Math.max(0, this.camp.alive - 1);
    // A body stops blocking the road. Removing a collider is a real operation
    // (targets.js established it); the group's ray-ignore Set keeps holding
    // this reference harmlessly, since a Set membership test on a collider
    // that is no longer in the array simply never matches.
    if (this.collider) {
      removeCollider(this.collider);
      this.collider = null;
    }
    // Settle onto the terrain: the Death clip lays the body down relative to
    // the root, so the root itself just has to be on the ground.
    this.position.y = this.world.groundHeightAt(this.position.x, this.position.z);
    this.character.root.position.copy(this.position);
  }

  /** Called by bandits.js each frame for bandits inside BANDIT.activeRadius. */
  update(dt, player) {
    this._losT = Math.max(0, this._losT - dt);
    if (!this.alive) {
      // The clip still has to play out and clamp — but only that long. Past it
      // the pose never changes again, so going on posing a whole skeleton every
      // frame buys nothing. `corpseT` is advanced by bandits.js, not here, so
      // that a body left behind still ages while the player is far away.
      if (this.corpseT <= this.deathClipT) this.character.update(dt);
      return;
    }

    if (this._staggerT > 0) this._staggerT -= dt;
    const staggered = this._staggerT > 0;

    const targetSpeed = staggered ? 0 : this.ai.update(dt, player, _dir);
    this._move(dt, _dir, targetSpeed);
    this._face(dt, _dir, player, staggered);
    this._weapon(dt, player, staggered);
    this._pose(dt, player);
  }

  /** One movement path for every state — see the file header. */
  _move(dt, dir, targetSpeed) {
    _desired.copy(dir).multiplyScalar(targetSpeed);
    const accelerating = targetSpeed > this.velocityXZ.length();
    const rate = accelerating ? BANDIT.acceleration : BANDIT.deceleration;
    _diff.copy(_desired).sub(this.velocityXZ);
    const maxDelta = rate * dt;
    if (_diff.length() > maxDelta) _diff.setLength(maxDelta);
    this.velocityXZ.add(_diff);

    this.position.x += this.velocityXZ.x * dt;
    this.position.z += this.velocityXZ.z * dt;

    resolveCollisions(this.position, BANDIT.radius, this.collider);
    const distFromCenter = Math.hypot(this.position.x - TOWN.centerX, this.position.z - TOWN.centerZ);
    if (distFromCenter > BOUNDARY.playerLimit) {
      const scale = BOUNDARY.playerLimit / distFromCenter;
      this.position.x = TOWN.centerX + (this.position.x - TOWN.centerX) * scale;
      this.position.z = TOWN.centerZ + (this.position.z - TOWN.centerZ) * scale;
    }
    // Bandits never leave the ground, so grounding is a snap rather than the
    // gravity/coyote-time machinery player.js needs.
    this.position.y = this.world.groundHeightAt(this.position.x, this.position.z);
    this.speed = this.velocityXZ.length();
    if (this.collider) {
      this.collider.x = this.position.x;
      this.collider.z = this.position.z;
    }
  }

  _face(dt, dir, player, staggered) {
    let targetYaw = null;
    let rate = BANDIT.turnRate;
    if (!staggered && this.ai.facePlayer) {
      targetYaw = Math.atan2(-(player.position.x - this.position.x), -(player.position.z - this.position.z));
      rate = BANDIT.aimTurnRate;
    } else if (dir.lengthSq() > 1e-4 && this.speed > ANIM.idleThreshold) {
      targetYaw = Math.atan2(-dir.x, -dir.z);
    }
    if (targetYaw !== null) this.yaw = lerpAngle(this.yaw, targetYaw, Math.min(1, rate * dt));
  }

  /** Aim blend, cooldown, reload, and the trigger. */
  _weapon(dt, player, staggered) {
    this._recoil = Math.max(0, this._recoil - this._recoil * (1 - Math.exp(-COMBAT.recoilRecover * dt)) - 1e-4);
    this._fireTimer = Math.max(0, this._fireTimer - dt);

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.reloadTimer = 0;
        this.ammo = BANDIT.magazine;
      }
    }

    const wants = this.ai.wantsToShoot && !staggered && this.character.weapon;
    const target = wants || this.reloading ? 1 : 0;
    this._aimWeight += (target - this._aimWeight) * (1 - Math.exp(-BANDIT.turnRate * dt));
    this._aimT = wants ? this._aimT + dt : 0;

    if (!wants || this.reloading) return;
    if (this._aimT < BANDIT.aimSettleTime || this._fireTimer > 0) return;
    if (this.ammo <= 0) {
      this.reloading = true;
      this.reloadTimer = BANDIT.reloadTime;
      this.group.audio?.play('reload', this.position);
      return;
    }
    fireAt(this, player);
  }


  /** Drives the rig: gait, the aiming layer, and the transform. */
  _pose(dt, player) {
    const aiming = this._aimWeight > 0.02;
    if (this.speed < ANIM.idleThreshold) this.animState = 'idle';
    else if (this.speed > ANIM.runThreshold) this.animState = 'run';
    else this.animState = 'walk';

    this.character.setLocomotion(this.animState, this.speed, aiming);
    this.character.setAirborne(false);
    this.character.setRidingPose(0, 0, 0);
    // Elevation is the angle from the bandit's chest up to the player's, which
    // is what the crosshair's pitch is for the player's own aim pose.
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const flat = Math.hypot(dx, dz);
    const elevation = Math.atan2((player.position.y + BANDIT.chestHeight) - this.chestY, Math.max(0.2, flat));
    this.character.setAimPose({
      weight: this._aimWeight,
      elevation,
      recoil: this._recoil,
      reload: this.reloading ? bell(1 - this.reloadTimer / BANDIT.reloadTime) : 0,
      support: 1,
    });
    this.character.update(dt);

    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw + BANDIT.meshYawOffset;
  }
}
