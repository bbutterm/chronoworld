import { describe, expect, it } from 'vitest';
import { skillFacts, skillSummary } from '../src/game/skillFacts';
import { loadGameContext } from '../scripts/lib/content-node';
const ctx = loadGameContext();

describe('сравнение навыков профессий', () => {
  it('показывает действующие цифры удара, лечения и щита без выдуманного времени ульты', () => {
    const damage = ctx.content.skills.archer_volley;
    expect(skillSummary(damage)).toBe('Урон 105% АТК × 3');
    expect(skillSummary(damage, 1.5)).toBe('Урон 158% АТК × 3');
    expect(skillSummary(ctx.content.skills.basic_heal, 1.5)).toBe('Лечение 150% АТК');
    expect(skillSummary(ctx.content.skills.basic_heal)).toBe('Лечение 100% АТК');
    for (const skill of Object.values(ctx.content.skills)) {
      const shield = skill.effects.find(e => e.type === 'shield');
      if (!shield || skill.effects.some(e => e.type === 'damage' || e.type === 'heal')) continue;
      expect(skillSummary(skill)).toBe(`Щит ${Math.round(shield.pctMaxHp * 100)}% ОЗ`);
    }
    const facts = skillFacts(damage, { ult: true, defaultCooldown: 8, turnSeconds: 1 });
    expect(facts[0]).toContain('на полной энергии');
    expect(facts[0]).toContain('со временем');
    expect(facts[0]).not.toMatch(/10–12|≈|\d+ с/);
  });

  it('для каждого актуального навыка всех форм героя есть смысл вместо служебного ID', () => {
    const ids = new Set<string>();
    for (const hero of Object.values(ctx.content.heroes)) {
      for (const form of [hero, ...hero.branches, ...hero.branches.flatMap(b => b.advanced ? [b.advanced] : [])]) {
        for (const s of form.skills) ids.add(s.skill);
        if (form.ult) ids.add(form.ult);
      }
    }
    expect(ids.size).toBeGreaterThan(100);
    for (const id of ids) {
      const summary = skillSummary(ctx.content.skills[id]);
      expect(summary, id).toMatch(/[а-яё]/i);
      expect(summary, id).not.toMatch(/undefined|NaN|job_|adv_|ro_/);
    }
  });
});
