import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';

const harness = vi.hoisted(() => ({
  enabled: false,
  node: () => {
    const n: any = { width: 100 };
    for (const key of ['setName', 'setDepth', 'setX', 'add', 'setDisplaySize', 'setTint']) n[key] = () => n;
    return n;
  },
}));
vi.mock('phaser', () => ({ default: { Scene: class {}, Math: { Clamp: (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n)) } } }));
vi.mock('../src/game/content', async () => ({ GAME: (await import('../scripts/lib/content-node')).loadFullContext() }));
vi.mock('../src/game/flow', () => ({ localDay: (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }));
vi.mock('../src/game/screen', () => ({
  CONTENT_TOP: 160, contentBottom: () => 1740, screen: () => {},
  cta: (_s: unknown, _x: number, _y: number, _label: string, _fn: unknown, opts: { enabled: boolean }) => {
    harness.enabled = opts.enabled;
    return { container: harness.node(), label: harness.node() };
  },
}));
vi.mock('../src/game/ui', () => ({
  BTN: { cta: 130 },
  button: () => ({ container: harness.node(), setEnabled: () => {} }),
  chip: () => harness.node(),
}));
vi.mock('../src/game/juice', () => ({ collect: (_children: unknown, fn: () => void) => { fn(); return []; }, staggerIn: () => {} }));
vi.mock('../src/game/decor', () => ({ ctaShine: () => {} }));
vi.mock('../src/game/itemIcons', () => ({}));
vi.mock('../src/game/battleElements', () => ({}));
vi.mock('../src/game/cardArt', () => ({}));
vi.mock('../src/game/skin', () => ({ skinIcon: () => '' }));
vi.mock('../src/game/sprites', () => ({}));
vi.mock('../src/game/unlockBanner', () => ({ lockedScreen: () => {} }));
vi.mock('../src/game/firstTips', () => ({ firstTip: () => {} }));
vi.mock('../src/game/heroCard', () => ({}));
vi.mock('../src/game/rewardsView', () => ({}));

import { HuntScene, type HuntSceneData } from '../src/game/scenes/HuntScene';
import { GAME } from '../src/game/content';
import { session, today } from '../src/game/session';
import { huntStatus, newGame, type HuntOutcome } from '../src/core';

// Real Phaser Clock: verify timers are scene-owned and removed on shutdown, without a browser renderer.
const require = createRequire(import.meta.url);
const Clock = require('phaser/src/time/Clock.js') as new (scene: unknown) => Phaser.Time.Clock;
const Emitter = require('phaser/src/events/EventEmitter.js') as new () => Phaser.Events.EventEmitter;

function sceneHarness() {
  const scene = new HuntScene();
  const events = new Emitter();
  const settings: { data: HuntSceneData } = { data: {} };
  let queued = false;
  let modal: HuntOutcome | undefined;
  const restart = vi.fn(() => { queued = true; });
  Object.assign(scene, {
    sys: { settings, events, game: { loop: { time: 0 } } },
    children: {}, add: { image: harness.node }, scene: { restart },
  });
  const clock = new Clock(scene);
  const timers = () => (clock as unknown as { _active: unknown[] })._active;
  Object.assign(scene, { time: clock });
  const banner = vi.spyOn(scene as any, 'banner').mockImplementation(() => {});
  vi.spyOn(scene as any, 'squadRow').mockImplementation(() => {});
  vi.spyOn(scene as any, 'levelBlock').mockImplementation(() => {});
  const showOutcome = vi.spyOn(scene as any, 'showOutcome').mockImplementation((out: unknown) => { modal = out as HuntOutcome; });
  const stop = () => { events.emit('shutdown'); modal = undefined; };
  // Phaser Systems.start replaces settings.data only when new data is supplied.
  const start = (data?: HuntSceneData) => {
    if (data) settings.data = data;
    events.emit('start');
    scene.create(settings.data);
  };
  const tick = (delta = 5000) => {
    events.emit('preupdate');
    events.emit('update', 0, delta);
    if (queued) { queued = false; stop(); start(); }
  };
  return { scene, clock, timers, events, settings, restart, banner, showOutcome, stop, start, tick, dismiss: () => { modal = undefined; }, modal: () => modal };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 3, 23, 59, 55));
  session.save = newGame(GAME, Date.now(), today());
  session.save.campaign.cleared = GAME.content.stages.map(s => s.id);
  session.save.hunt = { day: today(), used: GAME.hunt.attemptsPerDay, best: {} };
  harness.enabled = false;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const outcome = (damage: number): HuntOutcome => ({ damage } as HuntOutcome); // Rendering is outside this lifecycle harness.

describe('жизненный цикл экрана охоты', () => {
  it('в полночь меняет MVP и возвращает доступные попытки без повторного входа', () => {
    const h = sceneHarness();
    h.start();
    const yesterday = huntStatus(session.save, today(), GAME);
    expect(harness.enabled).toBe(false);
    h.tick();
    expect(h.restart).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(2026, 9, 4, 0, 0, 1));
    h.tick();
    const current = huntStatus(session.save, today(), GAME);
    expect(h.restart).toHaveBeenCalledOnce();
    expect(current.boss.unit).not.toBe(yesterday.boss.unit);
    expect(h.banner.mock.calls.at(-1)?.[0]).toMatchObject({ boss: { unit: current.boss.unit }, attemptsLeft: GAME.hunt.attemptsPerDay });
    expect(harness.enabled).toBe(true);
    h.stop();
  });

  it.each(['Adventure', 'Squad'])('не повторяет закрытый итог после возврата из %s', () => {
    const h = sceneHarness();
    const first = outcome(42);
    h.start({ outcome: first });
    expect(h.showOutcome).toHaveBeenCalledExactlyOnceWith(first);
    expect(h.settings.data).toEqual({});
    h.dismiss();
    h.stop();
    h.start();
    expect(h.modal()).toBeUndefined();
    expect(h.showOutcome).toHaveBeenCalledOnce();
    const fresh = outcome(84);
    h.stop();
    h.start({ outcome: fresh });
    expect(h.showOutcome).toHaveBeenCalledTimes(2);
    expect(h.showOutcome).toHaveBeenLastCalledWith(fresh);
    h.stop();
  });

  it('смена дня закрывает открытый итог и не воскрешает его при перезапуске', () => {
    const h = sceneHarness();
    h.start({ outcome: outcome(42) });
    expect(h.modal()).toBeDefined();
    vi.setSystemTime(new Date(2026, 9, 4, 0, 0, 1));
    h.tick();
    expect(h.modal()).toBeUndefined();
    expect(h.showOutcome).toHaveBeenCalledOnce();
    expect(harness.enabled).toBe(true);
    h.stop();
  });

  it('удаляет таймер при уходе и не накапливает его после повторных входов', () => {
    const h = sceneHarness();
    for (let i = 0; i < 4; i++) {
      h.start();
      h.tick();
      expect(h.timers()).toHaveLength(1);
      expect(h.events.listenerCount('update')).toBe(1);
      h.stop();
      expect(h.timers()).toHaveLength(0);
      expect(h.events.listenerCount('update')).toBe(0);
    }
    vi.setSystemTime(new Date(2026, 9, 4, 0, 0, 1));
    h.tick();
    expect(h.restart).not.toHaveBeenCalled();
  });
});
