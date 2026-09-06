/**
 * menu.js — the main menu, the pause menu (the same overlay, reopened by Esc)
 * and the settings panel. BUILD-PLAN.md's round 7: "Main menu + pause +
 * settings (mouse sensitivity, shadow quality, draw distance)."
 *
 * All markup and styling live in index.html; this module only toggles classes,
 * reads the controls, persists them to localStorage and calls back into
 * main.js. It owns no game state.
 *
 *  - `showMain()`  — the boot screen. The world sims behind it (nothing is
 *    shooting yet); New Game / Continue take pointer lock and start play.
 *  - `showPause()` — Esc mid-game. `isPaused()` then reads true and main.js
 *    freezes the frame until Resume.
 *  - settings apply LIVE through the `applySettings` callback, and again once
 *    at construction so a persisted preference is in force before the menu is
 *    ever opened.
 */

import { MENU } from './config-polish.js';

function loadSettings() {
  const out = { ...MENU.defaults };
  try {
    const raw = localStorage.getItem(MENU.storageKey);
    if (raw) Object.assign(out, JSON.parse(raw));
  } catch { /* unreadable storage — the defaults stand */ }
  return out;
}

function saveSettings(s) {
  try {
    localStorage.setItem(MENU.storageKey, JSON.stringify(s));
  } catch { /* storage unavailable — settings just won't persist */ }
}

/**
 * @param {object} cb
 * @param {() => void} cb.onNewGame   clear the checkpoint and take pointer lock
 * @param {() => void} cb.onContinue  apply the checkpoint and take pointer lock
 * @param {() => void} cb.onResume    take pointer lock, nothing else
 * @param {() => void} cb.onSave      write a checkpoint now
 * @param {(settings:object) => void} cb.applySettings
 * @param {() => boolean} cb.hasCheckpoint
 */
export function initMenu(cb) {
  const el = (id) => document.getElementById(id);
  const menu = el('menu');
  const mainView = el('menuMain');
  const settingsView = el('menuSettings');
  const hint = el('menuHint');

  const settings = loadSettings();

  // ---- wire the settings controls -------------------------------------------
  const sens = el('setSens');
  const invertY = el('setInvertY');
  const shadow = el('setShadow');
  const draw = el('setDraw');
  const vol = el('setVol');
  const mute = el('setMute');

  function readControls() {
    settings.sensitivity = parseFloat(sens.value);
    settings.invertY = invertY.checked;
    settings.shadowQuality = shadow.value;
    settings.drawDistance = draw.value;
    settings.masterVolume = parseFloat(vol.value);
    settings.muted = mute.checked;
    saveSettings(settings);
    cb.applySettings(settings);
  }

  function writeControls() {
    if (sens) sens.value = String(settings.sensitivity);
    if (invertY) invertY.checked = !!settings.invertY;
    if (shadow) shadow.value = settings.shadowQuality;
    if (draw) draw.value = settings.drawDistance;
    if (vol) vol.value = String(settings.masterVolume);
    if (mute) mute.checked = !!settings.muted;
  }

  writeControls();
  for (const c of [sens, invertY, shadow, draw, vol, mute]) {
    c?.addEventListener('input', readControls);
    c?.addEventListener('change', readControls);
  }
  // Apply persisted preferences immediately, before the menu is opened.
  cb.applySettings(settings);

  // ---- overlay state ------------------------------------------------------
  let mode = 'hidden'; // 'hidden' | 'main' | 'pause'
  let view = 'main'; // 'main' | 'settings'

  function render() {
    const open = mode !== 'hidden';
    menu?.classList.toggle('hidden', !open);
    if (open) el('clickToPlay')?.classList.add('hidden');
    if (mainView) mainView.hidden = view !== 'main';
    if (settingsView) settingsView.hidden = view !== 'settings';
    // Which buttons make sense in which mode.
    const paused = mode === 'pause';
    menu?.querySelectorAll('[data-act]')?.forEach((b) => {
      const act = b.getAttribute('data-act');
      let show = true;
      if (act === 'resume' || act === 'save' || act === 'quit') show = paused;
      if (act === 'new') show = true;
      if (act === 'continue') show = !paused && cb.hasCheckpoint();
      if (view === 'settings') show = act === 'back';
      b.hidden = !show;
    });
    if (hint) hint.hidden = view === 'settings';
  }

  menu?.querySelectorAll('[data-act]')?.forEach((b) => {
    b.addEventListener('click', () => {
      switch (b.getAttribute('data-act')) {
        case 'resume': mode = 'hidden'; view = 'main'; render(); cb.onResume(); break;
        case 'new': mode = 'hidden'; view = 'main'; render(); cb.onNewGame(); break;
        case 'continue': mode = 'hidden'; view = 'main'; render(); cb.onContinue(); break;
        case 'save': cb.onSave(); flashSaved(b); break;
        case 'settings': view = 'settings'; render(); break;
        case 'back': view = 'main'; render(); break;
        case 'quit': mode = 'main'; view = 'main'; render(); break;
      }
    });
  });

  let savedTimer = 0;
  function flashSaved(btn) {
    btn.textContent = 'saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { btn.textContent = 'Save Checkpoint'; }, 1200);
  }

  return {
    settings,
    isOpen: () => mode !== 'hidden',
    isPaused: () => mode === 'pause',
    showMain() { mode = 'main'; view = 'main'; render(); },
    showPause() { mode = 'pause'; view = 'main'; render(); },
    hide() { mode = 'hidden'; view = 'main'; render(); },
    /** Re-evaluate which buttons show (e.g. after the first checkpoint is written). */
    refresh: render,
    /** Test hook — the smoke harness never takes pointer lock, so it dismisses the menu directly. */
    _apply: cb.applySettings,
  };
}
