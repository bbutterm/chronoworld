import { describe, expect, it } from 'vitest';
import {
  COMBAT,
  deserialize,
  featureStage,
  fightHunt,
  HUNT_BOSS_ID,
  HuntError,
  huntBoss,
  huntDamage,
  huntKilled,
  huntScore,
  huntStatus,
  huntTier,
  newGame,
  parseHuntConfig,
  serialize,
  simulateBattle,
  sweepHunt,
  type FullContext,
  type HuntConfig,
  type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx: FullContext = loadFullContext();
const D1 = '2026-09-26';
const D2 = '2026-09-27';

/** Охота открыта: вся кампания до этапа открытия (data/unlocks.json → hunt) пройдена. */
function unlocked(): SaveState {
  const s = newGame(ctx, 0, D1);
  const stage = featureStage('hunt', ctx)!;
  const upTo = ctx.content.stages.findIndex((x) => x.id === stage);
  return { ...s, campaign: { cleared: ctx.content.stages.slice(0, upTo + 1).map((x) => x.id) } };
}

const withHuntCfg = (patch: Partial<HuntConfig>): FullContext => ({ ...ctx, hunt: { ...ctx.hunt, ...patch } });

function expectHuntError(fn: () => unknown, code: HuntError['code']) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HuntError);
    expect((e as HuntError).code).toBe(code);
    return;
  }
  throw new Error(`ожидалась HuntError ${code}`);
}

describe('Охота на босса: конфиг', () => {
  it('data/hunt.json разбирается, этап открытия — в data/unlocks.json', () => {
    expect(ctx.hunt.attemptsPerDay).toBeGreaterThan(0);
    expect(ctx.hunt.tiers.length).toBeGreaterThan(0);
    expect(featureStage('hunt', ctx)).toBeTruthy();
  });

  it('пороги должны строго возрастать, награды — не убывать', () => {
    const base = { attemptsPerDay: 1, timeLimitSeconds: 30, bosses: [{ unit: 'mob_boss1', hpMult: 10 }] };
    expect(() => parseHuntConfig({ ...base, tiers: [{ damage: 10, rewards: {} }, { damage: 10, rewards: {} }] })).toThrow(/строго возрастать/);
    expect(() => parseHuntConfig({ ...base, tiers: [{ damage: 10, rewards: { gold: 5 } }, { damage: 20, rewards: { gold: 1 } }] })).toThrow(/меньше/);
  });

  it('гемов за день не больше ~20 (две попытки на высшем пороге)', () => {
    const top = ctx.hunt.tiers[ctx.hunt.tiers.length - 1].rewards.gems ?? 0;
    expect(top * ctx.hunt.attemptsPerDay).toBeLessThanOrEqual(20);
  });
});

describe('Охота на босса: пороги и босс дня', () => {
  it('huntTier: высший достигнутый порог, −1 ниже первого', () => {
    const t = ctx.hunt.tiers;
    expect(huntTier(0, ctx.hunt)).toBe(-1);
    expect(huntTier(t[0].damage - 1, ctx.hunt)).toBe(-1);
    expect(huntTier(t[0].damage, ctx.hunt)).toBe(0);
    expect(huntTier(t[1].damage + 1, ctx.hunt)).toBe(1);
    expect(huntTier(Number.MAX_SAFE_INTEGER, ctx.hunt)).toBe(t.length - 1);
  });

  it('босс сменяется по дням и одинаков для одного дня; MVP — статы уровня (ОЗ уровня, АТК и ЗАЩ × множители)', () => {
    const a = huntBoss(D1, ctx);
    const b = huntBoss(D2, ctx);
    expect(huntBoss(D1, ctx)).toEqual(a);
    if (ctx.hunt.bosses.length > 1) expect(b.index).toBe((a.index + 1) % ctx.hunt.bosses.length);
    const cfg = ctx.hunt.bosses[a.index];
    const base = ctx.content.units[cfg.unit];
    expect(a.def.id).toBe(HUNT_BOSS_ID);
    const ranks = ctx.hunt.mvp!.ranks;
    const r = ranks.length - 1;
    const top = huntBoss(D1, ctx, r);
    expect(top.rank).toBe(r);
    expect(top.def.stats.hp).toBe(ranks[r].hp);
    expect(top.def.stats.atk).toBe(Math.round(base.stats.atk * ranks[r].atk));
    expect(top.def.stats.def).toBe(Math.round(base.stats.def * ranks[r].def));
    // Уровень вне диапазона — ближайший допустимый.
    expect(huntBoss(D1, ctx, 999).rank).toBe(r);
    expect(huntBoss(D1, ctx, -3).rank).toBe(0);
  });

  it('BUG-164 → MVP: результат — доля ОЗ уровня × урон порога уровня; победа над уровнем i — порог i, высший достижим', () => {
    const { ranks } = ctx.hunt.mvp!;
    expect(ranks.length).toBeGreaterThanOrEqual(ctx.hunt.tiers.length);
    ranks.forEach((r, i) => i > 0 && expect(r.hp).toBeGreaterThan(ranks[i - 1].hp));
    for (let i = 0; i < ctx.hunt.tiers.length; i++) {
      expect(huntTier(huntScore(0, true, i, ctx), ctx.hunt)).toBe(i);
      // Половина ОЗ уровня — половина зачёта.
      expect(huntScore(ranks[i].hp / 2, false, i, ctx)).toBe(Math.round(ctx.hunt.tiers[i].damage / 2));
    }
    expect(huntTier(huntScore(0, true, ranks.length - 1, ctx), ctx.hunt)).toBe(ctx.hunt.tiers.length - 1);
  });
});

describe('Охота на босса: бой', () => {
  it('закрыта до этапа открытия', () => {
    const s = newGame(ctx, 0, D1);
    expect(huntStatus(s, D1, ctx).unlocked).toBe(false);
    expectHuntError(() => fightHunt(s, D1, ctx), 'hunt_locked');
  });

  it('бой ограничен timeLimitSeconds, урон = урон по боссу, награда — по порогу, попытка тратится', () => {
    const s = unlocked();
    const out = fightHunt(s, D1, ctx);
    expect(out.result).not.toBeNull();
    const r = out.result!;
    expect(r.duration).toBeLessThanOrEqual(ctx.hunt.timeLimitSeconds);
    // MVP падает за бой («MVP!») или бой кончается по времени / гибелью отряда.
    expect(out.killed).toBe(huntKilled(r));
    expect(out.damage).toBe(huntDamage(r));
    expect(out.damage).toBeGreaterThan(0);
    expect(out.score).toBe(huntScore(out.damage, out.killed, out.boss.rank!, ctx));
    expect(out.tier).toBe(huntTier(out.score, ctx.hunt));
    const reward = out.tier >= 0 ? ctx.hunt.tiers[out.tier].rewards : {};
    expect(out.save.resources.gold - s.resources.gold).toBe(reward.gold ?? 0);
    expect(out.save.currency.gems - s.currency.gems).toBe(reward.gems ?? 0);
    expect(out.save.hunt).toMatchObject({ day: D1, used: 1, best: { [out.boss.unit]: out.score } });
    expect(out.record).toBe(true);
    const st = huntStatus(out.save, D1, ctx);
    expect(st.attemptsLeft).toBe(ctx.hunt.attemptsPerDay - 1);
    expect(st.best).toBe(out.score);
  });

  it('детерминирован: то же сохранение и день — тот же лог и урон; другая попытка — другой seed', () => {
    const s = unlocked();
    const a = fightHunt(s, D1, ctx);
    const b = fightHunt(s, D1, ctx);
    expect(b.result!.log).toEqual(a.result!.log);
    expect(b.save).toEqual(a.save);
    const c = fightHunt(a.save, D1, ctx);
    expect(c.result!.seed).not.toBe(a.result!.seed);
  });

  it('попытки кончаются и сбрасываются новым днём; перевод часов назад попыток не даёт', () => {
    let s = unlocked();
    for (let i = 0; i < ctx.hunt.attemptsPerDay; i++) s = fightHunt(s, D1, ctx).save;
    expect(huntStatus(s, D1, ctx).attemptsLeft).toBe(0);
    expectHuntError(() => fightHunt(s, D1, ctx), 'no_attempts');
    expectHuntError(() => fightHunt(s, '2026-09-25', ctx), 'no_attempts');
    expect(huntStatus(s, D2, ctx).attemptsLeft).toBe(ctx.hunt.attemptsPerDay);
    const next = fightHunt(s, D2, ctx).save;
    expect(next.hunt!.day).toBe(D2);
    expect(next.hunt!.used).toBe(1);
  });

  it('«Зачистка»: только после боя с этим боссом, повторяет лучший урон и его награду', () => {
    const s = unlocked();
    expect(huntStatus(s, D1, ctx).canSweep).toBe(false);
    expectHuntError(() => sweepHunt(s, D1, ctx), 'no_sweep');
    const fought = fightHunt(s, D1, ctx);
    expect(huntStatus(fought.save, D1, ctx).canSweep).toBe(true);
    const sw = sweepHunt(fought.save, D1, ctx);
    expect(sw.result).toBeNull();
    expect(sw.sweep).toBe(true);
    expect(sw.damage).toBe(fought.score);
    expect(sw.tier).toBe(fought.tier);
    expect(sw.save.resources.gold - fought.save.resources.gold).toBe(fought.save.resources.gold - s.resources.gold);
    expect(sw.save.hunt!.used).toBe(2);
    expect(sw.save.battleSeq).toBe(s.battleSeq);
    expect(() => sweepHunt(sw.save, D1, withHuntCfg({ attemptsPerDay: 5, sweep: false }))).toThrow(HuntError);
  });

  it('сохранение с охотой проходит serialize → deserialize', () => {
    const s = fightHunt(unlocked(), D1, ctx).save;
    expect(deserialize(serialize(s))).toEqual(s);
  });
});

describe('Ограничение времени боя (combat.timeLimitSeconds)', () => {
  it('по умолчанию — 90 с из data/combat.json; с меньшим лимитом бой обрывается по времени', () => {
    const boss = huntBoss(D1, ctx).def;
    const tank = ctx.content.units['mob_tank'];
    const a = [tank, null, null, null, null];
    const b = [boss, null, null, null, null];
    const full = simulateBattle(ctx.content, a, b, 7, { log: false });
    expect(full.duration).toBeLessThanOrEqual(COMBAT.timeLimitSeconds);
    const short = simulateBattle(ctx.content, a, b, 7, { log: false, combat: { ...COMBAT, timeLimitSeconds: 5 } });
    expect(short.duration).toBeLessThanOrEqual(5);
    if (short.reason === 'timeout') expect(short.winner).toBe('B');
  });
});
