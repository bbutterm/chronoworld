import { describe, expect, it } from 'vitest';
import {
  collectGameContext,
  deserialize,
  FEATURE_IDS,
  featureStage,
  featureUnlocked,
  featureViews,
  initSeenUnlocks,
  loadOrNew,
  lockedText,
  markUnlocksSeen,
  MemoryStorage,
  newGame,
  pendingUnlocks,
  persist,
  sanitizeSave,
  serialize,
  stageLabel,
  summonUnlocked,
  towerUnlocked,
  unlocksOfStage,
  type RawGameData,
  type SaveState,
} from '../src/core';
import { loadFullContext, readRawGameData } from '../scripts/lib/content-node';
import { saveProblems } from './invariants';

const ctx = loadFullContext();
const RAW = readRawGameData();
const clone = (): RawGameData => structuredClone(RAW);
const stages = ctx.content.stages.map((s) => s.id);

/** Новая игра с пройденными этапами кампании до stageId включительно. */
function clearedUpTo(stageId: string | null): SaveState {
  const s = newGame(ctx, 0);
  const n = stageId === null ? 0 : stages.indexOf(stageId) + 1;
  return { ...s, campaign: { cleared: stages.slice(0, n) } };
}

describe('открытие функций: data/unlocks.json', () => {
  it('таблица собрана, этапы существуют, у каждой функции своя строка', () => {
    expect(ctx.unlocks).toBeDefined();
    const ids = ctx.unlocks!.features.map((f) => f.id);
    expect([...ids].sort()).toEqual([...FEATURE_IDS].sort());
    for (const f of ctx.unlocks!.features) expect(stages).toContain(f.stage);
  });

  it('Таверна — на ch1_s5 (на неё опираются модель баланса и e2e:chapter1); Таверна и Башня берут этап из таблицы', () => {
    expect(featureStage('tavern', ctx)).toBe('ch1_s5');
    expect(ctx.summon.unlockAfterStage).toBe(featureStage('tavern', ctx));
    expect(ctx.tower.unlockAfterStage).toBe(featureStage('tower', ctx));
  });

  it('расписание по порядку кампании: этапы не убывают по таблице (баннеры идут в порядке открытия)', () => {
    const idx = ctx.unlocks!.features.map((f) => stages.indexOf(f.stage));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it('новая игра — всё закрыто; открывается ровно после своего этапа', () => {
    const fresh = newGame(ctx, 0);
    for (const id of FEATURE_IDS) expect(featureUnlocked(fresh, id, ctx)).toBe(false);
    for (const f of ctx.unlocks!.features) {
      const before = clearedUpTo(stages[stages.indexOf(f.stage) - 1] ?? null);
      expect(featureUnlocked(before, f.id, ctx)).toBe(false);
      expect(featureUnlocked(clearedUpTo(f.stage), f.id, ctx)).toBe(true);
    }
    // Ядро Таверны и Башни — по той же таблице.
    expect(summonUnlocked(clearedUpTo('ch1_s4'), ctx)).toBe(false);
    expect(summonUnlocked(clearedUpTo('ch1_s5'), ctx)).toBe(true);
    expect(towerUnlocked(clearedUpTo('ch1_s9'), ctx)).toBe(false);
    expect(towerUnlocked(clearedUpTo('ch1_s10'), ctx)).toBe(true);
  });

  it('подпись замка «Откроется на этапе 1-8» (глава-этап); открыта — пусто; нет в таблице — открыта сразу', () => {
    expect(lockedText(newGame(ctx, 0), 'bounties', ctx)).toBe(`Откроется на этапе ${stageLabel(featureStage('bounties', ctx)!, ctx.content)}`);
    expect(stageLabel('ch1_s8', ctx.content)).toBe('1-8');
    expect(stageLabel('ch2_s1', ctx.content)).toBe('2-1');
    expect(lockedText(clearedUpTo('ch1_s10'), 'tower', ctx)).toBe('');
    const noTable = { ...ctx, unlocks: undefined };
    expect(featureUnlocked(newGame(ctx, 0), 'tower', noTable)).toBe(true);
    expect(lockedText(newGame(ctx, 0), 'tower', noTable)).toBe('');
  });

  it('unlocksOfStage — что открывает этап', () => {
    expect(unlocksOfStage('ch1_s5', ctx).map((f) => f.id)).toContain('tavern');
    expect(unlocksOfStage('ch1_s1', ctx)).toEqual([]);
  });
});

describe('баннер «Новая функция!»: один раз', () => {
  it('открытая и не показанная — в очереди; показанная — больше никогда', () => {
    let s = clearedUpTo('ch1_s3');
    const first = pendingUnlocks(s, ctx).map((f) => f.id);
    expect(first).toEqual(ctx.unlocks!.features.filter((f) => stages.indexOf(f.stage) <= stages.indexOf('ch1_s3')).map((f) => f.id));
    s = markUnlocksSeen(s, [first[0]]);
    expect(pendingUnlocks(s, ctx).map((f) => f.id)).toEqual(first.slice(1));
    s = markUnlocksSeen(s, first);
    expect(pendingUnlocks(s, ctx)).toEqual([]);
    // Повторная отметка ничего не меняет (тот же объект), повторов в списке нет.
    expect(markUnlocksSeen(s, first)).toBe(s);
    expect(new Set(s.seenUnlocks).size).toBe(s.seenUnlocks!.length);
    // Следующий этап — новые баннеры только для новых функций.
    const next = { ...s, campaign: { cleared: stages.slice(0, stages.indexOf('ch1_s5') + 1) } };
    expect(pendingUnlocks(next, ctx).map((f) => f.id)).toEqual(['tavern']);
    expect(featureViews(next, ctx).find((f) => f.id === 'tavern')).toMatchObject({ unlocked: true, seen: false, stageLabel: '1-5' });
  });

  it('отметка переживает запись и загрузку', () => {
    const storage = new MemoryStorage();
    const s = markUnlocksSeen(clearedUpTo('ch1_s2'), ['fast_rewards']);
    persist(storage, s);
    const r = loadOrNew(storage, ctx, 0);
    expect(r.save.seenUnlocks).toEqual(['fast_rewards']);
    expect(pendingUnlocks(r.save, ctx).map((f) => f.id)).toEqual(['quests']);
  });
});

describe('старые сохранения без seenUnlocks', () => {
  /** Сохранение до таблицы открытий: поля нет. */
  const old = (stageId: string): SaveState => {
    const { seenUnlocks: _s, ...rest } = clearedUpTo(stageId);
    return rest as SaveState;
  };

  it('схема читает их без смены версии; sanitizeSave отмечает уже открытое показанным — без пачки баннеров', () => {
    const s = deserialize(serialize(old('ch2_s3')));
    expect(s.seenUnlocks).toBeUndefined();
    const r = sanitizeSave(s, ctx);
    expect(r.warnings).toEqual([]);
    expect(r.save.seenUnlocks).toEqual([...FEATURE_IDS].filter((id) => featureUnlocked(s, id, ctx)).sort((a, b) => ctx.unlocks!.features.findIndex((f) => f.id === a) - ctx.unlocks!.features.findIndex((f) => f.id === b)));
    expect(pendingUnlocks(r.save, ctx)).toEqual([]);
    // Порядок ключей как в схеме: сохранение целое, serialize/deserialize не меняет данные.
    expect(saveProblems(r.save, ctx)).toEqual([]);
  });

  it('игрок до Таверны: открытое — показано, Таверна после ch1_s5 — баннер будет', () => {
    const r = sanitizeSave(old('ch1_s3'), ctx);
    expect(r.save.seenUnlocks).toEqual(['fast_rewards', 'quests', 'speed_x2', 'achievements']);
    const after = { ...r.save, campaign: { cleared: stages.slice(0, 5) } };
    expect(pendingUnlocks(after, ctx).map((f) => f.id)).toEqual(['tavern']);
  });

  it('через loadOrNew: поле появляется один раз; новое сохранение не трогается', () => {
    const storage = new MemoryStorage();
    storage.save(serialize(old('ch1_s10')));
    const r = loadOrNew(storage, ctx, 0);
    expect(r.save.seenUnlocks).toEqual(ctx.unlocks!.features.map((f) => f.id));
    const fresh = newGame(ctx, 0);
    expect(fresh.seenUnlocks).toEqual([]);
    expect(sanitizeSave(fresh, ctx).save).toBe(fresh);
    expect(initSeenUnlocks(fresh, ctx)).toBe(fresh);
  });
});

describe('ошибки data/unlocks.json', () => {
  const problems = (raw: RawGameData) => collectGameContext(raw).problems;

  it('неизвестный этап, повтор функции, неизвестная функция, длинное описание — ошибка с именем файла', () => {
    const cases: ((u: { features: Record<string, unknown>[] }) => void)[] = [
      (u) => (u.features[0].stage = 'ch9_s99'),
      (u) => u.features.push({ ...u.features[0] }),
      (u) => (u.features[0].id = 'arena'),
      (u) => (u.features[0].description = 'x'.repeat(200)),
      (u) => (u.features[0].icon = 'dragon'),
    ];
    for (const edit of cases) {
      const raw = clone();
      edit(raw.unlocks as { features: Record<string, unknown>[] });
      expect(problems(raw).some((p) => p.includes('data/unlocks.json')), JSON.stringify(problems(raw))).toBe(true);
    }
  });

  it('этап Таверны или Башни задан и в таблице, и в своём файле — ошибка (одна правда)', () => {
    const a = clone();
    a.summon = { ...(a.summon as object), unlockAfterStage: 'ch1_s5' };
    expect(problems(a).some((p) => p.includes('data/summon.json'))).toBe(true);
    const b = clone();
    b.tower = { ...(b.tower as object), unlockAfterStage: 'ch1_s5' };
    expect(problems(b).some((p) => p.includes('data/tower.json'))).toBe(true);
  });

  it('без таблицы Таверна без этапа — понятная ошибка', () => {
    const raw = clone();
    delete raw.unlocks;
    expect(problems(raw).some((p) => p.includes('tavern'))).toBe(true);
  });
});
