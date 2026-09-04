/**
 * town-props.js — everything on the street that is not a building: the hitching
 * rail outside the saloon, its water trough, a few crates on the boardwalks, and
 * the street lamps.
 *
 * The static geometry all goes into the town's shared `PartBuilder`, so none of
 * it costs a draw call — it is already inside the one merged mesh (town-geo.js).
 * The lamps are the exception, and only half of them: a lamp's POST is static
 * and merges with everything else, while its GLOW has to flicker, be unlit, and
 * ignore fog, so it needs its own material and its own `InstancedMesh`. That is
 * `campfire.js`'s flame tier, reused exactly as docs/ROADMAP.md said it could be
 * ("Round 5's lamps and interior lights can take its flame tier as-is").
 *
 * ONE draw call for every lamp in town, plus three `PointLight`s. The lights are
 * kept to three deliberately: every one is compiled into every standard
 * material's shader in the scene, so the eight lamps carry the LOOK of a lit
 * street with unlit geometry and the three real lights are what will matter when
 * round 7 takes the sun down.
 */

import * as THREE from 'three';
import { TOWN } from './config.js';
import { HITCH, LAMPS, TOWN_BUILD, TOWN_COLORS, STREET, BUILDINGS } from './config-town.js';
import { addCircleCollider, addBoxCollider } from './collision.js';
import { resolvePlacement } from './buildings.js';

const _dummy = new THREE.Object3D();

/** A warm glow ball: a low-poly sphere, vertex-coloured hot in the middle. */
function makeGlowGeometry() {
  const geo = new THREE.IcosahedronGeometry(LAMPS.glowRadius, 1);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const hot = new THREE.Color(TOWN_COLORS.lampGlass);
  const edge = new THREE.Color(0xff9a3c);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Pale at the top of the ball, ember-orange at the bottom, so it reads as a
    // flame in a housing rather than as a glowing marble.
    const t = THREE.MathUtils.clamp((pos.getY(i) / LAMPS.glowRadius + 1) * 0.5, 0, 1);
    c.copy(edge).lerp(hot, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * The hitching rail, its trough, and the crates. All static, all merged.
 * @param {object} ctx `{ opaque, glass }` — the town's shared part builders
 */
export function buildTownProps(ctx) {
  const { opaque } = ctx;
  const y = TOWN.height;
  opaque.setFrame(0, y, 0, 0); // world space: the street furniture is axis-aligned

  // ------------------------------------------------------- hitching rail ---
  const half = HITCH.length / 2;
  for (const s of [-1, 1]) {
    const pz = HITCH.z + s * half;
    opaque.post(HITCH.postRadius, HITCH.postRadius * 1.2, HITCH.railHeight + 0.16,
      HITCH.x, 0, pz, TOWN_COLORS.plankDark, TOWN_BUILD.segments);
    addCircleCollider(HITCH.x, pz, HITCH.colliderRadius, { kind: 'hitch' }, y + HITCH.railHeight + 0.16);
  }
  opaque.rail(HITCH.railRadius, HITCH.length, HITCH.x, HITCH.railHeight, HITCH.z, TOWN_COLORS.plank);
  // The rail itself blocks, with a real `top` (ADR-012) so a round passes over
  // it — a hitching rail is chest-high on a man and no cover at all.
  addBoxCollider(HITCH.x, HITCH.z, HITCH.railRadius * 4, HITCH.length, 0,
    { kind: 'hitch' }, y + HITCH.railHeight);

  // -------------------------------------------------------------- trough ---
  const tx = HITCH.x - 0.2;
  // On the far side of the rail from the saloon's doorway — see HITCH.z.
  const tz = HITCH.z + half + 1.9;
  const tl = HITCH.troughLength;
  const tw = HITCH.troughWidth;
  const th = HITCH.troughHeight;
  const wall = HITCH.troughWall;
  opaque.box(tw, wall, tl, tx, wall / 2, tz, TOWN_COLORS.plankDark); // bottom
  for (const s of [-1, 1]) {
    opaque.box(tw, th, wall, tx, th / 2, tz + s * (tl / 2 - wall / 2), TOWN_COLORS.plankDark);
    opaque.box(wall, th, tl, tx + s * (tw / 2 - wall / 2), th / 2, tz, TOWN_COLORS.plankDark);
  }
  opaque.box(tw - wall * 2, 0.04, tl - wall * 2, tx, th - 0.1, tz, TOWN_COLORS.water);
  addBoxCollider(tx, tz, tw, tl, 0, { kind: 'trough' }, y + th);

  // -------------------------------------------------------------- crates ---
  // A handful, on the boardwalks of whichever buildings have one. Pure life:
  // they are inside the merged mesh, so they cost nothing but triangles.
  const crateHosts = ['general', 'gunsmith', 'sheriff', 'telegraph'];
  for (const kind of crateHosts) {
    const spec = BUILDINGS.find((b) => b.kind === kind);
    if (!spec) continue;
    const { cx, cz, yaw } = resolvePlacement(spec);
    opaque.setFrame(cx, y, cz, yaw);
    const front = -spec.d / 2;
    const bz = front - STREET.boardwalkDepth * 0.55;
    const size = 0.6;
    const crateTop = y + TOWN_BUILD.floorStep;
    for (const [lx, stacked, color] of [[spec.w / 2 - 1.0, true, TOWN_COLORS.plank], [-spec.w / 2 + 1.0, false, TOWN_COLORS.plankDark]]) {
      opaque.box(size, size, size, lx, TOWN_BUILD.floorStep + size / 2, bz, color);
      if (stacked) opaque.box(size * 0.9, size * 0.9, size * 0.9, lx, TOWN_BUILD.floorStep + size * 1.45, bz, TOWN_COLORS.plankPale);
      // A crate you walk through is worse than no crate. A real `top` at the
      // stack's shoulder keeps it shootable-over and jumpable, per ADR-012.
      const wp = opaque.toWorld(lx, bz);
      addCircleCollider(wp.x, wp.z, size * 0.72, { kind: 'crate' },
        crateTop + (stacked ? size * 1.9 : size));
    }
  }
  opaque.setFrame(0, y, 0, 0);
}

/**
 * The street lamps. Static posts into the shared builder; the glows into one
 * `InstancedMesh` of their own, flickering off a shared clock.
 */
export class StreetLamps {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./town-geo.js').PartBuilder} opaque the town's static builder
   */
  constructor(scene, opaque) {
    const L = LAMPS;
    const y = TOWN.height;
    this._time = 0;
    this.lit = true;
    this._phase = new Float32Array(L.posts.length);
    for (let i = 0; i < this._phase.length; i++) this._phase[i] = Math.random() * Math.PI * 2;

    opaque.setFrame(0, y, 0, 0);
    for (const p of L.posts) {
      opaque.post(L.baseRadius, L.baseRadius * 1.25, L.baseHeight, p.x, 0, p.z, TOWN_COLORS.iron, TOWN_BUILD.segments);
      opaque.post(L.postRadius, L.postRadius * 1.2, L.height, p.x, L.baseHeight, p.z, TOWN_COLORS.iron, TOWN_BUILD.segments);
      const hy = L.baseHeight + L.height;
      opaque.box(L.housingSize, L.housingHeight, L.housingSize, p.x, hy + L.housingHeight / 2, p.z, TOWN_COLORS.iron);
      opaque.pyramid(L.housingSize / 2 + L.capOverhang, 0.26, p.x, hy + L.housingHeight, p.z, TOWN_COLORS.iron);
      // A real `top` at the cap, so a shot passes over a lamp post rather than
      // being stopped by an infinitely tall two-inch pipe.
      addCircleCollider(p.x, p.z, L.colliderRadius, { kind: 'lamp' }, y + hy + L.housingHeight + 0.26);
    }

    this.glows = new THREE.InstancedMesh(
      makeGlowGeometry(),
      new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: L.glowOpacity,
        depthWrite: false, side: THREE.DoubleSide,
        // Not fogged, for campfire.js's reason: a light does not fade into the
        // haze the way a rock does, and a lit street seen down its own length is
        // the whole point of putting lamps on it.
        fog: false,
      }),
      L.posts.length,
    );
    this.glows.frustumCulled = false;
    this.glows.castShadow = false;
    scene.add(this.glows);

    /** @type {THREE.PointLight[]} */
    this.lights = L.points.map((spec) => {
      const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance);
      light.position.set(spec.x, TOWN.height + spec.y, spec.z);
      light.castShadow = false; // a shadow-casting point light is six more shadow passes
      scene.add(light);
      return light;
    });

    this.update(0);
  }

  /** Round 7's day/night owns this; until then the lamps are simply lit. */
  setLit(lit) {
    if (lit === this.lit) return;
    this.lit = lit;
    this.glows.visible = lit;
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].intensity = lit ? LAMPS.points[i].intensity : 0;
    }
  }

  update(dt) {
    if (!this.lit) return;
    this._time += dt;
    const L = LAMPS;
    const hy = TOWN.height + L.baseHeight + L.height + L.housingHeight * 0.55;
    for (let i = 0; i < L.posts.length; i++) {
      const p = L.posts[i];
      const flick = 1 + Math.sin(this._time * L.flickerRate + this._phase[i]) * L.flicker;
      _dummy.position.set(p.x, hy, p.z);
      _dummy.rotation.set(0, this._phase[i], 0);
      _dummy.scale.setScalar(flick);
      _dummy.updateMatrix();
      this.glows.setMatrixAt(i, _dummy.matrix);
    }
    this.glows.instanceMatrix.needsUpdate = true;
  }
}
