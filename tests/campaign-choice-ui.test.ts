import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveState, StoryScene } from '../src/core';

const h = vi.hoisted(() => {
  class Node {
    name = ''; text = ''; x = 0; y = 0; width = 100; height = 100;
    scene: unknown; visible = true; input: unknown; list: Node[] = []; parentContainer?: Node;
    destroying = false;
    handlers: Record<string, ((...args: any[]) => void)[]> = {};
    data = new Map<string, unknown>();
    constructor(x = 0, y = 0, text = '') { this.x = x; this.y = y; this.text = text; }
    add(items: Node | Node[]) { for (const n of [items].flat()) { n.scene = this.scene; n.parentContainer = this; this.list.push(n); } return this; }
    removeAll(destroy: boolean) { if (destroy) this.list.forEach((n) => n.destroy()); this.list = []; return this; }
    destroy() {
      if (!this.scene || this.destroying) return;
      this.destroying = true;
      this.emit('destroy'); this.removeAll(true); this.scene = undefined; this.handlers = {};
    }
    on(event: string, fn: (...args: any[]) => void) { (this.handlers[event] ??= []).push(fn); return this; }
    once(event: string, fn: (...args: any[]) => void) {
      const once = (...args: any[]) => { this.handlers[event] = (this.handlers[event] ?? []).filter((h) => h !== once); fn(...args); };
      return this.on(event, once);
    }
    emit(event: string, ...args: any[]) { for (const fn of [...(this.handlers[event] ?? [])]) fn(...args); }
    setName(n: string) { this.name = n; return this; }
    setData(key: string, value: unknown) { this.data.set(key, value); return this; }
    getData(key: string) { return this.data.get(key); }
    setText(t: string) { this.text = t; return this; }
    setX(x: number) { this.x = x; return this; }
    setVisible(on: boolean) { this.visible = on; return this; }
    setInteractive() { this.input = {}; return this; }
    setOrigin() { return this; } setDepth() { return this; } setShadow() { return this; } setWordWrapWidth() { return this; }
    setScale() { return this; } setTint() { return this; } setAlpha() { return this; } setBlendMode() { return this; }
    setDisplaySize(w: number, hh: number) { this.width = w; this.height = hh; return this; }
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  }
  return { Node, save: undefined as unknown as SaveState, commits: [] as SaveState[], now: 1000 };
});
vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 1 }, Scenes: { Events: { SHUTDOWN: 'shutdown' } }, GameObjects: { Events: { DESTROY: 'destroy' } } } }));
vi.mock('../src/game/content', async () => ({ GAME: (await import('../scripts/lib/content-node')).loadFullContext() }));
vi.mock('../src/game/session', () => ({ session: { get save() { return h.save; } }, commit: (save: SaveState) => { h.save = save; h.commits.push(save); } }));
vi.mock('../src/game/audio', () => ({ sfx: () => {}, playVoiceFile: async () => null, stopVoiceFile: () => {} }));
vi.mock('../src/game/illust', () => ({ illustKey: (id: string) => id, loadIllust: async () => false }));
vi.mock('../src/game/skin', () => ({ SKIN: { cream: '#fff' } }));
vi.mock('../src/game/portraitFrame', () => ({ framedPortrait: () => new h.Node() }));
vi.mock('../src/game/storyView', () => ({ isChapterFinale: () => false, speakerView: (_s: unknown, id: string) => ({ name: id, sprite: null }) }));
vi.mock('../src/game/storyPage', () => ({ introPages: () => [], showPages: (_s: unknown, _pages: unknown, done: () => void) => done() }));
vi.mock('../src/game/ui', () => ({
  BTN: { m: 96, l: 120 }, SURFACE: { raised: {} }, mixHex: () => 0,
  text: (_s: unknown, x: number, y: number, t: string) => new h.Node(x, y, t),
  plate: (_s: unknown, x: number, y: number, w: number, hh: number) => new h.Node(x, y).setDisplaySize(w, hh),
  button: (_s: unknown, x: number, y: number, w: number, hh: number, _tex: string, label: string, tap: () => void) => {
    const container = new h.Node(x, y, label).setDisplaySize(w, hh).setInteractive();
    let armed = false;
    container.on('pointerdown', () => { armed = true; });
    container.on('pointerup', () => { if (armed) { armed = false; tap(); } });
    container.on('pointerout', () => { armed = false; });
    return { container };
  },
}));

import { GAME } from '../src/game/content';
import { beginCampaignStage, newGame, serialize } from '../src/core';
import { LINE_GUARD_MS, playScenes, startStageBattle } from '../src/game/dialogue';

const decision = () => GAME.story.scenes.find((s) => s.id === 'ch3o_s15_after')!;
const resultScene = () => GAME.story.scenes.find((s) => s.id === 'ch3o_s6_after')!;
const flatten = (node: InstanceType<typeof h.Node>): InstanceType<typeof h.Node>[] => [node, ...node.list.flatMap(flatten)];

function harness() {
  type Timer = { active: boolean; loop: boolean; callback: () => void; remove: () => void };
  const nodes: InstanceType<typeof h.Node>[] = [];
  const timers: Timer[] = [];
  let active = true;
  const events = new EventEmitter();
  const make = (x = 0, y = 0) => { const n = new h.Node(x, y); n.scene = sc; nodes.push(n); return n; };
  const timer = (callback: () => void, loop = false) => {
    const t: Timer = { active: true, loop, callback, remove: () => { t.active = false; } };
    timers.push(t); return t;
  };
  const sc = {
    add: { container: make, rectangle: make, image: make },
    textures: { exists: () => false }, tweens: { add: () => {} }, events, sys: { isActive: () => active },
    time: { get now() { return h.now; }, addEvent: ({ callback }: { callback: () => void }) => timer(callback, true), delayedCall: (_delay: number, cb: () => void) => timer(cb) },
    scene: { start: vi.fn() }, game: {},
    children: { get list() { return nodes.filter((n) => n.scene && !n.parentContainer); } },
  };
  events.once('shutdown', () => {
    active = false;
    for (const n of [...sc.children.list]) n.destroy();
  });
  const current = () => sc.children.list.flatMap(flatten).filter((n) => n.scene);
  const node = (name: string) => current().find((n) => n.name === name)!;
  const click = (n: InstanceType<typeof h.Node>, time = h.now + LINE_GUARD_MS + 1) => {
    h.now = time; n.emit('pointerdown', { event: { timeStamp: time } }); n.emit('pointerup');
  };
  const finishTyping = () => { h.now += 5000; for (const t of [...timers]) if (t.active && t.loop) t.callback(); };
  const next = () => { finishTyping(); const layer = node('dialogue'); if (layer) click(layer.list[0]); };
  const open = (story: StoryScene = decision(), opts = {}, done = vi.fn()) => { playScenes(sc as unknown as Phaser.Scene, [story], done, opts); return done; };
  const choices = () => current().filter((n) => n.name.startsWith('campaignChoice_'));
  const ask = () => { for (let i = 0; i < decision().lines.length; i++) next(); expect(choices()).toHaveLength(2); };
  const words = () => current().filter((n) => n.visible).map((n) => n.text).join('\n');
  return { sc, open, current, node, click, finishTyping, next, ask, choices, words, timers };
}

beforeEach(() => {
  vi.restoreAllMocks();
  h.now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => h.now);
  h.save = newGame(GAME, 1234);
  const trigger = GAME.content.stages.findIndex((s) => s.id === 'ch3_s15');
  h.save.campaign.cleared = GAME.content.stages.slice(0, trigger + 1).map((s) => s.id);
  h.save.storyQueue = [decision().id];
  h.commits = [];
});

describe('кампанийный выбор: диалог и одноразовая запись', () => {
  it('сохраняет выбор до reply, двойное и устаревшее касание не меняет его', () => {
    const ui = harness(); ui.open(); ui.ask();
    const option = ui.node('campaignChoice_block');
    ui.click(option, h.now); // Этот down пришёл в момент появления выбора.
    expect(h.commits).toHaveLength(0);
    ui.click(option);
    expect(h.save.campaignChoices?.[decision().choice!.id]).toBe('block');
    expect(h.commits).toHaveLength(1);
    expect(h.save.seenScenes).not.toContain(decision().id);
    ui.finishTyping();
    expect(ui.words()).toContain(decision().choice!.options.find((o) => o.id === 'block')!.reply[0].text);
    expect(ui.words()).toContain(decision().choice!.options.find((o) => o.id === 'block')!.text);
    ui.click(option);
    expect(h.commits).toHaveLength(1);
    expect(ui.choices()).toHaveLength(0);
  });

  it('хвост события выбора и старый down не пролистывают только что открытый reply', () => {
    const ui = harness(); const done = ui.open(); ui.ask();
    const shade = ui.node('dialogue').list[0];
    const beforeReply = h.now;
    shade.emit('pointerdown', { event: { timeStamp: beforeReply + LINE_GUARD_MS + 1 } });
    ui.click(ui.node('campaignChoice_block'));
    shade.emit('pointerup');
    expect(ui.node('dialogueBody').text).toBe('');
    shade.emit('pointerdown', { event: { timeStamp: beforeReply } });
    shade.emit('pointerup');
    expect(ui.node('dialogueBody').text).toBe('');
    expect(h.commits).toHaveLength(1);
    expect(done).not.toHaveBeenCalled();
    ui.finishTyping();
    expect(ui.node('dialogueBody').text).toBe(decision().choice!.options.find((o) => o.id === 'block')!.reply[0].text);
  });

  it.each([false, true])('skip до/после выбора: один атомарный finish, chosen=%s', (chosen) => {
    const ui = harness(); const done = ui.open();
    if (chosen) { ui.ask(); ui.click(ui.node('campaignChoice_evacuate')); }
    const before = h.commits.length;
    ui.click(ui.current().find((n) => n.text === 'Пропустить')!);
    expect(h.commits).toHaveLength(before + 1);
    expect(h.save.campaignChoices?.[decision().choice!.id]).toBe(chosen ? 'evacuate' : 'default');
    expect(h.save.seenScenes).toContain(decision().id);
    expect(h.save.storyQueue).toBeUndefined();
    expect(done).toHaveBeenCalledOnce();
  });

  it('авто закрывает сцену без кнопок с neutral/default', () => {
    const ui = harness(); const done = ui.open(decision(), { auto: true });
    for (let i = 0; i < decision().lines.length; i++) {
      ui.finishTyping();
      const auto = ui.timers.find((t) => t.active && !t.loop)!;
      expect(auto).toBeDefined(); auto.active = false; auto.callback();
    }
    expect(ui.choices()).toHaveLength(0);
    expect(h.save.campaignChoices?.[decision().choice!.id]).toBe('default');
    expect(done).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'default', 'block', 'evacuate'])('readOnly replay не записывает состояние (%s)', (picked) => {
    if (picked) h.save.campaignChoices = { [decision().choice!.id]: picked };
    h.save.seenScenes.push(decision().id);
    const before = serialize(h.save);
    const ui = harness(); const done = ui.open(decision(), { readOnly: true });
    for (let i = 0; i < decision().lines.length; i++) ui.next();
    expect(ui.choices()).toHaveLength(0);
    const selected = decision().choice!.options.find((o) => o.id === picked);
    if (selected) {
      ui.finishTyping(); expect(ui.words()).toContain(selected.reply[0].text);
      ui.click(ui.current().find((n) => n.text === 'Пропустить')!);
    }
    expect(done).toHaveBeenCalledOnce();
    expect(h.commits).toHaveLength(0);
    expect(serialize(h.save)).toBe(before);
  });

  it('возврат после выбора показывает сохранённый reply, не альтернативы', () => {
    const first = harness(); first.open(); first.ask(); first.click(first.node('campaignChoice_block'));
    first.sc.events.emit('shutdown');
    expect(h.save.seenScenes).not.toContain(decision().id);
    const second = harness(); second.open();
    for (let i = 0; i < decision().lines.length; i++) second.next();
    second.finishTyping();
    expect(second.choices()).toHaveLength(0);
    expect(second.words()).toContain(decision().choice!.options.find((o) => o.id === 'block')!.reply[0].text);
    expect(h.commits).toHaveLength(1);
  });

  it('после ухода с экрана старое событие кнопки не сохраняет выбор', () => {
    const ui = harness(); const done = ui.open(); ui.ask();
    const option = ui.node('campaignChoice_block');
    ui.sc.events.emit('shutdown');
    ui.click(option);
    expect(h.commits).toHaveLength(0);
    expect(done).not.toHaveBeenCalled();
  });

  it('фиксация default при открытом меню делает оставшуюся кнопку недействительной', () => {
    const ui = harness(); const done = ui.open(); ui.ask();
    const option = ui.node('campaignChoice_block');
    h.save = beginCampaignStage(h.save, 'ch3_s6', GAME);
    ui.click(option);
    expect(h.save.campaignChoices?.[decision().choice!.id]).toBe('default');
    expect(ui.choices()).toHaveLength(0);
    expect(done).toHaveBeenCalledOnce();
  });

  it('обычная сцена без выбора сохраняет прежнее листание и единственную отметку просмотра', () => {
    const plain = GAME.story.scenes.find((s) => !s.choice && s.lines.every((l) => !l.when))!;
    const ui = harness(); const done = ui.open(plain);
    for (let i = 0; i < plain.lines.length; i++) ui.next();
    expect(done).toHaveBeenCalledOnce();
    expect(h.save.seenScenes).toContain(plain.id);
    expect(h.save.campaignChoices).toBeUndefined();
    expect(h.commits).toHaveLength(1);
  });

  it('кнопки выбора помещаются в базовое поле 360×640 и не перекрывают пропуск/диалог', () => {
    const ui = harness(); ui.open(); ui.ask();
    const options = ui.choices();
    const skip = ui.current().find((n) => n.text === 'Пропустить')!;
    expect(options[0].y + options[0].height / 2).toBeLessThan(options[1].y - options[1].height / 2);
    expect(options[1].y + options[1].height / 2).toBeLessThan(skip.y - skip.height / 2);
    for (const option of options) {
      expect(option.x - option.width / 2).toBeGreaterThanOrEqual(0);
      expect(option.x + option.width / 2).toBeLessThanOrEqual(1080);
      expect(option.y - option.height / 2).toBeGreaterThanOrEqual(0);
      expect(option.y + option.height / 2).toBeLessThanOrEqual(1920);
    }
  });

  it('старая очередь после пройденного боя не даёт выбора и не блокирует продолжение', () => {
    h.save.campaign.cleared.push('ch3_s6');
    const ui = harness(); const done = ui.open();
    for (let i = 0; i < decision().lines.length; i++) ui.next();
    expect(ui.choices()).toHaveLength(0);
    expect(done).toHaveBeenCalledOnce();
    expect(h.save.campaignChoices?.[decision().choice!.id]).toBe('default');
  });

  it('нейтральный результат не показывает слова выбранной ветки', () => {
    const ui = harness(); const done = ui.open(resultScene(), { readOnly: true });
    ui.finishTyping();
    const neutral = resultScene().lines.find((l) => l.when?.is === 'default')!;
    expect(ui.words()).toContain(neutral.text);
    for (const l of resultScene().lines.filter((l) => l.when && l.when.is !== 'default')) expect(ui.words()).not.toContain(l.text);
    ui.next(); ui.next();
    expect(done).toHaveBeenCalledOnce();
    expect(h.commits).toHaveLength(0);
  });

  it('startStageBattle фиксирует default до запуска сцены боя', () => {
    h.save.seenScenes = GAME.story.scenes.map((s) => s.id);
    delete h.save.storyQueue;
    const ui = harness();
    ui.sc.scene.start.mockImplementation(() => expect(h.save.campaignChoices?.[decision().choice!.id]).toBe('default'));
    startStageBattle(ui.sc as unknown as Phaser.Scene, 'ch3_s6');
    expect(ui.sc.scene.start).toHaveBeenCalledWith('Battle', { mode: 'stage', stageId: 'ch3_s6' });
    expect(h.commits).toHaveLength(1);
  });
});
