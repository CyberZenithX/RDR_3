/**
 * props.js — rocks, cacti and dead trees. Everything here is instanced (a
 * handful of geometry variants per kind, each its own InstancedMesh) and
 * registers a circle collider per placed prop so the player can't walk
 * through them. Grass lives in grass.js — it recenters on the player instead
 * of being placed once across the whole world.
 */

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from './noise.js';
import { heightAt, normalAt } from './terrain.js';
import { addCircleCollider } from './collision.js';
import { PROPS, TOWN, SPAWN, COLORS } from './config.js';

const rng = makeRng(PROPS.seed);

function isValidSpot(x, z) {
  if (Math.hypot(x, z) > PROPS.scatterRadius) return false;
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < PROPS.spawnKeepOut) return false;
  if (
    Math.abs(x - TOWN.centerX) < TOWN.halfSize + PROPS.townKeepOut &&
    Math.abs(z - TOWN.centerZ) < TOWN.halfSize + PROPS.townKeepOut
  ) return false;
  if (1 - normalAt(x, z).y > PROPS.maxSlope) return false;
  return true;
}

function pickSpot() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const r = PROPS.scatterRadius * Math.sqrt(rng());
    const theta = rng() * Math.PI * 2;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    if (isValidSpot(x, z)) return { x, z };
  }
  return null;
}

// ---------------------------------------------------------------- geometry ---

function makeRockGeometry(detail, lumpiness) {
  // IcosahedronGeometry (like all three.js Platonic-solid geometries) is
  // non-indexed: a vertex shared by several triangles is stored as separate
  // duplicate entries, one per triangle. Displacing each buffer entry with
  // an independent random offset (as this function does, per vertex) then
  // moves what should be the same shared corner to different places for
  // each triangle that touches it — tearing the mesh apart into a shattered,
  // faceted mess at every seam instead of a lumpy but continuous rock.
  // mergeVertices() collapses coincident positions into one indexed vertex
  // first, so the displacement below moves each real corner exactly once,
  // consistently for every triangle that shares it.
  //
  // mergeVertices() compares ALL attributes together, not just position —
  // and IcosahedronGeometry has a UV seam where position-identical vertices
  // carry different UV coordinates (needed for texture-coordinate wrapping).
  // Left in place, that seam's vertices never merge, leaving a handful of
  // degree-2 vertices (a proper closed-mesh vertex needs degree >=3) that
  // reliably fold into a visible notch/crack at that same structural seam
  // on every rock, regardless of seed or lumpiness — confirmed by measuring
  // vertex degree directly (12 defective degree-2 vertices, 57 total instead
  // of the correct 42) and by rendering the same 6 seeds across 4 lumpiness
  // levels: the notch appeared in every single one, including at very low
  // lumpiness, which is what pointed at a structural cause rather than
  // random bad luck. This material has no texture map, so the UV attribute
  // is dead weight anyway — deleting it before merging lets the seam
  // actually collapse (verified: 42 vertices, clean degree-5/6 distribution,
  // no more low-degree vertices).
  const raw = new THREE.IcosahedronGeometry(1, detail);
  raw.deleteAttribute('uv');
  const geo = mergeVertices(raw);
  raw.dispose();
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    v.multiplyScalar(1 + (rng() - 0.5) * 2 * lumpiness);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.scale(1, 0.7, 1);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0); // base sits at local y = 0
  return geo;
}

function makeCactusGeometry(cfg, armSides) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(cfg.trunkRadius * 0.75, cfg.trunkRadius, cfg.trunkHeight, cfg.radialSegments);
  trunk.translate(0, cfg.trunkHeight / 2, 0);
  parts.push(trunk);

  for (const side of armSides) {
    const elbow = new THREE.CylinderGeometry(cfg.armRadius, cfg.armRadius, cfg.armRadius * 3, cfg.radialSegments);
    elbow.rotateZ((Math.PI / 2) * side);
    elbow.translate(side * cfg.armRadius * 1.5, cfg.armHeight, 0);
    parts.push(elbow);

    const vert = new THREE.CylinderGeometry(cfg.armRadius * 0.9, cfg.armRadius, cfg.armLength, cfg.radialSegments);
    vert.translate(side * cfg.armRadius * 3, cfg.armHeight + cfg.armLength / 2, 0);
    parts.push(vert);
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

function makeDeadTreeGeometry(cfg) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(cfg.trunkRadiusTop, cfg.trunkRadiusBottom, cfg.trunkHeight, cfg.radialSegments);
  trunk.translate(0, cfg.trunkHeight / 2, 0);
  parts.push(trunk);

  for (let i = 0; i < cfg.branchCount; i++) {
    const branch = new THREE.CylinderGeometry(cfg.branchRadius * 0.4, cfg.branchRadius, cfg.branchLength, cfg.radialSegments);
    branch.translate(0, cfg.branchLength / 2, 0);
    branch.rotateX(0.5 + rng() * 0.6);
    branch.rotateY(rng() * Math.PI * 2);
    branch.translate(0, cfg.trunkHeight * (0.45 + rng() * 0.45), 0);
    parts.push(branch);
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------- scatter ---

/**
 * Places `count` instances of a prop kind, round-robined across `geometries`
 * (one InstancedMesh per geometry variant), registers a collider per
 * placement, and adds every mesh to `scene`.
 */
function scatterInstanced(scene, { geometries, material, count, minScale, maxScale, sink, colliderRadius }) {
  const perVariant = geometries.map(() => []);
  let placed = 0;
  for (let i = 0; i < count; i++) {
    const spot = pickSpot();
    if (!spot) continue;
    const scale = minScale + rng() * (maxScale - minScale);
    perVariant[i % geometries.length].push({
      x: spot.x, z: spot.z, y: heightAt(spot.x, spot.z) - sink * scale,
      rotY: rng() * Math.PI * 2, scale,
    });
    addCircleCollider(spot.x, spot.z, colliderRadius * scale);
    placed++;
  }

  const meshes = [];
  const dummy = new THREE.Object3D();
  geometries.forEach((geo, gi) => {
    const list = perVariant[gi];
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rotY, 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    meshes.push(mesh);
  });

  return { meshes, placed };
}

/** Builds and scatters every static prop kind. Returns counts for the smoke check. */
export function buildProps(scene) {
  const rockMat = new THREE.MeshStandardMaterial({ color: COLORS.rock, roughness: 0.95, flatShading: false });
  const cactusMat = new THREE.MeshStandardMaterial({ color: COLORS.cactus, roughness: 0.85 });
  const treeMat = new THREE.MeshStandardMaterial({ color: COLORS.deadWood, roughness: 0.9 });

  const rockGeos = [
    makeRockGeometry(PROPS.rock.detail, PROPS.rock.lumpiness),
    makeRockGeometry(PROPS.rock.detail, PROPS.rock.lumpiness * 0.7),
    makeRockGeometry(PROPS.rock.detail, PROPS.rock.lumpiness * 1.3),
  ];
  const cactusGeos = [
    makeCactusGeometry(PROPS.cactus, []),
    makeCactusGeometry(PROPS.cactus, [1]),
    makeCactusGeometry(PROPS.cactus, [-1, 1]),
  ];
  const treeGeos = [
    makeDeadTreeGeometry(PROPS.tree),
    makeDeadTreeGeometry(PROPS.tree),
  ];

  const rocks = scatterInstanced(scene, {
    geometries: rockGeos, material: rockMat, count: PROPS.rock.count,
    minScale: PROPS.rock.minScale, maxScale: PROPS.rock.maxScale,
    sink: PROPS.rock.sinkFactor, colliderRadius: PROPS.rock.colliderFactor,
  });
  const cacti = scatterInstanced(scene, {
    geometries: cactusGeos, material: cactusMat, count: PROPS.cactus.count,
    minScale: PROPS.cactus.minScale, maxScale: PROPS.cactus.maxScale,
    sink: 0, colliderRadius: PROPS.cactus.colliderRadius,
  });
  const trees = scatterInstanced(scene, {
    geometries: treeGeos, material: treeMat, count: PROPS.tree.count,
    minScale: PROPS.tree.minScale, maxScale: PROPS.tree.maxScale,
    sink: 0, colliderRadius: PROPS.tree.colliderRadius,
  });

  return { rocks: rocks.placed, cacti: cacti.placed, trees: trees.placed };
}
