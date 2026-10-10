import { describe, expect, it } from 'vitest';
import {
  actEquipBest,
  ascendPlan,
  addItems,
  arrangeSquad,
  equip,
  gearUpgrades,
  heroesWithGearUpgrades,
  itemScore,
  misplacedInFront,
  newGame,
  levelUpCost,
  maxLevelOf,
  type SaveState,
} from '../src/core';
import { ascendReady, decimal, defeatAdvice, equipBestSquad, squadGearUpgrades, squadAtLevelCap, heroesBadgeCount, keyEventsFirst, levelText } from '../src/game/flow';
import { pickHomeHint } from '../src/game/hints';
import { chapterSummary, isChapterFinale, playTimeText, sceneLabel, seenChapterScenes } from '../src/game/storyView';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const fresh = (): SaveState => newGame(ctx, 1_700_000_000_000);
/** Заменить карточку героя heroId на templateId (зелёная). */
const withCard = (save: SaveState, heroId: string, templateId: string): SaveState => ({
  ...save,
  heroes: save.heroes.map((x) => (x.id === heroId ? { ...x, templateId, rarity: 'green' } : x)),
});

describe('P10 T1-08: «Надеть лучшее»', () => {
  it('itemScore — веса мощи', () => {
    const k = ctx.features.power;
    expect(itemScore(ctx.equipment.items.cotton_shirt, k)).toBeCloseTo(60 * k.hp);
  });

  it('свободная вещь в пустом слоте — улучшение; после actEquipBest улучшений нет', () => {
    const { save } = addItems(fresh(), ['cotton_shirt', 'knife']);
    const hero = save.heroes[0];
    const ups = gearUpgrades(save, hero.id, ctx);
    // Нож и рубаха без ограничения по профессии — по одному на слот, в порядке слотов.
    expect(ups.map((u) => u.itemId)).toEqual(['knife', 'cotton_shirt']);
    expect(heroesWithGearUpgrades(save, ctx)).toContain(hero.id);
    const r = actEquipBest(save, hero.id, ctx);
    expect(r.equipped.length).toBe(ups.length);
    expect(r.save.inventory.items.find((i) => i.itemId === 'cotton_shirt')?.equippedBy).toBe(hero.id);
    expect(gearUpgrades(r.save, hero.id, ctx)).toEqual([]);
    expect(r.save.achievements.counters.items_equipped).toBe(ups.length);
  });

  it('лучшая из нескольких, слабее надетой — не предлагается, чужие вещи не берутся', () => {
    const a = addItems(fresh(), ['cotton_shirt', 'chain_mail']);
    const hero = a.save.heroes[0];
    expect(gearUpgrades(a.save, hero.id, ctx).find((u) => u.slot === 'armor')?.itemId).toBe('chain_mail');
    const mail = a.added.find((i) => i.itemId === 'chain_mail')!;
    const worn = equip(a.save, hero.id, mail.id, ctx);
    expect(gearUpgrades(worn, hero.id, ctx).some((u) => u.slot === 'armor')).toBe(false);
    // Кольчуга на первом герое — второму её не предлагаем, рубаху — да.
    const other = worn.heroes[1];
    expect(gearUpgrades(worn, other.id, ctx).find((u) => u.slot === 'armor')?.itemId).toBe('cotton_shirt');
  });

  it('вещь не своего класса не предлагается', () => {
    const { save } = addItems(fresh(), ['bow']);
    // Алан — Мечник: лук не его; Бран — Лучник.
    expect(gearUpgrades(save, save.heroes[0].id, ctx)).toEqual([]);
    expect(gearUpgrades(save, save.heroes[1].id, ctx).map((u) => u.itemId)).toEqual(['bow']);
  });

  it('«вещь получше» не зажигает точку «Герои» (§2.4 — это метка карточки); подсказка «Наденьте трофеи» на главной', () => {
    const { save } = addItems(fresh(), ['cotton_shirt']);
    const broke = { ...save, resources: { ...save.resources, heroExp: 0, gold: 0 } };
    expect(heroesBadgeCount(broke, ctx)).toBe(0);
    const none = () => false;
    const base = { cleared: 3, chestHasIncome: false, levelUpReady: false, towerUnlocked: false };
    expect(pickHomeHint({ ...base, gearUpgrade: true }, none)).toBe('equip_gear');
    expect(pickHomeHint({ ...base, gearUpgrade: true, levelUpReady: true }, none)).toBe('level_up');
    expect(pickHomeHint({ ...base, gearUpgrade: true }, (id) => id === 'equip_gear')).toBeNull();
  });
});

describe('P10 T1-20: расстановка по ролям', () => {
  it('лучник во фронте — misplaced; arrangeSquad уводит его в тыл, состав тот же', () => {
    // Алан — танк, Бран — лучник, Вика — лекарь.
    let save = fresh();
    const [a, b, c] = save.heroes;
    save = { ...save, squad: [a.id, b.id, c.id, null, null] };
    expect(misplacedInFront(save, ctx)).toEqual([b.id]);
    const squad = arrangeSquad(save, ctx);
    expect(squad[0]).toBe(a.id);
    expect(squad.slice(2).sort()).toEqual([b.id, c.id, null].sort());
    expect(squad[4]).toBe(c.id); // лекарь — в самом тылу
    expect(misplacedInFront({ ...save, squad }, ctx)).toEqual([]);
  });

  it('только стрелки — переставлять некуда, предупреждения нет', () => {
    let save = fresh();
    const [a, b] = save.heroes;
    save = withCard(save, a.id, 'kai');
    save = { ...save, squad: [a.id, b.id, null, null, null] };
    expect(misplacedInFront(save, ctx)).toEqual([]);
  });
});

describe('P10 T1-07: совет после поражения', () => {
  it('совет уровня требует и опыт, и золото: ровно на уровень хватает, на единицу меньше — нет', () => {
    const save = fresh();
    const cost = levelUpCost(1, ctx);
    for (const resources of [{ gold: cost.gold - 1, heroExp: cost.exp }, { gold: cost.gold, heroExp: cost.exp - 1 }]) {
      expect(defeatAdvice({ ...save, resources }, ctx).action).toBe('Campaign');
    }
    expect(defeatAdvice({ ...save, resources: { gold: cost.gold, heroExp: cost.exp } }, ctx).text).toContain('Опыта хватает');
  });

  it('вознесение только запасных не подменяет помощь отряду и не убирает метки в списке героев', () => {
    const save = fresh();
    // Пересмотр 10.10: зелёный → синий — 1 любой зелёный, так что зелёные запасные стали бы кормом для героев отряда;
    // запасные — три синие Ирис (синий → фиолетовый — только такие же копии, 30 000 золота).
    const bench: SaveState = {
      ...save, resources: { gold: 30_000, heroExp: 0 },
      heroes: [...save.heroes, ...[1, 2, 3].map((i) => ({ id: `reserve${i}`, templateId: 'iris', rarity: 'blue' as const, level: 1 }))],
    };
    expect(ascendReady(bench, ctx).map((h) => h.id)).toEqual(['reserve1', 'reserve2', 'reserve3']);
    expect(defeatAdvice(bench, ctx)).toMatchObject({ action: 'Squad' });
    expect(defeatAdvice(bench, ctx).text).toContain('пустые места');
  });

  it('копии под замком или в отряде и нехватка золота не дают ложного совета вознесения', () => {
    const save = fresh();
    // Пересмотр 10.10: зелёный → синий — одна зелёная копия (было две такие же).
    const copies: SaveState = {
      ...save, resources: { gold: 5000, heroExp: 0 },
      heroes: [...save.heroes, { id: 'copy1', templateId: 'alan', rarity: 'green' as const, level: 1 }],
    };
    expect(defeatAdvice(copies, ctx).text).toContain('вознесению');
    const locked = { ...copies, heroes: copies.heroes.map((h) => h.id === 'copy1' ? { ...h, locked: true } : h) };
    const assigned = { ...copies, squad: copies.squad.map((id, i) => i === 1 ? 'copy1' : id) };
    const poor = { ...copies, resources: { gold: 0, heroExp: 0 } };
    for (const blocked of [locked, assigned, poor]) expect(defeatAdvice(blocked, ctx).text).not.toContain('вознесению');
  });

  it('большинство на пределе не означает, что опыт больше никому не поможет', () => {
    const save = fresh();
    const partial: SaveState = { ...save, resources: { gold: 0, heroExp: 0 }, heroes: save.heroes.map((h, i) => ({ ...h, level: i < 2 ? maxLevelOf(ctx, h.rarity) : 1 })) };
    expect(squadAtLevelCap(partial, ctx)).toBe(false);
    expect(defeatAdvice(partial, ctx).action).toBe('Campaign');
    expect(defeatAdvice(partial, ctx).text).not.toContain('на пределе');
    expect(squadAtLevelCap({ ...partial, squad: [null, null, null, null, null] }, ctx)).toBe(false);
  });

  // Пересмотр 10.10: золотой → красный — 2 такие же фиолетовые (было 1 своя + 2 любые): одна копия не закрывает два
  // слота, фиолетовая другого героя не подходит.
  it('золотой → красный: одна копия не закрывает два слота «та же»; копия другого героя не подходит', () => {
    const save = fresh();
    const targetId = save.heroes[0].id;
    const two: SaveState = {
      ...save, resources: { gold: 60000, heroExp: 0 },
      heroes: [
        ...save.heroes.map((h) => h.id === targetId ? { ...h, rarity: 'gold' as const, level: maxLevelOf(ctx, 'gold') } : h),
        { id: 'same', templateId: 'alan', rarity: 'purple', level: 1 },
        { id: 'any1', templateId: 'iris', rarity: 'purple', level: 1 },
      ],
    };
    expect(ascendPlan(two, targetId, ctx)).toMatchObject({ complete: false, missing: 1 });
    expect(ascendReady(two, ctx).some((h) => h.id === targetId)).toBe(false);
    expect(defeatAdvice(two, ctx).text).not.toContain('готов к вознесению');
    // Вторая своя копия вместо чужой (иначе три свободные фиолетовые — уже корм «любой» фиолетовый → золотой для копии в отряде).
    const three: SaveState = { ...two, heroes: [...two.heroes.filter((h) => h.id !== 'any1'), { id: 'same2', templateId: 'alan', rarity: 'purple', level: 1 }] };
    expect(ascendPlan(three, targetId, ctx)).toMatchObject({ complete: true, missing: 0 });
    expect(ascendReady(three, ctx).some((h) => h.id === targetId)).toBe(true);
    expect(defeatAdvice(three, ctx).text).toContain('готов к вознесению');
    const locked = { ...three, heroes: three.heroes.map((h) => h.id === 'same2' ? { ...h, locked: true } : h) };
    const assigned = { ...three, squad: three.squad.map((id, i) => i === 1 ? 'same2' : id) };
    for (const blocked of [locked, assigned]) {
      expect(ascendReady(blocked, ctx).some((h) => h.id === targetId)).toBe(false);
      expect(defeatAdvice(blocked, ctx).text).not.toContain('готов к вознесению');
    }
  });

  it('на максимальной редкости и уровне не предлагает невозможное вознесение', () => {
    const save = fresh();
    const capped: SaveState = { ...save, resources: { gold: 1e7, heroExp: 1e8 }, heroes: save.heroes.map((h) => ({ ...h, rarity: 'red', level: maxLevelOf(ctx, 'red') })) };
    expect(squadAtLevelCap(capped, ctx)).toBe(true);
    expect(defeatAdvice(capped, ctx)).toMatchObject({ action: 'Squad' });
    expect(defeatAdvice(capped, ctx).text).not.toMatch(/копии|Вознести|Улучшить/);
  });

  it('«Улучшить» советуется, только когда опыта хватает; вознесение — когда хватает копий', () => {
    const save = fresh();
    expect(defeatAdvice(save, ctx).text).not.toMatch(/Опыта хватает/);
    const rich = { ...save, resources: { gold: 1000, heroExp: 1000 } };
    expect(defeatAdvice(rich, ctx)).toMatchObject({ action: 'Heroes' });
    expect(defeatAdvice(rich, ctx).text).toMatch(/Опыта хватает на новый уровень/);
    // Две зелёные копии Алана (герои v2: вознесение копиями).
    const copies = { ...save, resources: { gold: 5000, heroExp: 0 }, heroes: [...save.heroes, { id: 'h90', templateId: 'alan', rarity: 'green' as const, level: 1 }, { id: 'h91', templateId: 'alan', rarity: 'green' as const, level: 1 }] };
    expect(defeatAdvice(copies, ctx).text).toMatch(/вознесению/);
  });

  it('RR-02: отряд на пределе уровней редкостей — совет про копии и вознесение, а не «прокачайте»', () => {
    const save = fresh();
    const capped = { ...save, resources: { gold: 1e7, heroExp: 1e8 }, heroes: save.heroes.map((h) => ({ ...h, level: 20 })) };
    expect(defeatAdvice(capped, ctx)).toMatchObject({ action: 'Heroes' });
    expect(defeatAdvice(capped, ctx).text).toMatch(/пределе уровней.*копии.*Вознести/);
    expect(defeatAdvice(save, ctx).text).not.toMatch(/пределе уровней/);
  });

  it('вещи получше — первым делом; стрелок во фронте — «Отряд»', () => {
    const { save } = addItems(fresh(), ['cotton_shirt']);
    // RN-10: кнопка «Надеть лучшее» прямо на итогах (всему отряду).
    expect(defeatAdvice(save, ctx)).toMatchObject({ action: 'EquipBest' });
    const eq = equipBestSquad(save, ctx);
    expect(eq.equipped).toBeGreaterThan(0);
    expect(defeatAdvice(eq.save, ctx).action).not.toBe('EquipBest');
    // Вещь «получше» только для запасных (не в отряде) — совет её не считает.
    const bench = { ...save, squad: [null, null, null, null, null] as (string | null)[] };
    expect(squadGearUpgrades(bench, ctx)).toEqual([]);
    let s = fresh();
    const [a, b] = s.heroes;
    s = { ...s, squad: [b.id, a.id, null, null, null] };
    expect(defeatAdvice(s, ctx)).toMatchObject({ action: 'Squad' });
  });
});

describe('P10: тексты и итоги', () => {
  it('T1-09: ключевые события первыми', () => {
    const lines = ['Открыт этап 3: Поляна', 'Алан: ур. 2 → 3', 'Алан: новый навык «Удар»', 'Бран: Синий → Фиолетовый — теперь Охотник!', 'Новый герой в отряде: Грета!'];
    expect(keyEventsFirst(lines)).toEqual([lines[4], lines[3], lines[2], lines[1], lines[0]]);
  });

  it('T1-23: «Ур. 4 / 20», дроби через запятую', () => {
    expect(levelText(4, 20)).toBe('Ур. 4 / 20');
    expect(levelText(4)).toBe('Ур. 4');
    expect(decimal(1.5)).toBe('1,5');
    expect(decimal(12.345, 1)).toBe('12,3');
  });
  // T1-02 («опыт копится» на максимуме Новичка) снят вместе с Новичками: опыт всегда в общем пуле (docs/design/heroes.md).
});

describe('P10 T1-03: «Глава пройдена» и «История»', () => {
  const ch1 = ctx.content.chapters[0].id;
  const stages = ctx.content.stages.filter((s) => s.chapter === ch1);

  it('финал главы — «после этапа» на боссе; в авто не листается', () => {
    const outro = ctx.story.scenes.find((s) => s.id === 'ch1_outro')!;
    expect(isChapterFinale(outro, ctx)).toBe(true);
    const s4 = ctx.story.scenes.find((s) => s.trigger === 'afterStage' && s.id !== 'ch1_outro' && s.chapter === ch1)!;
    expect(isChapterFinale(s4, ctx)).toBe(false);
    expect(sceneLabel(outro, ctx)).toBe('Финал главы');
    expect(sceneLabel(ctx.story.scenes.find((s) => s.id === 'ch1_intro')!, ctx)).toBe('Вступление');
  });

  it('итоги главы: этапы, награды, рекрут Грета, следующая глава', () => {
    const save = fresh();
    const done: SaveState = {
      ...save,
      campaign: { cleared: stages.map((s) => s.id) },
      heroes: [...save.heroes, { id: 'h4', templateId: 'greta', rarity: 'green', level: 1 }],
    };
    const sum = chapterSummary(done, ch1, ctx);
    expect(sum).toMatchObject({ number: 1, cleared: stages.length, stages: stages.length });
    expect(sum.gold).toBe(stages.reduce((a, s) => a + s.rewards.gold, 0));
    expect(sum.recruit?.templateId).toBe('greta');
    expect(sum.next).toMatchObject({ index: 1, number: 2 });
  });

  it('«История» — только увиденные сцены главы, по порядку сюжета', () => {
    const save = { ...fresh(), seenScenes: ['ch1_outro', 'ch1_intro'] };
    expect(seenChapterScenes(save, ch1, ctx).map((s) => s.id)).toEqual(['ch1_intro', 'ch1_outro']);
  });

  it('время в пути', () => {
    expect(playTimeText(8 * 60000)).toBe('8 мин');
    expect(playTimeText(72 * 60000)).toBe('1 ч 12 мин');
  });
});
