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
  };
}
