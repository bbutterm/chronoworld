import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { campaignLayout, campaignPages, heroFooterLayout } from '../src/game/runtimeUiLayout';
import { computeView } from '../src/game/viewLayout';
import { COLOR, S } from '../src/game/theme';
import { VIEW_CHANGED } from '../src/game/viewport';

describe('approved runtime layout bounds', () => {
  it.each([[360, 780], [390, 844], [360, 640]])('keeps squad, battle, loot and hero actions above navigation at %sx%s', (w, h) => {
    const view = computeView(w, h, 1, { top: 24, bottom: 24, left: 0, right: 0 });
    const bottom = 1760 + Math.max(0, Math.min(360, view.safeBottom - 1920));
    const c = campaignLayout(bottom);
    expect(c.mapBottom + 75).toBeLessThan(c.objectiveY - 20);
    expect(c.squadY + 80).toBeLessThan(c.rowY - 72);
    expect(c.rowY + 72).toBeLessThan(c.cardY - c.cardH / 2);
    expect(c.cardY + c.cardH / 2).toBeLessThanOrEqual(bottom);
    expect(c.claimY + c.claimH / 2).toBeLessThanOrEqual(bottom);
    const hero = heroFooterLayout(bottom);
    expect(hero.tabBottom).toBeGreaterThan(1200);
    expect(hero.tabBottom).toBeLessThan(hero.actionY - 92);
    expect(hero.actionY + 92).toBeLessThan(bottom);
  });
  it.each([1, 5, 10, 18, 36])('keeps all %s chapter stages on reachable, small map sections', n => {
    const pages = campaignPages(n);
    expect(pages.flatMap(p => Array.from({ length: p.to - p.from }, (_, i) => p.from + i))).toEqual(Array.from({ length: n }, (_, i) => i));
    expect(pages.every(p => p.to - p.from <= 5)).toBe(true);
  });
  it('body labels meet 4.5:1 on both warm surfaces', () => {
    const luminance = (hex: string) => {
      const rgb = hex.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    for (const bg of [COLOR.surface, COLOR.surfaceRaised]) for (const fg of [COLOR.textPrimary, COLOR.textSecondary]) expect((luminance(fg) + 0.05) / (luminance(bg) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});

vi.mock('phaser', () => ({ default: { Scene: class {}, Scenes: { Events: { SHUTDOWN: 'shutdown' } }, GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 } } }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/session', () => ({ session: { save: null }, today: () => '2026-10-04', commit: vi.fn() }));
vi.mock('../src/game/screen', () => ({ CONTENT_TOP: 170, contentBottom: () => 1760, unitFigure: vi.fn() }));
vi.mock('../src/game/ui', () => ({
  BTN: { m: 96 }, SURFACE: { surface: {}, raised: {} },
  mixHex: (a: string) => a,
  text: (scene: unknown, x: number, y: number, label: string, size: number) => metaText(scene, x, y, label, size), ellipsize: (n: unknown) => n,
  tag: (scene: unknown, x: number, y: number, label: string) => {
    const glyph = metaText(scene, 0, 0, label, 34);
    return metaNode(scene, x, y).add(glyph).setSize(Math.round(glyph.width + 2 * S.xs), 52);
  },
  plate: () => node(),
  button: (_s: unknown, _x: number, _y: number, _w: number, _h: number, _skin: string, _label: string, tap: () => void) => { taps.push(tap); return { container: node(), label: node() }; },
  pressable: (_s: unknown, _o: unknown, _w: number, _h: number, tap: () => void) => taps.push(tap),
}));
const taps: (() => void)[] = [];
function node(): any { const n: any = { setName: () => n, setOrigin: () => n }; return n; }

let metaFont = 36;
const metaTexts: any[] = [];
function metaNode(scene: unknown, x = 0, y = 0): any {
  const n: any = Object.assign(new EventEmitter(), { scene, x, y, width: 0, height: 0, list: [] });
  n.setName = (name: string) => { n.name = name; return n; };
  n.setOrigin = () => n;
  n.setX = (x: number) => { n.x = x; return n; };
  n.setSize = (width: number, height: number) => { n.width = width; n.height = height; return n; };
  n.add = (child: unknown) => { n.list.push(child); return n; };
  n.removeAll = (destroy: boolean) => { if (destroy) n.list.forEach((child: any) => child.destroy()); n.list = []; return n; };
  n.destroy = () => { n.emit('destroy'); n.removeAll(true); n.scene = undefined; };
  return n;
}
function metaText(scene: unknown, x: number, y: number, label: string, requested: number): any {
  const n = metaNode(scene, x, y);
  n.text = label;
  n.requested = requested;
  n.resize = () => { n.width = label.length * Math.max(requested, metaFont) * 0.6; };
  n.resize(); metaTexts.push(n);
  return n;
}

// Loading the scene/content fixture belongs to collection, as in the other scene harnesses.
// The callback test measures its six interactions, rather than cold module transformation.
const [{ CampaignScene }, { session, commit }, { newGame }, { GAME }, { ResultScene }] = await Promise.all([
  import('../src/game/scenes/CampaignScene'),
  import('../src/game/session'),
  import('../src/core'),
  import('../src/game/content'),
  import('../src/game/scenes/ResultScene'),
]);

it('every actual squad card and edit control opens the existing editor with a campaign return route', () => {
  session.save = newGame(GAME, 0);
  const s = new CampaignScene();
  const start = vi.fn();
  Object.assign(s, { scene: { start } });
  s['squadStrip']();
  expect(taps).toHaveLength(6);
  for (const tap of taps) tap();
  expect(start).toHaveBeenCalledTimes(6);
  expect(start).toHaveBeenLastCalledWith('Squad', { back: { to: 'Campaign', data: { chapter: 0 } } });
});

describe('Result metadata follows the actual caption width after native resize', () => {
  const make = (firstClear: boolean) => {
    metaFont = 36;
    const scene = new ResultScene();
    const events = new EventEmitter(), start = vi.fn(), restart = vi.fn();
    Object.assign(scene, { events, add: { container: (x: number, y: number) => metaNode(scene, x, y) }, scene: { start, restart } });
    const data = { result: { duration: 7.8 }, stage: { stageId: 'ch1_s2' } } as Parameters<InstanceType<typeof ResultScene>['create']>[0];
    const layer = scene['metaLine'](data, firstClear) as any;
    const resize = (font: number) => {
      metaFont = font;
      // Phaser Text redraw grows glyph bounds; its containing tag still has its original authored size.
      for (const text of metaTexts.filter(t => t.scene === scene)) text.resize();
      events.emit(VIEW_CHANGED);
    };
    return { scene, layer, events, resize, start, restart };
  };

  it('keeps the first-win glyphs within their plate and separates them from the stage caption at320', () => {
    const save = JSON.stringify(session.save), { layer, resize, start, restart } = make(true);
    resize(41);
    const caption = layer.list.find((n: any) => n.text), chip = layer.list.find((n: any) => n.list.length);
    expect(chip.width).toBeGreaterThanOrEqual(chip.list[0].width + 2 * S.xs - 0.5);
    expect(caption.x - caption.width / 2 - (chip.x + chip.width / 2)).toBeCloseTo(S.xs);
    expect((chip.x - chip.width / 2 + caption.x + caption.width / 2) / 2).toBeCloseTo(0);
    expect(JSON.stringify(session.save)).toBe(save);
    expect(start).not.toHaveBeenCalled(); expect(restart).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });

  it('returns to the same centered metadata geometry on360 without recreating its container or scene', () => {
    const { scene, layer, resize } = make(true);
    const initial = layer.list.map((n: any) => [n.x, n.width]);
    resize(41);
    expect(layer.list[1].width).toBeGreaterThan(initial[1][1]);
    resize(36);
    expect(layer.list.map((n: any) => [n.x, n.width])).toEqual(initial);
    expect(layer.scene).toBe(scene); expect(layer.list).toHaveLength(2);
  });

  it('keeps a replay caption centered and removes the reflow callback when the metadata is destroyed', () => {
    const { layer, events, resize } = make(false);
    expect(events.listenerCount(VIEW_CHANGED)).toBe(1);
    resize(41); expect(layer.list).toHaveLength(1); expect(layer.list[0].x).toBe(0);
    layer.destroy();
    expect(events.listenerCount(VIEW_CHANGED)).toBe(0);
    resize(36); expect(layer.list).toHaveLength(0);
  });
});
