import { beforeAll, describe, expect, it } from 'vitest';
import { compileGameContent, compileGameContentFromDisk, readLoreFiles, type CompiledGameContent } from '../scripts/lib/compiled-content';
import { readRawGameData } from '../scripts/lib/content-node';
import { buildGameContext, buildUnit, ContentError, emptyLore, heroStoryPieces, newGame, parseLore, pendingScenes, playStage, worldEntries, type CombatConfig, type FullContext, type HeroState, type Lore, type RawFile } from '../src/core';
import { CONTENT, GAME, LORE } from '../src/game/content';

interface ContentModule {
  GAME: FullContext;
  CONTENT: FullContext['content'];
  LORE: Lore;
}

const RAW = readRawGameData();
const LORE_FILES = readLoreFiles();
const cycle: Record<string, unknown> = {};
cycle.self = cycle;
const sparseWithExtra: unknown[] = Array(2);
sparseWithExtra[1] = 'present';
Object.defineProperty(sparseWithExtra, '4294967296', { value: 'would be dropped', enumerable: true });
const loadModule = async (code: string): Promise<ContentModule> =>
  import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

/** Value equality does not catch changed registry iteration order, lost aliases or merged distinct objects. */
function sharedReferences(expected: object, actual: object): number {
  const forward = new WeakMap<object, object>();
  const backward = new WeakMap<object, object>();
  let references = 0;
  const visit = (left: unknown, right: unknown, path: string): void => {
    if (!left || typeof left !== 'object') return;
    if (!right || typeof right !== 'object') throw new Error(`${path}: object lost`);
    const previous = forward.get(left);
    if (previous) {
      if (right !== previous) throw new Error(`${path}: shared reference lost`);
      references++;
      return;
    }
    if (backward.has(right)) throw new Error(`${path}: distinct objects merged`);
    forward.set(left, right);
    backward.set(right, left);
    const keys = Object.keys(left);
    if (JSON.stringify(keys) !== JSON.stringify(Object.keys(right))) throw new Error(`${path}: property order changed`);
    for (const key of keys) visit((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], `${path}.${key}`);
  };
  visit(expected, actual, 'content');
  return references;
}

describe('production compiled content', () => {
  let compiled: CompiledGameContent;
  let module: ContentModule;
  beforeAll(async () => {
    compiled = compileGameContentFromDisk();
    module = await loadModule(compiled.code);
  });

  it('is strictly equal to the actual browser runtime GAME/LORE, including metadata, order and every alias', () => {
    expect(module.GAME).toStrictEqual(GAME);
    expect(module.LORE).toStrictEqual(LORE);
    expect(CONTENT).toBe(GAME.content);
    expect(module.CONTENT).toBe(module.GAME.content);
    expect(sharedReferences({ GAME, LORE }, { GAME: module.GAME, LORE: module.LORE })).toBe(compiled.stats.sharedReferences);
    expect(compiled.stats.sharedReferences).toBeGreaterThan(0);
    expect(compiled.stats.jsonBytes).toBeLessThan(Buffer.byteLength(JSON.stringify({ GAME, LORE })));
    expect(compiled.code).not.toMatch(/^\s*import\b/m);
  });

  it('keeps the same initial save, deterministic campaign result, rewards and story queue', () => {
    const now = 1_740_000_000_000;
    const runtime = newGame(GAME, now);
    const production = newGame(module.GAME, now);
    expect(production).toStrictEqual(runtime);
    const before = { type: 'beforeStage' as const, stageId: CONTENT.stages[0].id };
    expect(pendingScenes(runtime, before, GAME).length).toBeGreaterThan(0);
    expect(pendingScenes(production, before, module.GAME)).toStrictEqual(pendingScenes(runtime, before, GAME));
    for (const seed of [1, 103, 0xffff_ffff]) {
      const original = playStage(runtime, CONTENT.stages[0].id, seed, GAME, now);
      const built = playStage(production, module.CONTENT.stages[0].id, seed, module.GAME, now);
      expect(built).toStrictEqual(original);
      const after = { type: 'afterStage' as const, stageId: CONTENT.stages[0].id, firstClear: original.result.winner === 'A' };
      expect(pendingScenes(built.save, after, module.GAME)).toStrictEqual(pendingScenes(original.save, after, GAME));
    }
  });

  it('keeps all twelve heroes, both professions, advanced forms and personal-story spoiler gates', () => {
    const save = newGame(GAME, 0);
    for (const template of Object.values(CONTENT.heroes)) {
      for (const branch of template.branches) {
        const hero: HeroState = { id: 'h1', templateId: template.id, rarity: 'red', level: 100, branch: branch.job };
        expect(buildUnit(hero, module.GAME)).toStrictEqual(buildUnit(hero, GAME));
        for (const count of [0, 1, CONTENT.stages.length]) {
          const progress = { ...save, heroes: [hero], campaign: { cleared: CONTENT.stages.slice(0, count).map((stage) => stage.id) } };
          expect(heroStoryPieces(progress, template.id, module.LORE)).toStrictEqual(heroStoryPieces(progress, template.id, LORE));
        }
      }
    }
    expect(worldEntries(save, module.CONTENT, module.LORE)).toStrictEqual(worldEntries(save, CONTENT, LORE));
  });

  it('is deterministic and does not mutate raw inputs', () => {
    const raw = structuredClone(RAW);
    const files = structuredClone(LORE_FILES);
    const before = structuredClone({ raw, files });
    expect(compileGameContent(raw, files)).toStrictEqual(compiled);
    expect({ raw, files }).toStrictEqual(before);
  });

  it('uses the same schema and cross-reference validator as the runtime', () => {
    const raw = structuredClone(RAW);
    raw.quests = null;
    raw.tower = { ...(raw.tower as object), unlockAfterStage: 'missing_stage' };
    let runtimeProblems: string[] = [];
    try {
      buildGameContext(raw);
    } catch (error) {
      expect(error).toBeInstanceOf(ContentError);
      runtimeProblems = (error as ContentError).problems;
    }
    expect(runtimeProblems.length).toBeGreaterThan(1);
    expect(() => compileGameContent(raw, LORE_FILES)).toThrowError(ContentError);
    try {
      compileGameContent(raw, LORE_FILES);
    } catch (error) {
      expect((error as ContentError).problems).toStrictEqual(runtimeProblems);
    }
  });

  it('accepts absent/blank lore but blocks malformed lore and bad lore references before shipping', async () => {
    const files: RawFile[] = [{ file: 'data/lore/heroes.json', data: '   \n' }];
    const withoutLore = await loadModule(compileGameContent(RAW, files).code);
    expect(withoutLore.LORE).toStrictEqual(emptyLore());
    const malformed = [{ file: 'data/lore/heroes.json', data: '{bad JSON' }];
    expect(() => compileGameContent(RAW, malformed)).toThrowError(parseLore(malformed).problems[0]);
    const badRef = [{ file: 'data/lore/items.json', data: { entries: { missing_item: 'Такого предмета нет.' } } }];
    expect(() => compileGameContent(RAW, badRef)).toThrowError(/missing_item.*нет предмета/);
  });

  it('quotes arbitrary content as data and preserves a shared __proto__ field without changing prototypes', async () => {
    const raw = structuredClone(RAW);
    const text = '\"\'` ${globalThis.__compiledContentExecuted = true} \\\n\u2028\u2029 </script>';
    const shared = { text };
    const probe = { first: shared, ['__proto__']: shared };
    raw.combat = { ...GAME.combat, compiledContentProbe: probe } as unknown as CombatConfig;
    const built = await loadModule(compileGameContent(raw, []).code);
    expect(built.GAME).toStrictEqual(buildGameContext(raw));
    const result = (built.GAME.combat as unknown as { compiledContentProbe: typeof probe }).compiledContentProbe;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result['__proto__']).toBe(result.first);
    expect((globalThis as { __compiledContentExecuted?: boolean }).__compiledContentExecuted).toBeUndefined();
  });

  it.each([
    ['function', () => 1],
    ['Map', new Map([['key', 'value']])],
    ['undefined', undefined],
    ['non-finite number', Number.POSITIVE_INFINITY],
    ['negative zero', -0],
    ['cycle', cycle],
    ['sparse array with an extra field', sparseWithExtra],
  ])('rejects %s instead of silently changing the validated context', (_label, value) => {
    const raw = structuredClone(RAW);
    raw.combat = { ...GAME.combat, compiledContentProbe: value } as unknown as CombatConfig;
    expect(() => compileGameContent(raw, [])).toThrowError(ContentError);
    expect(() => compileGameContent(raw, [])).toThrowError(/compiledContentProbe/);
  });
});
