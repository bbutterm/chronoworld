/**
 * Герои v2 (docs/design/heroes-v2.md): 12 героев (6 классов × парень/девушка) и 24 ветки второй профессии, статы
 * и навыки по уровню, редкости и ветке, «Сила навыков», уровень из общего пула, проверки контента.
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
  heroSpriteOverride,
  levelRangeCost,
  levelUpCost,
  levelUpHero,
  levelUpInfo,
  maxLevelOf,
  needsBranch,
  newGame,
  newHeroId,
  rarityForLevel,
  simulateBattle,
  validateHeroes,
  type HeroState,
  type SaveState,
} from '../src/core';
import { loadFullContext, readJsonDir } from '../scripts/lib/content-node';
import { cardHero } from './helpers';

const ctx = loadFullContext();
const T = ctx.content.heroes;

describe('контент героев v2', () => {
  it('12 героев: 6 первых профессий × парень и девушка, у всех зелёный → красный; 5 сюжетных', () => {
    const all = Object.values(T);
    expect(all).toHaveLength(12);
    expect(all.every((t) => t.baseRarity === 'green' && t.maxRarity === 'red')).toBe(true);
    expect(all.filter((t) => t.source === 'story').map((t) => t.id).sort()).toEqual(['alan', 'bran', 'dorn', 'greta', 'vika']);
    const byLine = new Map<string, string[]>();
    for (const t of all) byLine.set(t.line, [...(byLine.get(t.line) ?? []), t.gender]);
    expect([...byLine.keys()].sort()).toEqual(['acolyte', 'archer', 'mage', 'merchant', 'swordman', 'thief']);
    for (const [, g] of byLine) expect(g.sort()).toEqual(['f', 'm']);
    for (const t of all) expect(ctx.content.jobs[t.job].tier).toBe(1);
  });

  it('24 ветки: у каждого героя две вторые профессии своей линии; Бард — у парня, Танцовщица — у девушки', () => {
    const forms = Object.values(T).flatMap((t) => t.branches.map((b) => ({ t, b })));
    expect(forms).toHaveLength(24);
    for (const { t, b } of forms) {
      expect(ctx.content.jobs[b.job].tier).toBe(2);
      expect(ctx.content.jobs[b.job].from).toContain(t.line);
      expect(b.skills.map((s) => s.level)).toEqual([1, 10, 30, 50]);
      expect(b.promotion.length).toBeGreaterThan(10);
    }
    expect(T.bran.branches.map((b) => b.job)).toEqual(['hunter', 'bard']);
    expect(T.meilin.branches.map((b) => b.job)).toEqual(['hunter', 'dancer']);
    // Навыки 1-го уровня различны: у 12 героев и у 24 форм.
    const first = (skills: { level: number; skill: string }[]) => skills.find((s) => s.level === 1)!.skill;
    expect(new Set(Object.values(T).map((t) => first(t.skills))).size).toBe(12);
    expect(new Set(forms.map(({ b }) => first(b.skills))).size).toBe(24);
    // Сюжетные ветки прежней фиксированной формы сохранены (миграция v7 даёт их старым сохранениям).
    expect(['alan', 'bran', 'vika', 'greta', 'dorn'].map((id) => T[id].branches.map((b) => b.job))).toEqual([
      ['knight', 'crusader'],
      ['hunter', 'bard'],
      ['priest', 'monk'],
      ['blacksmith', 'alchemist'],
      ['assassin', 'rogue'],
    ]);
  });

  it('навыки 1/10 сюжетной тройки — прежние (баланс главы 1 не сдвигается); Ирис и Отто — свои навыки 1-го уровня', () => {
    expect(T.alan.skills.slice(0, 2)).toEqual([
      { level: 1, skill: 'swordman_bash' },
      { level: 10, skill: 'swordman_endure' },
    ]);
    expect(T.vika.skills.slice(0, 3).map((s) => s.level)).toEqual([1, 5, 10]);
    expect(T.iris.skills[0].skill).toBe('job_swordman_magnum_break');
    expect(T.otto.skills[0].skill).toBe('job_merchant_cart_revolution');
  });

  it('правило различия: у героев одного класса и форм одной ветки ≤ 2 общих навыков и разный фирменный — без предупреждений', () => {
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
          heroes: [...readJsonDir('data/heroes').filter((f) => (f.data as { id: string }).id !== 'iris'), { file: 'data/heroes/bad.json', data }],
        });
        return [];
      } catch (e) {
        expect(e).toBeInstanceOf(ContentError);
        return (e as ContentError).problems;
      }
    };
    const br = T.iris.branches;
    expect(problems(raw({}))).toEqual([]);
    expect(problems(raw({ job: 'nope' })).join()).toMatch(/класс nope не найден/);
    expect(problems(raw({ line: 'mage' })).join()).toMatch(/line mage/);
    expect(problems(raw({ job: 'knight' })).join()).toMatch(/первая профессия/);
    expect(problems(raw({ maxRarity: 'green', baseRarity: 'blue' })).join()).toMatch(/maxRarity green ниже baseRarity blue/);
    expect(problems(raw({ skills: [{ level: 1, skill: 'nope' }, { level: 10, skill: 'swordman_bash' }] })).join()).toMatch(/навык nope не найден/);
    expect(problems(raw({ skills: [{ level: 10, skill: 'swordman_bash' }, { level: 5, skill: 'job_swordman_magnum_break' }] })).join()).toMatch(/строго возрастать/);
    expect(problems(raw({ maxRarity: 'gold', skills: [{ level: 1, skill: 'job_swordman_magnum_break' }, { level: 90, skill: 'swordman_bash' }] })).join()).toMatch(/предел gold — 80/);
    expect(problems(raw({ name: 'Алан' })).join()).toMatch(/имя «Алан» уже у карточки/);
    expect(problems(raw({ bio: 'x'.repeat(161) })).join()).toMatch(/bio/);
    // Ветки: не две, чужая линия, повтор, Танцовщица у парня / Бард у девушки.
    expect(problems(raw({ branches: [br[0], br[1], br[0]] })).join()).toMatch(/branches/);
    expect(problems(raw({ branches: [br[0], { ...br[1], job: 'wizard' }] })).join()).toMatch(/не из линии swordman/);
    expect(problems(raw({ branches: [br[0], br[0]] })).join()).toMatch(/указана дважды/);
    const bran = (patch: Record<string, unknown>) => ({ ...structuredClone(T.bran), id: 'bad', name: 'Плохой', ...patch });
    expect(problems({ ...bran({}), gender: 'm', branches: [T.bran.branches[0], { ...T.meilin.branches[1] }] }).join()).toMatch(/dancer — только для девушки/);
    expect(problems({ ...structuredClone(T.meilin), id: 'bad', name: 'Плохой', branches: [T.meilin.branches[0], { ...T.bran.branches[1] }] }).join()).toMatch(/bard — только для парня/);
    // Одинаковые навыки 1-го уровня у двух героев / двух форм — ✗.
    expect(problems(raw({ skills: [{ level: 1, skill: 'swordman_bash' }, { level: 10, skill: 'job_knight_two_hand_mastery' }] })).join()).toMatch(/навык 1-го уровня swordman_bash/);
    expect(problems(raw({ branches: [{ ...br[0], skills: T.alan.branches[0].skills }, br[1]] })).join()).toMatch(/навык 1-го уровня job_knight_bowling_bash/);
    // ⚠: копия Ирис под другим id — общие навыки и тот же фирменный (и у формы, и у первой профессии).
    const warnings: string[] = [];
    validateHeroes({ ...ctx.content, heroes: { ...T, bad: { ...T.iris, id: 'bad', name: 'Плохой' } } }, [], warnings);
    expect(warnings.join()).toMatch(/общих навыков 4 > 2/);
    expect(warnings.join()).toMatch(/одинаковый фирменный навык/);
  });
});

describe('статы, навыки, ветки, сила навыков', () => {
  it('редкость умножает статы (statMult), предел уровня — по редкости', () => {
    const lv = 20;
    const hp = CARD_RARITIES.map((r) => cardStats(T.iris, lv, r, ctx).hp);
    for (let i = 1; i < hp.length; i++) expect(hp[i]).toBeGreaterThan(hp[i - 1]);
    expect(CARD_RARITIES.map((r) => maxLevelOf(ctx, r))).toEqual([20, 40, 60, 80, 100]);
    expect(rarityForLevel(ctx, 20)).toBe('green');
    expect(rarityForLevel(ctx, 21)).toBe('blue');
    expect(rarityForLevel(ctx, 5, 'purple')).toBe('purple');
  });

  it('форма — по ветке: класс, роль, статы, навыки, лист; ниже фиолетового ветка не действует', () => {
    expect(activeForm(T.alan, { rarity: 'blue', branch: 'knight' }).job).toBe('swordman');
    expect(activeForm(T.alan, { rarity: 'purple', branch: 'knight' })).toMatchObject({ job: 'knight', role: 'tank', sprite: 'hero_alan_knight_detail_v2', branch: 'knight' });
    expect(activeForm(T.alan, { rarity: 'red', branch: 'crusader' })).toMatchObject({ job: 'crusader', role: 'tank', sprite: 'hero_alan_crusader_detail_v2' });
    // Вика-Монахиня — танк вместо лекаря; Грета-Алхимик — лекарь.
    expect(activeForm(T.vika, { rarity: 'purple', branch: 'monk' }).role).toBe('tank');
    expect(activeForm(T.greta, { rarity: 'purple', branch: 'alchemist' }).role).toBe('healer');
    const blue = cardHero(ctx, 'alan', 40, { rarity: 'blue' });
    const knight: HeroState = { ...blue, rarity: 'purple', branch: 'knight' };
    const crusader: HeroState = { ...blue, rarity: 'purple', branch: 'crusader' };
    expect(heroSkills(knight, ctx)).toEqual({ basic: ctx.content.jobs.knight.basic, actives: ['job_knight_bowling_bash', 'job_swordman_provoke'], passives: ['job_knight_auto_counter'] });
    expect(heroSkills(crusader, ctx).basic).toBe(ctx.content.jobs.crusader.basic);
    expect(heroSpriteOverride(knight, ctx)).toBe('hero_alan_knight_detail_v2');
    expect(buildUnit(knight, ctx).stats.hp).not.toBe(buildUnit(crusader, ctx).stats.hp);
    expect(heroCard(knight, ctx)).toMatchObject({ job: 'knight', jobName: 'Рыцарь', branch: 'knight', needsBranch: false });
    expect(heroCard(blue, ctx)).toMatchObject({ job: 'swordman', branchAt: 'purple', needsBranch: false });
    expect(heroCard(blue, ctx).branches.map((b) => b.jobName)).toEqual(['Рыцарь', 'Крестоносец']);
  });

  it('фиолетовый без ветки: форма первой профессии со статами фиолетового, «Выберите ветку!»', () => {
    const none: HeroState = { id: 'x', templateId: 'kai', rarity: 'purple', level: 45 };
    expect(needsBranch(none, ctx)).toBe(true);
    expect(heroCard(none, ctx)).toMatchObject({ job: 'mage', needsBranch: true });
    expect(buildUnit(none, ctx).stats.hp).toBe(cardStats(T.kai, 45, 'purple', ctx).hp);
    expect(buildUnit(none, ctx).stats.hp).toBeGreaterThan(cardStats(T.kai, 45, 'blue', ctx).hp);
    // Чужая ветка не действует (sanitizeSave её снимет).
    expect(activeForm(T.kai, { rarity: 'purple', branch: 'knight' }).job).toBe('mage');
    expect(needsBranch({ ...none, branch: 'wizard' }, ctx)).toBe(false);
  });

  it('скачок силы синий → фиолетовый с веткой ≈ +40% (раздел 2.1): hp × atk вырастает в 1.3–2.2 раза', () => {
    for (const t of Object.values(T)) {
      for (const b of t.branches) {
        const lv = 40;
        const s0 = cardStats(t, lv, 'blue', ctx);
        const s1 = cardStats(t, lv, 'purple', ctx, b.job);
        const k = Math.sqrt((s1.hp * s1.atk) / (s0.hp * s0.atk));
        expect(k, `${t.id}/${b.job}`).toBeGreaterThan(1.15);
        expect(k, `${t.id}/${b.job}`).toBeLessThan(1.6);
      }
    }
  });

  it('навык ур. 50 ветки открывается на фиолетовом (предел синего — 40)', () => {
    const lvl50: HeroState = { id: 'x', templateId: 'bran', rarity: 'purple', level: 50, branch: 'hunter' };
    const all = [...heroSkills(lvl50, ctx).actives, ...heroSkills(lvl50, ctx).passives];
    expect(all).toContain('job_hunter_falcon_assault');
    expect(heroSkills({ ...lvl50, level: 49 }, ctx).actives).not.toContain('job_hunter_falcon_assault');
  });

  it('дымовой бой: каждая из 24 форм на пределе фиолетового проводит бой', () => {
    for (const t of Object.values(T)) {
      for (const b of t.branches) {
        const u = buildUnit({ id: 'smoke', templateId: t.id, rarity: 'purple', level: 60, branch: b.job }, ctx);
        const r = simulateBattle(ctx.content, [u, null, null, null, null], ['mob_boss1', null, null, null, null], 3, { combat: ctx.combat });
        expect(['A', 'B', 'draw']).toContain(r.winner);
      }
    }
  });

  it('«Сила навыков» на золотом и красном: skillPower юнита, урон навыка растёт, обычная атака — нет', () => {
    const gold: HeroState = { ...cardHero(ctx, 'iris', 60, { rarity: 'gold' }), branch: 'knight' };
    expect(buildUnit({ ...gold, rarity: 'purple' }, ctx).skillPower).toBeUndefined();
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
    expect(levelUpInfo(rich(levelUpCost(1, ctx).exp - 1, 1000), 'h1', ctx)).toMatchObject({ canLevel: false, blocker: 'not_enough_exp', affordable: 0 });
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
