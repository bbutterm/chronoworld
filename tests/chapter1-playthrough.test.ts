import { describe, expect, it } from 'vitest';
import { ascendHero, ascendRequirement, autoFodder, autoFormation, autoLevel, heroCard, heroCopies, heroTemplate, newGame, playStage, rarityIndex, summon, summonStatus, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const DAY = '2026-01-01';
const stages = ctx.content.stages.filter((s) => s.chapter === ctx.content.chapters[0].id);

/**
 * Как новый игрок после боя (то же, что scripts/playthrough.ts): Таверна (бесплатный призыв, свитки подарка открытия —
 * первый ×10 после ch1_s5, ×10 за гемы), отряд — 5 сильнейших (autoFormation), вознесение копиями (герои v2: цель —
 * сильнейший экземпляр героя, корм — самые слабые копии; на фиолетовом — ветка своей роли), «Улучшить» отряда из общего
 * пула. Баланс главы 1 под героев v2 — пакет V3 (docs/design/heroes-v2.md, раздел 7).
 */
function develop(s: SaveState): SaveState {
  const st = summonStatus(s, DAY, ctx);
  if (st.unlocked) {
    if (st.can.free) s = summon(s, ctx, { count: 1, pay: 'free', day: DAY }).save;
    while (s.currency.scrolls >= 10) s = summon(s, ctx, { count: 10, pay: 'scroll', day: DAY }).save;
    while (s.currency.gems >= ctx.summon.costs.ten) s = summon(s, ctx, { count: 10, pay: 'gems', day: DAY }).save;
    s = { ...s, squad: autoFormation(s, ctx) };
  }
  for (let guard = 0; guard < 10; guard++) {
    const tops = [...new Set(s.heroes.map((h) => h.templateId))].map((t) => heroCopies(s, t)[0]);
    const ready = tops.find((h) => ascendRequirement(s, h.id, ctx)?.blockers.length === 0 && autoFodder(s, h.id, ctx));
    if (!ready) break;
    const req = ascendRequirement(s, ready.id, ctx)!;
    const t = heroTemplate(ctx, ready.templateId);
    const branch = req.branch && !ready.branch ? (t.branches.find((b) => b.role === t.role) ?? t.branches[0]).job : undefined;
    s = ascendHero(s, ready.id, autoFodder(s, ready.id, ctx)!, ctx, branch ? { branch } : {}).save;
    s = { ...s, squad: autoFormation(s, ctx) };
  }
  s = autoLevel(s, ctx).save;
  s = { ...s, squad: autoFormation(s, ctx) };
  return autoLevel(s, ctx).save;
}

/** Пройти этапы главы до stopBefore (не включая), ≤ tries попыток на этап. */
function playUntil(save: SaveState, stopBefore: string | null, tries: (boss: boolean) => number, seed = { n: 1 }): { save: SaveState; stuck: string | null } {
  for (const s of stages) {
    if (s.id === stopBefore) break;
    let won = false;
    for (let t = 0; t < tries(s.boss) && !won; t++) {
      const out = playStage(save, s.id, seed.n++, ctx);
      save = develop(out.save);
      won = out.result.winner === 'A';
    }
    if (!won) return { save, stuck: s.id };
  }
  return { save, stuck: null };
}

describe('глава 1 играбельна с нуля', () => {
  it('сюжетная тройка → Таверна на ch1_s5 (первый ×10) → глава пройдена, тратя общий пул «Улучшить» (≤ 3 попытки на этап, босс — ≤ 6)', () => {
    let save: SaveState = newGame(ctx, 0);
    // Старт — Алан, Бран, Вика своими классами, без Новичков и смены профессии.
    expect(save.heroes.map((h) => heroCard(h, ctx)).map((c) => `${c.name} ${c.job} ${c.rarity.id} ${c.level}`)).toEqual([
      'Алан swordman green 1',
      'Бран archer green 1',
      'Вика acolyte green 1',
    ]);
    const out = playUntil(save, null, (boss) => (boss ? 6 : 3));
    expect(out.stuck).toBeNull();
    save = out.save;
    // Первый ×10 в Таверне — в первой сессии (подарок открытия), не меньше двух синих карт (герои v2: фиолетовой
    // гарантии больше нет — фиолетовый зарабатывается копиями).
    expect(save.summon.firstTenDone).toBe(true);
    expect(save.heroes.filter((h) => rarityIndex(h.rarity) >= rarityIndex('blue')).length).toBeGreaterThanOrEqual(2);
    // Отряд к концу главы — ур. 4–8 (уровень каждые 1–2 боя; пул и золото тратятся почти до нуля).
    const squad = save.squad.flatMap((id) => save.heroes.filter((h) => h.id === id));
    expect(squad).toHaveLength(5);
    for (const h of squad) {
      expect(h.level).toBeGreaterThanOrEqual(4);
      expect(h.level).toBeLessThanOrEqual(8);
    }
    // Копии героев из Таверны и наград уходят в вознесения: к концу главы в отряде есть синий (или выше).
    expect(squad.some((h) => rarityIndex(h.rarity) >= rarityIndex('blue'))).toBe(true);
    // После босса главы приходит новый герой (Грета) — или её копия, если она уже пришла из Таверны.
    for (const r of ctx.progression.heroes.recruits.filter((x) => stages.some((s) => s.id === x.afterStage))) {
      expect(save.heroes.some((h) => h.templateId === r.template)).toBe(true);
    }
  });

  // Герои v2, пакет V3 (docs/content/balance.md, «Герои v2»): первый ×10 больше не гарантирует фиолетовую карточку
  // (было +×1.5 силы отряда, под неё подобраны mult этапов с ch1_s6), в V1 босс с первой попытки брался в ≈27%.
  // V3 ослабил ch1_s9 (×0.94) и босса ch1_s10 (×0.9) под отряд из зелёных и синих копий: ≈68% на этих 16 выдачах
  // (≈78% на 40). Цель для обычного игрока — 60–85%: босс — проверка, а не стена, но и не формальность.
  it('босс главы: 60–85% побед с первой попытки в среднем по выдачам Таверны (16 сохранений × 16 seed)', () => {
    let wins = 0;
    let fights = 0;
    for (let k = 0; k < 16; k++) {
      const { save, stuck } = playUntil(newGame(ctx, k * 3_600_000 + 1), 'ch1_s10', () => 3);
      expect(stuck, `сохранение ${k}`).toBeNull();
      for (let j = 0; j < 16; j++) {
        fights++;
        if (playStage(save, 'ch1_s10', 100_000 + j, ctx).result.winner === 'A') wins++;
      }
    }
    const rate = wins / fights;
    expect(rate).toBeGreaterThanOrEqual(0.6);
    expect(rate).toBeLessThanOrEqual(0.85);
  });
});
