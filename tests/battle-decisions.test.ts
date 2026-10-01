/**
 * Бой с решениями (docs/design/battle-decisions.md): ульта вручную (ввод игрока, детерминизм, префикс лога), стихии RO,
 * заряд босса, который сбивает ульта.
 */
import { describe, expect, it } from 'vitest';
import { breaksCharge, buildUnit, enemySquad, simulateBattle, ultSkillOf, type BattleEvent, type BattleInput, type Squad, type UnitDef } from '../src/core';
import { elementMult, type ElementsConfig } from '../src/core/elements';
import { enemyTraits } from '../src/core/behavior';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const OPTS = { combat: ctx.combat };

const heroes = (ids: string[], level = 60): UnitDef[] =>
  ids.map((id, i) => {
    const [templateId, branch] = id.split('/');
    return buildUnit({ id: `h${i}`, templateId, rarity: 'purple', level, ...(branch ? { branch } : {}) }, ctx);
  });

// Ульты форм: Брандиш (контроль), Взрыв ки (контроль), Владыка Вермилиона (урон), Великий Магнус (урон), Ледяное кольцо
// (Лира-маг, контроль; ветки «hunter» у Лиры нет — первая профессия).
const SQUAD: Squad = heroes(['alan/knight', 'teo/monk', 'kai/wizard', 'vika/priest', 'lira/hunter']);
// Бой подлиннее (≈ 50 с): ульта на энергии готова к ≈ 11–15 с.
const STAGE = 'ch4_s10';

const ultIds = (squad: Squad) => {
  const m = new Map<string, string>();
  squad.forEach((d, i) => {
    const s = d && typeof d !== 'string' ? ultSkillOf(d, ctx.content.skills, ctx.combat) : null;
    if (s) m.set(`A${i}`, s.id);
  });
  return m;
};
const usedUlt = (log: BattleEvent[], uid: string, skill: string) =>
  log.filter((e) => (e.type === 'ult' || e.type === 'attack' || (e.type === 'cast' && e.action === 'start')) && e.unit === uid && e.skill === skill);

describe('ульта вручную', () => {
  const enemies = enemySquad(STAGE, ctx);
  const ults = ultIds(SQUAD);

  it('у каждого героя отряда есть ульта — ульта формы (skills.ult, на энергии), не активный навык', () => {
    expect(ults.size).toBe(5);
    (SQUAD as UnitDef[]).forEach((u, i) => {
      expect(u.skills.ult, u.id).toBeTruthy();
      expect(ults.get(`A${i}`)).toBe(u.skills.ult);
      expect(u.skills.actives).not.toContain(u.skills.ult);
    });
    expect(ults.get('A2')).toBe(ctx.content.heroes.kai.branches.find((b) => b.job === 'wizard')!.ult);
    // Юнит без ульты (монстр-«герой» из старого кода) — по-прежнему активный навык с самой долгой перезарядкой.
    const kai = SQUAD[2] as UnitDef;
    const noUlt: UnitDef = { ...kai, skills: { ...kai.skills, ult: undefined } };
    const cds = kai.skills.actives.map((id) => ctx.content.skills[id].cooldown ?? 8);
    expect(ultSkillOf(noUlt, ctx.content.skills, ctx.combat)?.cooldown).toBe(Math.max(...cds));
  });

  it('авто (по умолчанию) = бой без ввода: ручной режим выключен — лог как раньше', () => {
    const base = simulateBattle(ctx.content, SQUAD, enemies, 7, OPTS);
    const off = simulateBattle(ctx.content, SQUAD, enemies, 7, { ...OPTS, manualUlt: false, inputs: [] });
    expect(off.log).toEqual(base.log);
    // В авто ульты героев срабатывают сами.
    for (const [uid, s] of ults) if (base.duration > 25) expect(usedUlt(base.log, uid, s).length, uid).toBeGreaterThan(0);
  });

  it('вручную без касаний ульта не срабатывает, готовность видна событием ready (раз, пока не применена)', () => {
    const r = simulateBattle(ctx.content, SQUAD, enemies, 7, { ...OPTS, manualUlt: true });
    for (const [uid, s] of ults) {
      expect(usedUlt(r.log, uid, s), uid).toHaveLength(0);
      const ready = r.log.filter((e) => e.type === 'ready' && e.unit === uid && !e.lost);
      expect(ready.length, uid).toBe(1);
    }
  });

  it('касание: ульта срабатывает на тике ввода, префикс лога до ввода не меняется; тот же seed и вводы — тот же бой', () => {
    const r0 = simulateBattle(ctx.content, SQUAD, enemies, 11, { ...OPTS, manualUlt: true });
    const ready = r0.log.find((e): e is Extract<BattleEvent, { type: 'ready' }> => e.type === 'ready' && e.unit === 'A2')!;
    expect(ready).toBeTruthy();
    const tin = Math.round((ready.t + 2) * 10) / 10;
    const inputs: BattleInput[] = [{ t: tin, uid: 'A2' }];
    const r1 = simulateBattle(ctx.content, SQUAD, enemies, 11, { ...OPTS, manualUlt: true, inputs });
    const before = (log: BattleEvent[]) => log.filter((e) => e.t < tin - 1e-9);
    expect(before(r1.log)).toEqual(before(r0.log));
    const use = usedUlt(r1.log, 'A2', ults.get('A2')!);
    expect(use.length).toBeGreaterThan(0);
    expect(use[0].t).toBeCloseTo(tin, 5);
    // Детерминизм: seed + вводы.
    const r2 = simulateBattle(ctx.content, SQUAD, enemies, 11, { ...OPTS, manualUlt: true, inputs });
    expect(r2.log).toEqual(r1.log);
    // Тот же ввод через combat.player (как сцена передаёт его через actPlayStage).
    const r3 = simulateBattle(ctx.content, SQUAD, enemies, 11, { combat: { ...ctx.combat, player: { manualUlt: true, inputs } } });
    expect(r3.log).toEqual(r1.log);
  });

  it('касание неготовой ульты пропадает; «Авто» вводом включает ульты с этого момента', () => {
    const r0 = simulateBattle(ctx.content, SQUAD, enemies, 5, { ...OPTS, manualUlt: true });
    const early = simulateBattle(ctx.content, SQUAD, enemies, 5, { ...OPTS, manualUlt: true, inputs: [{ t: 0.05, uid: 'A2' }, { t: 0.1, uid: 'A9' }] });
    // В начале боя энергии нет — касание пропадает (ульта не взводится впрок); A9 нет — ввод пропал без ошибок.
    expect(usedUlt(early.log, 'A2', ults.get('A2')!)).toHaveLength(0);
    expect(early.log).toEqual(r0.log);
    const auto = simulateBattle(ctx.content, SQUAD, enemies, 5, { ...OPTS, manualUlt: true, inputs: [{ t: 6, auto: true }] });
    expect(auto.log.some((e) => e.type === 'mode' && e.auto && Math.abs(e.t - 6) < 1e-9)).toBe(true);
    const after = [...ults].filter(([uid, s]) => usedUlt(auto.log, uid, s).some((e) => e.t >= 6)).length;
    expect(after).toBeGreaterThan(0);
    for (const [uid, s] of ults) expect(usedUlt(auto.log, uid, s).filter((e) => e.t < 6), uid).toHaveLength(0);
  });
});

describe('стихии', () => {
  const cfg = ctx.combat.elements as ElementsConfig;

  it('таблица: круг огонь > земля > ветер > вода > огонь, святость по нежити и тьме, нейтраль без модификаторов', () => {
    const circle = ['fire', 'earth', 'wind', 'water'] as const;
    circle.forEach((a, i) => {
      const b = circle[(i + 1) % 4];
      expect(elementMult(cfg, a, b), `${a}→${b}`).toBe(1.5);
      expect(elementMult(cfg, b, a), `${b}→${a}`).toBe(0.75);
    });
    expect(elementMult(cfg, 'holy', 'undead')).toBe(1.5);
    expect(elementMult(cfg, 'holy', 'dark')).toBe(1.5);
    expect(elementMult(cfg, 'dark', 'holy')).toBe(1.5);
    expect(elementMult(cfg, 'fire', 'undead')).toBe(1.5);
    for (const e of ['neutral', 'fire', 'water', 'earth', 'wind', 'holy', 'dark', 'undead'] as const) {
      expect(elementMult(cfg, 'neutral', e)).toBe(1);
      expect(elementMult(cfg, e, 'neutral')).toBe(1);
    }
  });

  it('все монстры и боссы глав со стихией по RO: нежить у зомби/скелетов', () => {
    for (const id of ['mob_melee', 'mob_ranged', 'orc_zombie', 'orc_skeleton', 'mob6_melee', 'mob7_boss', 'mob4_boss']) expect(ctx.content.units[id].element, id).toBe('undead');
  });

  it('в бою огонь по нежити — «слабость» (×1.5), без профилей стихий нет', () => {
    const squad = heroes(['kai', 'kai', 'kai']);
    const z = ctx.content.units.mob_melee;
    const tough: UnitDef = { ...z, stats: { ...z.stats, hp: z.stats.hp * 60, atk: z.stats.atk * 3 } };
    const undead: Squad = [tough, tough, null, null, null];
    const r = simulateBattle(ctx.content, squad, undead, 3, OPTS);
    expect(r.log.some((e) => e.type === 'damage' && e.elem === 'weak')).toBe(true);
    const off = simulateBattle(ctx.content, squad, undead, 3, { ...OPTS, behavior: false });
    expect(off.log.some((e) => e.type === 'damage' && e.elem)).toBe(false);
  });
});

describe('заряд босса', () => {
  const bossStage = 'ch4_s10';
  const enemies = enemySquad(bossStage, ctx);
  const boss = `B${enemies.findIndex((u) => u?.kind === 'boss')}`;
  const ults = ultIds(SQUAD);

  it('у всех 10 боссов глав есть заряд', () => {
    for (const st of ctx.content.stages.filter((s) => s.boss)) {
      const b = st.enemies.map((e) => (e ? ctx.content.units[e.unit] : null)).find((u) => u?.kind === 'boss');
      expect(b?.charge, st.id).toBeTruthy();
    }
  });

  it('не сбили — тяжёлый удар по отряду; контрольная ульта в заряд — «Сбито!» и оглушение, ульта только с уроном — нет', () => {
    const r0 = simulateBattle(ctx.content, SQUAD, enemies, 2, { ...OPTS, manualUlt: true });
    // Второй заряд (≈ 34 с): к первому (14 с) энергия на ульту есть не у всех.
    const start = r0.log.filter((e) => e.type === 'cast' && e.unit === boss && e.charge && e.action === 'start')[1];
    expect(start, 'заряд начался').toBeTruthy();
    const skill = (start as Extract<BattleEvent, { type: 'cast' }>).skill;
    // Без ответа: навык заряда бьёт весь отряд.
    const hit = r0.log.find((e) => e.type === 'attack' && e.unit === boss && e.skill === skill);
    expect(hit, 'удар заряда').toBeTruthy();
    const tin = Math.round((start!.t + 0.5) * 10) / 10;
    // Ульта только с уроном (Владыка Вермилиона) заряд не сбивает: удар заряда проходит.
    const ready = (uid: string) => r0.log.some((e) => e.type === 'ready' && e.unit === uid && !e.lost && e.t <= tin);
    expect(ready('A2') && ready('A4'), 'ульты готовы к заряду').toBe(true);
    const dmgOnly = simulateBattle(ctx.content, SQUAD, enemies, 2, { ...OPTS, manualUlt: true, inputs: [{ t: tin, uid: 'A2' }] });
    expect(usedUlt(dmgOnly.log, 'A2', ults.get('A2')!).length).toBeGreaterThan(0);
    expect(dmgOnly.log.some((e) => e.type === 'cast' && e.unit === boss && e.reason === 'break')).toBe(false);
    expect(breaksCharge(ctx.content.skills[ults.get('A2')!])).toBe(false);
    // Контрольная ульта (Ледяное кольцо Лиры, дальняя) через 0.5 с после начала заряда — сбивает.
    expect(breaksCharge(ctx.content.skills[ults.get('A4')!])).toBe(true);
    const r1 = simulateBattle(ctx.content, SQUAD, enemies, 2, { ...OPTS, manualUlt: true, inputs: [{ t: tin, uid: 'A4' }] });
    const broke = r1.log.find((e) => e.type === 'cast' && e.unit === boss && e.reason === 'break');
    expect(broke, 'сбито').toBeTruthy();
    expect(broke!.t).toBeCloseTo(tin, 5);
    expect(r1.log.some((e) => e.type === 'status' && e.target === boss && e.status === 'charge_broken' && e.action === 'apply')).toBe(true);
    expect(r1.log.some((e) => e.type === 'attack' && e.unit === boss && e.skill === skill && e.t >= start!.t && e.t < tin + 3)).toBe(false);
  });
});

describe('разведка', () => {
  it('особенности врагов выводятся из данных: лечит, стая, трус, заряд', () => {
    const t = (id: string) => enemyTraits(ctx.content.units[id], ctx.content, ctx.combat);
    expect(t('mob_marin')).toContain('лечит');
    expect(t('mob_fast')).toContain('стая');
    expect(t('mob_fabre')).toContain('трус');
    expect(t('mob4_boss')[0]).toContain('заряд');
  });
});
