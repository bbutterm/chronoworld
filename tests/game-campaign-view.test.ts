import { describe, expect, it } from 'vitest';
import { campaignObjective, chestArt, chestFill, nodeLabeled } from '../src/game/campaignView';

describe('Кампания: подписи узлов и сундук', () => {
  it('цель следует сюжету и не раскрывает Грету до встречи с Бруно', () => {
    expect(campaignObjective('chapter1', [])).toContain('порингов');
    expect(campaignObjective('chapter1', [])).not.toContain('Грет');
    expect(campaignObjective('chapter1', ['ch1_s4'])).toContain('Двух колоколов');
    expect(campaignObjective('chapter1', ['ch1_s4', 'ch1_s5'])).toContain('найти Грету');
    expect(campaignObjective('chapter1', ['ch1_s15'])).toContain('вызволить Грету');
    expect(campaignObjective('chapter1', ['ch1_s15', 'ch1_s10'])).toBeNull();
    expect(campaignObjective('chapter2', ['ch1_s5'])).toBeNull();
  });
  it('название подписано только у текущего этапа и у босса', () => {
    expect(nodeLabeled('open', false)).toBe(true);
    expect(nodeLabeled('cleared', false)).toBe(false);
    expect(nodeLabeled('locked', false)).toBe(false);
    expect(nodeLabeled('locked', true)).toBe(true);
    expect(nodeLabeled('cleared', true)).toBe(true);
  });

  it('полоса сундука: «Чч ММм / лимит», доля по минутам; полон — когда ядро говорит «0 до заполнения»', () => {
    expect(chestFill(0, 12, 12 * 3_600_000)).toEqual({ frac: 0, full: false, label: '0ч 00м / 12ч' });
    const f = chestFill(125, 12, 1000);
    expect(f.label).toBe('2ч 05м / 12ч');
    expect(f.frac).toBeCloseTo(125 / 720);
    expect(chestFill(720, 12, 0)).toEqual({ frac: 1, full: true, label: 'Полон' });
    // Больше лимита не бывает, «ещё не копит» (null) — не полон.
    expect(chestFill(9999, 12, null).frac).toBe(1);
    expect(chestFill(9999, 12, null).full).toBe(false);
  });

  it('картинка сундука: пустой без дохода, полный от 90 %', () => {
    expect(chestArt(chestFill(300, 12, 1), false)).toBe('empty');
    expect(chestArt(chestFill(300, 12, 1), true)).toBe('filling');
    expect(chestArt(chestFill(650, 12, 1), true)).toBe('full');
    expect(chestArt(chestFill(720, 12, 0), true)).toBe('full');
  });
});
