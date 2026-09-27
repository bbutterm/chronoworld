import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enemySquad, newGame, playStage, stageStatus, type SaveState } from '../src/core';
import { loadGameContext, ROOT } from '../scripts/lib/content-node';

const ctx = loadGameContext();
const stages = ctx.content.stages;
const clearedUpTo = (n: number): SaveState => ({ ...newGame(ctx, 0), campaign: { cleared: stages.slice(0, n).map((s) => s.id) } });

/** Главы по order и их этапы — структурные проверки идут по всем главам: новой главе хватает корректного файла data/campaign. */
const chapters = ctx.content.chapters;
const chapterStages = (id: string) => stages.filter((s) => s.chapter === id);
/** Главы, выпущенные в прод: их состав и id этапов лежат в сохранениях игроков — проверяются точно. */
const RELEASED = ['chapter1', 'chapter2', 'chapter3'];

describe('K3 главы 2–3', () => {
  it('главы идут по order без повторов; выпущенные главы 1–3 — на своих местах', () => {
    const orders = chapters.map((c) => c.order);
    orders.forEach((o, i) => i > 0 && expect(o, chapters[i].id).toBeGreaterThan(orders[i - 1]));
    expect(chapters.slice(0, RELEASED.length).map((c) => [c.id, c.order])).toEqual([
      ['chapter1', 1],
      ['chapter2', 2],
      ['chapter3', 3],
    ]);
  });

  it('этапы склеены в одну цепочку: главы по порядку, globalIndex и index без дыр, в каждой главе один босс — последний этап', () => {
    // Этапы идут главами подряд в порядке глав.
    expect([...new Set(stages.map((s) => s.chapter))]).toEqual(chapters.map((c) => c.id));
    stages.forEach((s, i) => expect(s.globalIndex).toBe(i));
    expect(new Set(stages.map((s) => s.id)).size).toBe(stages.length);
    const prefixes = new Set<string>();
    for (const c of chapters) {
      const ch = chapterStages(c.id);
      expect(ch.length, c.id).toBeGreaterThan(0);
      // id этапов главы — <префикс>_s<N> с общим префиксом (ch4_s1…; вставленный перед боссом этап — ch4_s11), префикс у главы свой.
      const prefix = /^(.+)_s\d+$/.exec(ch[0].id)?.[1];
      expect(prefix, `${c.id}: id этапов вида <префикс>_s<N>`).toBeDefined();
      expect(prefixes.has(prefix!), `${c.id}: префикс ${prefix} уже занят`).toBe(false);
      prefixes.add(prefix!);
      ch.forEach((s, i) => {
        expect(s.index).toBe(i);
        expect(s.id, s.id).toMatch(new RegExp(`^${prefix}_s\\d+$`));
        expect(s.boss, s.id).toBe(i === ch.length - 1);
      });
    }
  });

  it('выпущенные главы 1–3: ровно 10 этапов ch<N>_s1…s10 (id в сохранениях игроков)', () => {
    for (const [n, c] of RELEASED.entries()) {
      const ch = chapterStages(c);
      expect(ch.map((s) => s.id)).toEqual(Array.from({ length: 10 }, (_, i) => `ch${n + 1}_s${i + 1}`));
      ch.forEach((s, i) => expect(s.globalIndex).toBe(n * 10 + i));
    }
  });

  it('боссы глав 2–3 — мини-боссы: Древняя ива (mob2_boss, лист ивы) и Верховный жрец (mob3_boss, лист Тёмного жреца)', () => {
    const boss = (id: string) => stages.find((s) => s.id === id)!.enemies.filter((e) => e && ctx.content.units[e.unit].kind === 'boss').map((e) => e!.unit);
    expect(boss('ch2_s10')).toEqual(['mob2_boss']);
    expect(boss('ch3_s10')).toEqual(['mob3_boss']);
    expect(ctx.content.units.mob2_boss.visual.sprite).toBe('tank');
    expect(ctx.content.units.mob3_boss.visual.sprite).toBe('dark_priest');
  });

  it('в главах 1–3 нет MVP RO: листов Золотого жука, Героя орков, Бафомета, Тёмного лорда и других MVP', () => {
    const mvp = ['elite', 'boss1', 'boss2', 'dark_lord', 'osiris', 'drake', 'moonlight_flower', 'mistress'];
    for (const s of stages.filter((x) => RELEASED.includes(x.chapter)))
      for (const e of s.enemies) if (e) expect(mvp, `${s.id}: ${e.unit}`).not.toContain(ctx.content.units[e.unit].visual.sprite);
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

  it('сила врагов внутри глав 2+ растёт без провалов: Σhp и Σatk этапа не меньше предыдущего (QA T5-21)', () => {
    // Глава 1 подобрана по доле побед: у босса (Мастеринг) Σatk ниже 9-го этапа — осознанно. Все следующие главы — по правилу.
    const later = chapters.slice(1).map((c) => c.id);
    expect(later.slice(0, 2)).toEqual(['chapter2', 'chapter3']);
    for (const ch of later) {
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

  it('монстры главы 2 не на листах монстров главы 1 (кроме ивы и кузнечика) и не на своих листах главы 3', () => {
    // Ива и Рокер — перекрашены (tint, см. тест выше): Трясинная ива и Болотный кузнечик вместо жуков на листе Золотого жука.
    const sheets = (ch: string) =>
      new Set(stages.filter((s) => s.chapter === ch).flatMap((s) => s.enemies.filter((e) => e).map((e) => e!.unit)).filter((id) => /^mob2_/.test(id)).map((id) => ctx.content.units[id].visual.sprite));
    const ch2 = sheets('chapter2');
    const ch1 = new Set(stages.filter((s) => s.chapter === 'chapter1').flatMap((s) => s.enemies.filter((e) => e).map((e) => ctx.content.units[e!.unit].visual.sprite)));
    expect([...ch2].filter((sp) => ch1.has(sp)).sort()).toEqual(['rocker', 'tank']);
    for (const own of ['dark_priest', 'gargoyle', 'raydric', 'mimic', 'dark_lord']) expect(ch2.has(own), own).toBe(false);
  });

  it('переход через границу глав открывает следующий этап (на каждой границе)', () => {
    expect(stageStatus(clearedUpTo(9), 'ch2_s1', ctx)).toBe('locked');
    expect(stageStatus(clearedUpTo(10), 'ch2_s1', ctx)).toBe('open');
    expect(stageStatus(clearedUpTo(20), 'ch3_s1', ctx)).toBe('open');
    for (const c of chapters.slice(1)) {
      const first = chapterStages(c.id)[0];
      expect(stageStatus(clearedUpTo(first.globalIndex - 1), first.id, ctx), first.id).toBe('locked');
      expect(stageStatus(clearedUpTo(first.globalIndex), first.id, ctx), first.id).toBe('open');
    }
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

  it('каждый этап глав 2+ играется без ошибок', () => {
    for (const s of stages.filter((x) => x.chapter !== 'chapter1')) {
      const out = playStage(clearedUpTo(s.globalIndex), s.id, s.globalIndex + 1, ctx);
      expect(['A', 'B']).toContain(out.result.winner);
      expect(out.save.battleSeq).toBe(1);
    }
  });
});
