/**
 * placeholder-human.js — the "GLB failed to load" fallback required by
 * BUILD-PLAN.md ("substitute a proportioned capsule-and-limbs placeholder …
 * keep the game fully playable. This rule holds for every round."). A
 * procedurally rigged and procedurally animated humanoid: no AnimationMixer,
 * no baked clips — walk/run/idle are driven directly off the player's current
 * speed each frame, which is cheap and never desyncs from movement.
 *
 * Implements the same small interface character.js expects from a real GLTF
 * rig: `root`, `height`, `setLocomotion(state, speed, aiming)`,
 * `setAirborne(bool)`, `setRidingPose(...)`, `setAimPose(...)`, `update(dt)`.
 *
 * Round 3 note: the elbow of each arm carries an empty named `WristR`/`WristL`
 * where a hand would be, purely so weapons.js's generic bone search finds one
 * here too and the revolver is held rather than floating at the root. That is
 * the only concession this file makes to the real rig's naming.
 *
 * Round 4 note: this is the one rig BUILD-PLAN.md's substitution table for
 * `Hit` and `Death` actually applies to — the real GLB ships both clips, this
 * has no clips at all. So a hit rocks the body back and a death tips it onto
 * its side over `HEALTH.tipTime` and settles it `HEALTH.sink` into the ground,
 * exactly as the table describes. Both are applied to `hips`, NOT to `root`:
 * player.js and bandit.js both rewrite `root.position`/`root.rotation.y` every
 * frame, so anything written to the root is gone before it renders.
 */

import * as THREE from 'three';
import { PLACEHOLDER, COLORS, ANIM, PLAYER, JUMP } from './config.js';
import { RIDING_POSE } from './config-horse.js';
import { AIM_POSE } from './config-combat.js';
import { HEALTH } from './config-ai.js';
import { createRevolver } from './weapons.js';

function buildSegment(radius, halfLength, material) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, halfLength * 2, 4, 8), material);
  mesh.position.y = -(halfLength + radius);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class PlaceholderHuman {
  constructor() {
    const cfg = PLACEHOLDER;
    const skinMat = new THREE.MeshStandardMaterial({ color: COLORS.placeholderSkin, roughness: 0.75 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: COLORS.placeholderBody, roughness: 0.85 });

    this.root = new THREE.Group();
    this.root.name = 'placeholderHuman';
    this.hips = new THREE.Group();
    this.hips.position.y = cfg.hipHeight;
    this.root.add(this.hips);

    const torso = buildSegment(cfg.torsoRadius, cfg.torsoLength / 2, bodyMat);
    torso.position.y = cfg.torsoLength / 2 + cfg.torsoRadius; // hang upward instead of down
    this.hips.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(cfg.headRadius, 12, 10), skinMat);
    head.position.y = cfg.torsoLength + cfg.torsoRadius * 2 + cfg.headRadius;
    head.castShadow = true;
    this.hips.add(head);

    const shoulderY = cfg.torsoLength + cfg.torsoRadius * 1.6;
    this.arms = {};
    this.legs = {};

    for (const side of [-1, 1]) {
      const key = side < 0 ? 'L' : 'R';

      const shoulder = new THREE.Group();
      shoulder.position.set(side * cfg.shoulderWidth, shoulderY, 0);
      shoulder.add(buildSegment(cfg.armRadius, cfg.armLength / 4, skinMat));
      const elbow = new THREE.Group();
      elbow.position.y = -(cfg.armLength / 2 + cfg.armRadius * 2);
      elbow.add(buildSegment(cfg.armRadius * 0.85, cfg.armLength / 4, skinMat));
      // Where a hand would be, named so weapons.js's bone search finds it.
      const hand = new THREE.Group();
      hand.name = `Wrist${key}`;
      hand.position.y = -(cfg.armLength / 2 + cfg.armRadius * 2);
      elbow.add(hand);
      shoulder.add(elbow);
      this.hips.add(shoulder);
      this.arms[key] = { shoulder, elbow, hand };

      const hipJoint = new THREE.Group();
      hipJoint.position.set(side * cfg.hipWidth, 0, 0);
      hipJoint.add(buildSegment(cfg.legRadius, cfg.legLength / 4, bodyMat));
      const knee = new THREE.Group();
      knee.position.y = -(cfg.legLength / 2 + cfg.legRadius * 2);
      knee.add(buildSegment(cfg.legRadius * 0.85, cfg.legLength / 4, bodyMat));
      hipJoint.add(knee);
      this.hips.add(hipJoint);
      this.legs[key] = { hip: hipJoint, knee };
    }

    this.height = cfg.hipHeight + cfg.torsoLength + cfg.torsoRadius * 2 + cfg.headRadius * 2;
    this.isPlaceholder = true;
    this._phase = 0;
    this._time = 0;
    this._speed = 0;
    this._jumpWeight = 0;
    this._jumpTargetWeight = 0;
    this._ridingWeight = 0;
    this._ridingSway = 0;
    this._ridingJump = 0;
    this._aimWeight = 0;
    this._aimElevation = 0;
    this._aimRecoil = 0;
    this._aimReload = 0;
    this._dead = false;
    this._deathT = 0; // 0..HEALTH.tipTime through the fall
    this._hitT = 0;
    // Matches the real rig's own measured pelvis height, so horse.js's saddle
    // offset means the same thing whichever rig is in play.
    this.hipHeight = PLACEHOLDER.hipHeight;

    // The placeholder is armed too. BUILD-PLAN.md's rule is that a missing GLB
    // must leave the game **fully playable**, and a round-3 game you cannot
    // shoot in is not that — main.js parents the muzzle flash to
    // `character.weapon.muzzle` and combat.js fires from it, so an unarmed
    // fallback rig took the whole boot sequence down with a TypeError. That
    // is exactly the crash the rule exists to prevent, and it was caught by
    // re-running the smoke suite with player.glb renamed away
    // (docs/TESTING.md). The `Wrist*` empties above exist so weapons.js's
    // generic bone search finds a hand here with no special-casing; this rig's
    // root scale is 1, so its offsets need no scale correction either.
    this.weapon = createRevolver(this.root);
  }

  /**
   * Uniform interface with the real rig — `state` and `aiming` are unused
   * here: speed alone drives the gait, and the aiming stance is applied as a
   * pose overlay in update() rather than by swapping clips this rig has none of.
   */
  setLocomotion(_state, speed, _aiming = false) {
    this._speed = speed;
  }

  /** Call once per frame with whether the player is currently airborne. */
  setAirborne(airborne) {
    this._jumpTargetWeight = airborne ? 1 : 0;
  }

  /**
   * Same interface as the real rig's seated riding pose (see riding-pose.js),
   * done here with plain group rotations since these limbs are rigid capsules
   * with no skeleton to fight. Angles mirror RIDING_POSE's intent rather than
   * its exact values — the proportions differ.
   */
  setRidingPose(weight, sway = 0, jump = 0) {
    this._ridingWeight = THREE.MathUtils.clamp(weight, 0, 1);
    this._ridingSway = sway;
    // The two-point jumping seat is a skeleton pose on the real rig; these
    // rigid capsules have no such subtlety, so it folds in as a little extra
    // forward carriage rather than being ignored outright.
    this._ridingJump = THREE.MathUtils.clamp(jump, 0, 1);
  }

  /**
   * Same interface as the real rig's aim pose (see aim-pose.js), done with
   * plain group rotations. `support` and the finger grip have no meaning on
   * rigid capsules with no hands, so they are accepted and ignored.
   */
  setAimPose({ weight = 0, elevation = 0, recoil = 0, reload = 0 } = {}) {
    this._aimWeight = THREE.MathUtils.clamp(weight, 0, 1);
    this._aimElevation = elevation;
    this._aimRecoil = THREE.MathUtils.clamp(recoil, 0, 1);
    this._aimReload = THREE.MathUtils.clamp(reload, 0, 1);
  }

  /**
   * The flinch. Returns how long it lasts, so the caller can use the same
   * number as its stagger whichever rig is in play — the real one returns its
   * clip's duration.
   */
  playHit() {
    if (this._dead) return 0;
    this._hitT = HEALTH.hitStagger;
    return HEALTH.hitStagger;
  }

  /** Dead or alive. Reversible: the player respawns. */
  setDead(dead) {
    if (dead === this._dead) return;
    this._dead = dead;
    if (dead) this._hitT = 0;
  }

  update(dt) {
    const cfg = PLACEHOLDER;
    this._time += dt;

    if (this._speed > ANIM.idleThreshold) {
      this._phase += dt * this._speed * cfg.swingFrequency * Math.PI * 2;
      const amp = cfg.swingAmplitude * THREE.MathUtils.clamp(this._speed / PLAYER.sprintSpeed, 0.3, 1);
      const swing = Math.sin(this._phase);

      this.legs.L.hip.rotation.x = swing * amp;
      this.legs.R.hip.rotation.x = -swing * amp;
      this.legs.L.knee.rotation.x = Math.max(0, Math.sin(this._phase + Math.PI * 0.5)) * amp * 0.9;
      this.legs.R.knee.rotation.x = Math.max(0, Math.sin(this._phase - Math.PI * 0.5)) * amp * 0.9;
      this.arms.L.shoulder.rotation.x = -swing * amp * 0.8;
      this.arms.R.shoulder.rotation.x = swing * amp * 0.8;
      this.hips.position.y = cfg.hipHeight + Math.abs(Math.cos(this._phase)) * cfg.bobAmplitude;
    } else {
      const ease = 1 - Math.pow(0.001, dt);
      const breathe = Math.sin(this._time * cfg.idleBreathFrequency * Math.PI * 2) * cfg.idleBreathAmplitude;
      this.hips.position.y = cfg.hipHeight + breathe;
      for (const key of ['L', 'R']) {
        this.legs[key].hip.rotation.x *= 1 - ease;
        this.legs[key].knee.rotation.x *= 1 - ease;
        this.arms[key].shoulder.rotation.x *= 1 - ease;
      }
    }

    // Procedural jump-pose overlay -- symmetric bend on both legs, applied on
    // top of whatever the locomotion pose above just set. Same exponential
    // blend-rate formula as the real rig (character.js) and camera.js.
    this._jumpWeight += (this._jumpTargetWeight - this._jumpWeight) * (1 - Math.exp(-JUMP.poseBlendRate * dt));
    if (this._jumpWeight > 0.002) {
      for (const key of ['L', 'R']) {
        this.legs[key].hip.rotation.x = THREE.MathUtils.lerp(this.legs[key].hip.rotation.x, JUMP.placeholderHipBend, this._jumpWeight);
        this.legs[key].knee.rotation.x = THREE.MathUtils.lerp(this.legs[key].knee.rotation.x, JUMP.placeholderKneeBend, this._jumpWeight);
      }
    }

    // Seated riding pose, blended over whatever the locomotion pose above set.
    if (this._ridingWeight > 0.002) {
      const w = this._ridingWeight;
      const s = this._ridingSway * w;
      const j = this._ridingJump * w;
      const lerp = THREE.MathUtils.lerp;
      for (const side of [-1, 1]) {
        const key = side < 0 ? 'L' : 'R';
        const leg = this.legs[key];
        const arm = this.arms[key];
        leg.hip.rotation.x = lerp(leg.hip.rotation.x, -(RIDING_POSE.thighPitch + RIDING_POSE.swayThigh * s + RIDING_POSE.jumpThighPitch * j), w);
        leg.hip.rotation.z = lerp(leg.hip.rotation.z, -side * RIDING_POSE.thighSpread, w);
        leg.knee.rotation.x = lerp(leg.knee.rotation.x, RIDING_POSE.kneeBend + RIDING_POSE.jumpKneeBend * j, w);
        arm.shoulder.rotation.x = lerp(arm.shoulder.rotation.x, -(RIDING_POSE.armPitch + RIDING_POSE.jumpArmPitch * j), w);
        arm.shoulder.rotation.z = lerp(arm.shoulder.rotation.z, side * RIDING_POSE.armIn, w);
        arm.elbow.rotation.x = lerp(arm.elbow.rotation.x, -(RIDING_POSE.elbowBend + RIDING_POSE.swayElbow * s + RIDING_POSE.jumpElbowBend * j), w);
      }
      this.hips.rotation.x = lerp(this.hips.rotation.x, RIDING_POSE.torsoPitch + RIDING_POSE.jumpTorsoPitch * j, w);
    } else if (this.hips.rotation.x !== 0) {
      // Dismounted: unlike the real rig there is no mixer to overwrite these,
      // so the seated angles have to be released explicitly.
      const ease = 1 - Math.pow(0.001, dt);
      this.hips.rotation.x *= 1 - ease;
      for (const key of ['L', 'R']) {
        this.legs[key].hip.rotation.z *= 1 - ease;
        this.arms[key].shoulder.rotation.z *= 1 - ease;
        this.arms[key].elbow.rotation.x *= 1 - ease;
      }
    }

    // Aiming, over everything above — last, for the same reason aim-pose.js
    // runs last on the real rig: while the gun is up it owns the arms
    // outright, whether the pose underneath is a walk cycle or a saddle.
    if (this._aimWeight > 0.002) {
      const w = this._aimWeight;
      const lerp = THREE.MathUtils.lerp;
      const elev = THREE.MathUtils.clamp(this._aimElevation, AIM_POSE.elevationMin, AIM_POSE.elevationMax)
        * AIM_POSE.elevationFollow;
      const armX = -(AIM_POSE.armPitch + elev)
        + AIM_POSE.recoilArmPitch * this._aimRecoil
        + AIM_POSE.reloadArmDrop * this._aimReload;
      const right = this.arms.R;
      right.shoulder.rotation.x = lerp(right.shoulder.rotation.x, armX, w);
      right.shoulder.rotation.z = lerp(right.shoulder.rotation.z, AIM_POSE.armIn, w);
      right.elbow.rotation.x = lerp(right.elbow.rotation.x, -AIM_POSE.elbowBend, w);
      // The left arm only comes up as support when it is free to — mounted,
      // it is holding the reins, which the riding pose above has just set.
      if (this._ridingWeight <= 0.002) {
        const left = this.arms.L;
        left.shoulder.rotation.x = lerp(left.shoulder.rotation.x, -(AIM_POSE.supportArmPitch + elev), w);
        left.shoulder.rotation.z = lerp(left.shoulder.rotation.z, -AIM_POSE.supportArmIn, w);
        left.elbow.rotation.x = lerp(left.elbow.rotation.x, -AIM_POSE.supportElbowBend, w);
      }
    }

    // The flinch, and then the fall — last, over everything above, for the
    // same reason aim comes after riding: whatever else the body is doing,
    // being shot wins. Both are written to `hips`; see the file header.
    if (this._hitT > 0 && !this._dead) {
      this._hitT = Math.max(0, this._hitT - dt);
      const k = Math.sin((this._hitT / HEALTH.hitStagger) * Math.PI);
      this.hips.rotation.x -= HEALTH.flinchLean * k;
    }
    if (this._dead) this._deathT = Math.min(HEALTH.tipTime, this._deathT + dt);
    else if (this._deathT > 0) this._deathT = Math.max(0, this._deathT - dt * 3);
    if (this._deathT > 0) {
      const t = this._deathT / HEALTH.tipTime;
      const k = t * t * (3 - 2 * t); // smoothstep, so the body does not snap over
      const lerp = THREE.MathUtils.lerp;
      this.hips.rotation.z = k * Math.PI / 2;
      this.hips.rotation.x = lerp(this.hips.rotation.x, 0, k);
      // Tipped onto its side, the torso is horizontal, so the hips end up one
      // torso-radius off the ground — and then a little further into it.
      this.hips.position.y = lerp(this.hips.position.y, cfg.torsoRadius - HEALTH.sink, k);
    }
  }
}
