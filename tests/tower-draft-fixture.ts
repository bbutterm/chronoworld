import { loadFullContext } from '../scripts/lib/content-node';
import { playerSave, TOWER_SQUADS } from '../scripts/balance-tower';
import { startTowerRun, type SaveState, type TowerRun } from '../src/core';
export const ctx = loadFullContext();
export const cfg = ctx.tower.run!;
export const rules = cfg.newRunDraftRules!;
export const legends = cfg.blessings.filter((b) => b.rarity === 'legendary').map((b) => b.id);
export function fresh(patch: Partial<TowerRun> = {}, context = ctx): SaveState {
  const player = playerSave(context, 3, TOWER_SQUADS[0], 17);
  const save = startTowerRun(player, player.squad, context);
  return { ...save, tower: { ...save.tower, run: { ...save.tower.run!, ...patch } } };
}
export function offer(cards: string[], options: string[], patch: Partial<TowerRun> = {}): SaveState {
  return fresh({ cards, rerolls: 3, pending: { kind: 'blessing', source: 'event', options, rolls: 0 }, ...patch });
}
