/**
 * daynight.js — the day/night cycle. BUILD-PLAN.md's round 7, first item and
 * the one it says never to drop: "Day/night cycle with a real sun arc and warm
 * sunset light."
 *
 * It owns a single scalar clock `t` in [0, 1) — fraction of a full day —
 * advances it in real time, and each frame:
 *
 *   - maps `t` to a sun elevation and azimuth (the arc);
 *   - writes that direction into `world.sunDirection`, the SAME Vector3
 *     `sky.js`'s `updateShadowFollow` reads, so the shadow-casting light and
 *     its shadow camera track the sun for free;
 *   - writes the true (unclamped) direction into the sky dome's own uniform, so
 *     the sun disc actually sets below the horizon;
 *   - lerps the two nearest of DAYNIGHT's {night, golden, day} palettes into
 *     the sun colour/intensity, the hemisphere light, the sky gradient, the
 *     fog, the tone-mapping exposure and the scene background;
 *   - calls `StreetLamps.setLit()` — round 5 wired that and left it for this.
 *
 * Nothing else in the codebase has to know the time of day. `nightFactor`
 * (0 = full day, 1 = deep night) and `isNight` are exposed for the ambience
 * (crickets) and the minimap tint; that is the whole public surface.
 */

import * as THREE from 'three';
import { DAYNIGHT } from './config-polish.js';

const TWO_PI = Math.PI * 2;
const _c = new THREE.Color(); // module scratch for palette blends — never allocated per frame

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A reusable colour-carrying palette, so no THREE.Color is allocated per frame. */
function blankPalette() {
  return {
    sunColor: new THREE.Color(), sunIntensity: 0,
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 0,
    skyZenith: new THREE.Color(), skyHorizon: new THREE.Color(), skyLowHaze: new THREE.Color(),
    sunDiscStrength: 0, sunHaloStrength: 0, sunTint: new THREE.Color(),
    fogColor: new THREE.Color(), fogDensity: 0,
    exposure: 1,
  };
}

const COLOR_KEYS = ['sunColor', 'hemiSky', 'hemiGround', 'skyZenith', 'skyHorizon', 'skyLowHaze', 'sunTint', 'fogColor'];
const SCALAR_KEYS = ['sunIntensity', 'hemiIntensity', 'sunDiscStrength', 'sunHaloStrength', 'fogDensity', 'exposure'];

export class DayNight {
  /**
   * @param {object} deps
   * @param {THREE.Scene} deps.scene
   * @param {THREE.WebGLRenderer} deps.renderer
   * @param {object} deps.world  buildWorld()'s return — needs `sun`, `hemi`,
   *   `sunDirection` and `skyDome`.
   * @param {{setLit(lit:boolean):void}|null} [deps.lamps]  town.lamps, if a town was built.
   */
  constructor({ scene, renderer, world, lamps = null }) {
    this.scene = scene;
    this.renderer = renderer;
    this.sun = world.sun;
    this.hemi = world.hemi;
    this.lightDir = world.sunDirection; // mutated in place every frame
    this.skyUniforms = world.skyDome?.material?.uniforms ?? null;
    this.lamps = lamps;

    this.t = DAYNIGHT.startT;
    this.nightFactor = 0;
    this.isNight = false;
    this.elevation = 1;
    /** Settings' draw-distance control multiplies the computed fog density by this. */
    this.fogScale = 1;

    this._pal = blankPalette();
    this._trueDir = new THREE.Vector3();
    this._moonDir = new THREE.Vector3(DAYNIGHT.moonDir.x, DAYNIGHT.moonDir.y, DAYNIGHT.moonDir.z).normalize();
    this._lampsLit = null; // force the first setLit() through

    this.apply();
  }

  /** Jump straight to a time of day, 0..1. For the smoke harness and a future debug key. */
  setT(t) {
    this.t = ((t % 1) + 1) % 1;
    this.apply();
  }

  /** Advance the clock. `dt` is REAL seconds (main.js passes the unscaled delta). */
  update(dt) {
    this.t = (this.t + dt / DAYNIGHT.dayLengthSec) % 1;
    this.apply();
  }

  /** Recompute the sun direction and the whole palette for the current `t`. */
  apply() {
    // t: 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk.
    const a = (this.t - 0.25) * TWO_PI;
    const elev = Math.sin(a); // −1 (midnight) .. +1 (noon)
    const azim = Math.cos(a); // +1 at dawn (east) .. −1 at dusk (west)
    this.elevation = elev;

    // The true direction toward the sun, for the sky dome's disc. A little
    // south bias (+Z) at all times, more of it when the sun is low, which is
    // what puts the golden band across the horizon the spawn faces.
    this._trueDir.set(azim * 0.8, elev, 0.28 + 0.16 * (1 - Math.abs(azim))).normalize();

    // The directional LIGHT's direction: same, but its dir.y is never allowed
    // near or below the horizon (a raking shadow camera breaks), and once the
    // sun is down it is lerped to a fixed moon angle. Intensity, not geometry,
    // carries night — see the palette below.
    const belowHorizon = smoothstep(0.12, -0.1, elev); // 0 above, 1 well below
    this.lightDir.copy(this._trueDir);
    if (this.lightDir.y < DAYNIGHT.minLightElevation) this.lightDir.y = DAYNIGHT.minLightElevation;
    this.lightDir.normalize().lerp(this._moonDir, belowHorizon).normalize();

    // ---- palette blend, keyed to elevation so the arc can be retuned freely --
    const D = DAYNIGHT;
    let lo, hi, f;
    if (elev <= D.goldenAt) {
      lo = D.night; hi = D.golden;
      f = smoothstep(D.nightBelow, D.goldenAt, elev);
    } else {
      lo = D.golden; hi = D.day;
      f = smoothstep(D.goldenAt, D.dayAbove, elev);
    }
    const p = this._pal;
    for (const k of COLOR_KEYS) p[k].set(lo[k]).lerp(_c.set(hi[k]), f);
    for (const k of SCALAR_KEYS) p[k] = THREE.MathUtils.lerp(lo[k], hi[k], f);

    // ---- write it out ------------------------------------------------------
    this.sun.color.copy(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;

    if (this.skyUniforms) {
      this.skyUniforms.zenithColor.value.copy(p.skyZenith);
      this.skyUniforms.horizonColor.value.copy(p.skyHorizon);
      this.skyUniforms.lowHazeColor.value.copy(p.skyLowHaze);
      this.skyUniforms.sunColor.value.copy(p.sunTint);
      this.skyUniforms.sunDiscStrength.value = p.sunDiscStrength;
      this.skyUniforms.sunHaloStrength.value = p.sunHaloStrength;
      this.skyUniforms.sunDirection.value.copy(this._trueDir);
    }

    if (this.scene.fog) {
      this.scene.fog.color.copy(p.fogColor);
      this.scene.fog.density = p.fogDensity * this.fogScale;
    }
    if (this.scene.background?.isColor) this.scene.background.copy(p.fogColor);
    this.renderer.toneMappingExposure = p.exposure;

    // ---- night flags + the lamps ----------------------------------------
    this.nightFactor = 1 - smoothstep(D.nightBelow, D.dayAbove, elev);
    // Hysteresis so a lamp never flickers at the exact threshold.
    const wantLit = this._lampsLit
      ? elev < D.lampsOnBelow + 0.06
      : elev < D.lampsOnBelow;
    if (wantLit !== this._lampsLit) {
      this._lampsLit = wantLit;
      this.isNight = wantLit;
      this.lamps?.setLit(wantLit);
    }
  }
}
