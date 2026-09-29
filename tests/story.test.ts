import { describe, expect, it } from 'vitest';
import {
  buildGameContext,
  ContentError,
  deserialize,
  markScenesSeen,
  newGame,
  pendingScenes,
  serialize,
  type RawGameData,
  type SaveState,
} from '../src/core';
import { loadFullContext, readRawGameData } from '../scripts/lib/content-node';
import { speakerView } from '../src/game/storyView';

const ctx = loadFullContext();
const RAW = readRawGameData();
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const cleared = (save: SaveState, n: number): SaveState => ({
  ...save,
  campaign: { cleared: ctx.content.stages.slice(0, n).map((s) => s.id) },
});
/** Сколько этапов кампании стоит перед этапом id (глава 1 — 18 этапов, вставные ch1_s11…s18 между выпущенными). */
const before = (id: string) => ctx.content.stages.findIndex((s) => s.id === id);

/** Сюжет главы 1 с правкой — проблемы сборки. */
const problemsWith = (edit: (story: any) => void): string[] => {
  const raw: RawGameData = structuredClone(RAW);
  const f = raw.stories!.find((x) => x.file.endsWith('chapter1.json'))!;
  edit(f.data);
  try {
    buildGameContext(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ContentError);
    return (e as ContentError).problems;
  }
  return [];
};

describe('сюжет: данные', () => {
  it('data/story/chapter1.json загружается в контекст', () => {
    expect(ctx.story.chapters.chapter1).toBeDefined();
    const ch1 = ctx.story.scenes.filter((s) => s.chapter === 'chapter1');
    expect(ids(ch1)).toEqual([
      'ch1_intro',
      'ch1_s1_before',
      'ch1_s11_after',
      'ch1_s4_before',
      'ch1_s4_after',
      'ch1_s5_after',
      'ch1_s6_after',
      'ch1_s7_before',
      'ch1_s15_after',
      'ch1_s16_after',
      'ch1_s18_before',
      'ch1_s10_before',
      'ch1_outro',
    ]);
  });

  it('data/story/chapter2.json: вступление, сцена босса и знакомство с Дорном (QA T5-27)', () => {
    const ch2 = ctx.story.scenes.filter((s) => s.chapter === 'chapter2');
    // Маршрут из 10 глав (29.09, lore-route §4.2): слот 2 — Канализация Пронтеры, сцены с новым префиксом ch2c_ (старые ch2_*
    // Проклятых топей удалены из данных — в seenScenes остаются безвредным мусором). Слот 3 — Орочья деревня, сцены ch3o_*.
    // Раньше тест перечислял сцены топей и Гласт Хейма; порядок прохождения и привязка Дорна проверяются как прежде.
    expect(ids(ch2)).toEqual([
      'ch2c_intro',
      'ch2c_s1_before',
      'ch2c_s11_after',
      'ch2c_s2_after',
      'ch2c_s13_after',
      'ch2c_s14_before',
      'ch2c_s5_after',
      'ch2c_s15_after',
      'ch2c_s7_after',
      'ch2c_s17_after',
      'ch2c_s9_before',
      'ch2c_s10_before',
      'ch2c_outro',
    ]);
    expect(ids(ctx.story.scenes.filter((s) => s.chapter === 'chapter3'))).toEqual([
      'ch3o_intro',
      'ch3o_s11_after',
      'ch3o_s12_after',
      'ch3o_s3_after',
      'ch3o_s14_after',
      'ch3o_s15_before',
      'ch3o_s15_after',
      'ch3o_s16_after',
      'ch3o_s7_before',
      'ch3o_s18_after',
      'ch3o_s10_before',
      'ch3o_outro',
    ]);
    // Ни одной сцены со старыми id топей и Гласт Хейма в слотах 2–3 (они не должны «вернуться» под чужим содержимым).
    expect(ctx.story.scenes.filter((s) => /^ch[23]_/.test(s.id)).map((s) => s.id)).toEqual([]);
    // Сцены глав 2–3 идут в порядке прохождения этапов.
    for (const ch of ['chapter2', 'chapter3']) {
      const at = ctx.story.scenes.filter((s) => s.chapter === ch && s.stageId).map((s) => before(s.stageId!) + (s.trigger === 'afterStage' ? 0.5 : 0));
      expect(at, ch).toEqual([...at].sort((a, b) => a - b));
    }
    // Сцены перед боссом и мини-боссом представляют их (bossIntro — имя юнита).
    expect(ch2.find((s) => s.id === 'ch2c_s10_before')!.bossIntro?.title).toBe(ctx.content.units.sewer_golden_bug.name);
    const ch3 = ctx.story.scenes.filter((s) => s.chapter === 'chapter3');
    expect(ch3.find((s) => s.id === 'ch3o_s10_before')!.bossIntro?.title).toBe(ctx.content.units.orc_lord.name);
    const dorn = ctx.progression.heroes.recruits.find((r) => r.template === 'dorn')!;
    const outro = ch2.find((s) => s.id === 'ch2c_outro')!;
    expect(outro).toMatchObject({ trigger: 'afterStage', stageId: dorn.afterStage });
    expect(outro.lines.some((l) => ctx.story.chapters.chapter2.speakers[l.speaker].name === 'Дорн')).toBe(true);
    expect(ctx.story.scenes.every((s) => s.lines.every((l) => l.text.length <= 120))).toBe(true);
  });

  it('несуществующий этап и чужая глава — ошибки', () => {
    expect(problemsWith((s) => (s.scenes[1].stageId = 'ch1_s99')).join('\n')).toMatch(/этап ch1_s99 не найден/);
    expect(problemsWith((s) => (s.scenes[1].stageId = 'ch2_s1')).join('\n')).toMatch(/из главы chapter2/);
    expect(problemsWith((s) => (s.chapter = 'chapter9')).join('\n')).toMatch(/глава chapter9 не найдена/);
  });

  it('неизвестный спикер, длинная реплика, дубли — ошибки', () => {
    expect(problemsWith((s) => (s.scenes[0].lines[0].speaker = 'nobody')).join('\n')).toMatch(/спикер nobody не объявлен/);
    expect(problemsWith((s) => (s.scenes[0].lines[0].text = 'а'.repeat(121))).join('\n')).toMatch(/длиннее 120/);
    expect(problemsWith((s) => (s.scenes[2].id = 'ch1_intro')).join('\n')).toMatch(/id уже занят/);
    expect(problemsWith((s) => (s.scenes.find((x: { id: string }) => x.id === 'ch1_s4_before').stageId = 'ch1_s1')).join('\n')).toMatch(/вторая сцена beforeStage/);
  });

  it('stageId обязателен для before/afterStage, bossIntro — только у босс-этапа', () => {
    expect(problemsWith((s) => delete s.scenes[1].stageId).join('\n')).toMatch(/нужен stageId/);
    expect(problemsWith((s) => (s.scenes[1].bossIntro = { title: 'X' })).join('\n')).toMatch(/bossIntro/);
    expect(problemsWith((s) => (s.scenes[0].trigger = 'jobChange')).length).toBeGreaterThan(0);
  });
});

describe('сюжет глав 8 и 10 (перенос старых глав 3 и 7, story.md §5.8, §5.10)', () => {
  it('сцены ch8_* и ch10_* по библии, в порядке прохождения; баннер — только у босса, мини-боссы без него', () => {
    expect(ids(ctx.story.scenes.filter((s) => s.chapter === 'chapter8'))).toEqual([
      'ch8_intro',
      'ch8_s3_after',
      'ch8_s4_after',
      'ch8_s6_after',
      'ch8_s9_after',
      'ch8_s10_before',
      'ch8_s13_before',
      'ch8_s14_after',
      'ch8_s15_before',
      'ch8_s15_after',
      'ch8_s16_after',
      'ch8_s17_before',
      'ch8_s18_before',
      'ch8_outro',
    ]);
    expect(ids(ctx.story.scenes.filter((s) => s.chapter === 'chapter10'))).toEqual([
      'ch10_intro',
      'ch10_s1_after',
      'ch10_s3_after',
      'ch10_s4_before',
      'ch10_s6_after',
      'ch10_s7_after',
      'ch10_s8_after',
      'ch10_s9_before',
      'ch10_s12_before',
      'ch10_s13_after',
      'ch10_s14_after',
      'ch10_s16_after',
      'ch10_s17_before',
      'ch10_s18_before',
      'ch10_outro',
    ]);
    for (const ch of ['chapter8', 'chapter10']) {
      const scenes = ctx.story.scenes.filter((s) => s.chapter === ch);
      const at = scenes.filter((s) => s.stageId).map((s) => before(s.stageId!) + (s.trigger === 'afterStage' ? 0.5 : 0));
      expect(at, ch).toEqual([...at].sort((a, b) => a - b));
      const boss = ctx.content.stages.filter((s) => s.chapter === ch).at(-1)!.id;
      expect(scenes.filter((s) => s.bossIntro).map((s) => s.stageId), ch).toEqual([boss]);
    }
    expect(ctx.story.scenes.find((s) => s.id === 'ch8_s18_before')!.bossIntro?.title).toBe(ctx.content.units.mob7_boss.name);
    expect(ctx.story.scenes.find((s) => s.id === 'ch10_s18_before')!.bossIntro?.title).toBe(ctx.content.units.mob_lord_of_death.name);
  });

  it('новая нить: в главах 8 и 10 нет Звонарей, осколков, Чёрного колокола и Проклятых топей (story.md §6.2 п. 5)', () => {
    const banned = /звонар|осколк|чёрн\w* колокол|проклят\w* топ|хельмут/i;
    for (const s of ctx.story.scenes.filter((x) => x.chapter === 'chapter8' || x.chapter === 'chapter10'))
      for (const l of s.lines) expect(banned.test(l.text), `${s.id}: ${l.text}`).toBe(false);
  });
});

describe('сюжет: какую сцену показать', () => {
  const save0 = newGame(ctx, 1000);

  it('новая игра: вступление главы при входе на карту', () => {
    expect(ids(pendingScenes(save0, { type: 'chapterStart', chapter: 'chapter1' }, ctx))).toEqual(['ch1_intro']);
    // Глава 2 закрыта — её вступления нет.
    expect(pendingScenes(save0, { type: 'chapterStart', chapter: 'chapter2' }, ctx)).toEqual([]);
  });

  it('перед первым этапом главы: вступление (если не видели), потом сцена этапа', () => {
    expect(ids(pendingScenes(save0, { type: 'beforeStage', stageId: 'ch1_s1' }, ctx))).toEqual(['ch1_intro', 'ch1_s1_before']);
    const seen = markScenesSeen(save0, ['ch1_intro']);
    expect(ids(pendingScenes(seen, { type: 'beforeStage', stageId: 'ch1_s1' }, ctx))).toEqual(['ch1_s1_before']);
  });

  it('увиденная сцена не показывается повторно (и после перезапуска)', () => {
    const s = markScenesSeen(save0, ['ch1_intro', 'ch1_s1_before']);
    const reloaded = deserialize(serialize(s));
    expect(reloaded.seenScenes).toEqual(['ch1_intro', 'ch1_s1_before']);
    expect(pendingScenes(reloaded, { type: 'beforeStage', stageId: 'ch1_s1' }, ctx)).toEqual([]);
    expect(pendingScenes(reloaded, { type: 'chapterStart', chapter: 'chapter1' }, ctx)).toEqual([]);
  });

  it('beforeStage — только на открытом не пройденном этапе', () => {
    expect(pendingScenes(save0, { type: 'beforeStage', stageId: 'ch1_s4' }, ctx)).toEqual([]); // закрыт
    expect(ids(pendingScenes(cleared(save0, before('ch1_s4')), { type: 'beforeStage', stageId: 'ch1_s4' }, ctx))).toEqual(['ch1_s4_before']);
    expect(pendingScenes(cleared(save0, before('ch1_s4') + 1), { type: 'beforeStage', stageId: 'ch1_s4' }, ctx)).toEqual([]); // повтор
    expect(pendingScenes(cleared(save0, 1), { type: 'beforeStage', stageId: 'ch1_s2' }, ctx)).toEqual([]); // сцены нет
  });

  it('afterStage — только при первой победе', () => {
    const s = cleared(save0, before('ch1_s4') + 1);
    expect(ids(pendingScenes(s, { type: 'afterStage', stageId: 'ch1_s4', firstClear: true }, ctx))).toEqual(['ch1_s4_after']);
    expect(pendingScenes(s, { type: 'afterStage', stageId: 'ch1_s4', firstClear: false }, ctx)).toEqual([]);
    expect(pendingScenes(markScenesSeen(s, ['ch1_s4_after']), { type: 'afterStage', stageId: 'ch1_s4', firstClear: true }, ctx)).toEqual([]);
    const boss = pendingScenes(cleared(save0, before('ch1_s10') + 1), { type: 'afterStage', stageId: 'ch1_s10', firstClear: true }, ctx);
    expect(ids(boss)).toEqual(['ch1_outro']);
  });

  it('босс-этап: сцена с bossIntro', () => {
    const [s] = pendingScenes(cleared(save0, before('ch1_s10')), { type: 'beforeStage', stageId: 'ch1_s10' }, ctx);
    expect(s.id).toBe('ch1_s10_before');
    expect(s.bossIntro).toEqual({ title: 'Мастеринг', subtitle: 'Король порингов' });
  });

  it('неизвестный этап — ничего', () => {
    expect(pendingScenes(save0, { type: 'beforeStage', stageId: 'nope' }, ctx)).toEqual([]);
  });

  it('markScenesSeen: без дублей, исходное сохранение не меняется', () => {
    const a = markScenesSeen(save0, ['ch1_intro', 'ch1_intro']);
    expect(a.seenScenes).toEqual(['ch1_intro']);
    expect(save0.seenScenes).toEqual([]);
    expect(markScenesSeen(a, ['ch1_intro'])).toBe(a);
  });

  it('старое сохранение без seenScenes читается с пустым списком', () => {
    const { seenScenes: _, ...old } = save0;
    const s = deserialize(JSON.stringify(old));
    expect(s.seenScenes).toEqual([]);
    expect(ids(pendingScenes(s, { type: 'chapterStart', chapter: 'chapter1' }, ctx))).toEqual(['ch1_intro']);
  });
});

describe('сюжет: спикеры', () => {
  const story = ctx.story.chapters.chapter1;
  const save = newGame(ctx, 1000);

  it('hero1..N — сюжетные карточки по порядку (start, recruits): имя и портрет класса карточки', () => {
    expect(speakerView(story, 'hero1', save, ctx)).toEqual({ name: 'Алан', sprite: ctx.content.jobs.swordman.visual.sprite, gender: 'm' });
    expect(speakerView(story, 'hero2', save, ctx).sprite).toBe(ctx.content.jobs.archer.visual.sprite);
    // Порядок в save.heroes не важен: hero1 — всегда Алан.
    const shuffled: SaveState = { ...save, heroes: [...save.heroes].reverse() };
    expect(speakerView(story, 'hero1', shuffled, ctx).name).toBe('Алан');
    // Алан вознесён до фиолетового с веткой Рыцарь — портрет второй профессии.
    const knight: SaveState = { ...save, heroes: save.heroes.map((h, i) => (i === 0 ? { ...h, rarity: 'purple', level: 40, branch: 'knight' } : h)) };
    expect(speakerView(story, 'hero1', knight, ctx).sprite).toBe(ctx.content.jobs.knight.visual.sprite);
    // Грета (hero4) ещё не пришла — имя и пол из спикера главы 2.
    const v = speakerView(ctx.story.chapters.chapter2, 'hero4', save, ctx);
    expect(v).toMatchObject({ name: 'Грета', gender: 'f' });
  });

  it('портрет-профессия и юнит без данных (Мастеринга ещё нет) — без падения', () => {
    expect(speakerView(story, 'garret', save, ctx)).toEqual({ name: 'Капитан Гаррет', sprite: ctx.content.jobs.knight.visual.sprite });
    const m = speakerView(story, 'mastering', save, ctx);
    expect(m.name).toBe('Мастеринг');
    expect(m.sprite === null || typeof m.sprite === 'string').toBe(true);
    if (!ctx.content.units.mob_mastering) expect(m.sprite).toBeNull();
  });
});
