import { buildUnit, simulateBattle } from '../src/core';
import { loadFullContext } from './lib/content-node';
const ctx = loadFullContext();
const squad = ['alan/knight', 'vika/monk', 'bran', 'kai', 'lira'].map((id, i) => {
  const [templateId, branch] = id.split('/');
  return buildUnit({ id: `h${i}`, templateId, rarity: 'purple', level: 1, ...(branch ? { branch } : {}) }, ctx);
});
console.log(squad.map((u) => u.behavior));
const r = simulateBattle(ctx.content, squad, ['guard', 'assassin', 'assassin', 'assassin', 'archer'], 1, { combat: ctx.combat });
for (const e of r.log) if (e.type === 'move' || e.type === 'death' || (e.type === 'attack' && e.unit.startsWith('B'))) console.log(JSON.stringify(e));
