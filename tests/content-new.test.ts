/**
 * Генераторы `npm run content:new` (scripts/lib/content-gen.ts): заготовки пишутся во временную копию data/
 * и должны собираться тем же buildGameContext, что и игра (без ошибок), а TODO — находиться для предупреждений content:check.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectGameContext, simulateBattle, enemySquad, newGame, buildUnit, validateHeroes } from '../src/core';
import { BOSS_REWARD_MINUTES, CHEST_GROWTH, ContentNewError, findTodos, parseArgs, REWARD_MINUTES, runContentNew } from '../scripts/lib/content-gen';
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
    // Последняя глава до генерации (по order) — от неё считаются order и сундук новой; сколько глав в data — неважно.
    const before = readdirSync(join(root, 'data/campaign'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ file: `data/campaign/${f}`, order: json(`data/campaign/${f}`).order as number }))
      .sort((x, y) => x.order - y.order)
      .at(-1)!;
    const r = run('chapter', 'chapter9', '--mobs', 'mob_fabre,mob_fast,mob_tank', '--boss', 'gen_boss');
    expect(r.written).toEqual(['data/campaign/chapter9.json', 'data/story/chapter9.json']);
    const ch = json('data/campaign/chapter9.json');
    expect(ch.order).toBe(before.order + 1);
    expect(ch.stages.map((s: { id: string }) => s.id)).toEqual(Array.from({ length: 10 }, (_, i) => `ch9_s${i + 1}`));
    expect(ch.stages.map((s: { boss: boolean }) => s.boss)).toEqual([...Array(9).fill(false), true]);
    // Экономика — как у глав 2–3 (docs/content/balance.md): сундук +9%/этап от последнего этапа последней главы, золото 0.7,
    // награда — 30 минут сундука (босс — 45).
    const prevChest = json(before.file).stages.at(-1).offlinePerMinute.jobExp;
    type R = { jobExp: number; gold: number };
    const st = ch.stages as { rewards: R; offlinePerMinute: R; boss: boolean }[];
    expect(st[0].offlinePerMinute.jobExp).toBe(Math.round(prevChest * CHEST_GROWTH));
    for (const [i, s] of st.entries()) {
      if (i > 0) expect(s.offlinePerMinute.jobExp / st[i - 1].offlinePerMinute.jobExp).toBeCloseTo(CHEST_GROWTH, 1);
      expect(s.offlinePerMinute.gold).toBe(Math.round(s.offlinePerMinute.jobExp * 0.7));
      expect(s.rewards.jobExp).toBe(s.offlinePerMinute.jobExp * (s.boss ? BOSS_REWARD_MINUTES : REWARD_MINUTES));
    }

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

  it('hero: герой первой профессии с двумя ветками (Лучница — Охотница и Танцовщица) — валиден, без предупреждений правил, TODO находятся', () => {
    const r = run('hero', 'gen_thief', '--class', 'thief', '--gender', 'f');
    expect(r.written).toEqual(['data/heroes/gen_thief.json']);
    const t = json('data/heroes/gen_thief.json');
    expect(t).toMatchObject({ job: 'thief', line: 'thief', source: 'summon', baseRarity: 'green', maxRarity: 'red', gender: 'f' });
    expect(t.branches.map((b: { job: string }) => b.job)).toEqual(['assassin', 'rogue']);
    run('hero', 'gen_archer_f', '--class', 'archer', '--gender', 'f', '--sprite', 'hunter_f');
    expect(json('data/heroes/gen_archer_f.json').branches.map((b: { job: string }) => b.job)).toEqual(['dancer', 'hunter']);
    run('hero', 'gen_archer_m', '--class', 'archer', '--gender', 'm');
    expect(json('data/heroes/gen_archer_m.json').branches.map((b: { job: string }) => b.job)).toEqual(['bard', 'hunter']);

    const b = build();
    expect(b.problems).toEqual([]);
    const warnings: string[] = [];
    validateHeroes(b.ctx!.content, [], warnings);
    expect(warnings.filter((w) => /gen_(thief|archer)/.test(w))).toEqual([]);
    // Каждая форма (первая профессия и обе ветки) выходит в бой.
    for (const id of ['gen_thief', 'gen_archer_f', 'gen_archer_m']) {
      const tpl = b.ctx!.content.heroes[id];
      for (const branch of [undefined, ...tpl.branches.map((x) => x.job)]) {
        const unit = buildUnit({ id: 'x', templateId: id, rarity: 'red', level: 100, ...(branch ? { branch } : {}) }, b.ctx!);
        expect(simulateBattle(b.ctx!.content, [unit, null, null, null, null], [unit, null, null, null, null], 1, { log: false }).winner).toMatch(/^[AB]$|^draw$/);
      }
    }
    const todos = findTodos('data/heroes/gen_thief.json', json('data/heroes/gen_thief.json'));
    expect(todos.map((x) => x.split(' — ')[0])).toEqual(
      expect.arrayContaining(['data/heroes/gen_thief.json: name', 'data/heroes/gen_thief.json: bio', 'data/heroes/gen_thief.json: hook', 'data/heroes/gen_thief.json: branches[0].promotion']),
    );
  });

  it('hero --story: рекрут в progression.heroes.recruits', () => {
    const r = run('hero', 'gen_story', '--class', 'mage', '--gender', 'f', '--story', '--after', 'ch2_s5');
    expect(r.written).toEqual(['data/heroes/gen_story.json', 'data/progression.json']);
    const h = json('data/heroes/gen_story.json');
    expect(h).toMatchObject({ source: 'story', baseRarity: 'green', maxRarity: 'red' });
    expect(h.branches).toHaveLength(2);
    expect(json('data/progression.json').heroes.recruits.at(-1)).toEqual({ afterStage: 'ch2_s5', template: 'gen_story' });
    expect(build().problems).toEqual([]);
  });

  it('hero: ошибки ввода — понятный отказ, файлов не пишет', () => {
    expect(() => run('hero', 'gen_x', '--gender', 'm')).toThrow(/--class/);
    expect(() => run('hero', 'gen_x', '--class', 'nope', '--gender', 'm')).toThrow(/--class/);
    expect(() => run('hero', 'gen_x', '--class', 'novice', '--gender', 'm')).toThrow(/Новичок/);
    expect(() => run('hero', 'gen_x', '--class', 'mage')).toThrow(/--gender/);
    expect(() => run('hero', 'gen_x', '--class', 'wizard', '--gender', 'm')).toThrow(/первая профессия/);
    expect(() => run('hero', 'gen_x', '--class', 'mage', '--gender', 'm', '--story', '--after', 'ch9_s99')).toThrow(/--after/);
    expect(() => run('hero', 'gen_thief', '--class', 'thief', '--gender', 'm')).toThrow(/уже есть/);
    expect(existsSync(join(root, 'data/heroes/gen_x.json'))).toBe(false);
  });
});
