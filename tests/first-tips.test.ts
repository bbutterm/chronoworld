import { describe, expect, it } from 'vitest';
import { TIP_MAX, TIPS, unlockTagline, type TipId } from '../src/game/tipTexts';
import { HINT_TEXT, type HintId } from '../src/game/hints';
import { placeBand } from '../src/game/hintLayout';
import { breaksCharge, runConfig } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();

describe('подсказки первого входа (firstTips.ts)', () => {
  it('пять подсказок: русский текст не длиннее двух строк (≤ TIP_MAX), без «нажмите»/«чтобы», спикер есть в сюжете', () => {
    const ids = Object.keys(TIPS) as TipId[];
    expect(ids.sort()).toEqual(['tip_boss_charge', 'tip_evening', 'tip_expedition', 'tip_hunt', 'tip_tower']);
    const speakers = new Set(Object.values(ctx.story.chapters).flatMap((ch) => Object.keys(ch.speakers)));
    for (const id of ids) {
      const t = TIPS[id];
      expect(t.text, id).toMatch(/[а-яё]/i);
      expect(TIP_MAX).toBeLessThanOrEqual(70);
      expect(t.text.length, id).toBeLessThanOrEqual(TIP_MAX);
      expect(t.text, id).not.toMatch(/нажм|кнопк|коснит|чтобы/i);
      expect(speakers.has(t.speaker), `${id}: ${t.speaker}`).toBe(true);
      // Запоминается в общем списке подсказок обучения (hints.ts).
      expect(HINT_TEXT[id as HintId], id).toBeTruthy();
    }
  });

  it('числа в описаниях режимов соответствуют действующему конфигу', () => {
    const description = (id: string) => ctx.unlocks!.features.find((f) => f.id === id)!.description;
    // В legacy tower.bossEvery осталось 5; экран Tower использует именно runConfig.
    // Число берём из самого текста: тест ловит изменение как копирайта, так и баланса.
    const bossEvery = /каждый (\d+)-й этаж/i.exec(description('tower'));
    expect(bossEvery, 'В описании Башни указан интервал боссов').not.toBeNull();
    expect(Number(bossEvery![1])).toBe(runConfig(ctx).bossEvery);
    const attempts = /(\d+) попытки в день/i.exec(description('hunt'));
    expect(attempts, 'В описании Охоты указан дневной лимит').not.toBeNull();
    expect(Number(attempts![1])).toBe(ctx.hunt.attemptsPerDay);
  });

  it('значок «сбивает заряд» — из данных навыка: есть у контрольных ульт героев и нет у ульт только с уроном', () => {
    const ults = new Set<string>();
    for (const h of Object.values(ctx.content.heroes)) {
      const hero = h as { ult?: string; branches?: { ult?: string }[] };
      if (hero.ult) ults.add(hero.ult);
      for (const b of hero.branches ?? []) if (b.ult) ults.add(b.ult);
    }
    const breaking = [...ults].filter((id) => ctx.content.skills[id] && breaksCharge(ctx.content.skills[id]));
    // battle-decisions.md §4: контрольная ульта — у части форм, не у всех.
    expect(breaking.length).toBeGreaterThan(0);
    expect(breaking.length).toBeLessThan(ults.size);
  });

  it('реплика встаёт туда, где не закрывает данные: желаемое место свободно — там же, занято — ближайшая щель', () => {
    const o = { top: 150, bottom: 1730, x: 40, w: 1000 };
    // Пусто — ровно где просили.
    expect(placeBand(200, { ...o, prefer: 600, avoid: [] })).toEqual({ y: 600, overlap: 0 });
    // Панель босса 300…1100 (подписи и кнопки) — реплика уходит под неё, а не на неё (HuntScene, P0 исследования).
    const panel = [
      { x: 60, y: 300, w: 960, h: 400 },
      { x: 60, y: 720, w: 960, h: 380 },
    ];
    const p = placeBand(200, { ...o, prefer: 800, avoid: panel });
    expect(p.overlap).toBe(0);
    expect(p.y >= 1100 || p.y + 200 <= 300).toBe(true);
    // Свободного места нет — наименьшее перекрытие, в пределах полосы.
    const full = placeBand(200, { ...o, prefer: 800, avoid: [{ x: 0, y: 150, w: 1080, h: 1580 }] });
    expect(full.y).toBeGreaterThanOrEqual(150);
    expect(full.y + 200).toBeLessThanOrEqual(1730);
  });

  it('баннер «Новая функция!»: одна строка — первая фраза описания, без точки, ≤ 2 строк', () => {
    expect(unlockTagline('Сто этажей врагов вне кампании. Каждый взятый этаж — награда.')).toBe('Сто этажей врагов вне кампании');
    expect(unlockTagline('Кузнец точит снаряжение за золото: +1 … +10. Чем выше — тем больше статов.')).toBe('Кузнец точит снаряжение за золото: +1 … +10');
    expect(unlockTagline('Без точки')).toBe('Без точки');
    expect(unlockTagline('Каждый день новый товар: снаряжение, опыт, карты героев и свитки. Платите золотом.')).toBe('Каждый день новый товар');
    const features = ctx.unlocks?.features ?? [];
    expect(features.length).toBeGreaterThan(5);
    for (const f of features) {
      const line = unlockTagline(f.description);
      expect(line.length, f.id).toBeGreaterThan(0);
      expect(line.length, f.id).toBeLessThanOrEqual(60);
    }
  });
});
