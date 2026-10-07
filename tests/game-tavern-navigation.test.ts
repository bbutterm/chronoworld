import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const harness = vi.hoisted(() => ({
  node: () => {
    const n: any = { x: 0, y: 0, list: [] };
    for (const key of ['setName', 'setDepth', 'add']) n[key] = () => n;
    return n;
  },
}));
vi.mock('phaser', () => ({ default: { Scene: class {}, Scenes: { Events: { SHUTDOWN: 'shutdown', PRE_UPDATE: 'preupdate' } } } }));
vi.mock('../src/game/content', async () => ({ GAME: (await import('../scripts/lib/content-node')).loadFullContext() }));
vi.mock('../src/game/session', () => ({ session: { save: null }, today: () => '2026-10-07', now: () => 1791331200000 }));
vi.mock('../src/game/screen', () => ({ CONTENT_TOP: 180, screen: () => {} }));
vi.mock('../src/game/ui', () => ({ ScrollArea: class {
  content = harness.node(); offset = 0; locked = false;
  add(n: unknown) { return n; }
  setBounds() {} setContentHeight() {}
} }));
vi.mock('../src/game/flow', () => ({}));
vi.mock('../src/game/juice', () => ({ collect: (_children: unknown, fn: () => void) => { fn(); return []; } }));
vi.mock('../src/game/backdrops', () => ({ screenBackground: () => null }));
vi.mock('../src/game/tavernEntry', () => ({ markTavernSeen: () => {} }));
vi.mock('../src/game/tavernArt', () => ({}));
vi.mock('../src/game/audio', () => ({}));
vi.mock('../src/game/haptics', () => ({}));
vi.mock('../src/game/sprites', () => ({}));
vi.mock('../src/game/heroCard', () => ({}));
vi.mock('../src/game/hints', () => ({}));
vi.mock('../src/game/state', () => ({ motion: { reduced: false } }));
vi.mock('../src/game/viewport', () => ({ view: () => ({ uiHeight: 1920, safeBottom: 1920 }), onViewChange: () => () => {} }));

import { TavernScene, type TavernData } from '../src/game/scenes/TavernScene';
import { GAME } from '../src/game/content';
import { session, today } from '../src/game/session';
import { actSummon, newGame } from '../src/core';

const Systems = createRequire(import.meta.url)('phaser/src/scene/Systems.js');

function sceneHarness() {
  const scene = new TavernScene();
  const events = new EventEmitter();
  const sys = new Systems(scene, 'Tavern');
  sys.events = events;
  const settings: { data: TavernData } = sys.settings;
  const sceneStart = vi.fn();
  const restart = vi.fn();
  Object.assign(scene, {
    sys, events, children: {}, add: { container: harness.node },
    scene: { start: sceneStart, restart },
  });
  for (const method of ['ambience', 'banner', 'topRow', 'pity', 'buttons', 'tutorial']) vi.spyOn(scene as any, method).mockImplementation(() => {});
  const reveal = vi.spyOn(scene as any, 'startReveal').mockImplementation(() => {});
  // Real Phaser keeps data on start(undefined); create must consume the transient presentation.
  const start = (data?: TavernData) => {
    sys.start(data);
    scene.create(settings.data);
  };
  return { scene: scene as any, settings, reveal, sceneStart, restart, start };
}

beforeEach(() => {
  session.save = newGame(GAME, 1791331200000, today());
  session.save.campaign.cleared = GAME.content.stages.map(s => s.id);
  session.save.currency.scrolls = 10;
  session.save.summon.welcomeGiven = true;
});

describe('навигация после призыва в Таверне', () => {
  it('обычный повторный вход не раскрывает старый оплаченный призыв и не повторяет подарок', () => {
    const h = sceneHarness();
    const pulled = actSummon(session.save, today(), 10, 'scroll', GAME);
    session.save = pulled.save;
    const afterPull = JSON.stringify(session.save);
    h.start({ reveal: { results: pulled.results, count: 10 }, gift: true });
    expect(h.reveal).toHaveBeenCalledTimes(1);
    expect(h.reveal).toHaveBeenCalledWith({ results: pulled.results, count: 10 });
    h.start();
    expect(h.reveal).toHaveBeenCalledTimes(1);
    expect(h.settings.data).toEqual({});
    expect(JSON.stringify(session.save)).toBe(afterPull);
  });

  it('возвращается с карточки героя к тому же итогу и его прокрутке через явные данные', () => {
    const h = sceneHarness();
    const pulled = actSummon(session.save, today(), 10, 'scroll', GAME);
    session.save = pulled.save;
    const afterPull = JSON.stringify(session.save);
    const state = { results: pulled.results, count: 10, body: { offset: 124 } };
    h.scene.inspectResult(state, pulled.results[0].heroId);
    const [key, data] = h.sceneStart.mock.calls[0];
    expect(key).toBe('Hero');
    expect(data.heroId).toBe(pulled.results[0].heroId);
    expect(data.back.to).toBe('Tavern');
    h.start(data.back.data);
    expect(h.reveal).toHaveBeenCalledWith({ results: pulled.results, count: 10, resume: true, offset: 124 });
    h.start();
    expect(h.reveal).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(session.save)).toBe(afterPull);
  });

  it('Back раскрывает текущие карты, а на итоге возвращает в зал и игнорирует старый показ', () => {
    const h = sceneHarness();
    const skip = vi.spyOn(h.scene, 'skip').mockImplementation(() => {});
    const state = { phase: 'pick' };
    h.scene.reveal = state;
    h.scene.closeReveal(state);
    expect(skip).toHaveBeenCalledWith(state);
    expect(h.restart).not.toHaveBeenCalled();
    state.phase = 'done';
    h.scene.closeReveal(state);
    expect(h.restart).toHaveBeenCalledExactlyOnceWith({});
    h.scene.reveal = null;
    h.scene.closeReveal(state);
    expect(h.restart).toHaveBeenCalledTimes(1);
  });
});
