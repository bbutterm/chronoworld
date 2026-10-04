/**
 * Ульты героев (docs/design/battle-decisions.md §1, «Ульта героя»): у каждой формы героя (первая профессия и обе ветки)
 * своя ульта с 1-го уровня — отдельный навык на энергии (skills.ult), не один из навыков формы. Энергия героя копится от
 * времени, ходов и ударов (combat.json → energy.hero); контрольная ульта (оглушение / срыв каста) сбивает заряд босса.
 */
import { describe, expect, it } from 'vitest';
import { breaksCharge, buildUnit, enemySquad, simulateBattle, ultSkillOf, type BattleEvent, type UnitDef } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const heroes = Object.values(ctx.content.heroes);
const forms = heroes.flatMap((t) => [{ who: t.id, tpl: t, branch: undefined as string | undefined, ult: t.ult, skills: t.skills }, ...t.branches.map((b) => ({ who: `${t.id}/${b.job}`, tpl: t, branch: b.job, ult: b.ult, skills: b.skills }))]);

describe('ульты героев: данные', () => {
  it('у каждой из 36 форм своя ульта: навык есть, активный, не среди навыков формы, у разных форм — разные', () => {
    expect(forms).toHaveLength(heroes.length * 3);
    const seen = new Map<string, string>();
    for (const f of forms) {
      expect(f.ult, f.who).toBeTruthy();
      const s = ctx.content.skills[f.ult!];
      expect(s, f.who).toBeTruthy();
      expect(s.trigger, f.who).toBeUndefined();
      expect(f.skills.map((x) => x.skill), f.who).not.toContain(f.ult);
      expect(seen.get(f.ult!), `${f.who}: ульта как у ${seen.get(f.ult!)}`).toBeUndefined();
      seen.set(f.ult!, f.who);
      expect(s.name.length, f.who).toBeGreaterThan(0);
      expect(s.description, f.who).toBeTruthy();
    }
  });

  it('ульта открыта с 1-го уровня: buildUnit кладёт её в skills.ult и энергию героя, ultSkillOf берёт её', () => {
    for (const f of forms) {
      const rarity = f.branch ? 'purple' : 'green';
      const u = buildUnit({ id: 'h1', templateId: f.tpl.id, rarity, level: 1, ...(f.branch ? { branch: f.branch } : {}) }, ctx);
      expect(u.skills.ult, f.who).toBe(f.ult);
      expect(u.skills.actives, f.who).not.toContain(f.ult);
      expect(u.energy, f.who).toEqual(ctx.combat.energy.hero);
      expect(ultSkillOf(u, ctx.content.skills, ctx.combat)?.id, f.who).toBe(f.ult);
    }
  });

  it('есть из кого выбрать, кем сбить заряд: контрольные ульты у трети форм и у первого героя (Алан — Магнум Брейк)', () => {
    const breakers = forms.filter((f) => breaksCharge(ctx.content.skills[f.ult!]));
    expect(breakers.length).toBeGreaterThanOrEqual(8);
    expect(breakers.length).toBeLessThanOrEqual(forms.length / 2);
    expect(breaksCharge(ctx.content.skills[ctx.content.heroes.alan.ult!])).toBe(true);
    // И у части — только урон/поддержка: ими заряд не сбить.
    expect(forms.some((f) => !breaksCharge(ctx.content.skills[f.ult!]))).toBe(true);
  });
});

describe('ульты героев: бой', () => {
  const squad = (ids: string[], rarity: 'green' | 'purple', level: number): UnitDef[] =>
    ids.map((id, i) => {
      const [templateId, branch] = id.split('/');
      return buildUnit({ id: `h${i}`, templateId, rarity, level, ...(branch ? { branch } : {}) }, ctx);
    });

  it('ульта на энергии: в авто срабатывает сама, расходует ресурс, первая — в осмысленном окне 15–22 с боя', () => {
    const sq = squad(['alan', 'bran', 'vika', 'greta', 'dorn'], 'green', 15);
    const firsts: number[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const r = simulateBattle(ctx.content, sq, enemySquad('ch2_s9', ctx), seed, { combat: ctx.combat });
      const ults = (r.log as BattleEvent[]).filter((e): e is Extract<BattleEvent, { type: 'ult' }> => e.type === 'ult' && e.unit.startsWith('A'));
      for (const e of ults) expect(e.skill).toBe(sq[Number(e.unit.slice(1))].skills.ult);
      if (ults.length) firsts.push(ults[0].t);
      // После ульты энергия с нуля: следующее событие с энергией героя — меньше максимума.
      const ult = (r.log as BattleEvent[]).find((e) => e.type === 'ult' && e.unit.startsWith('A'));
      if (ult && ult.type === 'ult') {
        const next = (r.log as BattleEvent[]).find((e) => e.t > ult.t && e.type === 'attack' && e.unit === ult.unit);
        if (next && next.type === 'attack') expect(next.energy).toBeLessThan(ctx.combat.energy.max);
      }
    }
    // 04.10: шкала 1500 и энергия 3,5/с + 2 за действие + 1 за удар; измерено по всем шести seed: 19,2 с.
    // Проверяется каждое повторение, чтобы один удачный seed не скрывал раннюю ульту или отсутствующую готовность.
    expect(firsts).toHaveLength(6);
    for (const first of firsts) {
      expect(first).toBeGreaterThanOrEqual(15);
      expect(first).toBeLessThanOrEqual(22);
    }
  });

  it('детерминизм: тот же seed — тот же бой с ультами, в авто и вручную с вводом', () => {
    const sq = squad(['alan/knight', 'lira/wizard', 'teo/priest', 'zara/assassin', 'otto/blacksmith'], 'purple', 50);
    const e = enemySquad('ch5_s10', ctx);
    const a = simulateBattle(ctx.content, sq, e, 9, { combat: ctx.combat });
    expect(simulateBattle(ctx.content, sq, e, 9, { combat: ctx.combat }).log).toEqual(a.log);
    expect(a.log.some((x) => x.type === 'ult' && x.unit.startsWith('A'))).toBe(true);
    const m0 = simulateBattle(ctx.content, sq, e, 9, { combat: ctx.combat, manualUlt: true });
    const ready = m0.log.find((x): x is Extract<BattleEvent, { type: 'ready' }> => x.type === 'ready' && !x.lost && ctx.content.skills[sq[Number(x.unit.slice(1))].skills.ult!].range === 'ranged');
    expect(ready).toBeTruthy();
    const inputs = [{ t: Math.round((ready!.t + 1) * 10) / 10, uid: ready!.unit }];
    const m1 = simulateBattle(ctx.content, sq, e, 9, { combat: ctx.combat, manualUlt: true, inputs });
    expect(simulateBattle(ctx.content, sq, e, 9, { combat: ctx.combat, manualUlt: true, inputs }).log).toEqual(m1.log);
    expect(m1.log.some((x) => x.type === 'ult' && x.unit === ready!.unit && Math.abs(x.t - inputs[0].t) < 1e-9)).toBe(true);
  });

  it('ульта-лечение раненых ждёт раненых: при целом отряде энергия не сгорает', () => {
    const sq = squad(['vika'], 'green', 10);
    // Манекен, который не ходит: никто не ранен — «Святое исцеление» не срабатывает, обычные удары идут.
    const dummy: UnitDef = { ...ctx.content.units.mob_poporing, id: 'dummy', stats: { ...ctx.content.units.mob_poporing.stats, hp: 1e6, atk: 0, spd: 0 } };
    const r = simulateBattle(ctx.content, sq, [dummy, null, null, null, null], 1, { combat: { ...ctx.combat, timeLimitSeconds: 30 } });
    expect(r.log.some((e) => e.type === 'ult' && e.unit === 'A0')).toBe(false);
    expect(r.log.some((e) => e.type === 'heal' && e.amount === 0)).toBe(false);
  });
});
