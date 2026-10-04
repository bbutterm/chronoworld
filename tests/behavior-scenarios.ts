/**
 * Сценарии регрессии каркаса поведения (docs/design/battle-behavior.md §3, тест 3 «нулевой профиль»): пять эталонных
 * отрядов (SMOOTH_SQUADS, фиолетовые ур. 45) против составов босс-этапов глав 1–10 со своими множителями (сняты 30.09 так,
 * чтобы бой был на грани: отряд 0 побеждает примерно в половине боёв), плюс зеркальные бои юнитов data/units.
 * Множители здесь заморожены: правка data/campaign не меняет сценарии (лог меняет только правка боя или юнитов/навыков).
 */
import { simulateBattle, type BattleOptions, type BattleResult, type FullContext, type Squad, type UnitDef } from '../src/core';
import { SMOOTH_SQUADS, smoothSquads } from '../scripts/lib/player-model';

export const BEHAVIOR_COMPS: [string, ([string, number] | null)[]][] = [
  ['ch1_s5', [['mob_tank', 15.804], ['mob_rocker', 17.911], ['mob_lunatic', 15.804], ['mob_mandragora', 17.911], null]],
  ['ch1_s10', [['mob_fast', 13.827], ['mob_mastering', 13.7], ['mob_drops', 13.827], ['mob_poporing', 13.827], null]],
  ['ch2_s10', [['sewer_bug_egg', 3.525], ['sewer_golden_bug', 7.05], ['sewer_plankton', 12.778], ['sewer_plankton', 12.778], ['sewer_plankton', 12.778]]],
  ['ch3_s15', [['orc_warrior', 5.83], ['orc_hero', 15.269], ['orc_warrior', 5.83], ['orc_archer', 6.246], ['orc_archer', 6.246]]],
  ['ch3_s10', [['orc_high', 5.797], ['orc_skeleton', 7.536], ['orc_lord', 6.957], ['orc_archer', 19.518], ['orc_chonchon', 19.518]]],
  ['ch4_s10', [['mob4_elite', 6.426], ['mob4_boss', 8.044], ['mob4_ranged', 6.426], ['mob4_elite', 6.426], ['mob4_ranged', 6.426]]],
  ['ch5_s10', [['mob5_elite', 7.586], ['mob5_boss', 7.946], ['mob5_support', 5.313], ['mob5_elite', 7.586], ['mob5_ranged', 7.586]]],
  ['ch6_s10', [['mob6_elite', 7.684], ['mob6_boss', 5.905], ['mob6_ranged', 7.684], ['mob6_support', 5.382], ['mob6_ranged', 7.684]]],
  ['ch7_s10', [['alde_owl_duke', 5.689], ['alde_keeper', 6.209], ['alde_owl_duke', 5.689], ['alde_rideword', 8.132], ['alde_rideword', 8.132]]],
  ['ch8_s15', [['mob3_tank', 5.332], ['mob3_elite', 5.332], ['mob3_boss', 10.987], ['mob3_ranged', 17.271], ['mob3_fast', 17.271]]],
  ['ch8_s18', [['mob3_tank', 5.471], ['mob7_boss', 5.739], ['mob3_ranged', 15.071], ['mob3_elite', 5.471], ['mob3_ranged', 15.071]]],
  ['ch9_s10', [['maze_stem_worm', 18.58], ['maze_mantis', 18.58], ['maze_scribe', 8.917], ['maze_deviruchi', 13.096], null]],
  ['ch9_s18', [['maze_baphomet_jr', 7.45], ['maze_baphomet', 3.736], ['maze_whisper', 7.45], ['maze_deviruchi', 7.45], ['maze_baphomet_jr', 7.45]]],
  ['ch10_s18', [['mob7_elite', 6.481], ['mob_lord_of_death', 4.518], ['mob7_elite', 6.481], ['mob7_ranged', 6.481], ['mob7_ranged', 6.481]]],
];

/**
 * Базовые статы, замороженные вместе с множителями: правка баланса юнита в data/units не должна менять сценарии
 * (снимок «нулевого профиля» использует актуальный глобальный темп без правил профилей). RR-02 (30.09): ОЗ Тёмного лорда ×0.62 и Владыки
 * мёртвых ×0.6 — в сценариях прежние 4200 и 4600.
 */
const FROZEN_STATS: Record<string, Partial<UnitDef['stats']>> = {
  mob7_boss: { hp: 4200 },
  mob_lord_of_death: { hp: 4600 },
};

/** Состав сценария с замороженными множителями (как enemySquad: hp/atk/def × k, id `<этап>_<слот>`). */
export function compSquad(ctx: FullContext, name: string): (UnitDef | null)[] {
  const comp = BEHAVIOR_COMPS.find((c) => c[0] === name)![1];
  return comp.map((e, i) => {
    if (!e) return null;
    const def = ctx.content.units[e[0]];
    const u = FROZEN_STATS[def.id] ? { ...def, stats: { ...def.stats, ...FROZEN_STATS[def.id] } } : def;
    const k = e[1];
    return { ...u, id: `${name}_${i}`, stats: { ...u.stats, hp: Math.max(1, Math.round(u.stats.hp * k)), atk: Math.round(u.stats.atk * k), def: Math.round(u.stats.def * k) } };
  });
}

/** 32-битный FNV-1a от строки. */
export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const MIRRORS: [string, string][] = [
  ['guard,warrior,archer,mage,priest', 'guard,warrior,archer,mage,priest'],
  ['guard,warrior,archer,mage,priest', 'guard,assassin,archer,assassin,priest'],
  ['warrior,guard,assassin,archer,mage', 'guard,warrior,archer,priest,mage'],
];

/** Герой без ульты формы (skills.ult) — как до ульт героев. */
export function withoutUlt(u: UnitDef): UnitDef {
  const { ult: _ult, ...skills } = u.skills;
  return { ...u, skills };
}

/** Хэши полных логов всех сценариев: имя → хэш; callback позволяет проверить читаемый trace и отсутствие правил. */
export function scenarioHashes(ctx: FullContext, seeds: number, opts: BattleOptions = {}, onResult?: (key: string, result: BattleResult) => void): Record<string, string> {
  const out: Record<string, string> = {};
  // Ульты героев (01.10, поле ult формы) — правка контента героев: сценарии замораживают отряды без них, как
  // множители и FROZEN_STATS. Глобальный темп 04.10 меняется для обеих версий; behavior:false выключает правила.
  const squads = smoothSquads(ctx, 45, SMOOTH_SQUADS).map((sq) => sq.map(withoutUlt));
  const run = (key: string, a: Squad, b: Squad) => {
    for (let seed = 1; seed <= seeds; seed++) {
      const r = simulateBattle(ctx.content, a, b, seed, { combat: ctx.combat, ...opts });
      const id = `${key}#${seed}`;
      out[id] = fnv(JSON.stringify(r.log));
      onResult?.(id, r);
    }
  };
  for (const [name] of BEHAVIOR_COMPS) squads.forEach((sq, i) => run(`${name}/sq${i}`, [...sq], compSquad(ctx, name)));
  for (const [x, y] of MIRRORS) run(`${x}|${y}`, x.split(','), y.split(','));
  return out;
}
