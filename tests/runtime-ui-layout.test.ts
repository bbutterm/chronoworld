import { describe, expect, it, vi } from 'vitest';
import { campaignLayout, campaignPages, heroFooterLayout } from '../src/game/runtimeUiLayout';
import { computeView } from '../src/game/viewLayout';
import { COLOR } from '../src/game/theme';

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

vi.mock('phaser', () => ({ default: { Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 } } }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/session', () => ({ session: { save: null }, today: () => '2026-10-04' }));
vi.mock('../src/game/screen', () => ({ CONTENT_TOP: 170, contentBottom: () => 1760, unitFigure: vi.fn() }));
vi.mock('../src/game/ui', () => ({
  BTN: { m: 96 }, SURFACE: { surface: {}, raised: {} },
  mixHex: (a: string) => a,
  text: () => node(), ellipsize: (n: unknown) => n,
  plate: () => node(),
  button: (_s: unknown, _x: number, _y: number, _w: number, _h: number, _skin: string, _label: string, tap: () => void) => { taps.push(tap); return { container: node(), label: node() }; },
  pressable: (_s: unknown, _o: unknown, _w: number, _h: number, tap: () => void) => taps.push(tap),
}));
const taps: (() => void)[] = [];
function node(): any { const n: any = { setName: () => n, setOrigin: () => n }; return n; }

// Loading the scene/content fixture belongs to collection, as in the other scene harnesses.
// The callback test measures its six interactions, rather than cold module transformation.
const [{ CampaignScene }, { session }, { newGame }, { GAME }] = await Promise.all([
  import('../src/game/scenes/CampaignScene'),
  import('../src/game/session'),
  import('../src/core'),
  import('../src/game/content'),
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
