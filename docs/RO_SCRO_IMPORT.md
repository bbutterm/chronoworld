# Importing assets from the scRO client (branch art/ro-scro-extract)

Delivery for `docs/RO_EXTRACT_LIST.md`: everything from the list has been extracted from the owner's scRO client
and converted into the game's formats. **Nothing has been added to the game yet**: `assets/`, `assets/sprites/sprites.json`,
`data/`, `src/` and `tools/` are unchanged, so the build and `npm run check` are not affected. Hooking it into the game is the agent's job (steps below).

Rights: these are original RO resources from the owner's client. The repository is private; do not publish them in public repositories or on the web.

## Where things are

| Path | Contents |
| --- | --- |
| `raw/ro/` | 617 client files copied byte for byte, laid out as in section 1 of RO_EXTRACT_LIST (`sprite/monster`, `sprite/npc`, `sprite/effect`, `texture/item`, `texture/collection`, `texture/illust`, `wav`, `wav/effect`, `bgm`, `mp3nametable.txt`) |
| `raw/ro/manifest.csv` | for every raw file: GRF path, archive (patch/data/rdata/loose), size, SHA-256, path in `raw/ro/` |
| `raw/ro-build/IMPORT_MANIFEST.json` | **main manifest**: every ready file → `target` (path in `assets/`), SHA-256, sources, `status`, `note` |
| `raw/ro-build/assets/` | ready files; the tree mirrors `assets/` (copy with the same relative path) |
| `raw/ro-build/sprites.fragment.json` | 60 `sprites[]` entries in `sprites.json` schema 2 format + the proposed `boss_xl` class |
| `raw/ro-build/ui_fx_npc.json` | details for icons, damage digits, NPCs |
| `raw/ro-build/qa/` | `contact_sheet.png`, `ui_fx_npc_preview.png`, `gif/<id>.gif` (×2, anchor cross, HIT marker) |
| `raw/ro-build/REPORT.md` | extraction report: checks, skipped frames, decisions |
| `raw/ro-build/tools/` | scripts that produced all of this (GRF reader, SPR/ACT renderer, builders, QA) |
| `raw/ro-build/SOURCE_PROVENANCE.md` | where the client came from (URL, SHA-256 of the archive, CRC check) |

`status` in IMPORT_MANIFEST: `ready` — can be added as is; `ready_with_skipped_frames` — oversized FX frames skipped (see `samplingExceptions`);
`needs_decision` — needs the owner's answer; `unusable` — do not use; `raw_needs_conversion` — audio in its original form.

## How the sheets were made (to trust them)

- SPR+ACT rendered with our own renderer (`raw/ro-build/tools/ro_spr_act.py`): palette, RGBA frames, layers, mirroring, colour, scale, rotation.
  x1, direction 6 (east), no shadow, ACT origin (0,0) at the class anchor, sampling exactly as in `tools/check_sprites.py`.
- Checked against the current sheets `melee` (Zombie), `fast` (Poring), `fabre`: anchors, frame counts and pixels match.
  Difference: ragassets loses one column of a mirrored layer, we keep it.
- `hitFrames.attack` comes from the ACT `atk` event (real moment of the hit) in 46 sheets out of 60; the others use spec default 3 (see `hitFrameSource`).
- All 60 sheets pass the `check_sprites.py` rules (script `raw/ro-build/tools/qa_sheets.py`), but they have not yet been run through the checker in the repository.

## Hook-up steps

Work in the working branch (`claude/idle-hero-rpg-gdd-rolicg`) after `git merge origin/art/ro-scro-extract`, file by file per IMPORT_MANIFEST.

1. **Monsters.** For every `sprite_sheet` with status `ready` / `ready_with_skipped_frames`, whose `units` are in the game:
   copy `file` → `target`; append the entry from `sprites.fragment.json` to `assets/sprites/sprites.json` → `sprites`
   (extra fields `units`, `sourceDelayMs`, `sourceSounds`, `hitFrameSource` can be dropped or kept — the loader `src/pipeline/sprites.ts` ignores them).
   In `data/units/*.json` point `visual.sprite` at the new id and remove the "patch" `tint`/`scale`. Unit → sheet table:
   field `units` in the manifest (for example `alde_keeper` → `clock_tower_manager`, `mob3_knight` → `abysmal_knight`,
   `sewer_bug_leader` shares a sheet with `thief_bug_male`). Add the new ids to `REQUIRED` in `tools/check_sprites.py`.
2. **3 MB budget.** `assets/sprites` is already 4.3 MB of PNG; the 60 new sheets add another 4.2 MB. Add only the sheets actually used,
   run `npm run assets:webp` and `python3 tools/check_sprites.py`. If the delivered size exceeds 3 MB, stop and tell the owner — do not recompress lossily.
3. **Items.** `item_icons` → `assets/ui/icons/item_<id>.png` (24×24, transparent), `item_collection` → `assets/ui/collection/item_<id>.png`.
   Hooking into `src/game/itemIcons.ts` and moving rarity colour to the cell frame are code changes (section 4 of RO_EXTRACT_LIST).
   For `geta` Fricco's Shoes (2417) is used: in scRO, 22145 is another item.
4. **Damage digits.** `assets/fx/damage/numbers|msg|bluemsg.png/.json` — Phaser atlases (JSON hash). `numbers_0…9` are white digits, tinted in code;
   `msg_0…5`: Miss, Guard, Crit, crit background, Lucky background, Lucky. `bluemsg` has no ACT in the client — use the `msg.act` layout (it is in `msg.json` → `meta.act`).
   Options for "the number in a frame" are in section 5 of RO_EXTRACT_LIST.
5. **NPCs and portraits.** `assets/sprites/npcs/<name>.png`: rows `idle_s`, `idle_e` (+ `walk_s`, `walk_e` if present), cell 240×224, anchor 100,120, 8 columns;
   portraits `assets/sprites/portraits/npc_<name>.png` are 64×64. `npc_4_orclady` is unusable (in scRO it is a chest) — Shaman Ugra takes the `orc_lady` sheet.
   Kafra illustration: `assets/ui/illust/kafra_01.png` (320×480).
6. **Sound and music.** `raw/ro/wav`, `raw/ro/wav/effect`, `raw/ro/bgm` are originals. Mapping to `SFX`/`MUSIC` ids in `src/game/audioCatalog.ts` is in sections 6–7
   of RO_EXTRACT_LIST. Convert to `assets/audio/<id>.ogg` and cut the music into loops (up to 1.5 MB) yourself; keep raw in `raw/`. Monster sounds
   (`monster_sound`) are the ones their ACT refers to; the per-animation list is `sourceSounds` in `sprites.fragment.json`.
   `_hit_short_sword.wav` is not in the client — use `_hit_dagger.wav`.
7. Before each commit: `npm run check`, `python3 tools/check_sprites.py`, `npm run assets:report`; for monster screens — e2e as per CLAUDE.md.

## Needs a decision from the owner (do not do without an answer)

1. `lord_of_death` does not fit any class even in stance (x −72…141, y −213…42). Built in the proposed class
   `boss_xl` (cell 296×272, anchor 96,218, 6 columns, sheet 1776×1360) — it is in `sprites.fragment.json` → `classes`, marked `proposed`.
   Needs: the class in `sprites.json`, `GRID`/`EXPECTED` in `tools/check_sprites.py`, the doc in `docs/SPRITE_SPEC.md`. Until then leave the unit on its current sheet.
2. `bloody_knight` (death 1 of 14 frames fit, attack 6 of 11) and `abysmal_knight` (attack 5 of 14, death 10 of 20): the cells are too narrow
   for their slashes/effects to the right. Options: a wider class, or FX as a separate layer. For now status `needs_decision`.
3. The other `samplingExceptions` (marin, clock_tower_manager, owl_baron, alarm, clock, elder, evil_druid, elder_willow, pharaoh, hylozoist):
   only flashes and explosions in attack/death are skipped, the body is intact — can be added, but look at the GIF in `raw/ro-build/qa/gif/`.
4. `normalizeV2` in `src/pipeline/sprites.ts` takes `columns` from the top level (8), not from the class. For `monster_xl`/`boss_xl`
   (6 columns) frames still come out right (≤6 frames per row), but keep this in mind when changing the loader.

## Rebuild

The scripts in `raw/ro-build/tools/` are hardwired to the client path `/root/ro-client-extraction-2/client/scRO` and to staging
`/root/ro-client-extraction-2/staging/ro-extract` (constants `CLIENT`/`ROOT` at the top of the files). Order:
`extract_list.py --force` → `build_sheets.py` → `build_ui.py` → `qa_sheets.py`. Needs Python 3 + Pillow + numpy.
