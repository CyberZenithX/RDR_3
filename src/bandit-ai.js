/**
 * bandit-ai.js — the bandit brain: BUILD-PLAN.md's
 * `patrol → alert → chase → takeCover → shoot → flee → dead` state machine,
 * the steering-based obstacle avoidance that stands in for a navmesh, and the
 * stuck detector that steering alone needs.
 *
 * Split from bandit.js along exactly the seam horse-ai.js was cut on, and for
 * the same reason: **this owns no position and no velocity.** It decides a
 * heading, a target speed, whether to face the player, and whether to pull the
 * trigger. bandit.js integrates all of that through one movement path, which
 * is what keeps a chasing bandit and a patrolling one from drifting into two
 * different physics.
 *
 * BUILD-PLAN.md, verbatim, on what this may NOT be: "No navmesh, no A*. That
 * is a whole round of work and we are not spending it. … Accept that they will
 * still look dumb in tight spaces. Do not try to fix that in this round."
 * Three forward rays and a sidestep timer is the whole of it.
 */

import * as THREE from 'three';
import { BANDIT } from './config-ai.js';
import { colliders } from './collision.js';
import { makeHit, resetHit, raycastColliders } from './combat-ray.js';

// Reused every frame by every bandit — nothing in here allocates.
const _toPlayer = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _side = new THREE.Vector3();
const _away = new THREE.Vector3();
const _origin = new THREE.Vector3();

/** Rotates an XZ vector in place. */
function rotateXZ(v, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const x = v.x * c - v.z * s;
  const z = v.x * s + v.z * c;
  v.x = x;
  v.z = z;
  return v;
}

export class BanditAI {
  /** @param {import('./bandit.js').Bandit} bandit the body this brain steers */
  constructor(bandit) {
    this.bandit = bandit;
    this.state = 'patrol';
    this.alerted = false;
    this.canSee = false;
    this.wantsToShoot = false;
    this.facePlayer = false;

    this.lastSeen = new THREE.Vector3().copy(bandit.position);
    this.memory = 0; // seconds of "I still know roughly where you are" left
    this.alertTimer = 0;

    this.anchor = new THREE.Vector3().copy(bandit.position); // what patrol orbits
    this.patrolTarget = new THREE.Vector3().copy(bandit.position);
    this.patrolTimer = Math.random() * BANDIT.patrolIntervalMax;

    // A single reused vector, not a fresh one per pick: `coverPoint` is either
    // null or exactly this object. Cover is chosen a few times a minute, not
    // per frame, but the performance-budget rule is "never allocate in the
    // render loop" and this is inside it.
    this._coverVec = new THREE.Vector3();
    this.coverPoint = null;
    this._coverTimer = 0;

    this._stuckTimer = BANDIT.stuckTime;
    this._stuckFrom = new THREE.Vector3().copy(bandit.position);
    this._sidestep = 0; // seconds left committed to a random sidestep
    this._sidestepSign = 1;

    this._hit = makeHit();
  }

  /**
   * "Something happened over there." Called when this bandit is shot, and by
   * bandits.js for every bandit within earshot of a gunshot — without it you
   * can pick a camp apart one man at a time while the rest stand around, which
   * reads as broken rather than as stealth.
   */
  alert(x, z) {
    if (!this.alerted) {
      this.alerted = true;
      this.alertTimer = BANDIT.alertTime;
    }
    this.lastSeen.set(x, 0, z);
    this.memory = BANDIT.loseSightTime;
  }

  /** Can this bandit see the player right now? Range, then arc, then geometry. */
  _perceive(player, dist) {
    if (player.dead || dist > BANDIT.sightRange) return false;
    if (dist > BANDIT.closeSenseRange) {
      // Facing arc. yaw 0 looks toward -Z, the convention camera.js and
      // player.js share (ADR-005).
      const facingX = -Math.sin(this.bandit.yaw);
      const facingZ = -Math.cos(this.bandit.yaw);
      const inv = dist > 1e-4 ? 1 / dist : 0;
      const dot = (_toPlayer.x * inv) * facingX + (_toPlayer.z * inv) * facingZ;
      if (dot < Math.cos(BANDIT.sightHalfAngle)) return false;
    }
    return this.bandit.hasLineOfSight(player);
  }

  /**
   * Picks a rock (or cactus, tree, barrel) to fight from.
   *
   * The cover point is NOT the far side of the rock. Standing there breaks the
   * bandit's own line of sight, which drops them straight back to `chase`,
   * which walks them out from behind the rock — cover as an infinite loop. It
   * is the rock's *shoulder*: `coverPeekAngle` around from straight-away, on
   * whichever side is nearer, where the rock is adjacent and the player is
   * still visible.
   */
  _findCover(playerPos) {
    const pos = this.bandit.position;
    let best = null;
    let bestScore = Infinity;
    for (const col of colliders) {
      if (col.type !== 'circle') continue;
      if (col.r < BANDIT.coverMinRadius) continue;
      if (col.meta?.kind === 'bandit' || col.meta?.kind === 'horse') continue;
      const dx = col.x - pos.x;
      const dz = col.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > BANDIT.coverSearchRadius) continue;
      // Prefer near cover, and cover that is not on the far side of the player.
      const toward = Math.hypot(col.x - playerPos.x, col.z - playerPos.z);
      const score = d - toward * 0.25;
      if (score < bestScore) { bestScore = score; best = col; }
    }
    if (!best) return null;

    _away.set(best.x - playerPos.x, 0, best.z - playerPos.z);
    if (_away.lengthSq() < 1e-6) _away.set(1, 0, 0);
    _away.normalize().multiplyScalar(best.r + BANDIT.coverStandoff);
    // Both shoulders; take whichever the bandit is already nearer to.
    let chosenD = Infinity;
    for (const sign of [1, -1]) {
      _side.copy(_away);
      rotateXZ(_side, sign * BANDIT.coverPeekAngle);
      const px = best.x + _side.x;
      const pz = best.z + _side.z;
      const d = Math.hypot(px - pos.x, pz - pos.z);
      if (d < chosenD) { chosenD = d; this._coverVec.set(px, 0, pz); }
    }
    return this._coverVec;
  }

  _pickPatrolTarget() {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * BANDIT.patrolRadius;
    this.patrolTarget.set(this.anchor.x + Math.cos(angle) * r, 0, this.anchor.z + Math.sin(angle) * r);
    this.patrolTimer = THREE.MathUtils.lerp(BANDIT.patrolIntervalMin, BANDIT.patrolIntervalMax, Math.random());
  }

  /**
   * Three short rays forward — centre and ±`avoidRayAngle` — against the
   * collider array. A blocked centre adds a sideways push toward whichever
   * flank is clearer; a blocked flank pushes away from itself. Mutates `dir`.
   */
  _avoid(dir) {
    if (dir.lengthSq() < 1e-6) return;
    const b = this.bandit;
    _origin.set(b.position.x, b.position.y + BANDIT.chestHeight, b.position.z);
    let centre = false;
    let leftBlocked = false;
    let rightBlocked = false;

    for (const angle of [0, BANDIT.avoidRayAngle, -BANDIT.avoidRayAngle]) {
      _ray.copy(dir);
      if (angle !== 0) rotateXZ(_ray, angle);
      _ray.normalize();
      resetHit(this._hit);
      const blocked = raycastColliders(_origin, _ray, BANDIT.avoidRayLength, b.group.rayIgnore, this._hit);
      if (!blocked) continue;
      if (angle === 0) centre = true;
      else if (angle > 0) leftBlocked = true;
      else rightBlocked = true;
    }

    if (!centre && !leftBlocked && !rightBlocked) return;
    // Push perpendicular to the heading, toward the side that is clear.
    let sign = 0;
    if (leftBlocked && !rightBlocked) sign = -1;
    else if (rightBlocked && !leftBlocked) sign = 1;
    else sign = this._sidestepSign; // both, or only the centre: commit to one
    _side.copy(dir);
    rotateXZ(_side, sign * Math.PI / 2);
    dir.addScaledVector(_side, BANDIT.avoidStrength);
    if (dir.lengthSq() > 1e-8) dir.normalize();
  }

  /**
   * BUILD-PLAN.md's stuck detector: moved less than `stuckDistance` in
   * `stuckTime` while trying to get somewhere → pick a sidestep direction and
   * COMMIT to it for `sidestepTime`, rather than re-deciding every frame and
   * grinding against the same rock.
   */
  _checkStuck(dt, moving) {
    if (this._sidestep > 0) {
      this._sidestep -= dt;
      return;
    }
    this._stuckTimer -= dt;
    if (this._stuckTimer > 0) return;
    const moved = this._stuckFrom.distanceTo(this.bandit.position);
    if (moving && moved < BANDIT.stuckDistance) {
      this._sidestep = BANDIT.sidestepTime;
      this._sidestepSign = Math.random() < 0.5 ? 1 : -1;
    }
    this._stuckTimer = BANDIT.stuckTime;
    this._stuckFrom.copy(this.bandit.position);
  }

  /**
   * Advances the machine and writes this frame's heading into `outDir`
   * (normalised, or zeroed if standing).
   *
   * @returns {number} the target speed bandit.js should integrate toward.
   */
  update(dt, player, outDir) {
    const b = this.bandit;
    const pos = b.position;
    _toPlayer.set(player.position.x - pos.x, 0, player.position.z - pos.z);
    const dist = _toPlayer.length();

    // ------------------------------------------------------- perception ---
    this.canSee = this._perceive(player, dist);
    if (this.canSee) {
      this.lastSeen.set(player.position.x, 0, player.position.z);
      this.memory = BANDIT.loseSightTime;
      if (!this.alerted) {
        this.alerted = true;
        this.alertTimer = BANDIT.alertTime;
      }
    } else {
      this.memory = Math.max(0, this.memory - dt);
    }

    // ------------------------------------------------------------ cover ---
    // Wanted when hurt, or when the player has gone out of sight but is still
    // known about. An unhurt bandit who can see you fights in the open.
    const wantsCover = this.alerted && (b.health.fraction < 1 || !this.canSee);
    if (!wantsCover) {
      this.coverPoint = null;
    } else {
      this._coverTimer -= dt;
      if (!this.coverPoint || this._coverTimer <= 0) {
        this.coverPoint = this._findCover(this.canSee ? player.position : this.lastSeen);
        this._coverTimer = BANDIT.coverHoldTime;
      }
    }
    const atCover = !!this.coverPoint
      && Math.hypot(this.coverPoint.x - pos.x, this.coverPoint.z - pos.z) <= BANDIT.coverArriveDistance;

    // ------------------------------------------------------------ state ---
    const campWiped = b.camp.alive <= BANDIT.fleeAliveThreshold && b.camp.count > BANDIT.fleeAliveThreshold;
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      this.state = 'alert';
    } else if (!this.alerted) {
      this.state = 'patrol';
    } else if (campWiped) {
      this.state = 'flee';
    } else if (this.canSee && dist <= BANDIT.fireRange && (!this.coverPoint || atCover)) {
      this.state = 'shoot';
    } else if (this.coverPoint && !atCover) {
      this.state = 'takeCover';
    } else if (this.memory > 0) {
      this.state = 'chase';
    } else {
      this.alerted = false;
      this.anchor.copy(pos);
      this._pickPatrolTarget();
      this.state = 'patrol';
    }

    // --------------------------------------------------------- movement ---
    outDir.set(0, 0, 0);
    let targetSpeed = 0;
    switch (this.state) {
      case 'patrol': {
        this.patrolTimer -= dt;
        const arrived = Math.hypot(this.patrolTarget.x - pos.x, this.patrolTarget.z - pos.z) < BANDIT.patrolArriveDistance;
        if (this.patrolTimer <= 0 || arrived) this._pickPatrolTarget();
        outDir.set(this.patrolTarget.x - pos.x, 0, this.patrolTarget.z - pos.z);
        targetSpeed = BANDIT.walkSpeed;
        break;
      }
      case 'alert':
        // A beat of "wait — who's that", standing still. The whole point is
        // that a camp does not snap from asleep to shooting in one frame.
        break;
      case 'chase':
        outDir.set(this.lastSeen.x - pos.x, 0, this.lastSeen.z - pos.z);
        targetSpeed = BANDIT.runSpeed;
        break;
      case 'takeCover':
        outDir.set(this.coverPoint.x - pos.x, 0, this.coverPoint.z - pos.z);
        targetSpeed = BANDIT.runSpeed;
        break;
      case 'shoot':
        if (dist < BANDIT.tooCloseRange) {
          outDir.copy(_toPlayer).negate(); // back off, keep shooting
          targetSpeed = BANDIT.walkSpeed;
        } else if (!atCover && dist > BANDIT.preferredRange) {
          outDir.copy(_toPlayer);
          targetSpeed = BANDIT.runSpeed;
        }
        break;
      case 'flee':
        outDir.copy(_toPlayer).negate();
        targetSpeed = BANDIT.runSpeed;
        if (dist > BANDIT.fleeDistance) {
          this.alerted = false;
          this.memory = 0;
          this.anchor.copy(pos);
          this._pickPatrolTarget();
        }
        break;
      default:
        break;
    }

    this.wantsToShoot = this.state === 'shoot' && this.canSee;
    this.facePlayer = this.canSee && (this.state === 'shoot' || this.state === 'alert' || this.state === 'takeCover');

    this._checkStuck(dt, targetSpeed > 0);
    if (outDir.lengthSq() > 1e-6) {
      outDir.normalize();
      if (this._sidestep > 0) {
        _side.copy(outDir);
        rotateXZ(_side, this._sidestepSign * Math.PI / 2);
        outDir.addScaledVector(_side, 1).normalize();
      }
      this._avoid(outDir);
      return targetSpeed;
    }
    outDir.set(0, 0, 0);
    return 0;
  }
}
