import { levelBand, recommendedHeroLevel, stageLevels } from '../src/core';
import { loadFullContext, referenceLevel } from './lib/player-model';
const ctx = loadFullContext();
const off = { ...ctx, combat: { ...ctx.combat, behaviors: Object.fromEntries(Object.entries(ctx.combat.behaviors!).map(([k, v]) => [k, { name: v.name, ...(v.dive?.stay ? { dive: { stay: true, priority: [] } } : {}) }])) } };
const lv = ctx.features.power.levels!;
const noGear = { ...ctx, features: { ...ctx.features, power: { ...ctx.features.power, levels: { ...lv, bands: lv.bands.map((b) => ({ ...b, gear: 0 })) } } } };
const ids = (process.argv[2] ?? ctx.content.stages.filter((s) => s.boss && s.globalIndex > 10).map((s) => s.id).join(',')).split(',');
for (const id of ids) console.log(id, JSON.stringify(levelBand(id, ctx)), 'rec', recommendedHeroLevel(id, noGear).level, 'boss', stageLevels(id, ctx).boss, 'on', referenceLevel(id, ctx, 8), 'off', referenceLevel(id, off, 8));
