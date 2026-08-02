# SMOKE-TEST.md

**This is a manual checklist for the human.** Claude cannot see the game running —
it has no eyes on a browser window and cannot tell whether the horse feels good to
ride. Everything machine-checkable lives in `scripts/smoke.mjs` and runs
automatically. Everything below is yours to walk by hand.

Run the game first:

```bash
npx serve .
```

Then open the URL it prints. Do not double-click `index.html` — ES modules and GLB
loading need `http://`.

Lines are added every round and never deleted. If something here breaks, say so —
fixing it comes before any new feature.

---

## Round 0 — assets

1. Page loads at the served URL and shows the **DUST & IRON** title over a dark
   ochre background, with a slowly rotating bronze torus knot. (Round 1 replaces
   this placeholder with the real world.)
2. The status line reads `three.js r160 — running`, not `booting…`. If it still
   says `booting…`, the CDN import map failed.
3. Browser console is clean — no red errors.
