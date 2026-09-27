# Terrain tiles — first batch

Five original overhead ground textures, each 128×128 RGBA PNG (opaque pixels), listed by ID in [`../manifest.json`](../manifest.json):

- `tile_grass_01`, `tile_grass_02` — two green grass variations; mix placements to reduce visible repetition.
- `tile_grass_dry` — dry grass.
- `tile_dirt` — bare earth/path base.
- `tile_stone` — irregular weathered paving.

All five wrap at the edges; repeated 3×3 previews and numerical seam checks are covered by `tests/test_terrain_tiles.py`. Regenerate with `python3 tools/build_terrain_tiles.py` (Pillow and NumPy). Original procedural art, not extracted RO client textures.

**Scope:** These are base surfaces, not an auto-tile/terrain transition atlas. They do not supply grass→dirt borders, cliffs, water, shadows, props, path geometry, or walkability metadata. The art repository has no game loader, tile grid specification or runtime scene; 128 px is a provisional art size rather than a confirmed engine tile size. Adjacent different terrain types will need transition overlays or scene composition.
