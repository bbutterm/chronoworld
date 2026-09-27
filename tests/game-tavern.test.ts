import { describe, expect, it } from 'vitest';
import { actSummon, grantTavernWelcome, newGame, summonStatus, type CardRarity, type SaveState } from '../src/core';
import {
  againOption,
  bestResult,
  cardSlots,
  FLIP_STEP_MS,
  pityInfo,
  pullOptions,
  ratesLines,
  resultTag,
  revealOrder,
  revealSchedule,
  summaryLine,
  tavernBadge,
  tensionIndex,
  tensionMs,
} from '../src/game/tavern';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();
const DAY = '2026-09-27';
const cards = (...rs: CardRarity[]) => rs.map((rarity, i) => ({ rarity, isNew: i % 2 === 0 }));

/** Таверна открыта (ch1_s5 пройден), подарок выдан. */
function opened(gems = 1000): SaveState {
  const base = newGame(ctx, 1_700_000_000_000);
  const s: SaveState = { ...base, campaign: { cleared: ['ch1_s1', 'ch1_s2', 'ch1_s3', 'ch1_s4', 'ch1_s5'] }, currency: { ...base.currency, gems } };
  return s;
}

describe('Таверна: порядок и ритм показа', () => {
  it('revealOrder: простые карты раньше, самая редкая последней, при равенстве — по месту', () => {
    expect(revealOrder(cards('blue', 'green', 'purple', 'green', 'blue'))).toEqual([1, 3, 0, 4, 2]);
    expect(revealOrder([])).toEqual([]);
  });

  it('нарастание — только у самой редкой карты серии, и только если она синяя и выше', () => {
    expect(tensionIndex(cards('green', 'purple', 'blue'))).toBe(1);
    expect(tensionIndex(cards('green', 'green'))).toBeNull();
    expect(tensionIndex(cards('blue', 'green', 'blue'))).toBe(2);
    expect(tensionMs('purple')).toBeGreaterThan(tensionMs('blue'));
    expect(tensionMs('blue')).toBeGreaterThan(tensionMs('green'));
    expect(tensionMs('green')).toBe(0);
  });

  it('revealSchedule: по возрастанию времени, фиолетовая — после паузы', () => {
    const s = revealSchedule(cards('purple', 'green', 'green'), 400);
    expect(s.map((x) => x.index)).toEqual([1, 2, 0]);
    expect(s.map((x) => x.at)).toEqual([0, FLIP_STEP_MS, 2 * FLIP_STEP_MS + 400]);
    expect(s.map((x) => x.tension)).toEqual([false, false, true]);
  });

  it('первый ×10 из ядра: фиолетовая есть, и открывается последней с нарастанием', () => {
    const r = actSummon(opened(), DAY, 10, 'gems', ctx);
    const i = r.results.findIndex((x) => x.rarity === 'purple');
    expect(i).toBeGreaterThanOrEqual(0);
    const order = revealOrder(r.results);
    expect(r.results[order[order.length - 1]].rarity).toBe('purple');
    expect(r.results[tensionIndex(r.results)!].rarity).toBe('purple');
  });
});

describe('Таверна: раскладка и итог', () => {
  it('cardSlots: ×1 — одна по центру, ×10 — два ряда по 5 в пределах экрана без наложений', () => {
    expect(cardSlots(1, 900)).toEqual([{ x: 540, y: 900, w: 380, h: 540 }]);
    const s = cardSlots(10, 900);
    expect(s).toHaveLength(10);
    for (const c of s) {
      expect(c.x - c.w / 2).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w / 2).toBeLessThanOrEqual(1080);
    }
    expect(new Set(s.map((c) => c.y)).size).toBe(2);
    for (let i = 1; i < 5; i++) expect(s[i].x - s[i - 1].x).toBeGreaterThanOrEqual(s[i].w);
    expect(s[5].y - s[0].y).toBeGreaterThanOrEqual(s[0].h);
    // Ряды симметричны относительно середины стола.
    expect((s[0].y + s[5].y) / 2).toBe(900);
  });

  it('метки: новая — «Новый!», повтор — «дубль → на слияние»', () => {
    expect(resultTag({ isNew: true })).toEqual({ text: 'Новый!', kind: 'new' });
    expect(resultTag({ isNew: false }).text).toBe('дубль → на слияние');
  });

  it('bestResult: редкость важнее, при равенстве — новая', () => {
    const rs = [
      { id: 'a', rarity: 'blue' as const, isNew: false },
      { id: 'b', rarity: 'purple' as const, isNew: false },
      { id: 'c', rarity: 'purple' as const, isNew: true },
    ];
    expect(bestResult(rs)?.id).toBe('c');
    expect(bestResult([])).toBeUndefined();
  });

  it('summaryLine: редкие первыми, новые и дубли', () => {
    expect(summaryLine(cards('green', 'purple', 'green', 'blue'))).toBe('Фиолетовых 1 · синих 1 · зелёных 2 · новых 2 · дублей 2');
  });

  it('ratesLines: проценты по-русски', () => {
    expect(ratesLines(ctx.summon.rates, (r) => r)).toEqual(['green — 64%', 'blue — 32%', 'purple — 4%']);
  });
});

describe('Таверна: кнопки, гарант, значок', () => {
  it('кнопки по статусу: подписи и доступность', () => {
    const st = summonStatus(opened(300), DAY, ctx);
    const by = Object.fromEntries(pullOptions(st).map((o) => [o.id, o]));
    expect(by.gems1.label).toBe('Призыв ×1 (30)');
    expect(by.gems10.label).toBe('Призыв ×10 (270)');
    expect(by.gems10.enabled).toBe(true);
    expect(by.free.enabled).toBe(true);
    expect(by.free.label).toBe('Бесплатно');
    expect(by.scroll1.enabled).toBe(false);
    expect(againOption(st)?.id).toBe('gems10');
    expect(againOption(summonStatus(opened(100), DAY, ctx))).toBeNull();
  });

  it('после бесплатного — «Бесплатно: завтра», значок гаснет', () => {
    const r = actSummon(opened(0), DAY, 1, 'free', ctx);
    const st = summonStatus(r.save, DAY, ctx);
    expect(pullOptions(st).find((o) => o.id === 'free')).toMatchObject({ label: 'Бесплатно: завтра', enabled: false });
    expect(tavernBadge(st, true)).toBe(0);
    expect(tavernBadge(summonStatus(opened(0), DAY, ctx), true)).toBe(1);
  });

  it('значок: подарок не забран — +1; Таверна закрыта — 0', () => {
    const s = opened(0);
    expect(tavernBadge(summonStatus(s, DAY, ctx), s.summon.welcomeGiven)).toBe(2);
    const g = grantTavernWelcome(s, ctx).save;
    expect(tavernBadge(summonStatus(g, DAY, ctx), g.summon.welcomeGiven)).toBe(1);
    const closed = newGame(ctx, 0);
    expect(tavernBadge(summonStatus(closed, DAY, ctx), false)).toBe(0);
  });

  it('pityInfo: доля и подпись', () => {
    const st = summonStatus(opened(), DAY, ctx);
    expect(pityInfo(st, ctx.summon.pity.every)).toEqual({ fraction: 0, label: 'До гарантированной фиолетовой: 30' });
    expect(pityInfo({ untilPity: 10, pityRarity: 'purple' }, 30).fraction).toBeCloseTo(20 / 30);
  });
});
