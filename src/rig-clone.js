/**
 * rig-clone.js — deep-copies a loaded, skinned GLTF rig so eleven bandits can
 * share one 1.37MB download and one set of GPU buffers.
 *
 * WHY THIS FILE EXISTS AT ALL. `Object3D.clone()` is not enough for a
 * `SkinnedMesh`: it copies `skeleton` **by reference**, so every clone would
 * be driven by the original's bones and all eleven bandits would move as one
 * body. three.js ships `SkeletonUtils.clone()` for this, in
 * `examples/jsm/utils/` — but that addon is not in `vendor/three/` and this
 * session cannot fetch it (see CLAUDE.md's environment facts). Twenty-odd
 * lines of well-understood remapping is a better trade than either re-parsing
 * the GLB eleven times (eleven copies of every buffer, on the GPU as well as
 * in RAM) or adding a dependency we cannot download.
 *
 * `gltf.animations` are NOT cloned and do not need to be: `AnimationMixer`
 * binds tracks to nodes **by name**, resolved against the root it was
 * constructed with, and every clone carries the same names. One clip array,
 * eleven mixers.
 *
 * Materials are shared by reference, which is what `clone()` does anyway and
 * is what we want — eleven bandits are eleven draw calls per submesh, not
 * eleven material compiles. The consequence: **nothing may recolour a bandit's
 * material in place**, or they all flash. Round 4's hit reaction is the
 * `HitRecieve` clip precisely because of that.
 */

/** Walks two structurally identical trees together. */
function parallelTraverse(a, b, callback) {
  callback(a, b);
  for (let i = 0; i < a.children.length; i++) {
    parallelTraverse(a.children[i], b.children[i], callback);
  }
}

/**
 * A fully independent copy of `source`, with every `SkinnedMesh` rebound to
 * the copy's own bones.
 *
 * @param {import('three').Object3D} source a loaded GLTF scene root
 * @returns {import('three').Object3D}
 */
export function cloneRig(source) {
  const sourceOf = new Map(); // clone node -> source node
  const cloneOf = new Map(); // source node -> clone node

  const clone = source.clone(true);
  parallelTraverse(source, clone, (from, to) => {
    sourceOf.set(to, from);
    cloneOf.set(from, to);
  });

  clone.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const original = sourceOf.get(node);
    const skeleton = original.skeleton;
    // `Skeleton.clone()` copies the inverse bind matrices and the bone list;
    // the bone list is then remapped onto this clone's own bones. Without the
    // remap the clone is skinned by the source's skeleton and every copy
    // moves identically.
    const cloned = skeleton.clone();
    cloned.bones = skeleton.bones.map((bone) => cloneOf.get(bone) ?? bone);
    node.bind(cloned, original.bindMatrix);
  });

  return clone;
}
