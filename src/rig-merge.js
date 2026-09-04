/**
 * rig-merge.js — collapses a character GLB's many little meshes into a handful,
 * to buy back draw calls.
 *
 * WHY THIS EXISTS. These Quaternius characters are modelled as one mesh per
 * colour: measured on the live rigs, a bandit is 16 meshes across 12 materials,
 * the player 17, the horse 8. Every one of those is its own draw call, and
 * again in the shadow pass. Measured directly at Coyote Wash: a camp with ten
 * men cost 110 draw calls against BUILD-PLAN.md's ~120 budget, and killing five
 * of them took it to 46 — about 13 calls per body. Round 5 has to fit a whole
 * town inside what is left, so bodies cannot cost that.
 *
 * WHY VERTEX COLOURS ARE SAFE HERE. Not one material on any of the three rigs
 * carries a texture — no map, no normalMap, no emissiveMap (verified by reading
 * every material on the loaded rigs). They are flat colours, which is exactly
 * the case a `color` attribute reproduces exactly: three multiplies the
 * attribute by `material.color`, so a white material plus per-vertex colour
 * renders identically to the per-material colour it replaced.
 *
 * WHAT IS NOT MERGED, and why it matters more than what is:
 *
 *  - Meshes are grouped by their **shading** (roughness/metalness), never
 *    flattened into one. Those genuinely differ across a rig — a bandit's
 *    metalwork sits at metalness 0.9 while his coat is at 0.05 — and a single
 *    averaged material would visibly change both. Grouping keeps the shading
 *    per-surface and still takes 16 meshes down to about 4.
 *  - Only `SkinnedMesh`es sharing one skeleton are touched. The revolver
 *    weapons.js parents into the hand, and its muzzle-flash sprite, are plain
 *    meshes with their own transforms and their own lifecycle; folding them
 *    into the body would weld the gun to the character.
 *  - Anything textured, transparent, double-sided, or not a
 *    MeshStandardMaterial is left exactly as it was. This is an optimisation,
 *    so it declines rather than guesses.
 *
 * Merge the SOURCE rig once, before rig-clone.js copies it per bandit — the
 * clones then inherit the cheaper geometry for free.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Attributes every merged group must agree on, in a fixed order. */
const REQUIRED = ['position', 'normal', 'skinIndex', 'skinWeight'];

/**
 * How close two materials' shading has to be to share one merged mesh.
 *
 * Exact matching is too strict to be useful: a bandit's twelve materials sit on
 * four or five slightly different roughness values, so bucketing on equality
 * left most meshes alone in their own bucket and saved almost nothing. These
 * are deliberately asymmetric. Roughness differences of a tenth are invisible
 * on flat untextured colour, so they cluster freely; metalness is not — 0.9
 * against 0.05 is the difference between metal and cloth, and folding those
 * together would visibly wreck both.
 */
const SHADING_TOLERANCE = { roughness: 0.15, metalness: 0.08 };

/**
 * Greedy clustering of materials by shading. Returns a function mapping a
 * material to its cluster index, plus the cluster representatives.
 */
function clusterByShading(materials) {
  const clusters = [];
  // Sorting first makes the greedy pass deterministic, so the same GLB always
  // produces the same grouping rather than depending on traversal order.
  const sorted = [...materials].sort((a, b) =>
    (a.roughness ?? 1) - (b.roughness ?? 1) || (a.metalness ?? 0) - (b.metalness ?? 0));
  const indexOf = new Map();
  for (const m of sorted) {
    const r = m.roughness ?? 1;
    const mt = m.metalness ?? 0;
    let hit = clusters.findIndex((c) =>
      Math.abs(c.roughness - r) <= SHADING_TOLERANCE.roughness
      && Math.abs(c.metalness - mt) <= SHADING_TOLERANCE.metalness);
    if (hit === -1) {
      clusters.push({ roughness: r, metalness: mt, material: m });
      hit = clusters.length - 1;
    }
    indexOf.set(m.uuid, hit);
  }
  return { clusters, indexOf };
}

/**
 * True if this mesh can be folded into a merged body. Deliberately strict:
 * anything unusual keeps its own draw call rather than being approximated.
 */
function isMergeable(mesh) {
  if (!mesh.isSkinnedMesh || !mesh.skeleton) return false;
  if (Array.isArray(mesh.material)) return false; // multi-material needs geometry groups; not worth it here
  const m = mesh.material;
  if (!m || !m.isMeshStandardMaterial) return false;
  if (m.map || m.normalMap || m.emissiveMap || m.aoMap || m.roughnessMap || m.metalnessMap) return false;
  if (m.transparent || (m.opacity ?? 1) < 1 || (m.alphaTest ?? 0) > 0) return false;
  if (m.side !== THREE.FrontSide) return false;
  const attrs = mesh.geometry?.attributes;
  return !!attrs && REQUIRED.every((a) => attrs[a]);
}

/** Bakes a material's flat colour into a per-vertex `color` attribute. */
function bakeColor(geometry, color) {
  const count = geometry.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/**
 * Merges `root`'s skinned meshes in place, grouped by shading.
 *
 * @param {THREE.Object3D} root a loaded rig's scene
 * @returns {{before:number, after:number, groups:number}} mesh counts, for the
 *   smoke check that guards this from silently regressing.
 */
export function mergeRigMeshes(root) {
  const candidates = [];
  root.traverse((o) => { if (o.isMesh) candidates.push(o); });
  const before = candidates.length;

  // Bucket by shading, and only within one shared skeleton — a rig with two
  // skeletons is not something this should be quietly welding together.
  const mergeable = candidates.filter(isMergeable);
  const { indexOf } = clusterByShading(mergeable.map((m) => m.material));
  const groups = new Map();
  for (const mesh of mergeable) {
    const key = `${indexOf.get(mesh.material.uuid)}|${mesh.skeleton.uuid}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mesh);
  }

  let merged = 0;
  for (const [, meshes] of groups) {
    if (meshes.length < 2) continue; // nothing to save

    // Every part of these rigs is bound the same way, but check rather than
    // assume. A skinned mesh's vertices live in bind space and are placed by
    // its bindMatrix and the bones — NOT by the node's own transform, which
    // glTF says to ignore for skinned meshes. So parts sharing a bind matrix
    // and a skeleton are already in one common space and merge as they are;
    // baking node transforms in on top of that double-transforms them, which
    // showed up on screen as a stretched triangle lancing through the body.
    const first = meshes[0];
    const compatible = meshes.every((m) =>
      m.bindMatrix.equals(first.bindMatrix) && m.matrix.equals(first.matrix));
    if (!compatible) continue;

    const geometries = [];
    let ok = true;
    for (const mesh of meshes) {
      const geo = mesh.geometry.clone();
      // Drop anything not shared by all of them; mergeGeometries requires an
      // identical attribute set, and uv is useless without a texture anyway.
      for (const name of Object.keys(geo.attributes)) {
        if (!REQUIRED.includes(name)) geo.deleteAttribute(name);
      }
      bakeColor(geo, mesh.material.color);
      geometries.push(geo);
      if (!geo.attributes.position) { ok = false; break; }
    }
    if (!ok) continue;

    const mergedGeo = mergeGeometries(geometries, false);
    if (!mergedGeo) continue; // attribute mismatch; leave this group alone

    const source = first.material;
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, // white, so the vertex colours come through unchanged
      vertexColors: true,
      roughness: source.roughness,
      metalness: source.metalness,
      flatShading: source.flatShading,
    });

    const skinned = new THREE.SkinnedMesh(mergedGeo, material);
    skinned.name = `${first.name || 'body'}_merged`;
    skinned.castShadow = first.castShadow;
    skinned.receiveShadow = first.receiveShadow;
    skinned.frustumCulled = first.frustumCulled;
    // Same place in the hierarchy and same binding as the parts it replaces.
    first.parent.add(skinned);
    skinned.position.copy(first.position);
    skinned.quaternion.copy(first.quaternion);
    skinned.scale.copy(first.scale);
    skinned.bind(first.skeleton, first.bindMatrix);

    for (const mesh of meshes) {
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
    }
    merged++;
  }

  let after = 0;
  root.traverse((o) => { if (o.isMesh) after++; });
  return { before, after, groups: merged };
}
