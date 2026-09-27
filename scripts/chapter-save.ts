/**
 * Сохранение для визуального прогона главы: отряд из карточек героев с готовыми листами.
 *   npx tsx scripts/chapter-save.ts [level] [tier2|tier1] > save.json
 * tier2 (по умолчанию) — фиолетовые карточки вторых профессий (Рандел, Сейрен, Сесиль, Кэтрин, Маргарета);
 * tier1 — карточки первых профессий (Алан, Дорн, Бран, Кай, Вика): бои дольше. Уровень — не выше предела редкости.
 * Печатает JSON сохранения и в stderr — сколько этапов главы 1 этот отряд проходит (seed = номер попытки).
 */
import { addHeroCard, enemySquad, maxLevelOf, newGame, placeInSquad, playStage, rarityForLevel, serialize, type SaveState } from '../src/core';
import { loadFullContext } from './lib/content-node';

const level = Number(process.argv[2] ?? 10);
const ctx = loadFullContext();
const tier = process.argv[3] ?? 'tier2';
const CARDS = tier === 'tier1' ? ['alan', 'dorn', 'bran', 'kai', 'vika'] : ['randel', 'seyren', 'cecil', 'kathryne', 'margaretha'];
const base = newGame(ctx, Date.now());
let save: SaveState = { ...base, heroes: [], squad: [null, null, null, null, null] };
for (const t of CARDS) {
  const rarity = rarityForLevel(ctx, level, ctx.content.heroes[t].baseRarity);
  const r = addHeroCard(save, t, rarity, { level: Math.min(level, maxLevelOf(ctx, rarity)) });
  save = { ...r.save, squad: placeInSquad(r.save.squad, r.hero, r.save, ctx) };
}
const initial = save;
const chapter = ctx.content.stages.filter((s) => s.chapter === ctx.content.chapters[0].id);
for (const s of chapter) {
  let won = false;
  for (let seed = 1; seed <= 5 && !won; seed++) {
    const out = playStage(save, s.id, seed, ctx);
    won = out.result.winner === 'A';
    save = out.save;
  }
  process.stderr.write(`${s.id}: ${won ? 'победа' : 'ПОРАЖЕНИЕ'} (врагов ${enemySquad(s.id, ctx).filter(Boolean).length})\n`);
  if (!won) break;
}
process.stdout.write(serialize(initial));
