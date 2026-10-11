import { describe, expect, it } from 'vitest';
import { loadFullContext } from '../scripts/lib/content-node';
import { buildUnit, orderActives, simulateBattle, type HeroState, type SkillDef } from '../src/core';

const ctx = loadFullContext();
const skills = ctx.content.skills;

/** Формы героев: база, ветки второй профессии и ветеранские (advanced) — со списками навыков на максимальном уровне. */
const forms = Object.values(ctx.content.heroes).flatMap((h) => [
  { name: h.id, job: h.job, skills: h.skills, ult: h.ult, hero: { templateId: h.id, rarity: 'purple', level: 60 } },
  ...h.branches.flatMap((b) => [
    { name: `${h.id}/${b.job}`, job: b.job, skills: b.skills, ult: b.ult, hero: { templateId: h.id, branch: b.job, rarity: 'gold', level: 69 } },
    ...(b.advanced
      ? [{ name: `${h.id}/${b.job}/${b.advanced.job}`, job: b.advanced.job, skills: b.advanced.skills, ult: b.advanced.ult, hero: { templateId: h.id, branch: b.job, rarity: 'red', level: 100 } }]
      : []),
  ]),
]);
const defaultCooldown = ctx.combat.skills?.defaultCooldown ?? 8;

describe('открытые навыки форм героев срабатывают (аудит 11.10)', () => {
  it('навык без перезарядки — наполнитель: в порядке выбора после него только такие же наполнители', () => {
    // Иначе навык с перезарядкой (Гром Юпитера, Ледяная нова) никогда не выбирается: стрела с перезарядкой 0 всегда готова.
    for (const form of forms) {
      const actives = form.skills.map((s) => skills[s.skill]).filter((s): s is SkillDef => !!s && !s.trigger && s.target.side === 'enemy');
      const ordered = orderActives(actives);
      const first = ordered.findIndex((s) => (s.cooldown ?? defaultCooldown) === 0);
      if (first < 0) continue;
      const shadowed = ordered.slice(first + 1).filter((s) => (s.cooldown ?? defaultCooldown) > 0);
      expect(shadowed.map((s) => s.id), `${form.name}: ${ordered[first].id} заслоняет`).toEqual([]);
    }
  });

  it('у базы и ветки с дальней обычной атакой нет приёмов ближнего боя по врагу', () => {
    // Ветеранские формы по правилу наследования (advance-second.test.ts) хранят все навыки базы, в том числе приёмы
    // торговца у создателя; для них — следующая проверка боем.
    for (const form of forms.filter((f) => f.hero.rarity !== 'red')) {
      if (skills[ctx.content.jobs[form.job].basic].range !== 'ranged') continue;
      const melee = [...form.skills.map((s) => s.skill), ...(form.ult ? [form.ult] : [])].filter((id) => skills[id].range === 'melee' && skills[id].target.side === 'enemy');
      expect(melee, form.name).toEqual([]);
    }
  });

  it('приём ближнего боя у дальнего бойца срабатывает в бою (создатель: Маммонит, Удар сковородой, Тележка)', () => {
    // Дальний боец в ближний бой не входит (battle.ts rangeOf): его приём ближнего боя летит как дальний.
    let checked = 0;
    for (const form of forms) {
      if (skills[ctx.content.jobs[form.job].basic].range !== 'ranged') continue;
      const melee = form.skills.map((s) => skills[s.skill]).filter((s) => s.range === 'melee' && s.target.side === 'enemy' && !s.trigger);
      if (melee.length === 0) continue;
      const unit = buildUnit({ id: 'hero', ...form.hero } as HeroState, ctx);
      const dummy = { ...unit, id: 'dummy', stats: { ...unit.stats, atk: 1, hp: 100_000_000 }, skills: { basic: unit.skills.basic, actives: [], passives: [] } };
      const result = simulateBattle(ctx.content, [unit, null, null, null, null], [dummy, null, null, null, null], 5, { combat: ctx.combat });
      for (const s of melee) {
        expect(result.log.some((e) => e.type === 'attack' && e.unit === 'A0' && e.skill === s.id), `${form.name}: ${s.id}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it('описания навыков адвансов — текст для игрока, без служебных пометок генератора', () => {
    for (const s of Object.values(skills).filter((x) => /^(adv|ro|ult_adv)_/.test(x.id))) {
      expect(s.description ?? '', s.id).not.toMatch(/ход(а|ов)? статуса|шанс 100%|не оригинальный RO|не подключена/);
    }
  });
});
