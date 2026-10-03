import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScrollArea } from '../src/game/ui';
import type Phaser from 'phaser';
vi.mock('phaser', () => ({ default: { CANVAS: 1, Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 } } }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/itemIcons', () => ({ itemCell: vi.fn(() => []) }));
const ui = await import('../src/game/ui');
const { InventoryScene } = await import('../src/game/scenes/InventoryScene');
const { GAME } = await import('../src/game/content');
const { COLOR, S, T } = await import('../src/game/theme');
const { GAME_W } = await import('../src/game/layout');
const { equipmentComparison } = await import('../src/game/flow');
const { heroItemStats } = await import('../src/core');

/** Exercise real ui.text, ellipsize, listRow and itemRow. Only canvas metrics/drawing are doubled;
 * deliberately conservative glyph widths make hidden negative tails and footer overflow fail. */
class Node {
  list: Node[] = []; name = ''; originX = 0.5; originY = 0.5; scaleX = 1;
  constructor(public x = 0, public y = 0, public width = 0, public height = 0, public text = '', public style: Phaser.Types.GameObjects.Text.TextStyle = {}) { if (text) this.setText(text); }
  setOrigin(x: number, y = x) { this.originX = x; this.originY = y; return this; }
  setText(s: string) {
    this.text = s;
    const size = parseFloat(String(this.style.fontSize ?? 34));
    const natural = s.length * size * 0.7;
    const wrap = this.style.wordWrap?.width ?? Infinity;
    this.width = Math.min(natural, wrap);
    this.height = Math.max(1, Math.ceil(natural / wrap)) * size * 1.3;
    return this;
  }
  setName(n: string) { this.name = n; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setSize(w: number, h: number) { this.width = w; this.height = h; return this; }
  add(n: Node | Node[]) { this.list.push(...[n].flat()); return this; }
}
function setup() {
  const texts: Node[] = [];
  const scene = new InventoryScene();
  Object.assign(scene, {
    sys: { game: { renderer: { type: 2 } } }, textures: { exists: () => true },
    add: {
      container: (x: number, y: number) => new Node(x, y),
      zone: (x: number, y: number, w: number, h: number) => new Node(x, y, w, h),
      nineslice: (x: number, y: number, _key: string, _frame: unknown, w: number, h: number) => new Node(x, y, w, h),
      text: (x: number, y: number, value: string, style: Phaser.Types.GameObjects.Text.TextStyle) => { const n = new Node(x, y, 0, 0, value, style); texts.push(n); return n; },
    },
  });
  vi.spyOn(ui, 'pressable').mockReturnValue({} as ReturnType<typeof ui.pressable>);
  return { scene, texts };
}
const hero = { id: 'alan', templateId: 'alan', rarity: 'green' as const, level: 20 };
const worn = { id: 'w', itemId: 'adventurers_suit', equippedBy: hero.id, card: 'card_orc_lord' };
const candidate = { id: 'c', itemId: 'full_plate', equippedBy: null, card: 'card_amon_ra' };
const note = equipmentComparison(heroItemStats(hero, GAME.equipment.items[worn.itemId], worn, GAME), heroItemStats(hero, GAME.equipment.items[candidate.itemId], candidate, GAME), GAME.features.power).text;
const longNote = '+1234,5 мощь · +12345 ОЗ  +1234 АТК  −123 ЗАЩ  −12 СКР · у Александра';
function expectVisible(n: Node, full: string, w: number, h: number) {
  expect(n.text).toBe(full);
  expect(n.text).not.toContain('…');
  expect(n.text).toContain('−');
  expect(parseFloat(String(n.style.fontSize))).toBe(T.caption);
  expect(n.x).toBeGreaterThanOrEqual(-w / 2);
  expect(n.x + n.width).toBeLessThanOrEqual(w / 2);
  expect(n.y + n.height).toBeLessThanOrEqual(h / 2);
  expect(n.style.wordWrap?.width).toBeGreaterThan(900);
}
beforeEach(() => vi.restoreAllMocks());
describe('equipment comparison row layout', () => {
  it.each([note, longNote])('item row keeps the full loss visible below the equip button: %s', (comparison) => {
    const { scene, texts } = setup();
    const area = { add: vi.fn(), tap: (fn: () => void) => fn } as unknown as ScrollArea;
    scene['itemRow'](area, { instance: candidate, def: GAME.equipment.items.full_plate, wornBy: null, count: 1 }, 0, comparison, COLOR.textSecondary, true);
    const footer = texts.find((n) => n.style.wordWrap)!;
    expectVisible(footer, comparison, GAME_W - 2 * S.l, 256 - S.xs);
    expect(footer.y).toBeGreaterThan(0); // below the icon/action header
  });
  it.each([note, longNote])('wear row keeps comparison width with a squad tag: %s', (comparison) => {
    const { scene, texts } = setup();
    const icon = new Node(0, 0, 80, 80);
    const tag = new Node(0, 0, 200, 60);
    ui.listRow(scene, 0, 0, 984, { icon: icon as never, title: 'Алан · ур. 20', subtitle: comparison, subtitleFullWidth: true, trailing: tag as never, h: 256 });
    const footer = texts.find((n) => n.style.wordWrap)!;
    expectVisible(footer, comparison, 984, 256);
    expect(footer.y).toBeGreaterThan(icon.y + icon.height / 2);
    expect(footer.y).toBeGreaterThan(tag.y + tag.height / 2);
  });
});
