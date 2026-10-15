import { describe, expect, it } from 'vitest';
import { addHeroCard, addHeroExp, ascendRequirement, autoFodder, branchOptions, cardStats, groupDigits, heroCard, heroTemplate, jobTitle, levelUpHero, levelUpInfo, newGame, resetHeroLevel, type SaveState } from '../src/core';
import {
  ascendButtonState,
  ascendHint,
  ascendPower,
  ascendPreview,
  fodderOptions,
  fodderSlotCaption,
  needsBranchPick,
  ascendReadyWith,
  browseNeighbours,
  collectionCount,
  collectionHeroes,
  fodderSlotLabel,
  fodderSlots,
  levelShortage,
  matchesFilter,
  missingTemplates,
  nextLevelDelta,
  placeFodder,
  copySources,
  copyCounter,
  groupCopies,
  skillRarityGate,
  sortHeroes,
  valuableFodder,
} from '../src/game/heroesView';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();

function rich(): SaveState {
  let s = newGame(ctx, 1_700_000_000_000);
  const add = (t: string, r: 'green' | 'blue' | 'purple' | 'gold' | 'red', level: number) => {
    // Уровни в этом наборе подарены: оплаченная тренировка защищает копию до явного возврата ресурсов.
    s = addHeroCard(s, t, r, { level, granted: true }).save;
  };
  add('iris', 'green', 12);
  add('iris', 'green', 1);
  add('iris', 'green', 3);
  add('kai', 'blue', 25);
  add('meilin', 'purple', 44);
  add('lira', 'red', 90);
  return { ...s, resources: { ...s.resources, gold: 1_000_000 } };
}

/**
 * rich() + две синие копии Кая (ур. 1 и 3, подаренные): после пересмотра 10.10 слоты «та же» есть только у синий →
 * фиолетовый (3 одинаковых синих) и золотой → красный; зелёный → синий — «любой» зелёный.
 */
function richKai(): SaveState {
  let s = rich();
  for (const level of [1, 3]) s = addHeroCard(s, 'kai', 'blue', { level, granted: true }).save;
  return s;
}

describe('H4 «Герои»: коллекция', () => {
  it('фильтр по линии, роли и редкости', () => {
    const s = rich();
    const by = (f: Parameters<typeof matchesFilter>[1]) => s.heroes.filter((h) => matchesFilter(h, f, ctx)).map((h) => h.templateId);
    expect(by({ line: 'swordman', role: null, rarity: null }).sort()).toEqual(['alan', 'iris', 'iris', 'iris']);
    expect(by({ line: null, role: 'tank', rarity: null })).toEqual(['alan']);
    expect(by({ line: null, role: null, rarity: 'red' })).toEqual(['lira']);
    expect(by({ line: 'archer', role: 'damage', rarity: 'green' })).toEqual(['bran']);
  });

  it('сортировка: по выбранному ключу по убыванию, дальше — редкость, уровень, имя', () => {
    const s = rich();
    const lvl = sortHeroes(s.heroes, 'level', ctx, () => 0).map((h) => h.level);
    expect(lvl).toEqual([...lvl].sort((a, b) => b - a));
    const rar = sortHeroes(s.heroes, 'rarity', ctx, () => 0).map((h) => h.templateId);
    expect(rar[0]).toBe('lira');
    expect(rar[1]).toBe('meilin');
    const pow = sortHeroes(s.heroes, 'power', ctx, (h) => (h.templateId === 'kai' ? 1e9 : h.level));
    expect(pow[0].templateId).toBe('kai');
    // Детерминированно: одинаковые ключи — стабильный порядок по имени и id.
    expect(sortHeroes(s.heroes, 'power', ctx, () => 1).map((h) => h.id)).toEqual(sortHeroes([...s.heroes].reverse(), 'power', ctx, () => 1).map((h) => h.id));
  });

  it('коллекция: неполученные шаблоны — сначала сюжетные по порядку, счётчик', () => {
    const s = rich();
    const miss = missingTemplates(s, { line: null, role: null, rarity: null }, ctx);
    expect(miss).not.toContain('iris');
    expect(miss[0]).toBe('greta');
    expect(miss).toContain('dorn');
    const c = collectionCount(s, ctx);
    expect(c.total).toBe(Object.keys(ctx.content.heroes).length);
    expect(c.owned).toBe(new Set(s.heroes.map((h) => h.templateId)).size);
    expect(collectionHeroes(s, { line: null, role: null, rarity: null }, 'power', ctx, () => 0)).toHaveLength(s.heroes.length);
  });

  it('листание по кругу и пропуск удалённых карточек', () => {
    const alive = (id: string) => id !== 'x';
    expect(browseNeighbours(['a', 'b', 'c'], 'a', alive)).toEqual({ prev: 'c', next: 'b' });
    expect(browseNeighbours(['a', 'x', 'c'], 'c', alive)).toEqual({ prev: 'a', next: 'a' });
    expect(browseNeighbours(['a'], 'a', alive)).toEqual({ prev: null, next: null });
    expect(browseNeighbours(['a', 'b'], 'z', alive)).toEqual({ prev: null, next: null });
  });
});

describe('H4 «Герой»: уровень и навыки', () => {
  it('прибавка статов за уровень; на пределе — null', () => {
    const s = rich();
    const iris = s.heroes.find((h) => h.templateId === 'iris' && h.level === 12)!;
    const d = nextLevelDelta(iris, ctx)!;
    expect(d.hp).toBeGreaterThan(0);
    expect(d.atk).toBeGreaterThanOrEqual(0);
    expect(nextLevelDelta({ ...iris, level: 20 }, ctx)).toBeNull();
  });

  it('«до уровня не хватает N»: опыта / золота / предел', () => {
    const s = newGame(ctx, 0);
    const h = s.heroes[0];
    const poor = { ...s, resources: { ...s.resources, heroExp: 0 } };
    expect(levelShortage(levelUpInfo(poor, h.id, ctx))).toMatch(/^до уровня не хватает \d+ опыта$/);
    const noGold = { ...addHeroExp(s, 10_000), resources: { ...addHeroExp(s, 10_000).resources, gold: 0 } };
    expect(levelShortage(levelUpInfo(noGold, h.id, ctx))).toMatch(/золота$/);
    const ok = { ...addHeroExp(s, 10_000), resources: { ...addHeroExp(s, 10_000).resources, gold: 10_000 } };
    expect(levelShortage(levelUpInfo(ok, h.id, ctx))).toBeNull();
    const capped = { ...s, heroes: s.heroes.map((x, i) => (i === 0 ? { ...x, level: 20 } : x)) };
    expect(levelShortage(levelUpInfo(capped, h.id, ctx))).toBe('Предел редкости — вознесите героя');
  });

  it('навык выше предела редкости — «нужен Синий»', () => {
    expect(skillRarityGate(10, 'green', ctx)).toBeNull();
    expect(skillRarityGate(30, 'green', ctx)?.rarity).toBe('blue');
    expect(skillRarityGate(50, 'green', ctx)?.rarity).toBe('purple');
    expect(skillRarityGate(50, 'purple', ctx)).toBeNull();
  });
});

describe('H4 «Вознесение»', () => {
  it('превью: предел, статы, ветка второй профессии (V1 — первая ветка героя)', () => {
    const s = newGame(ctx, 0);
    const alan = { ...s.heroes.find((h) => h.templateId === 'alan')!, rarity: 'blue' as const, level: 40 };
    const p = ascendPreview(alan, ctx, 'knight')!;
    expect(p.to).toBe('purple');
    expect(p.maxLevel).toEqual({ from: 40, to: 60 });
    expect(p.newJob).toBe('knight');
    expect(p.stats.to.hp).toBeGreaterThan(p.stats.from.hp);
    expect(p.newSkills.some((x) => x.now)).toBe(true);
    const iris = rich().heroes.find((h) => h.templateId === 'iris')!;
    const q = ascendPreview(iris, ctx)!;
    expect(q.newJob).toBeUndefined();
    expect(q.newSkills.every((x) => !x.now && x.level > 20 && x.level <= 40)).toBe(true);
    expect(ascendPreview({ ...iris, rarity: 'red' }, ctx)).toBeNull();
  });

  it('слоты корма: раскладка выбора и готовность', () => {
    // Пересмотр 10.10: зелёный → синий — один слот «любой» зелёный (было 2 «та же»).
    const s = richKai();
    const target = s.heroes.find((h) => h.templateId === 'iris' && h.level === 12)!;
    const req = ascendRequirement(s, target.id, ctx)!;
    expect(fodderSlots(req)).toHaveLength(1);
    expect(placeFodder(req, [])).toEqual([null]);
    const auto = autoFodder(s, target.id, ctx)!;
    expect(auto).toHaveLength(1);
    expect(placeFodder(req, auto).every(Boolean)).toBe(true);
    expect(ascendReadyWith(s, target.id, auto, ctx)).toBe(true);
    expect(ascendReadyWith(s, target.id, [], ctx)).toBe(false);
    expect(fodderSlotLabel(req.fodder[0], target, ctx)).toBe('Любой герой · Зелёный');
    expect(valuableFodder(s, auto)).toEqual([]);
    // «Та же» — синий → фиолетовый: два слота синих копий Кая; синие в корме — ценные (предупреждение).
    const kai = s.heroes.find((h) => h.templateId === 'kai' && h.level === 25)!;
    const kreq = ascendRequirement(s, kai.id, ctx)!;
    expect(fodderSlots(kreq)).toHaveLength(2);
    expect(placeFodder(kreq, [])).toEqual([null, null]);
    const kauto = autoFodder(s, kai.id, ctx)!;
    expect(placeFodder(kreq, kauto).every(Boolean)).toBe(true);
    expect(ascendReadyWith(s, kai.id, kauto, ctx)).toBe(true);
    expect(ascendReadyWith(s, kai.id, kauto.slice(0, 1), ctx)).toBe(false);
    expect(fodderSlotLabel(kreq.fodder[0], kai, ctx)).toBe('Кай · Синий');
    expect(valuableFodder(s, kauto)).toHaveLength(2);
  });

  it('экран вознесения: подписи слотов, выбор корма с метками занятых, причина неактивной кнопки', () => {
    // Пересмотр 10.10: два слота «та же» — у синий → фиолетовый (Кай и его синие копии), зелёный → синий — «любой».
    let s = richKai();
    const iris = s.heroes.find((h) => h.templateId === 'iris' && h.level === 12)!;
    const ireq = ascendRequirement(s, iris.id, ctx)!;
    expect(fodderSlotCaption(ireq.fodder[0], iris, ctx)).toEqual({ who: 'Любой', rarity: 'зелёный' });
    expect(ascendButtonState(s, iris.id, [], ctx).reason).toMatch(/ещё 1 карту/);
    const target = s.heroes.find((h) => h.templateId === 'kai' && h.level === 25)!;
    const weak = s.heroes.find((h) => h.templateId === 'kai' && h.level === 1)!;
    const mid = s.heroes.find((h) => h.templateId === 'kai' && h.level === 3)!;
    let req = ascendRequirement(s, target.id, ctx)!;
    expect(fodderSlotCaption(req.fodder[0], target, ctx)).toEqual({ who: 'Кай', rarity: 'синий' });
    expect(fodderSlotCaption({ kind: 'any', rarity: 'purple' }, target, ctx)).toEqual({ who: 'Любой', rarity: 'фиолетовый' });
    // Пусто — «положите ещё 2»; одна выбрана — «ещё 1»; обе — готово (ветку выбирают на этом же экране).
    expect(ascendButtonState(s, target.id, [], ctx).reason).toMatch(/ещё 2 карты/);
    expect(ascendButtonState(s, target.id, [weak.id], ctx).reason).toMatch(/ещё 1 карту/);
    expect(ascendButtonState(s, target.id, [weak.id, mid.id], ctx, { branchChosen: true })).toEqual({ ready: true, reason: null });
    // Копия в отряде: в выборе — последней, с меткой, и её не хватает на слот.
    s = { ...s, squad: [mid.id, null, null, null, null] };
    req = ascendRequirement(s, target.id, ctx)!;
    const opts = fodderOptions(s, req, 0, [weak.id]);
    expect(opts.map((o) => [o.id, o.tag, o.chosen])).toEqual([
      [weak.id, null, true],
      [mid.id, 'в отряде', false],
    ]);
    // Копия есть, но занята — причина называет, чем (раньше «Не хватает 1 карты» при трёх одинаковых картах в составе).
    expect(ascendButtonState(s, target.id, [weak.id], ctx).reason).toBe('Кай: копия стоит в отряде');
    // Спутник (первая карта героя) в корм не идёт — его возносят самого (отчёт тестера 15.10: «Тео-самозванец»).
    const comp = { ...s, squad: [null, null, null, null, null], heroes: s.heroes.map((h) => (h.id === mid.id ? { ...h, companion: true } : h)) };
    expect(ascendButtonState(comp, target.id, [weak.id], ctx).reason).toBe('Кай — спутник: возносите его самого');
    // Копий нет совсем — прежний текст.
    const none = { ...s, squad: [null, null, null, null, null], heroes: s.heroes.filter((h) => h.id !== mid.id) };
    expect(ascendButtonState(none, target.id, [weak.id], ctx).reason).toBe('Не хватает 1 карты: Кай, синий');
    // LT-07: подпись на карточке — точная причина (копии есть, не хватает золота). Синий → фиолетовый — 30 000 золота.
    const noGold = { ...s, squad: [null, null, null, null, null], resources: { ...s.resources, gold: 100 } };
    expect(ascendHint(noGold, target.id, ctx)).toEqual({ ready: false, text: `нужно ${groupDigits(30_000)} золота` });
    expect(ascendHint(s, target.id, ctx)?.text).toBe('нужны копии');
    expect(ascendHint({ ...noGold, resources: { ...s.resources } }, target.id, ctx)).toEqual({ ready: true, text: 'копии готовы!' });
    // Золото — после корма.
    const poor = { ...s, squad: [null, null, null, null, null], resources: { ...s.resources, gold: 100 } };
    expect(ascendButtonState(poor, target.id, [weak.id, mid.id], ctx).reason).toBe(`Не хватает золота: ${groupDigits(29_900)}`);
  });

  it('вознесение на фиолетовый: без выбранной ветки кнопка ждёт ветку; мощь «было → станет» растёт', () => {
    let s = newGame(ctx, 0);
    const add = (lv: number) => {
      const r = addHeroCard(s, 'alan', 'blue', { level: lv, granted: true });
      s = r.save;
      return r.hero;
    };
    const t = add(40);
    const f = [add(1).id, add(2).id];
    s = { ...s, resources: { ...s.resources, gold: 1_000_000 } };
    expect(ascendButtonState(s, t.id, f, ctx).reason).toBe('Выберите ветку второй профессии');
    expect(ascendButtonState(s, t.id, f, ctx, { branchChosen: true }).ready).toBe(true);
    const pw = ascendPower(t, ctx, (h) => cardStats(heroTemplate(ctx, h.templateId), h.level, h.rarity, ctx, h.branch).hp)!;
    expect(pw.to).toBeGreaterThan(pw.from);
  });

  it('золотой — большой скачок: статы ×1.35+ к фиолетовому (было ×1.16), красный ещё сильнее, навыки растут', () => {
    const r = Object.fromEntries(ctx.cards.rarities.map((x) => [x.id, x]));
    expect(r.gold.statMult / r.purple.statMult).toBeGreaterThanOrEqual(1.35);
    expect(r.gold.statMult / r.purple.statMult).toBeGreaterThan(r.purple.statMult / r.blue.statMult);
    expect(r.red.statMult).toBeGreaterThan(r.gold.statMult);
    expect(r.gold.skillPower).toBeGreaterThan(r.purple.skillPower);
    expect(r.red.skillPower).toBeGreaterThan(r.gold.skillPower);
  });

  it('откуда копии: Таверна, карты героя из наград', () => {
    const s = newGame(ctx, 0);
    const lines = copySources(s, 'alan', ctx);
    expect(lines.some((l) => l.includes('Таверна'))).toBe(true);
    expect(lines.some((l) => l.includes('Карты героя'))).toBe(true);
    // Доли — как в «Шансы и гарант» Таверны: редкий фиолетовый 0,5% не округляется до 0 или 1%.
    const tavern = lines.find((l) => l.includes('Таверна'))!;
    for (const r of ctx.summon.rates) expect(tavern).toContain(`${String(Math.round(r.chance * 1000) / 10).replace('.', ',')}%`);
  });

  it('у каждой ветки есть строка возвышения для показа выбора и вознесения', () => {
    for (const t of Object.values(ctx.content.heroes)) {
      for (const b of t.branches) expect(b.promotion, `${t.id} → ${b.job}`).toBeTruthy();
    }
  });

  it('у каждой ветки своя история (bio) — вкладка «История» после возвышения не остаётся с историей первой профессии', () => {
    for (const t of Object.values(ctx.content.heroes)) {
      for (const b of t.branches) {
        expect(b.bio, `${t.id} → ${b.job}`).toBeTruthy();
        expect(b.bio!.length, `${t.id} → ${b.job}`).toBeGreaterThan(60);
        expect(b.bio).not.toMatch(/TODO/);
      }
      // В карточке ветка отдаёт bio экранам.
      expect(branchOptions(t.id, ctx).every((v) => !!v.bio)).toBe(true);
    }
  });
});

describe('Герои v2 (V2): копии одной плиткой, счётчик копий, превью ветки', () => {
  it('groupCopies: одна плитка на героя — лучший экземпляр по порядку списка и число экземпляров', () => {
    const s = rich();
    const list = collectionHeroes(s, { line: null, role: null, rarity: null }, 'level', ctx, () => 0);
    const groups = groupCopies(list);
    const iris = groups.find((g) => g.hero.templateId === 'iris')!;
    expect(iris.copies).toBe(3);
    expect(iris.hero.level).toBe(12);
    expect(new Set(groups.map((g) => g.hero.templateId)).size).toBe(groups.length);
    expect(groups.reduce((n, g) => n + g.copies, 0)).toBe(list.length);
  });

  it('copyCounter: сколько копий героя и сколько подходящих в корм следующего вознесения', () => {
    // Пересмотр 10.10: счёт «к вознесению» — по слотам «та же» (синий → фиолетовый); у зелёного слот «любой» — только копии.
    const s = richKai();
    const best = s.heroes.find((h) => h.templateId === 'kai' && h.level === 25)!;
    const c = copyCounter(s, best.id, ctx);
    expect(c.others).toBe(2);
    expect(c.need).toBe(2);
    expect(c.have).toBe(2);
    expect(c.text).toBe('Копий: 2 · к вознесению 2/2');
    const iris = s.heroes.find((h) => h.templateId === 'iris' && h.level === 12)!;
    expect(copyCounter(s, iris.id, ctx)).toEqual({ others: 2, text: 'Копий: 2' });
    const lira = s.heroes.find((h) => h.templateId === 'lira')!;
    expect(copyCounter(s, lira.id, ctx).text).toBe('Копий: 0');
  });

  it('обученная копия остаётся в счётчике коллекции, но доступна для вознесения только после возврата ресурсов', () => {
    // Пересмотр 10.10: слоты «та же» — у синий → фиолетовый, поэтому проверяем на синих копиях Кая.
    let s = richKai();
    const target = s.heroes.find(h => h.templateId === 'kai' && h.level === 25)!;
    const copy = s.heroes.find(h => h.templateId === 'kai' && h.level === 1)!;
    s = addHeroExp(s, 10_000);
    s = levelUpHero(s, copy.id, ctx).save;
    expect(copyCounter(s, target.id, ctx)).toMatchObject({ others: 2, need: 2, have: 1 });
    expect(autoFodder(s, target.id, ctx)).toBeNull();
    s = resetHeroLevel(s, copy.id, ctx).save;
    expect(copyCounter(s, target.id, ctx)).toMatchObject({ others: 2, need: 2, have: 2 });
    expect(autoFodder(s, target.id, ctx)).toHaveLength(2);
  });

  it('своя плитка спутника сохраняется после возврата уровня, даже если его копия сильнее', () => {
    const s = rich();
    const personal = s.heroes.find(h => h.templateId === 'iris' && h.companion)!;
    const copy = s.heroes.find(h => h.templateId === 'iris' && h.level === 3)!;
    const heroes = [
      { ...copy, rarity: 'red' as const, level: 100 },
      { ...personal, level: 1, journey: { peakLevel: 12 } },
    ];
    const grouped = groupCopies(heroes);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ hero: { id: personal.id, companion: true, level: 1 }, copies: 2 });
    expect(grouped[0].ids).toEqual([copy.id, personal.id]);
  });

  it('лицо плитки — копия из отряда: в коллекции тот же герой, что стоит в отряде (не спутник и не сильнейший)', () => {
    const s = rich();
    const personal = s.heroes.find(h => h.templateId === 'iris' && h.companion)!;
    const copy = s.heroes.find(h => h.templateId === 'iris' && h.level === 3)!;
    const heroes = [{ ...personal }, { ...copy, rarity: 'blue' as const }];
    expect(groupCopies(heroes)[0].hero.id).toBe(personal.id);
    expect(groupCopies(heroes, [null, copy.id])[0]).toMatchObject({ hero: { id: copy.id, rarity: 'blue' }, copies: 2 });
  });

  it('ascendPreview: выбранная ветка на переходе синий → фиолетовый', () => {
    let s = rich();
    s = addHeroCard(s, 'alan', 'blue', { level: 40 }).save;
    const alan = s.heroes[s.heroes.length - 1];
    const t = ctx.content.heroes.alan;
    // LT-08: ветка не выбрана — превью не обещает профессию (без ветки героя не вознести, выбор — на экране).
    expect(ascendPreview(alan, ctx)!.newJob).toBeUndefined();
    expect(ascendPreview(alan, ctx, t.branches[1].job)!.newJob).toBe(t.branches[1].job);
    expect(ascendPreview(alan, ctx, 'no_such_job')!.newJob).toBeUndefined();
    // Фиолетовый без ветки (после «Вознести всех») → золотой: без выбора — без новой профессии; с выбором — ветка.
    const bare = { ...alan, rarity: 'purple' as const, level: 60 };
    expect(ascendPreview(bare, ctx)!.newJob).toBeUndefined();
    expect(ascendPreview(bare, ctx, t.branches[1].job)!.newJob).toBe(t.branches[1].job);
    expect(needsBranchPick(bare, 'gold')).toBe(true);
    expect(needsBranchPick({ branch: t.branches[0].job }, 'gold')).toBe(false);
    expect(needsBranchPick({}, 'blue')).toBe(false);
  });
});

describe('названия профессий по полу героя (MT-10)', () => {
  it('героини — женская форма (nameF), герои и профессии без nameF — обычное название', () => {
    expect(jobTitle(ctx, 'priest', 'f')).toBe('Жрица');
    expect(jobTitle(ctx, 'priest', 'm')).toBe('Жрец');
    expect(jobTitle(ctx, 'wizard', 'f')).toBe('Волшебница');
    expect(jobTitle(ctx, 'knight', 'f')).toBe(ctx.content.jobs.knight.name);
    expect(jobTitle(ctx, 'no_such_job', 'f')).toBe('no_such_job');
    const r = addHeroCard(newGame(ctx, 1_700_000_000_000), 'lira', 'purple', { level: 40 });
    expect(heroCard({ ...r.hero, branch: 'wizard' }, ctx).jobName).toBe('Волшебница');
    expect(branchOptions('meilin', ctx).map((b) => b.jobName)).toContain('Охотница');
    expect(branchOptions('bran', ctx).map((b) => b.jobName)).toContain('Охотник');
  });
});
