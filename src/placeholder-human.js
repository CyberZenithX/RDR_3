/**
 * placeholder-human.js — the "GLB failed to load" fallback required by
 * BUILD-PLAN.md ("substitute a proportioned capsule-and-limbs placeholder …
 * keep the game fully playable. This rule holds for every round."). A
 * procedurally rigged and procedurally animated humanoid: no AnimationMixer,
 * no baked clips — walk/run/idle are driven directly off the player's current
 * speed each frame, which is cheap and never desyncs from movement.
 *
 * Implements the same small interface character.js expects from a real GLTF
 * rig: `root`, `height`, `setLocomotion(state, speed)`, `update(dt)`.
 */

import * as THREE from 'three';
import { PLACEHOLDER, COLORS, ANIM, PLAYER, JUMP } from './config.js';
import { RIDING_POSE } from './config-horse.js';

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
      shoulder.add(elbow);
      this.hips.add(shoulder);
      this.arms[key] = { shoulder, elbow };

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
    // Matches the real rig's own measured pelvis height, so horse.js's saddle
    // offset means the same thing whichever rig is in play.
    this.hipHeight = PLACEHOLDER.hipHeight;
  }

  /** Uniform interface with the real rig — `state` is unused here since speed alone drives the gait. */
  setLocomotion(_state, speed) {
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
  }
}
