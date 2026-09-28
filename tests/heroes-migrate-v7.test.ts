/**
 * Миграция сохранения v6 → v7 (герои v2, docs/design/heroes-v2.md, раздел 8.1; src/core/heroes/migrate-v7.ts):
 * 13 старых фиолетовых шаблонов → герой + ветка, сюжетные фиолетовые → своя прежняя ветка, дубли в отряде и пресетах —
 * остаётся сильнейший, осколки → копии героя, почта → «Контракт героя», Лавка и экспедиции, 10 свитков и сообщение.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deserialize, heroCard, loadOrNew, MemoryStorage, migrateHeroesV2, MIGRATIONS, needsBranch, persist, SAVE_VERSION, serialize } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { fuzzSeeds, saveProblems } from './invariants';
import { Rng } from '../src/core/rng';

const ctx = loadFullContext();
const fixtureV6 = readFileSync(join(import.meta.dirname, 'fixtures/save-v6.json'), 'utf8');
const fixtureV3 = readFileSync(join(import.meta.dirname, 'fixtures/save-v3.json'), 'utf8');

/** Таблица перевода (раздел 8.1): старый шаблон → герой и ветка. */
const TABLE: Record<string, [string, string]> = {
  seyren: ['alan', 'knight'],
  randel: ['alan', 'crusader'],
  cecil: ['meilin', 'hunter'],
  alphoccio: ['bran', 'bard'],
  trentini: ['meilin', 'dancer'],
  kathryne: ['lira', 'wizard'],
  celia: ['lira', 'sage'],
  eremes: ['dorn', 'assassin'],
  gertie: ['zara', 'rogue'],
  margaretha: ['vika', 'priest'],
  chen: ['teo', 'monk'],
  howard: ['otto', 'blacksmith'],
  flamel: ['otto', 'alchemist'],
};

describe('миграция v6 → v7: герои v2', () => {
  const raw = JSON.parse(fixtureV6);
  const s = deserialize(fixtureV6);
  const hero = (id: string) => s.heroes.find((h) => h.id === id)!;

  it('версия и цепочка: MIGRATIONS[6] после экспедиций (MIGRATIONS[5])', () => {
    expect(SAVE_VERSION).toBe(7);
    expect(MIGRATIONS[6]).toBeTypeOf('function');
    expect(MIGRATIONS[6](raw).version).toBe(7);
    expect(s.version).toBe(7);
    expect(s).not.toHaveProperty('shards');
    expect(s.revision).toBe(41);
  });

  it('каждый из 13 старых шаблонов → герой и ветка, редкость и уровень те же, форма ветки действует', () => {
    for (const [old, [to, branch]] of Object.entries(TABLE)) {
      const out = migrateHeroesV2({ version: 6, heroes: [{ id: 'h1', templateId: old, rarity: 'purple', level: 45, locked: true }], squad: ['h1', null, null, null, null] });
      expect(out.heroes[0], old).toEqual({ id: 'h1', templateId: to, rarity: 'purple', level: 45, locked: true, branch });
      expect(heroCard(out.heroes[0], ctx).job).toBe(branch);
      expect(out.currency).toBeUndefined(); // нет currency — не создаём (SaveStateSchema поймает битое сохранение)
    }
    // Фикстура: id экземпляров те же, отряд/пресеты/экспедиции/надетые вещи указывают на них же.
    expect(s.heroes.slice(0, raw.heroes.length).map((h) => h.id)).toEqual(raw.heroes.map((h: { id: string }) => h.id));
    expect(hero('h5')).toMatchObject({ templateId: 'alan', branch: 'knight', rarity: 'purple', level: 45, locked: true });
    expect(hero('h6')).toMatchObject({ templateId: 'vika', branch: 'priest', rarity: 'purple', level: 38 });
    expect(hero('h7')).toMatchObject({ templateId: 'dorn', branch: 'assassin', isNew: true });
    expect(hero('h9')).toMatchObject({ templateId: 'otto', branch: 'blacksmith', rarity: 'gold', level: 61 });
    expect(hero('h10')).toMatchObject({ templateId: 'otto', branch: 'alchemist', rarity: 'purple', level: 1 });
    expect(hero('h13')).toMatchObject({ templateId: 'meilin', branch: 'dancer' });
    expect(s.inventory).toEqual(raw.inventory);
  });

  it('сюжетные на фиолетовом → прежняя ветка; первые призывные — без изменений (фиолетовый без ветки — «Выберите ветку!»)', () => {
    expect(hero('h1')).toEqual({ id: 'h1', templateId: 'alan', rarity: 'purple', level: 45, branch: 'knight' });
    expect(hero('h2')).toEqual({ id: 'h2', templateId: 'bran', rarity: 'blue', level: 33 });
    expect(hero('h8')).toEqual({ id: 'h8', templateId: 'kai', rarity: 'purple', level: 41 });
    expect(needsBranch(hero('h8'), ctx)).toBe(true);
    for (const [id, branch] of [
      ['bran', 'hunter'],
      ['vika', 'priest'],
      ['greta', 'blacksmith'],
      ['dorn', 'rogue'],
    ]) {
      const out = migrateHeroesV2({ version: 6, heroes: [{ id: 'h1', templateId: id, rarity: 'gold', level: 70 }] });
      expect(out.heroes[0].branch).toBe(branch);
    }
  });

  it('два экземпляра героя в отряде / пресете — остаётся сильнейший; в экспедиции дубли не трогаются', () => {
    // h1 Алан фиол. 45 и h5 бывший Сейрен фиол. 45 — равны: остаётся первый.
    expect(s.squad).toEqual(['h1', null, 'h9', 'h2', 'h3']);
    // p1: Вика синяя (h3) и Вика-Жрица фиол. (h6) — остаётся h6; Алан h1/h5 — h1.
    expect(s.presets).toEqual([
      { id: 'p1', name: 'Лекари', squad: [null, 'h6', 'h1', null, null] },
      { id: 'p2', name: 'Кузнецы', squad: ['h9', null, null, null, null] },
    ]);
    expect(s.bounties.active[0].heroIds).toEqual(['h9', 'h10']);
  });

  it('осколки → копии того же героя: 10 осколков (вверх) — зелёная, 3 зелёные — синяя', () => {
    const added = s.heroes.slice(raw.heroes.length);
    // alan 12 → 2 зел.; bran 25 → 3 зел. = 1 син.; vika 0 — ничего; greta 41 → 5 зел. = 1 син. + 2 зел.
    expect(added.map((h) => [h.id, h.templateId, h.rarity, h.level, h.isNew])).toEqual([
      ['h14', 'alan', 'green', 1, true],
      ['h15', 'alan', 'green', 1, true],
      ['h16', 'bran', 'blue', 1, true],
      ['h17', 'greta', 'blue', 1, true],
      ['h18', 'greta', 'green', 1, true],
      ['h19', 'greta', 'green', 1, true],
    ]);
  });

  it('Таверна, почта, Лавка, экспедиции', () => {
    expect(s.summon).toMatchObject({ seq: 5, total: 42, sincePurple: 11, sinceBlue: 0 });
    expect(s.summon.discovered).toEqual(['alan', 'bran', 'vika', 'kai', 'dorn', 'greta', 'otto', 'iris', 'meilin']);
    // Незабранное письмо: Сейрен → «Контракт героя», Ирис остаётся; забранное — как было.
    expect(s.mail.letters[0].rewards).toEqual({ gems: 10, heroes: ['iris'], heroPicks: [{ rarity: 'purple' }] });
    expect(s.mail.letters[1].rewards).toEqual({ heroes: ['margaretha'] });
    // Лавка: слот осколков Греты → зелёная карта Греты, цена та же.
    expect(s.shop!.slots[0]).toEqual({ good: 'shards_small', kind: 'heroCard', hero: 'greta', rarity: 'green', count: 1, currency: 'gold', price: 8000, stock: 1, bought: 0 });
    expect(s.shop!.slots[1]).toEqual(raw.shop.slots[1]);
    // Экспедиция в пути: 2 осколка → +10 гемов, карт героя нет.
    expect(s.bounties.active[0].rewards).toEqual({ gold: 180, jobExp: 240, gems: 13, heroCards: { blue: 0, purple: 0 }, scrolls: 0, items: [] });
  });

  it('сообщение и 10 свитков; после загрузки — предупреждения, сохранение целое', () => {
    expect(s.currency).toEqual({ gems: 340, scrolls: 12 });
    expect(s.notices).toHaveLength(2);
    expect(s.notices![0]).toMatch(/Сейрен Виндзор теперь Алан-Рыцарь \(фиолетовый, ур\. 45\)/);
    expect(s.notices![0]).toMatch(/Говард Альт-Айзен теперь Отто-Кузнец/);
    expect(s.notices![0]).toMatch(/10 свитков/);
    expect(s.notices![1]).toMatch(/Грета: 41 осколков → 1 син\. и 2 зел\. копии/);
    const storage = new MemoryStorage();
    storage.save(fixtureV6);
    const r = loadOrNew(storage, ctx, 1_759_100_000_000);
    expect(r.source).toBe('loaded');
    // Сообщения миграции — первыми; последним — sanitizeSave: в главе 1 вставлены этапы перед пройденными (28.09, 18 этапов).
    expect(r.warnings!.slice(0, s.notices!.length)).toEqual(s.notices);
    expect(r.warnings!.slice(s.notices!.length)).toEqual([expect.stringMatching(/новые этапы перед уже пройденными — они засчитаны пройденными/)]);
    expect(saveProblems(r.save, ctx)).toEqual([]);
    persist(storage, r.save);
    expect(loadOrNew(storage, ctx, 0).warnings).toBeUndefined();
  });

  it('без старых шаблонов и осколков — ни свитков, ни сообщения; исходный объект не меняется', () => {
    const plain = { version: 6, heroes: [{ id: 'h1', templateId: 'alan', rarity: 'green', level: 3 }], squad: ['h1', null, null, null, null], currency: { gems: 1, scrolls: 0 }, shards: {} };
    const copy = structuredClone(plain);
    const out = migrateHeroesV2(plain);
    expect(plain).toEqual(copy);
    expect(out.currency).toEqual({ gems: 1, scrolls: 0 });
    expect(out.notices).toBeUndefined();
    expect(out).not.toHaveProperty('shards');
    const copy6 = structuredClone(raw);
    MIGRATIONS[6](raw);
    expect(raw).toEqual(copy6);
  });

  it('serialize/deserialize после миграции — то же самое; цепочка v3 → v7 (старая фикстура) цела', () => {
    expect(deserialize(serialize(s))).toEqual(s);
    const v3 = deserialize(fixtureV3);
    expect(v3.version).toBe(7);
    expect(saveProblems(v3, ctx)).toEqual([]);
  });

  it('фазз: случайные v6 с шаблонами старых и новых героев мигрируют в целое сохранение', () => {
    const OLD = [...Object.keys(TABLE), ...Object.keys(ctx.content.heroes)];
    const R = ['green', 'blue', 'purple', 'gold', 'red'];
    const cap = [20, 40, 60, 80, 100];
    const base = JSON.parse(fixtureV6);
    for (const seed of fuzzSeeds(200, 30)) {
      const rng = new Rng(seed);
      const n = 1 + rng.int(10);
      const heroes = Array.from({ length: n }, (_, i) => {
        const r = rng.int(5);
        return { id: `h${i + 1}`, templateId: OLD[rng.int(OLD.length)], rarity: R[r], level: 1 + rng.int(cap[r]) };
      });
      const ids = heroes.map((h) => h.id);
      const squad = Array.from({ length: 5 }, (_, i) => (i < ids.length && rng.next() < 0.7 ? ids[i] : null));
      const shards = Object.fromEntries(['alan', 'bran', 'vika', 'greta', 'dorn', 'seyren'].map((t) => [t, rng.int(80)]));
      const v6 = { ...base, heroes, squad, presets: [{ id: 'p1', name: 'x', squad: [...squad].reverse() }], bounties: { active: [] }, inventory: { items: [] }, shards };
      const text = JSON.stringify(v6);
      const out = deserialize(text);
      expect(out.version).toBe(7);
      const r = loadOrNew({ load: () => text, save: () => {}, clear: () => {} }, ctx, 1_759_100_000_000);
      expect(r.source, `seed ${seed}`).toBe('loaded');
      expect(saveProblems(r.save, ctx), `seed ${seed}`).toEqual([]);
      expect(serialize(deserialize(serialize(r.save)))).toBe(serialize(r.save));
    }
  });
});
