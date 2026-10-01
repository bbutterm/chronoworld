import { describe, expect, it } from 'vitest';
import { loadFullContext } from '../scripts/lib/content-node';
import { lookOf, RO_SKILL_ICONS } from '../src/game/skillLook';
import { OWN_BY_LOOK, SKILL_VISUALS } from '../src/game/skillVisuals';

const ctx = loadFullContext();
const skills = ctx.content.skills;
/** Все навыки героев: базовые формы и обе ветки, с ультами форм. */
const heroSkills = [
  ...new Set(Object.values(ctx.content.heroes).flatMap((h) => [h, ...h.branches].flatMap((f) => [...f.skills.map((s) => s.skill), ...(f.ult ? [f.ult] : [])]))),
];

describe('свой вид навыков героев в бою (skillVisuals.ts, docs/content/skills-vfx.md)', () => {
  it('в таблице только существующие навыки', () => {
    for (const id of [...Object.keys(SKILL_VISUALS), ...OWN_BY_LOOK]) expect(skills[id], id).toBeTruthy();
  });

  it('у каждого навыка героя свой вид: удар/снаряд/площадь, аура баффа или вспышка пассивки', () => {
    for (const id of heroSkills) {
      const s = skills[id];
      const v = SKILL_VISUALS[id] ?? {};
      const own = OWN_BY_LOOK.has(id);
      if (s.trigger) expect(!!(v.aura || v.proc || v.hit), `пассивка ${id}`).toBe(true);
      else if (s.target.side === 'ally') expect(!!(v.sig || v.aura || own), `бафф ${id}`).toBe(true);
      else expect(!!(v.sig || v.hit || own), `активный ${id}`).toBe(true);
    }
  });

  it('два разных навыка героев не выглядят одинаково', () => {
    const seen = new Map<string, string>();
    for (const id of heroSkills) {
      if (OWN_BY_LOOK.has(id)) continue;
      const v = SKILL_VISUALS[id];
      const key = JSON.stringify([v.sig, v.hit, v.aura, v.proc, v.tint]);
      expect(seen.get(key), `${id} = ${seen.get(key)}`).toBeUndefined();
      seen.set(key, id);
    }
  });

  it('иконка RO у каждого навыка героя, кроме «Удара сковородой» (своя: сковорода кодом)', () => {
    for (const id of heroSkills) {
      if (id === 'job_merchant_frying_pan') expect(lookOf(skills[id]).glyph).toBe('pan');
      else expect(RO_SKILL_ICONS[id], id).toBeTruthy();
    }
  });
});
