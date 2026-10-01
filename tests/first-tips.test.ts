import { describe, expect, it } from 'vitest';
import { TIPS, type TipId } from '../src/game/tipTexts';
import { HINT_TEXT, type HintId } from '../src/game/hints';
import { breaksCharge } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();

describe('подсказки первого входа (firstTips.ts)', () => {
  it('пять подсказок: русский текст на 2–3 строки (≤ 135 символов), без «нажмите», спикер есть в сюжете', () => {
    const ids = Object.keys(TIPS) as TipId[];
    expect(ids.sort()).toEqual(['tip_boss_charge', 'tip_evening', 'tip_expedition', 'tip_hunt', 'tip_tower']);
    const speakers = new Set(Object.values(ctx.story.chapters).flatMap((ch) => Object.keys(ch.speakers)));
    for (const id of ids) {
      const t = TIPS[id];
      expect(t.text, id).toMatch(/[а-яё]/i);
      expect(t.text.length, id).toBeLessThanOrEqual(135);
      expect(t.text, id).not.toMatch(/нажм|кнопк/i);
      expect(speakers.has(t.speaker), `${id}: ${t.speaker}`).toBe(true);
      // Запоминается в общем списке подсказок обучения (hints.ts).
      expect(HINT_TEXT[id as HintId], id).toBeTruthy();
    }
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
});
