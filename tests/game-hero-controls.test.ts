import { beforeEach, describe, expect, it, vi } from 'vitest';
import { heroBrowseLayout } from '../src/game/heroBrowseLayout';
import { TOUCH_COMFORT } from '../src/game/theme';

const harness = vi.hoisted(() => {
  const controls: { label: string; name: string; tap: () => void; width: number; height: number }[] = [];
  const node = () => {
    const obj: any = { width: 140, add: () => obj, setName: () => obj, setOrigin: () => obj, setDisplaySize: () => obj, setTint: () => obj, setStrokeStyle: () => obj };
    return obj;
  };
  return { controls, node, closed: vi.fn(), restart: vi.fn(), delayed: vi.fn(), title: '' };
});
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/game/content', () => ({ GAME: { content: { jobs: { swordman: { name: 'Мечник' }, mage: { name: 'Маг' }, archer: { name: 'Лучник' }, acolyte: { name: 'Послушник' }, merchant: { name: 'Торговец' }, thief: { name: 'Вор' } } } } }));
vi.mock('../src/game/screen', () => ({ bottomSheet: (_s: unknown, title: string, build: Function) => {
  harness.controls.length = 0;
  harness.title = title;
  const layer = { name: 'bottomSheet' };
  harness.closed.mockImplementation(() => { layer.name = ''; });
  build(harness.node(), 984, harness.closed);
  return { layer };
} }));
vi.mock('../src/game/ui', () => ({
  button: (_s: unknown, _x: number, _y: number, width: number, height: number, _skin: string, label: string, tap: () => void) => {
    const c = { label, name: '', tap, width, height };
    harness.controls.push(c);
    const container = harness.node();
    container.setName = (name: string) => { c.name = name; return container; };
    return { container, label: harness.node() };
  },
  ellipsize: (n: unknown) => n,
}));
vi.mock('../src/game/heroCard', () => ({ LINES: ['swordman', 'mage', 'archer', 'acolyte', 'merchant', 'thief'] }));
vi.mock('../src/game/juice', () => ({}));
vi.mock('../src/game/session', () => ({}));
vi.mock('../src/game/audio', () => ({}));
vi.mock('../src/game/haptics', () => ({}));
vi.mock('../src/game/tavern', () => ({}));
vi.mock('../src/game/hints', () => ({}));
vi.mock('../src/game/heroStoryView', () => ({}));
vi.mock('../src/game/unlockBanner', () => ({}));
vi.mock('../src/game/branchPicker', () => ({}));

import { HeroesScene } from '../src/game/scenes/HeroesScene';
import { heroesUi, collectionHeroes, groupCopies, browseNeighbours } from '../src/game/heroesView';
import { addHeroCard, newGame } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

function scene() {
  const s = new HeroesScene();
  Object.assign(s, { scene: { restart: harness.restart }, time: { delayedCall: harness.delayed } });
  return s;
}
beforeEach(() => {
  vi.clearAllMocks();
  harness.controls.length = 0;
  heroesUi.filter = { line: null, role: null, rarity: null };
  heroesUi.sort = 'power';
  heroesUi.order = ['existing'];
  heroesUi.tab = 'story';
  heroesUi.showMissing = true;
});

describe('подписанные меню героев', () => {
  it('семь подписанных классов с комфортными целями; открытие и отмена ничего не меняют', () => {
    heroesUi.filter = { line: 'mage', role: 'damage', rarity: 'blue' };
    const s = scene();
    s['openClasses']();
    expect(harness.controls).toHaveLength(7);
    expect(harness.controls.map(c => c.label)).toContain('✓ Маг');
    expect(harness.controls.every(c => c.width >= TOUCH_COMFORT && c.height >= TOUCH_COMFORT)).toBe(true);
    const stalePick = harness.controls.find(c => c.name === 'Линия: Мечник')!.tap;
    harness.closed();
    stalePick(); // a touch during the closing fade must not select
    expect(heroesUi.filter).toEqual({ line: 'mage', role: 'damage', rarity: 'blue' });
    expect(harness.restart).not.toHaveBeenCalled();
    s['openClasses']();
    expect(harness.controls.find(c => c.name === 'Линия: Маг')?.label).toBe('✓ Маг');
  });

  it('выбор класса сохраняет остальные фильтры, сортировку и историю; «Все» снимает только класс', () => {
    heroesUi.filter = { line: 'mage', role: 'damage', rarity: 'blue' };
    heroesUi.sort = 'rarity';
    const s = scene();
    s['openClasses']();
    harness.controls.find(c => c.name === 'Линия: Мечник')!.tap();
    expect(heroesUi.filter).toEqual({ line: 'swordman', role: 'damage', rarity: 'blue' });
    expect(heroesUi.sort).toBe('rarity');
    expect(heroesUi.order).toEqual(['existing']);
    expect(heroesUi.tab).toBe('story');
    expect(heroesUi.showMissing).toBe(true);
    expect(harness.closed).toHaveBeenCalledOnce();
    expect(harness.delayed).toHaveBeenCalledOnce();
    harness.delayed.mock.calls[0][1]();
    expect(harness.restart).toHaveBeenCalledWith({ keep: true });
    s['openClasses']();
    harness.controls.find(c => c.name === 'Линия: все')!.tap();
    expect(heroesUi.filter.line).toBe(null);
    expect(heroesUi.filter.role).toBe('damage');
  });

  it('сортировка явная; отмена сохраняет порядок, выбранное значение отмечено при повторном открытии', () => {
    const s = scene();
    s['openSort']();
    expect(harness.controls.map(c => c.name)).toEqual(['sort_power', 'sort_level', 'sort_rarity']);
    const stalePick = harness.controls.find(c => c.name === 'sort_level')!.tap;
    harness.closed();
    stalePick();
    expect(heroesUi.sort).toBe('power');
    expect(harness.delayed).not.toHaveBeenCalled();
    s['openSort']();
    harness.controls.find(c => c.name === 'sort_level')!.tap();
    expect(heroesUi.sort).toBe('level');
    expect(heroesUi.filter).toEqual({ line: null, role: null, rarity: null });
    s['openSort']();
    expect(harness.controls.find(c => c.name === 'sort_level')?.label).toBe('✓ Высокий уровень');
  });

  it('пустой результат восстанавливается сбросом; сортировка и состояние коллекции остаются', () => {
    const ctx = loadGameContext();
    const save = addHeroCard(newGame(ctx, 0), 'iris', 'blue', { level: 20 }).save;
    heroesUi.filter = { line: 'swordman', role: 'tank', rarity: 'red' };
    heroesUi.sort = 'level';
    const collect = () => groupCopies(collectionHeroes(save, heroesUi.filter, heroesUi.sort, ctx, h => h.level));
    expect(collect()).toEqual([]);
    scene()['resetFilters']();
    const restored = collect();
    expect(restored.length).toBeGreaterThan(1);
    expect(restored[0].hero.level).toBe(20);
    expect(heroesUi.sort).toBe('level');
    expect(heroesUi.showMissing).toBe(true);
    expect(harness.restart).toHaveBeenCalledWith({ keep: true });
    const order = restored.map(g => g.hero.id);
    expect(browseNeighbours(order, order[0], () => true).next).toBe(order[1]);
  });
});

describe('геометрия листания карточек', () => {
  it('обе цели ≥44 CSS px при ширине360; внутри экрана, до колонки сведений и выше действий', () => {
    const top = 300;
    const nav = heroBrowseLayout(570, top);
    expect(nav.w * 360 / 1080).toBeGreaterThanOrEqual(44);
    expect(nav.h * 360 / 1080).toBeGreaterThanOrEqual(44);
    expect(nav.prevX - nav.w / 2).toBeGreaterThanOrEqual(0);
    expect(nav.nextX + nav.w / 2).toBeLessThan(570);
    expect(nav.prevX + nav.w / 2).toBeLessThan(nav.nextX - nav.w / 2);
    expect(nav.y - nav.h / 2).toBeGreaterThan(top + 64 + 66); // lock
    expect(nav.y + nav.h / 2).toBeLessThan(top + 502 - 66); // copies / ascend
  });
});
