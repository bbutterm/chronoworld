# scRO → game assets: first batch from RO_EXTRACT_LIST (2026-09-29)

Source: `client/scRO` (see `../../SOURCE_PROVENANCE.md`); GRF priority patch → data → rdata.
The client, `/root/chronoworld`, and any repository were not changed; nothing was published.
Target format: `docs/SPRITE_SPEC.md` + `tools/check_sprites.py` from chronoworld **origin/main 9e5589691**
(read via the GitHub API; the local copy is 372 commits behind).

## Contents
| Folder | What |
|---|---|
| `raw/ro/…` | 617 byte-exact files (92.5 MB), layout as in the list. `raw/manifest.csv`: GRF path, archive, size, SHA-256, output. `raw/missing.txt` is empty |
| `assets/sprites/{monsters,bosses,monsters_xl,bosses_xl}/*.png` | 60 v2 sheets (44 required + 16 optional), ×1, direction 6, no shadow, ACT (0,0) at the class anchor |
| `assets/sprites/sprites.fragment.json` | `sprites[]` entries in the schema-2 manifest format (+ `units`, `sourceDelayMs`, `sourceSounds`, `hitFrameSource`) |
| `assets/sprites/npcs/*.png`, `portraits/npc_*.png` | 9 NPCs: stance south/east (+walk if present), 64×64 portrait |
| `assets/ui/icons/item_<id>.png`, `ui/collection/item_<id>.png` | 67 icons 24×24 + 67 description images; magenta → transparent |
| `assets/ui/illust/kafra_01.png` | Kafra illustration 320×480 |
| `assets/fx/damage/{numbers,msg,bluemsg}.png/.json` | damage digits 0–9, Miss/Guard/Crit/crit background/Lucky; Phaser atlas + ACT layout |
| `assets/ui_fx_npc.json` | index for icons / FX / NPCs |
| `qa/contact_sheet.png`, `qa/ui_fx_npc_preview.png`, `qa/gif/*.gif` | previews (GIFs: ×2, anchor cross, HIT marker) |

Scripts (reproducible): `/root/ro-client-extraction-2/tools/` — `grf.py`, `ro_spr_act.py`, `extract_list.py`,
`build_sheets.py`, `build_ui.py`, `qa_sheets.py`.

## Checks
- `qa_sheets.py`: 60/60 sheets pass the `check_sprites.py` rules (size, frame count, empty cells, cell edges,
  ACT origin ↔ bbox, sampling indices, `bbox`, `hitFrame`, semi-transparency only from the source).
- Renderer checked against the accepted sheets `melee` (Zombie), `fast` (Poring), `fabre` from origin/main:
  anchors, frame counts and pixels match. One exception: ragassets (which rendered the current sheets) loses
  one column when mirroring a layer and shifts it 1 px. We keep all source pixels.
- `hitFrame` is taken from the ACT `atk` event (the actual moment of the hit) in 46 of 60 cases; for the other 14
  there is no event and the spec default 3 is used.

## What needs a decision
1. **Lord of the Dead** does not fit any approved grid even in stance (x −72…141, y −213…42). Built in the
   proposed class `boss_xl` 296×272, anchor 96,218, 6 columns (1776×1360). Needs the manifest/checker to
   accept the class, otherwise it stays out of the game.
2. **Frames wider than the cell** (almost always slashes, flashes and explosions extending right, "forward")
   are skipped and recorded in `samplingExceptions`, like the existing Willow/Poring exceptions:
   marin death 7/17; clock_tower_manager attack 6/14; owl_baron death 44/71; alarm attack 4/20;
   clock attack 5/22; elder attack 10/24; abysmal_knight walk 1/8, attack 9/14, death 10/20;
   evil_druid attack 6/12; lord_of_death death 3/27; **bloody_knight attack 5/11, death 13/14**;
   elder_willow death 18/21; pharaoh attack 6/16, death 8/64; hylozoist death 6/27.
   bloody_knight and abysmal_knight lose the most — a wider class, or FX as a separate layer, is recommended.
3. Name choices: 22145 Tengu's Geta in scRO is `마력석_초록` (a stone) → **Fricco's Shoes 2417** is used for `geta`.
   Both `thief_bug` and `thief_bug_larva` are built.
4. **`4_orclady` in scRO is a treasure chest** (2 frames 67×50, magenta inside the image), not an orc lady. Not usable as
   an NPC; for Shaman Ugra use the monster sheet `orc_lady`.
5. Missing from the client: `bluemsg.act` (draw `bluemsg` with `msg.act` frames), NewNumber/Han (0/6),
   `_hit_short_sword.wav` (`_hit_dagger.wav` is present).

## Not done in this step
- Audio is only raw (WAV/MP3 as in the client): no lossy transcoding or loop cutting without a decision.
- Heroes with equipment, maps (RSW/GND/GAT) and STR skill effects are not in the list, so they were not built.
- Nothing has been added to chronoworld: this needs permission and a fresh branch; after that the fragment can be
  merged into `sprites.json` and the checker run in the repository.
