/**
 * Генераторы `npm run content:new` (scripts/lib/content-gen.ts): заготовки пишутся во временную копию data/
 * и должны собираться тем же buildGameContext, что и игра (без ошибок), а TODO — находиться для предупреждений content:check.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectGameContext, simulateBattle, enemySquad, newGame, buildUnit } from '../src/core';
import { ContentNewError, findTodos, parseArgs, runContentNew } from '../scripts/lib/content-gen';
import { readJsonDir, readRawGameData, ROOT } from '../scripts/lib/content-node';

let root = '';
const run = (...argv: string[]) => runContentNew(argv, root);
const json = (rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8'));
const build = () => collectGameContext(readRawGameData(root));

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'content-new-'));
  cpSync(join(ROOT, 'data'), join(root, 'data'), { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('content:new — генераторы заготовок', () => {
  it('parseArgs: позиционные аргументы, опции и флаги', () => {
    expect(parseArgs(['chapter', 'chapter4', '--mobs', 'a,b', '--no-story'])).toEqual({ pos: ['chapter', 'chapter4'], opts: { mobs: 'a,b', 'no-story': 'true' } });
  });

  it('unit и skill — как раньше: копия и пустой шаблон', () => {
    run('unit', 'gen_knight', '--from', 'warrior');
    expect(json('data/units/gen_knight.json')).toMatchObject({ id: 'gen_knight', kind: 'hero', visual: { sprite: 'gen_knight' } });
    run('unit', 'gen_mob', '--kind', 'monster');
    expect(json('data/units/gen_mob.json')).toMatchObject({ kind: 'monster', skills: { basic: 'basic_melee' } });
    run('skill', 'gen_bash', '--from', 'swordman_bash');
    expect(json('data/skills/gen_bash.json').id).toBe('gen_bash');
    expect(() => run('unit', 'gen_knight')).toThrow(ContentNewError);
    expect(() => run('unit', 'Bad-Id')).toThrow(ContentNewError);
    expect(() => run('nothing', 'x')).toThrow(ContentNewError);
    expect(build().problems).toEqual([]);
  });

  it('boss: юнит kind boss и своя ульта', () => {
    const r = run('boss', 'gen_boss', '--from', 'mob_mastering', '--sprite', 'mastering');
    expect(r.written).toEqual(['data/skills/gen_boss_ult.json', 'data/units/gen_boss.json']);
    const u = json('data/units/gen_boss.json');
    expect(u).toMatchObject({ id: 'gen_boss', kind: 'boss', skills: { ult: 'gen_boss_ult' }, visual: { sprite: 'mastering' } });
    expect(build().problems).toEqual([]);
  });

  it('chapter: 10 этапов (последний — босс) + сюжет; собирается без ошибок и играется', () => {
    const r = run('chapter', 'chapter9', '--mobs', 'mob_fabre,mob_fast,mob_tank', '--boss', 'gen_boss');
    expect(r.written).toEqual(['data/campaign/chapter9.json', 'data/story/chapter9.json']);
    const ch = json('data/campaign/chapter9.json');
    expect(ch.order).toBe(4);
    expect(ch.stages.map((s: { id: string }) => s.id)).toEqual(Array.from({ length: 10 }, (_, i) => `ch9_s${i + 1}`));
    expect(ch.stages.map((s: { boss: boolean }) => s.boss)).toEqual([...Array(9).fill(false), true]);

    const b = build();
    expect(b.problems).toEqual([]);
    const ctx = b.ctx!;
    expect(ctx.story.scenes.filter((s) => s.chapter === 'chapter9').map((s) => s.id)).toEqual(['ch9_intro', 'ch9_s10_before', 'ch9_outro']);
    // Каждый этап — настоящий бой ядра.
    const hero = buildUnit(newGame(ctx, 0).heroes[0], ctx);
    for (const s of ctx.content.stages.filter((x) => x.chapter === 'chapter9')) {
      expect(simulateBattle(ctx.content, [hero, null, null, null, null], enemySquad(s.id, ctx), 1, { log: false }).winner).toMatch(/^[AB]$/);
    }
  });

  it('TODO в заготовках находятся (content:check покажет их предупреждениями)', () => {
    const todos = [...readJsonDir('data/campaign', root), ...readJsonDir('data/story', root)].flatMap((f) => findTodos(f.file, f.data));
    expect(todos.some((t) => t.startsWith('data/campaign/chapter9.json: name'))).toBe(true);
    expect(todos.some((t) => t.startsWith('data/story/chapter9.json: scenes[0].lines[0].text'))).toBe(true);
    // В настоящих данных репозитория TODO нет.
    for (const dir of ['data/campaign', 'data/story', 'data/units', 'data/skills', 'data/jobs']) {
      expect(readJsonDir(dir).flatMap((f) => findTodos(f.file, f.data))).toEqual([]);
    }
  });

  it('stage: новый этап встаёт перед босс-этапом (или в конец с --append), id уникален', () => {
    run('stage', 'chapter9');
    let ids = json('data/campaign/chapter9.json').stages.map((s: { id: string }) => s.id);
    expect(ids.slice(-2)).toEqual(['ch9_s11', 'ch9_s10']);
    run('stage', 'chapter9', '--from', 'ch9_s3', '--append');
    ids = json('data/campaign/chapter9.json').stages.map((s: { id: string }) => s.id);
    expect(ids[ids.length - 1]).toBe('ch9_s12');
    expect(build().problems).toEqual([]);
  });

  it('story: отдельно для главы, созданной с --no-story; второй раз — отказ', () => {
    run('chapter', 'chapter10', '--no-story', '--mobs', 'mob_melee,mob_ranged');
    expect(existsSync(join(root, 'data/story/chapter10.json'))).toBe(false);
    run('story', 'chapter10');
    expect(json('data/story/chapter10.json').scenes.map((s: { id: string }) => s.id)).toEqual(['ch10_intro', 'ch10_s10_before', 'ch10_outro']);
    expect(() => run('story', 'chapter10')).toThrow(ContentNewError);
    expect(() => run('chapter', 'chapter10')).toThrow(ContentNewError);
    expect(() => run('chapter', 'chapter11', '--mobs', 'mob_boss1')).toThrow(/не монстр/);
    expect(build().problems).toEqual([]);
  });
});
