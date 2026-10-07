import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  abandonTowerRun, ascendHero, ascendPlan, changeBranch, clearHeroFocus, deserialize,
  fodderBlocker, heroCopyUpgradeInfo, serialize, setSquad, skipTowerBlessing,
  startTowerRun, towerRunSquad, upgradeHeroFromCopy, type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const DAY = '2026-10-20';
const initial = () => deserialize(readFileSync(new URL('./fixtures/tower-bond-legal-checkpoint.json', import.meta.url), 'utf8'));

function withTowerCopy(): SaveState {
  const base = initial();
  let save = abandonTowerRun(base, DAY, ctx).save;
  save = clearHeroFocus(save, 'h39');
  save = setSquad(save, ['h102', null, null, null, null]);
  save = skipTowerBlessing(startTowerRun(save, save.squad, ctx), ctx);
  // The common squad may change while the tower keeps its actual participants.
  return setSquad(save, base.squad);
}

describe('участники Башни сохраняют экземпляры до завершения забега', () => {
  it('не отдаёт живого участника в корм после смены общего отряда', () => {
    const save = withTowerCopy();
    const before = serialize(save);
    expect(save.squad).not.toContain('h102');
    expect(towerRunSquad(save, ctx).squad[0]?.id).toBe('h102');
    expect(fodderBlocker(save, 'h102', ctx)).toContain('Башн');
    expect(ascendPlan(save, 'h33', ctx)?.complete).toBe(false);
    expect(() => ascendHero(save, 'h33', ['h39', 'h102'], ctx)).toThrowError(expect.objectContaining({ code: 'fodder_busy' }));
    expect(serialize(save)).toBe(before);
    const finished = abandonTowerRun(save, DAY, ctx).save;
    expect(fodderBlocker(finished, 'h102', ctx)).toBeNull();
    expect(ascendHero(finished, 'h33', ['h39', 'h102'], ctx).consumed).toContain('h102');
  });

  it('сохраняет павшего участника для возможного воскрешения и после загрузки', () => {
    const live = withTowerCopy();
    const run = live.tower.run!;
    // A valid checkpoint after the actor fell; resurrection still owns this ID.
    const save = deserialize(serialize({ ...live, tower: { ...live.tower, run: { ...run,
      squad: [null, null, null, null, null], fallen: ['h102'], hp: {},
    } } }));
    expect(fodderBlocker(save, 'h102', ctx)).toContain('Башн');
    expect(() => ascendHero(save, 'h33', ['h39', 'h102'], ctx)).toThrowError(expect.objectContaining({ code: 'fodder_busy' }));
    expect(fodderBlocker(abandonTowerRun(save, DAY, ctx).save, 'h102', ctx)).toBeNull();
  });

  it('не снижает редкость участника Башни обменом копий, включая устаревший preview', () => {
    const before = initial();
    expect(heroCopyUpgradeInfo(before, 'h173', 'h102', ctx).canUpgrade).toBe(true);
    const save = withTowerCopy();
    const snapshot = serialize(save);
    const option = heroCopyUpgradeInfo(save, 'h173', 'h102', ctx);
    expect(option.canUpgrade).toBe(false);
    expect(option.blocker).toContain('Башн');
    expect(() => upgradeHeroFromCopy(save, 'h173', 'h102', ctx)).toThrowError(expect.objectContaining({ code: 'fodder_busy' }));
    expect(serialize(save)).toBe(snapshot);
    expect(heroCopyUpgradeInfo(abandonTowerRun(save, DAY, ctx).save, 'h173', 'h102', ctx).canUpgrade).toBe(true);
  });

  it('разрешает развитие и смену профессии самого участника, сохраняя его ID и раны', () => {
    const base = initial();
    let save = clearHeroFocus(abandonTowerRun(base, DAY, ctx).save, 'h39');
    save = setSquad(save, ['h33', null, null, null, null]);
    save = skipTowerBlessing(startTowerRun(save, save.squad, ctx), ctx);
    save = setSquad(save, base.squad);
    const run = save.tower.run;
    save = ascendHero(save, 'h33', ['h39', 'h102'], ctx).save;
    save = changeBranch(save, 'h33', 'rogue', ctx).save;
    expect(save.heroes.find(hero => hero.id === 'h33')).toMatchObject({ rarity: 'gold', branch: 'rogue' });
    expect(save.tower.run).toEqual(run);
    expect(towerRunSquad(save, ctx).squad[0]?.id).toBe('h33');
  });
});
