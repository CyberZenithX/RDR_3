/**
 * placeholder-horse.js — the "horse.glb failed to load" fallback, mirroring
 * placeholder-human.js: a procedurally rigged, procedurally animated
 * quadruped (capsule body/neck/head/tail, four two-segment legs), no
 * AnimationMixer, no baked clips. Gait is driven directly off current speed
 * each frame. Implements the same small interface horse-character.js
 * expects: `root`, `height`, `setLocomotion(state, speed)`, `update(dt)`.
 */

import * as THREE from 'three';
import { COLORS } from './config.js';
import { PLACEHOLDER_HORSE, HORSE_ANIM } from './config-horse.js';

function buildCapsule(radius, halfLength, material) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, halfLength * 2, 4, 8), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class PlaceholderHorse {
  constructor() {
    const cfg = PLACEHOLDER_HORSE;
    const coatMat = new THREE.MeshStandardMaterial({ color: COLORS.placeholderBody, roughness: 0.8 });
    const maneMat = new THREE.MeshStandardMaterial({ color: COLORS.deadWood, roughness: 0.9 });

    this.root = new THREE.Group();
    this.root.name = 'placeholderHorse';

    // Body: a horizontal capsule (default CapsuleGeometry stands upright on
    // Y, so it's rotated 90° about Z to lie along Z instead).
    const body = buildCapsule(cfg.bodyRadius, cfg.bodyLength / 2, coatMat);
    body.rotation.z = Math.PI / 2;
    body.position.y = cfg.bodyHeight;
    this.body = body;
    this.root.add(body);

    // Neck + head, hung forward off the body's +Z (nose) end.
    const neckPivot = new THREE.Group();
    neckPivot.position.set(0, cfg.bodyHeight + cfg.bodyRadius * 0.3, cfg.bodyLength / 2);
    const neck = buildCapsule(cfg.neckRadius, cfg.neckLength / 2, maneMat);
    neck.position.y = cfg.neckLength / 2;
    neck.rotation.x = -0.55;
    neckPivot.add(neck);
    const head = buildCapsule(cfg.headRadius, cfg.headLength / 2, coatMat);
    head.position.set(0, cfg.neckLength * 0.92, cfg.neckLength * 0.42);
    head.rotation.x = -0.55;
    neckPivot.add(head);
    this.root.add(neckPivot);

    // Tail off the -Z end.
    const tail = buildCapsule(cfg.tailRadius, cfg.tailLength / 2, maneMat);
    tail.position.set(0, cfg.bodyHeight + cfg.bodyRadius * 0.1, -cfg.bodyLength / 2 - cfg.tailLength * 0.3);
    tail.rotation.x = 0.9;
    this.root.add(tail);

    // Four legs: hip/shoulder group -> knee group, each a two-segment capsule chain.
    this.legs = {};
    const legPositionsZ = { front: cfg.bodyLength * 0.32, back: -cfg.bodyLength * 0.32 };
    for (const end of ['front', 'back']) {
      for (const side of [-1, 1]) {
        const key = `${end}${side < 0 ? 'L' : 'R'}`;
        const hip = new THREE.Group();
        hip.position.set(side * cfg.legSpreadX, cfg.bodyHeight, legPositionsZ[end]);
        hip.add(buildCapsule(cfg.legRadius, cfg.upperLegLength / 2, coatMat));
        hip.children[0].position.y = -cfg.upperLegLength / 2;

        const knee = new THREE.Group();
        knee.position.y = -cfg.upperLegLength;
        knee.add(buildCapsule(cfg.legRadius * 0.8, cfg.lowerLegLength / 2, coatMat));
        knee.children[0].position.y = -cfg.lowerLegLength / 2;
        hip.add(knee);

        this.root.add(hip);
        this.legs[key] = { hip, knee, phaseOffset: (end === 'front') === (side < 0) ? 0 : Math.PI };
      }
    }

    this.height = cfg.bodyHeight + cfg.bodyRadius + cfg.neckLength * 0.4;
    this.isPlaceholder = true;
    this._phase = 0;
    this._time = 0;
    this._speed = 0;
    this._airborne = false;
  }

  setLocomotion(_state, speed) {
    this._speed = speed;
  }

  /**
   * Same interface as the real rig's one-shot jump clip. There is no mixer
   * here, so this is a flag that update() turns into a held tucked pose rather
   * than an animation — the airTime the real rig uses to stretch its clip has
   * nothing to stretch here and is ignored.
   */
  setAirborne(airborne, _airTime = 0) {
    this._airborne = !!airborne;
  }

  update(dt) {
    const cfg = PLACEHOLDER_HORSE;
    this._time += dt;

    if (this._speed > HORSE_ANIM.idleThreshold) {
      this._phase += dt * this._speed * cfg.swingFrequency * Math.PI * 2;
      const amp = cfg.swingAmplitude * THREE.MathUtils.clamp(this._speed / 9, 0.3, 1);
      // Diagonal gait: front-left+back-right swing together, opposite the other pair.
      for (const [key, leg] of Object.entries(this.legs)) {
        const swing = Math.sin(this._phase + leg.phaseOffset);
        leg.hip.rotation.x = swing * amp;
        leg.knee.rotation.x = Math.max(0, -swing) * amp * 0.8;
      }
      this.body.position.y = cfg.bodyHeight + Math.abs(Math.cos(this._phase)) * cfg.bobAmplitude;
    } else {
      const ease = 1 - Math.pow(0.001, dt);
      const breathe = Math.sin(this._time * cfg.idleBreathFrequency * Math.PI * 2) * cfg.idleBreathAmplitude;
      this.body.position.y = cfg.bodyHeight + breathe;
      for (const leg of Object.values(this.legs)) {
        leg.hip.rotation.x *= 1 - ease;
        leg.knee.rotation.x *= 1 - ease;
      }
    }

    // Airborne pose, held over whatever the gait above just wrote — all four
    // legs tucked, the way the real rig's Gallop_Jump reads.
    if (this._airborne) {
      for (const leg of Object.values(this.legs)) {
        leg.hip.rotation.x = cfg.jumpTuckHip;
        leg.knee.rotation.x = cfg.jumpTuckKnee;
      }
      this.body.position.y = cfg.bodyHeight + cfg.jumpTuckRise;
    }
  }
}
