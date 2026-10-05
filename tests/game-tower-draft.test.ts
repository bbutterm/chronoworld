import { createRequire } from 'node:module';
import type Phaser from 'phaser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveState, TowerRun } from '../src/core';

const harness = vi.hoisted(() => {
  class Node {
    name = ''; text = ''; x = 0; y = 0; width = 100; height = 40;
    scene: unknown = {}; input: unknown; list: Node[] = []; parentContainer?: Node;
    enabled = true; tap = () => {}; active = true;
    constructor(x = 0, y = 0, text = '') { this.x = x; this.y = y; this.text = text; }
    add(items: Node | Node[]) { for (const n of Array.isArray(items) ? items : [items]) { n.parentContainer = this; this.list.push(n); } return this; }
    remove(n: Node) { this.list = this.list.filter(item => item !== n); n.parentContainer = undefined; return this; }
    removeAll(destroy: boolean) { if (destroy) this.list.forEach((n) => n.destroy()); this.list = []; return this; }
    destroy() { this.removeAll(true); this.scene = undefined; this.active = false; }
    setName(n: string) { this.name = n; return this; }
    setOrigin() { return this; } setDepth() { return this; } setStrokeStyle() { return this; }
    setInteractive() { this.input = {}; return this; } disableInteractive() { this.input = undefined; this.enabled = false; return this; }
    setDisplaySize() { return this; } setTint() { return this; } setShadow() { return this; }
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
    setY(y: number) { this.y = y; return this; } setX(x: number) { this.x = x; return this; }
    setText(text: string) { this.text = text; return this; }
    getWorldTransformMatrix(): { tx: number; ty: number } {
      const parent = this.parentContainer?.getWorldTransformMatrix();
      return { tx: this.x + (parent?.tx ?? 0), ty: this.y + (parent?.ty ?? 0) };
    }
    getBounds() { const { tx, ty } = this.getWorldTransformMatrix(); return { left: tx - this.width / 2, right: tx + this.width / 2, bottom: ty + this.height / 2, top: ty - this.height / 2 }; }
  }
  return { Node, save: undefined as unknown as SaveState, commits: 0, roots: [] as Node[], timers: [] as (() => void)[], sheets: [] as Node[], sheetCloses: [] as (() => void)[] };
});
vi.mock('phaser', () => ({ default: { Scene: class {}, GameObjects: { Container: harness.Node }, Math: { Clamp: (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n)) } } }));
vi.mock('../src/game/content', async () => ({ GAME: (await import('../scripts/lib/content-node')).loadFullContext() }));
vi.mock('../src/game/session', () => ({ session: { get save() { return harness.save; }, set save(s: SaveState) { harness.save = s; } }, commit: (s: SaveState) => { harness.save = s; harness.commits++; }, today: () => '2026-10-03' }));
vi.mock('../src/game/screen', () => ({
  CONTENT_TOP: 160, NAV_H: 150, popIn: () => {}, unitTint: () => 0,
  portrait: (_s: unknown, x: number, y: number) => new harness.Node(x, y),
  bottomSheet: (_s: unknown, _t: string, fn: (c: InstanceType<typeof harness.Node>, w: number) => void, opts?: { onClose?: () => void }) => { const c = new harness.Node(); harness.sheets.push(c); if (opts?.onClose) harness.sheetCloses.push(opts.onClose); fn(c, 984); },
}));
vi.mock('../src/game/ui', () => ({
  BTN: { l: 120, m: 96 }, SURFACE: {},
  text: (_s: unknown, x: number, y: number, t: string) => new harness.Node(x, y, t),
  plate: (_s: unknown, x: number, y: number, w: number, h: number) => Object.assign(new harness.Node(x, y), { width: w, height: h }),
  tag: (_s: unknown, x: number, y: number, t: string) => new harness.Node(x, y, t),
  button: (_s: unknown, x: number, y: number, _w: number, _h: number, _tex: string, label: string, tap: () => void) => {
    const container = Object.assign(new harness.Node(x, y, label), { tap, input: {} });
    return { container, label: container, setEnabled: (on: boolean) => { container.enabled = on; } };
  },
  pressable: (_s: unknown, n: InstanceType<typeof harness.Node>, _w: number, _h: number, tap: () => void) => Object.assign(n, { tap, input: {} }),
  clampLines: () => {}, ellipsize: () => {}, toast: () => {}, iconOf: () => undefined,
}));
vi.mock('../src/game/flow', () => ({}));
vi.mock('../src/game/scoutView', () => ({}));
vi.mock('../src/game/hints', () => ({}));
vi.mock('../src/game/backdrops', () => ({}));
vi.mock('../src/game/cardArt', () => ({ showCardArt: () => {} }));
vi.mock('../src/game/portraitFrame', () => ({}));
vi.mock('../src/game/sprites', () => ({ portraitKey: () => '' }));
vi.mock('../src/game/decor', () => ({ glow: () => new harness.Node() }));
vi.mock('../src/game/skin', () => ({ skinIcon: () => '' }));
vi.mock('../src/game/audio', () => ({ sfx: () => {} }));
vi.mock('../src/game/firstTips', () => ({}));
vi.mock('../src/game/haptics', () => ({ haptic: () => {} }));
vi.mock('../src/game/state', () => ({ motion: { reduced: true } }));

import { TowerScene } from '../src/game/scenes/TowerScene';
import { GAME } from '../src/game/content';
import { runConfig, startTowerRun } from '../src/core';
import { playerSave, TOWER_SQUADS } from '../scripts/balance-tower';

const require = createRequire(import.meta.url);
const Clock = require('phaser/src/time/Clock.js') as new (scene: unknown) => Phaser.Time.Clock;
const Emitter = require('phaser/src/events/EventEmitter.js') as new () => Phaser.Events.EventEmitter;

const flatten = (n: InstanceType<typeof harness.Node>): InstanceType<typeof harness.Node>[] => [n, ...n.list.flatMap(flatten)];
const run = () => harness.save.tower.run!;
function sceneHarness() {
  const scene = new TowerScene() as any;
  const root = new harness.Node();
  harness.roots.push(root);
  Object.assign(scene, {
    add: { container: (x: number, y: number) => new harness.Node(x, y), image: (x: number, y: number) => new harness.Node(x, y) },
    time: { delayedCall: (_ms: number, callback: () => void) => { harness.timers.push(callback); } },
    scene: { restart: vi.fn() },
  });
  vi.spyOn(scene, 'overlay').mockImplementation(() => {
    const footer = new harness.Node(); root.add(footer);
    const panel = { layer: root, content: root, footer, width: 984, setHeight: () => {}, close: () => root.destroy() };
    scene.panel = panel;
    return panel;
  });
  vi.spyOn(scene, 'flashCard').mockReturnValue(340);
  const node = (name: string) => flatten(root).find((n) => n.name === name)!;
  const click = (name: string) => { const n = node(name); expect(n, name).toBeDefined(); if (n.enabled) n.tap(); };
  return { scene, root, node, click, open: () => scene.blessingOverlay(run()), words: () => flatten(root).map((n) => n.text).join('\n') };
}
function changeRun(patch: Partial<TowerRun>) {
  harness.save = { ...harness.save, tower: { ...harness.save.tower, run: { ...run(), ...patch } } };
}

beforeEach(() => {
  const player = playerSave(GAME, 3, TOWER_SQUADS[0], 7);
  harness.save = startTowerRun(player, player.squad, GAME);
  changeRun({
    draftRules: { version: 1, legendaryCap: 3, blessingEvery: 5, rarity: structuredClone(runConfig(GAME).rarity) },
    cards: ['golden_bug', 'baphomet', 'mistress', 'pupa', 'deviruchi'], rerolls: 2,
    pending: { kind: 'blessing', options: ['osiris', 'orc_hero', 'dark_lord', 'drake'], source: 'boss', minRarity: 'legendary', rolls: 0 },
  });
  harness.commits = 0; harness.timers = []; harness.roots = []; harness.sheets = []; harness.sheetCloses = [];
});

describe('экспериментальные карты Башни: действия экрана', () => {
  it('закрытие старого листа не открывает ввод под новым листом или новой сценой', () => {
    const h = sceneHarness(), firstArea = { locked: false };
    h.scene.area = firstArea;
    h.scene.rulesSheet();
    const oldClose = harness.sheetCloses.at(-1)!;
    h.scene.cardsSheet(run());
    const currentClose = harness.sheetCloses.at(-1)!;
    expect(firstArea.locked).toBe(true);
    oldClose();
    expect(firstArea.locked).toBe(true);
    currentClose();
    expect(firstArea.locked).toBe(false);
    h.scene.rulesSheet();
    const beforeRestart = harness.sheetCloses.at(-1)!;
    const replacementArea = { locked: true };
    h.scene.area = replacementArea;
    beforeRestart();
    expect(replacementArea.locked).toBe(true);
    expect(harness.commits).toBe(0);
  });

  it('четыре предложения, перетасовка и явный отказ доступны при полном лимите', () => {
    const h = sceneHarness(); h.open();
    for (let i = 0; i < 4; i++) expect(h.node(`towerCard${i}`)).toBeDefined();
    expect(h.node('towerReroll').text).toContain('(2)');
    expect(h.words()).toContain('MVP 3/3');
    const before = structuredClone(run());
    h.click('towerCard0');
    expect(h.node('towerDraftCompare')).toBeDefined();
    expect(h.node('towerDraftConfirm').enabled).toBe(false);
    for (let i = 0; i < 3; i++) expect(h.node(`towerReplace${i}`)).toBeDefined();
    expect(run()).toEqual(before);
    h.click('towerDraftBack');
    expect(h.node('towerCard3')).toBeDefined();
    expect(run()).toEqual(before);
    expect(harness.commits).toBe(0);
  });

  it('сравнивает потерю вида и подтверждает ровно одну явно выбранную замену', () => {
    const h = sceneHarness(); h.open(); h.click('towerCard0'); h.click('towerReplace0');
    expect(h.node('towerDraftFamilies').text).toContain('Отключится бонус вида:');
    expect(h.node('towerDraftEffectsRemoved').text).toContain('эффекты');
    const oldConfirm = h.node('towerDraftConfirm');
    h.click('towerDraftConfirm'); oldConfirm.tap();
    expect(run().cards).not.toContain('golden_bug');
    expect(run().cards).toContain('osiris');
    expect(run().cards).toContain('deviruchi');
    expect(run().pending).toBeUndefined();
    expect(harness.commits).toBe(1);
    expect(harness.timers).toHaveLength(1);
    expect(h.node('towerDraftBack').enabled).toBe(false);
  });

  it('после смены режима старые обработчики и двойной выбор не применяются', () => {
    const h = sceneHarness(); h.open();
    const oldCard = h.node('towerCard0');
    h.click('towerCard0'); oldCard.tap();
    h.click('towerReplace1');
    const oldConfirm = h.node('towerDraftConfirm');
    h.click('towerDraftBack'); oldConfirm.tap();
    expect(harness.commits).toBe(0);
    h.click('towerDraftKeep'); h.node('towerDraftKeep').tap();
    expect(harness.commits).toBe(1);
    expect(run().cards).toContain('golden_bug');
    expect(run().cards).not.toContain('osiris');
  });

  it('подтверждение использует свежие ресурсы сохранения и отвергает другой pending', () => {
    const h = sceneHarness(); h.open(); h.click('towerCard0'); h.click('towerReplace0');
    harness.save = { ...harness.save, resources: { ...harness.save.resources, gold: 7654321 } };
    h.click('towerDraftConfirm');
    expect(harness.save.resources.gold).toBe(7654321);
    const h2 = sceneHarness();
    changeRun({ pending: { kind: 'blessing', source: 'boss', minRarity: 'legendary', rolls: 0, options: ['golden_bug'] } });
    h2.open(); h2.click('towerCard0'); h2.click('towerReplace0');
    changeRun({ pending: undefined });
    h2.click('towerDraftConfirm');
    expect(harness.commits).toBe(1);
  });

  it('Back и повторный вход оставляют обмен в ожидании; Keep сохраняет редкую и MVP-карты', () => {
    changeRun({ pending: { ...run().pending as Extract<TowerRun['pending'], { kind: 'blessing' }>, exchange: { sourceCardId: 'deviruchi', mode: 'mvpReplacement' } } });
    const before = [...run().cards];
    const h = sceneHarness(); h.open(); h.click('towerCard0');
    expect(h.node('towerDraftSourcePreserved').text).toContain('Девиручи');
    h.click('towerReplace0'); h.click('towerDraftBack');
    const reload = sceneHarness(); reload.open();
    expect(reload.node('towerCard3')).toBeDefined();
    reload.click('towerDraftKeep');
    expect(run().cards).toEqual(before);
    expect(run().pending).toBeUndefined();
    expect(run().rerolls).toBe(2);
  });

  it('обмен редкой без переполнения также требует сравнения перед списанием', () => {
    changeRun({ cards: ['pupa', 'poring'], pending: { kind: 'blessing', source: 'upgrade', minRarity: 'rare', options: ['deviruchi'], rolls: 0, exchange: { sourceCardId: 'poring', mode: 'last' } } });
    const h = sceneHarness(); h.open(); h.click('towerCard0');
    expect(h.words()).toContain('Карта Поринга');
    expect(run().cards).toContain('poring');
    expect(h.node('towerDraftConfirm').enabled).toBe(true);
    h.click('towerDraftConfirm');
    expect(run().cards).toEqual(['pupa', 'deviruchi']);
  });

  it('пустой пул завершается только явным Keep, без перетасовки и списания обмена', () => {
    changeRun({ pending: { kind: 'blessing', source: 'upgrade', minRarity: 'legendary', options: [], exhausted: true, rolls: 0, exchange: { sourceCardId: 'deviruchi', mode: 'mvpReplacement' } } });
    const h = sceneHarness(); h.open();
    expect(h.node('towerDraftExhausted')).toBeDefined();
    expect(h.node('towerReroll')).toBeUndefined();
    expect(run().pending).toBeDefined();
    h.click('towerDraftKeep');
    expect(run().cards).toContain('deviruchi');
  });

  it('перетасовка блокирует повторное списание и сохраняет гарантию', () => {
    const h = sceneHarness(); h.open();
    const reroll = h.node('towerReroll');
    h.click('towerReroll'); reroll.tap();
    expect(run().rerolls).toBe(1);
    expect(harness.commits).toBe(1);
    expect(run().pending).toMatchObject({ kind: 'blessing', minRarity: 'legendary', rolls: 1 });
  });

  it('Осирис с потраченным получением сохраняет правдивый текст боевого воскрешения', () => {
    changeRun({ consumedImmediateCards: ['osiris'] });
    const h = sceneHarness(); h.open(); h.click('towerCard0');
    expect(h.words()).toContain('Воскрешение при получении уже использовано.');
    expect(h.words()).toContain('Раз за бой павший встаёт с 30% ОЗ.');
    expect(h.words()).not.toContain('павшие встают с 50%');
  });

  it('Писарь заранее обещает замену одной MVP и сохранение последней редкой', () => {
    changeRun({ pending: { kind: 'event', event: 'scribe' } });
    const h = sceneHarness(); h.scene.eventOverlay(run());
    expect(h.node('towerEventOpt0').text).toBe('Заменить MVP-карту');
    expect(h.words()).toContain('Карта Девиручи останется');
    expect(h.words()).toContain('только после подтверждения');
    expect(harness.commits).toBe(0);
    h.click('towerEventOpt0'); h.node('towerEventOpt0').tap();
    expect(run().cards).toContain('deviruchi');
    expect(harness.commits).toBe(1);
  });

  it('отменяет таймер вспышки при уходе со сцены, сохраняя уже принятую карту', () => {
    const h = sceneHarness();
    const events = new Emitter();
    h.scene.sys = { events, game: { loop: { time: 0 } } };
    h.scene.time = new Clock(h.scene);
    events.emit('start');
    h.open(); h.click('towerCard0'); h.click('towerReplace0'); h.click('towerDraftConfirm');
    expect(run().cards).toContain('osiris');
    expect(run().pending).toBeUndefined();
    events.emit('preupdate');
    events.emit('shutdown');
    events.emit('update', 1000, 1000);
    expect(h.scene.scene.restart).not.toHaveBeenCalled();
    expect(events.listenerCount('update')).toBe(0);
  });

  it('старый обработчик события не отвечает за новую встречу', () => {
    changeRun({ pending: { kind: 'event', event: 'scribe' } });
    const h = sceneHarness(); h.scene.eventOverlay(run());
    changeRun({ pending: { kind: 'event', event: 'altar' } });
    h.click('towerEventOpt0');
    expect(harness.commits).toBe(0);
    expect(run().pending).toEqual({ kind: 'event', event: 'altar' });
  });

  it('legacy-выбор остаётся без сравнения и без кнопки отказа', () => {
    changeRun({ draftRules: undefined });
    const h = sceneHarness(); h.open();
    expect(h.node('towerDraftKeep')).toBeUndefined();
    expect(h.node('towerCard3')).toBeDefined();
    h.click('towerCard0');
    expect(h.node('towerDraftCompare')).toBeUndefined();
    expect(run().cards).toContain('osiris');
    expect(run().cards).toContain('golden_bug');
    expect(harness.commits).toBe(1);
  });

  it('правила активного legacy-забега не меняются от настройки новых забегов', () => {
    const h = sceneHarness();
    changeRun({ draftRules: undefined });
    h.scene.rulesSheet();
    const old = flatten(harness.sheets.at(-1)!).map((n) => n.text).join('\n');
    expect(old).toContain(`Каждые ${runConfig(GAME).blessingEvery} этажа`);
    expect(old).not.toContain('MVP-карт одновременно');
    changeRun({ draftRules: { version: 1, legendaryCap: 2, blessingEvery: 7, rarity: runConfig(GAME).rarity } });
    h.scene.rulesSheet();
    const active = flatten(harness.sheets.at(-1)!).map((n) => n.text).join('\n');
    expect(active).toContain('Каждые 7 этажей');
    expect(active).toContain('MVP-карт одновременно: 2');
  });
});
