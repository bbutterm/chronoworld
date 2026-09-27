import { describe, expect, it } from 'vitest';
import {
  actClaimOffline,
  actPlayStage,
  claimOffline,
  deserialize,
  ensureBoard,
  fastRewardsStatus,
  heroPower,
  idleIncome,
  loadOrNew,
  markScenesSeen,
  MemoryStorage,
  newGame,
  offlineRewards,
  pendingScenes,
  playStage,
  queueAfterStage,
  rollDay,
  sanitizeSave,
  SAVE_VERSION,
  saveRevision,
  serialize,
  syncOfflineClock,
  useFastRewards,
  type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { BACKUPS_KEEP, LocalStorageAdapter, SAVE_KEY, SaveSlot } from '../src/game/storage';

const ctx = loadFullContext();
const H = 3_600_000;
const MIN = 60_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 8, 27, 10);
const D0 = '2026-09-27';
const stages = ctx.content.stages;
const cap = ctx.progression.offline.capHours;

class FakeStorage implements Storage {
  data = new Map<string, string>();
  failSet = false;
  quota = false;
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.quota) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    if (this.failSet) throw new Error('SecurityError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

/** Событие storage в Node (StorageEvent нет): Event с key/newValue. */
function storageEvent(key: string, newValue: string | null): Event {
  return Object.assign(new Event('storage'), { key, newValue });
}

const withCleared = (n: number, now = T0): SaveState => ({ ...newGame(ctx, now, D0), campaign: { cleared: stages.slice(0, n).map((s) => s.id) } });

describe('T4-01: две вкладки — ревизии и событие storage', () => {
  it('устаревшая вкладка не перетирает прогресс другой и помечается stale', () => {
    const ls = new FakeStorage();
    const A = new SaveSlot(new LocalStorageAdapter(SAVE_KEY, ls));
    const a0 = A.boot(ctx, T0, D0).save;
    const B = new SaveSlot(new LocalStorageAdapter(SAVE_KEY, ls));
    const b0 = B.boot(ctx, T0, D0).save;
    expect(b0.revision).toBe(a0.revision);
    let staleB = 0;
    B.watch(null, () => staleB++);

    // Вкладка A проходит этап.
    const won = A.write({ ...a0, campaign: { cleared: [stages[0].id, stages[1].id, stages[2].id] } });
    expect(won.ok).toBe(true);
    // Вкладка B (не знает о победе) собирает сундук — запись отклонена.
    const claimed = B.write(claimOffline(b0, T0 + H, ctx).save);
    expect(claimed).toEqual({ ok: false, reason: 'stale' });
    expect(B.stale).toBe(true);
    expect(staleB).toBe(1);
    expect(deserialize(ls.getItem(SAVE_KEY)!).campaign.cleared).toHaveLength(3);
    // Перезагрузка B видит победу.
    const B2 = new SaveSlot(new LocalStorageAdapter(SAVE_KEY, ls));
    expect(B2.boot(ctx, T0, D0).save.campaign.cleared).toHaveLength(3);
  });

  it('событие storage с более новой ревизией сразу помечает вкладку устаревшей', () => {
    const ls = new FakeStorage();
    const A = new SaveSlot(new LocalStorageAdapter(SAVE_KEY, ls));
    A.boot(ctx, T0, D0);
    const target = new EventTarget();
    let stale = 0;
    const off = A.watch(target, () => stale++);
    target.dispatchEvent(storageEvent('other.key', JSON.stringify({ revision: 99 })));
    target.dispatchEvent(storageEvent(SAVE_KEY, JSON.stringify({ revision: A.revision })));
    expect(stale).toBe(0);
    target.dispatchEvent(storageEvent(SAVE_KEY, JSON.stringify({ revision: A.revision + 1 })));
    expect(stale).toBe(1);
    expect(A.stale).toBe(true);
    off();
  });

  it('ревизия растёт с каждой записью; старое сохранение без ревизии = 0', () => {
    const ls = new FakeStorage();
    ls.data.set(SAVE_KEY, serialize(newGame(ctx, T0, D0)));
    expect(saveRevision(ls.getItem(SAVE_KEY))).toBe(0);
    const A = new SaveSlot(new LocalStorageAdapter(SAVE_KEY, ls));
    const s = A.boot(ctx, T0, D0).save;
    const w1 = A.write(s);
    const w2 = A.write(s);
    expect(w1.ok && w1.save.revision).toBe(1);
    expect(w2.ok && w2.save.revision).toBe(2);
    expect(saveRevision(ls.getItem(SAVE_KEY))).toBe(2);
    expect(saveRevision('не json')).toBe(0);
  });
});

describe('T4-02: битое и «более новое» сохранение не теряются', () => {
  it('сохранение более новой версии: новая игра только в памяти, ключ не трогается', () => {
    const ls = new FakeStorage();
    const future = JSON.stringify({ ...JSON.parse(serialize(withCleared(3))), version: SAVE_VERSION + 1 });
    ls.data.set(SAVE_KEY, future);
    const slot = new SaveSlot(new LocalStorageAdapter(SAVE_KEY, ls));
    const r = slot.boot(ctx, T0, D0);
    expect(slot.readOnly).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/более новой версией/);
    expect(slot.write(r.save)).toEqual({ ok: false, reason: 'readonly' });
    expect(ls.getItem(SAVE_KEY)).toBe(future);
  });

  it('нечитаемое сохранение копируется в резервный ключ перед заменой; копий — не больше BACKUPS_KEEP', () => {
    const ls = new FakeStorage();
    const bad = JSON.stringify({ ...JSON.parse(serialize(withCleared(2))), resources: { gold: 1.5 } });
    for (let i = 0; i < BACKUPS_KEEP + 2; i++) {
      ls.data.set(SAVE_KEY, `${bad} `.repeat(1) + ' '.repeat(i));
      const slot = new SaveSlot(new LocalStorageAdapter(SAVE_KEY, ls));
      const r = slot.boot(ctx, T0 + i, D0);
      expect(r.warnings.join(' ')).toMatch(/копия старого/);
      expect(ls.getItem(`${SAVE_KEY}.backup.${T0 + i}`)).toBe(`${bad} ` + ' '.repeat(i));
      // Новая игра уже записана поверх (копия есть).
      expect(deserialize(ls.getItem(SAVE_KEY)!).campaign.cleared).toEqual([]);
    }
    const a = new LocalStorageAdapter(SAVE_KEY, ls);
    expect(a.backups()).toEqual([2, 3, 4].map((i) => `${SAVE_KEY}.backup.${T0 + i}`));
  });

  it('копию сделать не удалось — битое сохранение не затирается', () => {
    const ls = new FakeStorage();
    ls.data.set(SAVE_KEY, '{"version":3,');
    ls.quota = true;
    const slot = new SaveSlot(new LocalStorageAdapter(SAVE_KEY, ls));
    slot.boot(ctx, T0, D0);
    expect(slot.readOnly).toBe(true);
    ls.quota = false;
    expect(slot.write(newGame(ctx, T0, D0)).ok).toBe(false);
    expect(ls.getItem(SAVE_KEY)).toBe('{"version":3,');
  });
});

describe('T4-03: переполненный localStorage при запуске', () => {
  it('сохранение читается и загружается, предупреждение о переполнении', () => {
    const ls = new FakeStorage();
    ls.data.set(SAVE_KEY, serialize(withCleared(2)));
    ls.quota = true;
    const slot = new SaveSlot(new LocalStorageAdapter(SAVE_KEY, ls));
    const r = slot.boot(ctx, T0, D0);
    expect(r.save.campaign.cleared).toHaveLength(2);
    expect(slot.storage.readable).toBe(true);
    expect(slot.storage.writable).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/переполнено/);
    expect(r.warnings.join(' ')).not.toMatch(/недоступно/);
    // Место освободилось — следующая запись проходит.
    ls.quota = false;
    expect(slot.write(r.save).ok).toBe(true);
    expect(slot.storage.writable).toBe(true);
  });
});

describe('T4-04: неизвестная профессия героя', () => {
  it('на загрузке заменяется допустимой, экраны (heroPower) не падают', () => {
    const s = newGame(ctx, T0, D0);
    const broken = { ...s, heroes: s.heroes.map((h, i) => (i === 0 ? { ...h, job: 'nonexistent_job', jobLevel: 7 } : h)) };
    const r = loadOrNew({ load: () => serialize(broken), save() {}, clear() {} }, ctx, T0, D0);
    expect(r.source).toBe('loaded');
    expect(r.save.heroes[0].job).toBe(ctx.progression.heroes.startJob);
    expect(r.warnings?.join(' ')).toMatch(/nonexistent_job/);
    expect(() => heroPower(r.save.heroes[0], ctx)).not.toThrow();
  });

  it('герой второго ранга → базовая профессия того же ранга из его прошлой профессии', () => {
    const s = newGame(ctx, T0, D0);
    const novice = ctx.progression.heroes.startJob;
    const tier1 = Object.values(ctx.content.jobs).find((j) => j.tier === 1 && j.from.includes(novice))!;
    const hero = { ...s.heroes[0], job: 'renamed_job', jobHistory: [{ job: novice, jobLevel: 10 }] };
    const fixed = sanitizeSave({ ...s, heroes: [hero, ...s.heroes.slice(1)] }, ctx);
    expect(ctx.content.jobs[fixed.save.heroes[0].job].tier).toBe(1);
    expect(ctx.content.jobs[fixed.save.heroes[0].job].from).toContain(novice);
    expect(tier1).toBeDefined();
    expect(fixed.warnings).toHaveLength(1);
  });

  it('целое сохранение — тот же объект, без предупреждений', () => {
    const s = newGame(ctx, T0, D0);
    expect(sanitizeSave(s, ctx)).toEqual({ save: s, warnings: [] });
  });
});

describe('T4-05: сцена «после этапа» переживает перезагрузку', () => {
  const after = ctx.story.scenes.find((s) => s.trigger === 'afterStage')!;
  const stage = stages.find((s) => s.id === after.stageId)!;

  it('победа ставит сцену в очередь сохранения; после перезагрузки она показывается на карте и на повторе', () => {
    let save: SaveState = { ...withCleared(stage.globalIndex), heroes: newGame(ctx, T0, D0).heroes.map((h) => ({ ...h, jobLevel: 10 })) };
    save = markScenesSeen(save, ctx.story.scenes.filter((s) => s.id !== after.id).map((s) => s.id));
    let won: SaveState | null = null;
    for (let seed = 1; seed < 40 && !won; seed++) {
      const out = actPlayStage(save, D0, stage.id, seed, ctx, T0);
      if (out.result.winner === 'A') won = out.save;
    }
    expect(won).not.toBeNull();
    // «Перезагрузка» до показа сцены.
    const reloaded = deserialize(serialize(won!));
    expect(reloaded.storyQueue).toEqual([after.id]);
    const chapter = stage.chapter;
    expect(pendingScenes(reloaded, { type: 'chapterStart', chapter }, ctx).map((s) => s.id)).toContain(after.id);
    expect(pendingScenes(reloaded, { type: 'afterStage', stageId: stage.id, firstClear: false }, ctx).map((s) => s.id)).toEqual([after.id]);
    // Показали — увидена и ушла из очереди.
    const seen = markScenesSeen(reloaded, [after.id]);
    expect(seen.storyQueue).toBeUndefined();
    expect(pendingScenes(seen, { type: 'chapterStart', chapter }, ctx).map((s) => s.id)).not.toContain(after.id);
  });

  it('повтор этапа и уже увиденная сцена в очередь не попадают', () => {
    const s = withCleared(stage.globalIndex + 1);
    expect(queueAfterStage(s, stage.id, false, ctx)).toBe(s);
    const seen = markScenesSeen(s, [after.id]);
    expect(queueAfterStage(seen, stage.id, true, ctx)).toBe(seen);
  });
});

describe('T4-06: часы были впереди — сундук не застревает', () => {
  it('после возврата часов сундук снова копит через ≤ capHours, а не через 30 дней', () => {
    let s = withCleared(2);
    s = claimOffline(s, T0 + 30 * DAY, ctx).save; // собрали «из будущего»
    // Реальное время: сундук не копит, но якорь поправляется сразу (session зовёт syncOfflineClock при запуске).
    const now = T0 + 5 * MIN;
    s = syncOfflineClock(s, now, ctx);
    expect(s.offline.lastClaimAt).toBe(now);
    expect(s.offline.debtMs).toBe(cap * H);
    expect(offlineRewards(s, now + cap * H, ctx).minutes).toBe(0);
    expect(offlineRewards(s, now + cap * H + 60 * MIN, ctx).minutes).toBe(60);
  });

  it('пустой сбор тоже сдвигает якорь (UI обязан записать результат)', () => {
    const s = claimOffline(withCleared(2), T0 + 30 * DAY, ctx).save;
    const r = actClaimOffline(s, T0, D0, ctx);
    expect(r.rewards.gold).toBe(0);
    expect(r.save.offline.lastClaimAt).toBe(T0);
  });

  it('now не число — ничего не начисляется и якорь не портится', () => {
    const s = withCleared(2);
    const r = claimOffline(s, NaN, ctx);
    expect(r.rewards).toEqual({ minutes: 0, gold: 0, jobExp: 0 });
    expect(r.save.offline.lastClaimAt).toBe(T0);
  });
});

describe('T4-07/T4-08: ежедневные механики после перевода часов', () => {
  it('часы +30 дней и обратно: сброс в ближайшую реальную полночь, а не через 30 дней', () => {
    let s: SaveState = { ...withCleared(2), currency: { gems: 1000 } };
    const future = '2026-10-27';
    s = useFastRewards(s, future, ctx).save;
    // Вернули дату: сегодня новых попыток нет (день уже «выдан» наперёд)…
    const back = rollDay(s, D0);
    expect(back.daily.fastRewardsUsed).toBe(1);
    // …а завтра — полный набор.
    expect(fastRewardsStatus(back, '2026-09-28', ctx).used).toBe(0);
  });

  it('туда-обратно по одному дню второй набор того же дня не даёт', () => {
    let s: SaveState = { ...withCleared(2), currency: { gems: 0 } };
    s = useFastRewards(s, D0, ctx).save; // бесплатная сегодня
    s = useFastRewards(s, '2026-09-28', ctx).save; // «завтра» (часы вперёд)
    s = rollDay(s, D0); // назад
    // Снова «завтра» — этот день уже был: бесплатной нет.
    expect(fastRewardsStatus(s, '2026-09-28', ctx).freeLeft).toBe(0);
  });

  it('доска поручений после возврата часов обновляется со следующей реальной полуночи', () => {
    const s = ensureBoard(newGame(ctx, T0, D0), '2026-10-27', 1, ctx);
    const back = ensureBoard(s, D0, 1, ctx);
    expect(back.bounties.board).toEqual(s.bounties.board);
    const next = ensureBoard(back, '2026-09-28', 1, ctx);
    expect(next.bounties.lastRefreshDay).toBe('2026-09-28');
    expect(next.bounties.board).not.toEqual(s.bounties.board);
  });
});

describe('T4-09: сундук переводом часов туда-обратно', () => {
  it('5 циклов «+12 ч → сбор → назад → сбор» дают не больше одного полного сундука', () => {
    let s = withCleared(1);
    let gold = 0;
    for (let i = 0; i < 5; i++) {
      let r = actClaimOffline(s, T0 + 12 * H, D0, ctx);
      s = r.save;
      gold += r.rewards.gold;
      r = actClaimOffline(s, T0, D0, ctx);
      s = r.save;
      gold += r.rewards.gold;
    }
    expect(gold).toBe(idleIncome(stages[0], Math.min(12, cap) * 60, ctx).gold);
  });
});

describe('T4-10: ставка сундука — по этапу, на котором копилось', () => {
  it('12 ч на этапе 1, потом рывок по кампании — 12 ч оплачены по ставке этапа 1', () => {
    let s = withCleared(1);
    s = { ...s, heroes: s.heroes.map((h) => ({ ...h, jobLevel: 10 })) };
    const t = T0 + 12 * H;
    let won = false;
    for (let seed = 1; seed < 20 && !won; seed++) {
      const out = playStage(s, stages[1].id, seed, ctx, t);
      if (out.result.winner === 'A') {
        s = out.save;
        won = true;
      }
    }
    expect(won).toBe(true);
    const expected = idleIncome(stages[0], Math.min(12, cap) * 60, ctx);
    expect(offlineRewards(s, t, ctx)).toEqual({ minutes: Math.min(12, cap) * 60, ...expected });
    // Лимит общий: дальше этап 2 не добавляет сверх capHours.
    expect(offlineRewards(s, t + 10 * H, ctx).minutes).toBe(cap * 60);
    const r = claimOffline(s, t, ctx);
    expect(r.rewards.gold).toBe(expected.gold);
    expect(r.save.offline.banked).toBeUndefined();
  });
});

describe('T4-15: незнакомые поля сохранения сохраняются', () => {
  it('поля верхнего уровня и вложенные переживают загрузку и запись', () => {
    const raw = JSON.parse(serialize(newGame(ctx, T0, D0)));
    raw.futureField = { a: 1 };
    raw.heroes[0].title = 'Герой';
    raw.offline.bonus = 2;
    const round = JSON.parse(serialize(deserialize(JSON.stringify(raw))));
    expect(round.futureField).toEqual({ a: 1 });
    expect(round.heroes[0].title).toBe('Герой');
    expect(round.offline.bonus).toBe(2);
  });

  it('незнакомое поле переживает действие игрока (claimOffline)', () => {
    const raw = JSON.parse(serialize(withCleared(1)));
    raw.futureField = 7;
    const s = deserialize(JSON.stringify(raw));
    const next = claimOffline(s, T0 + H, ctx).save;
    expect(JSON.parse(serialize(next)).futureField).toBe(7);
  });

  it('MemoryStorage + loadOrNew: старое сохранение без новых полей грузится', () => {
    const m = new MemoryStorage();
    m.save(serialize(newGame(ctx, T0, D0)));
    const r = loadOrNew(m, ctx, T0, D0);
    expect(r.source).toBe('loaded');
    expect(r.save.storyQueue).toBeUndefined();
  });
});
