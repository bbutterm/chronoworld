import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { deserialize, newGame, serialize, startTowerRun, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const harness = vi.hoisted(() => ({
  session: { save: undefined as unknown as SaveState },
  commits: [] as ((next: SaveState, prev: SaveState) => void)[],
  hidden: [] as (() => void)[],
  buttons: [] as { label: string; click: () => void }[],
  saved: [] as string[],
  backedUp: [] as string[],
  sceneKey: 'Campaign',
}));
vi.mock('phaser', () => ({ default: { GameObjects: { Events: { DESTROY: 'destroy' } } } }));
vi.mock('../src/game/content', async () => ({ GAME: (await import('../scripts/lib/content-node')).loadFullContext() }));
vi.mock('../src/game/session', () => ({
  session: harness.session,
  now: () => Date.now(), today: () => '2026-10-04',
  onCommit: (fn: (next: SaveState, prev: SaveState) => void) => harness.commits.push(fn),
  commit: (save: SaveState) => {
    const prev = harness.session.save;
    harness.session.save = { ...save, revision: (prev.revision ?? 0) + 1 };
    for (const fn of harness.commits) fn(harness.session.save, prev);
  },
}));
vi.mock('../src/game/lifecycle', () => ({ onAppHidden: (fn: () => void) => harness.hidden.push(fn) }));
vi.mock('../src/game/haptics', () => ({ haptic: vi.fn() }));
vi.mock('../src/game/screen', () => ({ popIn: vi.fn() }));
vi.mock('../src/game/storage', () => ({
  SAVE_KEY: 'chronoworld.save.v1',
  LocalStorageAdapter: class {
    writable = true;
    backup(value: string) { harness.backedUp.push(value); }
    save(value: string) { harness.saved.push(value); }
  },
}));
vi.mock('../src/game/ui', () => ({
  toast: vi.fn(),
  text: (_scene: unknown, _x: number, y: number) => ({ height: 60, y, setY(value: number) { this.y = value; return this; } }),
  panel: () => ({ setInteractive() { return this; } }),
  button: (_s: unknown, _x: number, _y: number, _w: number, _h: number, _texture: string, label: string, click: () => void) => {
    harness.buttons.push({ label, click });
    return { container: { setName() { return this; } } };
  },
}));
vi.mock('../src/game/online/api', () => ({
  onlineAvailable: () => true,
  api: { hello: vi.fn(), saveGet: vi.fn(), savePut: vi.fn(), sync: vi.fn(), rewardClaim: vi.fn() },
}));

import { api } from '../src/game/online/api';
import { claimBells, onlineState, recordMvpAttempt, recordTowerProgress, resetOnlineForTests, startOnline } from '../src/game/online/online';
import type { OnlineProgress } from '../src/game/online/logic';
import { commit } from '../src/game/session';

const ctx = loadFullContext();
const DATE = Date.parse('2026-10-04T12:00:00Z');
const gift = { id: '00000000-0000-4000-8000-000000000001', kind: 'gift' as const, units: 1, gems: 20 };
const remote = () => ({ data: JSON.parse(serialize(newGame(ctx, DATE, '2026-10-04'))), chapter: 2, saveVersion: 7, updatedAt: DATE, writeRevision: 17 });
const modalInfo = { chapter: 2, saveVersion: 7, updatedAt: DATE, writeRevision: 17 };
const localStorageFake = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
};
function game(): Phaser.Game {
  const scene = {
    scene: { key: 'Campaign' }, sys: { settings: { active: true } },
    add: {
      container: () => ({ setDepth() { return this; }, setName() { return this; }, add() { return this; }, once() { return this; }, destroy() {} }),
      rectangle: () => ({ setInteractive() { return this; } }),
    },
  };
  return { scene: { getScenes: () => { scene.scene.key = harness.sceneKey; return [scene]; } } } as unknown as Phaser.Game;
}
async function settled() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DATE);
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', localStorageFake());
  vi.stubGlobal('location', { reload: vi.fn() });
  harness.session.save = newGame(ctx, DATE, '2026-10-04');
  harness.commits.length = harness.hidden.length = harness.buttons.length = harness.saved.length = harness.backedUp.length = 0;
  harness.sceneKey = 'Campaign';
  resetOnlineForTests();
  vi.mocked(api.hello).mockResolvedValue({ id: 42, name: 'Вика', fresh: false, cloudSave: null, giftsWaiting: 0, refBonus: 0, protocol: 2 });
  vi.mocked(api.saveGet).mockResolvedValue(null);
  vi.mocked(api.rewardClaim).mockResolvedValue([]);
  vi.mocked(api.sync).mockResolvedValue({ refRewarded: false });
  vi.mocked(api.savePut).mockImplementation(async (_data, _version, _chapter, opts) => ({ status: 'saved', writeRevision: opts.expectedRevision + 1 }));
});
afterEach(() => { resetOnlineForTests(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('онлайн: сохранность прогресса и доставка наград через реальный контроллер', () => {
  it('награды/записи/реферальный sync ждут выбора облака; продолжение облака резервирует локальную игру', async () => {
    vi.mocked(api.hello).mockResolvedValue({ id: 42, name: 'Вика', fresh: false, cloudSave: modalInfo, giftsWaiting: 1, refBonus: 1, protocol: 2 });
    vi.mocked(api.saveGet).mockResolvedValue(remote());
    startOnline(game());
    await settled();
    expect(onlineState.cloudReady).toBe(false);
    expect(api.rewardClaim).not.toHaveBeenCalled();
    expect(api.savePut).not.toHaveBeenCalled();
    expect(api.sync).not.toHaveBeenCalled();
    expect(await claimBells()).toBeNull();
    const before = serialize(harness.session.save);
    harness.buttons.find((b) => b.label === 'Да')!.click();
    await settled();
    expect(harness.backedUp).toEqual([before]);
    expect(harness.saved).toHaveLength(1);
    expect(location.reload).toHaveBeenCalled();
    expect(api.rewardClaim).not.toHaveBeenCalled();
  });

  it('сохранение неверного ответа остаётся dirty; retry использует тот же writeId и снимок', async () => {
    vi.mocked(api.savePut).mockResolvedValueOnce(null);
    startOnline(game());
    await settled();
    const first = vi.mocked(api.savePut).mock.calls[0];
    commit({ ...harness.session.save, currency: { ...harness.session.save.currency, gems: 999 } });
    await vi.advanceTimersByTimeAsync(60_000);
    const retry = vi.mocked(api.savePut).mock.calls[1];
    expect(retry[0]).toEqual(first[0]);
    expect(retry[3].writeId).toBe(first[3].writeId);
    expect(retry[3].expectedRevision).toBe(first[3].expectedRevision);
    await vi.advanceTimersByTimeAsync(60_000);
    const latest = vi.mocked(api.savePut).mock.calls.at(-1)!;
    expect((latest[0] as SaveState).currency.gems).toBe(999);
    expect(latest[3].expectedRevision).toBe(1);
    expect(harness.session.save.currency.gems).toBe(999);
  });

  it('commit во время запроса и новый grant не теряются; каждый UUID применяется и сериализуется один раз', async () => {
    const first = deferred<Awaited<ReturnType<typeof api.savePut>>>();
    vi.mocked(api.savePut).mockImplementationOnce(() => first.promise);
    vi.mocked(api.rewardClaim).mockResolvedValue([gift]);
    startOnline(game());
    await settled();
    const grantedGems = harness.session.save.currency.gems;
    expect(harness.session.save.online?.appliedGrantIds).toEqual([gift.id]);
    commit({ ...harness.session.save, resources: { ...harness.session.save.resources, gold: 12345 } });
    first.resolve({ status: 'saved', writeRevision: 1 });
    await settled();
    expect(await claimBells()).toBe(0);
    expect(harness.session.save.currency.gems).toBe(grantedGems);
    await vi.advanceTimersByTimeAsync(60_000);
    const latest = vi.mocked(api.savePut).mock.calls.at(-1)!;
    expect((latest[0] as SaveState).resources.gold).toBe(12345);
    const reloaded = deserialize(JSON.stringify(latest[0]));
    expect(reloaded.online?.appliedGrantIds).toEqual([gift.id]);
    expect(latest[3].expectedRevision).toBe(1);
  });

  it('409 не меняет локальный прогресс; осознанное сохранение локальной игры сохраняет историю grants', async () => {
    const cloud = remote();
    cloud.data.online = { appliedGrantIds: [gift.id] };
    vi.mocked(api.saveGet).mockResolvedValue(cloud);
    vi.mocked(api.savePut).mockResolvedValueOnce({ status: 'conflict', cloudSave: modalInfo });
    harness.session.save = { ...harness.session.save, currency: { ...harness.session.save.currency, gems: 999 } };
    startOnline(game());
    await settled();
    expect(onlineState.cloudConflict).toBe(true);
    expect(onlineState.cloudReady).toBe(false);
    expect(harness.session.save.currency.gems).toBe(999);
    harness.buttons.find((b) => b.label === 'Нет, оставить это')!.click();
    await settled();
    expect(onlineState.cloudReady).toBe(true);
    expect(harness.session.save.currency.gems).toBe(999);
    expect(harness.session.save.online?.appliedGrantIds).toEqual([gift.id]);
    harness.hidden[0]();
    await settled();
    expect(vi.mocked(api.savePut).mock.calls.at(-1)![3].expectedRevision).toBe(17);
  });

  it('сворачивание записывает изменения внутри минутного окна, а недельный зачёт хранится в SaveState', async () => {
    startOnline(game());
    await settled();
    recordMvpAttempt(900);
    expect(harness.session.save.online?.mvpWeek?.value).toBe(900);
    vi.setSystemTime(Date.parse('2026-10-05T12:00:00Z'));
    recordMvpAttempt(500);
    expect(harness.session.save.online?.mvpWeek).toEqual({ week: '2026-W41', value: 500 });
    // Сначала отправили свежую неделю; затем commit и немедленное сворачивание той же минуты.
    await settled();
    commit({ ...harness.session.save, resources: { ...harness.session.save.resources, gold: 4321 } });
    harness.hidden[0]();
    await settled();
    const latest = vi.mocked(api.savePut).mock.calls.at(-1)!;
    expect(latest[3].keepalive).toBe(true);
    expect((latest[0] as SaveState).resources.gold).toBe(4321);
    expect(deserialize(serialize(harness.session.save)).online?.mvpWeek?.value).toBe(500);
  });

  it('Башня: resume старого забега не начисляет этаж новой недели; зачёт начинается после реально сыгранного боя', async () => {
    let save = harness.session.save;
    const chapter = ctx.content.chapters.find((c) => c.order === 1)!;
    save = { ...save, campaign: { cleared: ctx.content.stages.filter((s) => s.chapter === chapter.id).map((s) => s.id) }, tower: { ...save.tower, floor: 100 } };
    save = startTowerRun(save, save.squad, ctx);
    save = { ...save, tower: { ...save.tower, run: { ...save.tower.run!, floor: 23 } },
      online: { appliedGrantIds: [], towerWeek: { week: '2026-W40', value: 80 } } } as SaveState;
    // Читаем сохранённый забег на следующей неделе, но пока ни одного боя не было.
    harness.session.save = deserialize(serialize(save));
    vi.setSystemTime(Date.parse('2026-10-05T12:00:00Z'));
    startOnline(game());
    await settled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.mocked(api.sync).mock.calls.at(-1)![0]).toMatchObject({ towerBest: 100, towerWeek: 0, towerWeekId: '2026-W41' });
    // После победы достигли 24-го этажа продолженного забега: lifetime100 не мешает получить недельный24.
    commit({ ...harness.session.save, tower: { ...harness.session.save.tower, run: { ...harness.session.save.tower.run!, floor: 24 } } });
    recordTowerProgress(24);
    expect((harness.session.save.online as OnlineProgress).towerWeek).toEqual({ week: '2026-W41', value: 24 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.mocked(api.sync).mock.calls.at(-1)![0]).toMatchObject({ towerBest: 100, towerWeek: 24 });
    recordTowerProgress(4);
    expect((harness.session.save.online as OnlineProgress).towerWeek?.value).toBe(24);
    vi.setSystemTime(Date.parse('2026-10-12T12:00:00Z'));
    recordTowerProgress(4);
    expect((deserialize(serialize(harness.session.save)).online as OnlineProgress).towerWeek).toEqual({ week: '2026-W42', value: 4 });
    expect(harness.session.save.tower.floor).toBe(100);
  });

  it('grant, полученный сетью во время боя, ждёт итога и применяется к свежему снимку', async () => {
    const incoming = deferred<Awaited<ReturnType<typeof api.rewardClaim>>>();
    vi.mocked(api.rewardClaim).mockResolvedValue([gift]).mockImplementationOnce(() => incoming.promise);
    startOnline(game());
    await settled();
    const beforeBattle = harness.session.save;
    harness.sceneKey = 'Battle';
    incoming.resolve([gift]);
    await settled();
    expect(harness.session.save.online?.appliedGrantIds).toBeUndefined();
    // Медленный бой длится больше прежнего 30-секундного окна UI retry.
    await vi.advanceTimersByTimeAsync(35_000);
    expect(api.rewardClaim).toHaveBeenCalledTimes(1);
    commit({ ...beforeBattle, campaign: { cleared: ['ch1_s1'] }, resources: { ...beforeBattle.resources, gold: 4321 } });
    harness.sceneKey = 'Result';
    await vi.advanceTimersByTimeAsync(500);
    expect(harness.session.save.campaign.cleared).toEqual(['ch1_s1']);
    expect(harness.session.save.resources.gold).toBe(4321);
    expect(harness.session.save.currency.gems).toBe(beforeBattle.currency.gems + 20);
    expect(harness.session.save.online?.appliedGrantIds).toEqual([gift.id]);
    expect(api.rewardClaim).toHaveBeenCalledTimes(2);
  });

  it('выбор облака ждёт длинного боя и остаётся доступным после прежнего timeout', async () => {
    harness.sceneKey = 'Battle';
    vi.mocked(api.hello).mockResolvedValue({ id: 42, name: 'Вика', fresh: false, cloudSave: modalInfo, giftsWaiting: 1, refBonus: 1, protocol: 2 });
    startOnline(game());
    await settled();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(harness.buttons).toHaveLength(0);
    expect(api.rewardClaim).not.toHaveBeenCalled();
    expect(onlineState.cloudReady).toBe(false);
    harness.sceneKey = 'Result';
    await vi.advanceTimersByTimeAsync(500);
    expect(harness.buttons.map((button) => button.label)).toEqual(['Да', 'Нет, оставить это']);
  });

  it('если бой начался во время загрузки выбранного облака, backup и reload ждут его завершения', async () => {
    const incoming = deferred<Awaited<ReturnType<typeof api.saveGet>>>();
    vi.mocked(api.hello).mockResolvedValue({ id: 42, name: 'Вика', fresh: false, cloudSave: modalInfo, giftsWaiting: 0, refBonus: 0, protocol: 2 });
    vi.mocked(api.saveGet).mockImplementation(() => incoming.promise);
    startOnline(game());
    await settled();
    harness.buttons.find((button) => button.label === 'Да')!.click();
    harness.sceneKey = 'Battle';
    incoming.resolve(remote());
    await settled();
    expect(harness.backedUp).toHaveLength(0);
    expect(location.reload).not.toHaveBeenCalled();
    commit({ ...harness.session.save, campaign: { cleared: ['ch1_s1'] } });
    harness.sceneKey = 'Result';
    await vi.advanceTimersByTimeAsync(500);
    expect(JSON.parse(harness.backedUp[0]).campaign.cleared).toEqual(['ch1_s1']);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it('старый WebView без crypto.randomUUID продолжает создавать корректный ключ retry', async () => {
    const crypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    startOnline(game());
    await settled();
    expect(api.savePut).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.savePut).mock.calls[0][3].writeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
