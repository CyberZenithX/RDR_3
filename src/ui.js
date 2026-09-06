/**
 * ui.js — the pointer-lock "click to play" overlay, the loading screen, and
 * the world-boundary warning fade. All DOM markup lives in index.html; this
 * module only toggles it.
 */

import { UI } from './config.js';
import { COMBAT } from './config-combat.js';
import { HEALTH } from './config-ai.js';
import { WANTED } from './config-bounty.js';

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
  const healthBar = document.getElementById('health');
  const damageFlash = document.getElementById('damageFlash');
  const deathScreen = document.getElementById('deathScreen');
  const screenFade = document.getElementById('screenFade');
  const placeLabel = document.getElementById('placeLabel');
  const money = document.getElementById('money');
  const wanted = document.getElementById('wanted');
  const bountyText = document.getElementById('bountyText');
  const duelText = document.getElementById('duelText');
  let boundaryOpacity = 0;

  // One star per wanted level, built from WANTED.maxStars so retuning it stays
  // one number in one file — the ammo-pip pattern.
  const stars = [];
  if (wanted) {
    for (let i = 0; i < WANTED.maxStars; i++) {
      const s = document.createElement('b');
      s.textContent = '★';
      wanted.appendChild(s);
      stars.push(s);
    }
  }

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
  // One notch per hit the player can take, built from HEALTH.playerMax for the
  // same reason the ammo pips are built from COMBAT.magazine: retuning the
  // lethality stays one number in one file.
  const notches = [];
  if (healthBar) {
    for (let i = 0; i < HEALTH.playerMax; i++) {
      const notch = document.createElement('b');
      healthBar.appendChild(notch);
      notches.push(notch);
    }
  }
  let shownAmmo = -1;
  let shownReloading = null;
  let shownHealth = -1;
  let shownDead = null;
  let shownFlash = -1;
  let shownFade = -1;
  let shownPlace = undefined;
  let shownMoney = -1;
  let shownStars = -1;
  let shownBounty;
  let shownDuel;

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

    /**
     * The player's hit points, as whole notches — a count, not a bar, because
     * HEALTH counts hits rather than an abstract pool. Guarded on the value
     * changing, like the ammo pips: this runs every frame.
     */
    updateHealth(current) {
      if (!healthBar || current === shownHealth) return;
      shownHealth = current;
      for (let i = 0; i < notches.length; i++) notches[i].classList.toggle('lost', i >= current);
      healthBar.classList.toggle('low', current <= 1);
    },

    /** `flash` is player.damageFlash, a 1→0 ramp. Squared, so the fade reads faster than it leaves. */
    updateDamageFlash(flash) {
      if (!damageFlash) return;
      const opacity = Math.round(flash * flash * 1000) / 1000;
      if (opacity === shownFlash) return;
      shownFlash = opacity;
      damageFlash.style.opacity = String(opacity);
    },

    /**
     * Round 5's door transition. `opacity` is town.js's 0..1 fade — guarded on
     * the value changing, like the ammo pips, because this runs every frame and
     * is 0 for almost all of them.
     */
    updateScreenFade(opacity) {
      if (!screenFade) return;
      const v = Math.round(opacity * 1000) / 1000;
      if (v === shownFade) return;
      shownFade = v;
      screenFade.style.opacity = String(v);
      // Taken out of the compositing path entirely when clear, rather than left
      // as a full-screen transparent layer over every frame of the game.
      screenFade.style.visibility = v > 0.001 ? 'visible' : 'hidden';
    },

    /** The name of the place you are standing in, or null. */
    setPlaceName(name) {
      if (!placeLabel || name === shownPlace) return;
      shownPlace = name;
      placeLabel.textContent = name ?? '';
      placeLabel.classList.toggle('visible', !!name);
    },

    setDead(dead) {
      if (dead === shownDead) return;
      shownDead = dead;
      deathScreen?.classList.toggle('hidden', !dead);
    },

    /** Round 6: the money counter in the corner — a number, nothing to spend it on yet. */
    updateMoney(amount) {
      if (!money || amount === shownMoney) return;
      shownMoney = amount;
      money.textContent = `$${amount}`;
    },

    /** The wanted star meter. Shown only above zero, like the stamina bar. */
    updateWanted(count) {
      if (!wanted || count === shownStars) return;
      shownStars = count;
      for (let i = 0; i < stars.length; i++) stars[i].classList.toggle('lit', i < count);
      wanted.classList.toggle('visible', count > 0);
    },

    /** The bounty board / active-bounty line. `text` is bounties.hudText or null. */
    setBountyText(text) {
      if (!bountyText || text === shownBounty) return;
      shownBounty = text;
      bountyText.textContent = text ?? '';
      bountyText.classList.toggle('visible', !!text);
    },

    /** The duel banner: prompt, the DRAW signal, and the result. `state` is duel.hudState. */
    setDuel(state) {
      if (!duelText || state === shownDuel) return;
      shownDuel = state;
      const label = {
        prompt: 'press F  ·  challenge to a duel',
        faceoff: '',
        standoff: '…',
        draw: 'DRAW',
        win: 'clean kill',
        lost: 'too slow',
      }[state] ?? '';
      duelText.textContent = label;
      duelText.classList.toggle('visible', !!label);
      duelText.classList.toggle('signal', state === 'draw');
      duelText.classList.toggle('result', state === 'win' || state === 'lost');
      duelText.classList.toggle('prompt', state === 'prompt');
    },
  };
}
