/**
 * Профили поведения в бою (docs/design/battle-behavior.md): каркас, нулевой профиль, правила профилей, детерминизм.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintBehaviors, resolveBehavior, type BattleEvent, type BattleResult } from '../src/core';
import { loadFullContext, ROOT } from '../scripts/lib/content-node';
import { compSquad, scenarioHashes } from './behavior-scenarios';
import { SMOOTH_SQUADS, smoothSquads } from '../scripts/lib/player-model';

const ctx = loadFullContext();

describe('каркас профилей', () => {
  it('нулевой профиль (behavior: false): лог боёв тот же, что до каркаса (292 боя, снимок 30.09)', () => {
    // Снимок снят кодом до профилей (tests/fixtures/behavior-zero-hashes.json). Меняется только осознанно: правка
    // юнитов/навыков из сценариев (tests/behavior-scenarios.ts) — с объяснением в коммите.
    const want = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/behavior-zero-hashes.json'), 'utf8')) as Record<string, string>;
    const got = scenarioHashes(ctx, 4, { behavior: false });
    const diff = Object.keys(want).filter((k) => want[k] !== got[k]);
    expect(diff, diff.slice(0, 5).join(', ')).toEqual([]);
  });

  it('все профили из библиотеки и ссылки на них целы', () => {
    const { errors } = lintBehaviors(ctx.content, ctx.combat);
    expect(errors).toEqual([]);
  });

  it('профиль юнита: свой → профессия/форма героя → по умолчанию; выключено — только «остаться в тылу»', () => {
    const [sq] = smoothSquads(ctx, 45, [['alan', 'vika', 'bran', 'kai', 'zara']]);
    expect(sq.map((u) => u.behavior)).toEqual(['guard', 'medic', 'marksman', 'caster', 'assassin']);
    expect(resolveBehavior(ctx.content.units.mob_lunatic, false, ctx.combat).id).toBe('leaper');
    expect(resolveBehavior(ctx.content.units.mob_poporing, false, ctx.combat).id).toBe('line');
    expect(resolveBehavior(ctx.content.units.mob_lunatic, false, ctx.combat, false).profile.dive?.stay).toBe(true);
    expect(resolveBehavior({ ...sq[2] }, true, ctx.combat, false).profile).toEqual({ name: 'Держит линию' });
  });
});

export const moves = (r: BattleResult, uid: string) => r.log.filter((e): e is Extract<BattleEvent, { type: 'move' }> => e.type === 'move' && e.unit === uid);
export { compSquad, SMOOTH_SQUADS };
