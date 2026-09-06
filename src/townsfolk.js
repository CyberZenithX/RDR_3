/**
 * townsfolk.js — the idle citizens. BUILD-PLAN.md: "Idle townsfolk NPCs that
 * wander a short patrol and turn to look at you when you pass."
 *
 * Built to bandits.js's shape on purpose, because round 4 already paid for that
 * shape: ONE GLB load, a `rig-clone.js` deep copy per body over shared geometry,
 * a merged rig (`rig-merge.js`) so a body is four draw calls rather than
 * seventeen, an `activeRadius` freeze, a shared ray-ignore set, and an explicit
 * foot-to-head cylinder for shots — because a character's collider is
 * `top: Infinity` by the collision contract and a round ten metres overhead
 * would otherwise "hit" one.
 *
 * THREE THINGS THAT ARE DELIBERATELY NOT LIKE A BANDIT:
 *
 *  - **They are `player.glb`, not `bandit.glb`.** There is no third humanoid to
 *    fetch (docs/ASSETS.md), and dressing the townsfolk in the enemy silhouette
 *    would put five men who read as bandits in the middle of town. Each one
 *    clones its own MATERIALS and multiplies a tint through them — which is safe
 *    here precisely where it is forbidden on a bandit: eleven bandits share one
 *    material by reference, a townsperson owns its copies.
 *  - **They are unarmed.** `weapon.setVisible(false)` — the revolver is built by
 *    `character.js` for every rig and this is the first caller of the switch
 *    `weapons.js` has carried unused since round 3.
 *  - **They carry `Health` and can be shot.** docs/ROADMAP.md asked for that
 *    decision to be made deliberately: round 6's wanted level is built on
 *    shooting innocents, and an invulnerable prop is a worse foundation than a
 *    man who bleeds. Being shot at makes the whole street run.
 *
 * One body and its brain are `townsperson.js`, split under the 400-line cap
 * along the same seam bandit.js/bandits.js is cut on.
 */

import * as THREE from 'three';
import { TOWNSFOLK } from './config-townsfolk.js';
import { HEALTH } from './config-ai.js';
import { loadGLTF } from './assets.js';
import { createRigFromGLTF } from './character.js';
import { PlaceholderHuman } from './placeholder-human.js';
import { cloneRig } from './rig-clone.js';
import { mergeRigMeshes } from './rig-merge.js';
import { raycastCylinder } from './combat-ray.js';
import { Townsperson } from './townsperson.js';

const _tint = new THREE.Color();

export class Townsfolk {
  constructor({ scene, world, gltf }) {
    this.world = world;
    // Every round the player lands on a citizen — a wounding as well as a kill —
    // ticks this. deputies.js reads the delta for the wanted meter (ADR-038),
    // which is how round 6's whole star system stays out of combat.js.
    this._crimes = 0;
    /** Colliders that shots and line-of-sight checks pass through — see the header. */
    this.rayIgnore = new Set();

    // Merge the ONE loaded rig before cloning it, so every clone inherits the
    // cheaper geometry and the work is done once. bandits.js's discipline.
    if (gltf?.scene) this.meshMerge = mergeRigMeshes(gltf.scene);

    this.people = [];
    for (const spawn of TOWNSFOLK.spawns) {
      const character = this._makeRig(gltf, spawn);
      scene.add(character.root);
      const person = new Townsperson({ character, world, group: this, spawn });
      this.rayIgnore.add(person.collider);
      this.people.push(person);
    }
    this.counts = { townsfolk: this.people.length };
    this.usingPlaceholders = this.people.some((p) => p.character.isPlaceholder);
  }

  /**
   * One townsperson's rig, tinted. A failed clone falls back to the procedural
   * placeholder rather than taking the boot down — BUILD-PLAN.md's rule.
   */
  _makeRig(gltf, spawn) {
    if (gltf) {
      try {
        const rig = createRigFromGLTF(
          { scene: cloneRig(gltf.scene), animations: gltf.animations },
          { height: TOWNSFOLK.modelHeight, label: 'townsfolk', path: TOWNSFOLK.modelPath },
        );
        this._tintRig(rig.root, TOWNSFOLK.tints[spawn.tint % TOWNSFOLK.tints.length]);
        return rig;
      } catch (err) {
        console.warn('[townsfolk] a rig failed to clone or animate — using capsule placeholder.', err);
      }
    }
    return new PlaceholderHuman();
  }

  /**
   * Gives this body its OWN materials and multiplies a tint through them.
   *
   * Safe here and forbidden on a bandit, for one reason: `cloneRig` shares
   * materials by reference, so recolouring in place would change every body at
   * once (that is why a bandit's hit reaction is a clip, not a colour flash).
   * Cloning first is what makes it a per-person change. Geometry stays shared —
   * that is where the memory actually is.
   */
  _tintRig(root, tint) {
    if (tint === 0xffffff) return;
    _tint.setHex(tint);
    root.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      o.material = o.material.clone();
      o.material.color.multiply(_tint);
    });
  }

  get count() {
    return this.people.length;
  }

  get aliveCount() {
    let n = 0;
    for (const p of this.people) if (p.alive) n++;
    return n;
  }

  /** Running total of rounds put into a citizen — round 6's wanted meter reads this. */
  get crimeCount() {
    return this._crimes;
  }

  /** The citizens who will meet you in the street — see duel.js. */
  get duelists() {
    return this.people.filter((p) => p.isDuelist && p.alive);
  }

  /** Every townsperson's state, for `window.__debug` and smoke.mjs. */
  get states() {
    return this.people.map((p) => p.state);
  }

  /**
   * Nearest living townsperson along the ray, written into `out` only if it
   * beats what `out` already holds — the shared contract from combat-ray.js,
   * and the same foot-to-head cylinder bandits.js uses.
   */
  raycast(origin, dir, maxDist, out) {
    let found = false;
    for (const p of this.people) {
      if (!p.alive) continue;
      if (raycastCylinder(
        origin, dir, maxDist, p.position.x, p.position.z,
        p.position.y, p.position.y + TOWNSFOLK.modelHeight, TOWNSFOLK.hitRadius, out,
      )) {
        out.kind = 'townsfolk';
        out.ref = p;
        out.collider = p.collider;
        found = true;
      }
    }
    return found;
  }

  /** A round landing on an innocent. Round 6's wanted level starts here. */
  hit(person, fromX, fromZ) {
    if (!person || !person.damage) return null;
    const outcome = person.damage(HEALTH.playerDamage, fromX, fromZ);
    if (outcome) this._crimes++; // a wounding counts, not only a kill
    return outcome;
  }

  /** A gunshot at (x, z): everyone within earshot runs. */
  hearShot(x, z) {
    if (x === undefined) return;
    for (const p of this.people) {
      if (!p.alive) continue;
      if (Math.hypot(p.position.x - x, p.position.z - z) <= TOWNSFOLK.panicHearingRange) p.panic(x, z);
    }
  }

  update(dt, player) {
    const r2 = TOWNSFOLK.activeRadius * TOWNSFOLK.activeRadius;
    for (const p of this.people) {
      const dx = p.position.x - player.position.x;
      const dz = p.position.z - player.position.z;
      // Frozen mid-idle past `activeRadius`, exactly as a far camp is. Ride out
      // to a bandit camp and the town stops costing twelve posed skeletons.
      if (dx * dx + dz * dz > r2) continue;
      p.update(dt, player);
    }
  }
}

/**
 * Builds the townsfolk. NEVER REJECTS: a missing or broken `player.glb` is one
 * warning and five capsule placeholders, not a failed boot — BUILD-PLAN.md's
 * rule for every round, and the crash round 3 shipped by wiring an `init()` step
 * to an optional asset without a guard.
 */
export async function buildTownsfolk(deps) {
  let gltf = null;
  try {
    gltf = await loadGLTF(TOWNSFOLK.modelPath);
  } catch (err) {
    console.warn(`[townsfolk] "${TOWNSFOLK.modelPath}" failed to load — townsfolk use capsule placeholders.`, err);
  }
  return new Townsfolk({ ...deps, gltf });
}
