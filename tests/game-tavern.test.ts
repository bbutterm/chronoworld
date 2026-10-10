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
  firstTenTag,
  firstTenText,
  freeInLabel,
  resultTag,
  revealOrder,
  revealSchedule,
  summaryLine,
  summonButtons,
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

  it('первый ×10 из ядра: синяя (или выше) есть, самая редкая открывается последней с нарастанием', () => {
    const r = actSummon(opened(), DAY, 10, 'gems', ctx);
    expect(r.results.filter((x) => x.rarity !== 'green').length).toBeGreaterThanOrEqual(ctx.summon.firstTen.count);
    const best = r.results.some((x) => x.rarity === 'purple') ? 'purple' : 'blue';
    const order = revealOrder(r.results);
    expect(r.results[order[order.length - 1]].rarity).toBe(best);
    const t = tensionIndex(r.results);
    if (best === 'purple') expect(r.results[t!].rarity).toBe('purple');
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

  it('метки итога: новая — «Новый», копия — «+1 копия»', () => {
    expect(resultTag({ isNew: true })).toEqual({ text: 'Новый', kind: 'new' });
    expect(resultTag({ isNew: false })).toEqual({ text: '+1 копия', kind: 'copy' });
    expect(resultTag({ kind: 'copy' }).text).toBe('+1 копия');
  });

  it('нарастание у лучшей карты, и она открывается последней', () => {
    // Две фиолетовые: лучшая — новая (первая по месту), она и получает нарастание — после второй фиолетовой.
    const rs = [
      { rarity: 'purple' as const, isNew: true },
      { rarity: 'green' as const, isNew: false },
      { rarity: 'purple' as const, isNew: false },
    ];
    expect(tensionIndex(rs)).toBe(0);
    const s = revealSchedule(rs);
    expect(s.map((x) => x.index)).toEqual([1, 2, 0]);
    expect(s[2].tension).toBe(true);
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
    expect(summaryLine(cards('green', 'purple', 'green', 'blue'))).toBe('Фиолетовых 1 · синих 1 · зелёных 2 · новых 2 · копий 2'); // NB-12: одно слово — «копии»
  });

  it('firstTenText: гарант первого ×10 по-русски — одна карта и несколько', () => {
    expect(firstTenText(1, 'blue')).toBe('синяя карта гарантирована');
    expect(firstTenText(1, 'blue', true)).toBe('хотя бы одна синяя карта');
    expect(firstTenText(2, 'blue')).toBe('не меньше 2 синих гарантированно');
    expect(firstTenText(2, 'purple', true)).toBe('не меньше 2 фиолетовых карт');
  });

  it('ratesLines: проценты по-русски', () => {
    // 10.10: шансы героев 30 / 12 / 0,5% (синий 5 → 12% — пересмотр 10.10; остальное — награды); дробная часть — через запятую.
    expect(ratesLines(ctx.summon.rates, (r) => r)).toEqual(['green — 30%', 'blue — 12%', 'purple — 0,5%']);
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

  it('две кнопки: ×1 — бесплатный, иначе свиток, иначе гемы; ×10 — свитки, если хватает, иначе гемы', () => {
    const st = summonStatus(opened(300), DAY, ctx);
    const b = summonButtons(st);
    expect(b.one).toMatchObject({ label: 'Призыв ×1', pay: 'free', free: true, cost: null, enabled: true });
    expect(b.ten).toMatchObject({ label: 'Призыв ×10', pay: 'gems', count: 10, cost: { icon: 'gems', value: 270 }, enabled: true });
    const after = actSummon(opened(10), DAY, 1, 'free', ctx).save;
    const poor = summonButtons(summonStatus(after, DAY, ctx));
    expect(poor.one).toMatchObject({ pay: 'gems', free: false, cost: { icon: 'gems', value: 30 }, enabled: false });
    expect(poor.ten.enabled).toBe(false);
    const scrolls = summonButtons(summonStatus({ ...after, currency: { ...after.currency, scrolls: 12 } }, DAY, ctx));
    expect(scrolls.one).toMatchObject({ pay: 'scroll', cost: { icon: 'scrolls', value: 1 }, enabled: true });
    expect(scrolls.ten).toMatchObject({ pay: 'scroll', cost: { icon: 'scrolls', value: 10 }, enabled: true });
  });

  it('метка первого ×10 и таймер бесплатного — коротко', () => {
    expect(firstTenTag(1, 'blue')).toBe('Синяя гарантирована');
    expect(firstTenTag(2, 'blue')).toBe('Гарант: 2 синих');
    expect(freeInLabel(5 * 3600_000 + 1)).toBe('Бесплатно через 6 ч');
    expect(freeInLabel(40 * 60_000)).toBe('Бесплатно через 40 мин');
    expect(freeInLabel(0)).toBe('Бесплатно через 1 мин');
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
    expect(pityInfo(st, ctx.summon.pity[0].every)).toEqual({ fraction: 0, label: 'До гарантированной синей: 10' });
    expect(pityInfo({ untilPity: 10, pityRarity: 'purple' }, 30).fraction).toBeCloseTo(20 / 30);
  });
});
