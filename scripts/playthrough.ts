/**
 * Прохождение главы как новый игрок: новая игра (5 Новичков) → этапы по порядку, поражение — повтор с другим seed,
 * на джобе 10 каждый герой берёт первую профессию (Мечник, Лучник, Аколит, Маг, Вор по порядку).
 *   npx tsx scripts/playthrough.ts [chapterIndex=0] [maxTries=5]
 * Печатает по этапам: попытки, длительность победного боя, уровни героев. Код выхода 1 — глава не пройдена.
 */
import { availableJobChanges, changeJob, enemySquad, newGame, playStage, type SaveState } from '../src/core';
import { loadFullContext } from './lib/content-node';

const ctx = loadFullContext();
const chapterIdx = Number(process.argv[2] ?? 0);
const maxTries = Number(process.argv[3] ?? 5);
const FIRST_JOBS = ['swordman', 'archer', 'acolyte', 'mage', 'thief'];

let save: SaveState = newGame(ctx, 0);
const chapter = ctx.content.chapters[chapterIdx];
const stages = ctx.content.stages.filter((s) => s.chapter === chapter.id);
console.log(`${chapter.name}: ${stages.length} этапов`);
let seed = 1;
let ok = true;
for (const s of stages) {
  let tries = 0;
  let won = false;
  let duration = 0;
  while (!won && tries < maxTries) {
    tries++;
    const out = playStage(save, s.id, seed++, ctx);
    save = out.save;
    won = out.result.winner === 'A';
    duration = out.result.duration;
  }
  // Смена профессии, как сделал бы игрок: каждый готовый герой — в свою первую профессию.
  const changed: string[] = [];
  save = {
    ...save,
    heroes: save.heroes.map((h, i) => {
      const jobs = availableJobChanges(h, ctx);
      if (!jobs.length) return h;
      const want = jobs.includes(FIRST_JOBS[i % FIRST_JOBS.length]) ? FIRST_JOBS[i % FIRST_JOBS.length] : jobs[0];
      changed.push(`${h.name}→${ctx.content.jobs[want].name}`);
      return changeJob(h, want, ctx).hero;
    }),
  };
  const levels = save.heroes.map((h) => `${ctx.content.jobs[h.job].name} ${h.jobLevel}`).join(', ');
  const foes = enemySquad(s.id, ctx).filter(Boolean).map((u) => u!.name).join(', ');
  console.log(`${s.id} ${s.name.padEnd(22)} ${won ? 'победа' : 'ПОРАЖЕНИЕ'} попыток ${tries} бой ${duration.toFixed(1)} с | ${levels}${changed.length ? ` | смена: ${changed.join(', ')}` : ''}\n   враги: ${foes}`);
  if (!won) {
    ok = false;
    break;
  }
}
process.exit(ok ? 0 : 1);
