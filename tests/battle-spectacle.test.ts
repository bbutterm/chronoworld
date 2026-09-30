import { describe, expect, it } from 'vitest';
import { loadFullContext } from '../scripts/lib/content-node';
import { SKILL_VISUALS } from '../src/game/skillVisuals';

const ctx = loadFullContext();

describe('«ульта» героя (SkillVisual.big) — подготовка и удар крупнее обычного навыка', () => {
  it('у каждой из 36 форм (12 базовых + 24 ветки) есть «большой» активный навык (общие навыки форм — не больше двух)', () => {
    let forms = 0;
    for (const h of Object.values(ctx.content.heroes)) {
      for (const f of [h, ...h.branches]) {
        forms++;
        const big = f.skills.map((s) => s.skill).filter((id) => SKILL_VISUALS[id]?.big);
        expect(big.length, `${h.id}/${f.job}: ${big.join(', ')}`).toBeGreaterThanOrEqual(1);
        expect(big.length, `${h.id}/${f.job}: ${big.join(', ')}`).toBeLessThanOrEqual(2);
        for (const id of big) expect(ctx.content.skills[id].trigger, `${id} — пассивка`).toBeUndefined();
      }
    }
    expect(forms).toBe(36);
  });
});
