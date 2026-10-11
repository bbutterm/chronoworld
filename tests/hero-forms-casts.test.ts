import { describe, expect, it } from 'vitest';
import { loadFullContext } from '../scripts/lib/content-node';
import { orderActives, type SkillDef } from '../src/core';

const ctx = loadFullContext();
const skills = ctx.content.skills;

/** Формы героев: база, ветки второй профессии и ветеранские (advanced) — со списками навыков на максимальном уровне. */
const forms = Object.values(ctx.content.heroes).flatMap((h) => [
  { name: h.id, job: h.job, skills: h.skills, ult: h.ult, advanced: false },
  ...h.branches.flatMap((b) => [
    { name: `${h.id}/${b.job}`, job: b.job, skills: b.skills, ult: b.ult, advanced: false },
    ...(b.advanced ? [{ name: `${h.id}/${b.job}/${b.advanced.job}`, job: b.advanced.job, skills: b.advanced.skills, ult: b.advanced.ult, advanced: true }] : []),
  ]),
]);

describe('открытые навыки форм героев срабатывают (аудит 11.10)', () => {
  it('навык без перезарядки — наполнитель: в порядке выбора после него только такие же наполнители', () => {
    // Иначе навык с перезарядкой (Гром Юпитера, Ледяная нова) никогда не выбирается: стрела с перезарядкой 0 всегда готова.
    for (const form of forms) {
      const actives = form.skills.map((s) => skills[s.skill]).filter((s): s is SkillDef => !!s && !s.trigger && s.target.side === 'enemy');
      const ordered = orderActives(actives);
      const first = ordered.findIndex((s) => (s.cooldown ?? 8) === 0);
      if (first < 0) continue;
      const shadowed = ordered.slice(first + 1).filter((s) => (s.cooldown ?? 8) > 0);
      expect(shadowed.map((s) => s.id), `${form.name}: ${ordered[first].id} заслоняет`).toEqual([]);
    }
  });

  it('у базы и ветки с дальней обычной атакой нет приёмов ближнего боя по врагу (дальний боец до цели не доходит)', () => {
    // Ветеранские формы по правилу наследования (advance-second.test.ts) хранят все навыки базы, в том числе
    // приёмы торговца; у создателя они остаются без дела — для них нужен отдельный ответ в ядре или в данных базы.
    for (const form of forms.filter((f) => !f.advanced)) {
      if (skills[ctx.content.jobs[form.job].basic].range !== 'ranged') continue;
      const melee = [...form.skills.map((s) => s.skill), ...(form.ult ? [form.ult] : [])].filter((id) => skills[id].range === 'melee' && skills[id].target.side === 'enemy');
      expect(melee, form.name).toEqual([]);
    }
  });

  it('описания навыков адвансов — текст для игрока, без служебных пометок генератора', () => {
    for (const s of Object.values(skills).filter((x) => /^(adv|ro)_/.test(x.id))) {
      expect(s.description ?? '', s.id).not.toMatch(/ход(а|ов)? статуса|шанс 100%|не оригинальный RO|не подключена/);
    }
  });
});
