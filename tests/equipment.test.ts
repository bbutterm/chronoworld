import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  actEquip,
  actPlayStage,
  actSkipStage,
  actUnequip,
  addItems,
  buildItems,
  buildUnit,
  equip,
  EquipmentError,
  equipmentStats,
  heroEquipment,
  heroPower,
  heroSlots,
  newGame,
  parseDrops,
  playStage,
  rollDrops,
  squadPower,
  statsAt,
  unequip,
  validateEquipment,
  withEquipment,
  withFeatures,
  withGear,
  type RawFile,
  type SaveState,
} from '../src/core';
import { loadGameContext, readJsonDir } from '../scripts/lib/content-node';

const root = join(import.meta.dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));

/** Экипировка с диска для тестов и скриптов: data/items/*.json + data/drops.json. */
function loadItemFiles(): RawFile[] {
  return readJsonDir('data/items');
}

const base = withFeatures(loadGameContext(), read('data/progression.json'), read('data/quests.json'));
const ctx = withEquipment(base, loadItemFiles(), read('data/drops.json'));
const D1 = '2026-09-26';
const s1 = ctx.content.stages[0].id;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EquipmentError);
    return (e as EquipmentError).code;
  }
  return undefined;
}

/** Новая игра с героями h1 (swordman) и h2 (archer) и предметами в инвентаре. */
function game(itemIds: string[]): SaveState {
  const s = newGame(ctx, 0, D1);
  const heroes = s.heroes.map((h, i) => (i === 0 ? { ...h, job: 'swordman' } : i === 1 ? { ...h, job: 'archer' } : h));
  return addItems({ ...s, heroes }, itemIds).save;
}

describe('K6 данные', () => {
  it('data/items и data/drops.json валидны, ссылки целы', () => {
    const items = Object.values(ctx.equipment.items);
    expect(items.length).toBeGreaterThanOrEqual(12);
    for (const slot of ['weapon', 'armor', 'helmet', 'boots'] as const) {
      for (const rarity of ['common', 'rare', 'epic'] as const) {
        expect(items.some((i) => i.slot === slot && i.rarity === rarity), `${slot}/${rarity}`).toBe(true);
      }
    }
    expect(validateEquipment(ctx.equipment, ctx)).toEqual([]);
  });

  it('ошибки схемы и повтор id → invalid_config', () => {
    const bad = { file: 'x.json', data: { items: [{ id: 'a', name: 'A', slot: 'ring', rarity: 'common', stats: {} }] } };
    expect(codeOf(() => buildItems([bad]))).toBe('invalid_config');
    const one = { id: 'a', name: 'A', slot: 'weapon', rarity: 'common', stats: { atk: 1 } };
    expect(codeOf(() => buildItems([{ file: 'a', data: { items: [one] } }, { file: 'b', data: { items: [one] } }]))).toBe('invalid_config');
    expect(codeOf(() => parseDrops({ rules: [{ chance: 2, rarityWeights: { common: 1 } }] }))).toBe('invalid_config');
    expect(codeOf(() => parseDrops({ rules: [{ chance: 0.5, rarityWeights: { common: 0 } }] }))).toBe('invalid_config');
    const cfg = { items: buildItems([{ file: 'a', data: { items: [{ ...one, jobs: ['nope'] }] } }]), drops: parseDrops({ rules: [{ chapter: 'nope', chance: 0, rarityWeights: { common: 1 } }] }) };
    expect(validateEquipment(cfg, ctx).length).toBe(3);
  });
});

describe('K6 надеть / снять', () => {
  it('equip, замена в том же слоте, unequip', () => {
    let s = game(['sword', 'gladius', 'chain_mail']);
    const [sword, gladius, mail] = s.inventory.items.map((i) => i.id);
    s = equip(s, 'h1', sword, ctx);
    s = equip(s, 'h1', mail, ctx);
    expect(heroEquipment(s, 'h1').map((i) => i.itemId)).toEqual(['sword', 'chain_mail']);
    const s2 = equip(s, 'h1', gladius, ctx);
    expect(heroEquipment(s2, 'h1').map((i) => i.itemId).sort()).toEqual(['chain_mail', 'gladius']);
    expect(s2.inventory.items.find((i) => i.id === sword)!.equippedBy).toBeNull();
    expect(heroSlots(s2, 'h1', ctx).weapon?.def.id).toBe('gladius');
    expect(s.inventory.items.find((i) => i.id === sword)!.equippedBy).toBe('h1'); // исходный save не менялся
    expect(equip(s2, 'h1', gladius, ctx)).toBe(s2);
    const s3 = unequip(s2, gladius);
    expect(heroEquipment(s3, 'h1').map((i) => i.itemId)).toEqual(['chain_mail']);
    expect(unequip(s3, gladius)).toBe(s3);
  });

  it('предмет надет только на одного героя', () => {
    let s = game(['knife']);
    const knife = s.inventory.items[0].id;
    s = equip(s, 'h1', knife, ctx);
    expect(codeOf(() => equip(s, 'h2', knife, ctx))).toBe('item_equipped_by_other');
    s = equip(unequip(s, knife), 'h2', knife, ctx);
    expect(heroEquipment(s, 'h2')).toHaveLength(1);
    expect(heroEquipment(s, 'h1')).toHaveLength(0);
  });

  it('ограничение по профессии (с учётом ветки)', () => {
    let s = game(['bow', 'claymore']);
    const [bow, claymore] = s.inventory.items.map((i) => i.id);
    expect(codeOf(() => equip(s, 'h1', bow, ctx))).toBe('job_restricted');
    expect(codeOf(() => equip(s, 'h2', claymore, ctx))).toBe('job_restricted');
    s = equip(s, 'h2', bow, ctx);
    // охотник — потомок лучника: лук подходит
    const hunter = { ...s, heroes: s.heroes.map((h) => (h.id === 'h1' ? { ...h, job: 'hunter' } : h)) };
    expect(heroEquipment(equip(unequip(hunter, bow), 'h1', bow, ctx), 'h1')).toHaveLength(1);
  });

  it('ошибки: неизвестные герой, экземпляр, описание', () => {
    const s = game(['knife']);
    const knife = s.inventory.items[0].id;
    expect(codeOf(() => equip(s, 'nope', knife, ctx))).toBe('unknown_hero');
    expect(codeOf(() => equip(s, 'h1', 'nope', ctx))).toBe('unknown_item');
    expect(codeOf(() => unequip(s, 'nope'))).toBe('unknown_item');
    const ghost = addItems(s, ['removed_item']).save;
    expect(codeOf(() => equip(ghost, 'h1', ghost.inventory.items[1].id, ctx))).toBe('unknown_item_def');
  });

  it('actEquip / actUnequip = equip / unequip', () => {
    const s = game(['knife']);
    const knife = s.inventory.items[0].id;
    const e = actEquip(s, 'h1', knife, ctx);
    expect(e).toEqual(equip(s, 'h1', knife, ctx));
    expect(actUnequip(e, knife)).toEqual(s);
  });

  it('addItems: id экземпляров уникальны и детерминированы', () => {
    const a = addItems(game([]), ['knife', 'cap']);
    expect(a.added.map((i) => i.id)).toEqual(['it1', 'it2']);
    expect(addItems(a.save, ['knife']).added[0].id).toBe('it3');
  });
});

describe('K6 статы и мощь', () => {
  it('equipmentStats суммирует плоские прибавки', () => {
    const i = ctx.equipment.items;
    expect(equipmentStats([i.sword, i.chain_mail, i.sleipnir])).toEqual({
      hp: (i.chain_mail.stats.hp ?? 0) + (i.sleipnir.stats.hp ?? 0),
      atk: i.sword.stats.atk,
      def: i.chain_mail.stats.def,
      spd: i.sleipnir.stats.spd,
    });
  });

  it('buildUnit: явный gear, ctx.heroGear через withGear, без экипировки — как раньше', () => {
    let s = game(['sword', 'chain_mail']);
    for (const it of s.inventory.items) s = equip(s, 'h1', it.id, ctx);
    const hero = s.heroes[0];
    const plain = buildUnit(hero, ctx);
    expect(plain.stats).toEqual(statsAt(ctx.content.jobs.swordman, 1));
    const bonus = equipmentStats([ctx.equipment.items.sword, ctx.equipment.items.chain_mail]);
    const geared = buildUnit(hero, withGear(ctx, s));
    expect(geared.stats.atk).toBe(plain.stats.atk + bonus.atk);
    expect(geared.stats.hp).toBe(plain.stats.hp + bonus.hp);
    expect(geared.stats.def).toBe(plain.stats.def + bonus.def);
    expect(buildUnit(hero, ctx, bonus)).toEqual(geared);
  });

  it('экипировка применяется в бою actPlayStage (hp героя в итоге боя)', () => {
    let s = game(['full_plate']);
    s = equip(s, 'h1', s.inventory.items[0].id, ctx);
    const out = actPlayStage(s, D1, s1, 1, ctx);
    const plate = ctx.equipment.items.full_plate.stats.hp ?? 0;
    const u = out.result.units.find((x) => x.side === 'A' && x.unitId === 'h1');
    expect(u).toBeDefined();
    expect(u!.maxHp).toBe(statsAt(ctx.content.jobs.swordman, 1).hp + plate);
  });

  it('мощь героя и отряда растёт от экипировки', () => {
    let s = game(['sword']);
    const hero = s.heroes[0];
    const p0 = heroPower(hero, ctx, s);
    const sq0 = squadPower(s, ctx);
    s = equip(s, 'h1', s.inventory.items[0].id, ctx);
    expect(heroPower(hero, ctx, s)).toBeGreaterThan(p0);
    expect(heroPower(hero, ctx)).toBe(p0); // без save — без экипировки
    expect(squadPower(s, ctx)).toBeGreaterThan(sq0);
    expect(squadPower(s, base)).toBe(sq0); // без ctx.equipment экипировка не учитывается
  });
});

describe('K6 выпадение', () => {
  it('rollDrops детерминирован по seed; первое прохождение — гарантированно 1 предмет', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const a = rollDrops(s1, seed, true, ctx);
      expect(a).toHaveLength(1);
      expect(ctx.equipment.items[a[0]]).toBeDefined();
      expect(rollDrops(s1, seed, true, ctx)).toEqual(a);
      expect(rollDrops(s1, seed, false, ctx)).toEqual(rollDrops(s1, seed, false, ctx));
    }
  });

  it('повтор: доля выпадений ≈ chance, есть и пустые', () => {
    let got = 0;
    for (let seed = 1; seed <= 1000; seed++) got += rollDrops(s1, seed, false, ctx).length;
    expect(got).toBeGreaterThan(200);
    expect(got).toBeLessThan(400);
  });

  it('chance 0 без гарантии — ничего; веса только epic — только epic', () => {
    const none = { ...ctx, equipment: { ...ctx.equipment, drops: parseDrops({ rules: [{ chance: 0, rarityWeights: { common: 1 }, firstClearGuaranteed: false }] }) } };
    expect(rollDrops(s1, 7, true, none)).toEqual([]);
    const epic = { ...ctx, equipment: { ...ctx.equipment, drops: parseDrops({ rules: [{ chance: 1, rarityWeights: { epic: 1 } }] }) } };
    for (let seed = 1; seed <= 20; seed++) expect(ctx.equipment.items[rollDrops(s1, seed, false, epic)[0]].rarity).toBe('epic');
  });

  it('actPlayStage: победа при первом прохождении добавляет предмет в инвентарь; поражение — нет', () => {
    const s = game([]);
    let win = 0;
    for (let seed = 1; seed <= 50 && !win; seed++) if (playStage(s, s1, seed, ctx).result.winner === 'A') win = seed;
    const out = actPlayStage(s, D1, s1, win, ctx);
    expect(out.drops).toHaveLength(1);
    expect(out.save.inventory.items).toEqual(out.drops);
    expect(out.drops[0].itemId).toBe(rollDrops(s1, win, true, ctx)[0]);
    expect(actPlayStage(s, D1, s1, win, ctx)).toEqual(out);
    // без ctx.equipment — как раньше
    expect(actPlayStage(s, D1, s1, win, base).drops).toEqual([]);

    const lone = { ...s, squad: [s.heroes[0].id, null, null, null, null], campaign: { cleared: ctx.content.stages.slice(0, -1).map((x) => x.id) } };
    const hard = ctx.content.stages[ctx.content.stages.length - 1].id;
    let losses = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = actPlayStage(lone, D1, hard, seed, ctx);
      if (r.result.winner !== 'A') {
        losses++;
        expect(r.drops).toEqual([]);
        expect(r.save.inventory.items).toEqual([]);
      }
    }
    expect(losses).toBeGreaterThan(0);
  });

  it('actSkipStage: пройденный этап — не первое прохождение (по chance)', () => {
    const s = { ...game([]), campaign: { cleared: [s1] } };
    for (let seed = 1; seed <= 20; seed++) {
      const out = actSkipStage(s, D1, s1, seed, ctx);
      const expected = out.result.winner === 'A' ? rollDrops(s1, seed, false, ctx) : [];
      expect(out.drops.map((d) => d.itemId)).toEqual(expected);
    }
  });
});
