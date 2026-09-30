import { recommendedFactor, recommendedHeroLevel, recommendedPower, stageLevels, stagePower, levelBand } from '../src/core';
import { loadFullContext } from './lib/player-model';
const ctx = loadFullContext();
const lv = ctx.features.power.levels!;
const noGear = { ...ctx, features: { ...ctx.features, power: { ...ctx.features.power, levels: { ...lv, bands: lv.bands.map((b) => ({ ...b, gear: 0 })) } } } };
for (const id of (process.argv[2] ?? 'ch5_s10').split(',')) {
  const l = stageLevels(id, ctx);
  console.log(id, 'stagePower', stagePower(id, ctx), 'factor', recommendedFactor(id, ctx), 'recPower', recommendedPower(id, ctx), 'rec', recommendedHeroLevel(id, noGear), 'enemies', JSON.stringify(l.enemies), 'boss', l.boss, JSON.stringify(levelBand(id, ctx)));
}
