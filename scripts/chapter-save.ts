/**
 * Сохранение для визуального прогона главы: отряд из профессий с готовыми спрайтами v2
 * (Крестоносец→guard, Рыцарь→warrior, Охотник→archer, Волшебник→mage, Жрец→priest).
 *   npx tsx scripts/chapter-save.ts [jobLevel] [tier2|tier1] > save.json
 * tier1 — первые профессии (Мечник→warrior, Вор→assassin, Лучник→archer, Маг→mage, Аколит→priest): бои дольше.
 * Печатает JSON сохранения и в stderr — сколько этапов главы 1 этот отряд проходит (seed = номер попытки).
 */
import { enemySquad, newGame, playStage, serialize, type SaveState } from '../src/core';
import { loadFullContext } from './lib/content-node';

const level = Number(process.argv[2] ?? 10);
const ctx = loadFullContext();
const tier = process.argv[3] ?? 'tier2';
const JOBS: [string, string | null][] =
  tier === 'tier1'
    ? [
        ['swordman', null],
        ['thief', null],
        ['archer', null],
        ['mage', null],
        ['acolyte', null],
      ]
    : [
        ['crusader', 'swordman'],
        ['knight', 'swordman'],
        ['hunter', 'archer'],
        ['wizard', 'mage'],
        ['priest', 'acolyte'],
      ];
const base = newGame(ctx, Date.now());
let save: SaveState = {
  ...base,
  heroes: base.heroes.map((h, i) => ({
    ...h,
    job: JOBS[i][0],
    jobLevel: level,
    jobExp: 0,
    jobHistory: [{ job: 'novice', jobLevel: 10 }, ...(JOBS[i][1] ? [{ job: JOBS[i][1] as string, jobLevel: 50 }] : [])],
  })),
};
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
