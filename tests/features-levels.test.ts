import { describe, expect, it } from 'vitest';
import {
  baselineHero,
  heroPower,
  enemyLevels,
  enemySquad,
  levelBand,
  levelForHpAtk,
  levelTone,
  lintLevelBands,
  MAX_ENEMY_LEVEL,
  newGame,
  progressLevelBand,
  rarityIndex,
  recommendedHeroLevel,
  recommendedFactor,
  recommendedPower,
  squadAverageLevel,
  stageLevels,
  supportFactor,
  towerFloor,
  unitLevel,
  type FeatureContext,
  type UnitDef,
} from '../src/core';
import { loadFullContext, referenceLevel } from '../scripts/lib/player-model';
import { enemyLevelColor, LEVEL_COLORS, levelLabel, recommendText, squadRarity, stageLevelsFor } from '../src/game/flow';

const CTX = loadFullContext();
const STAGES = CTX.content.stages;
const withLevels = (levels: FeatureContext['features']['power']['levels']): FeatureContext => ({
  ...CTX,
  features: { ...CTX.features, power: { ...CTX.features.power, levels } },
});

describe('уровни врагов и рекомендуемый уровень героев (features/levels.ts)', () => {
  it('медианный герой растёт с уровнем и редкостью', () => {
    for (const r of ['green', 'blue', 'purple', 'gold', 'red'] as const) {
      for (let L = 1; L < 60; L += 7) {
        expect(baselineHero(L + 1, r, CTX).hpAtk).toBeGreaterThan(baselineHero(L, r, CTX).hpAtk);
        expect(baselineHero(L + 1, r, CTX).power).toBeGreaterThanOrEqual(baselineHero(L, r, CTX).power);
      }
    }
    expect(baselineHero(20, 'blue', CTX).hpAtk).toBeGreaterThan(baselineHero(20, 'green', CTX).hpAtk);
    expect(baselineHero(20, 'purple', CTX).power).toBeGreaterThan(baselineHero(20, 'blue', CTX).power);
  });

  it('levelForHpAtk обращает медианного героя; слабее ур. 1 — 1, сильнее потолка — MAX_ENEMY_LEVEL', () => {
    for (const L of [1, 2, 5, 13, 27, 40, 77]) expect(levelForHpAtk(baselineHero(L, 'blue', CTX).hpAtk, 'blue', CTX)).toBe(L);
    expect(levelForHpAtk(1, 'green', CTX)).toBe(1);
    expect(levelForHpAtk(0, 'green', CTX)).toBe(1);
    expect(levelForHpAtk(1e15, 'green', CTX)).toBe(MAX_ENEMY_LEVEL);
  });

  it('уровень врага: hp·atk / enemyScale, босс — ещё / bossScale и × поправка²', () => {
    const lv = CTX.features.power.levels!;
    const hero = baselineHero(20, 'blue', CTX).hpAtk;
    const mob: UnitDef = { ...CTX.content.units[Object.keys(CTX.content.units)[0]], kind: 'monster', stats: { hp: Math.round(hero * lv.enemyScale / 100), atk: 100, def: 10, spd: 100 } };
    expect(unitLevel(mob, 'blue', CTX)).toBe(20);
    const boss: UnitDef = { ...mob, kind: 'boss', stats: { ...mob.stats, hp: mob.stats.hp * (lv.bossScale ?? 1) } };
    expect(unitLevel(boss, 'blue', CTX)).toBe(20);
    expect(unitLevel(boss, 'blue', CTX, 1.3)).toBeGreaterThan(20);
    // Поправка этапа рядовых врагов не касается.
    expect(unitLevel(mob, 'blue', CTX, 1.3)).toBe(20);
    // Та же сила — у более редких героев уровень ниже.
    expect(unitLevel(mob, 'purple', CTX)).toBeLessThan(20);
  });

  it('полосы data/progression.json корректны; levelBand и progressLevelBand', () => {
    expect(lintLevelBands(CTX)).toEqual([]);
    const bands = CTX.features.power.levels!.bands;
    expect(levelBand(STAGES[0].id, CTX)).toEqual(bands[0]);
    expect(levelBand(STAGES[STAGES.length - 1].id, CTX)).toEqual(bands[bands.length - 1]);
    for (let i = 1; i < STAGES.length; i++) expect(rarityIndex(levelBand(STAGES[i].id, CTX).rarity)).toBeGreaterThanOrEqual(rarityIndex(levelBand(STAGES[i - 1].id, CTX).rarity));
    const save = newGame(CTX, 0);
    expect(progressLevelBand(save, CTX)).toEqual(bands[0]);
    expect(progressLevelBand({ campaign: { ...save.campaign, cleared: STAGES.map((s) => s.id) } }, CTX)).toEqual(bands[bands.length - 1]);
    expect(lintLevelBands(withLevels({ enemyScale: 1, bands: [{ fromStage: 'nope', rarity: 'green', squad: 5 }] }))).toHaveLength(1);
    expect(lintLevelBands(withLevels({ enemyScale: 1, bands: [{ fromStage: STAGES[3].id, rarity: 'green', squad: 5 }] }))[0]).toMatch(/первого этапа/);
  });

  it('рекомендуемый уровень согласован с рекомендуемой мощью без доли экипировки: squad героев ур. L набирают её, ур. L − 1 — нет', () => {
    for (const s of STAGES) {
      const rec = recommendedHeroLevel(s.id, CTX);
      const band = levelBand(s.id, CTX);
      const power = recommendedPower(s.id, CTX) * (1 - (band.gear ?? 0));
      expect(rarityIndex(rec.rarity)).toBeGreaterThanOrEqual(rarityIndex(band.rarity));
      expect(rec.squad).toBe(band.squad);
      expect(rec.level).toBeLessThanOrEqual(CTX.cards.rarities[rarityIndex(rec.rarity)].maxLevel);
      expect(rec.squad * baselineHero(rec.level, rec.rarity, CTX).power).toBeGreaterThanOrEqual(power);
      if (rec.level > 1) expect(rec.squad * baselineHero(rec.level - 1, rec.rarity, CTX).power).toBeLessThan(power);
    }
  });

  it('уровень выше предела редкости полосы — рекомендуется следующая редкость', () => {
    const ctx = withLevels({ enemyScale: 1, bands: [{ fromStage: STAGES[0].id, rarity: 'green', squad: 1 }] });
    const last = STAGES[STAGES.length - 1].id;
    const rec = recommendedHeroLevel(last, ctx);
    expect(rarityIndex(rec.rarity)).toBeGreaterThan(rarityIndex('green'));
  });

  it('stageLevels: уровни по слотам enemySquad, босс — на босс-этапах, типичный — медиана без босса', () => {
    for (const s of STAGES) {
      const l = stageLevels(s.id, CTX);
      const units = enemySquad(s.id, CTX);
      expect(l.enemies).toHaveLength(units.length);
      units.forEach((u, i) => (u ? expect(l.enemies[i]).toBeGreaterThanOrEqual(1) : expect(l.enemies[i]).toBeNull()));
      expect(l.boss !== undefined).toBe(units.some((u) => u?.kind === 'boss'));
      expect(l.typical).toBeGreaterThanOrEqual(1);
      expect(l.rarity).toBe(levelBand(s.id, CTX).rarity);
    }
  });

  it('LT-03: враги этапа не ниже ¾ рекомендуемого уровня, босс не ниже свиты, поддержка (лекарь, щиты союзникам) — выше своих hp·atk', () => {
    const share = CTX.features.power.levels!.stageFloor!;
    expect(share).toBeGreaterThan(0);
    for (const s of STAGES) {
      const l = stageLevels(s.id, CTX);
      const units = enemySquad(s.id, CTX);
      const rec = l.recommended.rarity === l.rarity ? l.recommended.level : null;
      units.forEach((u, i) => {
        if (!u) return;
        if (rec !== null) expect(l.enemies[i]!, `${s.id}: ${u.name}`).toBeGreaterThanOrEqual(Math.round(rec * share));
        // Экран боя считает уровень по одному юниту — число то же, что на подготовке.
        expect(unitLevel(u, l.rarity, CTX, recommendedFactor(s.id, CTX)), `${s.id}: ${u.name}`).toBe(l.enemies[i]);
      });
      if (l.boss !== undefined) for (const x of l.enemies) if (x !== null) expect(l.boss, s.id).toBeGreaterThanOrEqual(x);
    }
    // Изида (лекарь) и Песчаник (щит фронту) — поддержка; Мардук (маг) — нет; босс — всегда 1.
    expect(supportFactor(CTX.content.units.mob4_support, CTX)).toBeGreaterThan(1);
    expect(supportFactor(CTX.content.units.mob4_tank, CTX)).toBeGreaterThan(1);
    expect(supportFactor(CTX.content.units.mob4_ranged, CTX)).toBe(1);
    expect(supportFactor(CTX.content.units.mob4_boss, CTX)).toBe(1);
    // Вне кампании (башня, тестовый юнит) границы этапа нет.
    const lone: UnitDef = { ...CTX.content.units.mob4_support, id: 'lone' };
    expect(unitLevel(lone, 'purple', CTX)).toBe(unitLevel({ ...lone, id: 'lone_x' }, 'purple', CTX));
  });

  it('башня: уровни этажей растут с этажом; босс-этажи — с уровнем босса', () => {
    const lv = (n: number) => enemyLevels(towerFloor(n, CTX).enemies, 'blue', CTX);
    expect(lv(40).typical).toBeGreaterThanOrEqual(lv(10).typical);
    expect(lv(60).typical).toBeGreaterThan(lv(30).typical);
  });

  it('калибровка: босс-этапы глав — рекомендуемый уровень и уровень босса в пределах ±5 от «уровня по бою» эталонных отрядов', () => {
    // docs/content/balance.md, 4а. Перемерять: npm run balance -- --levels. Эталонные отряды «по бою» — без экипировки, поэтому
    // рекомендация сравнивается без поправки полосы на экипировку (band.gear: на экране уровень ниже на её долю мощи).
    const lv = CTX.features.power.levels!;
    const noGear = withLevels({ ...lv, bands: lv.bands.map((b) => ({ ...b, gear: 0 })) });
    for (const s of STAGES.filter((x) => x.boss && x.globalIndex > 10)) {
      const battle = referenceLevel(s.id, CTX, 8);
      const l = stageLevels(s.id, CTX);
      const rec = recommendedHeroLevel(s.id, noGear);
      expect(Math.abs(rec.level - battle), `${s.id}: рекомендуем без вещей ${rec.level}, по бою ${battle}`).toBeLessThanOrEqual(5);
      expect(Math.abs(l.boss! - battle), `${s.id}: босс ${l.boss}, по бою ${battle}`).toBeLessThanOrEqual(5);
    }
    // Время, а не порог: с главой 9 босс-этапов стало на один больше (бои эталонных отрядов) — 5 с по умолчанию впритык.
  }, 20_000);

  it('средний уровень отряда и цвет уровня врага', () => {
    const save = newGame(CTX, 0);
    const inSquad = save.squad.flatMap((id) => save.heroes.filter((h) => h.id === id));
    expect(squadAverageLevel(save)).toBe(Math.round(inSquad.reduce((a, h) => a + h.level, 0) / inSquad.length));
    expect(squadAverageLevel({ squad: [null, null], heroes: [] })).toBe(0);
    expect(levelTone(26, 20)).toBe('red');
    expect(levelTone(25, 20)).toBe('yellow');
    expect(levelTone(21, 20)).toBe('yellow');
    expect(levelTone(20, 20)).toBe('white');
    expect(levelTone(3, 20)).toBe('white');
  });

  it('без power.levels — зелёные, отряд 5, масштаб 1 (уровни всё равно считаются)', () => {
    const ctx = withLevels(undefined);
    expect(levelBand(STAGES[5].id, ctx)).toMatchObject({ rarity: 'green', squad: 5 });
    expect(stageLevels(STAGES[5].id, ctx).recommended.level).toBeGreaterThanOrEqual(1);
    expect(lintLevelBands(ctx)).toEqual([]);
  });
});

describe('уровни врагов на экранах (flow.ts)', () => {
  it('подписи и цвет: «ур. N», «Синие герои ур. N», цвет против среднего уровня отряда', () => {
    expect(levelLabel(18)).toBe('ур. 18');
    expect(recommendText({ level: 18, rarity: 'blue' })).toBe('Синие герои ур. 18');
    expect(recommendText({ level: 22, rarity: 'purple' })).toBe('Фиолетовые герои ур. 22');
    const save = newGame(CTX, 0);
    const avg = squadAverageLevel(save);
    expect(enemyLevelColor(avg, save)).toBe(LEVEL_COLORS.white);
    expect(enemyLevelColor(avg + 1, save)).toBe(LEVEL_COLORS.yellow);
    expect(enemyLevelColor(avg + 6, save)).toBe(LEVEL_COLORS.red);
    expect(new Set(Object.values(LEVEL_COLORS)).size).toBe(3);
  });
});

describe('RN-11: уровни врагов в единицах редкости отряда', () => {
  it('зелёный отряд на синей полосе видит врагов выше, чем «синие» уровни (сравнимо со своими)', () => {
    const ctx = loadFullContext();
    const stage = ctx.content.stages.find((s) => s.chapter === ctx.content.chapters[1].id)!;
    const heroes = ['alan', 'bran', 'vika'].map((t, i) => ({ id: `h${i + 1}`, templateId: t, rarity: 'green' as const, level: 6 }));
    const save = { heroes, squad: ['h1', 'h2', 'h3', null, null] };
    expect(squadRarity(save)).toBe('green');
    const mine = stageLevelsFor(save, stage.id, ctx);
    const band = stageLevelsFor({ heroes: [], squad: [null, null, null, null, null] }, stage.id, ctx);
    expect(band.rarity).toBe('blue');
    expect(mine.rarity).toBe('green');
    expect(mine.typical).toBeGreaterThan(band.typical);
    expect(squadRarity({ heroes: [...heroes, { id: 'h4', templateId: 'greta', rarity: 'blue', level: 1 }], squad: ['h1', 'h4', null, null, null] })).toBe('green');
  });

  it('RR-16: одна шкала — «Героям нужен ур. N» по своему отряду, «Сил хватает» ⇔ отряд не ниже N, типичный враг = N', () => {
    const ctx = loadFullContext();
    const id = 'ch3_s9';
    const mk = (level: number) => {
      const heroes = ['alan', 'bran', 'vika', 'dorn', 'zara'].map((t, i) => ({ id: `h${i + 1}`, templateId: t, rarity: 'blue' as const, level }));
      return { heroes, squad: heroes.map((h) => h.id) };
    };
    const lv = stageLevelsFor(mk(1), id, ctx);
    const n = lv.recommended.level;
    expect(lv.recommended).toMatchObject({ own: true, rarity: 'blue' });
    expect(recommendText(lv.recommended)).toBe(`Героям нужен ур. ${n}`);
    expect(lv.typical).toBe(n);
    // Та же граница, что у мощи: на ур. N отряд набирает рекомендуемую мощь, на ур. N − 1 — нет.
    const power = (level: number) => mk(level).heroes.reduce((s, h) => s + heroPower(h, ctx), 0);
    expect(power(n)).toBeGreaterThanOrEqual(recommendedPower(id, ctx));
    expect(power(n - 1)).toBeLessThan(recommendedPower(id, ctx));
    // Отряд на пределе редкости и всё равно слабее — рекомендация «копии и вознесение», враги без сдвига.
    const weak = { heroes: [{ id: 'h1', templateId: 'alan', rarity: 'green' as const, level: 20 }], squad: ['h1', null, null, null, null] };
    const capped = stageLevelsFor(weak, 'ch4_s1', ctx);
    expect(capped.recommended.capped).toBe(true);
    expect(recommendText(capped.recommended)).toMatch(/копии/);
    expect(capped.shift).toBe(0);
  });
});
