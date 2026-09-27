import { describe, expect, it } from 'vitest';
import {
  actEquipBest,
  addItems,
  arrangeSquad,
  changeJob,
  equip,
  gearUpgrades,
  heroesWithGearUpgrades,
  itemScore,
  misplacedInFront,
  newGame,
  type SaveState,
} from '../src/core';
import { decimal, defeatAdvice, expBankLabel, expBankNote, heroesBadgeCount, jobLevelText, keyEventsFirst } from '../src/game/flow';
import { pickHomeHint } from '../src/game/hints';
import { chapterSummary, isChapterFinale, playTimeText, sceneLabel, seenChapterScenes } from '../src/game/storyView';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const fresh = (): SaveState => newGame(ctx, 1_700_000_000_000);
const withJob = (save: SaveState, heroId: string, job: string): SaveState => {
  const h = save.heroes.find((x) => x.id === heroId)!;
  const r = changeJob({ ...h, jobLevel: 10, jobExp: 0 }, job, ctx);
  return { ...save, heroes: save.heroes.map((x) => (x.id === heroId ? r.hero : x)) };
};

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

  it('вещь не своей профессии не предлагается', () => {
    const { save } = addItems(fresh(), ['bow']);
    expect(gearUpgrades(save, save.heroes[0].id, ctx)).toEqual([]);
    const archer = withJob(save, save.heroes[1].id, 'archer');
    expect(gearUpgrades(archer, archer.heroes[1].id, ctx).map((u) => u.itemId)).toEqual(['bow']);
  });

  it('значок «Герои» считает героя один раз; подсказка «Наденьте трофеи» на главной', () => {
    const { save } = addItems(fresh(), ['cotton_shirt']);
    expect(heroesBadgeCount(save, ctx)).toBe(save.heroes.length);
    const none = () => false;
    const base = { cleared: 3, chestHasIncome: false, jobChangeReady: false, towerUnlocked: false };
    expect(pickHomeHint({ ...base, gearUpgrade: true }, none)).toBe('equip_gear');
    expect(pickHomeHint({ ...base, gearUpgrade: true, jobChangeReady: true }, none)).toBe('job_change');
    expect(pickHomeHint({ ...base, gearUpgrade: true }, (id) => id === 'equip_gear')).toBeNull();
  });
});

describe('P10 T1-20: расстановка по ролям', () => {
  it('лучник во фронте — misplaced; arrangeSquad уводит его в тыл, состав тот же', () => {
    let save = fresh();
    const [a, b, c] = save.heroes;
    save = withJob(withJob(withJob(save, a.id, 'swordman'), b.id, 'archer'), c.id, 'acolyte');
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
    save = withJob(withJob(save, a.id, 'archer'), b.id, 'mage');
    save = { ...save, squad: [a.id, b.id, null, null, null] };
    expect(misplacedInFront(save, ctx)).toEqual([]);
  });
});

describe('P10 T1-07: совет после поражения', () => {
  it('смена профессии советуется только когда доступна', () => {
    const save = fresh();
    expect(defeatAdvice(save, ctx).text).not.toMatch(/профессии/);
    const ready = { ...save, heroes: save.heroes.map((h) => ({ ...h, jobLevel: 10, jobExp: 0 })) };
    expect(defeatAdvice(ready, ctx).text).toMatch(/Смена профессии доступна/);
  });

  it('вещи получше — первым делом; стрелок во фронте — «Отряд»', () => {
    const { save } = addItems(fresh(), ['cotton_shirt']);
    expect(defeatAdvice(save, ctx)).toMatchObject({ action: 'Heroes' });
    let s = fresh();
    const [a, b] = s.heroes;
    s = withJob(withJob(s, a.id, 'swordman'), b.id, 'archer');
    s = { ...s, squad: [b.id, a.id, null, null, null] };
    expect(defeatAdvice(s, ctx)).toMatchObject({ action: 'Squad' });
  });
});

describe('P10: тексты и итоги', () => {
  it('T1-09: ключевые события первыми', () => {
    const lines = ['Открыт этап 3: Поляна', 'Алан: ур. профессии 2 → 3', 'Алан: новый навык «Удар»', 'Смена профессии доступна! (Алан)', 'Новый герой в отряде: Грета!'];
    expect(keyEventsFirst(lines)).toEqual([lines[4], lines[3], lines[2], lines[1], lines[0]]);
  });

  it('T1-23: «Ур. профессии», дроби через запятую', () => {
    expect(jobLevelText(4, 10)).toBe('Ур. профессии 4 / 10');
    expect(decimal(1.5)).toBe('1,5');
    expect(decimal(12.345, 1)).toBe('12,3');
  });

  it('T1-02: «опыт копится» на максимуме новичка, «запас полон» — предупреждение', () => {
    const save = fresh();
    expect(expBankNote(save, ctx)).toBeNull();
    const max = { ...save, heroes: save.heroes.map((h, i) => ({ ...h, jobLevel: 10, jobExp: 0, bankedExp: i === 0 ? 10 : 0 })) };
    const note = expBankNote(max, ctx)!;
    expect(note.full).toBe(false);
    expect(note.text).toMatch(/Опыт копится — смените профессию/);
    expect(expBankLabel(max.heroes[0], ctx)?.text).toMatch(/в запасе 10/);
    const full = { ...max, heroes: max.heroes.map((h) => ({ ...h, bankedExp: 1e9 })) };
    expect(expBankNote(full, ctx)?.full).toBe(true);
    expect(expBankLabel(full.heroes[0], ctx)?.full).toBe(true);
  });
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
      heroes: [...save.heroes, { id: 'h4', name: 'Грета', gender: 'f', job: 'novice', jobLevel: 1, jobExp: 0, jobHistory: [] }],
    };
    const sum = chapterSummary(done, ch1, ctx);
    expect(sum).toMatchObject({ number: 1, cleared: stages.length, stages: stages.length });
    expect(sum.gold).toBe(stages.reduce((a, s) => a + s.rewards.gold, 0));
    expect(sum.recruit?.name).toBe('Грета');
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
