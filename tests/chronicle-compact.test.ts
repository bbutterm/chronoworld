import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { chronicleLayout } from '../src/game/chronicleLayout';
import { computeView } from '../src/game/viewLayout';

describe('Летопись на коротком Telegram viewport', () => {
  it.each([[360, 640], [390, 640], [360, 760]])('разделяет цели вкладок, подпись и доступный список при %sx%s', (w, h) => {
    const v = computeView(w, h, 1, { top: 136, bottom: 34, left: 0, right: 0 }, 2, true);
    const scale = w / 1080;
    const layout = chronicleLayout(170, v.safeBottom - 190, 44 / scale, 12 / scale);
    expect(layout.tabH * scale).toBeGreaterThanOrEqual(44);
    expect(layout.rowH * scale).toBeGreaterThanOrEqual(44);
    expect(layout.pageButtonH * scale).toBeGreaterThanOrEqual(44);
    expect(layout.tabY + layout.tabH / 2).toBeLessThan(layout.summaryY - 12 / scale / 2);
    expect(layout.summaryY + 12 / scale / 2).toBeLessThan(layout.listTop);
    expect((layout.listBottom - layout.listTop) * scale).toBeGreaterThan(200);
    expect(layout.listBottom).toBeLessThan(v.safeBottom - 170);
  });
});

class Node {
  name = ''; list: Node[] = []; style = { fontSize: '40px' }; y = 0;
  height = 40; width = 200;
  scene: unknown = {};
  setName(n: string) { this.name = n; return this; }
  setY(y: number) { this.y = y; return this; }
  setOrigin() { return this; }
  setFontSize(n: number) { this.style.fontSize = `${n}px`; return this; }
  setPosition() { return this; }
  setSize() { return this; }
  setDepth() { return this; }
  setTint() { return this; }
  setData() { return this; }
  add(n: Node | Node[]) { this.list.push(...Array.isArray(n) ? n : [n]); return this; }
  getByName(n: string) { return this.list.find((x) => x.name === n); }
  destroy() { this.scene = undefined; }
}
class Zone extends Node {}
class Text extends Node {}

const harness = vi.hoisted(() => ({ bottom: 1220, onView: undefined as (() => void) | undefined, changeTab: undefined as ((i: number) => void) | undefined,
  lore: undefined as any, heroStory: undefined as any, history: undefined as any, tavernTap: undefined as (() => void) | undefined,
  sheetDone: undefined as (() => void) | undefined, sheetClose: undefined as (() => void) | undefined,
  buttons: [] as { node: Node; tap: () => void }[] }));
vi.mock('phaser', () => ({ default: { Scene: class {}, GameObjects: { Container: Node, Zone, Text, Events: { DESTROY: 'destroy' } }, Scenes: { Events: { SHUTDOWN: 'shutdown' } }, BlendModes: { ADD: 1 } } }));
vi.mock('../src/game/session', () => ({ session: { save: null }, commit: vi.fn(), today: () => '2026-10-05' }));
vi.mock('../src/game/viewport', () => ({ minimumFontSize: () => 36, minimumTouchSize: () => 132, view: () => ({ uiHeight: 1410 }), onViewChange: (_sc: unknown, fn: () => void) => (harness.onView = fn) }));
vi.mock('../src/game/screen', () => ({ CONTENT_TOP: 170, contentBottom: () => harness.bottom, screen: vi.fn(), unitFigure: vi.fn(),
  bottomSheet: (_s: unknown, _title: string, build: (box: Node, w: number, close: () => void) => number, opts: { onClose: () => void }) => {
    harness.sheetDone = opts.onClose; harness.sheetClose = vi.fn<() => void>(); build(new Node(), 984, harness.sheetClose);
  },
}));
vi.mock('../src/game/tavernArt', () => ({ ensureTavernTextures: vi.fn(), TAVERN_BG: 'tavern', TAVERN_BG_FILE: 'tavern_file' }));
vi.mock('../src/game/storyPage', () => ({ introPages: vi.fn(), showPages: vi.fn(), chroniclePage: vi.fn(), findingIcon: vi.fn(), findingPage: vi.fn() }));
vi.mock('../src/game/scenes/ChapterDoneScene', () => ({ openStoryHistory: (_s: unknown, _id: string, opts: { lock?: { locked: boolean } }) => {
  harness.history = { lock: opts?.lock, called: true }; if (opts?.lock) opts.lock.locked = true; return new Node();
} }));
vi.mock('../src/game/juice', () => ({ staggerIn: vi.fn() }));
vi.mock('../src/game/homeBuildings', () => ({ goldDot: () => new Node() }));
vi.mock('../src/game/heroStoryView', () => ({ hasHeroStory: () => true, heroStoryNew: () => 0, heroStoryProgress: () => ({ open: 1, total: 15 }), openHeroStory: (_s: unknown, _id: string, opts: unknown) => (harness.heroStory = opts) }));
vi.mock('../src/game/loreView', () => ({ seenLore: () => [], loreUnseen: () => ({ world: 0, findings: 0, bestiary: 0, items: 0, heroes: 0 }),
  loreKeys: () => ({ world: [], findings: [], bestiary: [], items: [], heroes: [] }), markLoreSeen: vi.fn(), loreModal: (_s: unknown, opts: unknown) => (harness.lore = opts) }));
vi.mock('../src/game/scenes/TavernEveningScene', () => ({ startTavernEvening: vi.fn() }));
vi.mock('../src/game/ui', () => ({ BTN: { m: 104 }, SURFACE: { raised: {} },
  segmented: (_s: unknown, _x: number, _y: number, _w: number, labels: string[], _i: number, change: (i: number) => void) => {
    harness.changeTab = change; const c = new Node(); for (const _ of labels) c.add(new Zone()); return { container: c };
  },
  ScrollArea: class { offset = 0; locked = false; content = new Node(); clear() { this.content.list = []; this.offset = 0; } setBounds = vi.fn(); setContentHeight() {} tap(f: () => void) { return f; } add(n: Node) { this.content.add(n); return n; } },
  text: () => new Text(), plate: () => new Node(), chip: () => new Node(), tag: () => new Node(),
  button: (_s: unknown, _x: number, _y: number, _w: number, _h: number, _tex: string, _text: string, tap: () => void) => {
    const node = new Node(); harness.buttons.push({ node, tap }); return { container: node };
  },
  pressable: (_s: unknown, _n: unknown, _w: number, _h: number, tap: () => void) => (harness.tavernTap = tap),
}));

// Импорты во время collection: холодная загрузка контента не съедает5s каждого assertion.
const { ChronicleScene } = await import('../src/game/scenes/ChronicleScene');
const { session } = await import('../src/game/session');
const { newGame } = await import('../src/core');
const { GAME } = await import('../src/game/content');
const { startTavernEvening } = await import('../src/game/scenes/TavernEveningScene');
const { showPages } = await import('../src/game/storyPage');

function setup() {
  session.save = newGame(GAME, 0);
  const scene = new ChronicleScene();
  const restart = vi.fn();
  Object.assign(scene, { scene: { restart }, sys: { isActive: () => true }, events: new EventEmitter(), textures: { exists: () => false }, children: { getByName: vi.fn() } });
  const redraws: string[] = [];
  for (const name of ['world', 'findings', 'bestiary', 'items', 'heroes'] as const) vi.spyOn(scene as any, name).mockImplementation(() => redraws.push(name));
  scene.create({ tab: 'world' });
  return { scene, restart, redraws, area: (scene as any).area };
}

beforeEach(() => { vi.clearAllMocks(); harness.bottom = 1220; harness.onView = undefined; harness.history = undefined; harness.buttons = []; });

describe('настоящие обработчики ChronicleScene', () => {
  it('переключение пяти вкладок не перезапускает сцену и возвращает независимую прокрутку', () => {
    const h = setup(); h.area.offset = 380;
    harness.changeTab!(1); h.area.offset = 170;
    harness.changeTab!(4); h.area.offset = 290;
    harness.changeTab!(0); expect(h.area.offset).toBe(380);
    harness.changeTab!(1); expect(h.area.offset).toBe(170);
    harness.changeTab!(4); expect(h.area.offset).toBe(290);
    expect(h.restart).not.toHaveBeenCalled();
    expect(h.redraws).toEqual(['world', 'findings', 'heroes', 'world', 'findings', 'heroes']);
  });
  it('SDK resize обновляет маску/границы существующего списка, сохраняя вкладку и offset', () => {
    const h = setup(); harness.changeTab!(3); h.area.offset = 333;
    harness.bottom = 1580; harness.onView!();
    expect(h.area.setBounds).toHaveBeenCalledWith(402, 1580);
    expect(h.area.offset).toBe(333);
    expect((h.scene as any).tab).toBe('items');
    expect(h.redraws).toEqual(['world', 'items']);
    expect(h.restart).not.toHaveBeenCalled();
  });
  it('чтение истории героя обновляет отметки и возвращает тот же список без scene restart', () => {
    const h = setup(); harness.changeTab!(4); h.area.offset = 270;
    (h.scene as any).heroModal({ templateId: 'alan', owned: true });
    harness.lore.extra.onTap(); harness.heroStory.onClose();
    expect(h.area.offset).toBe(270);
    expect(h.redraws).toEqual(['world', 'heroes', 'heroes']);
    expect(h.restart).not.toHaveBeenCalled();
  });
  it('уничтожение старого окна не перерисовывает новую сцену или другой ScrollArea', () => {
    const h = setup(); harness.changeTab!(4);
    (h.scene as any).heroModal({ templateId: 'alan', owned: true }); harness.lore.extra.onTap();
    (h.scene as any).area = { offset: 500 }; harness.heroStory.onClose();
    expect(h.redraws).toEqual(['world', 'heroes']); expect(h.restart).not.toHaveBeenCalled();
  });
  it('карточка вечеров передаёт реальную позицию списка в обратный маршрут', () => {
    const h = setup(); h.area.offset = 48;
    Object.assign(h.scene, { add: {
      image: () => Object.assign(new Node(), { width: 1000, height: 1000, setCrop() { return this; }, setScale() { return this; } }),
      graphics: () => ({ fillGradientStyle() { return this; }, fillRect() { return this; } }),
    } });
    (h.scene as any).tavernCard(0); harness.tavernTap!();
    expect(startTavernEvening).toHaveBeenCalledWith(h.scene, { mode: 'hub', back: { to: 'Chronicle', data: { tab: 'world', scroll: 48 } } });
    expect(h.restart).not.toHaveBeenCalled();
  });
  it('эпизод открывается после завершения sheet.close, чтобы поздний callback не разблокировал новый рассказ', () => {
    const h = setup(); const read = vi.spyOn(h.scene as any, 'read').mockImplementation(() => { h.area.locked = true; });
    const chapter = GAME.content.chapters[0];
    (h.scene as any).worldSheet({ kind: 'chapter', id: chapter.id, chapterName: chapter.name, open: true });
    const episode = harness.buttons.find((b) => b.node.name === `chronicleEpisode_${chapter.id}`)!;
    episode.tap(); expect(harness.sheetClose).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
    harness.sheetDone!(); expect(read).toHaveBeenCalledOnce(); expect(h.area.locked).toBe(true);
  });
  it('обычное закрытие sheet не открывает страницу и разблокирует ровно прежний список', () => {
    const h = setup(); const read = vi.spyOn(h.scene as any, 'read');
    const chapter = GAME.content.chapters[0];
    (h.scene as any).worldSheet({ kind: 'chapter', id: chapter.id, chapterName: chapter.name, open: true });
    expect(h.area.locked).toBe(true); harness.sheetDone!();
    expect(h.area.locked).toBe(false); expect(read).not.toHaveBeenCalled(); expect(h.restart).not.toHaveBeenCalled();
  });
  it('передаёт helper страницы captured lock, который helper освободит и при внешнем DESTROY', () => {
    const h = setup(); const pages = [{ kind: 'finding', title: 'Запись', body: 'Текст' }];
    (h.scene as any).read(pages);
    expect(showPages).toHaveBeenCalledWith(h.scene, pages, expect.any(Function), { lock: h.area });
    expect(h.restart).not.toHaveBeenCalled();
  });
  it('история главы получает прежний список после завершения sheet.close и удерживает его во время replay', () => {
    const h = setup(); const chapter = GAME.content.chapters[0];
    session.save.seenScenes = GAME.story.scenes.filter((s) => s.chapter === chapter.id).map((s) => s.id);
    (h.scene as any).worldSheet({ kind: 'chapter', id: chapter.id, chapterName: chapter.name, open: true });
    const scenes = harness.buttons.find((b) => b.node.name === `chronicleScenes_${chapter.id}`)!;
    scenes.tap(); expect(harness.history).toBeUndefined();
    const replacement = { locked: false, offset: 600 }; (h.scene as any).area = replacement;
    harness.sheetDone!();
    expect(harness.history.lock).toBe(h.area);
    expect(h.area.locked).toBe(true); expect(replacement.locked).toBe(false);
    expect(h.restart).not.toHaveBeenCalled();
  });
  it('переход в Город и повторный вход сохраняют позиции вкладок в пределах сессии', () => {
    const h = setup(); h.area.offset = 210; harness.changeTab!(4); h.area.offset = 540;
    h.scene.events.emit('shutdown');
    const reopened = setup(); expect(reopened.area.offset).toBe(210);
    harness.changeTab!(4); expect(reopened.area.offset).toBe(540);
    expect(reopened.restart).not.toHaveBeenCalled();
  });
});
