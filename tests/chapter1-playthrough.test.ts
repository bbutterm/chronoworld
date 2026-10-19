import { describe, expect, it } from 'vitest';
import { ascendHero, claimOffline, ascendRequirement, autoFodder, autoFormation, autoLevel, heroCard, heroCopies, heroTemplate, newGame, playStage, rarityIndex, summon, summonStatus, type SaveState } from '../src/core';
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

/**
 * Пройти этапы главы до stopBefore (не включая), ≤ tries попыток на этап. Не прошёл — как игрок у мягкой стены
 * (глава 1 — 18 этапов, стены ch1_s15 и ch1_s17): забрать сундук за 10 минут, «Улучшить» и ещё 2 попытки, до wallMinutes
 * минут сундука. chestMinutes — сколько минут сундука понадобилось всего; firstTry — этапы, пройденные с первой попытки.
 */
function playUntil(
  save: SaveState,
  stopBefore: string | null,
  tries: (boss: boolean) => number,
  seed = { n: 1 },
  wallMinutes = 0,
): { save: SaveState; stuck: string | null; chestMinutes: number; firstTry: Set<string> } {
  let chestMinutes = 0;
  const firstTry = new Set<string>();
  for (const s of stages) {
    if (s.id === stopBefore) break;
    let won = false;
    for (let t = 0; t < tries(s.boss) && !won; t++) {
      const out = playStage(save, s.id, seed.n++, ctx);
      save = develop(out.save);
      won = out.result.winner === 'A';
      if (won && t === 0) firstTry.add(s.id);
    }
    for (let m = 10; !won && m <= wallMinutes; m += 10) {
      chestMinutes += 10;
      save = develop(claimOffline(save, save.offline.lastClaimAt + 10 * 60_000, ctx).save);
      for (let t = 0; t < 2 && !won; t++) {
        const out = playStage(save, s.id, seed.n++, ctx);
        save = develop(out.save);
        won = out.result.winner === 'A';
      }
    }
    if (!won) return { save, stuck: s.id, chestMinutes, firstTry };
  }
  return { save, stuck: null, chestMinutes, firstTry };
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
    // Первый ×10 в Таверне — в первой сессии (подарок открытия), в нём синяя карта (герои v2: фиолетовой гарантии нет —
    // фиолетовый зарабатывается копиями; пакет V3 — гарант одна синяя, было две). К концу главы синих не меньше двух:
    // гарант, синие вознесения из зелёных копий, карты этапов.
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
  // V3 ослабил ch1_s9 (×0.94) и босса ch1_s10 (×0.9) под отряд из зелёных и синих копий: ≈79% на этих 16 выдачах
  // (≈81% на 40). Решение владельца 28.09: к подарку Таверны счётчик гаранта фиолетовой уже 40/50 — первый ×10 свитками
  // всегда даёт фиолетовую; с ней босс ≈90% с первой попытки. Цель — 60–95%: босс — проверка, а не стена. Усилить босса
  // точечно нельзя без поломки QA-сидов tests/formation.test.ts (строй на боссе 1-10) — оставлено как есть.
  // Глава 1 — 18 этапов (28.09, docs/design/chapter1.md, раздел 3а): перед боссом отряд на 1–2 уровня выше, mult этапов
  // подобраны заново (ch1_s6…s10 и вставные ch1_s12…s18), босс (mult 1.10/1.11) ≈80% на этих 16 выдачах × 16 seed
  // (1.13/1.12 давали 70%, ×0.96 — 94%: кривая крутая). Мягкие стены ch1_s15 и ch1_s17 (≈90–94% в среднем, у слабых выдач
  // 0–15%) слабые выдачи (отряд без лекаря) проходят, забрав сундук, — это их модель.
  // Решение владельца 29.09: подарочного гаранта фиолетовой больше нет (welcome.purplePity убран) — без фиолетовой в первом
  // ×10 босс с mult 1.10/1.11 давал 64% на этих выдачах; босс ×0.98 (1.088/1.078) — 82% (×0.96 — 94%).
  // 19.10: золото уровней 45·L^1.5 и доход золота ×1.5 — отряд к боссу сильнее (95.3%); босс ×1.02 (1.2315/1.2201).
  it('босс главы: 60–95% побед с первой попытки в среднем по выдачам Таверны (16 сохранений × 16 seed)', () => {
    let wins = 0;
    let fights = 0;
    const chest: number[] = [];
    for (let k = 0; k < 16; k++) {
      const { save, stuck, chestMinutes, firstTry } = playUntil(newGame(ctx, k * 3_600_000 + 1), 'ch1_s10', () => 3, { n: 1 }, 240);
      expect(stuck, `сохранение ${k}`).toBeNull();
      chest.push(chestMinutes);
      // Этапы до Таверны включительно (ch1_s1…ch1_s5, 6 этапов) — обучение: у всех выдач с первой попытки.
      for (const s of stages.slice(0, 6)) expect(firstTry.has(s.id), `сохранение ${k}: ${s.id} не с первой попытки`).toBe(true);
      for (let j = 0; j < 16; j++) {
        fights++;
        if (playStage(save, 'ch1_s10', 100_000 + j, ctx).result.winner === 'A') wins++;
      }
    }
    const rate = wins / fights;
    expect(rate).toBeGreaterThanOrEqual(0.6);
    expect(rate).toBeLessThanOrEqual(0.95);
    // Стены — мягкие: большинство выдач не ждёт сундук вовсе, самая слабая — не больше 3 ч сундука за главу.
    chest.sort((a, b) => a - b);
    expect(chest[Math.floor(chest.length / 2)], `минуты сундука по выдачам: ${chest.join(', ')}`).toBe(0);
    expect(Math.max(...chest), `минуты сундука по выдачам: ${chest.join(', ')}`).toBeLessThanOrEqual(180);
  });
});
