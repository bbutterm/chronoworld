# RO effects — captured frame sequences

Forty-two RO-derived PNG atlases and [`effects.json`](effects.json) are an **animated alternative** to the original static decals under `assets/fx/`. The game loads these as `anim_fx_*` spritesheets; the original `fx_*` images stay in `assets/manifest.json` as fallbacks if an atlas fails to load. `src/game/battleFx.ts` samples authored frames using the pooled effect loop. No separate per-frame timers are created.

| ID | Source in roBrowserLegacy EffectViewer | Frames | Usage |
| --- | --- | ---: | --- |
| `fx_hit` | `EF_HIT2` / 1 | 3 | Hit on target |
| `fx_arrow` | `ef_arrow_projectile` | **1** | Arrow image; tween from caster to target in game |
| `fx_magic` | `EF_MAGICALATTHIT` / 182 | 8 | Magic hit on target |
| `fx_heal` | `EF_HEAL` / 312 | 17 | Heal on target |
| `fx_shield` | `EF_ENERGYCOAT` / 169 | 3 | Brief blue protective burst; **not** a sustained dome |
| `fx_death` | `EF_DEVIL` / 372 | 22 | Rising death spirit **on top of**, not instead of, the unit death animation |
| `fx_job_mage_thunderstorm` | `EF_THUNDERSTORM` / 30 | 11 | P1 Kai: lightning hit on each damaged target, captured at zoom 200 to avoid clipping; low-alpha source texture noise removed |
| `fx_job_acolyte_blessing` | `EF_BLESSING` / 42 | 20 | P1 Vika: spark aura on buffed ally; cyan source light graded gold by `tools/tint_blessing_effect.py` |
| `fx_job_mage_fire_bolt` | `EF_FIREHIT` / 49 | 5 | Fire Bolt and Fire Ball impact on damaged target; incoming bolt travel not included |
| `fx_job_mage_fire_ball_projectile` | `EF_FIREBALL` / 24 | 3 | Authentic before-hit frames, **not runtime-wired as a travelling projectile**; flight remains missing |
| `fx_job_mage_frost_diver` | `EF_FROSTDIVER2` / 28 | 11 | Frost Diver ice impact on target; the release shard is a separate art-only atlas, with projectile travel still unwired |
| `fx_job_mage_frost_diver_release` | `EF_FROSTDIVER` / 27 | 8 | Authentic release shard; atlas-only because runtime projectile motion is not wired |
| `fx_job_wizard_jupitel_thunder_target` | `EF_YUFITEL` / 93 | 2 | Original use-level target lightning effect; art-only because runtime has no exact use-level target event |
| `fx_job_wizard_jupitel_thunder_projectile` | `EF_YUFITELHIT` / 94 | 3 | Authentic before-hit projectile cue; travel remains runtime-unwired |
| `fx_job_sage_volcano_ground` | `EF_BOTTOM_VO` / 239 | 28 | Volcano ground eruption, mapped to the supported ground role |
| `fx_job_alchemist_acid_terror_projectile` | `EF_THROWITEM` / 298 | 3 | Acid Terror before-hit projectile cue; art-only, not a complete hit or runtime projectile |
| `fx_job_thief_venom_knife_projectile` | `EF_THROWITEM6` / 600 | 2 | Venom Knife thrown-item source; art-only, runtime flight is not wired |
| `fx_job_archer_arrow_shower_source` | `ef_arrow_shower_projectile` | 1 | Original 3D source duplicated 10×; static art-only capture, not the complete area effect |
| `fx_job_merchant_cart_revolution` | `EF_CARTREVOLUTION` / 170 | 3 | RO impact burst on each hit target; not a whole-screen cart sweep |
| `fx_job_acolyte_holy_light` | `EF_HOLYHIT` / 152 | 4 | Holy Light impact cross on target; not a caster-to-target beam |
| `fx_job_acolyte_signum_crucis` | `EF_SIGNUM` / 40 | 22 | Source cross on enemy status.apply; zoom 200 prevents significant top-edge clipping, faint edge noise remains below intensity 24 |
| `fx_job_acolyte_increase_agi` | `EF_INCAGILITY` / 37 | 22 | RO's `AGI UP` text and rising streaks on ally buff |
| `fx_swordman_bash` | `EF_BASH` / 16 | 11 | P1 cast spark wired at attack/cast start; source is white, not the requested red impact; `SM_BASH` has separate `EF_HIT2` hit |
| `fx_job_thief_envenom` | `EF_PATTACK` / 20 | 23 | P1 purple RO poison spark on hit, not the requested green cut |
| `fx_job_crusader_defender` | `EF_DEFENDER` / 222 | 23 | P2 ally buff: white defensive column rather than literal shields |
| `fx_job_assassin_sonic_blow` | `EF_SONICBLOW2` / 143 | 7 | P2 slash cluster with original red ideogram on target; caster cue and separate hit ID not included |
| `fx_job_crusader_holy_cross` | `EF_HOLYCROSS` / 245 | 11 | P2 target light-cross hit, zoom 200 recapture to avoid edge clipping |
| `fx_job_crusader_grand_cross` | `EF_GRANDCROSS` / 226 | 23 | P2 ground cross wired once at skill impact; separate cast cue still missing |
| `fx_job_wizard_storm_gust` | `EF_STORMGUST` / 89 | 22 | P2 blizzard wired once at skill impact; edge warning is sub-threshold noise |
| `fx_job_crusader_shield_charge` | `EF_SHIELDCHARGE` / 246 | 12 | P2 shield impact on target, not projectile travel |
| `fx_job_hunter_claymore_trap` | `EF_CLAYMORE` / 107 | 9 | P2 orange trap explosion on hit, not visible placed trap |
| `fx_job_hunter_sandman` | `EF_SANDMAN` / 139 | 17 | P2 green sleep cloud wired on enemy status.apply |
| `fx_job_blacksmith_weapon_perfection` | `EF_PERFECTION` / 103 | 20 | P2 ally buff: original RO sword and green arcs |
| `fx_swordman_endure` | `EF_ENDURE` / 11 | 11 | P3 original runic buff on caster, not a persistent shield |
| `fx_job_knight_bowling_bash` | `EF_BOWLINGBASH` / 149 | 3 | P2 blue caster slash wired at attack/cast start; **not a target impact** or complete requested area |
| `fx_job_wizard_meteor_storm` | `EF_METEOR` / 92 | 18 | P2 falling meteor, source recaptured at camera zoom 350 to avoid significant clipping; fire hit and multi-target sequencing separate |
| `fx_job_sage_earth_spike` | `EF_EARTHSPIKE` / 79 | 28 | P2 individual earth spike on target |
| `fx_job_sage_heavens_drive` | `EF_HEAVENDRIVE` / 142 | 15 | P2 row of earthen spikes wired once at area impact |
| `fx_job_sage_dispell` | `EF_DISPELL` / 235 | 7 | P2 source rune/circle on target, wired to this game’s enemy “Развеивание” status.apply (ATK/DEF debuff, not RO dispel removal); faint edge noise under visible threshold |
| `fx_job_knight_two_hand_quicken` | `EF_TWOHANDQUICKEN` / 130 | 4 | P3 original buff orb on caster |
| `fx_job_thief_steal` | `EF_STEAL` / 18 | 5 | P1 target glint **art only**: energy-drain success event not yet mapped |
| `fx_job_swordman_magnum_break` | `EF_MAGNUMBREAK` / 17 | 3 | P1 warm caster ring; not the multi-target explosion |

This is a **partial P1/P2/P3 delivery**, not completion of `docs/ART_REQUEST_SKILLS.md`: other skills or individual skill components still use procedural recipes. Shared P3 mappings deliberately reuse compatible *captured* RO effects, not new bespoke sources: `mob2_ranged_poison_arrow` and `mob_poporing_goo` use the Envenom target hit; `mob3_melee_rend`, `mob3_elite_cleave`, `warrior_cleave`, and `assassin_leap` use the Sonic Blow slash hit. These do **not** imply complete projectile travel, enemy status animation, or unique monster skill art. Captures rejected from this batch: Magnificat/76 (baked character), Acid Demonstration/537 (empty), Cart Termination/518 (not available in this viewer), and Quagmire/95 (too faint for gameplay use). Acid Terror/298 is now included only as an art-only three-frame projectile cue; the full skill and projectile travel remain incomplete. `skill_mc_fryingpan.png` is an earlier original 24×24 icon (not part of these extraction-only batches). The raw EffectViewer frame sequences are intentionally kept out of Git. Each new atlas uses fixed bounds across its frames and 83.33 ms/frame, fits under 2048px/side and was previewed over dark and light backgrounds. Source event names were checked against `SkillEffect.js`, then rendered; effect ID lookup alone is not evidence of usable art.

**Provenance:** Real frames were captured with roBrowserLegacy's `api-effectviewer-frame.html` and its configured public Remote Client `https://grf.robrowser.com/`. The repository owner's rights statement for RO art is in [`assets/ro/README.md`](../ro/README.md); the renderer's code license does not grant rights to the underlying game art. No GRF, SPR, ACT, original client packages, raw capture frames, or credentials are committed here.

**Format:** Each sheet is RGBA, grid-ordered row-major; `cell`, `columns`, `frames`, `ms`, `delayMs`, and `anchor` are specified per effect in `effects.json`. `anchor` is the pixel point in a *cell* corresponding to the character's feet and may lie outside the cell. Position the effect by aligning this point with the unit's feet. `blend: normal` refers to an alpha approximation derived from an additive effect rendered against black; preview against both dark and light gameplay backgrounds. For `fx_magic`, alpha values below 24 were cleared to reduce a faint rectangular source-quad artifact. The earlier `EF_KYRIE` capture was rejected because it baked a character into the effect; the shipped `EF_ENERGYCOAT` does not. `fx_arrow` is deliberately a one-frame projectile, **not** a claim of frame animation; its travel is gameplay-side. `fx_magic` is a hit animation, so the existing still image remains in use for a flying magic projectile.

Implementation: `src/game/assets.ts` loads all catalogued sheets with Phaser under `anim_fx_*`; `src/game/animatedFx.ts` selects a usable atlas and computes frames from the catalog. `FloatLayer.flash()` aligns an animated hit to the unit's feet, and `FloatLayer.projectile()` moves the single arrow frame. Loaded still-image keys and their existing static fallback behavior remain unchanged. The bundled browser smoke test is the runtime verification path; mobile/WebView appearance and performance still require device testing.

**Skill mapping (`effects.json` → `skills`):** `{"<skillId>": {"hit": "fx_magic", "buff": "fx_shield", "cast": "fx_magic", "ground": "fx_job_sage_volcano_ground", "debuff": "..."}}` — `hit` plays on each damaged target, `buff` on an ally receiving a status, `cast` at cast start, `ground` for a ground-area cue, and `debuff` for an enemy status cue. Supported map roles are `hit`, `buff`, `cast`, `ground`, `debuff` and (since 29.09) `projectile`: the atlas travels from caster to target at runtime, its frames looping during the flight (`src/game/skillSigs.ts` `flyAtlas`, on-screen width and rotation per atlas in `FLY_LOOK`); for an `arrows` area it drops onto each target. Since 29.09 every `fx_job_*` / `fx_swordman_*` atlas above, including the seven formerly art-only captures, is mapped to at least one hero or monster skill — the list is in `docs/content/skills-vfx.md` («Атласы RO в бою»), the step-by-step recipe in `docs/CONTENT_RECIPES.md` §12а. Unmapped skills use the game's rule: skills with a cast time or a mage's ranged skill hit with `fx_magic`, heals use `fx_heal`, ally buffs `fx_shield`, everything else the unit's `visual.hitFx` (`fx_hit`).
