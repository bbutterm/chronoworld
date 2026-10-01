/**
 * MVP-охота (docs/design/mvp-hunt.md, docs/content/balance.md «MVP-охота»): эталонные отряды против MVP ядром.
 *
 *   npx tsx scripts/balance-hunt.ts                 урон за бой (45 с) по «манекену» каждого MVP (ОЗ огромные, сила — уровня,
 *                                                   который отряд этой главы пробивает): нейтральный отряд и отряд со
 *                                                   стихией слабости MVP, отношение (цель ×1.3–1.5)
 *   npx tsx scripts/balance-hunt.ts --frontier      высший уровень, который отряд главы убивает (в половине seed), авто и
 *                                                   «игрок» с ручной ультой (сбивает заряд) — нейтральный / со стихией
 *   --bands 3,5,8   только эти главы (номер с 1)   --seeds 3   seed на точку   --json out.json   итог в файл
 *
 * Отряды главы c — редкость и уровень BAND (как balance-behavior.ts). Нейтральный: Алан (танк), Вика (лекарь), Дорн,
 * Грета, Зара. Со стихией: до двух бойцов (Дорн, Грета) заменены героями, чья стихия атаки бьёт MVP (если такие есть на
 * этой редкости: зелёный/синий — только огонь Кая, вода Лиры, святость Тео; с фиолетового — ещё ветер, земля, святость Ирис).
 */
import { writeFileSync } from 'node:fs';
import { buildUnit, dayNumber, huntBoss, huntKilled, huntDamage, huntSquad, simulateBattle, type HeroState, type HuntBossView, type UnitDef } from '../src/core';
import { attackElement, type Element } from '../src/core/elements';
import { BAND } from './balance-behavior';
import { manualBattle } from './balance-decisions';
import { loadFullContext, type FullContext } from './lib/player-model';

const argv = process.argv.slice(2);
const arg = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const SEEDS = Number(arg('seeds') ?? 3);

/** Герои по стихии атаки (шаблон/ветка) — кандидаты в отряд «со стихией», по убыванию предпочтения. */
const ELEMENT_HEROES: Record<string, string[]> = {
  fire: ['kai', 'meilin/hunter'],
  water: ['lira/wizard'],
  wind: ['bran/hunter', 'kai/wizard'],
  earth: ['kai/sage'],
  holy: ['teo/priest', 'iris/crusader'],
};
const NEUTRAL = ['alan', 'vika', 'dorn', 'greta', 'zara'];

function hero(ctx: FullContext, spec: string, band: number, i: number): UnitDef {
  const [rarity, level] = BAND[band - 1];
  const [templateId, br] = spec.split('/');
  const t = ctx.content.heroes[templateId];
  const purple = rarity !== 'green' && rarity !== 'blue';
  const branch = purple ? (br ?? (t.branches.find((b) => b.role === t.role) ?? t.branches[0]).job) : undefined;
  const h: HeroState = { id: `ref${i}`, templateId, rarity, level, ...(branch ? { branch } : {}) };
  return buildUnit(h, ctx);
}

/** Отряд «со стихией»: до двух бойцов заменены героями стихий weak (только те, у кого на этой редкости и правда эта стихия). */
function matchedSquad(ctx: FullContext, band: number, weak: Element[]): { squad: UnitDef[]; names: string[] } {
  const specs = [...NEUTRAL];
  const picked: string[] = [];
  for (const el of weak)
    for (const spec of ELEMENT_HEROES[el] ?? []) {
      if (picked.length >= 2 || picked.some((p) => p.split('/')[0] === spec.split('/')[0])) continue;
      const u = hero(ctx, spec, band, 0);
      if (weak.includes(attackElement(u, ctx.content.skills))) picked.push(spec);
    }
  picked.forEach((spec, k) => (specs[2 + k] = spec));
  return { squad: specs.map((s, i) => hero(ctx, s, band, i)), names: picked };
}

/** День, в который босс охоты — bosses[index]. */
function dayOf(ctx: FullContext, index: number): string {
  for (let d = 0; d < 400; d++) {
    const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    const n = dayNumber(day);
    if (((n % ctx.hunt.bosses.length) + ctx.hunt.bosses.length) % ctx.hunt.bosses.length === index) return day;
  }
  throw new Error('нет дня');
}

function fight(ctx: FullContext, squad: UnitDef[], boss: HuntBossView, seed: number, manual: boolean) {
  const enemies: (UnitDef | null)[] = [boss.def, null, null, null, null];
  const sq = huntSquad(squad, boss, ctx);
  const c = { ...ctx, combat: { ...ctx.combat, timeLimitSeconds: ctx.hunt.timeLimitSeconds } };
  return manual ? manualBattle(c, sq, enemies, seed) : simulateBattle(ctx.content, sq, enemies, seed, { combat: c.combat, log: false });
}

const geo = (xs: number[]) => Math.exp(xs.reduce((a, b) => a + Math.log(Math.max(1, b)), 0) / xs.length);
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}м` : n >= 1e3 ? `${Math.round(n / 1e3)}т` : `${Math.round(n)}`);

/** Урон по «манекену» (ОЗ ×1000) уровня rank за бой. */
function sandbag(ctx: FullContext, squad: UnitDef[], boss: HuntBossView): number {
  const b = { ...boss, def: { ...boss.def, stats: { ...boss.def.stats, hp: boss.def.stats.hp * 1000 } } };
  const xs: number[] = [];
  for (let s = 1; s <= SEEDS; s++) xs.push(huntDamage(fight(ctx, squad, b, s, false)));
  return geo(xs);
}

/** Высший уровень, который отряд убивает хотя бы в половине seed (−1 — ни одного). */
function frontier(ctx: FullContext, squad: UnitDef[], index: number, manual: boolean): number {
  const day = dayOf(ctx, index);
  let best = -1;
  for (let r = 0; r < (ctx.hunt.mvp?.ranks.length ?? 0); r++) {
    const boss = huntBoss(day, ctx, r);
    let k = 0;
    for (let s = 1; s <= SEEDS; s++) if (huntKilled(fight(ctx, squad, boss, s, manual))) k++;
    if (k * 2 >= SEEDS) best = r;
    else break;
  }
  return best;
}

const ctx = loadFullContext();
const bands = (arg('bands') ?? '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const out: Record<string, unknown>[] = [];
const ranks = ctx.hunt.mvp!.ranks;

if (argv.includes('--frontier')) {
  console.log('Глава · MVP: высший убиваемый уровень (с 1) — нейтр. авто / нейтр. вручную / со стихией авто / со стихией вручную');
  for (const band of bands) {
    const neutral = NEUTRAL.map((s, i) => hero(ctx, s, band, i));
    const line: string[] = [];
    ctx.hunt.bosses.forEach((b, index) => {
      const boss = huntBoss(dayOf(ctx, index), ctx, 0);
      const m = matchedSquad(ctx, band, boss.weakTo);
      const f = [frontier(ctx, neutral, index, false), frontier(ctx, neutral, index, true), frontier(ctx, m.squad, index, false), frontier(ctx, m.squad, index, true)];
      out.push({ band, mvp: b.unit, neutralAuto: f[0], neutralManual: f[1], matchedAuto: f[2], matchedManual: f[3], matched: m.names });
      line.push(`${b.unit.replace('mvp_', '')} ${f.map((x) => x + 1).join('/')}${m.names.length ? '' : '*'}`);
    });
    console.log(`гл.${band} (${BAND[band - 1].join(' ')}): ${line.join(' · ')}`);
  }
  console.log('* — на этой редкости нет героя нужной стихии (отряд «со стихией» = нейтральный)');
} else {
  console.log('Глава · MVP: урон за 45 с по манекену — нейтральный / со стихией (×отношение) [уровень силы]');
  const ratios: number[] = [];
  for (const band of bands) {
    const neutral = NEUTRAL.map((s, i) => hero(ctx, s, band, i));
    const line: string[] = [];
    ctx.hunt.bosses.forEach((b, index) => {
      const day = dayOf(ctx, index);
      // Сила манекена — уровень, чьи ОЗ ближе всего к урону нейтрального отряда (два прохода).
      let r = 0;
      for (let it = 0; it < 2; it++) {
        const d = sandbag(ctx, neutral, huntBoss(day, ctx, r));
        r = Math.max(0, ranks.findIndex((x) => x.hp > d) === -1 ? ranks.length - 1 : ranks.findIndex((x) => x.hp > d) - 1);
      }
      const boss = huntBoss(day, ctx, r);
      const dn = sandbag(ctx, neutral, boss);
      const m = matchedSquad(ctx, band, boss.weakTo);
      const dm = m.names.length ? sandbag(ctx, m.squad, boss) : dn;
      if (m.names.length) ratios.push(dm / dn);
      out.push({ band, mvp: b.unit, rank: r, neutral: Math.round(dn), matched: Math.round(dm), heroes: m.names });
      line.push(`${b.unit.replace('mvp_', '')} ${fmt(dn)}/${fmt(dm)} ×${(dm / dn).toFixed(2)} [${r + 1}]`);
    });
    console.log(`гл.${band}: ${line.join(' · ')}`);
  }
  console.log(`Отношение «со стихией / нейтральный» (где есть герой стихии): среднее геом. ×${geo(ratios.map((x) => x * 1000)) / 1000 > 0 ? (Math.exp(ratios.reduce((a, b) => a + Math.log(b), 0) / ratios.length)).toFixed(2) : '—'}, от ×${Math.min(...ratios).toFixed(2)} до ×${Math.max(...ratios).toFixed(2)}`);
}
if (arg('json')) writeFileSync(arg('json')!, JSON.stringify(out, null, 2));
