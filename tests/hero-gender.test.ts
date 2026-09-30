import { describe, expect, it } from 'vitest';
import { heroCard, heroGender, newGame, playStage, type SaveState } from '../src/core';
import { genderedSpriteId } from '../src/pipeline/sprites';
import { heroSprite } from '../src/game/flow';
import { speakerView } from '../src/game/storyView';
import { loadFullContext } from '../scripts/lib/content-node';
import { cardHero } from './helpers';

const ctx = loadFullContext();
const cfg = ctx.progression.heroes;

describe('пол героев (карточки)', () => {
  it('сюжетные герои — фиксированный пол из карточки: Алан м, Бран м, Вика ж', () => {
    const s = newGame(ctx, 1000);
    expect(s.heroes.map((h) => [heroCard(h, ctx).name, heroGender(h, ctx)])).toEqual([
      ['Алан', 'm'],
      ['Бран', 'm'],
      ['Вика', 'f'],
    ]);
  });

  it('рекруты: Грета (ж) после ch1_s10, Дорн (м) после ch2_s10 — зелёные карточки с догоняющим уровнем (RN-02)', () => {
    expect(cfg.recruits.map((r) => [r.afterStage, r.template, ctx.content.heroes[r.template].gender])).toEqual([
      ['ch1_s10', 'greta', 'f'],
      ['ch2_s10', 'dorn', 'm'],
    ]);
    let s = newGame(ctx, 1000);
    s = {
      ...s,
      heroes: s.heroes.map((h) => ({ ...h, rarity: 'blue', level: 40 })),
      campaign: { cleared: ctx.content.stages.slice(0, ctx.content.stages.findIndex((st) => st.id === 'ch1_s10')).map((st) => st.id) },
    } satisfies SaveState;
    // Рекрут приходит с первой победой на ch1_s10 — ищем seed с победой сильного отряда.
    const win = Array.from({ length: 50 }, (_, seed) => playStage(s, 'ch1_s10', seed + 1, ctx)).find((r) => r.result.winner === 'A');
    expect(win).toBeDefined();
    const greta = win!.save.heroes.find((h) => h.templateId === 'greta')!;
    // RN-02: отряд ур. 40 — Грета догоняет до предела зелёной редкости (20), уровни даром (grantedLevel).
    expect(greta).toMatchObject({ rarity: 'green', level: 20, grantedLevel: 20 });
    expect(heroGender(greta, ctx)).toBe('f');
    expect(win!.events).toContainEqual({ type: 'heroJoined', heroId: greta.id, templateId: 'greta', name: 'Грета', level: 20 });
  });

  it('лист: свой лист карточки (форма) → `<лист класса>_f/_m` → базовый лист класса', () => {
    const has = (id: string) => ['swordman_f', 'acolyte_m', 'swordman_m', 'knight_m'].includes(id);
    expect(genderedSpriteId('swordman', 'f', has)).toBe('swordman_f');
    expect(genderedSpriteId('swordman', 'm', has)).toBe('swordman_m');
    expect(genderedSpriteId('archer_first', 'f', has)).toBe('archer_first');
    expect(genderedSpriteId('acolyte', 'm', has)).toBe('acolyte_m');
    expect(genderedSpriteId('acolyte', 'f', has)).toBe('acolyte');
    // Ирис — мечница: своего листа нет, лист класса по полу.
    expect(heroSprite(cardHero(ctx, 'iris'), ctx, has)).toBe('swordman_f');
    expect(heroSprite(cardHero(ctx, 'iris'), ctx, () => false)).toBe(ctx.content.jobs.swordman.visual.sprite);
    // Тео — аколит-мужчина.
    expect(heroSprite(cardHero(ctx, 'teo'), ctx, has)).toBe('acolyte_m');
    // Алан: свой лист swordman_m; на фиолетовом с веткой Рыцарь — knight_m (лист ветки); нет листа — откат.
    // Фиолетовый без ветки — лист первой профессии.
    expect(heroSprite(cardHero(ctx, 'alan'), ctx, has)).toBe('swordman_m');
    expect(heroSprite(cardHero(ctx, 'alan/knight', 40), ctx, has)).toBe('knight_m');
    expect(heroSprite(cardHero(ctx, 'alan/knight', 40), ctx, () => false)).toBe(ctx.content.jobs.knight.visual.sprite);
    expect(heroSprite(cardHero(ctx, 'alan', 40, { rarity: 'purple' }), ctx, has)).toBe('swordman_m');
    // Ирис-Рыцарь: листа knight_f нет — лист класса Рыцаря (откат, ⚠ в content:check).
    expect(heroSprite(cardHero(ctx, 'iris/knight', 40), ctx, has)).toBe(ctx.content.jobs.knight.visual.sprite);
  });

  it('спикер-рекрут: имя Грета, пол ж по сюжетной карточке', () => {
    const story = ctx.story.chapters.chapter1;
    const v = speakerView(story, 'greta', newGame(ctx, 1000), ctx);
    expect(v.name).toBe('Грета');
    expect(v.gender).toBe('f');
    expect(v.sprite).toBe(ctx.content.jobs.novice.visual.sprite);
  });
});
