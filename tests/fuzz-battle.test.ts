/**
 * Q: фазз боёв. Случайные отряды из всех карточек героев на случайных редкостях и уровнях со случайной экипировкой,
 * монстры, этапы кампании, этажи башни, пустые слоты и укороченный лимит времени.
 * Вся случайность — из Rng проекта: один seed задаёт бой полностью.
 * Воспроизведение: FUZZ_SEED=<seed> npx vitest run tests/fuzz-battle.test.ts (см. docs/content/testing.md).
 */
import { describe, expect, it } from 'vitest';
import {
  buildUnit,
  CARD_RARITIES,
  enemySquad,
  equipmentStats,
  heroJobId,
  maxLevelOf,
  rarityIndex,
  Rng,
  simulateBattle,
  towerFloor,
  type CombatConfig,
  type HeroState,
  type ItemDef,
  type Squad,
  type UnitDef,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { content, skill, unitDef } from './helpers';
import { battleProblems, fuzzSeeds } from './invariants';

const ctx = loadFullContext();
const CARDS = Object.values(ctx.content.heroes).sort((a, b) => a.id.localeCompare(b.id));
const MONSTERS = Object.values(ctx.content.units)
  .filter((u) => u.kind !== 'hero')
  .sort((a, b) => a.id.localeCompare(b.id));
const PLAIN_UNITS = Object.values(ctx.content.units).sort((a, b) => a.id.localeCompare(b.id));
const ITEMS = Object.values(ctx.equipment.items).sort((a, b) => a.id.localeCompare(b.id));
const SLOTS = ['weapon', 'armor', 'helmet', 'boots'] as const;

const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[rng.int(arr.length)];

/** Случайная карточка героя: шаблон, редкость от baseRarity до maxRarity, уровень 1…предел редкости. */
function randomHero(rng: Rng, id: string): HeroState {
  const t = pick(rng, CARDS);
  const rarities = CARD_RARITIES.slice(rarityIndex(t.baseRarity), rarityIndex(t.maxRarity) + 1);
  const rarity = pick(rng, rarities);
  return { id, templateId: t.id, rarity, level: 1 + rng.int(maxLevelOf(ctx, rarity)) };
}

/** Случайная экипировка: в каждом слоте с шансом 1/2 случайный предмет этого слота (ограничения профессий не важны бою). */
function randomGear(rng: Rng): ItemDef[] {
  const out: ItemDef[] = [];
  for (const slot of SLOTS) {
    const pool = ITEMS.filter((i) => i.slot === slot);
    if (pool.length && rng.next() < 0.5) out.push(pick(rng, pool));
  }
  return out;
}

function heroUnit(rng: Rng, id: string): UnitDef {
  const hero = randomHero(rng, id);
  return buildUnit(hero, ctx, rng.next() < 0.7 ? equipmentStats(randomGear(rng)) : undefined);
}

/** Монстр с случайным множителем статов (как у этапов/башни). */
function monsterUnit(rng: Rng, slot: number, side: string): UnitDef {
  const base = pick(rng, MONSTERS);
  const k = 0.2 + rng.next() * 20;
  return {
    ...base,
    id: `${side}_m${slot}`,
    stats: { ...base.stats, hp: Math.max(1, Math.round(base.stats.hp * k)), atk: Math.round(base.stats.atk * k), def: Math.round(base.stats.def * k) },
  };
}

/** Отряд: героями, монстрами, id юнитов из data/units, врагами этапа или этажа башни; случайные пустые слоты. */
function randomSquad(rng: Rng, side: 'A' | 'B'): Squad {
  const kind = rng.int(side === 'A' ? 3 : 5);
  let squad: Squad;
  if (kind === 3) squad = [...enemySquad(pick(rng, ctx.content.stages).id, ctx)];
  else if (kind === 4) squad = [...towerFloor(1 + rng.int(ctx.tower.maxFloor), ctx).enemies];
  else {
    squad = Array.from({ length: 5 }, (_, slot) => {
      const r = rng.next();
      if (kind === 0 || r < 0.6) return heroUnit(rng, `${side}h${slot}`);
      if (kind === 1 || r < 0.85) return monsterUnit(rng, slot, side);
      return pick(rng, PLAIN_UNITS).id;
    });
  }
  // Случайные пустые слоты; иногда отряд целиком пуст (бой должен завершиться сразу).
  const emptyChance = rng.next() < 0.05 ? 1 : rng.next() * 0.5;
  return squad.map((u) => (rng.next() < emptyChance ? null : u));
}

/** Иногда — укороченный лимит времени и другой тик, чтобы чаще проверять таймаут. */
function randomCombat(rng: Rng): CombatConfig {
  const r = rng.next();
  if (r < 0.6) return ctx.combat;
  if (r < 0.85) return { ...ctx.combat, timeLimitSeconds: 1 + rng.int(30) };
  return { ...ctx.combat, tickSeconds: pick(rng, [0.05, 0.2, 0.25]), timeLimitSeconds: 5 + rng.int(60) };
}

interface Case {
  a: Squad;
  b: Squad;
  battleSeed: number;
  combat: CombatConfig;
}

function makeCase(seed: number): Case {
  const rng = new Rng(seed);
  return { a: randomSquad(rng, 'A'), b: randomSquad(rng, 'B'), battleSeed: Math.floor(rng.next() * 2 ** 32), combat: randomCombat(rng) };
}

/** FUZZ_VERBOSE=1: напечатать события вокруг первых нарушений (номер события — «#N» в тексте нарушения). */
function printAround(log: readonly unknown[], problems: readonly string[]): void {
  for (const pr of problems.slice(0, 3)) {
    const m = /^#(\d+)/.exec(pr);
    const i = m ? Number(m[1]) : log.length - 1;
    console.log(`${pr}\n${log.slice(Math.max(0, i - 12), i + 2).map((e, k) => `  #${Math.max(0, i - 12) + k} ${JSON.stringify(e)}`).join('\n')}`);
  }
}

/** Один фазз-бой: список нарушений (пустой — всё хорошо). Исключение боя — тоже нарушение. */
function fuzzBattle(seed: number): string[] {
  const c = makeCase(seed);
  try {
    const r1 = simulateBattle(ctx.content, c.a, c.b, c.battleSeed, { combat: c.combat });
    const problems = battleProblems(r1, c.combat);
    if (problems.length && process.env.FUZZ_VERBOSE) printAround(r1.log, problems);
    const r2 = simulateBattle(ctx.content, makeCase(seed).a, makeCase(seed).b, c.battleSeed, { combat: c.combat });
    if (JSON.stringify(r1) !== JSON.stringify(r2)) problems.push('недетерминирован: тот же seed дал другой результат');
    const quiet = simulateBattle(ctx.content, c.a, c.b, c.battleSeed, { combat: c.combat, log: false });
    if (quiet.winner !== r1.winner || quiet.duration !== r1.duration || JSON.stringify(quiet.report) !== JSON.stringify(r1.report)) {
      problems.push('log: false меняет итог боя');
    }
    return problems;
  } catch (e) {
    return [`исключение: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`];
  }
}

describe('Q: фазз боёв', () => {
  it('регрессия: погибший от контратаки посреди многоударного навыка больше не бьёт', () => {
    // Нашёл фазз (seed 3795): рыцарь контратакой убил охотника посреди ульты, а ульта продолжала бить.
    const c = content(
      [
        unitDef('striker', { skills: { basic: 'multi', passives: [] } }, { hp: 10, spd: 1000 }),
        unitDef('bystander', {}, { hp: 1_000_000, spd: 1 }),
        unitDef('counter', { skills: { basic: 'shot', passives: ['counter'] } }, { hp: 1_000_000, spd: 1 }),
      ],
      [
        skill('multi', { hits: 5, effects: [{ type: 'damage', k: 0.1 }] }),
        skill('counter', { trigger: 'hit', effects: [{ type: 'damage', k: 100 }] }),
      ],
    );
    const r = simulateBattle(c, ['striker', 'bystander', null, null, null], ['counter', null, null, null, null], 1, {
      combat: { ...ctx.combat, timeLimitSeconds: 1 },
    });
    const death = r.log.findIndex((e) => e.type === 'death' && e.unit === 'A0');
    expect(death).toBeGreaterThan(0);
    expect(r.log.filter((e) => e.type === 'damage' && e.source === 'A0')).toHaveLength(1);
    expect(battleProblems(r, { ...ctx.combat, timeLimitSeconds: 1 })).toEqual([]);
  });

  it('генератор использует все карточки и все классы карточек (с формами сюжетных)', () => {
    const seen = new Set<string>();
    const jobs = new Set<string>();
    for (let s = 0; s < 2000 && seen.size < CARDS.length; s++) {
      const h = randomHero(new Rng(s), 'x');
      seen.add(h.templateId);
      jobs.add(heroJobId(h, ctx));
    }
    expect(seen.size).toBe(CARDS.length);
    expect(CARDS.length).toBeGreaterThanOrEqual(25);
    // Все профессии, кроме Новичка, — чей-то класс.
    expect(jobs.size).toBe(Object.values(ctx.content.jobs).filter((j) => j.tier > 0).length);
  });

  it('300+ случайных боёв: инварианты лога, детерминизм', () => {
    const failures: string[] = [];
    for (const seed of fuzzSeeds(1, 320)) {
      const problems = fuzzBattle(seed);
      if (problems.length) failures.push(`seed ${seed} (FUZZ_SEED=${seed}):\n  ${problems.slice(0, 8).join('\n  ')}`);
      if (failures.length >= 5) break;
    }
    expect(failures, failures.join('\n')).toEqual([]);
  }, 600_000);
});
