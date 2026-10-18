/**
 * Башня-рогалик (docs/design/tower-roguelite.md §8): забеги ядром с авто-выбором для эталонных отрядов — средний этаж
 * с картами и без. Цель: игрок середины главы 3 (эталон ступени 3 — синие ур. 35) в первых забегах доходит до этажа 8–15,
 * с картами заметно дальше, чем без.
 *
 *   npx tsx scripts/balance-tower.ts                     средний/медианный этаж по ступеням 1–10 (с картами и без)
 *   npx tsx scripts/balance-tower.ts --tier 3 --n 6      одна ступень, 6 seed на отряд
 *   npx tsx scripts/balance-tower.ts --fit [--target 11] подобрать run.tierMult (медиана с картами ≈ target) и записать в data/tower.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  blessingById,
  chooseTowerPath,
  eventOptionAllowed,
  fightTowerFloor,
  newGame,
  pickTowerBlessing,
  previewTowerBlessingChoice,
  skipTowerBlessing,
  resolveTowerEvent,
  runConfig,
  startTowerRun,
  towerEventDef,
  type CardRarity,
  type FullContext,
  type HeroState,
  type SaveState,
  type TowerNodeKind,
} from '../src/core';
import { ROOT, loadFullContext } from './lib/content-node';

/** Эталонные отряды (как SMOOTH_SQUADS в player-model): танк, лекарь, бойцы; и «перекошенные». */
export const TOWER_SQUADS = [
  ['alan', 'vika', 'bran', 'kai', 'zara'],
  ['otto', 'teo', 'meilin', 'iris', 'lira'],
  ['alan', 'vika', 'bran', 'dorn', 'greta'],
  ['alan', 'iris', 'otto', 'zara', 'vika'],
  ['bran', 'kai', 'lira', 'meilin', 'teo'],
];

/**
 * Редкость и уровень эталона по ступени (номер главы). Главы 1–3 — как BAND в balance-behavior.ts; с главы 4 — отряд модели
 * игрока в середине главы (npm run balance, 28 дней, 18.10.2026): прежний эталон (фиолетовые 50 в главе 4, золотые 70 в 6-й,
 * красные с 8-й) обгонял игроков на 15–25 уровней, и Башня с первого этажа была как 25-й (отчёт тестера).
 */
export const TIER_BAND: [CardRarity, number][] = [
  ['green', 15],
  ['green', 20],
  ['blue', 35],
  ['purple', 30],
  ['purple', 38],
  ['purple', 45],
  ['gold', 62],
  ['gold', 70],
  ['gold', 75],
  ['gold', 80],
];

/** Сохранение «игрока середины главы tier»: пройдена первая половина главы (глава 1 — целиком: Башня открывается её боссом), отряд — эталон ступени. */
export function playerSave(ctx: FullContext, tier: number, ids: readonly string[], salt: number): SaveState {
  const s = newGame(ctx, 1000 + salt, '2026-10-01');
  const [rarity, level] = TIER_BAND[Math.min(TIER_BAND.length, tier) - 1];
  const purple = ['purple', 'gold', 'red'].includes(rarity);
  const heroes: HeroState[] = ids.map((templateId, i) => {
    const t = ctx.content.heroes[templateId];
    const branch = (t.branches.find((b) => b.role === t.role) ?? t.branches[0]).job;
    return { id: `h${i}_${templateId}`, templateId, rarity, level, ...(purple ? { branch } : {}) };
  });
  const ch = ctx.content.chapters.find((c) => c.order === tier)!;
  const upTo = ctx.content.stages.findIndex((x) => x.chapter === ch.id && x.index === (tier === 1 ? 17 : 8));
  return {
    ...s,
    heroes,
    squad: heroes.map((h) => h.id),
    campaign: { cleared: ctx.content.stages.slice(0, upTo + 1).map((x) => x.id) },
    battleSeq: salt * 17,
  };
}

const RANK: Record<string, number> = { common: 0, rare: 1, legendary: 2 };

/** Средние ОЗ живых (тысячные). */
const avgHp = (s: SaveState) => {
  const r = s.tower.run!;
  const ids = r.squad.filter((x): x is string => !!x);
  return ids.reduce((a, id) => a + (r.hp[id] ?? 1000), 0) / Math.max(1, ids.length);
};

/**
 * Один забег авто-игроком: путь — отдых, если раны тяжёлые, элита — если отряд свеж, событие — иначе бой; карта — самая
 * редкая (равные — первая); событие — первый доступный вариант. cards false — карты не берутся (выбор пропускается).
 * В эксперименте v1: если лучшая карта требует замены MVP, сохраняет текущую сборку. Это фиксированная
 * консервативная политика сравнения, не оптимальная игра и не политика прежнего исследования cap3.
 */
export function autoRun(ctx: FullContext, save: SaveState, cards = true, maxFloors = 60): { floor: number; cards: string[]; save: SaveState } {
  const cfg = runConfig(ctx);
  let s = startTowerRun(save, save.squad, ctx);
  const day = '2026-10-01';
  for (let step = 0; step < maxFloors * 4; step++) {
    const run = s.tower.run;
    if (!run) break;
    if (run.floor >= maxFloors) break;
    if (run.pending?.kind === 'blessing') {
      if (!cards || !run.pending.options.length) {
        s = run.draftRules ? skipTowerBlessing(s, ctx) : { ...s, tower: { ...s.tower, run: { ...run, pending: undefined } } };
        continue;
      }
      const best = [...run.pending.options].sort((a, b) => RANK[blessingById(cfg, b)!.rarity] - RANK[blessingById(cfg, a)!.rarity])[0];
      s = run.draftRules && previewTowerBlessingChoice(s, best, ctx).requiresReplacement ? skipTowerBlessing(s, ctx) : pickTowerBlessing(s, best, ctx).save;
      continue;
    }
    if (run.pending?.kind === 'event') {
      const ev = towerEventDef(s, ctx)!;
      let idx = ev.options.findIndex((o) => eventOptionAllowed(run, o) && (cards || !o.outcomes.some((x) => x.kind === 'card' || x.kind === 'gamble' || x.kind === 'upgradeCard')));
      if (idx < 0) idx = ev.options.findIndex((o) => eventOptionAllowed(run, o));
      s = resolveTowerEvent(s, idx, ctx).save;
      continue;
    }
    if (!run.node) {
      const hp = avgHp(s);
      const want: TowerNodeKind[] = hp < 550 ? ['rest', 'event', 'battle', 'elite', 'boss'] : hp > 800 ? ['elite', 'battle', 'event', 'rest', 'boss'] : ['event', 'battle', 'rest', 'elite', 'boss'];
      const idx = run.paths.indexOf(want.find((k) => run.paths.includes(k))!);
      s = chooseTowerPath(s, idx, ctx);
      continue;
    }
    const out = fightTowerFloor(s, day, ctx);
    s = out.save;
    if (out.ended) return { floor: out.ended.floor, cards: s.tower.run?.cards ?? [], save: s };
  }
  const floor = s.tower.run?.floor ?? s.tower.last?.floor ?? 0;
  return { floor, cards: s.tower.run?.cards ?? [], save: s };
}

/** Этажи забегов ступени tier: отряды × seeds. */
export function tierFloors(ctx: FullContext, tier: number, seeds: number, cards: boolean, squads = TOWER_SQUADS, maxFloors = 60): number[] {
  const out: number[] = [];
  squads.forEach((ids, si) => {
    for (let k = 0; k < seeds; k++) out.push(autoRun(ctx, playerSave(ctx, tier, ids, si * 101 + k), cards, maxFloors).floor);
  });
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0;
};

function withTierMult(ctx: FullContext, tier: number, m: number): FullContext {
  const run = runConfig(ctx);
  const tierMult = [...run.tierMult];
  tierMult[tier - 1] = m;
  return { ...ctx, tower: { ...ctx.tower, run: { ...run, tierMult } } };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (n: string) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
  const ctx = loadFullContext();
  if (runConfig(ctx).newRunDraftRules) console.log('Эксперимент v1: редкость прежде всего; при требуемой замене MVP — сохранить сборку (не оптимальная игра).');
  const n = Number(arg('n') ?? 4);
  const tiers = arg('tier') ? [Number(arg('tier'))] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  if (argv.includes('--fit')) {
    const target = Number(arg('target') ?? 11);
    const path = join(ROOT, 'data/tower.json');
    const json = JSON.parse(readFileSync(path, 'utf8'));
    for (const tier of tiers) {
      let lo = Math.log(0.05);
      let hi = Math.log(50);
      for (let it = 0; it < 11; it++) {
        const mid = (lo + hi) / 2;
        const f = median(tierFloors(withTierMult(ctx, tier, Math.exp(mid)), tier, n, true, TOWER_SQUADS, 40));
        if (f > target) lo = mid;
        else hi = mid;
      }
      const m = Math.round(Math.exp((lo + hi) / 2) * 1000) / 1000;
      json.run.tierMult[tier - 1] = m;
      console.log(`ступень ${tier}: tierMult ${m}`);
    }
    writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
    return;
  }
  console.log('ступень | эталон | с картами: среднее / медиана / мин–макс | без карт: среднее / медиана');
  for (const tier of tiers) {
    const w = tierFloors(ctx, tier, n, true);
    const wo = tierFloors(ctx, tier, n, false);
    const [r, l] = TIER_BAND[tier - 1];
    console.log(
      `${String(tier).padStart(2)} | ${r} ${l} | ${mean(w).toFixed(1)} / ${median(w)} / ${Math.min(...w)}–${Math.max(...w)} | ${mean(wo).toFixed(1)} / ${median(wo)}`,
    );
  }
}

if (process.argv[1]?.endsWith('balance-tower.ts')) main();
