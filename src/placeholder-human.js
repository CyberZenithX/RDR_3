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
import { PLACEHOLDER, COLORS, ANIM, PLAYER } from './config.js';

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
  }

  /** Uniform interface with the real rig — `state` is unused here since speed alone drives the gait. */
  setLocomotion(_state, speed) {
    this._speed = speed;
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
  }
}
