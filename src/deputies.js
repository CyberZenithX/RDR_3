/**
 * deputies.js — the wanted level, and the lawmen it calls out.
 *
 * BUILD-PLAN.md round 6: "Wanted level rises if you shoot innocents, shown as
 * a star meter; deputies spawn and hunt you, and the level decays if you get
 * clear of town."
 *
 * THE STAR METER is driven entirely off `Townsfolk`'s own crime tally
 * (ADR-038): every round that lands on an innocent bumps `townsfolk.crimeCount`
 * inside `Townsfolk.hit()`, and this file reads the delta. `combat.js` needs to
 * know deputies exist only so its shots can hit them — the wanted level itself
 * never touches it.
 *
 * A DEPUTY IS A BANDIT (bandit.js + bandit-ai.js) with a different spawn source
 * (ADR-036). The pool is built once, parked far outside the world — colliders
 * and all — and teleported in around the player when the meter rises. When it
 * clears they are stood down (alerted → false) and parked again once they fall
 * behind; they are never killed to clean them up. A deputy that *does* die is
 * spent for the session, so the pool is sized for a couple of waves.
 */

import { TOWN } from './config.js';
import { BANDIT, HEALTH } from './config-ai.js';
import { WANTED, DEPUTY } from './config-bounty.js';
import { loadGLTF } from './assets.js';
import { createRigFromGLTF } from './character.js';
import { PlaceholderHuman } from './placeholder-human.js';
import { cloneRig } from './rig-clone.js';
import { raycastCylinder } from './combat-ray.js';
import { Bandit } from './bandit.js';

export class Deputies {
  /**
   * @param {object} deps scene, world, vfx, audio, targets, horse, and `gltf`
   *   — the ONE already-loaded `bandit.glb` from bandits.js, reused rather than
   *   downloaded twice. Null `gltf` falls the whole pool back to capsules.
   */
  constructor({ scene, world, vfx, audio, targets, horse, gltf }) {
    this.world = world;
    this.vfx = vfx;
    this.audio = audio;
    this.targets = targets;
    this.horse = horse ?? null;

    this.stars = 0;
    this._crimesSeen = 0;
    this._decayT = 0;

    // The mini "group" surface bandit.js / bandit-gun.js reach back through.
    this.rayIgnore = new Set();
    if (horse?.collider) this.rayIgnore.add(horse.collider);
    // A synthetic camp: count 1 so bandit-ai's `campWiped` flee never triggers
    // — deputies are called off, not routed.
    this.camp = { name: 'law', x: TOWN.centerX, z: TOWN.centerZ, count: 1, alive: 1 };

    this.deputies = [];
    this._corpses = [];
    for (let i = 0; i < DEPUTY.poolSize; i++) {
      const character = this._makeRig(gltf);
      scene.add(character.root);
      const d = new Bandit({
        character, world, group: this, camp: this.camp,
        x: DEPUTY.parkX, z: DEPUTY.parkZ,
      });
      d.active = false;
      d.character.root.visible = false;
      this.rayIgnore.add(d.collider);
      this.deputies.push(d);
    }
    this.usingPlaceholders = this.deputies.some((d) => d.character.isPlaceholder);
  }

  _makeRig(gltf) {
    if (gltf) {
      try {
        return createRigFromGLTF(
          { scene: cloneRig(gltf.scene), animations: gltf.animations },
          { height: BANDIT.modelHeight, label: 'deputy', path: BANDIT.modelPath },
        );
      } catch (err) {
        console.warn('[deputies] a rig failed to clone or animate — using capsule placeholder.', err);
      }
    }
    return new PlaceholderHuman();
  }

  get activeCount() {
    let n = 0;
    for (const d of this.deputies) if (d.active && d.alive) n++;
    return n;
  }

  /** Every active deputy's AI state, for `window.__debug` and smoke.mjs. */
  get states() {
    return this.deputies.filter((d) => d.active).map((d) => d.ai.state);
  }

  /** Nearest active deputy along the ray — the shared combat-ray.js contract. */
  raycast(origin, dir, maxDist, out) {
    let found = false;
    for (const d of this.deputies) {
      if (!d.active || !d.alive) continue;
      if (raycastCylinder(
        origin, dir, maxDist, d.position.x, d.position.z,
        d.position.y, d.position.y + BANDIT.modelHeight, BANDIT.hitRadius, out,
      )) {
        out.kind = 'deputy';
        out.ref = d;
        out.collider = d.collider;
        found = true;
      }
    }
    return found;
  }

  /** The player's round landing on a deputy. 'dead' | 'hit' | null. */
  hit(deputy, fromX, fromZ) {
    if (!deputy || !deputy.damage) return null;
    return deputy.damage(HEALTH.playerDamage, fromX, fromZ);
  }

  /** A gunshot near an active deputy puts it onto the player. */
  hearShot(x, z) {
    if (x === undefined) return;
    for (const d of this.deputies) {
      if (d.active && d.alive
        && Math.hypot(d.position.x - x, d.position.z - z) <= BANDIT.hearingRange) {
        d.ai.alert(x, z);
      }
    }
  }

  /** Called by a deputy's Bandit._die so its body ages like a bandit's. */
  addCorpse(deputy) {
    this._corpses.push(deputy);
  }

  update(dt, player, townsfolk) {
    // ---------------------------------------------------------- star meter ---
    const crimes = townsfolk?.crimeCount ?? 0;
    if (crimes > this._crimesSeen) {
      this.stars = Math.min(WANTED.maxStars, this.stars + (crimes - this._crimesSeen) * WANTED.perCrime);
      this._crimesSeen = crimes;
    }

    if (player.dead) {
      this.stars = 0;
      this._decayT = 0;
    } else if (this.stars > 0) {
      const fromTown = Math.hypot(player.position.x - TOWN.centerX, player.position.z - TOWN.centerZ);
      if (fromTown > WANTED.clearRadius) {
        this._decayT += dt;
        if (this._decayT >= WANTED.decayInterval) { this.stars--; this._decayT = 0; }
      } else {
        this._decayT = 0;
      }
    }

    // ---------------------------------------------------------- deployment ---
    const wanted = this.stars >= DEPUTY.spawnStars;
    if (wanted) {
      const desired = Math.min(DEPUTY.maxActive, this.stars + 1);
      let live = this.activeCount;
      for (const d of this.deputies) {
        if (live >= desired) break;
        if (d.active || !d.alive) continue;
        this._deploy(d, player);
        live++;
      }
    } else {
      for (const d of this.deputies) {
        if (!d.active) continue;
        d.ai.alerted = false;
        d.ai.memory = 0;
        d.ai.alertTimer = 0;
        const far = Math.hypot(d.position.x - player.position.x, d.position.z - player.position.z) > DEPUTY.despawnRadius;
        if (far || player.dead) this._park(d);
      }
    }

    // -------------------------------------------------------------- ticking ---
    for (const d of this.deputies) {
      if (d.active && d.alive) {
        d.update(dt, player);
      } else if (!d.alive) {
        d.corpseT = (d.corpseT ?? 0) + dt;
        if (d.corpseT <= (d.deathClipT ?? 0)) {
          d.character.update(dt);
        } else {
          const age = d.corpseT - d.deathClipT;
          if (age > BANDIT.corpseLinger) {
            const sink = Math.min(1, (age - BANDIT.corpseLinger) / BANDIT.corpseSinkTime);
            d.character.root.position.y = d.position.y - sink * BANDIT.corpseSinkDepth;
            if (sink >= 1) d.character.root.visible = false;
          }
        }
      }
    }
  }

  _deploy(d, player) {
    const a = Math.random() * Math.PI * 2;
    const sx = player.position.x + Math.cos(a) * DEPUTY.spawnRadius;
    const sz = player.position.z + Math.sin(a) * DEPUTY.spawnRadius;
    d.position.set(sx, this.world.groundHeightAt(sx, sz), sz);
    d.velocityXZ.set(0, 0, 0);
    d.speed = 0;
    d.yaw = Math.atan2(-(player.position.x - sx), -(player.position.z - sz));
    if (d.collider) { d.collider.x = sx; d.collider.z = sz; }
    d.character.root.visible = true;
    d.character.root.position.copy(d.position);
    d.ai.anchor.copy(d.position);
    d.ai.alert(player.position.x, player.position.z);
    d.active = true;
  }

  _park(d) {
    d.position.set(DEPUTY.parkX, 0, DEPUTY.parkZ);
    if (d.collider) { d.collider.x = DEPUTY.parkX; d.collider.z = DEPUTY.parkZ; }
    d.velocityXZ.set(0, 0, 0);
    d.speed = 0;
    d.character.root.visible = false;
    d.character.root.position.copy(d.position);
    d.ai.state = 'patrol';
    d.ai.anchor.copy(d.position);
    d.ai.patrolTarget.copy(d.position);
    d.active = false;
  }
}

/**
 * Builds the deputy pool. NEVER REJECTS: reuses bandits.js's already-loaded
 * `bandit.glb` when it can, and falls the pool back to capsule placeholders
 * when it cannot — BUILD-PLAN.md's rule for every round.
 */
export async function buildDeputies(deps) {
  let gltf = deps.gltf ?? null;
  if (!gltf) {
    try {
      gltf = await loadGLTF(BANDIT.modelPath);
    } catch (err) {
      console.warn(`[deputies] "${BANDIT.modelPath}" failed to load — deputies use capsule placeholders.`, err);
    }
  }
  return new Deputies({ ...deps, gltf });
}
