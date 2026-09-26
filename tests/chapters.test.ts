import { describe, expect, it } from 'vitest';
import { enemySquad, newGame, playStage, stageStatus, type SaveState } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();
const stages = ctx.content.stages;
const clearedUpTo = (n: number): SaveState => ({ ...newGame(ctx, 0), campaign: { cleared: stages.slice(0, n).map((s) => s.id) } });

describe('K3 главы 2–3', () => {
  it('главы идут по order, этапы склеены в одну цепочку', () => {
    expect(ctx.content.chapters.map((c) => [c.id, c.order])).toEqual([
      ['chapter1', 1],
      ['chapter2', 2],
      ['chapter3', 3],
    ]);
    expect(stages).toHaveLength(30);
    stages.forEach((s, i) => expect(s.globalIndex).toBe(i));
    for (const [n, c] of ['chapter1', 'chapter2', 'chapter3'].entries()) {
      const ch = stages.filter((s) => s.chapter === c);
      expect(ch).toHaveLength(10);
      ch.forEach((s, i) => {
        expect(s.index).toBe(i);
        expect(s.globalIndex).toBe(n * 10 + i);
        expect(s.id).toBe(`ch${n + 1}_s${i + 1}`);
        expect(s.boss).toBe(i === 9);
      });
    }
  });

  it('боссы глав: Тёмный шаман и Король-лич (плейсхолдер boss3)', () => {
    const boss = (id: string) => stages.find((s) => s.id === id)!.enemies.filter((e) => e && ctx.content.units[e.unit].kind === 'boss').map((e) => e!.unit);
    expect(boss('ch2_s10')).toEqual(['mob_boss2']);
    expect(boss('ch3_s10')).toEqual(['mob3_boss']);
    expect(ctx.content.units.mob3_boss.visual.sprite).toBe('boss3');
  });

  it('новые монстры глав 2–3 используют спрайты v2 и свои навыки', () => {
    const v2 = ['melee', 'ranged', 'tank', 'fast', 'elite'];
    for (const u of Object.values(ctx.content.units).filter((x) => /^mob[23]_/.test(x.id) && x.kind === 'monster')) {
      expect(v2).toContain(u.visual.sprite);
      expect(ctx.content.skills[u.skills.basic]).toBeDefined();
      if (u.skills.ult) expect(ctx.content.skills[u.skills.ult]).toBeDefined();
    }
  });

  it('переход через границу глав открывает следующий этап', () => {
    expect(stageStatus(clearedUpTo(9), 'ch2_s1', ctx)).toBe('locked');
    expect(stageStatus(clearedUpTo(10), 'ch2_s1', ctx)).toBe('open');
    expect(stageStatus(clearedUpTo(20), 'ch3_s1', ctx)).toBe('open');
  });

  it('сила врагов растёт по globalIndex, награды и офлайн-доход — дальше главы 1', () => {
    const g = ctx.progression.campaign.enemyStatGrowthPerStage;
    const e = enemySquad('ch3_s1', ctx)[0]!;
    expect(e.stats.hp).toBe(Math.round(ctx.content.units.mob3_melee.stats.hp * Math.pow(1 + g, 20)));
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].offlinePerMinute.gold).toBeGreaterThan(stages[i - 1].offlinePerMinute.gold);
      expect(stages[i].offlinePerMinute.jobExp).toBeGreaterThan(stages[i - 1].offlinePerMinute.jobExp);
    }
    const regular = stages.filter((s) => !s.boss);
    for (let i = 1; i < regular.length; i++) {
      expect(regular[i].rewards.gold).toBeGreaterThan(regular[i - 1].rewards.gold);
      expect(regular[i].rewards.jobExp).toBeGreaterThan(regular[i - 1].rewards.jobExp);
    }
  });

  it('каждый этап глав 2–3 играется без ошибок', () => {
    for (const s of stages.filter((x) => x.chapter !== 'chapter1')) {
      const out = playStage(clearedUpTo(s.globalIndex), s.id, s.globalIndex + 1, ctx);
      expect(['A', 'B']).toContain(out.result.winner);
      expect(out.save.battleSeq).toBe(1);
    }
  });
});
