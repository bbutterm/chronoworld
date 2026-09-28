/**
 * content:check, раздел 8 (scripts/lib/content-check-heroes.ts): листы и портреты карточек героев, выдача Таверны.
 * Нет арта — предупреждение; сломанная ссылка (лист не находится вообще, карточку Таверна не выдаёт) — ошибка.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectGameContext, type GameContext, type HeroTemplate } from '../src/core';
import { buildRegistry, type LegacySprites, type SpriteDef, type SpritesV2 } from '../src/pipeline/sprites';
import { lintHeroes } from '../scripts/lib/content-check-heroes';
import { readRawGameData, ROOT } from '../scripts/lib/content-node';

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;
const ctx = collectGameContext(readRawGameData()).ctx!;
const registry = buildRegistry(readJson<LegacySprites>('assets/sprites.legacy.json'), readJson<SpritesV2>('assets/sprites/sprites.json'));

/** Контекст с подменёнными карточками героев. */
const withHeroes = (patch: Record<string, HeroTemplate>): GameContext => ({ ...ctx, content: { ...ctx.content, heroes: { ...ctx.content.heroes, ...patch } } });

describe('content:check — карточки героев и Таверна', () => {
  it('данные репозитория: ошибок нет, листы карточек попадают в проверку файлов', () => {
    const r = lintHeroes(ctx, registry, {});
    expect(r.errors).toEqual([]);
    expect(r.sprites.size).toBeGreaterThan(5);
    for (const s of r.sprites) expect(registry[s]).toBeDefined();
  });

  it('нет своего листа — ⚠ (откат на лист класса); лист класса не находится вовсе — ✗', () => {
    const kai = ctx.content.heroes.kai;
    const r = lintHeroes(withHeroes({ kai: { ...kai, visual: { sprite: 'no_such_sheet' } } }), registry, {});
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes('карточка kai: листа "no_such_sheet" нет в реестре'))).toBe(true);

    const classSheet = ctx.content.jobs.mage.visual.sprite;
    const bare: Record<string, SpriteDef> = Object.fromEntries(Object.entries(registry).filter(([id]) => !id.startsWith(classSheet)));
    const broken = lintHeroes(ctx, bare, {});
    expect(broken.errors.some((e) => e.startsWith('карточка kai: лист'))).toBe(true);
  });

  it('лист без портрета и лист чужого пола — предупреждения', () => {
    const sheet = [...lintHeroes(ctx, registry, {}).sprites][0];
    const noPortrait = { ...registry, [sheet]: { ...registry[sheet], portrait: undefined } };
    expect(lintHeroes(ctx, noPortrait, {}).warnings.some((w) => w.startsWith('листы карточек без портрета') && w.includes(sheet))).toBe(true);

    const r = lintHeroes(ctx, registry, { [sheet]: 'x' });
    expect(r.warnings.some((w) => w.startsWith('карточки без листа своего пола') && w.includes(sheet))).toBe(true);
  });

  it('листы веток: своего листа нет — ⚠ и откат на лист класса; visual.portrait — ⚠ (игра его не читает)', () => {
    const kai = ctx.content.heroes.kai;
    const gen = { ...kai, id: 'gen', name: 'Генерал', visual: { portrait: 'x.png' }, branches: kai.branches.map((b) => ({ ...b, visual: { sprite: 'no_such_sheet' } })) };
    const r = lintHeroes(withHeroes({ gen }), registry, {});
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.startsWith('карточка gen: листа "no_such_sheet" нет в реестре'))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('карточка gen: visual.portrait'))).toBe(true);
    // Лист формы ветки (Кай-Волшебник) — откат на лист класса Волшебника.
    expect(r.sprites.has(ctx.content.jobs.wizard.visual.sprite)).toBe(true);
  });
});
