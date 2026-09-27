import { describe, expect, it } from 'vitest';
import { buildContent, enemySquad, GameRuleError, getStage, newGame, playStage, stageStatus, type SaveState } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();
const stages = ctx.content.stages;
const s1 = stages[0].id;
const s2 = stages[1].id;
const fresh = () => newGame(ctx, 0);
const clearedUpTo = (n: number): SaveState => ({ ...fresh(), campaign: { cleared: stages.slice(0, n).map((s) => s.id) } });

/** Первый seed из 1..20, при котором отряд побеждает на этапе. */
function winningSeed(save: SaveState, stageId: string): number {
  for (let seed = 1; seed <= 20; seed++) if (playStage(save, stageId, seed, ctx).result.winner === 'A') return seed;
  throw new Error(`Отряд не может пройти ${stageId} ни с одним seed 1..20`);
}

function expectRuleError(fn: () => unknown, code: GameRuleError['code']) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GameRuleError);
    expect((e as GameRuleError).code).toBe(code);
    return;
  }
  throw new Error(`ожидалась GameRuleError ${code}`);
}

describe('кампания', () => {
  it('глава 1: 10 этапов, 10-й — босс', () => {
    const ch1 = stages.filter((s) => s.chapter === 'chapter1');
    expect(ch1).toHaveLength(10);
    expect(ch1[9].boss).toBe(true);
    expect(ch1[9].enemies.some((e) => e && ctx.content.units[e.unit].kind === 'boss')).toBe(true);
    expect(getStage(ctx, s2).globalIndex).toBe(1);
    expectRuleError(() => getStage(ctx, 'nope'), 'unknown_stage');
  });

  it('первый этап открыт, остальные закрыты; пройденный — cleared', () => {
    const save = fresh();
    expect(stageStatus(save, s1, ctx)).toBe('open');
    for (const s of stages.slice(1)) expect(stageStatus(save, s.id, ctx)).toBe('locked');
    const after = clearedUpTo(1);
    expect(stageStatus(after, s1, ctx)).toBe('cleared');
    expect(stageStatus(after, s2, ctx)).toBe('open');
    expect(stageStatus(after, stages[2].id, ctx)).toBe('locked');
  });

  it('enemySquad: статы растут на enemyStatGrowthPerStage за этап, spd не растёт, id слотов разные', () => {
    const stage = stages[4];
    const squad = enemySquad(stage.id, ctx);
    const k = Math.pow(1 + ctx.progression.campaign.enemyStatGrowthPerStage, stage.globalIndex);
    expect(squad).toHaveLength(5);
    stage.enemies.forEach((e, slot) => {
      const u = squad[slot];
      if (!e) return expect(u).toBeNull();
      const base = ctx.content.units[e.unit];
      expect(u!.id).toBe(`${stage.id}_${slot}`);
      expect(u!.stats.hp).toBe(Math.round(base.stats.hp * e.mult * k));
      expect(u!.stats.atk).toBe(Math.round(base.stats.atk * e.mult * k));
      expect(u!.stats.def).toBe(Math.round(base.stats.def * e.mult * k));
      expect(u!.stats.spd).toBe(base.stats.spd);
      expect(u!.kind).toBe(base.kind);
      expect(u!.skills).toEqual(base.skills);
    });
    const ids = squad.filter((u) => u).map((u) => u!.id);
    expect(new Set(ids).size).toBe(ids.length);
    // На первом этапе множитель роста = 1.
    const first = enemySquad(s1, ctx).find((u) => u)!;
    expect(first.stats.hp).toBe(Math.round(ctx.content.units[stages[0].enemies.find((e) => e)!.unit].stats.hp * stages[0].enemies.find((e) => e)!.mult));
  });

  it('enemySquad: mult умножает статы', () => {
    const c = loadGameContext();
    const stage = { ...c.content.stages[0], enemies: [{ unit: 'mob_melee', mult: 2 }, null, null, null, null] };
    c.content.stages = [stage, ...c.content.stages.slice(1)];
    const u = enemySquad(stage.id, c)[0]!;
    expect(u.stats.hp).toBe(c.content.units.mob_melee.stats.hp * 2);
  });

  it('playStage: закрытый этап → GameRuleError stage_locked, пустой отряд → empty_squad', () => {
    expectRuleError(() => playStage(fresh(), s2, 1, ctx), 'stage_locked');
    expectRuleError(() => playStage(fresh(), 'nope', 1, ctx), 'unknown_stage');
    expectRuleError(() => playStage({ ...fresh(), squad: [null, null, null, null, null] }, s1, 1, ctx), 'empty_squad');
    expectRuleError(() => playStage({ ...fresh(), squad: ['ghost', null, null, null, null] }, s1, 1, ctx), 'unknown_hero');
  });

  it('сюжетная тройка из newGame проходит этап 1 хотя бы с одним seed 1..20', () => {
    expect(winningSeed(fresh(), s1)).toBeGreaterThan(0);
  });

  it('playStage: победа — золото, опыт в общий пул, осколки героя этапа, stageCleared, stageUnlocked следующего', () => {
    const save: SaveState = { ...fresh(), squad: ['h1', 'h2', null, null, null] };
    const seed = winningSeed(save, s1);
    const { save: next, events, result } = playStage(save, s1, seed, ctx);
    const r = stages[0].rewards;
    expect(result.winner).toBe('A');
    expect(next.battleSeq).toBe(save.battleSeq + 1);
    expect(next.resources.gold).toBe(save.resources.gold + r.gold);
    expect(next.campaign.cleared).toEqual([s1]);
    expect(stageStatus(next, s2, ctx)).toBe('open');
    // Осколки этапа 1 (globalIndex 0) — первому сюжетному герою по кругу (Алан).
    expect(events.slice(0, 4)).toEqual([
      { type: 'rewards', gold: r.gold, heroExp: r.jobExp },
      { type: 'shards', templateId: 'alan', count: ctx.cards.shards.firstClear },
      { type: 'stageCleared', stageId: s1, firstTime: true },
      { type: 'stageUnlocked', stageId: s2 },
    ]);
    expect(next.resources.heroExp).toBe(save.resources.heroExp + r.jobExp);
    expect(next.shards).toEqual({ alan: ctx.cards.shards.firstClear });
    // Уровни героев сами не растут — опыт тратит игрок («Улучшить»).
    expect(next.heroes).toEqual(save.heroes);
  });

  it('playStage: повтор пройденного — награда × replayRewardMultiplier, без stageUnlocked', () => {
    const save = clearedUpTo(1);
    const seed = winningSeed(save, s1);
    const { save: next, events } = playStage(save, s1, seed, ctx);
    const m = ctx.progression.campaign.replayRewardMultiplier;
    const r = stages[0].rewards;
    expect(next.resources.gold).toBe(Math.floor(r.gold * m));
    expect(next.campaign.cleared).toEqual([s1]);
    expect(events).toContainEqual({ type: 'rewards', gold: Math.floor(r.gold * m), heroExp: Math.floor(r.jobExp * m) });
    expect(next.resources.heroExp).toBe(Math.floor(r.jobExp * m));
    expect(events).toContainEqual({ type: 'stageCleared', stageId: s1, firstTime: false });
    expect(events.some((e) => e.type === 'stageUnlocked')).toBe(false);
  });

  it('playStage: поражение — только battleSeq + 1', () => {
    // Босс главы против одного Алана 1-го уровня — проигрыш.
    const save: SaveState = { ...clearedUpTo(9), squad: ['h1', null, null, null, null], battleSeq: 7 };
    const boss = stages[9].id;
    const out = playStage(save, boss, 1, ctx);
    expect(out.result.winner).toBe('B');
    expect(out.events).toEqual([]);
    expect(out.save).toEqual({ ...save, battleSeq: 8 });
  });

  it('playStage детерминирован по seed и не меняет исходный save', () => {
    const save = fresh();
    const copy = structuredClone(save);
    const a = playStage(save, s1, 5, ctx);
    const b = playStage(save, s1, 5, ctx);
    expect(a.result.log).toEqual(b.result.log);
    expect(a.save).toEqual(b.save);
    expect(a.events).toEqual(b.events);
    expect(save).toEqual(copy);
  });
});

describe('проверки кампании в контенте', () => {
  const unit = (id: string, kind: string) => ({
    id,
    name: id,
    kind,
    role: 'damage',
    stats: { hp: 100, atk: 10, def: 0, spd: 100 },
    skills: { basic: 'hit', passives: [] },
    visual: { sprite: id },
  });
  const stage = (id: string, enemies: unknown[], boss = false) => ({
    id,
    name: id,
    boss,
    enemies: [...enemies, null, null, null, null, null].slice(0, 5),
    rewards: { jobExp: 1, gold: 1 },
    offlinePerMinute: { jobExp: 1, gold: 1 },
  });
  const build = (chapters: unknown[]) => () =>
    buildContent({
      units: [unit('mob', 'monster'), unit('big', 'boss'), unit('hero', 'hero')].map((data, i) => ({ file: `u${i}`, data })),
      skills: [{ file: 's', data: { id: 'hit', name: 'hit', range: 'melee', target: { side: 'enemy', pick: 'nearest' }, effects: [{ type: 'damage', k: 1 }] } }],
      chapters: chapters.map((data, i) => ({ file: `c${i}`, data })),
    });

  it('корректная кампания собирается', () => {
    expect(build([{ id: 'c1', name: 'c', order: 1, stages: [stage('a', [{ unit: 'mob' }]), stage('b', [{ unit: 'big' }], true)] }])).not.toThrow();
  });

  it('повтор id этапа между главами', () => {
    expect(
      build([
        { id: 'c1', name: 'c', order: 1, stages: [stage('a', [{ unit: 'mob' }])] },
        { id: 'c2', name: 'c', order: 2, stages: [stage('a', [{ unit: 'mob' }])] },
      ]),
    ).toThrow(/id уже занят/);
  });

  it('этап без врагов, герой во врагах, boss-этап без босса', () => {
    expect(build([{ id: 'c1', name: 'c', order: 1, stages: [stage('a', [])] }])).toThrow(/нет ни одного врага/);
    expect(build([{ id: 'c1', name: 'c', order: 1, stages: [stage('a', [{ unit: 'hero' }])] }])).toThrow(/не монстр/);
    expect(build([{ id: 'c1', name: 'c', order: 1, stages: [stage('a', [{ unit: 'mob' }], true)] }])).toThrow(/нет юнита kind boss/);
    expect(build([{ id: 'c1', name: 'c', order: 1, stages: [stage('a', [{ unit: 'ghost' }])] }])).toThrow(/не найден/);
  });
});
