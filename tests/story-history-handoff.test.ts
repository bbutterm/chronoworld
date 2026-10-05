import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import type { SaveState, StoryScene } from '../src/core';
import type { ScrollArea } from '../src/game/ui';

const h = vi.hoisted(() => ({
  save: undefined as unknown as SaveState,
  sheet: undefined as unknown as { layer: EventEmitter; close: () => void; finish: () => void },
  rows: [] as (() => void)[],
  play: vi.fn(),
  bottomSheet: vi.fn(),
}));
vi.mock('phaser', () => ({ default: {
  Scene: class {}, Scenes: { Events: { SHUTDOWN: 'shutdown' } }, GameObjects: { Events: { DESTROY: 'destroy' } },
} }));
vi.mock('../src/game/audio', () => ({ applySceneSound: vi.fn() }));
vi.mock('../src/game/sceneAudio', () => ({ sceneSoundOf: vi.fn() }));
vi.mock('../src/game/session', () => ({ session: { get save() { return h.save; } }, commit: vi.fn() }));
vi.mock('../src/game/dialogue', () => ({ playScenes: (...args: unknown[]) => h.play(...args) }));
vi.mock('../src/game/storyPage', () => ({ chroniclePage: vi.fn(), showPages: vi.fn() }));
vi.mock('../src/game/scenes/TavernEveningScene', () => ({ startTavernEvening: vi.fn() }));
vi.mock('../src/game/screen', () => ({ bottomSheet: (...args: unknown[]) => h.bottomSheet(...args), confirm: vi.fn(), cta: vi.fn(), unitFigure: vi.fn() }));
vi.mock('../src/game/viewport', () => ({ minimumTouchSize: () => 132, onViewChange: vi.fn(), view: vi.fn() }));
vi.mock('../src/game/ui', () => ({
  BTN: {}, SURFACE: {}, ScrollArea: class {},
  button: (_s: unknown, _x: number, _y: number, _w: number, _height: number, _skin: string, _text: string, tap: () => void) => {
    h.rows.push(tap); return { container: {} };
  },
  text: vi.fn(() => ({})),
}));

import { newGame, serialize } from '../src/core';
import { GAME } from '../src/game/content';
import { openStoryHistory } from '../src/game/scenes/ChapterDoneScene';

class Layer extends EventEmitter {
  name = 'bottomSheet'; scene: unknown = {}; data = new Map<string, unknown>();
  setName(name: string) { this.name = name; return this; }
  setData(key: string, value: unknown) { this.data.set(key, value); return this; }
  getData(key: string) { return this.data.get(key); }
  destroy() { if (!this.scene) return; this.emit('destroy'); this.scene = undefined; this.removeAllListeners(); }
}

function setup() {
  const layers: Layer[] = [], events = new EventEmitter(); let active = true;
  const sc = {
    events, sys: { isActive: () => active },
    children: { getByName: (name: string) => layers.find(layer => layer.scene && layer.name === name) ?? null },
  } as unknown as Phaser.Scene;
  h.bottomSheet.mockImplementation((_sc, _title, build, opts = {}) => {
    const layer = new Layer(); layers.push(layer); let closing = false, finished = false;
    const close = () => { if (closing) return; closing = true; layer.setData('closing', true).setName(''); };
    const finish = () => {
      if (!closing || finished) return; finished = true;
      layer.destroy(); opts.onClose?.();
    };
    build({ add: vi.fn() }, 984, close);
    h.sheet = { layer, close, finish };
    return { layer, close };
  });
  let done: (() => void) | undefined;
  h.play.mockImplementation((_sc, _scenes: StoryScene[], onDone: () => void) => { done = onDone; });
  return { sc, layers, events, completeReplay: () => done!(), shutdown: () => { active = false; events.emit('shutdown'); } };
}

beforeEach(() => {
  vi.clearAllMocks(); h.rows = [];
  h.save = newGame(GAME, 0);
  h.save = { ...h.save, seenScenes: GAME.story.scenes.filter(s => s.chapter === 'chapter1').map(s => s.id) };
});

describe('история главы: список → пересмотр с одной блокировкой фона', () => {
  it('не открывает пересмотр до окончания закрытия листа и держит фон до конца readOnly replay', () => {
    const q = setup(), lock = { locked: false } as ScrollArea, saved = serialize(h.save);
    const layer = openStoryHistory(q.sc, 'chapter1', { lock });
    expect(layer).toBe(h.sheet.layer); expect(lock.locked).toBe(true);
    expect(h.rows.length).toBeGreaterThan(0); h.rows[0]!(); h.rows[0]!();
    expect(h.play).not.toHaveBeenCalled(); expect(lock.locked).toBe(true);
    h.sheet.finish();
    expect(h.play).toHaveBeenCalledOnce(); expect(h.play.mock.calls[0]![3]).toEqual({ readOnly: true });
    expect(lock.locked).toBe(true); expect(serialize(h.save)).toBe(saved);
    q.completeReplay(); q.completeReplay();
    expect(lock.locked).toBe(false); expect(q.events.listenerCount('shutdown')).toBe(0);
    expect(serialize(h.save)).toBe(saved);
  });

  it.each([false, true])('восстанавливает captured lock=%s и не разблокирует заменённый список', (wasLocked) => {
    const q = setup(), original = { locked: wasLocked } as ScrollArea, next = { locked: true } as ScrollArea;
    const opts = { lock: original }; openStoryHistory(q.sc, 'chapter1', opts); opts.lock = next;
    h.rows[0]!(); h.sheet.finish(); q.completeReplay();
    expect(original.locked).toBe(wasLocked); expect(next.locked).toBe(true);
  });

  it('Back/cancel ждёт DESTROY листа, восстанавливает фон и не запускает рассказ', () => {
    const q = setup(), lock = { locked: false } as ScrollArea;
    openStoryHistory(q.sc, 'chapter1', { lock }); h.sheet.close();
    expect(lock.locked).toBe(true); h.sheet.finish();
    expect(lock.locked).toBe(false); expect(h.play).not.toHaveBeenCalled();
    expect(q.events.listenerCount('shutdown')).toBe(0);
  });

  it('внешний DESTROY отменяет отложенный replay, даже если старый close callback позже завершится', async () => {
    const q = setup(), lock = { locked: false } as ScrollArea;
    const layer = openStoryHistory(q.sc, 'chapter1', { lock })!;
    h.rows[0]!(); layer.destroy(); await Promise.resolve();
    expect(lock.locked).toBe(false); h.sheet.finish();
    expect(h.play).not.toHaveBeenCalled(); expect(q.events.listenerCount('shutdown')).toBe(0);
  });

  it('shutdown во время закрытия не создаёт диалог в остановленной сцене', () => {
    const q = setup(), lock = { locked: false } as ScrollArea;
    openStoryHistory(q.sc, 'chapter1', { lock }); h.rows[0]!(); q.shutdown(); h.sheet.finish();
    expect(lock.locked).toBe(false); expect(h.play).not.toHaveBeenCalled();
  });

  it('shutdown открытого replay восстанавливает прежнюю блокировку без повторного запуска', () => {
    const q = setup(), lock = { locked: false } as ScrollArea;
    openStoryHistory(q.sc, 'chapter1', { lock }); h.rows[0]!(); h.sheet.finish(); q.shutdown();
    expect(lock.locked).toBe(false); q.completeReplay(); expect(lock.locked).toBe(false);
    expect(h.play).toHaveBeenCalledOnce();
  });

  it('повторное открытие не создаёт вторую историю и не забирает lock другого списка', () => {
    const q = setup(), original = { locked: false } as ScrollArea, next = { locked: false } as ScrollArea;
    openStoryHistory(q.sc, 'chapter1', { lock: original });
    expect(openStoryHistory(q.sc, 'chapter1', { lock: next })).toBeNull();
    expect(h.bottomSheet).toHaveBeenCalledOnce(); expect(original.locked).toBe(true); expect(next.locked).toBe(false);
    h.sheet.close(); h.sheet.finish(); expect(original.locked).toBe(false);
  });
});
