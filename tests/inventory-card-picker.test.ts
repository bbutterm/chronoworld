import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListRowSpec, ScrollArea } from '../src/game/ui';
import type { BottomSheet } from '../src/game/screen';

vi.mock('phaser', () => ({ default: {
  Scene: class {},
  GameObjects: { Events: { DESTROY: 'destroy' } },
  Scenes: { Events: { CREATE: 'create' } },
  BlendModes: { ADD: 1 },
} }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/portraitFrame', () => ({ heroFace: vi.fn(() => ({})) }));

const { InventoryScene } = await import('../src/game/scenes/InventoryScene');
const { GAME } = await import('../src/game/content');
const core = await import('../src/core');
const { newGame, heroName } = core;
const { COLOR } = await import('../src/game/theme');
const storage = await import('../src/game/session');
const screen = await import('../src/game/screen');
const ui = await import('../src/game/ui');
const itemIcons = await import('../src/game/itemIcons');

/** Minimal canvas view double: exercise real picker callbacks and core insertion, without a DOM. */
function object() {
  const o = {
    list: [] as unknown[], name: '', type: 'Text',
    add: vi.fn(), setColor: vi.fn(),
    setName(n: string) { o.name = n; return o; },
    setOrigin() { return o; },
  };
  return o;
}

describe('выбор снаряжения для карты MVP', () => {
  const card = GAME.hunt.cards[0];
  const def = Object.values(GAME.equipment.items).find((i) => i.slot === card.slot)!;
  let scene: InstanceType<typeof InventoryScene>;
  let finishClose: () => void;
  let close: ReturnType<typeof vi.fn<() => void>>;
  let rows: { spec: ListRowSpec; row: ReturnType<typeof object> }[];
  let texts: string[];
  let height: number;
  let list: { locked: boolean };

  beforeEach(() => {
    vi.restoreAllMocks();
    storage.session.save = newGame(GAME, 0);
    storage.session.save.inventory.items = Array.from({ length: 12 }, (_, i) => ({ id: `target_${i}`, itemId: def.id, equippedBy: null }));
    storage.session.save.hunt = { day: '2026-10-03', used: 0, best: {}, cards: { [card.id]: 2 } };
    scene = new InventoryScene();
    scene.scene = { restart: vi.fn() } as unknown as typeof scene.scene;
    scene.events = { once: vi.fn() } as unknown as typeof scene.events;
    list = { locked: false };
    scene['area'] = list as unknown as ScrollArea;
    rows = [];
    texts = [];
    close = vi.fn();
    vi.spyOn(ui, 'text').mockImplementation((...args) => {
      texts.push(String(args[3]));
      return object() as unknown as ReturnType<typeof ui.text>;
    });
    vi.spyOn(ui, 'listRow').mockImplementation((_scene, _x, _y, _w, spec) => {
      const row = object();
      row.list.push(object());
      rows.push({ spec, row });
      return row as unknown as ReturnType<typeof ui.listRow>;
    });
    vi.spyOn(screen, 'bottomSheet').mockImplementation((_scene, _title, build, opts) => {
      finishClose = () => opts?.onClose?.();
      const content = object();
      const layer = object();
      close.mockImplementation(() => layer.setName(''));
      height = build(content as unknown as BottomSheet['content'], 984, close);
      return { layer, content, close } as unknown as BottomSheet;
    });
    vi.spyOn(ui, 'toast').mockImplementation(() => {});
    vi.spyOn(screen, 'confirm').mockImplementation(() => {});
    vi.spyOn(storage, 'commit').mockImplementation((next) => { storage.session.save = next; });
  });

  it('показывает все 12 экземпляров и подтверждает точный экземпляр после шестого', () => {
    scene['cardTargetSheet'](card.id);
    expect(rows).toHaveLength(12);
    expect(height).toBeGreaterThan(1920 * 0.8); // bottomSheet switches to its bounded ScrollArea.
    expect(rows[9].row.name).toBe('cardTarget_target_9');
    expect(rows[9].spec.subtitle).toBe('Экз. 10 · Свободен');
    rows[9].spec.onTap!();
    expect(close).toHaveBeenCalledOnce();
    expect(screen.confirm).not.toHaveBeenCalled();
    expect(storage.commit).not.toHaveBeenCalled();
    finishClose();
    expect(screen.confirm).toHaveBeenCalledOnce();
    expect(vi.mocked(screen.confirm).mock.calls[0][1]).toContain('Экз. 10');
    vi.mocked(screen.confirm).mock.calls[0][3]();
    expect(storage.session.save.inventory.items.find((i) => i.id === 'target_9')?.card).toBe(card.id);
    expect(storage.session.save.inventory.items.filter((i) => i.card)).toHaveLength(1);
    expect(storage.session.save.hunt?.cards?.[card.id]).toBe(1);
  });

  it('пустое состояние для отсутствующих, других слотов и уже занятых картой вещей', () => {
    const other = Object.values(GAME.equipment.items).find((i) => i.slot !== card.slot)!;
    storage.session.save.inventory.items = [
      { id: 'occupied', itemId: def.id, equippedBy: null, card: card.id },
      { id: 'wrong_slot', itemId: other.id, equippedBy: null },
      { id: 'missing_definition', itemId: 'old_removed_item', equippedBy: null },
    ];
    scene['cardTargetSheet'](card.id);
    expect(rows).toHaveLength(0);
    expect(texts).toContain('Подходящих предметов нет');
    expect(height).toBeGreaterThan(0);
    finishClose();
    expect(list.locked).toBe(false);
    expect(screen.confirm).not.toHaveBeenCalled();
    expect(storage.commit).not.toHaveBeenCalled();
  });

  it('надетые первыми, виден владелец и заточка; старые экземпляры без refine/card допустимы', () => {
    const hero = storage.session.save.heroes[0];
    const equipped = storage.session.save.inventory.items[10];
    equipped.equippedBy = hero.id;
    equipped.refine = 3;
    scene['cardTargetSheet'](card.id);
    expect(rows[0].row.name).toBe(`cardTarget_${equipped.id}`);
    expect(rows[0].spec.title).toContain('+3');
    expect(rows[0].spec.subtitle).toContain(`Надет: ${heroName(hero, GAME)}`);
    expect(rows).toHaveLength(12);
    rows[0].spec.onTap!();
    finishClose();
    expect(vi.mocked(screen.confirm).mock.calls[0][1]).toContain(heroName(hero, GAME));
    vi.mocked(screen.confirm).mock.calls[0][3]();
    expect(storage.session.save.inventory.items.find((i) => i.id === equipped.id)?.equippedBy).toBe(hero.id);
  });

  it('отмена листа не превращается в выбор от касания строки во время закрытия', () => {
    scene['cardTargetSheet'](card.id);
    close(); // close button, background or Back starts the shared sheet animation.
    rows[8].spec.onTap!();
    finishClose();
    expect(screen.confirm).not.toHaveBeenCalled();
    expect(storage.commit).not.toHaveBeenCalled();
    expect(list.locked).toBe(false);
  });

  it('повторные открытия/отмены снимают блокировку и не расходуют карты', () => {
    for (let i = 0; i < 4; i++) {
      scene['cardTargetSheet'](card.id);
      expect(list.locked).toBe(true);
      finishClose();
      expect(list.locked).toBe(false);
    }
    expect(screen.confirm).not.toHaveBeenCalled();
    expect(storage.commit).not.toHaveBeenCalled();
    scene['cardTargetSheet'](card.id);
    rows.at(-1)!.spec.onTap!();
    rows.at(-2)!.spec.onTap!(); // animation still closing: retain first choice.
    finishClose();
    expect(close).toHaveBeenCalledOnce();
    expect(vi.mocked(screen.confirm).mock.calls[0][1]).toContain('Экз. 12');
    // Cancel confirmation by not invoking onYes, then open a clean picker.
    scene['cardTargetSheet'](card.id);
    finishClose();
    expect(storage.commit).not.toHaveBeenCalled();
    expect(storage.session.save.hunt?.cards?.[card.id]).toBe(2);
  });
  it('wear sheet compares card-bearing items for each recipient and keeps mixed tradeoffs neutral', () => {
    const heroes = [
      { id: 'low', templateId: 'alan', rarity: 'green' as const, level: 1 },
      { id: 'high', templateId: 'bran', rarity: 'green' as const, level: 20 },
    ];
    const instance = { id: 'candidate', itemId: 'cotton_shirt', equippedBy: null, card: 'card_osiris' };
    storage.session.save = { ...storage.session.save, heroes, squad: [null, null, null, null, null], inventory: { items: [instance] } };
    scene['wearSheet']({ instance, def: GAME.equipment.items.cotton_shirt, wornBy: null, count: 1 });
    expect(rows).toHaveLength(2);
    const { heroItemStats } = core;
    for (const hero of heroes) {
      const actual = rows.find((r) => r.row.name === `wear_${hero.id}`)!;
      const stats = heroItemStats(hero, GAME.equipment.items.cotton_shirt, instance, GAME);
      expect(actual.spec.subtitle).toContain(`+${stats.hp} ОЗ`);
      expect(actual.spec.subtitle).toContain('мощь');
    }
    expect(rows[0].spec.subtitle).not.toBe(rows[1].spec.subtitle);
    finishClose();
    rows = [];
    storage.session.save.inventory.items.push(...heroes.map((h) => ({ id: `worn_${h.id}`, itemId: 'adventurers_suit', equippedBy: h.id })));
    scene['wearSheet']({ instance, def: GAME.equipment.items.cotton_shirt, wornBy: null, count: 1 });
    for (const row of rows) {
      expect(row.spec.subtitle).toContain('−3 ЗАЩ');
      expect((row.row.list[0] as ReturnType<typeof object>).setColor).toHaveBeenCalledWith(COLOR.textSecondary);
    }
  });

  it('wear sheet: отмена не превращается в экипировку во время закрытия', () => {
    storage.session.save.squad = [null, null, null, null, null];
    const instance = { id: 'shirt', itemId: 'cotton_shirt', equippedBy: null };
    const equip = vi.spyOn(scene as unknown as { equip: (...args: unknown[]) => void }, 'equip').mockImplementation(() => {});
    scene['wearSheet']({ instance, def: GAME.equipment.items.cotton_shirt, wornBy: null, count: 1 });
    close();
    rows[0].spec.onTap!();
    finishClose();
    expect(equip).not.toHaveBeenCalled();
    expect(list.locked).toBe(false);
  });

  it('wear sheet: первый выбор окончателен, повторное касание не меняет героя', () => {
    storage.session.save.heroes = [
      { id: 'first', templateId: 'alan', rarity: 'green', level: 1 },
      { id: 'second', templateId: 'bran', rarity: 'green', level: 1 },
    ];
    storage.session.save.squad = [null, null, null, null, null];
    const instance = { id: 'shirt', itemId: 'cotton_shirt', equippedBy: null };
    const equip = vi.spyOn(scene as unknown as { equip: (...args: unknown[]) => void }, 'equip').mockImplementation(() => {});
    scene['wearSheet']({ instance, def: GAME.equipment.items.cotton_shirt, wornBy: null, count: 1 });
    rows[0].spec.onTap!();
    rows[1].spec.onTap!();
    expect(close).toHaveBeenCalledOnce();
    finishClose();
    expect(equip).toHaveBeenCalledExactlyOnceWith(storage.session.save.heroes[0], expect.anything(), null);
    expect(list.locked).toBe(false);
  });

  it('slot picker includes the worn card in its comparison and uses a neutral mixed-stat color', () => {
    const hero = { id: 'alan', templateId: 'alan', rarity: 'green' as const, level: 20 };
    storage.session.save = { ...storage.session.save, heroes: [hero], inventory: { items: [
      { id: 'worn', itemId: 'cotton_shirt', equippedBy: hero.id, card: 'card_osiris' },
      { id: 'free', itemId: 'adventurers_suit', equippedBy: null },
    ] } };
    vi.spyOn(screen, 'screen').mockImplementation(() => {});
    vi.spyOn(ui, 'plate').mockReturnValue(object() as unknown as ReturnType<typeof ui.plate>);
    vi.spyOn(ui, 'pressable').mockReturnValue({} as ReturnType<typeof ui.pressable>);
    vi.spyOn(ui, 'ellipsize').mockImplementation((o) => o);
    vi.spyOn(ui, 'button').mockReturnValue({ container: object() } as unknown as ReturnType<typeof ui.button>);
    vi.spyOn(itemIcons, 'itemCell').mockReturnValue([]);
    scene.add = { zone: () => object() } as unknown as typeof scene.add;
    scene['canRefine'] = vi.fn(() => false);
    scene['cardSlotRow'] = vi.fn();
    scene['itemRow'] = vi.fn(() => object() as unknown as ReturnType<typeof scene['itemRow']>);
    scene['list'] = vi.fn((count, _rowH, _top, draw) => {
      for (let i = 0; i < count; i++) draw(i, 0, { tap: (fn: () => void) => fn } as unknown as ScrollArea);
    });
    scene['picker'](hero, 'armor');
    const call = vi.mocked(scene['itemRow']).mock.calls[0];
    expect(call[3]).toContain('−');
    expect(call[3]).toContain('мощь');
    expect(call[3]).toContain('+3 ЗАЩ');
    expect(call[4]).toBe(COLOR.textSecondary);
    expect(call[3]).not.toContain('+3,5 мощь');
  });

});
