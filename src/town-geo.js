/**
 * town-geo.js — the part builder every piece of the town is assembled with.
 *
 * WHY THIS EXISTS RATHER THAN ONE MATERIAL PER SURFACE. Round 4 left the
 * draw-call budget as the binding constraint (docs/ROADMAP.md: "instance or
 * merge by material from the start rather than as a rescue"), and a town of ten
 * buildings, eight lamps, boardwalks, a hitching rail and a saloon's worth of
 * furniture is exactly the thing that spends it. Split by material — planks,
 * roof, trim, stone, paint — that is five or six meshes, doubled again by the
 * shadow pass.
 *
 * So the town does what `rig-merge.js` does to a character: **every part's flat
 * colour is baked into a vertex-colour attribute** and the whole lot is merged
 * into ONE geometry, drawn with one white `MeshStandardMaterial` that has
 * `vertexColors: true`. three multiplies the attribute by `material.color`, so
 * a white material plus per-vertex colour renders exactly as the per-material
 * colours it replaced. The result is **one opaque draw call for the entire
 * town**, plus one for the glass (which needs transparency and therefore its
 * own material).
 *
 * The cost of merging is that the town is one object with one bounding box, so
 * frustum culling can never skip part of it. That is the right trade at this
 * scale: it is a few thousand triangles either way, and a triangle you drew
 * needlessly is far cheaper than a draw call you issued needlessly.
 *
 * FRAMES. Buildings are far easier to author in their own space — local X along
 * the frontage, local Z into the depth, front wall at local -Z, origin on the
 * floor. `setFrame(x, y, z, yaw)` sets that up and every push after it is
 * transformed into the world. The yaw convention is the game's: yaw 0 faces -Z,
 * which is what makes a building's front direction the same expression
 * `camera.getForward()` uses.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _color = new THREE.Color();

/** Every geometry pushed here must agree on its attribute set, or the merge refuses. */
function normalise(geo, color) {
  // No part of the town is textured, so uv is dead weight that would also have
  // to match across every merged part. Same reasoning as rig-merge.js.
  geo.deleteAttribute('uv');
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  _color.setHex(color);
  // three's lights work in linear space; setHex defaults to sRGB and converts,
  // which is what makes a vertex colour match the material colour it replaces.
  for (let i = 0; i < count; i++) {
    arr[i * 3] = _color.r;
    arr[i * 3 + 1] = _color.g;
    arr[i * 3 + 2] = _color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  // mergeGeometries refuses a mix of indexed and non-indexed inputs, and every
  // three.js primitive is indexed while a hand-built one (the gable prism) is
  // not. A trivial index costs nothing and keeps the whole town in one merge.
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return geo;
}

export class PartBuilder {
  constructor() {
    /** @type {THREE.BufferGeometry[]} */
    this.parts = [];
    this._frame = new THREE.Matrix4();
    this._yaw = 0;
    this._origin = new THREE.Vector3();
  }

  /**
   * Everything pushed from here on is authored in a local frame at (x, y, z)
   * rotated `yaw` about Y. Pass no arguments to go back to world space.
   */
  setFrame(x = 0, y = 0, z = 0, yaw = 0) {
    this._yaw = yaw;
    this._origin.set(x, y, z);
    this._frame.makeRotationY(yaw).setPosition(x, y, z);
    return this;
  }

  /** The current frame's yaw — what a collider registered for a part needs. */
  get yaw() {
    return this._yaw;
  }

  /** Local (x, z) → world, for registering a collider under the live frame. */
  toWorld(lx, lz, out = new THREE.Vector3()) {
    const c = Math.cos(this._yaw);
    const s = Math.sin(this._yaw);
    return out.set(
      this._origin.x + lx * c + lz * s,
      this._origin.y,
      this._origin.z - lx * s + lz * c,
    );
  }

  /**
   * Adds an already-positioned local-space geometry, coloured and transformed
   * into the world. The geometry is consumed — do not reuse it.
   */
  push(geo, color) {
    normalise(geo, color);
    geo.applyMatrix4(this._frame);
    this.parts.push(geo);
    return this;
  }

  /** An axis-aligned box centred on local (x, y, z). */
  box(w, h, d, x, y, z, color) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return this.push(g, color);
  }

  /**
   * A box rotated about its own local Z (the axis a gabled roof slope turns
   * about when the ridge runs along X) or X, before being placed.
   */
  tiltedBox(w, h, d, x, y, z, color, { rotX = 0, rotZ = 0 } = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rotZ) g.rotateZ(rotZ);
    if (rotX) g.rotateX(rotX);
    g.translate(x, y, z);
    return this.push(g, color);
  }

  /** An upright cylinder whose BASE sits at local y — posts stand on their feet. */
  post(radiusTop, radiusBottom, h, x, y, z, color, segments = 8) {
    const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments);
    g.translate(x, y + h / 2, z);
    return this.push(g, color);
  }

  /** A cylinder lying along the local Z axis — a rail, a hitching bar. */
  rail(radius, length, x, y, z, color, segments = 6) {
    const g = new THREE.CylinderGeometry(radius, radius, length, segments);
    g.rotateX(Math.PI / 2); // +Y → +Z
    g.translate(x, y, z);
    return this.push(g, color);
  }

  /** A cone with its base at local y — a spire, a flame tongue. */
  spire(radius, h, x, y, z, color, segments = 8) {
    const g = new THREE.ConeGeometry(radius, h, segments);
    g.translate(x, y + h / 2, z);
    return this.push(g, color);
  }

  /**
   * A triangular prism: a gable roof, and the only shape here that is not a
   * three.js primitive.
   *
   * The triangle lies in the local Z/Y plane — base from `-halfBase` to
   * `+halfBase` in Z, apex `height` above it — and is extruded `length` along
   * local X. That is exactly a gabled roof over a frontage, and building it as
   * ONE solid rather than two thin slabs is what fills the gable ends: two
   * tilted slabs leave a triangular hole at each end of the ridge, which is the
   * kind of gap you only notice from the one angle you forgot to check.
   */
  prism(halfBase, height, length, x, y, z, color) {
    const hx = length / 2;
    // Triangle corners in the Z/Y plane, counter-clockwise seen from +X.
    const a = [-halfBase, 0];
    const b = [halfBase, 0];
    const c = [0, height];
    const tri = (za, ya, zb, yb, zc, yc, xa, xb, xc) => [
      xa, ya, za, xb, yb, zb, xc, yc, zc,
    ];
    const v = [
      // +X cap (wound so its normal points +X)
      ...tri(a[0], a[1], c[0], c[1], b[0], b[1], hx, hx, hx),
      // -X cap
      ...tri(a[0], a[1], b[0], b[1], c[0], c[1], -hx, -hx, -hx),
      // front slope (a→c), two triangles
      -hx, a[1], a[0], hx, a[1], a[0], hx, c[1], c[0],
      -hx, a[1], a[0], hx, c[1], c[0], -hx, c[1], c[0],
      // back slope (c→b)
      -hx, c[1], c[0], hx, c[1], c[0], hx, b[1], b[0],
      -hx, c[1], c[0], hx, b[1], b[0], -hx, b[1], b[0],
      // underside (b→a)
      -hx, b[1], b[0], hx, b[1], b[0], hx, a[1], a[0],
      -hx, b[1], b[0], hx, a[1], a[0], -hx, a[1], a[0],
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    g.translate(x, y, z);
    return this.push(g, color);
  }

  /** A four-sided pyramid, base at local y, aligned to the local axes. */
  pyramid(halfWidth, h, x, y, z, color) {
    const g = new THREE.ConeGeometry(halfWidth * Math.SQRT2, h, 4);
    g.rotateY(Math.PI / 4);
    g.translate(x, y + h / 2, z);
    return this.push(g, color);
  }

  get partCount() {
    return this.parts.length;
  }

  /**
   * Merges everything pushed so far into one mesh and adds it to `scene`.
   * Returns the mesh, or null if nothing was pushed.
   *
   * @param {object} opts `transparent`/`opacity` for the glass pass; the rest
   *   are the shading the whole merged group shares, which is why glass and
   *   opaque geometry go into two different builders rather than one.
   */
  finish(scene, { name = 'town', roughness = 0.9, metalness = 0, transparent = false, opacity = 1, castShadow = true, receiveShadow = true } = {}) {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    if (!merged) {
      console.warn(`[town-geo] "${name}" failed to merge — attribute mismatch.`);
      return null;
    }
    merged.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, // white, so the vertex colours come through unchanged
      vertexColors: true,
      roughness,
      metalness,
      transparent,
      opacity,
      // Glass panes are single quads with nothing behind them; without this the
      // ones facing away from the camera vanish.
      side: transparent ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: !transparent,
    });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    scene.add(mesh);
    return mesh;
  }
}
