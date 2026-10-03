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

const { InventoryScene } = await import('../src/game/scenes/InventoryScene');
const { GAME } = await import('../src/game/content');
const { newGame, heroName } = await import('../src/core');
const storage = await import('../src/game/session');
const screen = await import('../src/game/screen');
const ui = await import('../src/game/ui');

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
});
