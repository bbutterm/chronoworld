/**
 * Карточки героев (docs/design/heroes.md, H1–H3): шаблоны data/heroes, статы и навыки по уровню и редкости, формы
 * сюжетных (вторая профессия на фиолетовом), «Сила навыков», уровень из общего пула, проверки контента.
 */
import { describe, expect, it } from 'vitest';
import {
  activeForm,
  autoLevel,
  buildContent,
  buildUnit,
  CARD_RARITIES,
  cardStats,
  ContentError,
  heroCard,
  HeroError,
  heroSkills,
  levelRangeCost,
  levelUpCost,
  levelUpHero,
  levelUpInfo,
  maxLevelOf,
  newGame,
  newHeroId,
  rarityForLevel,
  simulateBattle,
  validateHeroes,
  type SaveState,
} from '../src/core';
import { loadFullContext, readJsonDir } from '../scripts/lib/content-node';
import { cardHero } from './helpers';

const ctx = loadFullContext();
const T = ctx.content.heroes;

describe('контент карточек', () => {
  it('25 карточек: 5 сюжетных + 7 призывных первых профессий (12 первых) + 13 фиолетовых вторых; все классы кроме Новичка', () => {
    const all = Object.values(T);
    expect(all).toHaveLength(25);
    const story = all.filter((t) => t.source === 'story');
    expect(story.map((t) => t.id).sort()).toEqual(['alan', 'bran', 'dorn', 'greta', 'vika']);
    expect(story.every((t) => t.baseRarity === 'green' && t.maxRarity === 'red' && t.forms.length === 1 && t.forms[0].rarity === 'purple')).toBe(true);
    const first = all.filter((t) => ctx.content.jobs[t.job].tier === 1);
    expect(first).toHaveLength(12);
    const summonFirst = first.filter((t) => t.source === 'summon');
    expect(summonFirst.map((t) => t.id).sort()).toEqual(['iris', 'kai', 'lira', 'meilin', 'otto', 'teo', 'zara']);
    expect(summonFirst.every((t) => t.baseRarity === 'green' && t.maxRarity === 'gold')).toBe(true);
    const purple = all.filter((t) => t.baseRarity === 'purple');
    expect(purple).toHaveLength(13);
    expect(purple.every((t) => t.source === 'summon' && ctx.content.jobs[t.job].tier === 2 && t.maxRarity === 'red')).toBe(true);
    const classes = new Set([...all.map((t) => t.job), ...all.flatMap((t) => t.forms.map((f) => f.job))]);
    expect(classes.size).toBe(Object.values(ctx.content.jobs).filter((j) => j.tier > 0).length);
  });

  it('сюжетные классы фиксированы: Алан — Мечник → Рыцарь, Бран — Лучник → Охотник, Вика — Аколит → Жрица, Грета — Торговка → Кузнец, Дорн — Вор → Разбойник', () => {
    const pairs = ['alan', 'bran', 'vika', 'greta', 'dorn'].map((id) => [T[id].job, T[id].forms[0].job]);
    expect(pairs).toEqual([
      ['swordman', 'knight'],
      ['archer', 'hunter'],
      ['acolyte', 'priest'],
      ['merchant', 'blacksmith'],
      ['thief', 'rogue'],
    ]);
    // Навыки 1/10 сюжетной тройки = прежние навыки профессий на этих уровнях (баланс главы 1 не сдвигается).
    expect(T.alan.skills.slice(0, 2)).toEqual([
      { level: 1, skill: 'swordman_bash' },
      { level: 10, skill: 'swordman_endure' },
    ]);
    expect(T.vika.skills.slice(0, 3).map((s) => s.level)).toEqual([1, 5, 10]);
  });

  it('правило различия: у карточек одного класса ≤ 2 общих навыков и разный фирменный — без предупреждений', () => {
    const warnings: string[] = [];
    validateHeroes(ctx.content, [], warnings);
    expect(warnings).toEqual([]);
  });

  it('валидатор ловит плохие шаблоны (✗) и предупреждает о различии (⚠)', () => {
    const raw = (patch: Record<string, unknown>) => ({ ...structuredClone(T.iris), id: 'bad', name: 'Плохой', ...patch });
    const problems = (data: unknown) => {
      try {
        buildContent({
          units: readJsonDir('data/units'),
          skills: readJsonDir('data/skills'),
          jobs: readJsonDir('data/jobs'),
          heroes: [...readJsonDir('data/heroes'), { file: 'data/heroes/bad.json', data }],
        });
        return [];
      } catch (e) {
        expect(e).toBeInstanceOf(ContentError);
        return (e as ContentError).problems;
      }
    };
    expect(problems(raw({}))).toEqual([]);
    expect(problems(raw({ job: 'nope' })).join()).toMatch(/класс nope не найден/);
    expect(problems(raw({ line: 'mage' })).join()).toMatch(/line mage/);
    expect(problems(raw({ baseRarity: 'purple' })).join()).toMatch(/первая профессия из призыва — baseRarity green или blue/);
    expect(problems(raw({ maxRarity: 'red' })).join()).toMatch(/максимум до gold/);
    expect(problems(raw({ maxRarity: 'green', baseRarity: 'blue' })).join()).toMatch(/maxRarity green ниже baseRarity blue/);
    expect(problems(raw({ skills: [{ level: 1, skill: 'nope' }, { level: 10, skill: 'swordman_bash' }] })).join()).toMatch(/навык nope не найден/);
    expect(problems(raw({ skills: [{ level: 10, skill: 'swordman_bash' }, { level: 5, skill: 'job_swordman_magnum_break' }] })).join()).toMatch(/строго возрастать/);
    expect(problems(raw({ skills: [{ level: 1, skill: 'swordman_bash' }, { level: 90, skill: 'job_swordman_magnum_break' }] })).join()).toMatch(/предел gold — 80/);
    expect(problems(raw({ name: 'Алан' })).join()).toMatch(/имя «Алан» уже у карточки/);
    expect(problems(raw({ bio: 'x'.repeat(161) })).join()).toMatch(/bio/);
    expect(problems(raw({ source: 'story', forms: [{ rarity: 'purple', job: 'wizard', statMods: {}, skills: [{ level: 1, skill: 'swordman_bash' }, { level: 10, skill: 'swordman_endure' }] }] })).join()).toMatch(
      /сюжетная карточка начинается с green.*|не из линии swordman/,
    );
    // ⚠: копия Ирис под другим id — три общих навыка и тот же фирменный.
    const warnings: string[] = [];
    validateHeroes({ ...ctx.content, heroes: { ...T, bad: { ...T.iris, id: 'bad', name: 'Плохой' } } }, [], warnings);
    expect(warnings.join()).toMatch(/общих навыков 4 > 2/);
    expect(warnings.join()).toMatch(/одинаковый фирменный навык/);
  });
});

describe('статы, навыки, формы, сила навыков', () => {
  it('редкость умножает статы (statMult), предел уровня — по редкости', () => {
    const lv = 20;
    const hp = CARD_RARITIES.map((r) => cardStats(T.iris, lv, r, ctx).hp);
    for (let i = 1; i < hp.length; i++) expect(hp[i]).toBeGreaterThan(hp[i - 1]);
    expect(CARD_RARITIES.map((r) => maxLevelOf(ctx, r))).toEqual([20, 40, 60, 80, 100]);
    expect(rarityForLevel(ctx, 20)).toBe('green');
    expect(rarityForLevel(ctx, 21)).toBe('blue');
    expect(rarityForLevel(ctx, 5, 'purple')).toBe('purple');
  });

  it('форма сюжетного: на фиолетовом Алан — Рыцарь со своими навыками и статами', () => {
    expect(activeForm(T.alan, 'blue').job).toBe('swordman');
    expect(activeForm(T.alan, 'purple').job).toBe('knight');
    expect(activeForm(T.alan, 'red').job).toBe('knight');
    const blue = cardHero(ctx, 'alan', 40, { rarity: 'blue' });
    const purple = { ...blue, rarity: 'purple' as const };
    expect(heroSkills(purple, ctx)).toEqual({ basic: ctx.content.jobs.knight.basic, actives: ['job_swordman_provoke'], passives: ['swordman_endure', 'job_knight_auto_counter'] });
    expect(buildUnit(purple, ctx).stats.hp).toBeGreaterThan(buildUnit(blue, ctx).stats.hp);
    expect(heroCard(blue, ctx)).toMatchObject({ job: 'swordman', jobName: 'Мечник', nextForm: { rarity: 'purple', job: 'knight', jobName: 'Рыцарь' } });
    expect(heroCard(purple, ctx).nextForm).toBeUndefined();
  });

  it('«Сила навыков» на золотом и красном: skillPower юнита, урон навыка растёт, обычная атака — нет', () => {
    const gold = cardHero(ctx, 'seyren', 60, { rarity: 'gold' });
    expect(buildUnit(cardHero(ctx, 'seyren', 60), ctx).skillPower).toBeUndefined();
    expect(buildUnit(gold, ctx).skillPower).toBe(ctx.cards.rarities[3].skillPower);
    expect(buildUnit({ ...gold, rarity: 'red' }, ctx).skillPower).toBe(ctx.cards.rarities[4].skillPower);
    // Тот же юнит с skillPower 1 и 1.3: урон навыков выше, обычных атак — одинаковый.
    const u = buildUnit(gold, ctx);
    const a = { ...u, skillPower: 1 };
    const b = { ...u, skillPower: 1.3 };
    const enemy = ['mob_boss1', null, null, null, null];
    const dmg = (unit: typeof u) => {
      const r = simulateBattle(ctx.content, [unit, null, null, null, null], enemy, 5, { combat: ctx.combat });
      const bySkill: Record<string, number> = {};
      for (const e of r.log) if (e.type === 'attack' && e.unit === 'A0') bySkill[e.skill] = (bySkill[e.skill] ?? 0) + 1;
      return { r, bySkill };
    };
    const ra = dmg(a).r;
    const rb = dmg(b).r;
    const firstSkillHit = (r: typeof ra) => {
      const i = r.log.findIndex((e) => e.type === 'attack' && e.unit === 'A0' && e.skill !== u.skills.basic);
      return r.log.slice(i).find((e) => e.type === 'damage' && e.source === 'A0');
    };
    const ha = firstSkillHit(ra);
    const hb = firstSkillHit(rb);
    expect(ha && hb && ha.type === 'damage' && hb.type === 'damage' && hb.amount > ha.amount).toBe(true);
  });
});

describe('уровень: общий пул опыта + золото («Улучшить»)', () => {
  const rich = (exp: number, gold: number): SaveState => {
    const s = newGame(ctx, 0);
    return { ...s, resources: { gold, heroExp: exp } };
  };

  it('стоимость уровня — data/cards.json → level', () => {
    // Формула — floor(base × L^power) из data/cards.json → level (числа — заглушки баланса, docs/content/balance.md).
    const c = ctx.cards.level;
    expect(levelUpCost(1, ctx)).toEqual({ exp: c.exp.base, gold: c.gold.base });
    expect(levelUpCost(4, ctx)).toEqual({ exp: Math.floor(c.exp.base * Math.pow(4, c.exp.power)), gold: Math.floor(c.gold.base * Math.pow(4, c.gold.power)) });
    const r = levelRangeCost(1, 4, ctx);
    expect(r.exp).toBe(levelUpCost(1, ctx).exp + levelUpCost(2, ctx).exp + levelUpCost(3, ctx).exp);
    expect(levelRangeCost(5, 5, ctx)).toEqual({ exp: 0, gold: 0 });
  });

  it('списание опыта и золота, события уровней и навыков, исходный save не меняется', () => {
    const s = rich(1_000_000, 1_000_000);
    const copy = structuredClone(s);
    const r = levelUpHero(s, 'h1', ctx, 9);
    expect(s).toEqual(copy);
    expect(r.levels).toBe(9);
    expect(r.save.heroes[0].level).toBe(10);
    expect(r.spent).toEqual(levelRangeCost(1, 10, ctx));
    expect(r.save.resources).toEqual({ gold: 1_000_000 - r.spent.gold, heroExp: 1_000_000 - r.spent.exp });
    expect(r.events.filter((e) => e.type === 'levelUp').map((e) => (e.type === 'levelUp' ? e.level : 0))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.events).toContainEqual({ type: 'skillUnlocked', heroId: 'h1', skill: 'swordman_endure', level: 10 });
  });

  it('упор в предел редкости: ×N останавливается на пределе, дальше — max_level (нужно вознесение)', () => {
    const s = rich(10_000_000, 10_000_000);
    const r = levelUpHero(s, 'h1', ctx, 100);
    expect(r.save.heroes[0].level).toBe(20);
    expect(levelUpInfo(r.save, 'h1', ctx)).toMatchObject({ level: 20, maxLevel: 20, cost: null, canLevel: false, blocker: 'max_level', affordable: 0 });
    expect(() => levelUpHero(r.save, 'h1', ctx)).toThrow(HeroError);
  });

  it('не хватает опыта или золота — ошибка без изменений; affordable считает, сколько уровней по карману', () => {
    expect(levelUpInfo(rich(99, 1000), 'h1', ctx)).toMatchObject({ canLevel: false, blocker: 'not_enough_exp', affordable: 0 });
    expect(levelUpInfo(rich(1000, levelUpCost(1, ctx).gold - 1), 'h1', ctx)).toMatchObject({ canLevel: false, blocker: 'not_enough_gold' });
    const two = levelUpCost(1, ctx).exp + levelUpCost(2, ctx).exp;
    expect(levelUpInfo(rich(two, 1000), 'h1', ctx).affordable).toBe(2);
    for (const [exp, gold, code] of [
      [0, 1000, 'not_enough_exp'],
      [1000, 0, 'not_enough_gold'],
    ] as const) {
      try {
        levelUpHero(rich(exp, gold), 'h1', ctx);
        throw new Error('ожидалась ошибка');
      } catch (e) {
        expect(e).toBeInstanceOf(HeroError);
        expect((e as HeroError).code).toBe(code);
      }
    }
    expect(() => levelUpHero(rich(1000, 1000), 'ghost', ctx)).toThrow(/не найден/);
  });

  it('autoLevel: по уровню самому низкому герою отряда, пока хватает', () => {
    const s = rich(3000, 1000);
    const r = autoLevel(s, ctx);
    const levels = r.save.heroes.map((h) => h.level);
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(1);
    expect(r.levels).toBe(levels.reduce((a, l) => a + l - 1, 0));
    expect(levelUpInfo(r.save, r.save.heroes.find((h) => h.level === Math.min(...levels))!.id, ctx).canLevel).toBe(false);
    expect(autoLevel(rich(0, 0), ctx).levels).toBe(0);
  });

  it('newHeroId: наибольший номер + 1', () => {
    expect(newHeroId([{ id: 'h1' }, { id: 'h7' }, { id: 'x' }])).toBe('h8');
    expect(newHeroId([])).toBe('h1');
  });
});
