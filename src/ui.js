/**
 * ui.js — the pointer-lock "click to play" overlay, the loading screen, and
 * the world-boundary warning fade. All DOM markup lives in index.html; this
 * module only toggles it.
 */

import { UI } from './config.js';
import { COMBAT } from './config-combat.js';

export function initUI() {
  const loading = document.getElementById('loading');
  const loadingStatus = document.getElementById('loadingStatus');
  const clickToPlay = document.getElementById('clickToPlay');
  const boundaryWarning = document.getElementById('boundaryWarning');
  const staminaBar = document.getElementById('staminaBar');
  const staminaFill = document.getElementById('staminaFill');
  const crosshair = document.getElementById('crosshair');
  const ammo = document.getElementById('ammo');
  const ammoCount = document.getElementById('ammoCount');
  const ammoPips = document.getElementById('ammoPips');
  let boundaryOpacity = 0;

  // One pip per chamber, built from COMBAT.magazine so a bigger cylinder is
  // still one number in one file. Markup lives in index.html for everything
  // that is fixed; this is the one piece that is not.
  const pips = [];
  if (ammoPips) {
    for (let i = 0; i < COMBAT.magazine; i++) {
      const pip = document.createElement('b');
      ammoPips.appendChild(pip);
      pips.push(pip);
    }
  }
  let shownAmmo = -1;
  let shownReloading = null;

  return {
    setLoadingText(text) {
      if (loadingStatus) loadingStatus.textContent = text;
    },
    hideLoading() {
      loading?.classList.add('hidden');
    },
    setPointerLocked(locked) {
      clickToPlay?.classList.toggle('hidden', locked);
    },
    /** proximity is 0 (safe) to 1 (at the hard boundary clamp). */
    updateBoundaryWarning(dt, proximity) {
      if (!boundaryWarning) return;
      const target = proximity * UI.boundaryMaxOpacity;
      const rate = target > boundaryOpacity ? UI.boundaryFadeIn : UI.boundaryFadeOut;
      const delta = target - boundaryOpacity;
      boundaryOpacity += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
      boundaryWarning.style.opacity = boundaryOpacity.toFixed(3);
    },
    /** Shows/hides the stamina bar — only relevant while mounted. */
    setMounted(mounted) {
      staminaBar?.classList.toggle('visible', mounted);
    },
    /** stamina is 0..1, exhausted is whether a gallop is currently refused. */
    updateStamina(stamina, exhausted) {
      if (!staminaFill) return;
      staminaFill.style.width = `${Math.round(stamina * 100)}%`;
      staminaFill.classList.toggle('exhausted', exhausted);
    },

    /** Shows the crosshair only while the gun is up. `weight` is combat.js's 0..1 aim blend. */
    setAiming(weight) {
      crosshair?.classList.toggle('visible', weight > 0.5);
    },

    /**
     * The ammo counter. Guarded on the values actually changing: this runs
     * every frame, and rewriting six pips' class lists 60 times a second to
     * say the same thing is the kind of free waste that adds up.
     */
    updateAmmo(rounds, reloading) {
      if (!ammo) return;
      ammo.classList.add('visible');
      if (rounds !== shownAmmo) {
        shownAmmo = rounds;
        if (ammoCount) ammoCount.textContent = String(rounds);
        for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('spent', i >= rounds);
      }
      if (reloading !== shownReloading) {
        shownReloading = reloading;
        ammo.classList.toggle('reloading', reloading);
      }
    },
  };
}
