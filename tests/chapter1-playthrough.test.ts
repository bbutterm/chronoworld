import { describe, expect, it } from 'vitest';
import { ascendHero, ascendRequirement, autoFormation, autoLevel, heroCard, newGame, playStage, summon, summonStatus, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const DAY = '2026-01-01';
const stages = ctx.content.stages.filter((s) => s.chapter === ctx.content.chapters[0].id);

/**
 * Как новый игрок после боя (то же, что scripts/playthrough.ts): Таверна (бесплатный призыв, свитки подарка открытия —
 * первый ×10 после ch1_s5, ×10 за гемы), отряд — 5 сильнейших (autoFormation), вознесение сюжетных по осколкам,
 * «Улучшить» отряда из общего пула. Баланс 27.09 (docs/content/balance.md): к Таверне на ch1_s5 глава рассчитана на
 * отряд из пяти с первым ×10 (гарант фиолетовой карточки), а не на сюжетную тройку.
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
    const ready = s.heroes.find((h) => ctx.content.heroes[h.templateId]?.source === 'story' && ascendRequirement(s, h.id, ctx)?.blockers.length === 0);
    if (!ready) break;
    s = ascendHero(s, ready.id, [], ctx).save;
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
    // Первый ×10 в Таверне — в первой сессии (подарок открытия), с гарантированной фиолетовой карточкой.
    expect(save.summon.firstTenDone).toBe(true);
    expect(save.heroes.some((h) => h.rarity === 'purple')).toBe(true);
    // Отряд к концу главы — ур. 4–8 (уровень каждые 1–2 боя; пул и золото тратятся почти до нуля).
    const squad = save.squad.flatMap((id) => save.heroes.filter((h) => h.id === id));
    expect(squad).toHaveLength(5);
    for (const h of squad) {
      expect(h.level).toBeGreaterThanOrEqual(4);
      expect(h.level).toBeLessThanOrEqual(8);
    }
    // Осколки: каждый сюжетный герой получил их за первые прохождения; Алан к боссу главы вознесён в синий (20 осколков).
    for (const t of ctx.progression.heroes.start) expect((save.shards[t] ?? 0) + (save.heroes.find((h) => h.templateId === t)!.rarity !== 'green' ? 1 : 0)).toBeGreaterThan(0);
    expect(save.heroes.find((h) => h.templateId === 'alan')!.rarity).toBe('blue');
    // После босса главы приходит новый герой (Грета — зелёная карточка).
    const start = ctx.progression.heroes.start.length;
    const joined = save.heroes.slice(start).filter((h) => ctx.content.heroes[h.templateId].source === 'story');
    expect(joined.map((h) => h.templateId)).toEqual(ctx.progression.heroes.recruits.filter((r) => stages.some((s) => s.id === r.afterStage)).map((r) => r.template));
  });

  it('босс главы: 75–88% побед с первой попытки в среднем по выдачам Таверны (16 сохранений × 16 seed)', () => {
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
    expect(rate).toBeGreaterThanOrEqual(0.75);
    expect(rate).toBeLessThanOrEqual(0.88);
  });
});
