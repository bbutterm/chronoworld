/**
 * Вознесение карточек (docs/design/heroes.md, раздел 2; data/cards.json → merge): корм для призывных, осколки для
 * сюжетных (вторая профессия на фиолетовом), возврат вложенного в корм; источники осколков.
 */
import { describe, expect, it } from 'vitest';
import {
  addHeroCard,
  addShards,
  ascendHero,
  ascendRequirement,
  autoFodder,
  fodderBlocker,
  heroCard,
  HeroError,
  levelRangeCost,
  newGame,
  playStage,
  replayShardCount,
  shardTarget,
  stageShardHero,
  stageShardReward,
  type CardRarity,
  type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HeroError);
    return (e as HeroError).code;
  }
  return undefined;
}

/** Новая игра + карточки [шаблон, редкость, уровень] (id h4, h5…), золото. */
function withCards(cards: [string, CardRarity, number?][], gold = 1_000_000): SaveState {
  let s: SaveState = { ...newGame(ctx, 0), resources: { gold, heroExp: 0 } };
  for (const [t, r, l] of cards) s = addHeroCard(s, t, r, { level: l ?? 1 }).save;
  return s;
}

describe('вознесение призывных карточек (корм)', () => {
  it('зелёный → синий: +2 той же зелёной; золото; уровень цели сохраняется; вложенное в корм возвращается', () => {
    // h4 — цель, h5/h6 — корм (одна прокачана до 5 и в экипировке).
    let s = withCards([['iris', 'green', 12], ['iris', 'green', 5], ['iris', 'green']]);
    s = { ...s, inventory: { items: [{ id: 'it1', itemId: 'knife', equippedBy: 'h5' }] } };
    const req = ascendRequirement(s, 'h4', ctx)!;
    expect(req).toMatchObject({ from: 'green', to: 'blue', track: 'first', gold: 1000, blockers: [] });
    expect(req.fodder).toEqual([{ kind: 'same', rarity: 'green', count: 2, candidates: ['h6', 'h5'] }]);
    expect(autoFodder(s, 'h4', ctx)).toEqual(['h6', 'h5']);
    const r = ascendHero(s, 'h4', ['h5', 'h6'], ctx);
    expect(r.save.heroes.find((h) => h.id === 'h4')).toMatchObject({ rarity: 'blue', level: 12 });
    expect(r.save.heroes.some((h) => h.id === 'h5' || h.id === 'h6')).toBe(false);
    expect(r.refund).toEqual(levelRangeCost(1, 5, ctx));
    expect(r.save.resources).toEqual({ gold: 1_000_000 - 1000 + r.refund.gold, heroExp: r.refund.exp });
    expect(r.save.inventory.items[0].equippedBy).toBeNull();
    expect(r.events).toEqual([{ type: 'ascended', heroId: 'h4', from: 'green', to: 'blue', job: 'swordman', jobChanged: false }]);
    expect(r.consumed.sort()).toEqual(['h5', 'h6']);
  });

  it('синий → фиолетовый: +1 той же синей +2 синих линии (другие карточки линии — в «линию», сюжетные — нет)', () => {
    const s = withCards([['kai', 'blue', 30], ['kai', 'blue'], ['lira', 'blue'], ['lira', 'blue', 2], ['kai', 'green']]);
    const req = ascendRequirement(s, 'h4', ctx)!;
    expect(req.fodder.map((f) => [f.kind, f.rarity, f.count])).toEqual([
      ['same', 'blue', 1],
      ['line', 'blue', 2],
    ]);
    // «Линия» — любые карточки линии мага нужной редкости (включая ту же); зелёная копия не подходит.
    expect(req.fodder[1].candidates.sort()).toEqual(['h5', 'h6', 'h7']);
    const pick = autoFodder(s, 'h4', ctx)!;
    expect(pick[0]).toBe('h5');
    expect(pick.slice(1).sort()).toEqual(['h6', 'h7']);
    const r = ascendHero(s, 'h4', pick, ctx);
    expect(r.save.heroes.find((h) => h.id === 'h4')!.rarity).toBe('purple');
    // Максимум первой профессии призыва — золотой.
    const gold = { ...r.save, heroes: r.save.heroes.map((h) => (h.id === 'h4' ? { ...h, rarity: 'gold' as const } : h)) };
    expect(ascendRequirement(gold, 'h4', ctx)).toBeNull();
    expect(codeOf(() => ascendHero(gold, 'h4', [], ctx))).toBe('max_rarity');
  });

  it('вторые профессии: фиолетовый → золотой +2 той же фиолетовой; золотой → красный +1 той же +2 линии', () => {
    const s = withCards([['seyren', 'purple', 60], ['seyren', 'purple'], ['seyren', 'purple']]);
    expect(ascendRequirement(s, 'h4', ctx)).toMatchObject({ track: 'second', to: 'gold', gold: 20000 });
    const r = ascendHero(s, 'h4', ['h5', 'h6'], ctx);
    expect(r.save.heroes.find((h) => h.id === 'h4')).toMatchObject({ rarity: 'gold', level: 60 });
    const req = ascendRequirement(r.save, 'h4', ctx)!;
    expect(req.fodder.map((f) => [f.kind, f.rarity, f.count])).toEqual([
      ['same', 'purple', 1],
      ['line', 'purple', 2],
    ]);
  });

  it('неверный корм — bad_fodder; корм в отряде, пресете, на поручении, закреплённый — fodder_busy; нехватка золота', () => {
    const s = withCards([['iris', 'green'], ['iris', 'green'], ['iris', 'green'], ['meilin', 'green'], ['iris', 'blue']]);
    expect(codeOf(() => ascendHero(s, 'h4', ['h5'], ctx))).toBe('bad_fodder');
    expect(codeOf(() => ascendHero(s, 'h4', ['h5', 'h7'], ctx))).toBe('bad_fodder'); // лучница — не та же
    expect(codeOf(() => ascendHero(s, 'h4', ['h5', 'h8'], ctx))).toBe('bad_fodder'); // синяя — не та редкость
    expect(codeOf(() => ascendHero(s, 'h4', ['h5', 'h5'], ctx))).toBe('bad_fodder');
    expect(codeOf(() => ascendHero(s, 'h4', ['h5', 'h1'], ctx))).toBe('fodder_busy'); // Алан в отряде (и сюжетный)
    const inSquad = { ...s, squad: ['h5', null, null, 'h2', 'h3'] };
    expect(codeOf(() => ascendHero(inSquad, 'h4', ['h5', 'h6'], ctx))).toBe('fodder_busy');
    const inPreset = { ...s, presets: [{ id: 'p1', name: 'x', squad: [null, 'h6', null, null, null] }] };
    expect(codeOf(() => ascendHero(inPreset, 'h4', ['h5', 'h6'], ctx))).toBe('fodder_busy');
    const locked = { ...s, heroes: s.heroes.map((h) => (h.id === 'h6' ? { ...h, locked: true } : h)) };
    expect(fodderBlocker(locked, 'h6', ctx)).toMatch(/закреплён/);
    expect(codeOf(() => ascendHero(locked, 'h4', ['h5', 'h6'], ctx))).toBe('fodder_busy');
    const busy: SaveState = {
      ...s,
      bounties: { ...s.bounties, active: [{ id: 'b1', templateId: 'patrol', rarity: 'common', durationMinutes: 30, heroCount: 1, role: null, rewards: { gold: 1, jobExp: 0, gems: 0 }, heroIds: ['h6'], startedAt: 0, endsAt: 1 }] },
    };
    expect(codeOf(() => ascendHero(busy, 'h4', ['h5', 'h6'], ctx))).toBe('fodder_busy');
    expect(fodderBlocker(s, 'h1', ctx)).toMatch(/сюжетный/);
    expect(codeOf(() => ascendHero({ ...s, resources: { gold: 999, heroExp: 0 } }, 'h4', ['h5', 'h6'], ctx))).toBe('not_enough_gold');
    // Ошибка — save не меняется (чистая функция).
    const copy = structuredClone(s);
    codeOf(() => ascendHero(s, 'h4', ['h5'], ctx));
    expect(s).toEqual(copy);
  });
});

describe('вознесение сюжетных карточек (осколки героя)', () => {
  it('зелёный → синий: 20 осколков + 1000 золота; корм не нужен и не принимается', () => {
    const s = withCards([['iris', 'green']]);
    const req = ascendRequirement(s, 'h1', ctx)!;
    expect(req).toMatchObject({ track: 'story', to: 'blue', gold: 1000, shards: { templateId: 'alan', have: 0, need: 20 }, fodder: [] });
    expect(req.blockers).toEqual(['Не хватает осколков: 0 / 20']);
    expect(codeOf(() => ascendHero(s, 'h1', [], ctx))).toBe('not_enough_shards');
    const rich = addShards(s, 'alan', 25);
    expect(ascendRequirement(rich, 'h1', ctx)!.blockers).toEqual([]);
    expect(codeOf(() => ascendHero(rich, 'h1', ['h4'], ctx))).toBe('bad_fodder');
    const r = ascendHero(rich, 'h1', [], ctx);
    expect(r.save.heroes[0]).toMatchObject({ templateId: 'alan', rarity: 'blue', level: 1 });
    expect(r.save.shards.alan).toBe(5);
    expect(r.save.resources.gold).toBe(rich.resources.gold - 1000);
  });

  it('синий → фиолетовый — вторая профессия: 40 осколков, ур. 40; класс и навыки меняются (Алан → Рыцарь)', () => {
    const base = withCards([]);
    const blue: SaveState = addShards({ ...base, heroes: base.heroes.map((h) => (h.id === 'h1' ? { ...h, rarity: 'blue', level: 39 } : h)) }, 'alan', 40);
    const req = ascendRequirement(blue, 'h1', ctx)!;
    expect(req).toMatchObject({ to: 'purple', minLevel: 40, newJob: 'knight' });
    expect(req.blockers).toEqual(['Нужен уровень 40 (сейчас 39)']);
    expect(codeOf(() => ascendHero(blue, 'h1', [], ctx))).toBe('level_required');
    const at40 = { ...blue, heroes: blue.heroes.map((h) => (h.id === 'h1' ? { ...h, level: 40 } : h)) };
    const r = ascendHero(at40, 'h1', [], ctx);
    expect(r.events[0]).toEqual({ type: 'ascended', heroId: 'h1', from: 'blue', to: 'purple', job: 'knight', jobChanged: true });
    // Открытые на ур. 40 навыки новой формы.
    expect(r.events.filter((e) => e.type === 'skillUnlocked').map((e) => (e.type === 'skillUnlocked' ? e.skill : ''))).toEqual([
      'job_swordman_provoke',
      'swordman_endure',
      'job_knight_auto_counter',
    ]);
    expect(heroCard(r.save.heroes[0], ctx)).toMatchObject({ job: 'knight', jobName: 'Рыцарь', rarity: { id: 'purple' }, maxLevel: 60 });
    expect(r.save.shards.alan).toBe(0);
  });

  it('красный — максимум сюжетных', () => {
    const s = withCards([]);
    const red = { ...s, heroes: s.heroes.map((h) => (h.id === 'h1' ? { ...h, rarity: 'red' as const } : h)) };
    expect(ascendRequirement(red, 'h1', ctx)).toBeNull();
  });
});

describe('источники осколков', () => {
  it('этап кампании: герой этапа — по кругу среди сюжетных героев игрока; босс — больше', () => {
    const s = newGame(ctx, 0);
    const st = ctx.content.stages;
    expect(st.slice(0, 6).map((x) => stageShardHero(s, x, ctx))).toEqual(['alan', 'bran', 'vika', 'alan', 'bran', 'vika']);
    const boss = st.find((x) => x.boss)!;
    expect(stageShardReward(s, boss, ctx)!.count).toBe(ctx.cards.shards.bossFirstClear);
    expect(stageShardReward(s, st[0], ctx)).toEqual({ templateId: 'alan', count: ctx.cards.shards.firstClear });
    // С Гретой — круг из четырёх.
    const four = addHeroCard(s, 'greta', 'green').save;
    expect(stageShardHero(four, st[3], ctx)).toBe('greta');
  });

  it('повтор этапа: осколок с шансом replayChance, детерминированно по seed боя', () => {
    const n = 20_000;
    let hits = 0;
    for (let seed = 0; seed < n; seed++) if (replayShardCount(seed, ctx) > 0) hits++;
    expect(Math.abs(hits / n - ctx.cards.shards.replayChance)).toBeLessThan(0.01);
    expect(replayShardCount(12345, ctx)).toBe(replayShardCount(12345, ctx));
  });

  it('первая победа даёт осколки героя этапа; повтор — только если выпал шанс', () => {
    const s = newGame(ctx, 0);
    const s1 = ctx.content.stages[0].id;
    let first = playStage(s, s1, 1, ctx);
    for (let seed = 2; first.result.winner !== 'A'; seed++) first = playStage(s, s1, seed, ctx);
    expect(first.save.shards).toEqual({ alan: ctx.cards.shards.firstClear });
    let lucky = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = playStage(first.save, s1, seed, ctx);
      const got = (r.save.shards.alan ?? 0) - (first.save.shards.alan ?? 0);
      if (r.result.winner === 'A') expect(got).toBe(replayShardCount(seed, ctx));
      else expect(got).toBe(0);
      if (got > 0) lucky++;
    }
    expect(lucky).toBeGreaterThan(0);
  });

  it('shardTarget: ниже редкость → меньше осколков → по сюжету; максимальные не получают', () => {
    const s = newGame(ctx, 0);
    expect(shardTarget(s, ctx)).toBe('alan');
    expect(shardTarget(addShards(s, 'alan', 3), ctx)).toBe('bran');
    const blueAlan = { ...s, heroes: s.heroes.map((h) => (h.id === 'h1' ? { ...h, rarity: 'blue' as const } : h)) };
    expect(shardTarget(addShards(addShards(blueAlan, 'bran', 9), 'vika', 9), ctx)).toBe('bran');
    const allRed = { ...s, heroes: s.heroes.map((h) => ({ ...h, rarity: 'red' as const })) };
    expect(shardTarget(allRed, ctx)).toBe('alan');
    expect(shardTarget({ ...s, heroes: [] }, ctx)).toBeNull();
  });
});
