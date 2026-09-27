import { describe, expect, it } from 'vitest';
import { autoLevel, heroCard, newGame, playStage, type SaveState } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();

describe('глава 1 играбельна с нуля', () => {
  it('сюжетная тройка (зелёные карточки ур. 1) проходит главу, тратя общий пул опыта «Улучшить» (≤ 3 попытки на этап, босс — ≤ 6: ~⅔ побед)', () => {
    let save: SaveState = newGame(ctx, 0);
    // Старт — Алан, Бран, Вика своими классами, без Новичков и смены профессии.
    expect(save.heroes.map((h) => heroCard(h, ctx)).map((c) => `${c.name} ${c.job} ${c.rarity.id} ${c.level}`)).toEqual([
      'Алан swordman green 1',
      'Бран archer green 1',
      'Вика acolyte green 1',
    ]);
    const stages = ctx.content.stages.filter((s) => s.chapter === ctx.content.chapters[0].id);
    let seed = 1;
    stages.forEach((s) => {
      let won = false;
      for (let t = 0; t < (s.boss ? 6 : 3) && !won; t++) {
        const out = playStage(save, s.id, seed++, ctx);
        save = autoLevel(out.save, ctx).save;
        won = out.result.winner === 'A';
      }
      expect(won, `${s.id} ${s.name}`).toBe(true);
    });
    const start = ctx.progression.heroes.start.length;
    // Темп как у прежней главы 1 (Новички → первая профессия ур. ~4 к боссу): к концу главы — ур. 4–8, всё ещё зелёные.
    for (const h of save.heroes.slice(0, start)) {
      expect(h.rarity).toBe('green');
      expect(h.level).toBeGreaterThanOrEqual(4);
      expect(h.level).toBeLessThanOrEqual(8);
    }
    // Осколки: каждый сюжетный герой получил их за первые прохождения.
    for (const t of ctx.progression.heroes.start) expect(save.shards[t] ?? 0).toBeGreaterThan(0);
    // После босса главы приходит новый герой (Грета — зелёная карточка) и встаёт в отряд.
    const joined = save.heroes.slice(start);
    expect(joined.map((h) => h.templateId)).toEqual(ctx.progression.heroes.recruits.filter((r) => stages.some((s) => s.id === r.afterStage)).map((r) => r.template));
    for (const h of joined) expect(save.squad).toContain(h.id);
  });
});
