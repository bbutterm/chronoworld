/**
 * Прохождение главы как новый игрок: новая игра (3 Новичка) → этапы по порядку, поражение — повтор с другим seed,
 * на джобе 10 каждый герой берёт первую профессию (Мечник, Лучник, Аколит, Маг, Вор по порядку).
 *   npx tsx scripts/playthrough.ts [chapterIndex=0] [maxTries=5] [--winrate N] [--idle]
 * Главы до chapterIndex проигрываются молча тем же способом (глава 2 — продолжение сохранения после главы 1).
 * --winrate N — перед первой попыткой этапа: доля побед на N seed'ах (как в docs/content/campaign.md).
 * --idle — не проходится за maxTries: забрать офлайн-сундук за 1 час (опыт всем героям) и снова maxTries попыток;
 *          печатается, сколько часов сундука понадобилось (модель «игрок ждёт сундук», без Башни и экипировки).
 * Печатает по этапам: попытки, длительность победного боя, уровни героев. Код выхода 1 — глава не пройдена.
 */
import { availableJobChanges, changeJob, claimOffline, enemySquad, newGame, playStage, type SaveState } from '../src/core';
import { loadFullContext } from './lib/content-node';

const ctx = loadFullContext();
const pos = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--winrate');
const chapterIdx = Number(pos[0] ?? 0);
const maxTries = Number(pos[1] ?? 5);
const winrateN = process.argv.includes('--winrate') ? Number(process.argv[process.argv.indexOf('--winrate') + 1]) : 0;
const idle = process.argv.includes('--idle');
const MAX_IDLE_HOURS = 200;
const FIRST_JOBS = ['swordman', 'archer', 'acolyte', 'mage', 'thief'];
const HOUR = 3600_000;

// Смена профессии, как сделал бы игрок: каждый готовый герой — в свою первую профессию.
function jobChanges(save: SaveState, changed: string[]): SaveState {
  return {
    ...save,
    heroes: save.heroes.map((h, i) => {
      const jobs = availableJobChanges(h, ctx);
      if (!jobs.length) return h;
      const want = jobs.includes(FIRST_JOBS[i % FIRST_JOBS.length]) ? FIRST_JOBS[i % FIRST_JOBS.length] : jobs[0];
      changed.push(`${h.name}→${ctx.content.jobs[want].name}`);
      return changeJob(h, want, ctx).hero;
    }),
  };
}

let save: SaveState = newGame(ctx, 0);
const chapter = ctx.content.chapters[chapterIdx];
let seed = 1;
let ok = true;
let idleTotal = 0;
for (const s of ctx.content.stages) {
  const chIdx = ctx.content.chapters.findIndex((c) => c.id === s.chapter);
  if (chIdx > chapterIdx) break;
  const loud = chIdx === chapterIdx;
  if (loud && s.index === 0) console.log(`${chapter.name}: ${ctx.content.stages.filter((x) => x.chapter === chapter.id).length} этапов`);
  let winrate = '';
  if (loud && winrateN > 0) {
    let w = 0;
    for (let k = 0; k < winrateN; k++) if (playStage(save, s.id, 100_000 + k, ctx).result.winner === 'A') w++;
    winrate = ` побед до 1-й попытки ${Math.round((100 * w) / winrateN)}%`;
  }
  let tries = 0;
  let won = false;
  let duration = 0;
  let hours = 0;
  const changed: string[] = [];
  for (;;) {
    for (let t = 0; t < maxTries && !won; t++) {
      tries++;
      const out = playStage(save, s.id, seed++, ctx);
      save = out.save;
      won = out.result.winner === 'A';
      duration = out.result.duration;
    }
    if (won || !idle || hours >= MAX_IDLE_HOURS) break;
    hours++;
    save = jobChanges(claimOffline(save, save.offline.lastClaimAt + HOUR, ctx).save, changed);
  }
  idleTotal += hours;
  save = jobChanges(save, changed);
  if (loud) {
    const levels = save.heroes.map((h) => `${ctx.content.jobs[h.job].name} ${h.jobLevel}`).join(', ');
    const foes = enemySquad(s.id, ctx).filter(Boolean);
    const sum = (k: 'hp' | 'atk') => foes.reduce((a, u) => a + u!.stats[k], 0);
    const wait = idle ? ` сундук ${hours} ч (всего ${idleTotal} ч)` : '';
    console.log(
      `${s.id} ${s.name.padEnd(22)} ${won ? 'победа' : 'ПОРАЖЕНИЕ'}${winrate} попыток ${tries}${wait} бой ${duration.toFixed(1)} с | ${levels}${changed.length ? ` | смена: ${changed.join(', ')}` : ''}\n   враги Σhp ${sum('hp')} / Σatk ${sum('atk')}: ${foes.map((u) => u!.name).join(', ')}`,
    );
  }
  if (!won) {
    if (!loud) console.log(`${s.id} ${s.name}: ПОРАЖЕНИЕ до выбранной главы`);
    ok = false;
    break;
  }
}
process.exit(ok ? 0 : 1);
