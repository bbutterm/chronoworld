import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const node = () => {
    const n: any = { width: 100, height: 136, list: [], setName: () => n, setOrigin: () => n, setY: vi.fn(), destroy: vi.fn(), add: () => n };
    return n;
  };
  return {
    node, bottom: 1220, active: true, giftSend: vi.fn(), friends: vi.fn(), board: vi.fn(), claimBells: vi.fn(),
    restart: vi.fn(), toast: vi.fn(), commit: vi.fn(), login: vi.fn(), claimLogin: vi.fn(),
    fly: vi.fn(), shield: vi.fn(), views: [] as (() => void)[],
  };
});
vi.mock('phaser', () => ({ default: { Scene: class {}, Scenes: { Events: { SHUTDOWN: 'shutdown', CREATE: 'create' } } } }));
vi.mock('../src/game/content', () => ({ GAME: {} }));
vi.mock('../src/game/screen', () => ({ CONTENT_TOP: 160, contentBottom: () => h.bottom, screen: vi.fn(), dot: vi.fn() }));
vi.mock('../src/game/viewport', () => ({ onViewChange: (_scene: unknown, fn: () => void) => h.views.push(fn) }));
vi.mock('../src/game/ui', () => ({
  BTN: { icon: 96, m: 96, l: 120 }, SURFACE: { surface: {}, raised: {}, sunken: {} },
  text: h.node, plate: h.node, segmented: () => ({ container: h.node() }), listRow: h.node,
  button: () => ({ container: h.node(), setEnabled: vi.fn() }), chip: h.node,
  ellipsize: vi.fn(), mixHex: () => '#aa8866', toast: h.toast, shieldTaps: h.shield,
  pressable: vi.fn(), progressBar: h.node, tag: h.node, ScrollArea: class {},
}));
vi.mock('../src/game/online/api', () => ({ api: { giftSend: h.giftSend, friends: h.friends, board: h.board }, onlineAvailable: () => true, openTgLink: vi.fn() }));
vi.mock('../src/game/online/online', () => ({ claimBells: h.claimBells, onlineState: { giftsWaiting: 0 }, setGiftsWaiting: vi.fn() }));
vi.mock('../src/game/online/entry', () => ({ appLink: () => null, bellIcon: h.node }));
vi.mock('../src/game/juice', () => ({ collect: () => [], staggerIn: vi.fn(), afterRewardFly: vi.fn(), queueRewardFly: h.fly, juiceOn: () => false, pulse: vi.fn() }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/session', () => ({ session: { save: { resources: { gold: 0 }, currency: { gems: 0 } } }, commit: h.commit, today: () => '2026-10-05', restartOnNewDay: vi.fn() }));
vi.mock('../src/core', () => ({ loginStatus: h.login, claimLogin: h.claimLogin, newbieStatus: vi.fn(), claimNewbieTask: vi.fn(), claimNewbieMilestone: vi.fn() }));
vi.mock('../src/game/decor', () => ({ slowRays: vi.fn() }));
vi.mock('../src/game/heroCard', () => ({ heroCardIcon: h.node }));
vi.mock('../src/game/homeBuildings', () => ({ artCardTexture: vi.fn() }));
vi.mock('../src/game/homeEvents', () => ({ touchToday: vi.fn() }));
vi.mock('../src/game/rewardsView', () => ({ rewardToast: () => 'Получено', rewardItems: () => [], rewardText: () => '', rewardIcon: h.node }));
vi.mock('../src/game/skin', () => ({ skinIcon: (name: string) => name }));

import { EventsScene } from '../src/game/scenes/EventsScene';
import { FriendsScene } from '../src/game/scenes/FriendsScene';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function friends(): any {
  const scene: any = new FriendsScene();
  scene.gen = 1;
  scene.sys = { isActive: () => h.active };
  scene.scene = { restart: h.restart };
  scene.events = { once: vi.fn() };
  scene.area = { offset: 72, clear: vi.fn(), setBounds: vi.fn(), setContentHeight: vi.fn(), add: (n: unknown) => n, content: h.node() };
  return scene;
}
const friend = () => ({ id: 101, name: 'Вика', giftSent: false });
const bell = () => ({ setSent: vi.fn(), setBusy: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks(); h.active = true; h.bottom = 1220; h.views.length = 0;
  h.login.mockReturnValue({ days: [{ day: 1, reached: true, claimed: false }] });
  h.claimLogin.mockReturnValue({ save: {}, rewards: {}, events: [] });
});

describe('поздние ответы друзей и повторные нажатия', () => {
  it('одна отправка при двух нажатиях; после успеха показан полученный колокольчик', async () => {
    const s = friends(), b = bell(), f = friend(), request = deferred<boolean>();
    h.giftSend.mockReturnValue(request.promise);
    const sending = s.ring(f, b);
    await s.ring(f, b);
    expect(h.giftSend).toHaveBeenCalledTimes(1);
    expect(b.setBusy).toHaveBeenCalledWith(true);
    request.resolve(true); await sending;
    expect(f.giftSent).toBe(true);
    expect(b.setSent).toHaveBeenCalledWith(true);
    expect(s.busy).toBe(false);
  });

  it('ответ старого запуска не меняет новый список и не снимает busy нового запроса', async () => {
    const s = friends(), b = bell(), f = friend(), request = deferred<boolean>();
    h.giftSend.mockReturnValue(request.promise);
    const old = s.ring(f, b);
    s.gen++; s.busy = true;
    request.resolve(true); await old;
    expect(b.setSent).not.toHaveBeenCalled();
    expect(b.setBusy).toHaveBeenCalledTimes(1);
    expect(f.giftSent).toBe(false);
    expect(s.busy).toBe(true);
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('ошибка отправки позволяет повторить; уже отправленная кнопка объясняет ограничение', async () => {
    const s = friends(), b = bell(), f = friend();
    h.giftSend.mockResolvedValue(false);
    await s.ring(f, b);
    expect(s.busy).toBe(false);
    expect(b.setBusy).toHaveBeenLastCalledWith(false);
    expect(b.setSent).not.toHaveBeenCalled();
    await s.ring({ ...f, giftSent: true }, b);
    expect(h.giftSend).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenLastCalledWith(s, 'Сегодня вы уже звонили: Вика');
  });

  it('один запрос получения; его поздний ответ не перезапускает новую вкладку', async () => {
    const s = friends(), b = { setEnabled: vi.fn() }, request = deferred<number | null>();
    h.claimBells.mockReturnValue(request.promise);
    const old = s.claim(b); await s.claim(b);
    expect(h.claimBells).toHaveBeenCalledTimes(1);
    s.gen++; s.busy = true;
    request.resolve(2); await old;
    expect(h.restart).not.toHaveBeenCalled();
    expect(s.busy).toBe(true);
    expect(b.setEnabled).toHaveBeenCalledTimes(1);
  });

  it('получение без связи возвращает доступную кнопку и сохраняет список', async () => {
    const s = friends(), b = { setEnabled: vi.fn() };
    h.claimBells.mockResolvedValue(null);
    await s.claim(b);
    expect(b.setEnabled).toHaveBeenLastCalledWith(true);
    expect(s.busy).toBe(false);
    expect(h.restart).not.toHaveBeenCalled();
  });
});

describe('границы рекордов и получение наград событий', () => {
  it('после пустого ответа повторное открытие рисует cache внутри create, не ожидая active', async () => {
    const first = friends(), request = deferred<any>(); first.top = 320; first.drawFriends = vi.fn();
    h.friends.mockReturnValue(request.promise);
    first.friendsTab(); request.resolve([]); await request.promise; await Promise.resolve();
    expect(first.drawFriends).toHaveBeenCalledWith([], null);
    const second = friends(); second.top = 320; second.drawFriends = vi.fn(); h.active = false;
    second.friendsTab();
    expect(second.drawFriends).toHaveBeenCalledWith([], null);
    expect(h.friends).toHaveBeenCalledTimes(1);
  });

  it('myPlace и маска следуют новому низу, сохраняя существующий offset', () => {
    const s = friends(); s.mine = h.node(); s.recordsBody = true; s.listTop = 624;
    h.bottom = 1160; s.reflow();
    expect(s.mine.setY).toHaveBeenLastCalledWith(1092);
    expect(s.area.setBounds).toHaveBeenLastCalledWith(624, 1008);
    expect(s.area.offset).toBe(72);
    h.bottom = 1730; s.reflow();
    expect(s.mine.setY).toHaveBeenLastCalledWith(1662);
    expect(s.area.setBounds).toHaveBeenLastCalledWith(624, 1578);
    expect(h.restart).not.toHaveBeenCalled();
  });

  it('доска, пришедшая после resize, рисует место по актуальной границе', async () => {
    const s = friends(), request = deferred<any>(); s.top = 320;
    s.opts = { tab: 'records', board: 'mvp', scope: 'friends' };
    s.drawBoard = vi.fn(); h.board.mockReturnValue(request.promise);
    h.active = false; // Phaser ставит active после create; начальную загрузку всё равно нужно начать.
    s.recordsTab();
    expect(h.board).toHaveBeenCalledTimes(1);
    h.active = true; h.bottom = 1160; s.reflow();
    request.resolve({ week: '', top: [], mine: null });
    await request.promise; await Promise.resolve();
    expect(s.drawBoard).toHaveBeenCalledWith({ week: '', top: [], mine: null }, 1092);
  });

  it('событие перечитывает готовность: устаревшая плитка не выдаёт уже полученную награду', () => {
    const s: any = new EventsScene();
    h.login.mockReturnValue({ days: [{ day: 1, reached: true, claimed: true }] });
    s.claimDay({ day: 1, reached: true, claimed: false }, { x: 200, y: 700 });
    expect(h.claimLogin).not.toHaveBeenCalled(); expect(h.commit).not.toHaveBeenCalled();
  });

  it('один commit при повторном нажатии до restart; reward fly учитывает прокрутку', () => {
    const s: any = new EventsScene(); s.area = { offset: 320, content: { y: -144 } };
    s.restartWithToast = vi.fn();
    s.claimDay({ day: 1, reached: true, claimed: false }, { x: 200, y: 700 });
    s.claimDay({ day: 1, reached: true, claimed: false }, { x: 200, y: 700 });
    expect(h.claimLogin).toHaveBeenCalledTimes(1); expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.fly).toHaveBeenCalledWith('Events', { x: 200, y: 556 }, { gold: 0, gems: 0 }, { burst: true });
  });

  it('до перестановки заданий после награды включается общий щит от проваливающегося тапа', () => {
    const s: any = new EventsScene(), game = {};
    s.sys = { game }; s.area = { offset: 320 }; s.scene = { restart: h.restart }; s.events = { once: vi.fn() };
    s.restartWithToast('Получено', { tab: 'newbie', day: 1 }, false);
    expect(h.shield).toHaveBeenCalledWith(game);
    expect(h.shield.mock.invocationCallOrder[0]).toBeLessThan(h.restart.mock.invocationCallOrder[0]);
    expect(h.restart).toHaveBeenCalledWith({ tab: 'newbie', day: 1, offset: 320 });
  });
});
