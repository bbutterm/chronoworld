import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class Base {}
  return {
    default: {
      Scene: Base,
      GameObjects: { Events: { DESTROY: 'destroy' }, Container: Base, Text: Base, Image: Base },
      Scenes: { Events: { SHUTDOWN: 'shutdown', CREATE: 'create', POST_UPDATE: 'postupdate', PRE_UPDATE: 'preupdate' } },
      BlendModes: { ADD: 1 },
      Display: { Color: { HexStringToColor: () => ({ color: 0 }), IntegerToColor: () => ({ darken: () => ({ color: 0 }) }) } },
      Math: { Clamp: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)) },
      Geom: { Rectangle: Base },
      Input: { Pointer: Base },
      Textures: { FilterMode: { NEAREST: 1 } },
    },
  };
});

const SRC = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', 'game', f), 'utf8');
const FILES = ['scenes/HuntScene.ts', 'huntBattle.ts', 'scenes/ExpeditionsScene.ts', 'expeditionEventModal.ts'];

const { tierPosition, phasePips, huntRewardChips, huntRewardText } = await import('../src/game/scenes/HuntScene');
const { huntHudY } = await import('../src/game/huntBattle');
const { expectedChips, findIcons, returnedChips } = await import('../src/game/scenes/ExpeditionsScene');
const { outcomeChips, choiceTone } = await import('../src/game/expeditionEventModal');
const { formatNumber } = await import('../src/game/flow');

/** Итерация 9B полировки: Охота на MVP и Экспедиции — чипы вместо фраз, одна главная кнопка, без инструкций. */
describe('Охота и Экспедиции: правила экрана (§3)', () => {
  it('без инструкций «Нажмите…» и литералов размеров шрифта в text()', () => {
    for (const f of FILES) {
      const s = SRC(f);
      expect(s, f).not.toMatch(/Нажмите|нажмите|, чтобы /);
      // text(scene, x, y, 'строка', 36, …) — размер только токенами T.* (theme.ts).
      expect(s.match(/text\([^;]*?,\s*['`][^'`]*['`],\s*\d{2,3}\s*,/g) ?? [], f).toEqual([]);
      expect(s, f).not.toMatch(/\bFS\.|\bOUTLINE\b|TITLE_STYLE/);
    }
  });

  it('золотая кнопка: на Охоте — одна «В бой» (cta), в Экспедициях — выбирается одна (pickPrimary)', () => {
    const hunt = SRC('scenes/HuntScene.ts');
    expect(hunt.match(/ui_btn_primary/g) ?? []).toHaveLength(0);
    // cta: «В бой» и «Отлично» в окне итога (окно закрывает экран).
    expect(hunt.match(/\bcta\(this/g) ?? []).toHaveLength(2);
    const exp = SRC('scenes/ExpeditionsScene.ts');
    expect(exp).toMatch(/pickPrimary/);
    expect(exp).not.toMatch(/k:buttonLong/);
  });
});

describe('Охота на MVP: чипы и шкала', () => {
  it('шкала порогов: равные отрезки между порогами', () => {
    const t = [100, 300, 600];
    expect(tierPosition(0, t)).toBe(0);
    expect(tierPosition(50, t)).toBeCloseTo(1 / 6);
    expect(tierPosition(300, t)).toBeCloseTo(2 / 3);
    expect(tierPosition(10_000, t)).toBe(1);
    expect(tierPosition(10, [])).toBe(0);
  });

  it('засечки фаз: доли ОЗ между 0 и 1 по убыванию', () => {
    expect(phasePips([{ atHpPct: 0.3 }, { atHpPct: 0.6 }, {}])).toEqual([0.6, 0.3]);
    expect(phasePips(undefined)).toEqual([]);
    expect(phasePips([{ atHpPct: 1 }, { atHpPct: 0 }])).toEqual([]);
  });

  it('награда порога — чипами: золото, опыт, гемы, одна карта героя, предмет, руда, карта MVP', () => {
    const r = { gold: 22000, jobExp: 31000, gems: 10, heroCards: { blue: 0.07, purple: 0.01 }, item: 'epic' as const };
    const chips = huntRewardChips(r, { ore: true, mvpCard: { id: 'card_x', chance: 0.12 } });
    expect(chips.map((c) => c.value)).toEqual([22000, 31000, 10, '8%', '×1', '1–3', '12%']);
    expect(chips[0].tone).toBe('gold');
    expect(huntRewardChips({ gold: 100 })).toHaveLength(1);
    expect(huntRewardText(r)).toContain('карта героя 8%');
  });

  it('счёт урона в бою — под полоской ОЗ босса и заряда, на любом экране', () => {
    const battle = SRC('scenes/BattleScene.ts');
    const hudY = Number(battle.match(/const HUD_Y = (\d+);/)?.[1]);
    const barDy = Number(battle.match(/const BOSS_BAR_DY = (\d+);/)?.[1]);
    for (const band of [0, 120, 300]) {
      const y = huntHudY(band);
      expect(y.bar).toBe(hudY - band + barDy);
      // Полоса заряда — до bar + 45; число не налезает на неё.
      expect(y.main - 30).toBeGreaterThan(y.bar + 45);
      expect(y.sub).toBeGreaterThan(y.main);
    }
  });
});

describe('Экспедиции: добыча чипами, событие', () => {
  it('ожидаемая добыча: золото и опыт «≈», гемы; прочие находки — значки без чисел', () => {
    const e = { gold: 6240, jobExp: 8736, gems: 0.6, heroCards: 0.5, scrolls: 0, items: 1.2 };
    expect(expectedChips(e).map((c) => c.value)).toEqual([`≈${formatNumber(6240)}`, `≈${formatNumber(8736)}`, '≈1']);
    expect(findIcons(e)).toHaveLength(2);
    expect(expectedChips({ ...e, gems: 0 })).toHaveLength(2);
  });

  it('вернувшиеся: золото, опыт, гемы, карты по редкости, свитки, предметы', () => {
    const chips = returnedChips({ gold: 500, jobExp: 700, gems: 3, heroCards: { blue: 2, purple: 1 }, scrolls: 1, items: [] });
    expect(chips.map((c) => c.value)).toEqual(['+500', '+700', '+3', '×1', '×2', '×1']);
  });

  it('исход события: знак у золота и опыта, потеря — красным; тон шанса варианта', () => {
    const chips = outcomeChips({ gold: -18, jobExp: 24, gems: 0 });
    expect(chips.map((c) => c.value)).toEqual(['−18', '+24']);
    expect(chips[0].tone).toBe('negative');
    expect(choiceTone({ hero: { id: 'a', name: 'Кай' } as never, missing: false })).toBe('positive');
    expect(choiceTone({ hero: null, missing: true })).toBe('warning');
    expect(choiceTone({ hero: null, missing: false })).toBe('neutral');
  });
});
