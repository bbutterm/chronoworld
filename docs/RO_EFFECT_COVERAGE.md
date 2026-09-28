# RO skill effect inventory (audited ledger)

Generate a fresh read-only ledger from the current brief, manifest and roBrowserLegacy checkout:

```sh
python3 tools/ro_effect_inventory.py --ro-browser /root/roBrowserLegacy \
  --json-out /tmp/ro-effect-inventory.json --csv-out /tmp/ro-effect-inventory.csv
python3 -m unittest tests/test_ro_effect_inventory.py -v
```

The ledger covers only the 151 skill rows in `docs/ART_REQUEST_SKILLS.md` (P1=26, P2=55, P3=70); icons and pets are separate requests. JSON retains the original label, owner, RO hint, requested components, source field/role and per-component status. CSV serializes nested fields as JSON cells. Outputs default to `/tmp` and are not committed. Inputs can be overridden with `--brief`, `--manifest`, `--ro-browser`; PNG existence is checked against the repository's `assets/` directory.

Status definitions:

- `runtime_complete`: every requested component has an existing sheet referenced by a matching manifest `skills` event (`hit` or `buff`). This is **mapping coverage only**, not gameplay screenshot, visual approval, nor proof of original RO extraction.
- `runtime_partial`: at least one but not all requested components have that runtime mapping.
- `atlas_only`: an associated PNG exists but no requested component is runtime-mapped. Inspect each component's `atlas_effects`; a role-mismatched sheet does not complete that component.
- `candidate_only`: no associated PNG, but a uniquely identified RO skill has source fields with IDs verified in `SkillEffect.js` plus numeric `EffectConst.js` or named `EffectTable.js` keys. A candidate is **not extracted**, rendered, QA'd or fit for reuse. `contextual` source `effectId` fields have no proven projectile/area/buff role.
- `missing`: neither associated PNG nor verified source candidate.

`components` distinguishes `runtime_mapped`, `atlas_only`, `candidate_only`, `missing`. `gaps` lists every requested component not runtime-mapped, including components with candidate IDs or an art-only sheet. Generic `fx_hit`/`fx_heal` do not automatically close a skill request. Manifest mappings for hit cannot close area, cast, projectile or enemy-debuff gaps. An existing projectile sheet without its travel hook remains `atlas_only` for that component. Named and numeric IDs are verified against this local source revision, not a historical lookup table. Unknown/ambiguous source labels, dynamic source assignments and original monster skills lacking RO references remain without inferred candidates. The parser is intentionally conservative; review `SkillEffect.js` manually before any future capture or role declaration.

No images were captured or modified by this inventory. RO provenance, alpha/compositing, sheet fit, rights, runtime hooks for non-hit/buff events, and in-game visibility all require separate QA.
