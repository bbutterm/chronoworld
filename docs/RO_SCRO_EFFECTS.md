# Skill effects from the scRO client (branch art/ro-scro-extract)

Skill effects extracted from the owner's client (`client/scRO`, source in `raw/ro-build/SOURCE_PROVENANCE.md`),
in the same format as the current `assets/effects/effects.json` in main. **Nothing has been added to the game yet** —
`assets/`, `src/`, `data/` are untouched; the agent does the hook-up (steps below). Delivered in parts; each part lives in its own folder.

## How they were made

Effects in RO are STR animations, sprites and client code, so they are rendered by the real engine:
roBrowserLegacy EffectViewer (vite dev) in Electron under Xvfb, frame by frame on a frozen clock (12 fps, fixed seed).
Resources are served **only from the scRO GRF** by the local remote client `raw/ro-build/tools/fx/ro_remote_client.py`
(not grf.robrowser.com, which the 35 sheets in main came from). During the capture every file roBrowser requested was
found in the client — there are no substitutions.

- Scale: calibrated from the EffectViewer camera, 1.0417 screen px per sprite px → the sheet is brought to RO sprite pixels
  (like the heroes and monsters). Large effects were re-captured on a 1600×1200 canvas at camera zoom 250 (same scale, 2× the view)
  so they are not clipped.
- The viewer's dummy target (a novice) is hidden (`renderEntity` = noop); effects attached to it stay.
  Figures inside effects (the clown in Provoke, the merchant in Mammonite, angels in Impositio/Magnificat/Assumptio,
  the figure in Lex Aeterna) are the textures of those STR files in the client itself, not a baked-in character.
- Format as in main: RGBA, `blend: "normal"` (alpha from brightness of an additive effect on black), all frames share one
  crop box, `anchor` = target feet in cell coordinates, `ms` 83.33 (12 fps).
- 2048 px limit: large effects keep as many evenly spaced frames as fit, `ms` increases so the total duration is unchanged
  (see `results[].thinned` → `frames`).
- Effects that loop in RO (Grimtooth, Sanctuary, Magnus ground) — one cycle, `loop: true`; Volcano (continuous, no clean
  cycle) — first 2 s.

## Part 1 — new skill effects (`raw/ro-build/effects/p1/`)

27 sheets for skills that had no effect in the game. Files: `assets/effects/*.png` (copy to `assets/effects/`),
`effects.fragment.json` → `effects[]` (append to `assets/effects/effects.json` → `effects`) and `skills`
(merge into `effects.json` → `skills`), `qa/effects_*.png` — preview (frames 0 / middle / last on dark and light,
orc_warrior ×1 at the anchor).

Skill mapping (`skills`, game format hit|buff|debuff|cast|ground): Provoke debuff, Mammonite hit, Arrow Shower ground,
Improve Concentration buff, Angelus buff, Hammer Fall ground, Jupitel Thunder hit, Quagmire ground, Volcano ground,
Impositio Manus buff, Magnus Exorcismus cast + ground, Lex Aeterna debuff, Kyrie Eleison buff, Sanctuary ground,
Assumptio buff, Grimtooth hit, Venom Splasher hit, Parrying buff, Crazy Uproar buff, Magnificat buff.
Plus exact RO matches to sheets already in main: Meteor Storm hit → `fx_job_mage_fire_bolt` (hitEffectId 49),
Energy Coat buff → `fx_shield` (169), Enchant Poison hit → `fx_job_thief_envenom` (20).

Projectiles — **atlases only, not wired** (the game has no hook for a travelling projectile, see `docs/RO_EFFECT_COVERAGE.md`):
`fx_job_mage_fire_bolt_projectile`, `fx_job_mage_cold_bolt_projectile` (falling ice bolts, target = caster in the viewer),
`fx_job_mage_frost_diver_projectile`, `fx_job_thief_venom_knife_projectile`, `fx_job_wizard_jupitel_thunder_projectile`,
`fx_job_alchemist_acid_terror_projectile`.

Weak / needs a look before hook-up: `fx_job_wizard_quagmire` (very faint), `fx_job_priest_sanctuary` and
`fx_job_priest_magnus_exorcismus_ground` (in RO these are per-map-cell effects: one cell is only a narrow column 40–42 px wide),
`fx_job_archer_arrow_shower` (1 frame: arrows stuck in the ground). Large ones with few frames after fitting into 2048:
Kyrie 9 of 23, Assumptio 9 of 28, Magnus cast 12 of 37.

Not captured (roBrowser has no visual for these, or they depend on a scene entity; all resources were present in the client):
Sand Attack 310 and Cart Termination 518 (not in the EffectViewer list); Cold Bolt hit 51, Blitz Beat 115, Power Thrust 128,
Spiral Pierce 339, Investigate 267, Back Stab 275, Assassin Cross 287 (sound only in roBrowser);
Falcon Assault 387, Acid Demonstration 537, Adrenaline Rush 98, Mystical Amplification `ef_magicpower`
(FUNC effects / tied to an entity); Magnum Break area `quake_magnum` (camera shake, no picture).

Weight: 27 PNGs ≈ 9.7 MB (large RGBA cells). Before adding them, run `npm run assets:webp` and check the budget in `npm run assets:report`;
add only what is actually wired to skills.

## Part 2 — the 35 effects already in the game, re-captured from scRO (`raw/ro-build/effects/p2/`)

The sheets in main were captured from the public roBrowser client (grf.robrowser.com). Here are the same 35 effects,
**from the owner's client**, with the same `id` and `attach`, so they are drop-in replacements: overwrite
`assets/effects/<id>.png` and replace the entry with the same id in `effects.json` → `effects` (the `skills` mapping does not change).
Same post-processing as main: gold grade for Blessing (`tools/tint_blessing_effect.py` logic), faint-alpha cleanup for
`fx_magic` and Thunderstorm; noise-crop thresholds for large effects.

`effects.fragment.json` → `results[].recommendation`:
- `replace` (30) — same or more frames, full extent (often larger and more complete than in main: Cart Revolution, Frost Diver,
  Defender, Magnum Break), source is the owner's client.
- `keep_main` (5) — the full-size effect does not fit into 2048 px with enough frames, keep the current sheet:
  Signum Crucis (12 of 24: the cross starts huge), Storm Gust (9 of 48), Weapon Perfection (16 of 20), Holy Cross (9 of 11),
  Meteor Storm (8 of 18: the meteor falls from high up, 476×988 cell).
`qa/effects_*.png` — the first column is the current main sheet (middle frame), then scRO frames 0 / middle / last.

## Hook-up (agent)

1. For each part: copy the PNGs to `assets/effects/`, merge `effects` and `skills` from `effects.fragment.json` into `assets/effects/effects.json`.
2. `npm run assets:webp`, `npm run check`, `npm run e2e` (battle with those skills), look at the effect in battle over a light and a dark background.
3. Update `assets/effects/README.md` (table of sources: scRO client, local remote client) and `docs/RO_EFFECT_COVERAGE.md`.
Tools for re-capture — `raw/ro-build/tools/fx/` (the README there describes the order).
