/**
 * bandits.js — the camps: loads `bandit.glb` ONCE, clones a rig per bandit,
 * places them around a campfire, and owns everything that is a property of the
 * group rather than of one man — the shared ray-ignore set, the activation
 * radius, the "a shot was fired near you" broadcast, and the ray query the
 * player's revolver hits them through.
 *
 * ONE DOWNLOAD, ELEVEN BODIES. `rig-clone.js` does the skinned deep-copy that
 * `Object3D.clone()` cannot; the clip array is shared, because AnimationMixer
 * binds tracks by node name. Loading the 1.37MB GLB eleven times would work
 * and would cost eleven copies of every buffer on the GPU.
 *
 * WHY THE PLAYER'S SHOTS COME THROUGH HERE rather than through the collider
 * list: a bandit's movement collider is `top: Infinity` by the collision
 * contract (a character is not something to be jumped over), so a shot passing
 * ten metres above one would "hit" it. So every bandit collider goes into
 * `rayIgnore`, combat.js adds that set to its own, and `raycast()` below tests
 * an exact foot-to-head cylinder instead — the same shape targets.js uses for
 * a bottle standing on a barrel lid.
 */

import * as THREE from 'three';
import { BANDIT, CAMPS, CAMP_PROPS, HEALTH } from './config-ai.js';
import { loadGLTF } from './assets.js';
import { createRigFromGLTF } from './character.js';
import { PlaceholderHuman } from './placeholder-human.js';
import { cloneRig } from './rig-clone.js';
import { addCircleCollider } from './collision.js';
import { raycastCylinder } from './combat-ray.js';
import { Bandit } from './bandit.js';

const _dummy = new THREE.Object3D();

/** A ring of fire stones and a few fallen logs, so a camp reads as a place. */
function buildCampfires(scene, camps, world) {
  const p = CAMP_PROPS;
  const stoneGeo = new THREE.IcosahedronGeometry(p.stoneRadius, 0);
  const logGeo = new THREE.CylinderGeometry(p.logRadius, p.logRadius * 0.8, p.logLength, 6);
  logGeo.rotateZ(Math.PI / 2);
  const ashGeo = new THREE.CircleGeometry(p.ashRadius, 12);
  ashGeo.rotateX(-Math.PI / 2);

  const stones = new THREE.InstancedMesh(
    stoneGeo, new THREE.MeshStandardMaterial({ color: p.stoneColor, roughness: 0.95 }),
    camps.length * p.stoneCount,
  );
  const logs = new THREE.InstancedMesh(
    logGeo, new THREE.MeshStandardMaterial({ color: p.logColor, roughness: 0.9 }),
    camps.length * p.logCount,
  );
  const ash = new THREE.InstancedMesh(
    ashGeo, new THREE.MeshStandardMaterial({ color: p.ashColor, roughness: 1 }),
    camps.length,
  );

  let s = 0;
  let l = 0;
  camps.forEach((camp, i) => {
    const groundY = world.groundHeightAt(camp.x, camp.z);
    for (let k = 0; k < p.stoneCount; k++) {
      const a = (k / p.stoneCount) * Math.PI * 2;
      const r = p.stoneRingRadius * (0.9 + Math.random() * 0.2);
      const x = camp.x + Math.cos(a) * r;
      const z = camp.z + Math.sin(a) * r;
      _dummy.position.set(x, world.groundHeightAt(x, z) + p.stoneRadius * 0.4, z);
      _dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      _dummy.scale.setScalar(0.7 + Math.random() * 0.6);
      _dummy.updateMatrix();
      stones.setMatrixAt(s++, _dummy.matrix);
    }
    for (let k = 0; k < p.logCount; k++) {
      const a = (k / p.logCount) * Math.PI + i;
      _dummy.position.set(camp.x, groundY + p.logRadius * 1.6, camp.z);
      _dummy.rotation.set(0, a, (k % 2 ? 1 : -1) * 0.22);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      logs.setMatrixAt(l++, _dummy.matrix);
    }
    _dummy.position.set(camp.x, groundY + 0.02, camp.z);
    _dummy.rotation.set(0, i * 1.1, 0);
    _dummy.scale.setScalar(1);
    _dummy.updateMatrix();
    ash.setMatrixAt(i, _dummy.matrix);
    // You cannot walk through a fire. `top` stays Infinity: a hopping horse
    // clearing a campfire is not a thing this round needs to get right.
    addCircleCollider(camp.x, camp.z, p.colliderRadius, { kind: 'campfire' });
  });

  for (const m of [stones, logs, ash]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.instanceMatrix.needsUpdate = true;
    scene.add(m);
  }
  return { stones, logs, ash };
}

export class Bandits {
  constructor({ scene, world, vfx, audio, targets, horse, gltf }) {
    this.scene = scene;
    this.world = world;
    this.vfx = vfx;
    this.audio = audio;
    this.targets = targets;

    /**
     * Colliders every bandit's own shots and line-of-sight checks pass
     * through: all the bandits (so a camp does not shoot itself in the back,
     * and so the player's shots reach a body rather than its movement circle)
     * plus the horse (whose collider sits directly under a mounted rider and
     * would otherwise make riding into a fight a form of invulnerability).
     */
    this.rayIgnore = new Set();
    if (horse?.collider) this.rayIgnore.add(horse.collider);

    // A live copy of each CAMPS entry — the config stays immutable data.
    this.camps = CAMPS.map((c) => ({ ...c, alive: c.count }));
    this.campfires = buildCampfires(scene, this.camps, world);

    this.bandits = [];
    for (const camp of this.camps) {
      for (let i = 0; i < camp.count; i++) {
        const angle = (i / camp.count) * Math.PI * 2 + camp.x * 0.01;
        const r = camp.radius * (0.6 + Math.random() * 0.5);
        const x = camp.x + Math.cos(angle) * r;
        const z = camp.z + Math.sin(angle) * r;
        const character = this._makeRig(gltf);
        scene.add(character.root);
        const bandit = new Bandit({ character, world, group: this, camp, x, z });
        this.rayIgnore.add(bandit.collider);
        this.bandits.push(bandit);
      }
    }

    this.counts = { camps: this.camps.length, bandits: this.bandits.length };
    this.usingPlaceholders = this.bandits.some((b) => b.character.isPlaceholder);
  }

  /**
   * One bandit's rig. A failed clone or a rig that cannot animate falls back
   * to the procedural placeholder rather than taking the boot down with it —
   * BUILD-PLAN.md's rule, and the exact failure mode round 3 shipped once.
   */
  _makeRig(gltf) {
    if (gltf) {
      try {
        return createRigFromGLTF(
          { scene: cloneRig(gltf.scene), animations: gltf.animations },
          { height: BANDIT.modelHeight, label: 'bandit', path: BANDIT.modelPath },
        );
      } catch (err) {
        console.warn('[bandits] a bandit rig failed to clone or animate — using capsule placeholder.', err);
      }
    }
    return new PlaceholderHuman();
  }

  get aliveCount() {
    let n = 0;
    for (const b of this.bandits) if (b.alive) n++;
    return n;
  }

  /** Every bandit's state, for `window.__debug` and smoke.mjs. */
  get states() {
    return this.bandits.map((b) => b.ai.state);
  }

  /**
   * Nearest live bandit along the ray, written into `out` only if it beats
   * what `out` already holds — the shared contract from combat-ray.js.
   * A foot-to-head cylinder, not the movement collider; see the file header.
   */
  raycast(origin, dir, maxDist, out) {
    let found = false;
    for (const b of this.bandits) {
      if (!b.alive) continue;
      if (raycastCylinder(
        origin, dir, maxDist, b.position.x, b.position.z,
        b.position.y, b.position.y + BANDIT.modelHeight, BANDIT.hitRadius, out,
      )) {
        out.kind = 'bandit';
        out.ref = b;
        out.collider = b.collider;
        found = true;
      }
    }
    return found;
  }

  /**
   * The player's round landing. Returns 'dead' | 'hit' | null so combat.js can
   * pick an effect without knowing how much punishment a bandit takes — the
   * same shape `Targets.hit()` already returns.
   */
  hit(bandit, fromX, fromZ) {
    if (!bandit || !bandit.damage) return null;
    // No broadcast here: combat.js calls hearShot() on every trigger pull,
    // hit or miss, and the victim's own alert is inside `Bandit.damage`.
    return bandit.damage(HEALTH.playerDamage, fromX, fromZ);
  }

  /**
   * A gunshot at (x, z). Every bandit within `BANDIT.hearingRange` starts
   * looking. Without this you can take a camp apart one man at a time while
   * the others stand around, which reads as broken rather than as stealth.
   */
  hearShot(x, z) {
    if (x === undefined) return;
    for (const b of this.bandits) {
      if (!b.alive) continue;
      if (Math.hypot(b.position.x - x, b.position.z - z) <= BANDIT.hearingRange) b.ai.alert(x, z);
    }
  }

  /**
   * @param {number} dt
   * @param {object} player round 4's Player — read for position and health,
   *   and written to for the checkpoint a camp arms (see player.markCamp).
   */
  update(dt, player) {
    for (const camp of this.camps) {
      if (Math.hypot(player.position.x - camp.x, player.position.z - camp.z) <= BANDIT.campApproachRadius) {
        player.markCamp(camp);
      }
    }
    const r2 = BANDIT.activeRadius * BANDIT.activeRadius;
    for (const b of this.bandits) {
      const dx = b.position.x - player.position.x;
      const dz = b.position.z - player.position.z;
      // Far camps are frozen mid-idle rather than ticked. They stay rendered;
      // frustum culling deals with the ones behind you. See BANDIT.activeRadius.
      if (dx * dx + dz * dz > r2) continue;
      b.update(dt, player);
    }
  }
}

/**
 * Builds every camp. NEVER REJECTS: a missing or broken `bandit.glb` is one
 * warning and eleven capsule placeholders, not a failed boot — BUILD-PLAN.md's
 * rule for every round, and the specific crash round 3 shipped by wiring an
 * `init()` step to an optional asset without a guard.
 */
export async function buildBandits(deps) {
  let gltf = null;
  try {
    gltf = await loadGLTF(BANDIT.modelPath);
  } catch (err) {
    console.warn(`[bandits] "${BANDIT.modelPath}" failed to load — bandits use capsule placeholders.`, err);
  }
  return new Bandits({ ...deps, gltf });
}
