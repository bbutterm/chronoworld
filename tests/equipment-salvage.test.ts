import { describe, expect, it } from 'vitest';
import { addHeroCard, addItems, deserialize, equip, heroesWanting, lockItem, newGame, salvageItems, salvagePlan, salvageProtection, serialize, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const ordinary = Object.values(ctx.equipment.items).find((it) => it.rarity === 'common')!;
const rare = Object.values(ctx.equipment.items).find((it) => it.rarity === 'rare')!;
const epic = Object.values(ctx.equipment.items).find((it) => it.rarity === 'epic')!;

function inventory(): SaveState {
  return addItems(newGame(ctx, 0), [ordinary.id, ordinary.id, ordinary.id, rare.id, rare.id, epic.id, epic.id]).save;
}

/** Каждый герой в вещи rare (слот у ordinary и rare один — броня): запасные ordinary и rare никому не лучше надетого. */
function dressed(save: SaveState): SaveState {
  expect(rare.slot).toBe(ordinary.slot);
  const got = addItems(save, save.heroes.map(() => rare.id));
  return got.added.reduce((s, item, i) => equip(s, save.heroes[i].id, item.id, ctx), got.save);
}

describe('Безопасная продажа снаряжения', () => {
  // 11.10.2026: повторы — только сверх героев, которым вещь лучше надетой (heroesWanting). Здесь все герои одеты
  // лучше, поэтому, как и раньше, остаётся по одной запасной вещи (раньше тест шёл с пустыми слотами).
  it('пакет продаёт повторы обычных/редких, оставляет по одной запасной вещи и все эпики', () => {
    const s = dressed(inventory());
    const plan = salvagePlan(s, ctx);
    expect(plan.instanceIds).toHaveLength(3);
    const r = salvageItems(s, plan.instanceIds, ctx);
    expect(r.sold).toBe(3);
    expect(r.gold).toBe(2 * ctx.equipment.drops.salvage!.goldByRarity.common + ctx.equipment.drops.salvage!.goldByRarity.rare);
    expect(r.save.resources.gold - s.resources.gold).toBe(r.gold);
    const free = r.save.inventory.items.filter((i) => i.equippedBy === null);
    expect(free.map((i) => i.itemId).sort()).toEqual([ordinary.id, rare.id, epic.id, epic.id].sort());
    expect(r.save.inventory.items.filter((i) => i.equippedBy !== null)).toHaveLength(s.heroes.length);
    expect(s.inventory.items).toHaveLength(7 + s.heroes.length);
  });

  it('повтор не продаётся, пока он лучше надетого у героя, который может его надеть (первые 30 минут, второй лучник)', () => {
    const bow = ctx.equipment.items.bow;
    expect(bow?.jobs).toEqual(['archer']);
    // Новичок: слоты пусты — три рубахи ждут три героя, обе кольчуги тоже нужны.
    const fresh = inventory();
    expect(heroesWanting(fresh, ordinary, ctx)).toBe(fresh.heroes.length);
    expect(salvagePlan(fresh, ctx).instanceIds).toEqual([]);

    // Бран (лучник) в луке, в сумке ещё два лука. Лук нужен только лучникам: пока второго лучника нет — продаётся один.
    let s = addItems(newGame(ctx, 0), [bow.id, bow.id, bow.id]).save;
    const bran = s.heroes.find((h) => h.templateId === 'bran')!;
    s = equip(s, bran.id, s.inventory.items[0].id, ctx);
    expect(heroesWanting(s, bow, ctx)).toBe(0);
    expect(salvagePlan(s, ctx).instanceIds).toHaveLength(1);
    // Копия Брана «на вознесение» с пустыми руками — тот же герой: лук ей не держим.
    const copy = addHeroCard(s, 'bran', 'green').save;
    expect(heroesWanting(copy, bow, ctx)).toBe(0);
    expect(salvagePlan(copy, ctx).instanceIds).toHaveLength(1);
    // Пришла Мэйлин (лучница): ей лук лучше пустого слота — запасной остаётся ей, третий лук всё ещё лишний.
    s = addHeroCard(s, 'meilin', 'green').save;
    expect(heroesWanting(s, bow, ctx)).toBe(1);
    expect(salvagePlan(s, ctx).instanceIds).toHaveLength(1);
    // Бран снял лук (и один лук продан) — оба свободных лука ждут лучников: продавать нечего.
    const bare = { ...s, inventory: { ...s.inventory, items: s.inventory.items.slice(1).map((i) => ({ ...i, equippedBy: null })) } };
    expect(heroesWanting(bare, bow, ctx)).toBe(2);
    expect(salvagePlan(bare, ctx).instanceIds).toEqual([]);
    // У обоих лучников лук лучше (составной) — простой лук никому не нужен: остаётся одна запасная копия.
    const better = addItems(s, ['composite_bow', 'composite_bow']);
    const meilin = better.save.heroes.find((h) => h.templateId === 'meilin')!;
    let up = equip(better.save, bran.id, better.added[0].id, ctx);
    up = equip(up, meilin.id, better.added[1].id, ctx);
    expect(heroesWanting(up, bow, ctx)).toBe(0);
    expect(salvagePlan(up, ctx).instanceIds).toHaveLength(2);
  });

  it.each(['equipped', 'refined', 'card', 'locked'] as const)('%s защищает от продажи, включая явный список', (reason) => {
    const s = inventory();
    const item = s.inventory.items[1];
    const changes = { equipped: { equippedBy: s.heroes[0].id }, refined: { refine: 1 }, card: { card: 'mvp_card' }, locked: { locked: true } };
    const protectedItem = { ...item, ...changes[reason] };
    const protectedSave = { ...s, inventory: { ...s.inventory, items: s.inventory.items.map((i) => i.id === item.id ? protectedItem : i) } };
    expect(salvageProtection(protectedItem)).toBe(reason);
    expect(salvagePlan(protectedSave, ctx).instanceIds).not.toContain(item.id);
    expect(salvagePlan(protectedSave, ctx, [item.id])).toEqual({ instanceIds: [], gold: 0 });
    expect(() => salvageItems(protectedSave, [s.inventory.items[2].id, item.id], ctx)).toThrow(expect.objectContaining({ code: 'item_protected' }));
    expect(protectedSave.resources.gold).toBe(s.resources.gold);
    expect(protectedSave.inventory.items).toHaveLength(7);
  });

  it('повтор id не умножает золото; повтор подтверждённой продажи не выдаёт награду снова', () => {
    const s = inventory();
    const id = s.inventory.items[1].id;
    const r = salvageItems(s, [id, id], ctx);
    expect(r.sold).toBe(1);
    expect(r.gold).toBe(ctx.equipment.drops.salvage!.goldByRarity.common);
    expect(() => salvageItems(r.save, [id], ctx)).toThrow(expect.objectContaining({ code: 'unknown_item' }));
    const malformed = { ...s, inventory: { ...s.inventory, items: [...s.inventory.items, s.inventory.items[1]] } };
    expect(() => salvageItems(malformed, [id], ctx)).toThrow(expect.objectContaining({ code: 'unknown_item' }));
  });

  it('продажа последнего itN и загрузка сохраняют последовательность: старый запрос не продаст новую вещь', () => {
    const s = inventory();
    const last = s.inventory.items.at(-1)!;
    const { itemSeq: _drop, ...legacyInventory } = s.inventory;
    const legacy = { ...s, inventory: legacyInventory };
    const sold = salvageItems(legacy, [last.id], ctx).save;
    const loaded = deserialize(serialize(sold));
    const added = addItems(loaded, [epic.id]);
    expect(added.added[0].id).not.toBe(last.id);
    expect(added.save.inventory.itemSeq).toBe(s.inventory.items.length + 1);
    expect(() => salvageItems(added.save, [last.id], ctx)).toThrow(expect.objectContaining({ code: 'unknown_item' }));
  });

  it('защита замком переживает старую версию save и снимается явно', () => {
    const s = inventory();
    const id = s.inventory.items[1].id;
    const locked = deserialize(serialize(lockItem(s, id, true)));
    expect(locked.inventory.items.find((i) => i.id === id)?.locked).toBe(true);
    expect(salvagePlan(locked, ctx, [id]).instanceIds).toEqual([]);
    expect(salvageItems(lockItem(locked, id, false), [id], ctx).sold).toBe(1);
  });

  it('пустой список не меняет состояние; неизвестный предмет отменяет пакет целиком', () => {
    const s = inventory();
    expect(salvageItems(s, [], ctx)).toEqual({ save: s, sold: 0, gold: 0 });
    expect(() => salvageItems(s, [s.inventory.items[1].id, 'missing'], ctx)).toThrow(expect.objectContaining({ code: 'unknown_item' }));
    expect(s.inventory.items).toHaveLength(7);
  });
});
