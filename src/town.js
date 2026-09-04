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
import { buildBuilding, buildSaloonInterior } from './buildings.js';
import { buildTownProps, StreetLamps } from './town-props.js';
import { buildTownsfolk } from './townsfolk.js';

class Town {
  constructor(scene, world, townsfolk) {
    this.world = world;
    this.townsfolk = townsfolk;

    const opaque = new PartBuilder();
    const glass = new PartBuilder();
    const ctx = { opaque, glass };

    /** @type {object[]} every building's resolved placement, in BUILDINGS order. */
    this.buildings = BUILDINGS.map((spec) => buildBuilding(spec, ctx));
    this.saloon = this.buildings.find((b) => b.spec.interior) ?? null;
    if (this.saloon) buildSaloonInterior(this.saloon, ctx);
    buildTownProps(ctx);
    this.lamps = new StreetLamps(scene, opaque);

    this.mesh = opaque.finish(scene, { name: 'town', roughness: 0.9 });
    this.glassMesh = glass.finish(scene, {
      name: 'town-glass', roughness: 0.25, metalness: 0.1,
      transparent: true, opacity: 0.42, castShadow: false,
    });

    /** Where the horse waits — horse.setHitchPost() takes this straight. */
    this.hitch = {
      x: HITCH.standX, z: HITCH.standZ, yaw: HITCH.standYaw,
      callRadius: HITCH.callRadius, arriveDistance: HITCH.arriveDistance,
      railX: HITCH.x, railZ: HITCH.z,
    };

    // Door-trigger state.
    this.inside = false;
    this.placeName = null;
    this.fade = 0; // 0..1 screen opacity; ui.js renders it
    this._phase = 'none'; // 'none' | 'out' | 'hold' | 'in'
    this._phaseT = 0;
    this._cooldown = 0;

    this.counts = {
      buildings: this.buildings.length,
      lamps: this.lamps.lights.length,
      townsfolk: townsfolk?.count ?? 0,
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
