import { EventEmitter } from 'node:events';
import type { ButtonView, Panel } from '../src/game/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {
  Scene: class {},
  GameObjects: { Events: { DESTROY: 'destroy' }, Container: class {} },
  Scenes: { Events: { PRE_UPDATE: 'preupdate', SHUTDOWN: 'shutdown' } },
  Math: { Clamp: (n: number, min: number, max: number) => Math.min(max, Math.max(min, n)) },
  BlendModes: { ADD: 1 },
} }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn(), audioSettings: { music: 1, sfx: 1, ownMusic: false, muted: false, battleSfx: true }, setAudioSettings: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn(), hapticSettings: { on: true }, setHapticsOn: vi.fn() }));
vi.mock('../src/game/session', () => ({ session: {}, startOver: vi.fn() }));

const { HomeScene } = await import('../src/game/scenes/HomeScene');
const { SETTINGS_LAYOUT: SL, settingsRowLayout } = await import('../src/game/settingsLayout');
const { startOver } = await import('../src/game/session');
const { setAudioSettings } = await import('../src/game/audio');
const { setHapticsOn } = await import('../src/game/haptics');
const { playback, fps, motion } = await import('../src/game/state');
const decor = await import('../src/game/decor');
const ui = await import('../src/game/ui');
const unlocks = await import('../src/game/unlockBanner');
const { GAME_H, GAME_W } = await import('../src/game/layout');
const { S, T } = await import('../src/game/theme');

/** Geometry/event double only: real openSettings, confirm, popIn and ScrollArea execute below.
 * Text metrics approximate wrapping; actual font rendering is covered by browser QA. */
class Node extends EventEmitter {
  list: Node[] = [];
  parentContainer: Node | null = null;
  scene: object | undefined = {};
  name = '';
  data = new Map<string, unknown>();
  constructor(public x = 0, public y = 0, public width = 0, public height = 0, public text = '', public size = 0) { super(); }
  setName(n: string) { this.name = n; return this; }
  setDepth() { return this; }
  setInteractive() { return this; }
  disableInteractive() { return this; }
  getByName(name: string) { return this.list.find((n) => n.scene && n.name === name); }
  setOrigin() { return this; }
  setShadow() { return this; }
  setMask() { return this; }
  setVisible() { return this; }
  setScale() { return this; }
  setAlpha() { return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setY(y: number) { this.y = y; return this; }
  setSize(w: number, h: number) { this.width = w; this.height = h; return this; }
  setData(k: string, v: unknown) { this.data.set(k, v); return this; }
  getData(k: string) { return this.data.get(k); }
  add(nodes: Node | Node[]) {
    for (const n of [nodes].flat()) { n.parentContainer?.remove(n); this.list.push(n); n.parentContainer = this; }
    return this;
  }
  remove(n: Node) { this.list = this.list.filter((x) => x !== n); n.parentContainer = null; return this; }
  destroy() {
    if (!this.scene) return;
    for (const n of [...this.list]) n.destroy();
    this.emit('destroy');
    this.parentContainer?.remove(this);
    this.scene = undefined;
    this.removeAllListeners();
  }
}

function setup() {
  const nodes: Node[] = [];
  const make = (x = 0, y = 0, w = 0, h = 0) => { const n = new Node(x, y, w, h); nodes.push(n); return n; };
  const graphics = { fillStyle() { return this; }, fillRect: vi.fn(() => graphics), createGeometryMask() { return {}; }, destroy: vi.fn() };
  const scene = {
    add: { container: make, rectangle: make },
    make: { graphics: () => graphics },
    input: new EventEmitter(), events: new EventEmitter(),
    sys: { game: undefined }, tweens: { add: vi.fn((cfg: { onComplete?: () => void }) => cfg.onComplete?.()) },
    scene: { start: vi.fn(), restart: vi.fn() },
    children: { getByName: (name: string) => nodes.find((n) => n.scene && n.name === name) ?? null },
    cameras: { main: { getWorldPoint: (x: number, y: number) => ({ x, y }) } },
  };
  vi.spyOn(decor, 'ribbon').mockImplementation((_sc, x, y) => make(x, y) as unknown as ReturnType<typeof decor.ribbon>);
  const buttons: { label: string; node: Node; tap: () => void }[] = [];
  vi.spyOn(ui, 'panel').mockImplementation((_sc, x, y, w, h) => make(x, y, w, h) as unknown as Panel);
  vi.spyOn(ui, 'text').mockImplementation((_sc, x, y, value, size = 32, _color, style = {}) => {
    const wrap = style.wordWrap?.width ?? 10000;
    const lines = value.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length * size * 0.55 / wrap)), 0);
    const node = make(x, y, wrap, lines * (size + (style.lineSpacing ?? 14)));
    node.text = value; node.size = size;
    return node as unknown as ReturnType<typeof ui.text>;
  });
  vi.spyOn(ui, 'button').mockImplementation((_sc, x, y, w, h, _key, label, tap) => {
    const node = make(x, y, w, h);
    // ButtonView.setEnabled changes appearance; callers still receive taps to explain a lock.
    buttons.push({ label, node, tap });
    return {
      container: node, setLabel: (label: string) => { node.text = label; },
      setEnabled: (on: boolean) => { node.setData('enabled', on); },
    } as unknown as ButtonView;
  });
  vi.spyOn(ui, 'dangerButton').mockImplementation((sc, x, y, w, h, label, tap, size) => ui.button(sc, x, y, w, h, 'danger', label, tap, size));
  const open = () => {
    (HomeScene.prototype as unknown as { openSettings: () => void }).openSettings.call(scene);
    return scene.children.getByName('settingsModal')!;
  };
  const worldY = (n: Node): number => n.y + (n.parentContainer ? worldY(n.parentContainer) : 0);
  const clip = () => nodes.find((n) => n.scene && n.getData('clip'));
  const pointer = { x: GAME_W / 2, y: SL.bodyTop + 50, isDown: true };
  Object.assign(scene.input, { activePointer: pointer });
  return { nodes, scene, buttons, open, worldY, clip, pointer, graphics };
}

beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  vi.spyOn(unlocks, 'isUnlocked').mockReturnValue(true);
  vi.spyOn(unlocks, 'lockLabel').mockReturnValue('Откроется на этапе 1-4');
});

describe('Настройки: ограниченная прокрутка и читаемые строки', () => {
  it('длинная подпись/пояснение увеличивают ряд; обычные цели ≥44 px на 360 px', () => {
    const normal = settingsRowLayout(54);
    const long = settingsRowLayout(280, 320);
    expect(normal.rowH).toBeGreaterThanOrEqual(132);
    expect(normal.height).toBeGreaterThanOrEqual(148);
    expect(long.rowH).toBe(280);
    expect(long.explanationY).toBeGreaterThan(long.rowH);
    expect(long.height).toBeGreaterThan(long.explanationY + 320);
    expect(SL.closeY + SL.hitH / 2).toBeLessThan(GAME_H / 2 + SL.panelH / 2);
  });

  it.each([true, false])('все настройки сохранены, без пересечений и с неподвижным закрытием (dev=%s)', (dev) => {
    vi.stubEnv('DEV', dev);
    vi.stubGlobal('location', { search: '' });
    const h = setup(); const layer = h.open();
    expect(h.buttons.map((b) => b.node.name)).toEqual(['battleSpeed', 'fpsCap', 'reduceMotion', 'ownMusic', 'musicVolume', 'sfxVolume', 'battleSfx', 'muteAll', 'haptics', ...(dev ? ['testBattle'] : []), 'codesBtn', 'resetHints', 'resetProgress', 'settingsClose']);
    const rows = h.buttons.filter((b) => b.node.name !== 'settingsClose');
    rows.forEach((b, i) => {
      expect(b.node.height).toBeGreaterThanOrEqual(132);
      if (i) expect(b.node.y - b.node.height / 2).toBeGreaterThan(rows[i - 1].node.y + rows[i - 1].node.height / 2);
    });
    for (const n of h.clip()!.list.filter((n) => n.size)) expect(n.size).toBe(T.body);
    const close = h.buttons.at(-1)!; const fixed = h.worldY(close.node);
    const content = h.clip()!;
    expect(content.parentContainer).toBe(layer);
    expect(h.worldY(rows[0].node)).toBeGreaterThan(SL.bodyTop);
    h.scene.input.emit('wheel', h.pointer, [], 0, 100000);
    expect(h.worldY(rows.at(-1)!.node) + SL.hitH / 2).toBe(SL.bodyBottom - SL.rowGap);
    expect(h.worldY(close.node)).toBe(fixed);
    h.scene.input.emit('wheel', h.pointer, [], 0, -100000);
    expect(content.y).toBe(SL.bodyTop);
  });

  it('полоса и маска внутри панели; колесо, протяжка и кнопки вне её ширины не действуют', () => {
    const h = setup(); const layer = h.open();
    const left = GAME_W / 2 - SL.contentW / 2 - S.s;
    const right = GAME_W / 2 + SL.contentW / 2 + S.s;
    const thumb = layer.list.find((n) => n.width === 8)!;
    expect(thumb).toBeDefined();
    expect(thumb.x + thumb.width / 2).toBeLessThan(right);
    expect(thumb.x - thumb.width / 2).toBeGreaterThan(GAME_W / 2 + SL.contentW / 2);
    expect(right).toBeLessThan(GAME_W / 2 + SL.panelW / 2);
    expect(h.graphics.fillRect).toHaveBeenCalledWith(left, SL.bodyTop, right - left, SL.bodyBottom - SL.bodyTop);
    const before = fps.cap;
    for (const x of [left - 1, right + 1, 0, GAME_W]) {
      h.pointer.x = x; h.pointer.y = SL.bodyTop + 300;
      h.scene.input.emit('wheel', h.pointer, [], 0, 500);
      h.scene.input.emit('pointerdown', h.pointer);
      h.pointer.y -= 150;
      h.scene.input.emit('pointermove', h.pointer);
      h.scene.input.emit('pointerup', h.pointer);
      h.buttons.find((b) => b.node.name === 'fpsCap')!.tap();
      expect(h.clip()!.y).toBe(SL.bodyTop);
      expect(fps.cap).toBe(before);
    }
    h.pointer.x = GAME_W / 2;
    h.scene.input.emit('wheel', h.pointer, [], 0, 300);
    expect(h.clip()!.y).toBe(SL.bodyTop - 300);
  });

  it('обычный тап меняет скорость/FPS/анимацию и обновляет подписи', () => {
    const h = setup(); h.open();
    for (const name of ['battleSpeed', 'fpsCap', 'reduceMotion']) {
      const b = h.buttons.find((b) => b.node.name === name)!;
      b.tap();
      const expected = name === 'battleSpeed' ? `${playback.speed}x` : name === 'fpsCap' ? `${fps.cap} FPS` : motion.reduced ? 'Вкл' : 'Выкл';
      expect(b.node.text).toBe(expected);
    }
  });

  it('закрытая скорость объясняет условие открытия и не создаёт тост поверх настроек', () => {
    vi.mocked(unlocks.isUnlocked).mockReturnValue(false);
    const say = vi.spyOn(ui, 'toast').mockImplementation(() => undefined);
    const h = setup(); h.open();
    const speed = h.buttons.find((b) => b.node.name === 'battleSpeed')!;
    const before = playback.speed;
    expect(speed.node.getData('enabled')).toBe(false);
    expect(h.nodes.some((n) => n.text === 'Откроется на этапе 1-4')).toBe(true);
    speed.tap();
    expect(playback.speed).toBe(before);
    expect(say).not.toHaveBeenCalled();
  });

  it('звук и вибрация используют прежние настройки устройства', () => {
    const h = setup(); h.open();
    vi.spyOn(ui, 'toast').mockImplementation(() => undefined);
    for (const name of ['ownMusic', 'musicVolume', 'sfxVolume', 'battleSfx', 'muteAll', 'haptics'])
      h.buttons.find((b) => b.node.name === name)!.tap();
    expect(setAudioSettings).toHaveBeenNthCalledWith(1, { ownMusic: true, ownMusicHint: true });
    expect(setAudioSettings).toHaveBeenNthCalledWith(2, { music: 0 });
    expect(setAudioSettings).toHaveBeenNthCalledWith(3, { sfx: 0 });
    expect(setAudioSettings).toHaveBeenNthCalledWith(4, { battleSfx: false });
    expect(setAudioSettings).toHaveBeenNthCalledWith(5, { muted: true });
    expect(setHapticsOn).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('протяжка и тап за краем полосы не переключают настройку', () => {
    const h = setup(); h.open(); const before = fps.cap;
    const b = h.buttons.find((b) => b.node.name === 'fpsCap')!;
    h.pointer.y = SL.bodyBottom + 20; b.tap(); expect(fps.cap).toBe(before);
    h.pointer.y = SL.bodyTop + 200;
    h.scene.input.emit('pointerdown', h.pointer);
    h.pointer.y -= 150; h.scene.input.emit('pointermove', h.pointer); b.tap();
    expect(fps.cap).toBe(before);
  });

  it('оба отменённых подтверждения сохраняют прогресс и блокируют колесо/кнопки под ними', () => {
    const h = setup(); const layer = h.open();
    const reset = h.buttons.find((b) => b.node.name === 'resetProgress')!;
    for (const second of [false, true]) {
      reset.tap();
      if (second) [...h.buttons].reverse().find((b) => b.label === 'Удалить')!.tap();
      h.scene.events.emit('preupdate');
      const y = h.clip()!.y; const before = fps.cap;
      h.scene.input.emit('wheel', h.pointer, [], 0, 1000);
      h.buttons.find((b) => b.node.name === 'fpsCap')!.tap();
      h.buttons.find((b) => b.node.name === 'settingsClose')!.tap();
      expect(h.clip()!.y).toBe(y); expect(fps.cap).toBe(before); expect(layer.scene).toBeDefined();
      [...h.buttons].reverse().find((b) => b.label === 'Отмена')!.tap();
      h.scene.events.emit('preupdate');
      expect(h.scene.children.getByName('confirmModal')).toBeNull();
      expect(startOver).not.toHaveBeenCalled();
    }
    h.scene.input.emit('wheel', h.pointer, [], 0, 300);
    expect(h.clip()!.y).toBeLessThan(SL.bodyTop);
  });

  it('повторное открытие, закрытие и новая сцена не копят слушателей', () => {
    const h = setup();
    for (let i = 0; i < 12; i++) {
      const layer = h.open(); expect(h.open()).toBe(layer);
      expect(h.scene.input.listenerCount('wheel')).toBe(1);
      expect(h.scene.events.listenerCount('preupdate')).toBe(2);
      (layer.getData('close') as () => void)();
      expect(h.scene.input.eventNames()).toEqual([]);
      expect(h.scene.events.eventNames()).toEqual([]);
      expect(h.clip()).toBeUndefined();
    }
  });
});
