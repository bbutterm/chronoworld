/**
 * Цели регулятора сложности (scripts/balance-fit.ts → fitTargets): главы и окна берутся из data, новая глава
 * (файл data/campaign/chapterN.json без окон) получает окна по правилу balance.default — скрипт и тесты не правятся.
 */
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { collectGameContext } from '../src/core';
import { runContentNew } from '../scripts/lib/content-gen';
import { readRawGameData, ROOT } from '../scripts/lib/content-node';
import { DEFAULT_FIT_RULE, fitTargets, loadFullContext } from '../scripts/lib/player-model';

const ctx = loadFullContext();
const tmpRoots: string[] = [];
afterAll(() => tmpRoots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe('balance-fit: цели из data/progression.json → balance', () => {
  it('текущие данные: окна глав 2–3 из data, глава 1 не регулируется, ошибок нет', () => {
    const t = fitTargets(ctx);
    expect(t.problems).toEqual([]);
    expect(ctx.progression.balance?.exclude).toContain('chapter1');
    const regulated = ctx.content.chapters.filter((c) => !ctx.progression.balance!.exclude.includes(c.id)).map((c) => c.id);
    expect(t.chapters.map((c) => c.id)).toEqual(regulated);
    for (const c of t.chapters.filter((x) => x.id === 'chapter2' || x.id === 'chapter3')) expect(c.source, c.id).toBe('data');
    // Окна глав 2–3 (перенесены из скрипта без изменений) и 7 дней модели.
    expect(t.windows.get('ch2_s1')).toEqual([0, 1]);
    expect(t.windows.get('ch2_s10')).toEqual([32, 36.5]);
    expect(t.windows.get('ch3_s10')).toEqual([96, 108.5]);
    expect(t.windows.has('ch1_s1')).toBe(false);
    expect(t.days).toBeGreaterThanOrEqual(7);
    // Окна не убывают по ходу кампании: «с» и «по» каждого этапа не раньше предыдущего.
    const ws = [...t.windows.values()];
    for (let i = 1; i < ws.length; i++) {
      expect(ws[i][0]).toBeGreaterThanOrEqual(ws[i - 1][0]);
      expect(ws[i][1]).toBeGreaterThanOrEqual(ws[i - 1][1]);
    }
  });

  it('новая глава без окон — окна по правилу default от босса прошлой главы; дней модели хватает', () => {
    const root = mkdtempSync(join(tmpdir(), 'balance-fit-'));
    tmpRoots.push(root);
    cpSync(join(ROOT, 'data'), join(root, 'data'), { recursive: true });
    runContentNew(['chapter', 'chapter77', '--prefix', 'ch77'], root);
    const built = collectGameContext(readRawGameData(root));
    expect(built.problems).toEqual([]);
    const c2 = built.ctx!;
    const t = fitTargets(c2);
    expect(t.problems).toEqual([]);
    const before = fitTargets(ctx);
    const last = t.chapters.at(-1)!;
    expect(last).toMatchObject({ id: 'chapter77', source: 'default' });
    expect(last.stages).toHaveLength(10);
    // Главы с окнами из data не сдвинулись.
    for (const [id, w] of before.windows) expect(t.windows.get(id), id).toEqual(w);
    const rule = c2.progression.balance?.default ?? DEFAULT_FIT_RULE;
    const prevBossLo = before.windows.get(before.chapters.at(-1)!.stages.at(-1)!)![0];
    const ws = last.stages.map((s) => t.windows.get(s)!);
    expect(ws[0][0]).toBe(prevBossLo + rule.gapHours);
    expect(ws[9][0]).toBe(prevBossLo + rule.gapHours + rule.spanHours);
    for (const w of ws) expect(w[1] - w[0]).toBeCloseTo(rule.windowHours, 0);
    // Стены: одно «с» на группу из wallEvery этапов, группы идут строго позже.
    for (let i = 1; i < ws.length; i++) {
      if (i % rule.wallEvery === 0) expect(ws[i][0]).toBeGreaterThan(ws[i - 1][0]);
      else expect(ws[i][0]).toBe(ws[i - 1][0]);
    }
    expect(t.days * 24).toBeGreaterThanOrEqual(ws[9][1]);
  });

  it('этап без окна в главе с окнами берёт окно предыдущего; ошибки — окно у неизвестного этапа и неизвестная глава в exclude', () => {
    const bal = ctx.progression.balance!;
    const windows = { ...bal.windows, ch9_s1: [1, 2] as [number, number] };
    delete (windows as Record<string, unknown>).ch3_s5;
    const t = fitTargets({ ...ctx, progression: { ...ctx.progression, balance: { ...bal, windows, exclude: [...bal.exclude, 'chapter99'] } } });
    expect(t.problems).toEqual(['balance.windows.ch9_s1: этапа нет в data/campaign', 'balance.exclude: главы chapter99 нет в data/campaign']);
    expect(t.windows.get('ch3_s5')).toEqual(bal.windows.ch3_s4);
    expect(t.chapters.find((c) => c.id === 'chapter3')?.source).toBe('partial');
  });
});
