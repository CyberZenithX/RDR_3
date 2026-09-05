/**
 * town.js — the town, assembled. world.js's role for round 5: it owns no
 * geometry itself, it wires buildings.js, town-props.js and townsfolk.js
 * together, and it owns the two things that are properties of the town as a
 * whole rather than of any one building — the saloon's door trigger and the
 * hitching post the horse waits at.
 *
 * ONE MERGED MESH FOR THE WHOLE TOWN. Every static part goes into one of two
 * shared `PartBuilder`s (opaque and glass, split because glass needs
 * transparency and therefore its own material), and both are `finish()`ed once
 * at the end. See town-geo.js for why — round 4 left the draw-call budget as
 * the binding constraint and ten buildings is exactly the thing that spends it.
 *
 * THE DOOR TRIGGER. BUILD-PLAN.md asks for "a walkable interior for the saloon
 * at minimum, with a door trigger that fades in and out". The interior is
 * genuinely walkable — the doorway is a gap in a real wall, there is no teleport
 * and no second scene — so the fade is a flourish over a threshold you could
 * simply have stepped across. It is therefore kept short and metered (`DOOR`),
 * with a dead band so standing in the doorway cannot strobe it and a cooldown so
 * pacing in and out cannot stutter it. `DOOR.enabled = false` turns it off
 * without touching the doorway.
 */

import { TOWN } from './config.js';
import { BUILDINGS, DOOR, HITCH, TOWN_BUILD } from './config-town.js';
import { PartBuilder } from './town-geo.js';
import { buildSignAtlas } from './signs.js';
import { buildBuilding, buildSaloonInterior, signBoardSize } from './buildings.js';
import { buildTownProps, StreetLamps } from './town-props.js';
import { buildTownsfolk } from './townsfolk.js';

class Town {
  constructor(scene, world, townsfolk) {
    this.world = world;
    this.townsfolk = townsfolk;

    const opaque = new PartBuilder();
    const glass = new PartBuilder();
    // Textured, so it keeps UVs and carries no vertex colour — the shop signs
    // are the one part of the town with a `map`. Drawn BEFORE any building,
    // because it is what supplies each sign quad's UVs.
    const signs = new PartBuilder({ textured: true });
    this.signAtlas = buildSignAtlas(BUILDINGS.map((spec) => {
      const size = signBoardSize(spec);
      return {
        // `signText` where the name alone does not say what the place IS.
        text: spec.signText ?? spec.name,
        background: spec.sign,
        aspect: size.w / size.h,
      };
    }));
    const ctx = { opaque, glass, signs, atlas: this.signAtlas };

    /** @type {object[]} every building's resolved placement, in BUILDINGS order. */
    this.buildings = BUILDINGS.map((spec, i) => buildBuilding(spec, ctx, i));
    this.saloon = this.buildings.find((b) => b.spec.interior) ?? null;
    if (this.saloon) buildSaloonInterior(this.saloon, ctx);
    buildTownProps(ctx);
    this.lamps = new StreetLamps(scene, opaque);

    this.mesh = opaque.finish(scene, { name: 'town', roughness: 0.9 });
    this.glassMesh = glass.finish(scene, {
      name: 'town-glass', roughness: 0.25, metalness: 0.1,
      transparent: true, opacity: 0.42, castShadow: false,
    });
    // No shadow: the lettering sits 14mm off a board it exactly covers, and a
    // coplanar caster is a shadow-map fight for nothing.
    this.signMesh = signs.finish(scene, {
      name: 'town-signs', roughness: 0.82, map: this.signAtlas.texture, castShadow: false,
    });

    /** Where the horse waits — horse.setHitchPost() takes this straight. */
    this.hitch = {
      x: HITCH.standX, z: HITCH.standZ, yaw: HITCH.standYaw,
      callRadius: HITCH.callRadius, arriveDistance: HITCH.arriveDistance,
      railX: HITCH.x, railZ: HITCH.z,
    };

    // Door-trigger state.
    this.inside = false;
    this.placeName = null; // the building you are INSIDE, or null
    this.signName = null; // ...or the one whose frontage you are standing at
    this.fade = 0; // 0..1 screen opacity; ui.js renders it
    this._phase = 'none'; // 'none' | 'out' | 'hold' | 'in'
    this._phaseT = 0;
    this._cooldown = 0;

    this.counts = {
      buildings: this.buildings.length,
      lamps: this.lamps.lights.length,
      townsfolk: townsfolk?.count ?? 0,
      signs: this.signAtlas.count,
      parts: this.mesh ? this.mesh.geometry.attributes.position.count : 0,
    };
  }

  /**
   * Is this world position inside the saloon? Takes an explicit hysteresis
   * margin: positive insets the room (harder to be counted inside), negative
   * grows it (harder to be counted out). Used with `DOOR.deadBand` in both
   * directions, which is what stops a player loitering on the threshold from
   * flickering the trigger sixty times a second.
   */
  isInsideSaloon(x, z, margin = 0) {
    const s = this.saloon;
    if (!s || !s.interiorBox) return false;
    const dx = x - s.cx;
    const dz = z - s.cz;
    // World → the saloon's own frame; same convention as the box colliders.
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    const lx = dx * c - dz * sn;
    const lz = dx * sn + dz * c;
    const { hw, hd } = s.interiorBox;
    return Math.abs(lx) <= hw - margin && lz >= -hd + margin && lz <= hd;
  }

  /**
   * What the HUD should call where the player is standing: the room they are in,
   * or the shop whose frontage they are at, or nothing.
   *
   * The painted sign is the real answer to "what is this place" — this is the
   * backstop for standing under an awning, where the sign is directly overhead
   * and out of shot.
   */
  get label() {
    return this.placeName ?? this.signName;
  }

  /** Nearest building frontage the player is standing at, or null. */
  _frontageName(x, z) {
    const t = TOWN_BUILD;
    let best = null;
    let bestDist = Infinity;
    for (const b of this.buildings) {
      const dx = x - b.cx;
      const dz = z - b.cz;
      // World → the building's own frame, same convention as its box colliders.
      const c = Math.cos(b.yaw);
      const sn = Math.sin(b.yaw);
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      // In front of the frontage, not beside it and not round the back.
      const depth = -(lz - b.frontZ);
      if (depth < 0 || depth > t.labelRange) continue;
      if (Math.abs(lx) > b.spec.w / 2 + t.labelSideMargin) continue;
      if (depth < bestDist) { bestDist = depth; best = b.spec.name; }
    }
    return best;
  }

  /** World Y of the saloon's floorboards. */
  get saloonFloorY() {
    return TOWN.height + TOWN_BUILD.floorStep;
  }

  update(dt, player) {
    this.lamps.update(dt);
    this.townsfolk?.update(dt, player);
    this._updateDoor(dt, player);
  }

  _updateDoor(dt, player) {
    // A dead player is a body sliding about, not someone walking through a door.
    const insideNow = !player.dead && this.isInsideSaloon(
      player.position.x, player.position.z,
      this.inside ? -DOOR.deadBand : DOOR.deadBand,
    );
    this.signName = player.dead ? null : this._frontageName(player.position.x, player.position.z);
    this._cooldown = Math.max(0, this._cooldown - dt);
    if (insideNow !== this.inside) {
      this.inside = insideNow;
      this.placeName = insideNow ? this.saloon.spec.name : null;
      if (DOOR.enabled && this._cooldown <= 0) {
        this._phase = 'out';
        this._phaseT = 0;
        this._cooldown = DOOR.cooldown;
      }
    }
    this._advanceFade(dt);
  }

  /** Black over `fadeOut`, hold, then back over `fadeIn`. */
  _advanceFade(dt) {
    if (this._phase === 'none') return;
    this._phaseT += dt;
    if (this._phase === 'out') {
      this.fade = Math.min(1, this._phaseT / DOOR.fadeOut) * DOOR.maxOpacity;
      if (this._phaseT >= DOOR.fadeOut) { this._phase = 'hold'; this._phaseT = 0; }
      return;
    }
    if (this._phase === 'hold') {
      this.fade = DOOR.maxOpacity;
      if (this._phaseT >= DOOR.fadeHold) { this._phase = 'in'; this._phaseT = 0; }
      return;
    }
    this.fade = Math.max(0, 1 - this._phaseT / DOOR.fadeIn) * DOOR.maxOpacity;
    if (this._phaseT >= DOOR.fadeIn) { this._phase = 'none'; this._phaseT = 0; this.fade = 0; }
  }
}

/**
 * Builds the town. NEVER REJECTS: the townsfolk's GLB is optional (they fall
 * back to capsule placeholders) and everything else is procedural, so this
 * cannot be the step that takes `init()` down — BUILD-PLAN.md's rule, and the
 * exact crash round 3 shipped by wiring a load step to an optional asset.
 */
export async function buildTown(scene, world) {
  const townsfolk = await buildTownsfolk({ scene, world });
  return new Town(scene, world, townsfolk);
}
