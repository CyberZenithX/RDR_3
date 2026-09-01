/**
 * horse-jump.js — the horse's vertical axis: gravity, takeoff, the arc, the
 * landing, the body pitch that sells it, and the one rule that lets an
 * obstacle pass underneath. Split out of horse.js per BUILD-PLAN.md's
 * 400-line cap; horse.js owns everything horizontal.
 *
 * THE CLIP IS NOT THE JUMP. horse.glb ships a real `Gallop_Jump` (1.458s), so
 * unlike the player there is no retargeting problem here — but measured
 * straight off the GLB, its `Body` bone rises only 0.231 world units across
 * the whole clip, against 0.134 for one ordinary `Gallop` stride. It is a leg
 * tuck and a lunge, not an arc. Rocks stand roughly 0.4-2.1m proud of the
 * ground, so the arc is integrated here and the clip only supplies the legs.
 * The two are tied together by `airTime`, which horse-character.js uses to
 * stretch the clip over however long the physics actually keeps the horse up.
 *
 * The obstacle rule is the other half of the feature and lives in
 * collision.js: colliders are 2D circles with no height, so before this round
 * nothing in the world could ever be jumped over. Props now record the world
 * Y of their own top, and `clearance()` below is the line under which they
 * stop counting.
 */

import { HORSE } from './config-horse.js';
import { isKeyDown, isPointerLocked } from './input.js';

export class HorseJump {
  /** @param {object} horse the Horse whose position.y this owns */
  constructor(horse) {
    this.horse = horse;
    this.velocityY = 0;
    this.grounded = true;
    this.airborne = false;
    // Radians, written straight to character.root.rotation.x — already signed
    // for that use. See `_updatePitch()`.
    this.pitch = 0;
    this.weight = 0; // 0..1 two-point-seat blend handed to the rider

    this._coyote = HORSE.coyoteTime;
    this._buffer = -1;
    this._prevSpaceDown = false;
  }

  /**
   * How long a full jump keeps the horse off the ground, from the same two
   * constants that produce the arc: apex = v^2/2g, airTime = 2v/g.
   */
  get airTime() {
    return (2 * HORSE.jumpSpeed) / -HORSE.gravity;
  }

  /**
   * Buffers a jump. Public and separate from the key read for the same reason
   * Horse.handleMountToggle is public: headless Playwright cannot produce the
   * trusted, pointer-locked keypress the real path needs, so scripts/smoke.mjs
   * calls this directly. Buffering rather than jumping immediately is what
   * makes a press slightly too early still fire on landing.
   */
  request() {
    this._buffer = HORSE.jumpBuffer;
  }

  /** Reads Space itself, the same way horse.js reads H and E. */
  readInput() {
    const down = isPointerLocked() && isKeyDown('Space');
    if (down && !this._prevSpaceDown) this.request();
    this._prevSpaceDown = down;
  }

  /** Space is the player's own jump while on foot — forget any stale press across a mount. */
  reset() {
    this._buffer = -1;
    this._prevSpaceDown = false;
  }

  /**
   * World Y under which an obstacle passes beneath the horse rather than
   * blocking it, or -Infinity while the horse is on the ground.
   *
   * HORSE.bellyHeight was measured by raycasting UP into the *animated* mesh
   * (three r160's SkinnedMesh.raycast applies bone transforms; reading the
   * geometry buffer would report the bind pose): 1.10 at the narrowest point
   * under the barrel, rising to 1.42 toward the quarters. The low reading is
   * the one that matters.
   *
   * The airborne gate is deliberate. A standing horse does not step over a
   * knee-high rock, so on the ground the collision list is honoured in full,
   * exactly as it was before this round.
   */
  clearance() {
    if (!this.airborne) return -Infinity;
    return this.horse.position.y + HORSE.bellyHeight - HORSE.jumpClearMargin;
  }

  /** Only a ridden horse jumps, and only one already moving, with something left in the tank. */
  _canJump() {
    const h = this.horse;
    return h.mounted && h.speed >= HORSE.jumpMinSpeed && !h.staminaExhausted;
  }

  /**
   * Integrates the vertical axis and writes `horse.position.y`. Called after
   * the horizontal step has resolved collisions and clamped the boundary, so
   * `groundY` is the terrain height under where the horse actually ended up.
   */
  update(dt, groundY) {
    const h = this.horse;
    if (h.mounted) this.readInput();

    this._buffer -= dt;
    this._coyote = this.grounded ? HORSE.coyoteTime : this._coyote - dt;

    if (this._buffer > 0 && this._coyote > 0 && this._canJump()) {
      this.velocityY = HORSE.jumpSpeed;
      this._buffer = -1;
      this._coyote = 0;
      this.grounded = false;
      h.stamina = Math.max(0, h.stamina - HORSE.jumpStaminaCost);
    }

    this.velocityY += HORSE.gravity * dt;
    h.position.y += this.velocityY * dt;
    if (this.velocityY <= 0 && h.position.y - groundY <= HORSE.groundSnap) {
      h.position.y = groundY;
      this.velocityY = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    this.airborne = !this.grounded;

    this._updatePitch(dt);
    this.weight += ((this.airborne ? 1 : 0) - this.weight) * (1 - Math.exp(-HORSE.jumpPoseBlendRate * dt));
  }

  /**
   * Nose up over the rise, down over the descent, eased rather than snapped.
   *
   * Sign: the rig's local +Z is the nose, and rotation.x is taken about the
   * horse's own lateral axis (horse.js sets Euler order 'YXZ' precisely so that
   * it is). A positive X rotation carries +Z downward, so nose-UP is negative —
   * which is why the configured angles are both written positive and negated
   * here, rather than one of them being a confusingly negative constant.
   */
  _updatePitch(dt) {
    let target = 0;
    if (this.airborne) {
      target = this.velocityY > 0 ? -HORSE.jumpPitchTakeoff : HORSE.jumpPitchLanding;
    }
    this.pitch += (target - this.pitch) * (1 - Math.exp(-HORSE.jumpPitchRate * dt));
  }
}
