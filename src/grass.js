/**
 * grass.js — instanced grass tufts that follow the player instead of being
 * placed once across the whole 1500×1500 world (which would mean either a
 * tiny patch or millions of instances). A fixed-size instance pool is
 * re-bucketed onto a world-space jittered grid every time the player moves
 * `GRASS.recenterDistance`, so the pattern is stable if you walk away and
 * come back (deterministic per grid cell) but never grows unbounded.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, normalAt } from './terrain.js';
import { GRASS, TOWN, WORLD, COLORS } from './config.js';

const GRASS_SEED = WORLD.seed + 707;

/** Small deterministic hash → [0, 1), independent per (cellX, cellZ, salt). */
function hash01(ix, iz, salt) {
  let h = (ix * 374761393) ^ (iz * 668265263) ^ ((salt + GRASS_SEED) * 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 1000000) / 1000000;
}

function makeBladeGeometry() {
  const w = GRASS.bladeWidth, h = GRASS.bladeHeight, lean = GRASS.bladeLean;
  const root = new THREE.Color(COLORS.grassRoot);
  const tip = new THREE.Color(COLORS.grassTip);
  const positions = new Float32Array([-w / 2, 0, 0, w / 2, 0, 0, lean * h, h, 0]);
  const colors = new Float32Array([
    root.r, root.g, root.b,
    root.r, root.g, root.b,
    tip.r, tip.g, tip.b,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex([0, 1, 2]);
  geo.computeVertexNormals();
  return geo;
}

function makeTuftGeometry() {
  const blade = makeBladeGeometry();
  const parts = [];
  for (let i = 0; i < GRASS.bladesPerTuft; i++) {
    const b = blade.clone();
    b.rotateY((Math.PI / GRASS.bladesPerTuft) * i);
    parts.push(b);
  }
  blade.dispose();
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

function isGrassValidSpot(x, z) {
  return 1 - normalAt(x, z).y <= GRASS.maxSlope;
}

/** Builds the grass instance pool (empty until the first updateGrass call) and adds it to `scene`. */
export function buildGrass(scene) {
  const geo = makeTuftGeometry();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.85,
    // Flat single-triangle blades go nearly black when their face normal points
    // away from the sun (only the hemisphere light reaches them, and thin
    // foliage cards read badly with zero direct light). A small constant
    // emissive keeps backlit blades legible as dark grass instead of black
    // spikes, without touching the vertex-color gradient other angles show.
    emissive: new THREE.Color(COLORS.grassRoot),
    emissiveIntensity: GRASS.ambientFloor,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, GRASS.count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // instances span a moving radius around the player; cull per-frame cost isn't worth it here
  scene.add(mesh);
  return { mesh, dummy: new THREE.Object3D(), lastCenter: new THREE.Vector3(Infinity, 0, Infinity) };
}

/** Call every frame; only does real work once the player has moved `recenterDistance`. */
export function updateGrass(state, playerPos) {
  if (Math.hypot(playerPos.x - state.lastCenter.x, playerPos.z - state.lastCenter.z) < GRASS.recenterDistance) return;
  state.lastCenter.set(playerPos.x, 0, playerPos.z);
  recenterGrass(state, playerPos);
}

function recenterGrass(state, playerPos) {
  const spacing = GRASS.radius * Math.sqrt(Math.PI / GRASS.count);
  const baseI = Math.floor(playerPos.x / spacing);
  const baseJ = Math.floor(playerPos.z / spacing);
  const rangeCells = Math.ceil(GRASS.radius / spacing) + 1;
  const placements = [];

  outer:
  for (let di = -rangeCells; di <= rangeCells; di++) {
    for (let dj = -rangeCells; dj <= rangeCells; dj++) {
      const ci = baseI + di, cj = baseJ + dj;
      const x = ci * spacing + spacing / 2 + (hash01(ci, cj, 1) - 0.5) * spacing;
      const z = cj * spacing + spacing / 2 + (hash01(ci, cj, 2) - 0.5) * spacing;
      const dist = Math.hypot(x - playerPos.x, z - playerPos.z);
      if (dist > GRASS.radius || dist < GRASS.playerKeepOut || !isGrassValidSpot(x, z)) continue;

      let keepProb = Math.pow(1 - dist / GRASS.radius, GRASS.radialBias);
      if (Math.abs(x - TOWN.centerX) < TOWN.halfSize && Math.abs(z - TOWN.centerZ) < TOWN.halfSize) {
        keepProb *= GRASS.townDensityFactor;
      }
      if (hash01(ci, cj, 3) > keepProb) continue;

      placements.push({
        x, z,
        rot: hash01(ci, cj, 4) * Math.PI * 2,
        scale: GRASS.minScale + hash01(ci, cj, 5) * (GRASS.maxScale - GRASS.minScale),
      });
      if (placements.length >= GRASS.count) break outer;
    }
  }

  const { mesh, dummy } = state;
  for (let i = 0; i < GRASS.count; i++) {
    if (i < placements.length) {
      const p = placements[i];
      dummy.position.set(p.x, heightAt(p.x, p.z), p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.scale);
    } else {
      dummy.position.set(0, -1000, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.0001);
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}
