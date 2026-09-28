/**
 * Сохранение для визуального прогона главы: отряд из карточек героев с готовыми листами.
 *   npx tsx scripts/chapter-save.ts [level] [tier2|tier1] > save.json
 * tier2 (по умолчанию) — фиолетовые герои с ветками вторых профессий (Алан-Крестоносец, Ирис-Рыцарь, Мэйлин-Охотница,
 * Лира-Волшебница, Вика-Жрица);
 * tier1 — карточки первых профессий (Алан, Дорн, Бран, Кай, Вика): бои дольше. Уровень — не выше предела редкости.
 * Печатает JSON сохранения и в stderr — сколько этапов главы 1 этот отряд проходит (seed = номер попытки).
 */
import { addHeroCard, enemySquad, maxLevelOf, newGame, placeInSquad, playStage, rarityForLevel, serialize, type SaveState } from '../src/core';
import { loadFullContext } from './lib/content-node';

const level = Number(process.argv[2] ?? 10);
const ctx = loadFullContext();
const tier = process.argv[3] ?? 'tier2';
const CARDS = tier === 'tier1' ? ['alan', 'dorn', 'bran', 'kai', 'vika'] : ['alan/crusader', 'iris/knight', 'meilin/hunter', 'lira/wizard', 'vika/priest'];
const base = newGame(ctx, Date.now());
let save: SaveState = { ...base, heroes: [], squad: [null, null, null, null, null] };
for (const card of CARDS) {
  const [t, branch] = card.split('/');
  const rarity = rarityForLevel(ctx, level, branch ? 'purple' : ctx.content.heroes[t].baseRarity);
  const r = addHeroCard(save, t, rarity, { level: Math.min(level, maxLevelOf(ctx, rarity)) });
  const hero = branch ? { ...r.hero, branch } : r.hero;
  save = { ...r.save, heroes: r.save.heroes.map((h) => (h.id === hero.id ? hero : h)) };
  save = { ...save, squad: placeInSquad(save.squad, hero, save, ctx) };
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
