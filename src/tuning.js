/**
 * tuning.js — a live tuning panel for the numbers that decide how the game
 * FEELS, and a way to get the values you settled on back out again.
 *
 * WHY THIS EXISTS. Almost every open question in this project has the same
 * shape: a constant was set from a measurement or a screenshot and nobody had
 * ever felt it in motion. Answering one of those by hand is a round trip —
 * play, describe, edit a constant, rebuild, re-pull — and the description in
 * the middle is lossy. This closes the loop: ride with the panel open, drag
 * until it feels right, press Copy, and hand back the values.
 *
 * It is a DEBUG TOOL, not a feature. Hidden until asked for (F2, or load with
 * `?tune`), it builds no DOM until first opened, and while closed it costs a
 * keydown listener and nothing else.
 *
 * Every slider writes straight into the live config object. That works because
 * the config modules export plain mutable objects and the systems read them per
 * frame rather than caching at construction — the same property scripts/
 * smoke.mjs already relies on to shorten timers for a check.
 */

import { HORSE, RIDING_POSE, TACK } from './config-horse.js';
import { BANDIT, HEALTH } from './config-ai.js';
import { COMBAT, GUN, AIM_POSE } from './config-combat.js';
import { PLAYER, CAMERA, ANIM } from './config.js';

/**
 * What is worth a slider, grouped the way you would think about it while
 * riding rather than the way the files are laid out.
 *
 * Ranges are the point of this table: a slider is only useful if its span is
 * the span worth trying. They are set around each value's shipped default
 * rather than at 0..1, so the interesting part of the range is under the thumb.
 * `[object, key, min, max, step]`.
 */
const GROUPS = [
  ['Horse — gait', [
    [HORSE, 'walkSpeed', 0.5, 6, 0.1],
    [HORSE, 'gallopSpeed', 4, 16, 0.1],
    [HORSE, 'acceleration', 2, 30, 0.5],
    [HORSE, 'deceleration', 2, 30, 0.5],
    [HORSE, 'turnRate', 0.5, 8, 0.1],
  ]],
  ['Horse — lean and seat', [
    [HORSE, 'leanFactor', 0, 2.5, 0.05],
    [HORSE, 'leanMax', 0, 0.8, 0.01],
    [HORSE, 'leanDamping', 1, 20, 0.5],
    [HORSE, 'saddleFollow', 0, 1, 0.02],
    [HORSE, 'riderLean', 0, 1.5, 0.05],
    [HORSE, 'riderGallopPitch', 0, 0.6, 0.01],
    [HORSE, 'riderBobSway', 0, 1.5, 0.05],
  ]],
  ['Horse — jump', [
    [HORSE, 'jumpSpeed', 3, 14, 0.1],
    [HORSE, 'gravity', -40, -6, 0.5],
    [HORSE, 'jumpPitchTakeoff', 0, 0.9, 0.01],
    [HORSE, 'jumpPitchLanding', 0, 0.9, 0.01],
    [HORSE, 'jumpSeatRise', 0, 0.4, 0.01],
  ]],
  ['Horse — stamina', [
    [HORSE, 'staminaDrainRate', 0, 1, 0.01],
    [HORSE, 'staminaRegenRate', 0, 1, 0.01],
  ]],
  ['Riding pose', [
    [RIDING_POSE, 'thighPitch', 0, 1.8, 0.02],
    [RIDING_POSE, 'thighSpread', 0, 1.2, 0.02],
    [RIDING_POSE, 'kneeBend', 0, 1.8, 0.02],
    [RIDING_POSE, 'torsoPitch', -0.4, 0.8, 0.01],
    [RIDING_POSE, 'armPitch', 0, 1.4, 0.02],
    [RIDING_POSE, 'elbowBend', 0, 2, 0.02],
  ]],
  ['Gun', [
    [COMBAT, 'fireInterval', 0.1, 1.5, 0.02],
    [COMBAT, 'reloadTime', 0.4, 4, 0.05],
    [COMBAT, 'spreadHip', 0, 0.12, 0.002],
    [COMBAT, 'spreadAim', 0, 0.08, 0.001],
    [COMBAT, 'recoilPitchKick', 0, 0.2, 0.005],
    [COMBAT, 'recoilShake', 0, 0.3, 0.005],
    [COMBAT, 'recoilPoseKick', 0, 2, 0.05],
  ]],
  ['Aim camera', [
    [CAMERA, 'distance', 2, 12, 0.1],
    [CAMERA, 'height', 0.5, 4, 0.05],
    [CAMERA, 'mountedDistance', 3, 14, 0.1],
    [CAMERA, 'mouseSensitivity', 0.0005, 0.01, 0.0002],
  ]],
  ['Bandits', [
    [BANDIT, 'fireInterval', 0.3, 4, 0.05],
    [BANDIT, 'spread', 0.005, 0.15, 0.002],
    [BANDIT, 'aimLead', 0, 1, 0.02],
    [BANDIT, 'sightRange', 10, 120, 1],
    [BANDIT, 'preferredRange', 4, 40, 0.5],
    [BANDIT, 'runSpeed', 1, 8, 0.1],
  ]],
  ['Lethality', [
    [HEALTH, 'playerMax', 1, 12, 1],
    [HEALTH, 'banditMax', 1, 10, 1],
    [HEALTH, 'horseMax', 1, 20, 1],
  ]],
  ['Player', [
    [PLAYER, 'walkSpeed', 1, 8, 0.1],
    [PLAYER, 'sprintSpeed', 2, 12, 0.1],
    [PLAYER, 'jumpSpeed', 2, 12, 0.1],
  ]],
];

const CSS = `
#tunePanel{position:fixed;top:0;right:0;width:330px;max-height:100vh;overflow-y:auto;
  background:rgba(18,14,10,.94);color:#e8dcc8;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;
  padding:8px 10px 40px;z-index:40;border-left:1px solid #4a3a28}
#tunePanel h2{font-size:12px;margin:10px 0 4px;color:#e0a352;letter-spacing:.04em}
#tunePanel .row{display:grid;grid-template-columns:1fr 52px;gap:4px;align-items:center;margin:1px 0}
#tunePanel label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#tunePanel input[type=range]{grid-column:1/3;width:100%;height:14px;margin:0}
#tunePanel .val{text-align:right;color:#f0c98a}
#tunePanel .bar{position:sticky;top:0;background:rgba(18,14,10,.98);padding:6px 0;
  display:flex;gap:6px;border-bottom:1px solid #4a3a28;margin-bottom:4px}
#tunePanel button{flex:1;background:#3a2c1c;color:#e8dcc8;border:1px solid #6b5236;
  padding:4px;cursor:pointer;font:inherit}
#tunePanel button:hover{background:#4d3a24}
#tuneNote{color:#9c8a6c;margin-bottom:6px}
`;

export function initTuning() {
  const state = { open: false, root: null, rows: [], defaults: new Map() };

  // Snapshot every tunable BEFORE anything is dragged, so "what did I change"
  // is answerable and Reset means something.
  for (const [, entries] of GROUPS) {
    for (const [obj, key] of entries) state.defaults.set(`${label(obj)}.${key}`, obj[key]);
  }

  addEventListener('keydown', (e) => {
    if (e.code === 'F2') { e.preventDefault(); toggle(); }
  });
  if (location.search.includes('tune')) toggle();

  function toggle() {
    state.open = !state.open;
    if (state.open && !state.root) build();
    if (state.root) state.root.style.display = state.open ? 'block' : 'none';
  }

  function build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'tunePanel';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = '<button id="tuneCopy">Copy changes</button><button id="tuneReset">Reset</button>';
    panel.appendChild(bar);
    const note = document.createElement('div');
    note.id = 'tuneNote';
    note.textContent = 'F2 hides. Changes are live and in-memory only.';
    panel.appendChild(note);

    for (const [title, entries] of GROUPS) {
      const h = document.createElement('h2');
      h.textContent = title;
      panel.appendChild(h);
      for (const [obj, key, min, max, step] of entries) {
        if (typeof obj?.[key] !== 'number') continue; // a renamed constant should not break the panel
        panel.appendChild(makeRow(obj, key, min, max, step));
      }
    }
    document.body.appendChild(panel);
    state.root = panel;

    panel.querySelector('#tuneCopy').addEventListener('click', copyChanges);
    panel.querySelector('#tuneReset').addEventListener('click', resetAll);
  }

  function makeRow(obj, key, min, max, step) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('label');
    name.textContent = `${label(obj)}.${key}`;
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = fmt(obj[key]);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = obj[key];
    slider.addEventListener('input', () => {
      obj[key] = parseFloat(slider.value);
      val.textContent = fmt(obj[key]);
    });
    row.append(name, val, slider);
    state.rows.push({ obj, key, slider, val });
    return row;
  }

  function resetAll() {
    for (const r of state.rows) {
      const def = state.defaults.get(`${label(r.obj)}.${r.key}`);
      if (def === undefined) continue;
      r.obj[r.key] = def;
      r.slider.value = def;
      r.val.textContent = fmt(def);
    }
  }

  /** Only what actually moved, in a form that can be pasted back into config. */
  function copyChanges() {
    const lines = [];
    for (const r of state.rows) {
      const def = state.defaults.get(`${label(r.obj)}.${r.key}`);
      if (def === undefined || r.obj[r.key] === def) continue;
      lines.push(`${label(r.obj)}.${r.key}: ${fmt(r.obj[r.key])},   // was ${fmt(def)}`);
    }
    const text = lines.length ? lines.join('\n') : '(nothing changed yet)';
    navigator.clipboard?.writeText(text).catch(() => {});
    console.log('[tuning] changed values:\n' + text);
    const note = document.getElementById('tuneNote');
    if (note) note.textContent = lines.length ? `${lines.length} change(s) copied — also in the console.` : 'Nothing changed yet.';
  }

  return { toggle, get open() { return state.open; } };
}

/** Which config object this is, for a name the user can paste back. */
function label(obj) {
  if (obj === HORSE) return 'HORSE';
  if (obj === RIDING_POSE) return 'RIDING_POSE';
  if (obj === TACK) return 'TACK';
  if (obj === BANDIT) return 'BANDIT';
  if (obj === HEALTH) return 'HEALTH';
  if (obj === COMBAT) return 'COMBAT';
  if (obj === GUN) return 'GUN';
  if (obj === AIM_POSE) return 'AIM_POSE';
  if (obj === PLAYER) return 'PLAYER';
  if (obj === CAMERA) return 'CAMERA';
  if (obj === ANIM) return 'ANIM';
  return 'CONFIG';
}

function fmt(v) {
  if (!Number.isFinite(v)) return String(v);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
}
