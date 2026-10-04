/**
 * Локальная парная калибровка экспериментального выбора главы 3.
 * node --import tsx scripts/chapter3-choice-calibrate.ts [--fit] [--seeds 64]
 * Данные не изменяет. У обеих веток одинаковые герои, ресурсы, seed и политика ввода.
 */
import { pathToFileURL } from 'node:url';
import { loadFullContext } from './lib/content-node';
import { buildUnit, enemySquad, simulateBattle, unitPower, type BattleInput, type FullContext, type UnitDef } from '../src/core';

export const CHOICE_STAGE = 'ch3_s6';
export const CHOICE_SQUADS = [
  { id: 'story', heroes: ['alan/knight', 'dorn/assassin', 'bran/hunter', 'vika/priest', 'greta/blacksmith'] },
  { id: 'control', heroes: ['alan/knight', 'iris/crusader', 'kai/wizard', 'vika/priest', 'lira/sage'] },
  { id: 'physical', heroes: ['otto/blacksmith', 'zara/rogue', 'bran/hunter', 'meilin/hunter', 'teo/monk'] },
  { id: 'melee', heroes: ['alan/knight', 'iris/knight', 'otto/blacksmith', 'dorn/assassin', 'vika/priest'] },
] as const;
export type ChoiceMode = 'auto' | 'manual';

/** Заданный заранее ритм касаний: каждые 4 с, контроль фронта перед уроном/лечением тыла.
 * Это воспроизводимый образец ручной игры, не оптимальная стратегия и не отсутствие касаний.
 */
export const CHOICE_MANUAL_INPUTS: BattleInput[] = Array.from({ length: 21 }, (_, cycle) =>
  Array.from({ length: 5 }, (_, slot) => ({ t: 8 + cycle * 4 + slot * 0.2, uid: `A${slot}` })),
).flat();

export function choiceSquad(ctx: FullContext, index: number, level: number): UnitDef[] {
  return CHOICE_SQUADS[index].heroes.map((hero, slot) => {
    const [templateId, branch] = hero.split('/');
    return buildUnit({ id: `choice_ref_${slot}`, templateId, branch, rarity: 'purple', level }, ctx);
  });
}

/** До/после можно мерить без мутации общего контента и без зависимости от resolver. */
export function choiceCandidate(ctx: FullContext, skeleton: number, zombie: number): (UnitDef | null)[] {
  const stage = ctx.content.stages.find((s) => s.id === CHOICE_STAGE)!;
  const enemies = stage.enemies.map((e, slot) => slot === 0 ? { unit: 'orc_skeleton', mult: skeleton }
    : slot === 3 ? { unit: 'orc_zombie', mult: zombie } : e);
  return enemySquad(CHOICE_STAGE, { ...ctx, content: { ...ctx.content,
    stages: ctx.content.stages.map((s) => s.id === CHOICE_STAGE ? { ...s, enemies } : s),
  } });
}

export function choiceSample(ctx: FullContext, squad: UnitDef[], enemies: (UnitDef | null)[], mode: ChoiceMode, seeds: number, seedStart = 1) {
  let wins = 0;
  let duration = 0;
  let survivors = 0;
  let backlineDamage = 0;
  for (let seed = seedStart; seed < seedStart + seeds; seed++) {
    const r = simulateBattle(ctx.content, squad, enemies, seed, { combat: ctx.combat, log: false,
      manualUlt: mode === 'manual', inputs: mode === 'manual' ? CHOICE_MANUAL_INPUTS : [] });
    wins += Number(r.winner === 'A');
    duration += r.duration;
    for (const unit of r.units.filter((u) => u.side === 'A')) {
      survivors += Number(r.report[unit.uid].alive);
      if (unit.slot >= 2) backlineDamage += r.report[unit.uid].damageTaken / unit.maxHp;
    }
  }
  return { wins, seeds, winRate: wins / seeds, duration: duration / seeds, survivors: survivors / seeds, backlineDamage: backlineDamage / (3 * seeds) };
}

function main() {
  const ctx = loadFullContext();
  const args = process.argv.slice(2);
  const seeds = Number(args[args.indexOf('--seeds') + 1]) || 64;
  const seedStart = Number(args[args.indexOf('--seed-start') + 1]) || 1001;
  const levels = args.includes('--levels') ? args[args.indexOf('--levels') + 1].split(',').map(Number) : [6, 9, 10, 11, 12, 13, 14, 15, 18];
  const modes: ChoiceMode[] = ['auto', 'manual'];
  const base = enemySquad(CHOICE_STAGE, ctx);
  const fit = args.includes('--fit');
  const scenarios = CHOICE_SQUADS.flatMap((s, i) => levels.flatMap((level) => modes.map((mode) => {
    const squad = choiceSquad(ctx, i, level);
    return { squad: s.id, level, mode, power: squad.reduce((n, u) => n + unitPower(u, ctx), 0), units: squad,
      base: choiceSample(ctx, squad, base, mode, fit ? 12 : seeds, fit ? 1 : seedStart) };
  })));
  if (fit) {
    const rows = [];
    for (const skeleton of [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]) for (const zombie of [0.7, 0.9, 1.1, 1.3, 1.5, 1.7]) {
      const enemies = choiceCandidate(ctx, skeleton, zombie);
      const diffs = scenarios.map((s) => {
        const candidate = choiceSample(ctx, s.units, enemies, s.mode, 12);
        return { delta: candidate.winRate - s.base.winRate, durationRatio: candidate.duration / s.base.duration };
      });
      const meanAbs = diffs.reduce((n, d) => n + Math.abs(d.delta), 0) / diffs.length;
      rows.push({ skeleton, zombie, meanAbs, bias: diffs.reduce((n, d) => n + d.delta, 0) / diffs.length,
        maxAbs: Math.max(...diffs.map((d) => Math.abs(d.delta))), durationRatio: diffs.reduce((n, d) => n + d.durationRatio, 0) / diffs.length });
    }
    console.log(JSON.stringify(rows.sort((a, b) => a.meanAbs - b.meanAbs), null, 2));
    return;
  }
  const selected = ctx.content.stages.find((s) => s.id === CHOICE_STAGE)?.campaignChoice?.variants.find((v) => v.optionId === 'block');
  const skeleton = Number(args[args.indexOf('--skeleton') + 1]) || selected?.enemies[0]?.mult || 0.4;
  const zombie = Number(args[args.indexOf('--zombie') + 1]) || selected?.enemies[3]?.mult || 1.2;
  const alternate = choiceCandidate(ctx, skeleton, zombie);
  console.log(JSON.stringify({ skeleton, zombie, seeds, seedStart, basePower: base.reduce((n, u) => n + (u ? unitPower(u, ctx) : 0), 0),
    alternatePower: alternate.reduce((n, u) => n + (u ? unitPower(u, ctx) : 0), 0),
    rows: scenarios.map(({ units, ...s }) => ({ ...s, block: choiceSample(ctx, units, alternate, s.mode, seeds, seedStart) })),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
