import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ done: 0, decisions: 0, modal: false, unlockModal: false }));
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/core', () => ({
  finishedExpeditions: () => state.done,
  pendingExpeditionEvents: () => state.decisions,
  towerStatus: () => ({ unlocked: false }),
}));
vi.mock('../src/game/content', () => ({ GAME: {} }));
vi.mock('../src/game/featureTiles', () => ({ expeditionsTile: () => ({}), towerTile: () => ({}) }));
vi.mock('../src/game/huntEntry', () => ({ huntTile: () => ({}) }));
vi.mock('../src/game/autobattlerEntry', () => ({ autobattlerTile: () => ({}) }));
vi.mock('../src/game/hints', () => ({ hintDone: () => true }));
vi.mock('../src/game/juice', () => ({ collect: (_: unknown, fn: () => void) => { fn(); return []; }, staggerIn: () => {} }));
vi.mock('../src/game/layout', () => ({ GAME_W: 1080 }));
vi.mock('../src/game/screen', () => ({ CONTENT_TOP: 170, contentBottom: () => 1730, screen: () => {}, confirmOpen: () => state.modal }));
vi.mock('../src/game/session', () => ({ now: () => 0, restartOnNewDay: () => {}, session: { save: {} } }));
vi.mock('../src/game/ui', () => ({ tutorialHint: () => {}, ScrollArea: class {
  offset = 0;
  content = { setName: () => this.content, add: () => this.content };
  setContentHeight() {} setBounds() {}
} }));
vi.mock('../src/game/viewport', () => ({ onViewChange: () => () => {} }));
vi.mock('../src/game/unlockBanner', () => ({ showUnlockBanners: () => {}, UNLOCK_BANNER_NAME: 'unlock' }));
import { AdventureScene } from '../src/game/scenes/AdventureScene';

function harness() {
  const scene = new AdventureScene();
  const restart = vi.fn();
  let tick = () => {};
  const addEvent = vi.fn((event: { callback: () => void }) => { tick = event.callback; });
  Object.assign(scene, {
    children: { getByName: () => state.unlockModal }, scene: { restart }, time: { addEvent },
  });
  scene.create();
  return { scene, restart, addEvent, tick: () => tick() };
}
beforeEach(() => Object.assign(state, { done: 0, decisions: 0, modal: false, unlockModal: false }));
describe('Adventure expedition status refresh', () => {
  it('uses the existing timer and updates when an expedition decision becomes due', () => {
    const h = harness();
    expect(h.addEvent).toHaveBeenCalledOnce();
    expect(h.addEvent).toHaveBeenCalledWith(expect.objectContaining({ delay: 1000, loop: true }));
    h.tick();
    expect(h.restart).not.toHaveBeenCalled();
    state.decisions = 1;
    h.tick();
    expect(h.restart).toHaveBeenCalledOnce();
    h.scene.create();
    h.restart.mockClear();
    h.tick();
    expect(h.restart).not.toHaveBeenCalled();
  });
  it.each(['modal', 'unlockModal'] as const)('waits for %s to close before refreshing', (key) => {
    const h = harness();
    state[key] = true;
    state.decisions = 1;
    h.tick();
    expect(h.restart).not.toHaveBeenCalled();
    state[key] = false;
    h.tick();
    expect(h.restart).toHaveBeenCalledOnce();
  });
  it('retains the existing return-status refresh', () => {
    const h = harness();
    state.done = 1;
    h.tick();
    expect(h.restart).toHaveBeenCalledOnce();
  });
});
