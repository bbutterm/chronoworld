import { describe, expect, it } from 'vitest';
import { newGame, squadPower, stagePower, type SaveState } from '../src/core';
import { CAMP_EXP, campLevel, campLevelCost, heroesNavBadge, leadHero, POWER_VERDICT, powerCheck, powerTone, recommendedPower } from '../src/game/flow';
import { computeView } from '../src/game/viewLayout';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const fresh = (): SaveState => newGame(ctx, 0);
const stages = ctx.content.stages;

describe('«Почти готово»: мощь отряда против рекомендуемой мощи этапа', () => {
  it('рекомендуемая мощь — мощь врагов этапа, растёт по главе', () => {
    for (const s of stages.slice(0, 3)) expect(recommendedPower(s.id, ctx)).toBe(stagePower(s.id, ctx));
    expect(recommendedPower(stages[9].id, ctx)).toBeGreaterThan(recommendedPower(stages[0].id, ctx));
  });

  it('тон: не слабее — зелёный, до 20% слабее — «чуть не хватает», дальше — красный', () => {
    expect(powerTone(1000, 1000)).toBe('ahead');
    expect(powerTone(850, 1000)).toBe('close');
    expect(powerTone(700, 1000)).toBe('behind');
    expect(POWER_VERDICT.close).toBe('Чуть не хватает');
  });

  it('новичок на этапе 1 сильнее рекомендуемой; на боссе главы 1 — нет', () => {
    const save = fresh();
    const first = powerCheck(save, stages[0].id, ctx);
    expect(first.squad).toBe(squadPower(save, ctx));
    expect(first.tone).toBe('ahead');
    expect(first.verdict).toBe(POWER_VERDICT.ahead);
    const boss = stages.find((s) => s.boss)!;
    expect(powerCheck(save, boss.id, ctx).tone).not.toBe('ahead');
  });
});

describe('Плашка игрока: уровень лагеря из прогресса', () => {
  it('новая игра — 1-й уровень с нулевым опытом', () => {
    const lv = campLevel(fresh());
    expect(lv).toEqual({ level: 1, exp: 0, need: campLevelCost(1), total: 0 });
  });

  it('этапы, этажи башни и уровни героев дают опыт; уровни растут по campLevelCost', () => {
    const save = fresh();
    const cleared = stages.slice(0, 5).map((s) => s.id);
    const heroes = save.heroes.map((h, i) => (i === 0 ? { ...h, level: 11 } : h));
    const s: SaveState = { ...save, heroes, campaign: { ...save.campaign, cleared }, tower: { floor: 3 } };
    const total = 5 * CAMP_EXP.stage + 3 * CAMP_EXP.floor + 10 * CAMP_EXP.heroLevel;
    const lv = campLevel(s);
    expect(lv.total).toBe(total);
    // 720: 200 (1→2) + 300 (2→3) = 500 → 3-й уровень, 220 из 400.
    expect(lv.level).toBe(3);
    expect(lv.exp).toBe(total - campLevelCost(1) - campLevelCost(2));
    expect(lv.need).toBe(campLevelCost(3));
    expect(lv.exp).toBeLessThan(lv.need);
  });

  it('повтор этапа не даёт опыта лагеря дважды', () => {
    const save = fresh();
    const id = stages[0].id;
    expect(campLevel({ ...save, campaign: { ...save.campaign, cleared: [id, id] } }).total).toBe(CAMP_EXP.stage);
  });

  it('аватар — первый герой отряда, без отряда — самый прокачанный', () => {
    const save = fresh();
    const firstInSquad = save.squad.find((id) => id !== null)!;
    expect(leadHero(save)?.id).toBe(firstInSquad);
    const noSquad: SaveState = { ...save, squad: save.squad.map(() => null), heroes: save.heroes.map((h, i) => (i === 2 ? { ...h, level: 9 } : h)) };
    expect(leadHero(noSquad)?.id).toBe(save.heroes[2].id);
  });
});

describe('Значок вкладки «Герои»', () => {
  it('число (вознести / вещь получше) важнее зелёной стрелки «Улучшить»', () => {
    const save = fresh();
    const poor: SaveState = { ...save, resources: { ...save.resources, heroExp: 0, gold: 0 } };
    expect(heroesNavBadge(poor, ctx)).toBeNull();
    const rich: SaveState = { ...save, resources: { ...save.resources, heroExp: 100000, gold: 100000 } };
    expect(heroesNavBadge(rich, ctx)).toEqual({ kind: 'levelUp' });
    const ascend: SaveState = { ...rich, shards: { alan: 20, vika: 5 } };
    expect(heroesNavBadge(ascend, ctx)?.kind).toBe('count');
  });
});

describe('Полоса над шапкой (viewLayout.safeTop)', () => {
  it('9:16 — полосы нет; вытянутый — верх безопасной области над полем, ниже выреза', () => {
    expect(computeView(540, 960, 1).safeTop).toBe(0);
    const tall = computeView(390, 844, 3);
    expect(tall.safeTop).toBe(tall.worldY);
    expect(tall.safeTop).toBeLessThan(-150);
    const notch = computeView(390, 844, 3, { top: 47, right: 0, bottom: 34, left: 0 });
    expect(notch.safeTop).toBeGreaterThan(notch.worldY);
    expect(notch.safeTop).toBeLessThanOrEqual(0);
    // Вырез 47 CSS px ≈ 47 / масштаб единиц мира.
    const s = notch.cssW / notch.worldW;
    expect(notch.safeTop - notch.worldY).toBeCloseTo(47 / s, 3);
  });
});
