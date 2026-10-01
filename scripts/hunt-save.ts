/**
 * Сохранение для кадров MVP-охоты (docs/design/mvp-hunt.md): кампания пройдена, отряд фиолетовых ур. 50 (со стихиями:
 * Тео — святость, Кай-маг — ветер…), охота: лучший результат, уровень, карта MVP в запасе, броня на первом герое.
 * Печатает JSON-строку сохранения (как в localStorage).
 *   npx tsx scripts/hunt-save.ts > /tmp/hunt-save.json
 */
import { addHeroCard, addItems, equip, maxLevelOf, newGame, placeInSquad, rarityForLevel, serialize, type SaveState } from '../src/core';
import { loadFullContext } from './lib/content-node';

const ctx = loadFullContext();
const base = newGame(ctx, 1_700_000_000_000);
let save: SaveState = { ...base, heroes: [], squad: [null, null, null, null, null], campaign: { ...base.campaign, cleared: ctx.content.stages.map((s) => s.id) } };
for (const card of ['alan/knight', 'teo/priest', 'kai/wizard', 'iris/crusader', 'vika/priest']) {
  const [t, branch] = card.split('/');
  const rarity = rarityForLevel(ctx, 50, 'purple');
  const r = addHeroCard(save, t, rarity, { level: Math.min(50, maxLevelOf(ctx, rarity)) });
  const hero = branch ? { ...r.hero, branch } : r.hero;
  save = { ...r.save, heroes: r.save.heroes.map((h) => (h.id === hero.id ? hero : h)) };
  save = { ...save, squad: placeInSquad(save.squad, hero, save, ctx) };
}
const armor = Object.values(ctx.equipment.items).find((i) => i.slot === 'armor' && !i.jobs)!;
const r = addItems(save, [armor.id]);
save = equip(r.save, save.heroes[0].id, r.added[0].id, ctx);
save = { ...save, hunt: { day: '2026-01-01', used: 0, best: { mvp_osiris: 61000, mob_mastering: 90000 }, level: 5, kills: { mvp_osiris: 2 }, cards: { card_osiris: 1 }, dry: 3 } };
process.stdout.write(JSON.stringify({ save: serialize(save), heroId: save.heroes[0].id }));
