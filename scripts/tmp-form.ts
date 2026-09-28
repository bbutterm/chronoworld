import { loadFullContext } from './lib/content-node';
import * as F from '../tests/formation';
const ctx = loadFullContext();
const sets = [
  ['ch1_s5', 'ch1_s6', 'ch1_s7', 'ch1_s8', 'ch1_s9', 'ch1_s10'],
  ['ch1_s5', 'ch1_s12', 'ch1_s6', 'ch1_s13', 'ch1_s7', 'ch1_s10'],
  ['ch1_s5','ch1_s12','ch1_s6','ch1_s13','ch1_s7','ch1_s14','ch1_s8','ch1_s15','ch1_s9','ch1_s16','ch1_s17','ch1_s18','ch1_s10'],
];
for (const set of sets) {
  (F.FORMATION_STAGES as string[]).splice(0, F.FORMATION_STAGES.length, ...set);
  for (const lvl of [1, 10]) {
    const s = F.formationStats(ctx, 10, lvl);
    console.log(set.join(','), lvl, s.centroidDist.toFixed(1), s.clumpFrac.toFixed(3), s.leftThird.toFixed(3), s.winsA);
  }
}
