import { existsSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectUsedAssets } from '../scripts/lib/used-assets';
import { loadFullContext } from '../scripts/lib/content-node';

/**
 * Рисунки карт RO (assets/ui/cards, tools/ro_cards.py, src/game/cardArt.ts): у каждой карты MVP охоты и каждой карты
 * Башни с монстром есть рисунок — свой (<id>.webp) или карты MVP того же монстра (card_<id>.webp); все едут в сборку.
 */
const ctx = loadFullContext();
const DIR = 'assets/ui/cards';
const art = (id: string) => [`${DIR}/${id}.webp`, `${DIR}/card_${id}.webp`].find((f) => existsSync(f));

describe('рисунки карт RO', () => {
  it('у всех карт MVP и карт Башни с монстром есть рисунок', () => {
    const missing = [
      ...ctx.hunt.cards.map((c) => c.id),
      ...ctx.tower.run!.blessings.filter((b) => b.monster).map((b) => b.id),
    ].filter((id) => !art(id));
    expect(missing).toEqual([]);
  });

  it('рисунки лёгкие (≤ 30 КБ) и попадают в сборку', () => {
    const files = readdirSync(DIR).filter((n) => n.endsWith('.webp'));
    expect(files.length).toBeGreaterThanOrEqual(38);
    for (const f of files) expect(statSync(`${DIR}/${f}`).size, f).toBeLessThanOrEqual(30_000);
    const used = new Set(collectUsedAssets('.').files);
    for (const f of files) expect(used.has(`ui/cards/${f}`), f).toBe(true);
  });
});
