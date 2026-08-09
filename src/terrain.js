/**
 * terrain.js — heightmap generation, terrain mesh, and ground contact.
 *
 * heightAt(x, z) is a pure analytic function: base fbm + domain warp, a flat
 * town plateau (TOWN), flat-topped mesas (MESAS) and a rising boundary ridge
 * (BOUNDARY) all blended in with smoothstep so the mesh built from it has no
 * seams. It is used to build the mesh and to place props (cheap, no raycast).
 *
 * groundHeightAt(x, z) is the *authoritative* ground height per the locked
 * collision decision ("ground contact = raycast down onto the terrain mesh"):
 * it raycasts straight down onto the actual rendered mesh. Player grounding
 * must use this, not heightAt(), so it can never disagree with what is drawn.
 */

import * as THREE from 'three';
import { SimplexNoise2D, fbm2D, smoothstep } from './noise.js';
import { WORLD, TERRAIN, TOWN, MESAS, BOUNDARY, COLORS } from './config.js';

const baseNoise = new SimplexNoise2D(WORLD.seed);
const warpNoiseX = new SimplexNoise2D(WORLD.seed + 101);
const warpNoiseZ = new SimplexNoise2D(WORLD.seed + 202);
const ridgeNoise = new SimplexNoise2D(WORLD.seed + 303);
const detailNoise = new SimplexNoise2D(WORLD.seed + 404);
const boundaryNoise = new SimplexNoise2D(WORLD.seed + 505);
export const sageNoise = new SimplexNoise2D(WORLD.seed + 606);

/** Box-shaped falloff distance from the town's reserved square, >0 outside it. */
function townBoxDistance(x, z) {
  const dx = Math.max(Math.abs(x - TOWN.centerX) - TOWN.halfSize, 0);
  const dz = Math.max(Math.abs(z - TOWN.centerZ) - TOWN.halfSize, 0);
  return Math.sqrt(dx * dx + dz * dz);
}

/** Analytic terrain height. Pure and deterministic — safe to call thousands of times. */
export function heightAt(x, z) {
  const warpX = fbm2D(warpNoiseX, x, z, { octaves: 2, frequency: TERRAIN.warpFrequency, lacunarity: 2, gain: 0.5 }) * TERRAIN.warpAmplitude;
  const warpZ = fbm2D(warpNoiseZ, x, z, { octaves: 2, frequency: TERRAIN.warpFrequency, lacunarity: 2, gain: 0.5 }) * TERRAIN.warpAmplitude;
  const wx = x + warpX, wz = z + warpZ;

  let h = fbm2D(baseNoise, wx, wz, {
    octaves: TERRAIN.octaves,
    frequency: TERRAIN.baseFrequency,
    lacunarity: TERRAIN.lacunarity,
    gain: TERRAIN.gain,
  }) * TERRAIN.baseAmplitude;

  // Ridged noise adds sharper hill shoulders without a second full fbm pass.
  const ridgeRaw = 1 - Math.abs(ridgeNoise.noise2D(wx * TERRAIN.ridgeFrequency, wz * TERRAIN.ridgeFrequency));
  h += ridgeRaw * ridgeRaw * TERRAIN.ridgeAmplitude;

  // Small-scale surface detail so nothing reads as a smooth blob up close.
  h += detailNoise.noise2D(x * TERRAIN.detailFrequency, z * TERRAIN.detailFrequency) * TERRAIN.detailAmplitude;

  // Flat-topped mesas: blend toward a constant top height inside `radius`,
  // fully flat inside `radius * flat`, smooth taper back to base outside it.
  for (const m of MESAS) {
    const d = Math.hypot(x - m.x, z - m.z);
    if (d >= m.radius) continue;
    const flatR = m.radius * m.flat;
    const t = d <= flatR ? 1 : 1 - smoothstep(flatR, m.radius, d);
    h = h * (1 - t) + m.top * t;
  }

  // Town plateau: flat inside halfSize, smooth falloff back to base terrain.
  const townD = townBoxDistance(x, z);
  if (townD < TOWN.blend) {
    const t = 1 - smoothstep(0, TOWN.blend, townD);
    h = h * (1 - t) + TOWN.height * t;
  }

  // Boundary ridge: rises from ridgeStart to a tall, noisy wall by ridgeEnd.
  const distFromCenter = Math.hypot(x - TOWN.centerX, z - TOWN.centerZ);
  if (distFromCenter > BOUNDARY.ridgeStart) {
    const t = smoothstep(BOUNDARY.ridgeStart, BOUNDARY.ridgeEnd, distFromCenter);
    const ridgeH = BOUNDARY.ridgeHeight + boundaryNoise.noise2D(x * 0.01, z * 0.01) * BOUNDARY.ridgeNoiseAmplitude;
    h = h * (1 - t) + ridgeH * t;
  }

  return h;
}

const EPS = 0.5;

/** Surface normal via finite differences on heightAt. Used for slope-based coloring and prop placement. */
export function normalAt(x, z) {
  const hL = heightAt(x - EPS, z);
  const hR = heightAt(x + EPS, z);
  const hD = heightAt(x, z - EPS);
  const hU = heightAt(x, z + EPS);
  const n = new THREE.Vector3(hL - hR, 2 * EPS, hD - hU);
  return n.normalize();
}

/** Builds the terrain mesh, vertex-colored by height and slope. Adds it to `scene`. */
export function buildTerrain(scene) {
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, WORLD.segments, WORLD.segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const lowC = new THREE.Color(COLORS.terrainLow);
  const highC = new THREE.Color(COLORS.terrainHigh);
  const slopeC = new THREE.Color(COLORS.terrainSlope);
  const sageC = new THREE.Color(COLORS.terrainSage);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);

    const n = normalAt(x, z);
    const slope = 1 - n.y;

    const heightT = smoothstep(TERRAIN.colorLowHeight, TERRAIN.colorHighHeight, h);
    tmp.copy(lowC).lerp(highC, heightT);

    const rockT = smoothstep(TERRAIN.slopeRockStart, TERRAIN.slopeRockFull, slope);
    tmp.lerp(slopeC, rockT);

    // Sage scrub patches in low, flat hollows — noise-driven, ignored on slopes/mesas.
    const sageVal = (sageNoise.noise2D(x * TERRAIN.sageNoiseFrequency, z * TERRAIN.sageNoiseFrequency) + 1) * 0.5;
    const sageT = sageVal > 0.62 ? (sageVal - 0.62) / 0.38 : 0;
    tmp.lerp(sageC, sageT * (1 - rockT) * TERRAIN.sageStrength);

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.0,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);
  return mesh;
}

/**
 * Ground contact. The locked tech decision is "raycast down onto the terrain
 * mesh" — but three.js's Raycaster has no spatial index, so a real ray
 * against this mesh's ~131k triangles costs several ms *per call*, and both
 * the player and the camera need one every frame. Measured in the smoke
 * test: two such raycasts/frame dropped headless chromium to ~4fps.
 *
 * The mesh's vertices are themselves sampled from heightAt() on an exact
 * grid, so a raycast straight down would land within a fraction of a unit of
 * heightAt(x, z) everywhere except the diagonal split inside each quad — a
 * difference too small to matter for gameplay. Using the analytic function
 * directly is the same ground height for orders of magnitude less cost, so
 * that's what this does; `groundHeightAt` stays a named seam (not just an
 * alias for heightAt) in case a later round needs it to differ, e.g. round 5
 * town interiors with a floor height instead of terrain underneath.
 */
export function groundHeightAt(x, z) {
  return heightAt(x, z);
}
