// Мощь на экранах с блюдом дня (docs/design/kitchen.md): «Мощь» этапа и карты кампании, Башни считается с той же
// прибавкой, что получает отряд в бою (squadUnits / towerRunSquad с днём). Без дня — без блюда (общая мощь, Арена).
import { describe, expect, it } from 'vitest';
import {
  heroPower,
  newGame,
  recommendedPower,
  squadPower,
  squadUnits,
  stagePowerCheck,
  startTowerRun,
  towerRunSquad,
  unitPower,
  withGear,
  type SaveState,
  type UnitDef,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { powerCheck, stageLevelsFor, stageNeeds } from '../src/game/flow';

const ctx = loadFullContext();
const D1 = '2026-10-10';
const D2 = '2026-10-11';
const STAGE = 'ch1_s5';

/** Новый игрок; блюдо meal приготовлено в день D1. */
function fed(meal: string): SaveState {
  const s = newGame(ctx, 777, D1);
  return { ...s, kitchen: { pantry: {}, meal: { id: meal, day: D1 } } };
}

/** Мощь отряда, который выходит в бой (те же веса, что у squadPower). */
const battlePower = (units: readonly (UnitDef | null)[]) => units.reduce((n, u) => n + (u ? unitPower(u, ctx) : 0), 0);

describe('Кухня: мощь отряда с блюдом дня', () => {
  it('squadPower с днём блюда — столько же, сколько у отряда в бою кампании', () => {
    const s = fed('feast');
    const plain = squadPower(s, ctx);
    const today = squadPower(s, ctx, D1);
    expect(today).toBeGreaterThan(plain);
    // Отряд боя: squadUnits с днём (у нового отряда связок близости нет — только блюдо).
    expect(today).toBe(battlePower(squadUnits(s, withGear(ctx, s), D1).squad));
    expect(plain).toBe(battlePower(squadUnits(s, withGear(ctx, s)).squad));
    // Сумма мощи героев с тем же днём.
    const heroes = s.squad.map((id) => s.heroes.find((h) => h.id === id)).filter((h) => !!h);
    expect(heroes.reduce((n, h) => n + heroPower(h, ctx, s, D1), 0)).toBe(today);
  });

  it('другой день, без дня и блюдо только на опыт — без прибавки', () => {
    const s = fed('feast');
    const plain = squadPower(s, ctx);
    expect(squadPower(s, ctx, D2)).toBe(plain);
    expect(squadPower(fed('milk_porridge'), ctx, D1)).toBe(plain);
    expect(squadPower({ ...s, kitchen: undefined }, ctx, D1)).toBe(plain);
    const hero = s.heroes[0];
    expect(heroPower(hero, ctx, s)).toBe(heroPower(hero, ctx, s, D2));
    expect(heroPower(hero, ctx, s, D1)).toBeGreaterThan(heroPower(hero, ctx, s));
  });

  it('этап и карта кампании: своя мощь с блюдом, нужная мощь и уровни — те же', () => {
    const s = fed('roast_meat');
    const before = stageNeeds(s, STAGE, ctx);
    const after = stageNeeds(s, STAGE, ctx, D1);
    expect(after.own).toBe(squadPower(s, ctx, D1));
    expect(after.own).toBeGreaterThan(before.own);
    expect(after.power).toBe(before.power);
    expect(after.power).toBe(recommendedPower(STAGE, ctx, s.campaignChoices));
    // Уровни — та же шкала, что у подписей врагов в бою (stageLevelsFor без блюда).
    expect(after.enemyLevel).toBe(before.enemyLevel);
    expect(after.enemyLevel).toBe(stageLevelsFor(s, STAGE, ctx).typical);
    expect(powerCheck(s, STAGE, ctx, D1).squad).toBe(after.own);
    expect(powerCheck(s, STAGE, ctx).squad).toBe(before.own);
    expect(stagePowerCheck(s, STAGE, ctx, D1).squad).toBe(after.own);
    expect(stagePowerCheck(s, STAGE, ctx, D2).squad).toBe(before.own);
  });

  it('Башня: мощь отряда с днём — как у отряда забега в бою', () => {
    const s = { ...fed('roast_meat'), campaign: { cleared: ctx.content.stages.filter((st) => st.chapter === 'chapter1').map((st) => st.id) } };
    const run = startTowerRun(s, s.squad, ctx);
    expect(squadPower(run, ctx, D1)).toBe(battlePower(towerRunSquad(run, ctx, D1).squad));
    expect(squadPower(run, ctx, D1)).toBeGreaterThan(squadPower(run, ctx));
  });
});
