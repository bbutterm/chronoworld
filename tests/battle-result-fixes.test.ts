/**
 * Пакет «бой и итоги» (аудит 11.10): ряд мощи без ложной зелёной галки (ux 0, ui-core 9), совет поражения при мощи
 * не ниже ориентира, рамка карт-наград Таверны по редкости вещи (ui-heroes 3) и системная «назад» Telegram на сценах
 * без каркаса — Бой, Итоги, «Глава пройдена» (ux 4).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { EventEmitter } = await import('node:events');
  class Container extends EventEmitter {
    parentContainer: Container | null = null;
    data = new Map<string, unknown>();
    constructor(public scene: unknown) { super(); }
    setData(key: string, value: unknown) { this.data.set(key, value); return this; }
    getData(key: string) { return this.data.get(key); }
    destroy() { if (!this.scene) return; this.emit('destroy'); this.scene = undefined; }
  }
  return { default: {
    Scene: class {},
    GameObjects: { Container, Events: { DESTROY: 'destroy' } },
    Scenes: { Events: { SHUTDOWN: 'shutdown' } },
  } };
});

const { EventEmitter } = await import('node:events');
const Phaser = (await import('phaser')).default;
const { POWER_MARGIN, powerMark } = await import('../src/game/powerMark');
const { defeatTip, DEFEAT_POWER_OK } = await import('../src/game/defeatTip');
const { registerModal, sceneBack } = await import('../src/game/screen');
const { setTgAppForTests, tgBack } = await import('../src/game/telegram');
const { lootFrameLook } = await import('../src/game/summonLootCard');

afterEach(() => setTgAppForTests(undefined));

describe('ряд мощи: галка только с запасом и никогда на поражении (ux 0, ui-core 9)', () => {
  it('запас ×1.1 — как вердикт ядра easy', () => expect(POWER_MARGIN).toBe(1.1));
  it('ниже ориентира — нехватка; ×1–1.1 — жёлтая точка; от ×1.1 — галка', () => {
    expect(powerMark(999, 1000)).toBe('short');
    expect(powerMark(1000, 1000)).toBe('even');
    expect(powerMark(1099, 1000)).toBe('even');
    expect(powerMark(1100, 1000)).toBe('ahead');
  });
  it('поражение: при любой мощи не ниже ориентира — только число, нехватка остаётся нехваткой', () => {
    expect(powerMark(4162, 3000, { defeat: true })).toBe('plain');
    expect(powerMark(1000, 1000, { defeat: true })).toBe('plain');
    expect(powerMark(900, 1000, { defeat: true })).toBe('short');
  });
  it('жёсткий порог (экспедиция): галка без запаса', () => {
    expect(powerMark(1000, 1000, { requirement: true })).toBe('ahead');
    expect(powerMark(999, 1000, { requirement: true })).toBe('short');
  });
});

describe('совет поражения при мощи не ниже ориентира', () => {
  const grind = { text: 'Прокачайте героев: заберите сундук и быстрые награды в кампании, затем «Улучшить».', action: 'Campaign' as const };
  it('общий «Прокачайте героев» сменяется угрозой этапа и плиткой «Отряд»', () => {
    const tip = defeatTip(grind, 4162, 3000, { text: 'Сворд-фиш: прыгает к героям в тылу', advice: 'Поставьте в тыл крепкого героя.' });
    expect(tip.action).toBe('Squad');
    expect(tip.text).toBe('Сворд-фиш: прыгает к героям в тылу. Поставьте в тыл крепкого героя.');
  });
  it('без угрозы — совет про расстановку и состав, не про прокачку', () => {
    const tip = defeatTip(grind, 3000, 3000, null);
    expect(tip.action).toBe('Squad');
    expect(tip.text).not.toMatch(/Прокачайте/);
  });
  it('при нехватке мощи и при конкретном совете (вещи, уровень) — совет как был', () => {
    expect(defeatTip(grind, 2000, 3000, null)).toBe(grind);
    const gear = { text: 'В сумке есть вещи получше для отряда — «Надеть лучшее» ниже.', action: 'EquipBest' as const };
    expect(defeatTip(gear, 5000, 3000, null)).toBe(gear);
  });
  it('строка под мощью не обещает победу и не пишет «сил хватает» (правило 11)', () => {
    expect(DEFEAT_POWER_OK).not.toMatch(/хватает/);
  });
});

describe('рамка карты-награды Таверны (ui-heroes 3)', () => {
  const rarity = (id: string) => ({ knife: 'common', bow: 'rare', blade: 'epic' } as const)[id as 'knife'];
  it('вещь — цвет своей редкости, как в сумке: обычная нейтральная', () => {
    expect(lootFrameLook({ loot: 'gear', itemId: 'knife' }, rarity)).toBe('none');
    expect(lootFrameLook({ loot: 'gear', itemId: 'bow' }, rarity)).toBe('blue');
    expect(lootFrameLook({ loot: 'gear', itemId: 'blade' }, rarity)).toBe('purple');
  });
  it('золото, опыт, алмазы и руда — нейтральные: зелёный/синий/фиолетовый остаются редкостями героев', () => {
    for (const loot of ['gold', 'heroExp', 'gems', 'ore'] as const) expect(lootFrameLook({ loot }, rarity)).toBe('none');
  });
});

describe('системная «назад» на сценах без каркаса (ux 4)', () => {
  function setup() {
    const handlers = new Set<() => void>();
    setTgAppForTests({ version: '9.0', platform: 'android', BackButton: {
      onClick: (fn) => handlers.add(fn), offClick: (fn) => handlers.delete(fn), show: vi.fn(), hide: vi.fn(),
    } });
    const state = { events: new EventEmitter(), active: true, nodes: [] as InstanceType<typeof Phaser.GameObjects.Container>[] };
    const scene = { events: state.events, sys: { isActive: () => state.active },
      children: { get list() { return state.nodes.filter((n) => n.scene); } } } as unknown as Phaser.Scene;
    return { scene, state, handlers, tap: () => [...handlers].forEach((fn) => fn()) };
  }

  it('Back делает действие игры, открытое окно закрывается первым, после выхода со сцены кнопка снята', () => {
    const h = setup();
    const go = vi.fn();
    sceneBack(h.scene, go);
    expect(tgBack()).not.toBeNull();
    // Окно поверх (сюжет, «Выйти из боя?») — Back закрывает его, а не уходит со сцены.
    const layer = new Phaser.GameObjects.Container(h.scene);
    h.state.nodes.push(layer);
    const close = vi.fn(() => layer.destroy());
    registerModal(layer, close);
    h.tap();
    expect(close).toHaveBeenCalledOnce();
    expect(go).not.toHaveBeenCalled();
    h.tap();
    expect(go).toHaveBeenCalledOnce();
    // Неактивная сцена (переход уже начался) — действие не повторяется.
    h.state.active = false;
    h.tap();
    expect(go).toHaveBeenCalledOnce();
    h.state.events.emit('shutdown');
    expect(tgBack()).toBeNull();
    expect(h.handlers.size).toBe(0);
  });
});
