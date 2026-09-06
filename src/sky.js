/**
 * sky.js — gradient sky dome, sun + hemisphere lighting, and fog. Everything
 * that makes the world read as "outdoors" rather than "grey plane with fog".
 */

import * as THREE from 'three';
import { COLORS, SKY, SUN, FOG, RENDER } from './config.js';

const skyVertexShader = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(worldPos.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const skyFragmentShader = /* glsl */ `
  uniform vec3 zenithColor;
  uniform vec3 horizonColor;
  uniform vec3 lowHazeColor;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  uniform float horizonPower;
  uniform float lowHazePower;
  uniform float sunDiscPower;
  uniform float sunDiscStrength;
  uniform float sunHaloPower;
  uniform float sunHaloStrength;
  varying vec3 vWorldDir;

  void main() {
    // vWorldDir is a per-vertex unit vector, but linear interpolation across
    // a triangle does not preserve unit length — it shrinks toward the
    // middle of large triangles. On this dome's coarse 32x20 segments that
    // shrinkage is small, but sunDiscPower (340) amplifies even a tiny dot
    // product error enormously, turning what should be a clean round disc
    // into a blotchy, faceted, non-circular blob. Re-normalize before using it.
    vec3 dir = normalize(vWorldDir);

    float h = clamp(dir.y, -1.0, 1.0);
    float up = pow(clamp(h, 0.0, 1.0), horizonPower);
    vec3 col = mix(horizonColor, zenithColor, up);

    float low = pow(1.0 - clamp(h, 0.0, 1.0), lowHazePower);
    col = mix(col, lowHazeColor, low * step(h, 0.35));

    float sunAmount = max(dot(dir, sunDirection), 0.0);
    col += sunColor * pow(sunAmount, sunDiscPower) * sunDiscStrength;
    col += sunColor * pow(sunAmount, sunHaloPower) * sunHaloStrength;

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Builds the sky dome, sun + hemisphere lights and fog, and adds them to `scene`. */
export function buildSky(scene) {
  const sunDir = new THREE.Vector3(SUN.dirX, SUN.dirY, SUN.dirZ).normalize();

  const skyGeo = new THREE.SphereGeometry(
    RENDER.far * SKY.domeRadiusFactor,
    SKY.widthSegments,
    SKY.heightSegments,
  );
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenithColor: { value: new THREE.Color(COLORS.skyZenith) },
      horizonColor: { value: new THREE.Color(COLORS.skyHorizon) },
      lowHazeColor: { value: new THREE.Color(COLORS.skyLowHaze) },
      sunColor: { value: new THREE.Color(COLORS.sunDisc) },
      // A clone, not sunDir itself: daynight.js mutates the returned sunDirection
      // in place every frame for the shadow-casting light (whose dir.y it clamps
      // above the horizon), while the dome's disc must follow the TRUE sun down
      // past it. Two needs, two vectors.
      sunDirection: { value: sunDir.clone() },
      horizonPower: { value: SKY.horizonPower },
      lowHazePower: { value: SKY.lowHazePower },
      sunDiscPower: { value: SKY.sunDiscPower },
      sunDiscStrength: { value: SKY.sunDiscStrength },
      sunHaloPower: { value: SKY.sunHaloPower },
      sunHaloStrength: { value: SKY.sunHaloStrength },
    },
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.name = 'skyDome';
  skyDome.renderOrder = -1000;
  scene.add(skyDome);

  scene.fog = new THREE.FogExp2(COLORS.fog, FOG.density);
  scene.background = new THREE.Color(COLORS.skyHorizon);

  const hemi = new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, SUN.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(COLORS.sunLight, SUN.intensity);
  sun.position.copy(sunDir).multiplyScalar(SUN.distance);
  sun.castShadow = true;
  sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
  sun.shadow.camera.near = RENDER.shadowNear;
  sun.shadow.camera.far = RENDER.shadowFar;
  const s = RENDER.shadowHalfExtent;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = RENDER.shadowBias;
  sun.shadow.normalBias = RENDER.shadowNormalBias;
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  return { skyDome, sun, hemi, sunDirection: sunDir };
}

/**
 * Keeps the sun's shadow camera centered on the player so the 2048 map stays
 * sharp near them instead of spreading over the whole 1500-unit world
 * (the "cascade-faked by keeping the shadow camera tight" rule).
 */
export function updateShadowFollow(sun, sunDirection, targetPos) {
  sun.target.position.set(targetPos.x, targetPos.y, targetPos.z);
  sun.position.set(
    targetPos.x + sunDirection.x * SUN.distance,
    targetPos.y + sunDirection.y * SUN.distance,
    targetPos.z + sunDirection.z * SUN.distance,
  );
}
