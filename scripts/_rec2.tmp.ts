import { baselineHero, levelBand, recommendedHeroLevel, recommendedPower, recommendedFactor } from '../src/core';
import { loadFullContext } from './lib/player-model';
const ctx = loadFullContext();
for (const s of ctx.content.stages) {
  const rec = recommendedHeroLevel(s.id, ctx);
  const band = levelBand(s.id, ctx);
  const power = recommendedPower(s.id, ctx) * (1 - (band.gear ?? 0));
  const have = rec.squad * baselineHero(rec.level, rec.rarity, ctx).power;
  if (have < power) console.log(s.id, rec, Math.round(power), Math.round(have), 'factor', recommendedFactor(s.id, ctx), (power / have).toFixed(3));
}
