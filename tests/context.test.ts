import { describe, expect, it } from 'vitest';
import { buildGameContext, collectGameContext, ContentError, type RawFile, type RawGameData } from '../src/core';
import { loadFullContext, loadGameContext, readRawGameData } from '../scripts/lib/content-node';

const RAW = readRawGameData();
const clone = (): RawGameData => structuredClone(RAW);

/** Как import.meta.glob в src/game/content.ts: ключи вида '../../data/units/x.json'. */
const globLike = (files: RawFile[]): RawFile[] =>
  Object.entries(Object.fromEntries(files.map((f) => [`../../${f.file}`, f.data])))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, data]) => ({ file, data }));

const problemsOf = (raw: RawGameData): string[] => {
  try {
    buildGameContext(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ContentError);
    return (e as ContentError).problems;
  }
  throw new Error('ожидалась ошибка');
};

describe('buildGameContext (N1)', () => {
  it('собирает полный контекст из реальных data/', () => {
    const ctx = buildGameContext(RAW);
    expect(Object.keys(ctx.content.jobs).length).toBeGreaterThan(0);
    expect(ctx.content.stages.length).toBeGreaterThan(0);
    expect(ctx.features.quests).toBeDefined();
    expect(Object.keys(ctx.equipment.items).length).toBeGreaterThan(0);
    expect(ctx.tower.maxFloor).toBeGreaterThan(0);
    expect(ctx.meta.bounties.templates.length).toBeGreaterThan(0);
  });

  it('совпадает со старой сборкой loadGameContext (контент и прогрессия)', () => {
    const ctx = loadFullContext();
    const old = loadGameContext();
    expect(ctx.progression).toEqual(old.progression);
    expect(ctx.combat).toEqual(old.combat);
    expect(Object.keys(ctx.content.units)).toEqual(Object.keys(old.content.units));
  });

  it('битый quests.json — ошибка с именем файла', () => {
    const raw = clone();
    raw.quests = { nonsense: true };
    expect(problemsOf(raw).some((p) => p.includes('data/quests.json'))).toBe(true);
  });

  it('битый tower.json — ошибка с именем файла', () => {
    const raw = clone();
    raw.tower = {
      ...(raw.tower as object),
      unlockAfterStage: 'нет-такого-этапа',
    };
    expect(problemsOf(raw).some((p) => p.includes('data/tower.json'))).toBe(true);
  });

  it('битый файл предметов — ошибка с именем файла (и для путей из import.meta.glob)', () => {
    const raw = clone();
    raw.items = globLike(raw.items);
    raw.items[0] = { ...raw.items[0], data: { items: [{ id: 42 }] } };
    const file = raw.items[0].file.replace(/^(\.\.\/)+/, '');
    expect(file.startsWith('data/items/')).toBe(true);
    expect(problemsOf(raw).some((p) => p.startsWith(`${file}:`))).toBe(true);
  });

  it('собирает ошибки всех файлов сразу', () => {
    const raw = clone();
    raw.quests = null;
    raw.tower = null;
    raw.achievements = null;
    raw.items = [{ file: 'data/items/broken.json', data: 1 }];
    const problems = problemsOf(raw);
    for (const f of ['data/quests.json', 'data/tower.json', 'data/achievements.json', 'data/items/broken.json']) {
      expect(problems.some((p) => p.includes(f))).toBe(true);
    }
  });

  it('при битом контенте проверяет схемы остальных файлов и отдаёт ошибки без исключения', () => {
    const raw = clone();
    raw.units = [...raw.units, { file: 'data/units/zz_broken.json', data: { id: 'zz' } }];
    raw.tower = null;
    const r = collectGameContext(raw);
    expect(r.ctx).toBeUndefined();
    expect(r.problems.some((p) => p.startsWith('data/units/zz_broken.json'))).toBe(true);
    expect(r.problems.some((p) => p.includes('data/tower.json'))).toBe(true);
  });

  it('Node и «glob»-данные дают одинаковый контекст', () => {
    const node = buildGameContext(RAW);
    const raw = clone();
    for (const k of ['units', 'skills', 'jobs', 'chapters', 'items'] as const) raw[k] = globLike(raw[k]);
    const glob = buildGameContext(raw);
    expect(Object.keys(glob.content.jobs)).toEqual(Object.keys(node.content.jobs));
    expect(glob.content.stages.map((s) => s.id)).toEqual(node.content.stages.map((s) => s.id));
    expect(Object.keys(glob.equipment.items)).toEqual(Object.keys(node.equipment.items));
    expect(glob).toEqual(node);
  });
});
