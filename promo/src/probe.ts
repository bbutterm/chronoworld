/**
 * Подбор боя для съёмки: отряд × этап-босс × уровень → победа, длительность, заряды босса, ульты.
 *   npx tsx promo/src/probe.ts
 */
import { buildUnit, rarityForLevel, enemySquad, simulateBattle, type UnitDef } from '../../src/core';
import { loadFullContext } from '../../scripts/lib/content-node';
import { SQUADS } from './squads';

const ctx = loadFullContext();
const mk = (ids: string[], level: number): UnitDef[] =>
  ids.map((id, i) => {
    const [templateId, branch] = id.split('/');
    return buildUnit({ id: `h${i}`, templateId, rarity: rarityForLevel(ctx, level, 'purple'), level, ...(branch ? { branch } : {}) } as never, ctx);
  });
const stages = (process.argv[2] ?? 'ch4_s18,ch5_s18,ch6_s18,ch7_s18,ch8_s18,ch9_s18,ch10_s18').split(',');
const levels = (process.argv[3] ?? '40,60,80').split(',').map(Number);
for (const stage of stages) {
  const enemies = enemySquad(stage, ctx);
  const bi = enemies.findIndex((u) => u?.kind === 'boss');
  for (const [name, ids] of Object.entries(SQUADS)) {
    for (const lv of levels) {
      const r = simulateBattle(ctx.content, mk(ids, lv), enemies, 7, { combat: ctx.combat });
      const log = r.log as any[];
      const charges = log.filter((e) => e.type === 'cast' && e.unit === `B${bi}` && e.charge && e.action === 'start').length;
      const ults = log.filter((e) => e.type === 'ult' && String(e.unit).startsWith('A')).length;
      const end = log.at(-1)?.t ?? 0;
      console.log(`${stage} ${enemies[bi]?.id} ${name} ур.${lv}: ${r.winner} ${Number(end).toFixed(1)}с зарядов ${charges} ульт ${ults}`);
    }
  }
}
