import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFullContext } from '../scripts/lib/content-node';
import {
  actClaimOffline, actPlayStage, achievementStatus, claimAllMail, newGame, questStatus,
  shopStatus, touchEvents, type SaveState, type ShopSlotView,
} from '../src/core';

const state = vi.hoisted(() => ({ save: undefined as SaveState | undefined, writes: [] as SaveState[] }));
const DAY = '2026-10-23';
const NOW = Date.UTC(2026, 9, 23, 12);
const fullContext = loadFullContext();
if (!fullContext.shop) throw new Error('Отсутствует лавка в реальном контексте');
const GAME = { ...fullContext, shop: fullContext.shop };

vi.mock('phaser', () => ({ default: { Scene: class {}, GameObjects: { Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1 } } }));
vi.mock('../src/game/content', async () => ({ GAME: (await import('../scripts/lib/content-node')).loadFullContext() }));
vi.mock('../src/game/session', () => ({
  session: state, now: () => Date.UTC(2026, 9, 23, 12), today: () => '2026-10-23',
  commit: (save: SaveState) => { state.save = save; state.writes.push(save); },
}));
vi.mock('../src/game/juice', async (original) => ({ ...(await original<object>()), queueRewardFly: vi.fn() }));
vi.mock('../src/game/ui', async (original) => ({ ...(await original<object>()), toast: vi.fn() }));
vi.mock('../src/game/inboxRows', async (original) => ({ ...(await original<object>()), queueClaimFx: vi.fn() }));

const { MailScene } = await import('../src/game/scenes/MailScene');
const { QuestsScene } = await import('../src/game/scenes/QuestsScene');
const { AchievementsScene } = await import('../src/game/scenes/AchievementsScene');
const { ShopScene } = await import('../src/game/scenes/ShopScene');
const { sameShopOffer } = await import('../src/game/utilityScreenLayout');

const late = (): SaveState => JSON.parse(readFileSync('tests/fixtures/boot-late-save.json', 'utf8'));
const sceneActions = <T>(scene: object): T => scene as T;

beforeEach(() => { state.save = undefined; state.writes = []; vi.clearAllMocks(); });

describe('старое нажатие не выдаёт награду второй раз', () => {
  it('письмо и «забрать всё» используют актуальное состояние и одну запись', () => {
    state.save = touchEvents(newGame(GAME, NOW, DAY), DAY, GAME);
    const letter = state.save.mail!.letters.find((l) => !l.claimed)!;
    const scene = Object.assign(new MailScene(), { after: vi.fn(), drawList: vi.fn() });
    const actions = sceneActions<{ claim(l: typeof letter, point: { x: number; y: number }): void; claimAll(): void }>(scene);
    const expected = claimAllMail(state.save, GAME).save;
    actions.claim(letter, { x: 540, y: 600 });
    const first = state.save;
    actions.claim(letter, { x: 540, y: 600 });
    actions.claimAll();
    expect(state.writes).toHaveLength(1);
    expect(state.save).toBe(first);
    expect(state.save?.resources).toEqual(expected.resources);
    expect(state.save?.currency).toEqual(expected.currency);
  });

  it('задания и пороги после claimAll не записываются повторно', () => {
    let save = actClaimOffline(late(), NOW, DAY, GAME).save;
    for (let i = 0; i < 5; i++) save = actPlayStage(save, DAY, 'ch1_s1', 900 + i, GAME, NOW).save;
    state.save = save;
    const quest = questStatus(save, GAME, DAY).quests.find((q) => q.done && !q.claimed)!;
    expect(quest).toBeDefined();
    const scene = Object.assign(new QuestsScene(), { refreshKeep: vi.fn() });
    const actions = sceneActions<{ claim(q: typeof quest): void; claimAll(): void }>(scene);
    actions.claim(quest);
    actions.claim(quest);
    expect(state.writes).toHaveLength(1);
    actions.claimAll();
    const first = state.save;
    const writes = state.writes.length;
    actions.claimAll();
    expect(state.writes).toHaveLength(writes);
    expect(state.save).toBe(first);
    expect(new Set(state.save!.daily.claimedQuests).size).toBe(state.save!.daily.claimedQuests.length);
    expect(new Set(state.save!.daily.activityClaimed).size).toBe(state.save!.daily.activityClaimed.length);
  });

  it('достижение, полученное отдельной кнопкой, не оплачивается второй раз', () => {
    let save = newGame(GAME, NOW, DAY);
    for (let i = 0; i < 8 && !save.campaign.cleared.length; i++) save = actPlayStage(save, DAY, 'ch1_s1', 1 + i, GAME, NOW).save;
    state.save = save;
    const achievement = achievementStatus(save, GAME).find((a) => a.done && !a.claimed)!;
    expect(achievement).toBeDefined();
    const scene = Object.assign(new AchievementsScene(), { refreshKeep: vi.fn() });
    const actions = sceneActions<{ claim(a: typeof achievement, point: { x: number; y: number }): void; claimAll(): void }>(scene);
    actions.claim(achievement, { x: 860, y: 600 });
    const first = state.save;
    actions.claim(achievement, { x: 860, y: 600 });
    actions.claimAll();
    expect(state.writes).toHaveLength(1);
    expect(state.save).toBe(first);
  });
});

describe('покупка относится к показанному товару и остатку', () => {
  it('повтор старого intent не покупает вторую единицу даже при stock=2', () => {
    state.save = late();
    const status = shopStatus(state.save, DAY, GAME);
    const slot = status.slots.find((s) => s.stock === 2 && s.affordable)!;
    expect(slot).toBeDefined();
    const scene = Object.assign(new ShopScene(), { area: { offset: 750 }, drawStock: vi.fn() });
    const actions = sceneActions<{ buy(s: ShopSlotView, day: string, refreshes: number): void }>(scene);
    const before = structuredClone(state.save);
    actions.buy(slot, status.day, status.refreshes);
    const first = state.save;
    actions.buy(slot, status.day, status.refreshes);
    expect(state.writes).toHaveLength(1);
    expect(state.save).toBe(first);
    expect(state.save!.resources.gold).toBe(before.resources.gold - slot.price);
    expect(state.save!.resources.heroExp).toBe(before.resources.heroExp + slot.count);
    const fresh = shopStatus(state.save!, DAY, GAME).slots[slot.index];
    expect(fresh.bought).toBe(1);
    actions.buy(fresh, status.day, status.refreshes);
    expect(state.writes).toHaveLength(2);
    expect(state.save!.resources.gold).toBe(before.resources.gold - 2 * slot.price);
    expect(shopStatus(state.save!, DAY, GAME).slots[slot.index].bought).toBe(2);
  });

  it('товар того же слота после полуночи/обновления не принимает старое подтверждение', () => {
    const status = shopStatus(late(), DAY, GAME);
    const slot = status.slots[0];
    expect(sameShopOffer(slot, slot, DAY, DAY, 0, 0)).toBe(true);
    expect(sameShopOffer(slot, slot, DAY, '2026-10-24', 0, 0)).toBe(false);
    expect(sameShopOffer(slot, slot, DAY, DAY, 0, 1)).toBe(false);
    expect(sameShopOffer(slot, { ...slot, itemId: 'different_item' }, DAY, DAY, 0, 0)).toBe(false);
    expect(sameShopOffer(slot, { ...slot, bought: 1 }, DAY, DAY, 0, 0)).toBe(false);
    state.save = late();
    const scene = Object.assign(new ShopScene(), { drawStock: vi.fn() });
    const actions = sceneActions<{ buy(s: ShopSlotView, day: string, refreshes: number): void }>(scene);
    actions.buy(slot, '2026-10-22', 0);
    actions.buy(slot, DAY, 1);
    expect(state.writes).toHaveLength(0);
  });
});
