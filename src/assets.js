/**
 * assets.js — small, reusable GLTF loading helpers shared by every character
 * (player now, bandit and horse in later rounds). Nothing in here is
 * game-specific; character.js builds the actual player rig on top of it.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

/** Loads a .glb, rejecting on any failure so the caller can fall back to a placeholder. */
export function loadGLTF(path) {
  return new Promise((resolve, reject) => {
    loader.load(path, resolve, undefined, (err) => reject(err ?? new Error(`failed to load ${path}`)));
  });
}

/**
 * findClip(gltf, ...candidates) — per docs/ANIMATION.md: for each candidate
 * in order, try an EXACT match on the clip name's segment after `|` (this
 * rig's clips are prefixed `CharacterArmature|` / `AnimalArmature|`), case
 * insensitive, before falling back to substring. Returns null, never the
 * first clip, if nothing matches — a silent wrong-clip fallback is worse than
 * an obviously-missing one.
 */
export function findClip(gltf, ...candidates) {
  const clips = gltf.animations ?? [];
  const shortName = (n) => (n.includes('|') ? n.slice(n.indexOf('|') + 1) : n).toLowerCase();

  for (const candidate of candidates) {
    const wanted = candidate.toLowerCase();
    const exact = clips.find((c) => shortName(c.name) === wanted);
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const wanted = candidate.toLowerCase();
    const sub = clips.find((c) => shortName(c.name).includes(wanted));
    if (sub) return sub;
  }
  return null;
}

/**
 * World-space bounding-box height of a loaded object, used to rescale to
 * PLAYER.modelHeight. `updateMatrixWorld(true)` is required here, not
 * optional: a freshly-loaded GLTFLoader scene hasn't been added to a Scene or
 * rendered yet, so its matrixWorld chain is stale. Box3.setFromObject does
 * its own partial internal updates while traversing, but for this rig's
 * shape (13 SkinnedMesh primitives under sibling armature/mesh branches, one
 * of them carrying a baked 90° corrective rotation) that partial update is
 * not reliable — measured directly: without the explicit pre-update this
 * returned 63.8 for player.glb instead of the correct ~1.83, which made
 * character.js compute a scale of 0.029 instead of ~0.99 and render the
 * player at roughly 5cm tall. Confirmed by forcing a full cascade first.
 */
export function measureHeight(object3D) {
  object3D.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3D);
  return box.max.y - box.min.y;
}

/** Enables shadows on every SkinnedMesh/Mesh in the hierarchy — the humanoid rig is 4 separate skinned meshes sharing one armature, so this must not stop at the first one. */
export function enableShadows(root) {
  root.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}
