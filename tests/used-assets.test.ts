import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../src/pipeline/sprites';
import { loadFullContext, ROOT } from '../scripts/lib/content-node';
import { collectUsedAssets, listAssetFiles, usedAssets } from '../scripts/lib/used-assets';

const json = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

describe('O: used assets (что попадает в dist)', () => {
  const used = collectUsedAssets(ROOT);
  const files = new Set(used.files);

  it('включает каждый файл из assets/manifest.json (file и atlasXml)', () => {
    const manifest = json('assets/manifest.json') as { assets: Record<string, { file?: string | null; atlasXml?: string }> };
    for (const a of Object.values(manifest.assets)) {
      if (!a.file) continue;
      expect(files).toContain(a.file);
      if (a.atlasXml) expect(files).toContain(a.atlasXml);
    }
  });

  it('включает все шесть анимированных FX в сборку, даже пока статические fallback остаются в манифесте', () => {
    const catalog = json('assets/effects/effects.json') as { effects: { id: string; file: string }[] };
    expect(catalog.effects.map((effect) => effect.id).sort()).toEqual(['fx_arrow', 'fx_death', 'fx_heal', 'fx_hit', 'fx_magic', 'fx_shield']);
    for (const effect of catalog.effects) expect(files).toContain(effect.file);
  });

  it('включает лист и портрет каждого спрайта, на который ссылается контент', () => {
    const ctx = loadFullContext();
    const registry = buildRegistry(json('assets/sprites.legacy.json'), json('assets/sprites/sprites.json'));
    const ids = [...Object.values(ctx.content.units), ...Object.values(ctx.content.jobs)].map((x) => x.visual.sprite);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const s = registry[id];
      if (!s) {
        expect(used.missingSprites).toContain(id);
        continue;
      }
      expect(files).toContain(s.file);
      if (s.portrait) expect(files).toContain(s.portrait);
    }
  });

  it('не берёт огромные старые листы монстров, на которые контент не ссылается', () => {
    expect(files).not.toContain('ro/sheets/enemy_boss_ch6.png');
    expect(files).not.toContain('ro/sheets/enemy_melee.png');
    expect(files).not.toContain('ro/README.md');
    expect(files).not.toContain('manifest.json');
  });

  it('все нужные файлы лежат на диске', () => {
    const present = new Set(listAssetFiles(ROOT));
    expect(used.files.filter((f) => !present.has(f))).toEqual([]);
  });

  it('v2 перекрывает legacy по id; неизвестный спрайт — в missingSprites', () => {
    const r = usedAssets({
      manifest: { assets: { a: { file: 'ui/a.png' }, b: { file: null } } },
      legacy: { sprites: [{ id: 'x', file: 'ro/old.png', cell: [1, 1], anchor: [0, 0], columns: 1, scale: 1, anims: {}, portrait: 'ro/p.png' }] },
      v2: {
        schema: 2,
        columns: 1,
        classes: { hero: { cell: [1, 1], anchor: [0, 0], anims: ['idle'] } },
        anims: { idle: { frames: 1, ms: 100 } },
        sprites: [{ id: 'x', class: 'hero', file: 'sprites/x.png' }],
      },
      spriteIds: ['x', 'nope'],
    });
    expect(r.files).toEqual(['sprites/x.png', 'ui/a.png']);
    expect(r.missingSprites).toEqual(['nope']);
  });
});
