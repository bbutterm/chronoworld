import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const node = (x = 0, y = 0, width = 0, height = 0) => {
    const o: any = { x, y, width, height, name: '', list: [] as any[],
      add(items: any) { o.list.push(...(Array.isArray(items) ? items : [items])); return o; },
      setName(name: string) { o.name = name; return o; },
      setOrigin() { return o; },
    };
    return o;
  };
  return { node, adaptive: true, save: null as any, sheet: null as any };
});
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../src/game/session', () => ({ session: { get save() { return harness.save; } }, commit: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/sprites', () => ({ portraitKey: (id: string) => id }));
vi.mock('../src/game/heroCard', () => ({ rarityColor: () => '#ffffff' }));
vi.mock('../src/game/viewport', () => ({
  view: () => ({ adaptive: harness.adaptive }),
  minimumTouchSize: () => harness.adaptive ? 132 : 96,
}));
vi.mock('../src/game/ui', () => ({
  SURFACE: { raised: {}, sunken: {} },
  button: (_scene: unknown, x: number, y: number, w: number, h: number, _skin: string, label: string) => {
    const o = harness.node(x, y, w, h); o.label = label;
    harness.sheet.controls.push(o);
    return { container: o, setEnabled: vi.fn() };
  },
  text: (_scene: unknown, x: number, y: number) => harness.node(x, y),
  chip: (_scene: unknown, x: number, y: number) => harness.node(x, y),
  plate: (_scene: unknown, x: number, y: number, w: number, h: number) => harness.node(x, y, w, h),
  tag: (_scene: unknown, x: number, y: number) => harness.node(x, y),
  mixHex: () => '#ffffff', toast: vi.fn(),
}));
vi.mock('../src/game/screen', () => ({
  bottomSheet: (_scene: unknown, _title: string, build: Function) => {
    const sheet: any = { content: harness.node(), controls: [], layer: { destroy: vi.fn() } };
    harness.sheet = sheet;
    sheet.height = build(sheet.content, 984, vi.fn());
    return sheet;
  },
  portrait: () => harness.node(), confirm: vi.fn(),
}));

import { newGame, savePreset } from '../src/core';
import { GAME } from '../src/game/content';
import { openPresetsSheet } from '../src/game/squadPresets';
import { S } from '../src/game/theme';

function render() {
  const scene: any = { add: { container: harness.node } };
  return openPresetsSheet(scene, { onApplied: vi.fn() }) as any;
}
beforeEach(() => { harness.adaptive = true; harness.save = newGame(GAME, 0); });

describe('практические цели нажатия в листе пресетов', () => {
  it('первая кнопка целиком находится внутри маски, включая все44CSSpx на360px', () => {
    const sheet = render(), save = sheet.controls.find((o: any) => o.name === 'presetSave');
    const hitHeight = Math.max(save.height, 132);
    expect(hitHeight / 3).toBeGreaterThanOrEqual(44);
    expect(save.y - hitHeight / 2).toBeGreaterThanOrEqual(0);
    expect(save.y + hitHeight / 2).toBeLessThanOrEqual(sheet.height);
  });

  it('кнопка сохранения не пересекает первую строку с её удалением', () => {
    harness.save = savePreset(harness.save, 'Отряд 1', GAME).save;
    const sheet = render(), save = sheet.controls.find((o: any) => o.name === 'presetSave');
    const row = sheet.content.list.find((o: any) => o.name === 'preset_0');
    const surface = row.list.find((o: any) => o.width === 984);
    const rowTop = row.y - Math.max(surface.height, 132) / 2;
    expect(rowTop - (save.y + Math.max(save.height, 132) / 2)).toBeGreaterThanOrEqual(S.s);
  });

  it('классическая сцена сохраняет прежние размеры, координаты и высоту листа', () => {
    harness.adaptive = false;
    harness.save = savePreset(harness.save, 'Отряд 1', GAME).save;
    const sheet = render(), save = sheet.controls.find((o: any) => o.name === 'presetSave');
    const row = sheet.content.list.find((o: any) => o.name === 'preset_0');
    expect(save.height).toBe(96);
    expect(save.y).toBe(44);
    expect(row.y).toBe(178);
    expect(sheet.height).toBe(244);
  });
});
