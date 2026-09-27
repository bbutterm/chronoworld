import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enemySquad, newGame, playStage, stageStatus, type SaveState } from '../src/core';
import { loadGameContext, ROOT } from '../scripts/lib/content-node';

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

  it('боссы глав 2–3: Бафомет (mob_boss2) и mob3_boss (Тёмный лорд, лист dark_lord)', () => {
    const boss = (id: string) => stages.find((s) => s.id === id)!.enemies.filter((e) => e && ctx.content.units[e.unit].kind === 'boss').map((e) => e!.unit);
    expect(boss('ch2_s10')).toEqual(['mob_boss2']);
    expect(boss('ch3_s10')).toEqual(['mob3_boss']);
    expect(ctx.content.units.mob3_boss.visual.sprite).toBe('dark_lord');
  });

  it('новые монстры глав 2–3 используют спрайты v2 и свои навыки', () => {
    // Любой лист реестра v2 (глава 3 — листы RO Рейдрика, Мимика, Гаргульи, Тёмного жреца).
    const v2 = (JSON.parse(readFileSync(join(ROOT, 'assets/sprites/sprites.json'), 'utf8')) as { sprites: { id: string }[] }).sprites.map((s) => s.id);
    for (const u of Object.values(ctx.content.units).filter((x) => /^mob[23]_/.test(x.id) && x.kind === 'monster')) {
      expect(v2).toContain(u.visual.sprite);
      expect(ctx.content.skills[u.skills.basic]).toBeDefined();
      if (u.skills.ult) expect(ctx.content.skills[u.skills.ult]).toBeDefined();
    }
  });

  it('сила врагов внутри глав 2–3 растёт без провалов: Σhp и Σatk этапа не меньше предыдущего (QA T5-21)', () => {
    for (const ch of ['chapter2', 'chapter3']) {
      const sums = stages
        .filter((s) => s.chapter === ch)
        .map((s) => {
          const en = enemySquad(s.id, ctx).filter((u) => u !== null);
          return { id: s.id, hp: en.reduce((a, u) => a + u!.stats.hp, 0), atk: en.reduce((a, u) => a + u!.stats.atk, 0) };
        });
      for (let i = 1; i < sums.length; i++) {
        expect(sums[i].hp, `${sums[i].id} Σhp`).toBeGreaterThanOrEqual(sums[i - 1].hp);
        expect(sums[i].atk, `${sums[i].id} Σatk`).toBeGreaterThanOrEqual(sums[i - 1].atk);
      }
    }
  });

  it('монстры глав 2–3 на общих листах перекрашены: не совпадают с главой 1 и друг с другом (QA T5-04, частично)', () => {
    const look = (id: string) => `${ctx.content.units[id].visual.sprite}|${ctx.content.units[id].visual.tint ?? ''}`;
    const ch1 = new Set(stages.filter((s) => s.chapter === 'chapter1').flatMap((s) => s.enemies.filter((e) => e).map((e) => look(e!.unit))));
    const later = Object.values(ctx.content.units).filter((u) => /^mob[23]_/.test(u.id) && u.kind === 'monster');
    for (const u of later) expect(ch1.has(look(u.id)), u.id).toBe(false);
    expect(new Set(later.map((u) => look(u.id))).size).toBe(later.length);
  });

  it('монстры главы 2 не на листах монстров главы 1 (кроме ивы) и не на своих листах главы 3', () => {
    const sheets = (ch: string) =>
      new Set(stages.filter((s) => s.chapter === ch).flatMap((s) => s.enemies.filter((e) => e).map((e) => e!.unit)).filter((id) => /^mob2_/.test(id)).map((id) => ctx.content.units[id].visual.sprite));
    const ch2 = sheets('chapter2');
    const ch1 = new Set(stages.filter((s) => s.chapter === 'chapter1').flatMap((s) => s.enemies.filter((e) => e).map((e) => ctx.content.units[e!.unit].visual.sprite)));
    expect([...ch2].filter((sp) => ch1.has(sp))).toEqual(['tank']);
    for (const own of ['dark_priest', 'gargoyle', 'raydric', 'mimic', 'dark_lord']) expect(ch2.has(own), own).toBe(false);
  });

  it('переход через границу глав открывает следующий этап', () => {
    expect(stageStatus(clearedUpTo(9), 'ch2_s1', ctx)).toBe('locked');
    expect(stageStatus(clearedUpTo(10), 'ch2_s1', ctx)).toBe('open');
    expect(stageStatus(clearedUpTo(20), 'ch3_s1', ctx)).toBe('open');
  });

  it('сила врагов растёт по globalIndex, награды и офлайн-доход — дальше главы 1', () => {
    const g = ctx.progression.campaign.enemyStatGrowthPerStage;
    const e = enemySquad('ch3_s1', ctx)[0]!;
    const slot = stages.find((s) => s.id === 'ch3_s1')!.enemies[0]!;
    expect(e.stats.hp).toBe(Math.round(ctx.content.units[slot.unit].stats.hp * slot.mult * Math.pow(1 + g, 20)));
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
