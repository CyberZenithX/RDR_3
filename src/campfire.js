/**
 * campfire.js — the bonfire at each bandit camp, and the smoke column that is
 * the actual landmark.
 *
 * WHY THIS IS A FILE AND NOT FOUR LINES IN bandits.js. Round 4 shipped the
 * camps with a 1.2m ring of pebbles and the human's first note was "I didn't
 * even know there was a campfire here." The fix is not a bigger ring: a fire
 * pit lies on the ground, and at three hundred metres a ground-level object is
 * behind a hill, under the grass, or gone into `FOG.density`. **Height is what
 * carries**, and the smoke carries furthest — a dark vertical column standing
 * over a landscape made entirely of horizontals.
 *
 * Three tiers, each for a different range (see CAMP_PROPS):
 *
 *   pyre + boulders  close   — real geometry, fogged and lit like everything else
 *   flame            middle  — `MeshBasicMaterial` with `fog: false`, so it stays a
 *                              bright beacon instead of dissolving into the dust
 *   smoke            long    — 30m of rising, spreading, paling puffs
 *
 * FIVE DRAW CALLS FOR EVERY CAMP IN THE GAME. One `InstancedMesh` per tier,
 * shared across all three fires — the same discipline vfx.js keeps, and it
 * matters more now: round 4 left only ~14 calls of headroom under
 * BUILD-PLAN.md's ~120 budget.
 *
 * `update(dt)` runs for ALL camps unconditionally, not just nearby ones. The
 * bandits themselves are frozen past `BANDIT.activeRadius`, but a smoke column
 * you can only see moving once you are already there is not a landmark.
 */

import * as THREE from 'three';
import { COLORS } from './config.js';
import { CAMP_PROPS } from './config-ai.js';
import { addCircleCollider } from './collision.js';

const _dummy = new THREE.Object3D();
const _axis = new THREE.Vector3();
const _color = new THREE.Color();
const _near = new THREE.Color();
const _far = new THREE.Color();
const _fade = new THREE.Color();

/**
 * A flame tongue: a cone with its base at y=0, vertex-coloured hot at the
 * bottom and dark orange at the tip. Open-ended, because you never see inside
 * one and the cap is wasted triangles.
 */
function makeFlameGeometry() {
  const p = CAMP_PROPS;
  const geo = new THREE.ConeGeometry(p.flameRadius, p.flameHeight, 6, 1, true);
  geo.translate(0, p.flameHeight / 2, 0);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const hot = new THREE.Color(p.flameHot);
  const tip = new THREE.Color(p.flameTip);
  for (let i = 0; i < pos.count; i++) {
    // sqrt, so the pale core is confined to the bottom of the tongue and most
    // of its length is the orange that actually reads as fire.
    const t = THREE.MathUtils.clamp(pos.getY(i) / p.flameHeight, 0, 1);
    _color.copy(hot).lerp(tip, Math.sqrt(t));
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * A smoke puff: a unit-diameter low-poly sphere.
 *
 * It was crossed quads first — vfx.js's muzzle-flash trick, which avoids
 * billboarding for free. At the size a flash lives at, for the 55ms it lives,
 * a hard rectangular edge is invisible. At seven metres across, standing still
 * in the sky, it read as a stack of grey slabs. A sphere has no silhouette to
 * give itself away from any angle, and still needs no per-frame orientation.
 */
function makeSmokeGeometry() {
  return new THREE.IcosahedronGeometry(0.5, 1);
}

export class Campfires {
  /**
   * @param {THREE.Scene} scene
   * @param {{x:number,z:number}[]} camps the live camp list from bandits.js
   * @param {object} world for `groundHeightAt`
   */
  constructor(scene, camps, world) {
    const p = CAMP_PROPS;
    this.camps = camps;
    this._time = 0;

    const n = camps.length;
    const stoneGeo = new THREE.IcosahedronGeometry(p.stoneRadius, 0);
    const logGeo = new THREE.CylinderGeometry(p.logRadius * 0.75, p.logRadius, p.logLength, 6);
    logGeo.translate(0, p.logLength / 2, 0); // base at the origin, so a log stands on its foot
    const ashGeo = new THREE.CircleGeometry(p.ashRadius, 16);
    ashGeo.rotateX(-Math.PI / 2);

    this.stones = new THREE.InstancedMesh(
      stoneGeo, new THREE.MeshStandardMaterial({ color: p.stoneColor, roughness: 0.95 }),
      n * p.stoneCount,
    );
    this.logs = new THREE.InstancedMesh(
      logGeo, new THREE.MeshStandardMaterial({ color: p.logColor, roughness: 0.9 }),
      n * p.logCount,
    );
    this.ash = new THREE.InstancedMesh(
      ashGeo, new THREE.MeshStandardMaterial({ color: p.ashColor, roughness: 1 }), n,
    );
    for (const m of [this.stones, this.logs, this.ash]) {
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }

    this.flames = new THREE.InstancedMesh(
      makeFlameGeometry(),
      new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: p.flameOpacity,
        depthWrite: false, side: THREE.DoubleSide,
        // NOT fogged, and that is the whole point of this tier: a flame is a
        // light, and a light does not fade into the haze the way a rock does.
        fog: false,
      }),
      n * p.flameCount,
    );
    this.smoke = new THREE.InstancedMesh(
      makeSmokeGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, // multiplied by the per-instance colour set in update()
        transparent: true, opacity: p.smokeOpacity,
        depthWrite: false, side: THREE.DoubleSide, fog: true,
      }),
      n * p.smokeCount,
    );
    for (const m of [this.flames, this.smoke]) {
      // Their instances move a long way from wherever the bounds were computed
      // — the smoke rises thirty metres — so leave culling to the GPU. It is
      // one draw call for every fire in the world either way.
      m.frustumCulled = false;
      m.castShadow = false;
      scene.add(m);
    }

    this.baseY = camps.map((c) => world.groundHeightAt(c.x, c.z));
    // Per-puff phase, so no two fires (and no two puffs) pulse together.
    this._phase = new Float32Array(n * p.smokeCount);
    this._flamePhase = new Float32Array(n * p.flameCount);
    // Per-tongue height, and per-puff wander off the column axis. Seeded once
    // and reused every frame: a fire whose tongues were all the same height
    // reads as a cone, and a column of perfectly concentric puffs reads as a
    // string of beads.
    this._flameScale = new Float32Array(n * p.flameCount);
    this._jitter = new Float32Array(n * p.smokeCount * 2);
    // STRATIFIED, not `Math.random()` per puff. Twenty-two independent random
    // phases clump: the first version rendered two isolated blobs high in the
    // sky with nothing between them and the fire, because that is what a
    // uniform sample of twenty-two points on a line actually looks like. One
    // puff per equal slice of the column, jittered inside its own slice, is a
    // continuous column that still never repeats.
    for (let c = 0; c < camps.length; c++) {
      for (let j = 0; j < p.smokeCount; j++) {
        this._phase[c * p.smokeCount + j] = (j + Math.random() * 0.7) / p.smokeCount;
      }
    }
    for (let i = 0; i < this._jitter.length; i++) this._jitter[i] = Math.random() * 2 - 1;
    for (let i = 0; i < this._flamePhase.length; i++) {
      this._flamePhase[i] = Math.random() * Math.PI * 2;
      this._flameScale[i] = 0.45 + Math.random() * 0.75;
    }

    this._buildStatic(camps, world);
    this.update(0);
  }

  /** The boulders, the ash scorch and the pyre — placed once, never touched again. */
  _buildStatic(camps, world) {
    const p = CAMP_PROPS;
    let s = 0;
    let l = 0;
    camps.forEach((camp, i) => {
      const groundY = this.baseY[i];

      for (let k = 0; k < p.stoneCount; k++) {
        const a = (k / p.stoneCount) * Math.PI * 2 + i;
        const r = p.stoneRingRadius * (0.92 + Math.random() * 0.16);
        const x = camp.x + Math.cos(a) * r;
        const z = camp.z + Math.sin(a) * r;
        _dummy.position.set(x, world.groundHeightAt(x, z) + p.stoneRadius * 0.35, z);
        _dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        _dummy.scale.setScalar(0.75 + Math.random() * 0.7);
        _dummy.updateMatrix();
        this.stones.setMatrixAt(s++, _dummy.matrix);
      }

      for (let k = 0; k < p.logCount; k++) {
        const a = (k / p.logCount) * Math.PI * 2 + i * 0.4;
        _dummy.position.set(
          camp.x + Math.cos(a) * p.logBaseRadius,
          groundY,
          camp.z + Math.sin(a) * p.logBaseRadius,
        );
        // Tip the log's own +Y inward toward the fire's axis. The rotation
        // axis is the tangent at this log's foot — rotating about the radial
        // direction instead would roll the log rather than lean it.
        _axis.set(-Math.sin(a), 0, Math.cos(a));
        _dummy.quaternion.setFromAxisAngle(_axis, p.logLean * (0.9 + Math.random() * 0.2));
        _dummy.scale.setScalar(0.9 + Math.random() * 0.25);
        _dummy.updateMatrix();
        this.logs.setMatrixAt(l++, _dummy.matrix);
      }

      _dummy.position.set(camp.x, groundY + 0.02, camp.z);
      _dummy.quaternion.identity();
      _dummy.rotation.set(0, i * 1.1, 0);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      this.ash.setMatrixAt(i, _dummy.matrix);

      // A real `top` at the pyre's apex rather than the default Infinity: a
      // shot should pass over a fire, and the flame is not what stops it.
      addCircleCollider(
        camp.x, camp.z, p.colliderRadius, { kind: 'campfire' },
        groundY + Math.cos(p.logLean) * p.logLength,
      );
    });
    for (const m of [this.stones, this.logs, this.ash]) m.instanceMatrix.needsUpdate = true;
  }

  /**
   * Flame flicker and the smoke column. Called every frame for every camp,
   * however far away — see the file header.
   */
  update(dt) {
    const p = CAMP_PROPS;
    this._time += dt;
    _near.setHex(p.smokeNear);
    _far.setHex(p.smokeFar);
    _fade.setHex(COLORS.fog);
    const driftX = Math.cos(p.smokeDriftAngle) * p.smokeDrift;
    const driftZ = Math.sin(p.smokeDriftAngle) * p.smokeDrift;

    let f = 0;
    let k = 0;
    this.camps.forEach((camp, i) => {
      const groundY = this.baseY[i];

      for (let j = 0; j < p.flameCount; j++) {
        const phase = this._flamePhase[f];
        const wobble = Math.sin(this._time * p.flameFlickerRate + phase)
          + 0.4 * Math.sin(this._time * p.flameFlickerRate * 1.7 + phase * 2.3);
        // One central tongue, the rest on a slowly turning ring around it.
        const a = (j / p.flameCount) * Math.PI * 2 + this._time * p.flameSpin;
        const outer = j > 0;
        const r = outer ? p.flameSpread * (0.35 + (j / p.flameCount) * 0.8) : 0;
        _dummy.position.set(camp.x + Math.cos(a) * r, groundY, camp.z + Math.sin(a) * r);
        // The outer tongues lick OUTWARD, away from the axis, which is what
        // ragged the silhouette that the first version's upright cones lacked.
        _axis.set(-Math.sin(a), 0, Math.cos(a));
        _dummy.quaternion.setFromAxisAngle(_axis, outer ? -p.flameLean : 0);
        // Tall and thin, then short and fat — a tongue conserves its rough
        // volume as it licks up, which is what stops it reading as a cone
        // being scaled on a timer.
        const h = Math.max(0.25, this._flameScale[f] * (1 + wobble * p.flameFlicker));
        const w = 1 / Math.sqrt(h / this._flameScale[f]);
        _dummy.scale.set(w, h * (outer ? 1 : 1.35), w);
        _dummy.updateMatrix();
        this.flames.setMatrixAt(f++, _dummy.matrix);
      }

      for (let j = 0; j < p.smokeCount; j++) {
        // Each puff runs its own 0→1 life on a shared clock, offset by phase,
        // so the column is continuous rather than pulsing in batches.
        const t = (this._time * p.smokeSpeed + this._phase[k]) % 1;
        const size = THREE.MathUtils.lerp(p.smokeStartSize, p.smokeEndSize, t);
        // The column starts at the flame TIP, not above it: a visible gap
        // between fire and smoke is the first thing that gives the trick away.
        const wander = p.smokeJitter * t;
        _dummy.position.set(
          camp.x + driftX * t * t + this._jitter[k * 2] * wander,
          groundY + p.flameHeight * 0.55 + t * p.smokeRise,
          camp.z + driftZ * t * t + this._jitter[k * 2 + 1] * wander,
        );
        _dummy.quaternion.identity();
        _dummy.rotation.set(this._phase[k] * 6, t * 4 + this._phase[k] * 9, 0);
        // Slightly squashed: a puff spreads sideways faster than it stretches.
        _dummy.scale.set(size, size * 0.78, size);
        _dummy.updateMatrix();
        this.smoke.setMatrixAt(k, _dummy.matrix);
        // An InstancedMesh has ONE opacity for every instance, but it does have
        // a per-instance colour — so the column thins by going pale, which is
        // how smoke disappears anyway. Two stages, and the second is the one
        // that matters: it stays dark and readable for most of the rise, then
        // dissolves into the fog colour over the last stretch so the puff is
        // already invisible by the time it recycles to the bottom.
        _color.copy(_near).lerp(_far, t / p.smokeFadeFrom);
        if (t > p.smokeFadeFrom) {
          _color.lerp(_fade, (t - p.smokeFadeFrom) / (1 - p.smokeFadeFrom));
        }
        this.smoke.setColorAt(k, _color);
        k++;
      }
    });

    this.flames.instanceMatrix.needsUpdate = true;
    this.smoke.instanceMatrix.needsUpdate = true;
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
  }
}
