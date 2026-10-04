import { describe, expect, it } from 'vitest';
import { addItems, deserialize, lockItem, newGame, salvageItems, salvagePlan, salvageProtection, serialize, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const ordinary = Object.values(ctx.equipment.items).find((it) => it.rarity === 'common')!;
const rare = Object.values(ctx.equipment.items).find((it) => it.rarity === 'rare')!;
const epic = Object.values(ctx.equipment.items).find((it) => it.rarity === 'epic')!;

function inventory(): SaveState {
  return addItems(newGame(ctx, 0), [ordinary.id, ordinary.id, ordinary.id, rare.id, rare.id, epic.id, epic.id]).save;
}

describe('Безопасная продажа снаряжения', () => {
  it('пакет продаёт повторы обычных/редких, оставляет по одной запасной вещи и все эпики', () => {
    const s = inventory();
    const plan = salvagePlan(s, ctx);
    expect(plan.instanceIds).toHaveLength(3);
    const r = salvageItems(s, plan.instanceIds, ctx);
    expect(r.sold).toBe(3);
    expect(r.gold).toBe(2 * ctx.equipment.drops.salvage!.goldByRarity.common + ctx.equipment.drops.salvage!.goldByRarity.rare);
    expect(r.save.resources.gold - s.resources.gold).toBe(r.gold);
    expect(r.save.inventory.items.map((i) => i.itemId).sort()).toEqual([ordinary.id, rare.id, epic.id, epic.id].sort());
    expect(s.inventory.items).toHaveLength(7);
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
