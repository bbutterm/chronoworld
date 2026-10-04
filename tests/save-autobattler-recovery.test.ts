import { describe, expect, it } from 'vitest';
import { loadFullContext } from '../scripts/lib/content-node';
import { deserialize, loadOrNew, MemoryStorage, newGame, serialize, startAutobattlerRun, fightAutobattlerRound } from '../src/core';

const ctx = loadFullContext();
const DAY = '2026-10-04';
function arenaSave() {
  const save = newGame(ctx, 1000, DAY);
  save.campaign.cleared = [ctx.autobattler!.unlockAfterStage!];
  return startAutobattlerRun(save, DAY, ctx);
}

describe('загрузка кампании при повреждённой Арене', () => {
  it('сохраняет валидный матч и полный снимок без изменений', () => {
    const save = arenaSave();
    expect(serialize(deserialize(serialize(save), DAY))).toBe(serialize(save));
  });

  it('удаляет испорченный матч и оставляет квитанцию награды и последовательность', () => {
    const save = arenaSave();
    save.autobattler = { ...save.autobattler!, rewardDay: DAY, rewardWins: 6 };
    const broken = JSON.parse(serialize(save));
    broken.autobattler.run.round = 'сломано';
    const loaded = deserialize(JSON.stringify(broken), DAY);
    expect(loaded.autobattler).toMatchObject({ seq: 1, rewardDay: DAY, rewardWins: 6 });
    expect(loaded.autobattler?.run).toBeUndefined();
    expect(loaded.resources).toEqual(save.resources);
    expect(loaded.currency).toEqual(save.currency);
    expect(loaded.notices).toHaveLength(1);
  });

  it('не выдаёт неизвестную награду повторно при испорченном учёте', () => {
    const save = arenaSave();
    const broken = JSON.parse(serialize(save));
    broken.autobattler.seq = -1;
    broken.autobattler.rewardWins = 'сломано';
    const storage = new MemoryStorage();
    storage.save(JSON.stringify(broken));
    const loaded = loadOrNew(storage, ctx, 2000, DAY);
    expect(loaded.source).toBe('loaded');
    expect(loaded.save.autobattler).toMatchObject({ seq: 1, rewardDay: DAY, rewardWins: 12 });
    expect(loaded.warnings?.join(' ')).toContain('Награда дня закрыта');
    expect(loaded.save.resources).toEqual(save.resources);
  });

  it.each(['rewardDay', 'rewardWins'])('не оплачивает повторный матч после утраты поля %s квитанции', (field) => {
    const easy = { ...ctx, autobattler: { ...ctx.autobattler!, difficulty: ctx.autobattler!.difficulty.map((round) => ({ ...round, level: 1, mult: 0.1 })) } };
    let paid = arenaSave();
    for (let round = 0; round < ctx.autobattler!.rounds; round++) {
      paid = fightAutobattlerRound(paid, DAY, easy).save;
    }
    const raw = JSON.parse(serialize(paid));
    delete raw.autobattler[field];
    let loaded = deserialize(JSON.stringify(raw), DAY);
    expect(loaded.autobattler).toMatchObject({ seq: 1, rewardDay: DAY, rewardWins: 12 });
    expect(loaded.resources).toEqual(paid.resources);
    expect(loaded.currency).toEqual(paid.currency);
    loaded = startAutobattlerRun(loaded, DAY, ctx);
    for (let round = 0; round < ctx.autobattler!.rounds; round++) {
      loaded = fightAutobattlerRound(loaded, DAY, easy).save;
    }
    expect(loaded.resources).toEqual(paid.resources);
    expect(loaded.currency).toEqual(paid.currency);
  });

  it('отбрасывает устаревший состав, сохраняя кампанию, награду и счётчик матчей', () => {
    const save = arenaSave();
    const broken = JSON.parse(serialize(save));
    broken.autobattler.run.heroes[0].templateId = 'retired_hero';
    broken.autobattler.rewardDay = DAY;
    broken.autobattler.rewardWins = 4;
    const storage = new MemoryStorage();
    storage.save(JSON.stringify(broken));
    const loaded = loadOrNew(storage, ctx, 2000, DAY);
    expect(loaded.source).toBe('loaded');
    expect(loaded.save.autobattler?.run).toBeUndefined();
    expect(loaded.save.autobattler).toMatchObject({ seq: 1, rewardDay: DAY, rewardWins: 4 });
    expect(loaded.save.campaign.cleared).toContain(ctx.autobattler!.unlockAfterStage!);
  });
});
