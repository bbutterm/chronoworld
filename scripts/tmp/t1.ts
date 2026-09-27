import { collectGameContext } from '../../src/core';
import { readRawGameData } from '../../scripts/lib/content-node';
const r = collectGameContext(readRawGameData());
console.log(r.problems.join('\n') || 'OK', r.ctx ? Object.keys(r.ctx.content.heroes).length : '-');
