import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

  it('новые карты имеют проверяемое происхождение и настоящие WebP вместо заглушек', () => {
    const sources = JSON.parse(readFileSync(`${DIR}/web-sources.json`, 'utf8'));
    expect(sources.cards.map((c: { blessingId: string }) => c.blessingId).sort()).toEqual(['marse', 'side_winder', 'sohee']);
    for (const card of sources.cards) {
      const file = readFileSync(card.asset.file);
      expect(file.toString('ascii', 0, 4)).toBe('RIFF');
      expect(file.toString('ascii', 8, 12)).toBe('WEBP');
      expect(file.length).toBe(card.asset.bytes);
      expect(createHash('sha256').update(file).digest('hex')).toBe(card.asset.sha256);
      expect(card.asset.file).toBe(`${DIR}/${card.blessingId}.webp`);
      expect(card.asset.width).toBe(180);
      expect(card.asset.height).toBe(240);
      expect(new URL(card.sourcePage).hostname).toBe('ro.gnjoy.com');
      expect(new URL(card.sourceImage).hostname).toBe('imgc1.gnjoy.com');
      expect(card.copyright).toContain('All Rights Reserved');
      expect(card.license).toContain('No open-use license identified');
    }
  });
});
