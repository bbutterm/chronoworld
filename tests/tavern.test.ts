import { describe, expect, it } from 'vitest';
import {
  activeLinks,
  addHeroCard,
  bondOf,
  bondUnlocks,
  bondView,
  buildGameContext,
  chooseOption,
  ContentError,
  deserialize,
  EVENING_LINES_MAX,
  EVENING_LINES_MIN,
  eveningStatus,
  fightBondQuest,
  finishEvening,
  finishPersonalScene,
  isChoice,
  lineVisible,
  newEvenings,
  newGame,
  pendingEvening,
  playStage,
  serialize,
  squadUnits,
  STORY_LINE_MAX,
  storyOrder,
  withBondLinks,
  type RawGameData,
  type SaveState,
  type TavernLine,
} from '../src/core';
import { loadFullContext, readRawGameData } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const RAW = readRawGameData();
const T = ctx.story.tavern!;

/** Пройдены все этапы глав до chapterN включительно. */
const through = (save: SaveState, chapterN: number): SaveState => {
  const chapters = ctx.content.chapters.filter((c) => c.order <= chapterN).map((c) => c.id);
  return { ...save, campaign: { cleared: ctx.content.stages.filter((s) => chapters.includes(s.chapter)).map((s) => s.id) } };
};
const fresh = () => newGame(ctx, 1_700_000_000_000);
/** Все пять сюжетных героев в отряде (Грета и Дорн — как после вербовки). */
const withStoryFive = (save: SaveState): SaveState => {
  let s = save;
  for (const t of ['greta', 'dorn']) s = addHeroCard(s, t, 'green').save;
  const ids = s.heroes.filter((h) => storyOrder(ctx).includes(h.templateId)).map((h) => h.id);
  return { ...s, squad: ids.slice(0, 5) };
};

const problemsWith = (edit: (t: any) => void): string[] => {
  const raw: RawGameData = structuredClone(RAW);
  edit(raw.stories!.find((x) => x.file.endsWith('tavern.json'))!.data);
  try {
    buildGameContext(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ContentError);
    return (e as ContentError).problems;
  }
  return [];
};

describe('вечера в таверне: данные', () => {
  it('10 вечеров — после каждой главы, id с tav_, 8–16 реплик, не больше одного выбора, реплики ≤ 120', () => {
    expect(T.evenings.map((e) => e.after)).toEqual(ctx.content.chapters.map((c) => c.id));
    for (const e of T.evenings) {
      expect(e.id).toMatch(/^tav_/);
      const lines = e.steps.filter((s) => !isChoice(s));
      expect(lines.length).toBeGreaterThanOrEqual(EVENING_LINES_MIN);
      expect(lines.length).toBeLessThanOrEqual(EVENING_LINES_MAX);
      const choices = e.steps.filter(isChoice);
      expect(choices.length).toBeLessThanOrEqual(1);
      for (const c of choices) expect(c.choice.options.length).toBeGreaterThanOrEqual(2);
    }
    const all: TavernLine[] = T.evenings.flatMap((e) => e.steps.flatMap((s) => (isChoice(s) ? s.choice.options.flatMap((o) => o.reply) : [s])));
    expect(all.every((l) => l.text.length <= STORY_LINE_MAX)).toBe(true);
    // Выбор — не в каждом вечере.
    const withChoice = T.evenings.filter((e) => e.steps.some(isChoice)).length;
    expect(withChoice).toBeGreaterThanOrEqual(5);
    expect(withChoice).toBeLessThan(T.evenings.length);
  });

  it('у всех 12 героев — личная сцена, задание и связка с другим героем', () => {
    expect(Object.keys(T.heroes).sort()).toEqual(Object.keys(ctx.content.heroes).sort());
    for (const [id, h] of Object.entries(T.heroes)) {
      expect(h.link.partner).not.toBe(id);
      expect(ctx.content.stages.some((s) => s.id === h.quest.stage)).toBe(true);
    }
    // Вечер-воспоминание: хотя бы 5 реплик вспоминают выбор из прошлых вечеров.
    const memories = T.evenings.flatMap((e) => e.steps).filter((s) => !isChoice(s) && s.when && s.when.is !== 'none');
    expect(memories.length).toBeGreaterThanOrEqual(5);
  });

  it('проверки сборки: чужой when, два выбора, лишние реплики, неизвестный герой близости', () => {
    expect(problemsWith((t) => (t.evenings[0].steps[0].when = { choice: 'c_nope', is: 'x' })).join('\n')).toMatch(/when ссылается на выбор c_nope/);
    expect(problemsWith((t) => t.evenings[0].steps.push(structuredClone(t.evenings[1].steps.find((s: any) => s.choice)))).join('\n')).toMatch(/больше одного выбора/);
    expect(problemsWith((t) => t.evenings[0].steps.push(...Array(10).fill({ speaker: 'hero1', text: 'Ещё.' }))).join('\n')).toMatch(/реплик \d+, нужно 8–16/);
    expect(problemsWith((t) => (t.evenings[0].steps.find((s: any) => s.choice).choice.options[0].bond = { unknown_hero: 1 })).join('\n')).toMatch(/герой unknown_hero не найден/);
    expect(problemsWith((t) => (t.evenings[1].id = 'tav_ch1')).join('\n')).toMatch(/id tav_ch1 уже занят/);
  });
});

describe('вечера в таверне: прогресс', () => {
  it('вечер открывается первой победой над боссом главы и показывается один раз', () => {
    const s0 = fresh();
    expect(pendingEvening(s0, 'chapter1', ctx)).toBeUndefined();
    const s1 = through(s0, 1);
    expect(pendingEvening(s1, 'chapter1', ctx)?.id).toBe('tav_ch1');
    expect(newEvenings(s1, ctx).map((e) => e.id)).toEqual(['tav_ch1']);
    const { save: s2 } = finishEvening(s1, 'tav_ch1', ctx);
    expect(pendingEvening(s2, 'chapter1', ctx)).toBeUndefined();
    expect(eveningStatus(s2, T.evenings[0], ctx)).toBe('seen');
  });

  it('«Пропустить» (finishEvening без выбора): вечер засчитан, близость за отряд — один раз, кампания не тронута', () => {
    const s1 = through(fresh(), 1);
    const { save: s2, gains } = finishEvening(s1, 'tav_ch1', ctx);
    // В отряде новой игры — Алан, Бран, Вика: по +1 за «главу вместе».
    expect(gains).toEqual({ alan: 1, bran: 1, vika: 1 });
    expect(s2.campaign).toEqual(s1.campaign);
    expect(s2.resources).toEqual(s1.resources);
    expect(finishEvening(s2, 'tav_ch1', ctx).save).toBe(s2);
    // Выбор, упущенный пропуском, можно сделать при пересмотре.
    const r = chooseOption(s2, 'c_tav1', 'yes', ctx);
    expect(r.gains).toEqual({ greta: 2 });
    // Дальше кампания идёт как обычно.
    const out = playStage(s2, ctx.content.stages.find((s) => s.chapter === 'chapter2')!.id, 1, ctx);
    expect(out.save.battleSeq).toBe(s2.battleSeq + 1);
  });

  it('выбор даёт близость один раз и открывает реплику-воспоминание', () => {
    let s = through(fresh(), 7);
    const memory = T.evenings.find((e) => e.id === 'tav_ch8')!.steps.filter((x): x is TavernLine => !isChoice(x) && !!x.when);
    expect(memory.filter((l) => lineVisible(l, s))).toEqual([]);
    const r = chooseOption(s, 'c_tav7', 'tea', ctx);
    expect(r.gains).toEqual({ vika: 2 });
    s = r.save;
    expect(bondOf(s, 'vika')).toBe(2);
    expect(chooseOption(s, 'c_tav7', 'ask', ctx)).toEqual({ save: s, gains: {} });
    const shown = memory.filter((l) => lineVisible(l, s));
    expect(shown).toHaveLength(1);
    expect(shown[0].text).toMatch(/не дали спросить/);
    // Вариант none — только пока выбора нет.
    const none = T.evenings.find((e) => e.id === 'tav_ch6')!.steps.find((x): x is TavernLine => !isChoice(x) && x.when?.is === 'none')!;
    expect(lineVisible(none, fresh())).toBe(true);
    expect(lineVisible(none, chooseOption(fresh(), 'c_tav1', 'yes', ctx).save)).toBe(false);
    expect(() => chooseOption(s, 'c_tav7', 'nope', ctx)).toThrow();
  });

  it('близость упирается в потолок; пороги открывают личную сцену и задание', () => {
    expect(bondUnlocks(2, 3, ctx)).toEqual(['scene']);
    expect(bondUnlocks(2, 5, ctx)).toEqual(['scene', 'quest']);
    expect(bondUnlocks(5, 7, ctx)).toEqual([]);
    let s: SaveState = { ...fresh(), tavern: { bond: { vika: T.bond.max - 1 } } };
    s = chooseOption(s, 'c_tav3', 'yes', ctx).save;
    expect(bondOf(s, 'vika')).toBe(T.bond.max);
    const v = bondView({ ...fresh(), tavern: { bond: { vika: 3 } } }, 'vika', ctx)!;
    expect(v.scene.open).toBe(true);
    expect(v.quest.open).toBe(false);
    expect(v.link.open).toBe(false);
    const seen = finishPersonalScene({ ...fresh(), tavern: { bond: { vika: 3 } } }, v.scene.id);
    expect(bondView(seen, 'vika', ctx)!.scene.seen).toBe(true);
  });

  it('старое сохранение без поля tavern читается; новое поле переживает serialize/deserialize', () => {
    const old = fresh();
    expect(old.tavern).toBeUndefined();
    const back = deserialize(serialize(old));
    expect(back.tavern).toBeUndefined();
    expect(bondOf(back, 'alan')).toBe(0);
    const s = chooseOption(finishEvening(through(old, 1), 'tav_ch1', ctx).save, 'c_tav1', 'yes', ctx).save;
    const again = deserialize(serialize(s));
    expect(again.tavern).toEqual(s.tavern);
    expect(serialize(again)).toBe(serialize(s));
  });
});

describe('личные задания и связки', () => {
  /** Сильный отряд: все пятеро, золотые, ур. 80. */
  const strong = (): SaveState => {
    const s = withStoryFive(through(fresh(), 5));
    return { ...s, heroes: s.heroes.map((h) => ({ ...h, rarity: 'gold' as const, level: 80 })) };
  };

  it('задание закрыто до порога близости и без пройденного этапа; герой задания должен быть в отряде', () => {
    const s = strong();
    expect(() => fightBondQuest(s, 'greta', 1, ctx)).toThrow(/близости/);
    const open: SaveState = { ...s, tavern: { bond: { greta: 5 } } };
    expect(() => fightBondQuest({ ...open, campaign: { cleared: [] } }, 'greta', 1, ctx)).toThrow(/этап/);
    const noGreta = { ...open, squad: open.squad.map((id) => (open.heroes.find((h) => h.id === id)?.templateId === 'greta' ? null : id)) };
    expect(() => fightBondQuest(noGreta, 'greta', 1, ctx)).toThrow(/в отряде/);
  });

  it('задание детерминировано, награда — один раз, выполненное открывает связку', () => {
    const s: SaveState = { ...strong(), tavern: { bond: { greta: 5 } } };
    const a = fightBondQuest(s, 'greta', 7, ctx);
    const b = fightBondQuest(s, 'greta', 7, ctx);
    expect(serialize(a.save)).toBe(serialize(b.save));
    expect(a.result.winner).toBe(b.result.winner);
    expect(a.win).toBe(true);
    expect(a.goal).toBe(true);
    expect(a.firstTime).toBe(true);
    const q = T.heroes.greta.quest;
    expect(a.save.currency.gems).toBe(s.currency.gems + (q.reward.gems ?? 0));
    expect(a.save.currency.scrolls).toBe(s.currency.scrolls + (q.reward.scrolls ?? 0));
    expect(bondView(a.save, 'greta', ctx)!.link.open).toBe(true);
    const again = fightBondQuest(a.save, 'greta', 8, ctx);
    expect(again.firstTime).toBe(false);
    expect(again.save.currency.gems).toBe(a.save.currency.gems);
  });

  it('связка: +pct% к стату обоим, только когда задание выполнено и оба героя в отряде', () => {
    const base = strong();
    const link = T.heroes.greta.link;
    const done: SaveState = { ...base, tavern: { bond: { greta: 5 }, quests: [T.heroes.greta.quest.id] } };
    expect(activeLinks(base, ctx)).toEqual([]);
    expect(activeLinks(done, ctx).map((l) => l.id)).toEqual([link.id]);
    const plain = squadUnits(done, ctx).squad;
    const boosted = withBondLinks(plain, done, ctx);
    const tmpl = (id: string) => done.heroes.find((h) => h.id === id)!.templateId;
    for (let i = 0; i < plain.length; i++) {
      const u = plain[i];
      if (!u) continue;
      const t = tmpl(u.id);
      const want = t === 'greta' || t === link.partner ? Math.round(u.stats[link.stat] * (1 + link.pct / 100)) : u.stats[link.stat];
      expect(boosted[i]!.stats[link.stat]).toBe(want);
    }
    // Партнёра нет в отряде — связка молчит.
    const noPartner = { ...done, squad: done.squad.map((id) => (id && tmpl(id) === link.partner ? null : id)) };
    expect(activeLinks(noPartner, ctx)).toEqual([]);
    expect(withBondLinks(squadUnits(noPartner, ctx).squad, noPartner, ctx)).toEqual(squadUnits(noPartner, ctx).squad);
  });
});
