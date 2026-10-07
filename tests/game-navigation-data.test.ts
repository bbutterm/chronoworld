import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  taps: [] as (() => void)[],
  node: () => {
    const n: any = { width: 140, height: 40, x: 0, y: 0, list: [] };
    for (const key of ['setName', 'setDepth', 'setOrigin', 'setDisplaySize', 'setTint', 'setShadow', 'setAlpha', 'setX', 'setY', 'setSize', 'setScale', 'fillStyle', 'fillRect']) n[key] = () => n;
    n.add = (child: unknown) => { n.list.push(child); return n; };
    return n;
  },
}));
vi.mock('phaser', () => ({ default: { Scene: class {}, BlendModes: { ADD: 1 },
  Scenes: { Events: { SHUTDOWN: 'shutdown' } }, GameObjects: { Events: { DESTROY: 'destroy' } },
} }));
vi.mock('../src/game/content', async () => ({ GAME: (await import('../scripts/lib/content-node')).loadFullContext() }));
vi.mock('../src/game/session', () => ({ session: { save: null }, today: () => '2026-10-07', now: () => 1791331200000 }));
vi.mock('../src/game/screen', () => ({ CONTENT_TOP: 170, contentBottom: () => 1760, screen: () => {} }));
vi.mock('../src/game/ui', () => ({
  BTN: {}, SURFACE: { raised: {} },
  mixHex: (color: string) => color,
  text: (_scene: unknown, x: number, y: number) => Object.assign(harness.node(), { x, y }),
  iconOf: () => harness.node(), ellipsize: (n: unknown) => n, plate: () => harness.node(),
  tag: () => harness.node(),
  button: () => ({ container: harness.node(), label: harness.node() }),
  pressable: (_scene: unknown, _target: unknown, _width: unknown, _height: unknown, tap: () => void) => harness.taps.push(tap),
  ScrollArea: class {
    content = harness.node(); offset = 0;
    add(n: unknown) { return n; }
    setBounds() {} setContentHeight() {}
  },
}));
vi.mock('../src/game/juice', () => ({ countUp: () => {}, pulse: () => {}, staggerIn: () => {} }));
vi.mock('../src/game/decor', () => ({ glow: () => harness.node() }));
vi.mock('../src/game/audio', () => ({}));
vi.mock('../src/game/haptics', () => ({}));
vi.mock('../src/game/viewport', () => ({ onViewChange: () => () => {}, view: () => ({ uiHeight: 1920, safeBottom: 1920 }) }));

import { HeroesScene } from '../src/game/scenes/HeroesScene';
import { ResultScene } from '../src/game/scenes/ResultScene';
import { heroesUi } from '../src/game/heroesView';
import { session } from '../src/game/session';
import { GAME } from '../src/game/content';
import { newGame } from '../src/core';

const require = createRequire(import.meta.url);
const Systems = require('phaser/src/scene/Systems.js');

function systems(scene: object, key: string) {
  const sys = new Systems(scene, key);
  sys.events = new EventEmitter();
  return sys;
}

describe('одноразовые данные навигации', () => {
  it('реальный Phaser не переносит keep на следующий визит героев, сохраняя фильтр и сортировку', () => {
    session.save = newGame(GAME, 1791331200000);
    session.save.heroes = []; session.save.squad = [null, null, null, null, null];
    const scene = new HeroesScene(), sys = systems(scene, 'Heroes');
    Object.assign(scene, { sys, add: { zone: harness.node, graphics: harness.node }, tweens: { add() {} } });
    const original = { filter: heroesUi.filter, sort: heroesUi.sort, tab: heroesUi.tab, showMissing: heroesUi.showMissing };
    heroesUi.filter = { line: 'mage', role: 'damage', rarity: 'purple' };
    heroesUi.sort = 'rarity'; heroesUi.tab = 'story'; heroesUi.showMissing = true;
    const selection = { filter: { ...heroesUi.filter }, sort: heroesUi.sort, tab: heroesUi.tab, showMissing: heroesUi.showMissing };
    try {
      sys.start({ keep: true });
      scene.create(sys.settings.data);
      sys.start();
      expect(sys.settings.data.keep).toBeUndefined();
      scene.create(sys.settings.data);
      expect({ filter: heroesUi.filter, sort: heroesUi.sort, tab: heroesUi.tab, showMissing: heroesUi.showMissing }).toEqual(selection);
    } finally { Object.assign(heroesUi, original); }
  });

  it('реальная плитка поражения открывает общий инвентарь после прежнего выбора оружия героя', () => {
    harness.taps.length = 0;
    const inventory = systems({}, 'Inventory');
    inventory.start({ heroId: 'h1', slot: 'weapon', heroBack: { to: 'Tavern' } });
    const scene = new ResultScene(), start = vi.fn((key: string, data?: object) => {
      expect(key).toBe('Inventory'); inventory.start(data);
    });
    Object.assign(scene, { add: { container: harness.node, image: harness.node }, scene: { start } });
    scene['defeatTile'](harness.node(), { id: 'gear', label: 'Снаряжение', sub: 'Сумка', advised: false }, 540, 700, 312, 340, 'ch1_s6');
    harness.taps.at(-1)!();
    expect(start).toHaveBeenCalledExactlyOnceWith('Inventory', {});
    expect(inventory.settings.data).toEqual({});
  });
});
