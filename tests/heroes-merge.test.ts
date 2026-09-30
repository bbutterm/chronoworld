/**
 * Герои v2 — вознесение копиями (docs/design/heroes-v2.md, раздел 2.2; data/cards.json → merge), выбор и смена ветки
 * (раздел 3), карты случайных героев из наград (раздел 2.3), «Контракт героя» (раздел 4.2).
 */
import { describe, expect, it } from 'vitest';
import {
  addHeroCard,
  ascendHero,
  ascendPlan,
  ascendRequirement,
  autoChain,
  autoFodder,
  branchChangeCost,
  branchStatus,
  canAscend,
  catchUpLevel,
  changeBranch,
  chooseBranch,
  claimHeroPick,
  fodderBlocker,
  grantRewards,
  heroCard,
  HeroError,
  levelRangeCost,
  newGame,
  pickOptions,
  playStage,
  rollHeroCards,
  cardRng,
  stageCardDrop,
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

const gold = (from: CardRarity) => ctx.cards.merge.find((m) => m.from === from)!.gold;

/** Новая игра (h1 Алан, h2 Бран, h3 Вика) + экземпляры [шаблон, редкость, уровень, ветка] (id h4, h5…), золото. */
function withCards(cards: [string, CardRarity, number?, string?][], goldAmount = 1_000_000): SaveState {
  let s: SaveState = { ...newGame(ctx, 0), resources: { gold: goldAmount, heroExp: 0 } };
  for (const [t, r, l, b] of cards) {
    const added = addHeroCard(s, t, r, { level: l ?? 1 });
    s = b ? { ...added.save, heroes: added.save.heroes.map((h) => (h.id === added.hero.id ? { ...h, branch: b } : h)) } : added.save;
  }
  return s;
}

describe('вознесение: одна дорожка, копии того же героя', () => {
  // Решение владельца (пакет V3): пирамида «3 одинаковые = следующая редкость» — герой + 2 копии той же редкости до золотого.
  it('правила data/cards.json: 2 зелёные / 2 синие + ветка / 2 фиолетовые / 1 своя + 2 любые фиолетовые', () => {
    expect(ctx.cards.merge.map((m) => [m.from, m.to, m.fodder.map((f) => `${f.count}×${f.kind}:${f.rarity}`).join('+'), !!m.branch])).toEqual([
      ['green', 'blue', '2×same:green', false],
      ['blue', 'purple', '2×same:blue', true],
      ['purple', 'gold', '2×same:purple', false],
      ['gold', 'red', '1×same:purple+2×any:purple', false],
    ]);
  });

  it('зелёный → синий: +2 зелёные копии; золото; уровень цели сохраняется; вложенное в корм возвращается', () => {
    // h4 — цель, h5/h6 — корм (одна прокачана до 5 и в экипировке).
    let s = withCards([['iris', 'green', 12], ['iris', 'green', 5], ['iris', 'green']]);
    s = { ...s, inventory: { items: [{ id: 'it1', itemId: 'knife', equippedBy: 'h5' }] } };
    const req = ascendRequirement(s, 'h4', ctx)!;
    expect(req).toMatchObject({ from: 'green', to: 'blue', gold: gold('green'), branch: false, blockers: [] });
    expect(req.fodder).toEqual([{ kind: 'same', rarity: 'green', count: 2, candidates: ['h6', 'h5'] }]);
    expect(autoFodder(s, 'h4', ctx)).toEqual(['h6', 'h5']);
    expect(canAscend(s, 'h4', ctx)).toBe(true);
    const r = ascendHero(s, 'h4', ['h5', 'h6'], ctx);
    expect(r.save.heroes.find((h) => h.id === 'h4')).toMatchObject({ rarity: 'blue', level: 12 });
    expect(r.save.heroes.some((h) => h.id === 'h5' || h.id === 'h6')).toBe(false);
    expect(r.refund).toEqual(levelRangeCost(1, 5, ctx));
    expect(r.save.resources).toEqual({ gold: 1_000_000 - gold('green') + r.refund.gold, heroExp: r.refund.exp });
    expect(r.save.inventory.items[0].equippedBy).toBeNull();
    expect(r.events).toEqual([{ type: 'ascended', heroId: 'h4', from: 'green', to: 'blue', job: 'swordman', jobChanged: false }]);
    expect(r.consumed.sort()).toEqual(['h5', 'h6']);
  });

  it('RN-02: догоняющие уровни сюжетного героя (grantedLevel) при отдаче в корм не возвращаются', () => {
    let s = withCards([['iris', 'green', 12], ['iris', 'green']]);
    const gift = addHeroCard(s, 'iris', 'green', { level: 8, granted: true });
    expect(gift.hero).toMatchObject({ level: 8, grantedLevel: 8 });
    // Дар подкачали до 10 — вернётся только оплаченное 8 → 10.
    s = { ...gift.save, heroes: gift.save.heroes.map((h) => (h.id === gift.hero.id ? { ...h, level: 10 } : h)) };
    const r = ascendHero(s, 'h4', ['h5', gift.hero.id], ctx);
    expect(r.refund).toEqual(levelRangeCost(8, 10, ctx));
  });

  it('RN-02: catchUpLevel — средний уровень отряда в пределах редкости', () => {
    const s = newGame(ctx, 0);
    const lv = (levels: number[]) => ({ ...s, heroes: s.heroes.map((h, i) => ({ ...h, level: levels[i] })) });
    expect(catchUpLevel(s, 'green', ctx)).toBe(1);
    expect(catchUpLevel(lv([5, 6, 8]), 'green', ctx)).toBe(6);
    expect(catchUpLevel(lv([40, 40, 41]), 'green', ctx)).toBe(20);
    expect(catchUpLevel({ ...s, squad: [null, null, null, null, null] }, 'green', ctx)).toBe(1);
  });

  it('сюжетный герой — как все: копия Алана — корм, цель (Алан из отряда) не тратится', () => {
    const s = withCards([['alan', 'green'], ['alan', 'green', 3]]);
    // Копии в отряде нет — корм; h1 (Алан в отряде) — цель.
    expect(fodderBlocker(s, 'h4', ctx)).toBeNull();
    expect(fodderBlocker(s, 'h1', ctx)).toMatch(/в отряде/);
    const r = ascendHero(s, 'h1', autoFodder(s, 'h1', ctx)!, ctx);
    expect(r.save.heroes.filter((h) => h.templateId === 'alan').map((h) => [h.id, h.rarity])).toEqual([['h1', 'blue']]);
    // Нельзя отдать себя в корм.
    expect(codeOf(() => ascendHero(s, 'h4', ['h4', 'h5'], ctx))).toBe('bad_fodder');
  });

  it('синий → фиолетовый: 2 синие копии + выбор ветки (branch_required, чужая ветка — bad_branch); навыки ветки — сразу', () => {
    const s = withCards([['kai', 'blue', 35], ['kai', 'blue'], ['kai', 'blue', 2], ['lira', 'blue']]);
    const req = ascendRequirement(s, 'h4', ctx)!;
    expect(req.branch).toBe(true);
    expect(req.branches!.map((b) => b.job)).toEqual(['wizard', 'sage']);
    // Синяя копия другого героя не подходит («та же»).
    expect(req.fodder[0].candidates.sort()).toEqual(['h5', 'h6']);
    const fodder = autoFodder(s, 'h4', ctx)!;
    expect(codeOf(() => ascendHero(s, 'h4', fodder, ctx))).toBe('branch_required');
    expect(codeOf(() => ascendHero(s, 'h4', fodder, ctx, { branch: 'knight' }))).toBe('bad_branch');
    expect(codeOf(() => ascendHero(s, 'h4', ['h5', 'h7'], ctx, { branch: 'sage' }))).toBe('bad_fodder');
    const r = ascendHero(s, 'h4', fodder, ctx, { branch: 'sage' });
    const kai = r.save.heroes.find((h) => h.id === 'h4')!;
    expect(kai).toMatchObject({ rarity: 'purple', level: 35, branch: 'sage' });
    expect(heroCard(kai, ctx)).toMatchObject({ job: 'sage', jobName: 'Мудрец' });
    expect(r.events[0]).toEqual({ type: 'ascended', heroId: 'h4', from: 'blue', to: 'purple', job: 'sage', jobChanged: true });
    expect(r.events).toContainEqual({ type: 'branchChosen', heroId: 'h4', branch: 'sage', changed: false, gems: 0 });
    // Навыки формы, открытые на ур. 35: 1, 10, 30.
    expect(r.events.filter((e) => e.type === 'skillUnlocked').map((e) => (e.type === 'skillUnlocked' ? e.level : 0))).toEqual([1, 10, 30]);
  });

  it('фиолетовый → золотой: 2 фиолетовые копии любой ветки или без ветки; ветка цели сохраняется', () => {
    const s = withCards([['teo', 'purple', 60, 'monk'], ['teo', 'purple', 1, 'priest'], ['teo', 'purple']]);
    expect(ascendRequirement(s, 'h4', ctx)!.fodder[0].candidates.sort()).toEqual(['h5', 'h6']);
    expect(codeOf(() => ascendHero(s, 'h4', ['h6'], ctx))).toBe('bad_fodder');
    const r = ascendHero(s, 'h4', ['h5', 'h6'], ctx);
    expect(r.save.heroes.find((h) => h.id === 'h4')).toMatchObject({ rarity: 'gold', branch: 'monk' });
    expect(r.events).toEqual([{ type: 'ascended', heroId: 'h4', from: 'purple', to: 'gold', job: 'monk', jobChanged: false }]);
    // Вознесением ветку не сменить (смена — changeBranch), а ниже фиолетового она не ставится.
    expect(ascendHero(s, 'h4', ['h5', 'h6'], ctx, { branch: 'priest' }).save.heroes.find((h) => h.id === 'h4')!.branch).toBe('monk');
    const g = withCards([['teo', 'green'], ['teo', 'green'], ['teo', 'green']]);
    expect(ascendHero(g, 'h4', ['h5', 'h6'], ctx, { branch: 'priest' }).save.heroes.find((h) => h.id === 'h4')!.branch).toBeUndefined();
  });

  it('золотой → красный: 1 своя фиолетовая + 2 фиолетовые любых героев («любая» — сначала другие герои)', () => {
    const s = withCards([['otto', 'gold', 80, 'blacksmith'], ['otto', 'purple'], ['greta', 'purple'], ['kai', 'purple'], ['otto', 'purple']]);
    const req = ascendRequirement(s, 'h4', ctx)!;
    expect(req.fodder.map((f) => [f.kind, f.rarity, f.count])).toEqual([
      ['same', 'purple', 1],
      ['any', 'purple', 2],
    ]);
    const pick = autoFodder(s, 'h4', ctx)!;
    expect(pick).toHaveLength(3);
    // «Та же» — копия Отто; «любые» — Грета и Кай (не вторая копия Отто).
    expect(pick.filter((id) => s.heroes.find((h) => h.id === id)!.templateId === 'otto')).toHaveLength(1);
    const r = ascendHero(s, 'h4', pick, ctx);
    expect(r.save.heroes.find((h) => h.id === 'h4')!.rarity).toBe('red');
    // Не хватает «той же» — любые три фиолетовые не подходят.
    const noSame = withCards([['otto', 'gold', 80, 'alchemist'], ['greta', 'purple'], ['kai', 'purple'], ['lira', 'purple']]);
    expect(autoFodder(noSame, 'h4', ctx)).toBeNull();
    expect(codeOf(() => ascendHero(noSame, 'h4', ['h5', 'h6', 'h7'], ctx))).toBe('bad_fodder');
    expect(codeOf(() => ascendHero(r.save, 'h4', [], ctx))).toBe('max_rarity');
  });

  it('корм ровно нужной редкости; занятые экземпляры (замок, отряд, пресет, экспедиция) — fodder_busy', () => {
    const s = withCards([['zara', 'green'], ['zara', 'blue'], ['zara', 'green'], ['zara', 'green']]);
    // Синяя копия в зелёный слот — нельзя.
    expect(codeOf(() => ascendHero(s, 'h4', ['h5', 'h6'], ctx))).toBe('bad_fodder');
    const locked: SaveState = { ...s, heroes: s.heroes.map((h) => (h.id === 'h6' ? { ...h, locked: true } : h)) };
    expect(codeOf(() => ascendHero(locked, 'h4', ['h6', 'h7'], ctx))).toBe('fodder_busy');
    const inSquad: SaveState = { ...s, squad: ['h6', null, null, null, null] };
    expect(codeOf(() => ascendHero(inSquad, 'h4', ['h6', 'h7'], ctx))).toBe('fodder_busy');
    const inPreset: SaveState = { ...s, presets: [{ id: 'p1', name: 'x', squad: ['h7', null, null, null, null] }] };
    expect(codeOf(() => ascendHero(inPreset, 'h4', ['h6', 'h7'], ctx))).toBe('fodder_busy');
    const away: SaveState = { ...s, bounties: { active: [{ location: 'ant_hell', hours: 1, heroIds: ['h7'], power: 1, startedAt: 0, endsAt: 1, rewards: { gold: 0, jobExp: 0, gems: 0, heroCards: { blue: 0, purple: 0 }, scrolls: 0, items: [] } }] } };
    expect(fodderBlocker(away, 'h7', ctx)).toMatch(/в экспедиции/);
    expect(codeOf(() => ascendHero({ ...s, resources: { gold: 0, heroExp: 0 } }, 'h4', ['h6', 'h7'], ctx))).toBe('not_enough_gold');
    expect(codeOf(() => ascendHero(s, 'ghost', [], ctx))).toBe('unknown_hero');
  });

  it('«Авто» с цепочкой: 3 зелёные копии сливаются в синюю, чтобы закрыть слот синей копии', () => {
    // Мэйлин синяя (цель) + синяя копия + 3 зелёные копии: на второй синий слот — цепочка.
    const s = withCards([['meilin', 'blue', 30], ['meilin', 'blue'], ['meilin', 'green'], ['meilin', 'green'], ['meilin', 'green', 4]]);
    expect(ascendPlan(s, 'h4', ctx)).toMatchObject({ complete: false, missing: 1 });
    const steps = autoChain(s, 'h4', ctx);
    expect(steps).toHaveLength(1);
    expect(steps[0].targetId).toBe('h8'); // сильнейшая зелёная копия — цель цепочки
    let cur = s;
    for (const st of steps) cur = ascendHero(cur, st.targetId, st.fodderIds, ctx).save;
    expect(ascendPlan(cur, 'h4', ctx)).toMatchObject({ complete: true, missing: 0 });
    const r = ascendHero(cur, 'h4', autoFodder(cur, 'h4', ctx)!, ctx, { branch: 'dancer' });
    expect(r.save.heroes.find((h) => h.id === 'h4')).toMatchObject({ rarity: 'purple', branch: 'dancer' });
    expect(r.save.heroes.filter((h) => h.templateId === 'meilin')).toHaveLength(1);
    // Нечего сливать — пусто.
    expect(autoChain(withCards([['meilin', 'blue']]), 'h4', ctx)).toEqual([]);
  });
});

describe('ветка второй профессии: выбор и смена', () => {
  it('фиолетовый без ветки: выбор бесплатный, один раз; ниже фиолетового — нельзя', () => {
    const s = withCards([['lira', 'purple', 45], ['lira', 'blue']]);
    expect(branchStatus(s, 'h4', ctx)).toMatchObject({ canChoose: true, canChange: false });
    expect(codeOf(() => chooseBranch(s, 'h5', 'wizard', ctx))).toBe('branch_locked');
    expect(codeOf(() => chooseBranch(s, 'h4', 'knight', ctx))).toBe('bad_branch');
    const r = chooseBranch(s, 'h4', 'wizard', ctx);
    expect(r.save.heroes.find((h) => h.id === 'h4')).toMatchObject({ branch: 'wizard' });
    expect(r.save.currency).toEqual(s.currency);
    expect(r.events).toEqual([{ type: 'branchChosen', heroId: 'h4', branch: 'wizard', changed: false, gems: 0 }]);
    expect(codeOf(() => chooseBranch(r.save, 'h4', 'sage', ctx))).toBe('branch_locked');
  });

  it('смена: первая бесплатно, дальше 300 гемов; нехватка гемов — без изменений', () => {
    expect(ctx.cards.branchChange).toEqual({ gems: 300, firstFree: true });
    let s = withCards([['dorn', 'purple', 50, 'assassin']]);
    s = { ...s, currency: { ...s.currency, gems: 500 } };
    expect(branchChangeCost(s.heroes[3], ctx)).toBe(0);
    const first = changeBranch(s, 'h4', 'rogue', ctx);
    expect(first.gems).toBe(0);
    expect(first.save.currency.gems).toBe(500);
    expect(first.save.heroes[3]).toMatchObject({ branch: 'rogue', branchChanges: 1 });
    expect(first.events).toEqual([{ type: 'branchChosen', heroId: 'h4', branch: 'rogue', changed: true, gems: 0 }]);
    expect(branchStatus(first.save, 'h4', ctx)).toMatchObject({ canChange: true, changeCost: 300, changeFree: false });
    const second = changeBranch(first.save, 'h4', 'assassin', ctx);
    expect(second.save.currency.gems).toBe(200);
    expect(second.save.heroes[3]).toMatchObject({ branch: 'assassin', branchChanges: 2 });
    // Не хватает гемов — HeroError, сохранение то же.
    expect(codeOf(() => changeBranch(second.save, 'h4', 'rogue', ctx))).toBe('not_enough_gems');
    // Та же ветка / чужая / без ветки.
    expect(codeOf(() => changeBranch(second.save, 'h4', 'assassin', ctx))).toBe('bad_branch');
    expect(codeOf(() => changeBranch(second.save, 'h4', 'knight', ctx))).toBe('bad_branch');
    expect(codeOf(() => changeBranch(withCards([['dorn', 'purple']]), 'h4', 'rogue', ctx))).toBe('branch_locked');
  });

  it('уровень, редкость и экипировка сохраняются; вещь, которую новая ветка носить не может, — в инвентарь', () => {
    // Искусственный предмет только для Ассасина: у Разбойника он снимается.
    const ectx = { ...ctx, equipment: { ...ctx.equipment, items: { ...ctx.equipment.items, katar_only: { ...ctx.equipment.items.knife, id: 'katar_only', jobs: ['assassin'] } } } };
    const s0 = withCards([['zara', 'purple', 55, 'assassin']]);
    const s: SaveState = { ...s0, inventory: { items: [{ id: 'i1', itemId: 'katar_only', equippedBy: 'h4' }, { id: 'i2', itemId: 'knife', equippedBy: 'h4' }] } };
    const r = changeBranch(s, 'h4', 'rogue', ectx);
    expect(r.save.heroes[3]).toMatchObject({ rarity: 'purple', level: 55, branch: 'rogue' });
    expect(r.save.inventory.items).toEqual([
      { id: 'i1', itemId: 'katar_only', equippedBy: null },
      { id: 'i2', itemId: 'knife', equippedBy: 'h4' },
    ]);
  });
});

describe('карты героя из наград (случайный герой нужной редкости)', () => {
  it('этап: первое прохождение — шанс синей, босс главы — больше; повтор — редко', () => {
    const c = ctx.cards.heroCards;
    expect(stageCardDrop({ boss: false }, true, ctx)).toEqual(c.firstClear);
    expect(stageCardDrop({ boss: true }, true, ctx)).toEqual(c.bossFirstClear);
    expect(stageCardDrop({ boss: false }, false, ctx)).toEqual(c.replay);
    expect(c.bossFirstClear.blue!).toBeGreaterThan(c.firstClear.blue!);
  });

  it('rollHeroCards: целая часть — точно, дробная — шанс; герои — случайные из 12; один seed — одна выдача', () => {
    const two = rollHeroCards({ blue: 2, purple: 1 }, cardRng(7), ctx);
    expect(two.map((c) => c.rarity)).toEqual(['blue', 'blue', 'purple']);
    expect(rollHeroCards({ blue: 2, purple: 1 }, cardRng(7), ctx)).toEqual(two);
    let n = 0;
    const seen = new Set<string>();
    for (let k = 0; k < 4000; k++) {
      const cards = rollHeroCards({ blue: 0.25 }, cardRng(k), ctx);
      n += cards.length;
      for (const c of cards) seen.add(c.templateId);
    }
    expect(n / 4000).toBeGreaterThan(0.22);
    expect(n / 4000).toBeLessThan(0.28);
    expect(seen.size).toBe(12);
  });

  it('первая победа на этапе: выпавшие карты — новые экземпляры с «Новый!» (без ветки)', () => {
    let s = newGame(ctx, 0);
    let got = 0;
    for (let seed = 1; seed < 400 && !got; seed++) {
      const out = playStage(s, ctx.content.stages[0].id, seed, ctx);
      if (out.result.winner !== 'A') continue;
      const cards = out.events.filter((e) => e.type === 'heroCard');
      if (!cards.length) continue;
      got = cards.length;
      const added = out.save.heroes.slice(s.heroes.length);
      expect(added).toHaveLength(cards.length);
      for (const h of added) expect(h).toMatchObject({ rarity: 'blue', level: 1, isNew: true });
      s = out.save;
    }
    expect(got).toBeGreaterThan(0);
  });
});

describe('«Контракт героя» (награда события)', () => {
  it('выдача → отложен в pendingPicks; выбор героя и ветки → фиолетовый экземпляр; повтор — unknown_pick', () => {
    const s0 = newGame(ctx, 0);
    const g = grantRewards(s0, { heroPicks: [{ rarity: 'purple' }] }, ctx, 'login_7');
    expect(g.save.pendingPicks).toEqual([{ rarity: 'purple', source: 'login_7' }]);
    expect(g.events).toContainEqual({ type: 'heroPick', rarity: 'purple', source: 'login_7' });
    expect(pickOptions({ rarity: 'purple' }, ctx)).toHaveLength(12);
    expect(codeOf(() => claimHeroPick(g.save, 0, 'meilin', undefined, ctx))).toBe('branch_required');
    expect(codeOf(() => claimHeroPick(g.save, 0, 'meilin', 'bard', ctx))).toBe('bad_branch');
    expect(codeOf(() => claimHeroPick(g.save, 0, 'nobody', 'hunter', ctx))).toBe('unknown_hero');
    const r = claimHeroPick(g.save, 0, 'meilin', 'dancer', ctx);
    const h = r.save.heroes.find((x) => x.id === r.heroId)!;
    expect(h).toMatchObject({ templateId: 'meilin', rarity: 'purple', level: 1, branch: 'dancer', isNew: true });
    expect(r.save.pendingPicks).toBeUndefined();
    expect(r.events[0]).toMatchObject({ type: 'heroCard', templateId: 'meilin', rarity: 'purple' });
    expect(codeOf(() => claimHeroPick(r.save, 0, 'meilin', 'dancer', ctx))).toBe('unknown_pick');
  });

  it('несколько контрактов — берутся по одному, остальные ждут; старое «heroes: [id]» — зелёная карточка героя', () => {
    const s0 = newGame(ctx, 0);
    const g = grantRewards(s0, { heroPicks: [{ rarity: 'purple' }, { rarity: 'purple' }], heroes: ['iris'] }, ctx, 'newbie_180');
    expect(g.save.heroes.at(-1)).toMatchObject({ templateId: 'iris', rarity: 'green' });
    const r = claimHeroPick(g.save, 1, 'vika', 'priest', ctx);
    expect(r.save.pendingPicks).toEqual([{ rarity: 'purple', source: 'newbie_180' }]);
  });

  it('данные событий: 7-й день входа и 180 очков новичка — «Контракт героя» (фиолетовый)', () => {
    const login7 = ctx.events.login.days[6];
    expect(login7.rewards.heroPicks).toEqual([{ rarity: 'purple' }]);
    const m180 = ctx.events.newbie.milestones.find((m) => m.points === 180)!;
    expect(m180.rewards.heroPicks).toEqual([{ rarity: 'purple' }]);
  });
});
