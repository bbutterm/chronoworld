import { describe, expect, it } from 'vitest';
import { deserialize, generatedHero, heroGender, newGame, playStage, sanitizeSave, serialize, type SaveState } from '../src/core';
import { genderedSpriteId } from '../src/pipeline/sprites';
import { heroJobSprite, heroSprite } from '../src/game/flow';
import { speakerView } from '../src/game/storyView';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const cfg = ctx.progression.heroes;

describe('пол героев', () => {
  it('сюжетные герои — фиксированный пол: Алан м, Бран м, Вика ж', () => {
    const s = newGame(ctx, 1000);
    expect(s.heroes.map((h) => [h.name, h.gender])).toEqual([
      ['Алан', 'm'],
      ['Бран', 'm'],
      ['Вика', 'f'],
    ]);
  });

  it('рекруты: Грета (ж) после ch1_s10, Дорн (м) после ch2_s10', () => {
    expect(cfg.recruits.map((r) => [r.afterStage, r.name, r.gender])).toEqual([
      ['ch1_s10', 'Грета', 'f'],
      ['ch2_s10', 'Дорн', 'm'],
    ]);
    let s = newGame(ctx, 1000);
    const knight = ctx.content.jobs.knight;
    s = {
      ...s,
      heroes: s.heroes.map((h) => ({ ...h, job: knight.id, jobLevel: knight.maxJobLevel })),
      campaign: { cleared: ctx.content.stages.slice(0, 9).map((st) => st.id) },
    };
    // Рекрут приходит с первой победой на ch1_s10 — ищем seed с победой сильного отряда.
    const win = Array.from({ length: 50 }, (_, seed) => playStage(s, 'ch1_s10', seed + 1, ctx)).find((r) => r.result.winner === 'A');
    expect(win).toBeDefined();
    expect(win!.save.heroes.find((h) => h.name === 'Грета')?.gender).toBe('f');
  });

  it('несюжетные герои: пол и имя детерминированы seed сохранения, имена из пула пола', () => {
    const a = generatedHero(123456, 3, [], cfg);
    expect(generatedHero(123456, 3, [], cfg)).toEqual(a);
    expect(cfg.namePools[a.gender]).toContain(a.name);
    const genders = new Set(Array.from({ length: 40 }, (_, i) => generatedHero(1000 + i, 3, [], cfg).gender));
    expect(genders).toEqual(new Set(['m', 'f']));
    // Занятые имена пропускаются.
    const b = generatedHero(123456, 3, [a.name], cfg);
    expect(b.name).not.toBe(a.name);
    const bigger = { ...ctx, progression: { ...ctx.progression, heroes: { ...cfg, count: 5 } } };
    const s = newGame(bigger, 777);
    expect(s.heroes.slice(0, 3).map((h) => h.name)).toEqual(['Алан', 'Бран', 'Вика']);
    for (const h of s.heroes.slice(3)) expect(cfg.namePools[h.gender!]).toContain(h.name);
    expect(newGame(bigger, 777).heroes).toEqual(s.heroes);
  });

  it('миграция: пол по имени (неизвестное → м), Грег → Грета', () => {
    const base = newGame(ctx, 1000);
    const old: SaveState = {
      ...base,
      heroes: [
        { id: 'h1', name: 'Бэлла', job: 'novice', jobLevel: 1, jobExp: 0, jobHistory: [] },
        { id: 'h2', name: 'Вика', job: 'novice', jobLevel: 1, jobExp: 0, jobHistory: [] },
        { id: 'h3', name: 'Грег', job: 'novice', jobLevel: 1, jobExp: 0, jobHistory: [] },
        { id: 'h4', name: 'Кто-то', job: 'novice', jobLevel: 1, jobExp: 0, jobHistory: [] },
      ],
    };
    const { save, warnings } = sanitizeSave(deserialize(serialize(old)), ctx);
    expect(save.heroes.map((h) => [h.name, h.gender])).toEqual([
      ['Бэлла', 'f'],
      ['Вика', 'f'],
      ['Грета', 'f'],
      ['Кто-то', 'm'],
    ]);
    expect(warnings).toEqual(['Герой Грег теперь зовётся Грета.']);
    // Уже с полом — тот же объект.
    expect(sanitizeSave(base, ctx).save).toBe(base);
    expect(heroGender({ name: 'Неизвестный' }, cfg)).toBe('m');
  });

  it('лист по полу: <спрайт>_f / _m, если есть, иначе базовый', () => {
    const has = (id: string) => ['swordman_f', 'acolyte_m'].includes(id);
    expect(genderedSpriteId('swordman', 'f', has)).toBe('swordman_f');
    expect(genderedSpriteId('swordman', 'm', has)).toBe('swordman');
    expect(genderedSpriteId('acolyte', 'm', has)).toBe('acolyte_m');
    expect(genderedSpriteId('acolyte', 'f', has)).toBe('acolyte');
    expect(genderedSpriteId('archer_first', 'f', has)).toBe('archer_first');
    const vika = newGame(ctx, 1000).heroes[2];
    const sword = { ...vika, job: 'swordman' };
    expect(heroSprite(sword, ctx, has)).toBe('swordman_f');
    expect(heroSprite(sword, ctx)).toBe(ctx.content.jobs.swordman.visual.sprite);
    expect(heroJobSprite(vika, 'swordman', ctx, has)).toBe('swordman_f');
  });

  it('спикер-рекрут: имя Грета, пол ж по таблице имён', () => {
    const story = ctx.story.chapters.chapter1;
    const v = speakerView(story, 'greta', newGame(ctx, 1000), ctx);
    expect(v.name).toBe('Грета');
    expect(v.gender).toBe('f');
    expect(v.sprite).toBe(ctx.content.jobs.novice.visual.sprite);
  });
});
