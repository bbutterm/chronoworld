import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  autoFormation,
  deletePreset,
  formationRank,
  heroPower,
  MetaError,
  newGame,
  parseMetaConfig,
  savePreset,
  withFeatures,
  withMeta,
  type HeroState,
  type SaveState,
} from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const ctx = withMeta(withFeatures(loadGameContext(), read('data/progression.json'), read('data/quests.json')), read('data/bounties.json'), read('data/achievements.json'));

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MetaError);
    return (e as MetaError).code;
  }
  return undefined;
}

function hero(id: string, job: string, jobLevel = 10): HeroState {
  return { id, name: id, job, jobLevel, jobExp: 0, jobHistory: [] };
}

function withHeroes(heroes: HeroState[]): SaveState {
  const s = newGame(ctx, 0);
  return { ...s, heroes, squad: [null, null, null, null, null] };
}

describe('K8 пресеты отряда', () => {
  it('savePreset: новый пресет из текущего отряда, id p1, p2…; не меняет исходный save', () => {
    const s = newGame(ctx, 0);
    const a = savePreset(s, '  Кампания  ', ctx);
    expect(a.preset).toEqual({ id: 'p1', name: 'Кампания', squad: s.squad });
    expect(s.presets).toEqual([]);
    const b = savePreset(a.save, 'Башня', ctx, { squad: ['h2', null, null, null, 'h1'] });
    expect(b.preset.id).toBe('p2');
    expect(b.save.presets.map((p) => p.id)).toEqual(['p1', 'p2']);
    // После удаления номер не переиспользуется, пока есть больший.
    const c = savePreset(deletePreset(b.save, 'p1'), 'Ещё', ctx);
    expect(c.preset.id).toBe('p3');
  });

  it('savePreset с id перезаписывает пресет', () => {
    const a = savePreset(newGame(ctx, 0), 'A', ctx).save;
    const b = savePreset(a, 'B', ctx, { id: 'p1', squad: [null, 'h3', null, null, null] }).save;
    expect(b.presets).toEqual([{ id: 'p1', name: 'B', squad: [null, 'h3', null, null, null] }]);
    expect(codeOf(() => savePreset(a, 'B', ctx, { id: 'p9' }))).toBe('unknown_preset');
  });

  it('лимит пресетов и проверки имени/отряда', () => {
    let s = newGame(ctx, 0);
    const max = ctx.meta.bounties.presets.max;
    for (let i = 0; i < max; i++) s = savePreset(s, `P${i}`, ctx).save;
    expect(codeOf(() => savePreset(s, 'лишний', ctx))).toBe('preset_limit');
    // Перезапись при полном списке разрешена.
    expect(savePreset(s, 'ok', ctx, { id: 'p1' }).save.presets).toHaveLength(max);
    const g = newGame(ctx, 0);
    expect(codeOf(() => savePreset(g, '   ', ctx))).toBe('invalid_preset_name');
    expect(codeOf(() => savePreset(g, 'x'.repeat(ctx.meta.bounties.presets.nameMaxLength + 1), ctx))).toBe('invalid_preset_name');
    expect(codeOf(() => savePreset(g, 'a', ctx, { squad: ['h1'] }))).toBe('invalid_squad');
    expect(codeOf(() => savePreset(g, 'a', ctx, { squad: ['h1', 'h1', null, null, null] }))).toBe('invalid_squad');
    expect(codeOf(() => savePreset(g, 'a', ctx, { squad: ['h99', null, null, null, null] }))).toBe('unknown_hero');
  });

  it('applyPreset ставит отряд; пропавшие герои → пустые слоты; неизвестный пресет → ошибка', () => {
    const s = savePreset(newGame(ctx, 0), 'A', ctx, { squad: ['h3', null, 'h1', null, null] }).save;
    expect(applyPreset(s, 'p1').squad).toEqual(['h3', null, 'h1', null, null]);
    const lost = { ...s, heroes: s.heroes.filter((h) => h.id !== 'h3') };
    expect(applyPreset(lost, 'p1').squad).toEqual([null, null, 'h1', null, null]);
    expect(codeOf(() => applyPreset(s, 'p2'))).toBe('unknown_preset');
    expect(codeOf(() => deletePreset(s, 'p2'))).toBe('unknown_preset');
    expect(deletePreset(s, 'p1').presets).toEqual([]);
  });
});

describe('K8 авто-расстановка', () => {
  it('ранги: танк < ближний < дальний < лекарь', () => {
    expect(formationRank(hero('a', 'swordman'), ctx)).toBe(0);
    expect(formationRank(hero('a', 'thief'), ctx)).toBe(1);
    expect(formationRank(hero('a', 'archer'), ctx)).toBe(2);
    expect(formationRank(hero('a', 'acolyte'), ctx)).toBe(3);
  });

  it('берёт 5 сильнейших по heroPower', () => {
    const heroes = [hero('h1', 'novice', 1), hero('h2', 'swordman', 20), hero('h3', 'archer', 20), hero('h4', 'acolyte', 20), hero('h5', 'thief', 20), hero('h6', 'novice', 2), hero('h7', 'mage', 20)];
    const s = withHeroes(heroes);
    const squad = autoFormation(s, ctx);
    const expected = [...heroes]
      .sort((a, b) => heroPower(b, ctx, s) - heroPower(a, ctx, s) || a.id.localeCompare(b.id))
      .slice(0, 5)
      .map((h) => h.id)
      .sort();
    expect(squad.filter((x) => x !== null).sort()).toEqual(expected);
  });

  it('танки спереди (0–1), лекари и дальний бой сзади (2–4)', () => {
    const s = withHeroes([hero('h1', 'acolyte'), hero('h2', 'archer'), hero('h3', 'swordman'), hero('h4', 'mage'), hero('h5', 'knight', 1)]);
    const squad = autoFormation(s, ctx);
    const role = (id: string | null) => formationRank(s.heroes.find((h) => h.id === id)!, ctx);
    expect(squad.slice(0, 2).map(role)).toEqual([0, 0]);
    expect(squad.slice(2).every((id) => role(id) >= 2)).toBe(true);
    // Лекарь — в самом тылу.
    expect(squad[4]).toBe('h1');
  });

  it('при нехватке танков спереди встаёт ближний бой, при нехватке задних — остальные', () => {
    const s = withHeroes([hero('h1', 'thief'), hero('h2', 'thief'), hero('h3', 'thief'), hero('h4', 'thief'), hero('h5', 'acolyte')]);
    const squad = autoFormation(s, ctx);
    expect(squad[4]).toBe('h5');
    expect(squad.slice(0, 4).sort()).toEqual(['h1', 'h2', 'h3', 'h4']);
  });

  it('равная мощь → по id; меньше 5 героев → пустые слоты; детерминизм', () => {
    const six = withHeroes(['h6', 'h3', 'h1', 'h5', 'h2', 'h4'].map((id) => hero(id, 'novice', 5)));
    expect(autoFormation(six, ctx)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5']);
    const two = withHeroes([hero('h2', 'acolyte'), hero('h1', 'swordman')]);
    expect(autoFormation(two, ctx)).toEqual(['h1', null, null, null, 'h2']);
    expect(autoFormation(six, ctx)).toEqual(autoFormation(six, ctx));
  });
});

describe('конфиг meta', () => {
  it('data/*.json разбираются; битый конфиг → MetaError invalid_config с путём', () => {
    const b = read('data/bounties.json');
    const a = read('data/achievements.json');
    expect(() => parseMetaConfig(b, a)).not.toThrow();
    const dupT = structuredClone(b);
    dupT.templates.push(dupT.templates[0]);
    expect(() => parseMetaConfig(dupT, a)).toThrow(/встречается дважды/);
    const badRarity = structuredClone(b);
    badRarity.templates[0].rarity = 'mythic';
    expect(codeOf(() => parseMetaConfig(badRarity, a))).toBe('invalid_config');
    const emptyRarity = structuredClone(b);
    emptyRarity.rarities.legendary = 1;
    expect(() => parseMetaConfig(emptyRarity, a)).toThrow(/legendary/);
    const badCounter = structuredClone(a);
    badCounter.achievements[0].counter = 'nope';
    expect(() => parseMetaConfig(b, badCounter)).toThrow(/achievements\.json: achievements\.0\.counter/);
    const dupA = structuredClone(a);
    dupA.achievements.push(dupA.achievements[0]);
    expect(codeOf(() => parseMetaConfig(b, dupA))).toBe('invalid_config');
  });
});
