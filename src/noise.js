/**
 * noise.js — seeded PRNG and 2D simplex noise. No dependencies, deterministic
 * from a numeric seed so the world is reproducible across page loads.
 *
 * Classic Gustavson-style 2D simplex, permutation table built from a seeded
 * PRNG instead of the usual Math.random() so `WORLD.seed` fully determines
 * terrain, props and grass placement.
 */

/** mulberry32 — small, fast, good-enough seeded PRNG returning floats in [0,1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export class SimplexNoise2D {
  constructor(seed) {
    const rng = makeRng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    this.permMod8 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod8[i] = this.perm[i] % 8;
    }
  }

  /** Returns a value roughly in [-1, 1]. */
  noise2D(xin, yin) {
    const { perm, permMod8 } = this;
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;

    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t, Y0 = j - t;
    const x0 = xin - X0, y0 = yin - Y0;

    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;

    const ii = i & 255, jj = j & 255;
    const gi0 = permMod8[ii + perm[jj]];
    const gi1 = permMod8[ii + i1 + perm[jj + j1]];
    const gi2 = permMod8[ii + 1 + perm[jj + 1]];

    let n0 = 0, n1 = 0, n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { t0 *= t0; const g = GRAD2[gi0]; n0 = t0 * t0 * (g[0] * x0 + g[1] * y0); }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { t1 *= t1; const g = GRAD2[gi1]; n1 = t1 * t1 * (g[0] * x1 + g[1] * y1); }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { t2 *= t2; const g = GRAD2[gi2]; n2 = t2 * t2 * (g[0] * x2 + g[1] * y2); }

    return 70 * (n0 + n1 + n2);
  }
}

/** Fractal Brownian motion built on a SimplexNoise2D instance. Returns roughly [-1, 1]. */
export function fbm2D(noise, x, z, { octaves = 4, frequency = 1, lacunarity = 2, gain = 0.5 } = {}) {
  let amp = 1, freq = frequency, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise.noise2D(x * freq, z * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Smoothstep helper used throughout terrain blending. */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
