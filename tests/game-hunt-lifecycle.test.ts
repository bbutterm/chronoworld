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
  const restart = vi.fn((data?: HuntSceneData) => {
    if (data) settings.data = data;
    queued = true;
  });
  const battleStart = vi.fn();
  Object.assign(scene, {
    sys: { settings, events, game: { loop: { time: 0 } } },
    children: {}, add: { image: harness.node }, scene: { restart, start: battleStart },
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
  return { scene, battleStart, clock, timers, events, settings, restart, banner, showOutcome, stop, start, tick, dismiss: () => { modal = undefined; }, modal: () => modal };
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


describe('выбор уровня охоты', () => {
  beforeEach(() => {
    // Сброс выбора тем же путём, что новая игра/нулевой доступный уровень.
    const h = sceneHarness();
    h.start();
    h.stop();
    session.save.hunt = { day: today(), used: 0, best: {}, level: 2 };
  });

  const fight = (h: ReturnType<typeof sceneHarness>, rank: number) => {
    (h.scene as any).fight();
    expect(h.battleStart).toHaveBeenLastCalledWith('Battle', { mode: 'hunt', rank });
  };
  const pick = (h: ReturnType<typeof sceneHarness>, rank: number) => {
    (h.scene as any).pick(rank, huntStatus(session.save, today(), GAME));
    h.tick();
  };
  const setRank = (rank: number) => {
    session.save = { ...session.save, hunt: { ...session.save.hunt!, level: rank } };
  };

  it.each([3, 5])('после победы на верхнем уровне следует за новым уровнем %i', (rank) => {
    const h = sceneHarness();
    h.start();
    fight(h, 2);
    setRank(rank);
    h.stop();
    h.start({ outcome: { killed: true, rank: 2, levelBefore: 2, levelAfter: rank } as HuntOutcome });
    fight(h, rank);
    setRank(rank + 1);
    h.stop();
    h.start();
    fight(h, rank + 1);
    h.stop();
  });

  it('после поражения следует за пониженным верхним уровнем и последующей победой', () => {
    const h = sceneHarness();
    h.start();
    setRank(1);
    h.stop();
    h.start({ outcome: { killed: false, rank: 2, levelBefore: 2, levelAfter: 1 } as HuntOutcome });
    fight(h, 1);
    setRank(2);
    h.stop();
    h.start();
    fight(h, 2);
    h.stop();
  });

  it('сохраняет намеренный фарм при победе, возврате из отряда и смене дня', () => {
    const h = sceneHarness();
    h.start();
    pick(h, 1);
    fight(h, 1);
    h.stop();
    h.start({ outcome: { killed: true, rank: 1, levelBefore: 2, levelAfter: 2 } as HuntOutcome });
    fight(h, 1);
    h.stop();
    h.start();
    fight(h, 1);
    vi.setSystemTime(new Date(2026, 9, 4, 0, 0, 1));
    h.tick();
    fight(h, 1);
    h.stop();
  });

  it('выбор верхнего уровня вновь включает следование за прогрессом', () => {
    const h = sceneHarness();
    h.start();
    pick(h, 0);
    fight(h, 0);
    pick(h, 2);
    setRank(3);
    h.stop();
    h.start();
    fight(h, 3);
    h.stop();
  });

  it.each([0, 1])('недоступный фарм сбрасывается, когда верхний уровень стал %i', (rank) => {
    const h = sceneHarness();
    h.start();
    pick(h, 1);
    setRank(rank);
    h.stop();
    h.start();
    fight(h, rank);
    setRank(2);
    h.stop();
    h.start();
    fight(h, 2);
    h.stop();
  });

  it('клик боя берёт актуальный уровень из сохранения, а не снимок экрана', () => {
    const h = sceneHarness();
    h.start();
    setRank(4);
    fight(h, 4);
    pick(h, 3);
    setRank(1);
    fight(h, 1);
    h.stop();
  });

  it('новое сохранение не наследует фарм предыдущего игрока', () => {
    const h = sceneHarness();
    h.start();
    pick(h, 1);
    session.save = { ...session.save, createdAt: session.save.createdAt + 1 };
    setRank(4);
    h.stop();
    h.start();
    fight(h, 4);
    h.stop();
  });

  it.each([null, 1])('зачистка сохраняет выбор %s и не останавливает следование за верхним уровнем', (selected) => {
    const h = sceneHarness();
    h.start();
    if (selected !== null) pick(h, selected);
    const st = huntStatus(session.save, today(), GAME);
    session.save.hunt!.best[st.boss.unit] = st.tiers[0].damage;
    (h.scene as any).sweep();
    expect(h.restart).toHaveBeenLastCalledWith({ outcome: expect.objectContaining({ sweep: true }) });
    h.tick();
    fight(h, selected ?? 2);
    setRank(3);
    h.stop();
    h.start();
    fight(h, selected ?? 3);
    h.stop();
  });
});
