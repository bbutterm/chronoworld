/**
 * V: регрессии найденных при ревью ошибок корректности.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  actEquip,
  addItems,
  claimActivity,
  claimQuest,
  ContentError,
  maxHeroJobLevel,
  newGame,
  recordActivity,
  withEquipment,
  withFeatures,
  type SaveState,
} from '../src/core';
import { loadGameContext, readJsonDir } from '../scripts/lib/content-node';
import { content, skill, unitDef } from './helpers';

const root = join(import.meta.dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const D1 = '2026-09-26';

describe('V: actEquip и счётчик items_equipped', () => {
  const base = withFeatures(loadGameContext(), read('data/progression.json'), read('data/quests.json'));
  const ctx = withEquipment(base, readJsonDir('data/items'), read('data/drops.json'));

  it('повторное надевание уже надетого предмета (двойное нажатие) не засчитывается как новое надевание', () => {
    const s0 = newGame(ctx, 0, D1);
    const heroes = s0.heroes.map((h, i) => (i === 0 ? { ...h, job: 'swordman' } : h));
    const s = addItems({ ...s0, heroes }, ['knife']).save;
    const id = s.inventory.items[0].id;
    const once = actEquip(s, 'h1', id, ctx);
    expect(once.achievements.counters.items_equipped).toBe(1);
    const twice = actEquip(once, 'h1', id, ctx);
    expect(twice.achievements.counters.items_equipped).toBe(1);
    expect(twice).toBe(once);
  });
});

describe('V: claimActivity обновляет счётчики-«максимумы» достижений', () => {
  const base = loadGameContext();
  const ctx = withFeatures(base, read('data/progression.json'), {
    quests: [{ id: 'win', name: 'Победы', event: 'stage_win', target: 1, points: 10 }],
    milestones: [{ points: 10, rewards: { jobExp: 100000 } }],
  });

  it('опыт порога активности поднял джоб-уровень — hero_max_job_level сразу учитывает его', () => {
    let s: SaveState = newGame(ctx, 0, D1);
    s = recordActivity(s, D1, 'stage_win');
    s = claimQuest(s, D1, 'win', ctx).save;
    const r = claimActivity(s, D1, 10, ctx);
    expect(maxHeroJobLevel(r.save)).toBeGreaterThan(1);
    expect(r.save.achievements.counters.hero_max_job_level).toBe(maxHeroJobLevel(r.save));
  });
});

describe('V: цикл fallback навыков', () => {
  it('fallback, ведущий по кругу, — ошибка контента, а не бесконечная рекурсия в бою', () => {
    const heal = (id: string, fallback: string) =>
      skill(id, { target: { side: 'ally', pick: 'lowestHp', onlyWounded: true }, effects: [{ type: 'heal', k: 1 }], fallback });
    expect(() => content([unitDef('medic', { skills: { basic: 'h1', passives: [] } })], [heal('h1', 'h2'), heal('h2', 'h1')])).toThrow(ContentError);
    expect(() => content([unitDef('medic', { skills: { basic: 'h1', passives: [] } })], [heal('h1', 'h1')])).toThrow(/fallback/);
  });
});
