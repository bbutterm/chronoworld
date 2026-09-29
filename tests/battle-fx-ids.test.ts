import { describe, expect, it } from 'vitest';
import { animatedFxIds, battleFxIds, skillFx } from '../src/game/animatedFx';

describe('эффекты боя грузятся по навыкам (battleFxIds)', () => {
  it('без навыков — только общие эффекты, без fx_job_*', () => {
    const ids = battleFxIds([]);
    expect(ids).toContain('fx_hit');
    expect(ids).toContain('fx_death');
    expect(ids.some((id) => id.startsWith('fx_job_'))).toBe(false);
    expect(ids.length).toBeLessThan(animatedFxIds().length);
  });

  it('эффекты навыка из каталога и visual юнита добавляются, неизвестные id пропускаются', () => {
    const want = Object.values(skillFx('job_acolyte_blessing') ?? {});
    expect(want.length).toBeGreaterThan(0);
    const ids = battleFxIds(['job_acolyte_blessing', undefined, 'нет_такого'], ['fx_job_thief_steal', 'нет_такого', undefined]);
    for (const id of want) expect(ids).toContain(id);
    expect(ids).toContain('fx_job_thief_steal');
    expect(ids).not.toContain('нет_такого');
  });
});
