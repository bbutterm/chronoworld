/** Имена вариантов и способ применения должны совпадать с реальным набором навыков героя. */
import { describe, expect, it } from 'vitest';
import {
  buildUnit, chooseBranch, heroCard, heroSkillList, levelUpHero, newGame, Rng,
  simulateBattle, validateHeroes, type Content, type HeroState, type UnitDef,
} from '../src/core';
import { selectTargets } from '../src/core/targeting';
import { skillFacts, skillKind } from '../src/game/skillFacts';
import { loadFullContext } from '../scripts/lib/content-node';
import { cardHero, unit } from './helpers';

const ctx = loadFullContext();
const teoAsura = 'job_monk_asura_strike';
const vikaAsura = 'ult_vika_asura';
const factsOptions = { defaultCooldown: ctx.combat.skills?.defaultCooldown ?? 8, turnSeconds: ctx.combat.statusTurnSeconds ?? 1 };
const checkNames = (content: Content) => {
  const problems: string[] = [];
  validateHeroes(content, problems);
  return problems.filter((p) => p.includes('одинаковое имя'));
};

describe('имена навыков героев', () => {
  it('во всех 36 формах нет разных механик под одинаковым именем', () => {
    expect(checkNames(ctx.content)).toEqual([]);
  });

  it.each([
    ['ult_vika_asura', 'job_monk_asura_strike'],
    ['ult_alan_magnum_break', 'job_swordman_magnum_break'],
    ['ult_alan_grand_cross', 'job_crusader_grand_cross'],
    ['ult_dorn_venom_splasher', 'job_assassin_venom_splasher'],
    ['ult_zara_sonic_blow', 'job_assassin_sonic_blow'],
  ])('ловит прежний конфликт %s с %s', (ultId, activeId) => {
    const content = structuredClone(ctx.content);
    content.skills[ultId].name = content.skills[activeId].name;
    const errors = checkNames(content);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(ultId);
    expect(errors[0]).toContain(activeId);
  });

  it('отличает запасной автонавык барда в новых героях от ульты Брана', () => {
    const content = structuredClone(ctx.content);
    content.heroes.bran.branches.find((b) => b.job === 'bard')!.skills[3].skill = 'job_bard_frost_joker';
    expect(checkNames(content)).toEqual([]);
    content.skills.job_bard_frost_joker.name = content.skills.ult_bran_frost_joker.name;
    expect(checkNames(content)).toHaveLength(1);
  });

  it('разрешает общий id у разных героев и косметические варианты одинаковой механики', () => {
    const content = structuredClone(ctx.content);
    const copy = { ...content.skills[teoAsura], id: 'monk_asura_copy', icon: 'another_icon', description: 'Другое художественное описание.' };
    content.skills[copy.id] = copy;
    content.heroes.vika.branches.find((b) => b.job === 'monk')!.skills[3].skill = copy.id;
    expect(checkNames(content)).toEqual([]);
    // Божья защита и до правки разделялась Викой и Тео: это тот же навык, а не конфликт имён.
    expect(content.heroes.teo.skills.some((s) => s.skill === 'job_acolyte_divine_protection')).toBe(true);
    expect(content.heroes.vika.skills.some((s) => s.skill === 'job_acolyte_divine_protection')).toBe(true);
  });

  it('ловит одинаковые эффекты, если одно определение на энергии, а другое по перезарядке', () => {
    const content = structuredClone(ctx.content);
    content.skills[vikaAsura] = { ...content.skills[teoAsura], id: vikaAsura };
    expect(checkNames(content)).toHaveLength(1);
  });

  it('не распространяет проверку на неиспользуемые героями навыки монстров', () => {
    const content = structuredClone(ctx.content);
    content.skills.unused_monster_skill = { ...content.skills[vikaAsura], id: 'unused_monster_skill', name: content.skills[teoAsura].name };
    expect(checkNames(content)).toEqual([]);
  });
});

describe('Асура: форма, уровень открытия и реальные эффекты', () => {
  it.each(['teo', 'vika'])('%s: до фиолетового и до выбора монаха Асуры нет, выбор ветки включает правильную ульту', (templateId) => {
    const blue: HeroState = { id: 'h_monk', templateId, rarity: 'blue', level: 40, branch: 'monk' };
    expect(buildUnit(blue, ctx).skills.ult).toBe(ctx.content.heroes[templateId].ult);
    expect(buildUnit(blue, ctx).skills.actives).not.toContain(teoAsura);
    const save = newGame(ctx, 0);
    save.heroes = [{ ...blue, rarity: 'purple', branch: undefined, level: 1 }];
    expect(buildUnit(save.heroes[0], ctx).skills.ult).toBe(ctx.content.heroes[templateId].ult);
    const promoted = chooseBranch(save, blue.id, 'monk', ctx).save.heroes[0];
    const ult = ctx.content.heroes[templateId].branches.find((b) => b.job === 'monk')!.ult;
    expect(heroCard(promoted, ctx).ult).toBe(ult);
    expect(buildUnit(promoted, ctx).skills.ult).toBe(ult);
    expect(buildUnit(promoted, ctx).skills.actives).not.toContain(teoAsura);
    expect(promoted.level).toBe(1);
  });

  it('Тео: рывок закрыт на 49-м, открывается ровно на 50-м; Вика сохраняет отдельную ульту', () => {
    const save = newGame(ctx, 0);
    save.heroes = [cardHero(ctx, 'teo/monk', 49), cardHero(ctx, 'vika/monk', 49)];
    save.resources.heroExp = 1e9;
    save.resources.gold = 1e9;
    const [teo, vika] = save.heroes;
    expect(heroSkillList(teo, ctx).find((s) => s.skill === teoAsura)).toMatchObject({ level: 50, unlocked: false });
    expect(buildUnit(teo, ctx).skills.actives).not.toContain(teoAsura);
    const result = levelUpHero(save, teo.id, ctx);
    const leveled = result.save.heroes.find((h) => h.id === teo.id)!;
    expect(result.events).toContainEqual({ type: 'skillUnlocked', heroId: teo.id, skill: teoAsura, level: 50 });
    expect(heroSkillList(leveled, ctx).find((s) => s.skill === teoAsura)).toMatchObject({ level: 50, unlocked: true });
    expect(buildUnit(leveled, ctx).skills.actives).toContain(teoAsura);
    expect(buildUnit(leveled, ctx).skills.ult).toBe('ult_teo_ki_explosion');
    expect(buildUnit(vika, ctx).skills.ult).toBe(vikaAsura);
    expect(buildUnit(vika, ctx).skills.actives).not.toContain(vikaAsura);
    expect(heroSkillList({ ...vika, level: 50 }, ctx).find((s) => s.level === 50)?.skill).toBe('job_monk_steel_body');
  });

  it('цель Тео — минимум абсолютных ОЗ, Вики — ближайший враг; только у Тео рывок и каст', () => {
    const a = unit('A', 0, 0, 0);
    const close = unit('B', 0, 1, 0, { hp: 400, maxHp: 2000 });
    const lowHp = unit('B', 1, 20, 0, { hp: 200, maxHp: 300 });
    const enemies = [close, lowHp];
    const teo = ctx.content.skills[teoAsura];
    const vika = ctx.content.skills[vikaAsura];
    expect(selectTargets(a, teo.target, [a], enemies, new Rng(1), ctx.combat)).toEqual([lowHp]);
    expect(selectTargets(a, vika.target, [a], enemies, new Rng(1), ctx.combat)).toEqual([close]);
    expect(teo).toMatchObject({ range: 'ranged', cooldown: 25, castTime: 1.5, effects: [{ type: 'dash' }, { type: 'damage', k: 3.5 }] });
    // Аудит 11.10 (balance-combat 7): одиночная ульта Асуры ×5 → ×5,5 и оглушение 1 с — сбивает заряд босса.
    expect(vika).toMatchObject({ range: 'melee', castTime: 0, effects: [{ type: 'damage', k: 5.5 }, { type: 'status', status: { stun: true, turns: 1 } }] });
    expect(vika.cooldown).toBeUndefined();
  });

  it('в бою ручной режим удерживает только ульту Вики; рывок Тео остаётся автоматическим после уровня 50', () => {
    const dummy: UnitDef = { ...ctx.content.units.mob_poporing, id: 'dummy', stats: { hp: 1e7, atk: 0, def: 0, spd: 0 } };
    const battle = (templateId: string, level: number, manualUlt: boolean) => simulateBattle(ctx.content, [buildUnit(cardHero(ctx, `${templateId}/monk`, level), ctx)], [dummy], 7, { combat: { ...ctx.combat, timeLimitSeconds: 40 }, manualUlt });
    const teo49 = battle('teo', 49, true);
    const teo50 = battle('teo', 50, true);
    expect(teo49.log.some((e) => 'skill' in e && e.skill === teoAsura)).toBe(false);
    const hits = teo50.log.filter((e) => e.type === 'attack' && e.skill === teoAsura);
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[1].t - hits[0].t).toBeGreaterThanOrEqual(25);
    expect(teo50.log.some((e) => e.type === 'ult' && e.unit === 'A0')).toBe(false);
    const vikaManual = battle('vika', 1, true);
    const vikaAuto = battle('vika', 1, false);
    expect(vikaManual.log.some((e) => e.type === 'ready' && e.unit === 'A0')).toBe(true);
    expect(vikaManual.log.some((e) => e.type === 'ult' && e.skill === vikaAsura)).toBe(false);
    expect(vikaAuto.log.some((e) => e.type === 'ult' && e.skill === vikaAsura)).toBe(true);
  });

  it('детали показывают способ применения, цель, каст, перезарядку и силу из данных, в том числе на золотой редкости', () => {
    const teo = ctx.content.skills[teoAsura];
    const vika = ctx.content.skills[vikaAsura];
    expect(teo.name).toBe('Рывок Асуры');
    expect(vika.name).toBe('Удар Асуры');
    expect(skillKind(teo)).toBe('Автонавык');
    expect(skillKind(vika, { ult: true })).toBe('Ульта');
    expect(skillKind(ctx.content.skills.basic_melee, { basic: true })).toBe('Обычная атака');
    expect(skillKind(ctx.content.skills.job_monk_call_spirits)).toBe('Пассивный');
    const power = ctx.cards.rarities.find((r) => r.id === 'gold')!.skillPower;
    const tf = skillFacts(teo, { ...factsOptions, power });
    expect(tf).toContain('Перезарядка: 25 с');
    expect(tf).toContain('Каст: 1.5 с (оглушение сбивает)');
    expect(tf).toContain('Цель: враг с наименьшим ОЗ · дальний бой');
    expect(tf).toContain(`Урон: ${Math.round(3.5 * power * 100)}% АТК`);
    expect(tf).toContain('Рывок к цели');
    const vf = skillFacts(vika, { ...factsOptions, ult: true, power });
    expect(vf[0]).toMatch(/^Ульта: срабатывает на полной энергии/);
    expect(vf.some((f) => f.startsWith('Перезарядка:'))).toBe(false);
    expect(vf).toContain('Цель: ближайший враг · ближний бой');
    expect(vf).toContain(`Урон: ${Math.round(5.5 * power * 100)}% АТК`);
    expect(teo.description + vika.description!).not.toMatch(/×|\d/);
  });
});
