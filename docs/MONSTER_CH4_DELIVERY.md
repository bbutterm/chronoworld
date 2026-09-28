# Monster sprite delivery — chapter 4 (Sograt Desert)

Source order: [ART_REQUEST_CHAPTERS.md](ART_REQUEST_CHAPTERS.md). This is a **partial** chapter-4 delivery, not completion of the 24-monster / 8-background request.

## Delivered

| Unit | RO monster (mob ID) | Sheet | Runtime mapping |
| --- | --- | --- | --- |
| `mob4_melee` | Mummy (1041) | `assets/sprites/monsters/mummy.png` | `mummy`; original tint removed |
| `mob4_elite` | Verit (1032; legacy MonsterTable spells `Vorit`) | `assets/sprites/monsters/verit.png` | `verit`; old Raydric tint removed, uniform in-game visual scale 1.3 |
| `mob4_support` | Isis (1029) | `assets/sprites/bosses/isis.png` | `isis`; old Mandragora tint removed |

All five animation rows come from the east-facing, shadowless RO APNG/ACT frames at native x1, anchored at the shared class anchor. Isis uses the `boss` **sheet grid only**: its attack exits the smaller monster cell at the top. Its unit remains a normal support enemy. Empty cells are transparent. Indexed/RGBA PNG and lossless WebP versions are committed. The manifest uses `indent=0` to retain line breaks while keeping the full sprites directory under its existing 3,000,000-byte limit.

## Not delivered — actual native-frame overflow

Source APNGs were fetched and tested, but no sheets are committed for these IDs. The recorded rectangles are target bounds in the 256×256 boss cell, which has anchor (112,216); the validator requires a one-pixel interior margin:

| Unit | RO monster (mob ID) | Failing action/source frame | Boss-cell bounds | Problem |
| --- | --- | --- | --- | --- |
| `mob4_tank` | Sandman (1165) | death / 14 (last sampled frame) | `[44,132,182,261]` | 5 px past bottom |
| `mob4_ranged` | Marduk (1140) | death / 14 (last sampled frame) | `[95,-61,130,164]` | 61 px above top |
| `mob4_fast` | Scorpion (1001) | death / 5 (last sampled frame) | `[-28,138,215,223]` | 28 px past left; frame 4 also touches left border |

The monster grid also overflows for these units. None was shrunk, cropped, substituted with another species, or declared complete. Options require an explicit art/spec decision: a distinct larger grid and runtime format, or a documented exception that omits oversized ACT death effects and therefore no longer preserves the original last frame. Until then those three chapter-4 units retain existing placeholders. The eight requested backgrounds and chapters 5–7 are not covered by this batch.

## Evidence / reproducibility

Run `python3 tools/check_sprites.py` for the full manifest and `python3 tools/check_sprites.py --source-cache ~/.cache/chronoworld/v2 --only <id>` for pixel-perfect comparison of each delivered sheet against its downloaded source. Cached APNG source files are not committed. `npm run check`, `npm run build`, and a targeted runtime screenshot should be rerun before publishing. The compact preview sheet is an external QA artifact, not a runtime asset.
