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

import { BANDIT, CAMPS, HEALTH } from './config-ai.js';
import { loadGLTF } from './assets.js';
import { createRigFromGLTF } from './character.js';
import { PlaceholderHuman } from './placeholder-human.js';
import { cloneRig } from './rig-clone.js';
import { mergeRigMeshes } from './rig-merge.js';
import { raycastCylinder } from './combat-ray.js';
import { Campfires } from './campfire.js';
import { Bandit } from './bandit.js';

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
    // Kept so a bandit can test the horse itself when nobody is riding it —
    // the collider above stays ignored either way. See HEALTH.horseMax.
    this.horse = horse ?? null;

    // A live copy of each CAMPS entry — the config stays immutable data.
    this.camps = CAMPS.map((c) => ({ ...c, alive: c.count }));
    // The signal fire is what makes a camp findable at all — see campfire.js.
    this.campfires = new Campfires(scene, this.camps, world);

    // Merge the ONE loaded rig before cloning it eleven times, so every clone
    // inherits the cheaper geometry and the work is done once. See rig-merge.js.
    if (gltf?.scene) this.meshMerge = mergeRigMeshes(gltf.scene);

    this.bandits = [];
    for (const camp of this.camps) {
      for (let i = 0; i < camp.count; i++) {
        const angle = (i / camp.count) * Math.PI * 2 + camp.x * 0.01;
        // 0.9x-1.4x, not 0.6x: the fire is now three metres of collider and a
        // man placed inside it would be shoved out by resolveCollisions on
        // frame one, which works and looks exactly like a bug.
        const r = camp.radius * (0.9 + Math.random() * 0.5);
        const x = camp.x + Math.cos(angle) * r;
        const z = camp.z + Math.sin(angle) * r;
        const character = this._makeRig(gltf);
        scene.add(character.root);
        const bandit = new Bandit({ character, world, group: this, camp, x, z });
        this.rayIgnore.add(bandit.collider);
        this.bandits.push(bandit);
      }
    }

    // Bodies waiting to be taken away — see _updateCorpses().
    this._corpses = [];

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
    // Unconditional, and BEFORE the activation gate below: the men freeze past
    // BANDIT.activeRadius, but a smoke column that only moves once you are
    // already standing in the camp is not a landmark.
    this.campfires.update(dt);
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
    this._updateCorpses(dt);
  }

  /**
   * Takes bodies away once they have finished falling.
   *
   * Deliberately outside the `activeRadius` gate above: a body you shot and
   * rode away from should still be gone when you come back, and clearing it is
   * a handful of arithmetic rather than a posed skeleton. A corpse that is
   * never cleared costs its draw calls forever, and draw calls are exactly
   * what round 5's town has to fit inside.
   */
  _updateCorpses(dt) {
    let live = 0;
    // Newest first, so the count below retires the oldest bodies rather than
    // whichever happens to sit early in the array.
    this._corpses.sort((a, b) => a.corpseT - b.corpseT);
    for (const b of this._corpses) {
      if (b.retired) continue;
      // Aged here rather than in Bandit.update(), which only runs inside
      // `activeRadius` — a body you rode away from should still be gone when
      // you come back.
      b.corpseT += dt;
      live++;
      // Past the cap, the oldest bodies start going immediately instead of
      // waiting out their linger.
      const crowded = live > BANDIT.maxCorpses;
      const age = b.corpseT - b.deathClipT;
      const linger = crowded ? 0 : BANDIT.corpseLinger;
      if (age < linger) continue;

      const sink = Math.min(1, (age - linger) / BANDIT.corpseSinkTime);
      b.character.root.position.y = b.position.y - sink * BANDIT.corpseSinkDepth;
      if (sink >= 1) {
        b.character.root.visible = false;
        b.retired = true;
        live--;
      }
    }
  }

  /** Called by a bandit as it dies, so the group can retire the body later. */
  addCorpse(bandit) {
    this._corpses.push(bandit);
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
