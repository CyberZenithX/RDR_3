/**
 * ui.js — the pointer-lock "click to play" overlay, the loading screen, and
 * the world-boundary warning fade. All DOM markup lives in index.html; this
 * module only toggles it.
 */

import { UI } from './config.js';

export function initUI() {
  const loading = document.getElementById('loading');
  const loadingStatus = document.getElementById('loadingStatus');
  const clickToPlay = document.getElementById('clickToPlay');
  const boundaryWarning = document.getElementById('boundaryWarning');
  const staminaBar = document.getElementById('staminaBar');
  const staminaFill = document.getElementById('staminaFill');
  let boundaryOpacity = 0;

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
  };
}
