import { rarityIndex, type CardRarity, type SummonPay, type SummonResult, type SummonStatus } from '../core';
import { SUMMON_TENSION_MS, type SUMMON_REVEAL } from './audioCatalog';

/**
 * Таверна (H5): чистые помощники экрана призыва — без Phaser, их проверяют тесты (tests/game-tavern.test.ts).
 * Порядок и ритм показа карт, подписи кнопок, раскладка карт на столе, итог серии.
 */

export type SoundRarity = keyof typeof SUMMON_REVEAL;

/** Звук открытия по редкости карточки (audioCatalog: обычный / редкий / эпический / легендарный). */
export const SOUND_RARITY: Record<CardRarity, SoundRarity> = {
  green: 'common',
  blue: 'rare',
  purple: 'epic',
  gold: 'legendary',
  red: 'legendary',
};

/** Нарастание перед открытием карты этой редкости, мс (как у summonSound: 0 у зелёной, дольше всего у золотой/красной). */
export const tensionMs = (r: CardRarity): number => SUMMON_TENSION_MS[SOUND_RARITY[r]];

/** «Фиолетовой», «золотой»… — для «до гарантированной …». */
export const RARITY_FEM: Record<CardRarity, string> = {
  green: 'зелёной',
  blue: 'синей',
  purple: 'фиолетовой',
  gold: 'золотой',
  red: 'красной',
};

/** «Фиолетовая», «золотая»… — о карте («фиолетовая карта гарантирована»). */
export const RARITY_CARD: Record<CardRarity, string> = {
  green: 'зелёная',
  blue: 'синяя',
  purple: 'фиолетовая',
  gold: 'золотая',
  red: 'красная',
};

/** Множественное число редкостей для итога: «фиолетовых 1». */
const RARITY_PLURAL: Record<CardRarity, string> = {
  green: 'зелёных',
  blue: 'синих',
  purple: 'фиолетовых',
  gold: 'золотых',
  red: 'красных',
};

/**
 * Порядок «Открыть все» (как в AFK): сначала простые карты, самая редкая — последней; при равной редкости —
 * по месту на столе. Возвращает индексы results.
 */
export function revealOrder(results: readonly Pick<SummonResult, 'rarity'>[]): number[] {
  return results
    .map((r, i) => ({ i, k: rarityIndex(r.rarity) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.i);
}

/**
 * Какая карта серии получает нарастание (docs/design/audio.md: «нарастание — перед самой редкой картой серии»):
 * самая редкая, если она синяя и выше; иначе null (все открываются быстро). При равенстве — последняя в revealOrder.
 */
export function tensionIndex(results: readonly Pick<SummonResult, 'rarity'>[]): number | null {
  const order = revealOrder(results);
  const last = order[order.length - 1];
  if (last === undefined) return null;
  return tensionMs(results[last].rarity) > 0 ? last : null;
}

/** Шаг между переворотами простых карт в «Открыть все», мс. */
export const FLIP_STEP_MS = 180;

/**
 * Ритм «Открыть все»: когда (мс от нажатия) начать переворот каждой карты в порядке revealOrder. Простые — через
 * FLIP_STEP_MS; карта с нарастанием ждёт, пока предыдущие откроются, и ещё pause (её свою задержку даст summonSound).
 */
export function revealSchedule(results: readonly Pick<SummonResult, 'rarity'>[], pause = 350): { index: number; at: number; tension: boolean }[] {
  const t = tensionIndex(results);
  let at = 0;
  return revealOrder(results).map((index, n) => {
    const tension = index === t;
    if (n > 0) at += tension ? FLIP_STEP_MS + pause : FLIP_STEP_MS;
    return { index, at, tension };
  });
}

/** Место карты на столе: центр и размер (поле 1080 по ширине). */
export interface CardSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Раскладка карт на столе: ×1 — одна крупная по центру; ×10 — два ряда по 5 (как в AFK). centerY — середина стола.
 */
export function cardSlots(count: number, centerY: number, width = 1080): CardSlot[] {
  if (count <= 1) return [{ x: width / 2, y: centerY, w: 380, h: 540 }];
  const cols = Math.min(5, count);
  const rows = Math.ceil(count / cols);
  const w = 184;
  const h = 262;
  const gapX = 18;
  const gapY = 70;
  const out: CardSlot[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? count - row * cols : cols;
    const col = i - row * cols;
    const rowW = inRow * w + (inRow - 1) * gapX;
    const x = width / 2 - rowW / 2 + w / 2 + col * (w + gapX);
    const y = centerY + (row - (rows - 1) / 2) * (h + gapY);
    out.push({ x, y, w, h });
  }
  return out;
}

/** Подписи под картой: «Новый!» или «дубль → на слияние»; осколки сюжетного героя — отдельной строкой в итоге. */
export function resultTag(r: Pick<SummonResult, 'isNew'>): { text: string; kind: 'new' | 'dup' } {
  return r.isNew ? { text: 'Новый!', kind: 'new' } : { text: 'дубль → на слияние', kind: 'dup' };
}

/** Лучшая карта серии (для «К героям»): самая редкая, при равенстве — новая, затем первая. */
export function bestResult<T extends Pick<SummonResult, 'rarity' | 'isNew'>>(results: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const r of results) {
    if (!best) best = r;
    else {
      const d = rarityIndex(r.rarity) - rarityIndex(best.rarity);
      if (d > 0 || (d === 0 && r.isNew && !best.isNew)) best = r;
    }
  }
  return best;
}

/** Итог серии одной строкой: «Фиолетовых 1 · синих 3 · зелёных 6 · новых 4 · дублей 6». */
export function summaryLine(results: readonly Pick<SummonResult, 'rarity' | 'isNew'>[]): string {
  const counts = new Map<CardRarity, number>();
  for (const r of results) counts.set(r.rarity, (counts.get(r.rarity) ?? 0) + 1);
  const parts = [...counts.entries()].sort((a, b) => rarityIndex(b[0]) - rarityIndex(a[0])).map(([r, n]) => `${RARITY_PLURAL[r]} ${n}`);
  const fresh = results.filter((r) => r.isNew).length;
  const dups = results.length - fresh;
  if (fresh) parts.push(`новых ${fresh}`);
  if (dups) parts.push(`дублей ${dups}`);
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Полоса гаранта: доля пути (0…1) и подпись «До гарантированной фиолетовой: N». */
export function pityInfo(st: Pick<SummonStatus, 'untilPity' | 'pityRarity'>, every: number): { fraction: number; label: string } {
  const done = Math.max(0, every - st.untilPity);
  return { fraction: Math.min(1, done / Math.max(1, every)), label: `До гарантированной ${RARITY_FEM[st.pityRarity]}: ${st.untilPity}` };
}

/** Кнопка призыва: подпись, сколько карт, чем платим, доступна ли. */
export interface PullOption {
  id: 'free' | 'gems1' | 'gems10' | 'scroll1' | 'scroll10';
  label: string;
  count: 1 | 10;
  pay: SummonPay;
  enabled: boolean;
}

/** Все кнопки призыва экрана (порядок — как на экране: бесплатно и свитки сверху, гемы снизу). */
export function pullOptions(st: SummonStatus): PullOption[] {
  return [
    { id: 'free', label: st.freeLeft > 0 ? 'Бесплатно' : 'Бесплатно: завтра', count: 1, pay: 'free', enabled: st.can.free },
    { id: 'scroll1', label: `Свиток ×1 (${st.scrolls})`, count: 1, pay: 'scroll', enabled: st.can.scroll1 },
    { id: 'scroll10', label: 'Свитки ×10', count: 10, pay: 'scroll', enabled: st.can.scroll10 },
    { id: 'gems1', label: `Призыв ×1 (${st.costs.single})`, count: 1, pay: 'gems', enabled: st.can.gems1 },
    { id: 'gems10', label: `Призыв ×10 (${st.costs.ten})`, count: 10, pay: 'gems', enabled: st.can.gems10 },
  ];
}

/** «Ещё ×10» в итоге: свитками, если их хватает, иначе за гемы; null — не на что (кнопка серая, тост с ценой). */
export function againOption(st: SummonStatus): PullOption | null {
  const opts = pullOptions(st);
  return opts.find((o) => o.id === 'scroll10' && o.enabled) ?? opts.find((o) => o.id === 'gems10' && o.enabled) ?? null;
}

/**
 * Значок на плитке Таверны: бесплатный призыв на сегодня и незабранный подарок открытия. Таверна закрыта — 0.
 */
export function tavernBadge(st: Pick<SummonStatus, 'unlocked' | 'freeLeft'>, welcomeGiven: boolean): number {
  if (!st.unlocked) return 0;
  return st.freeLeft + (welcomeGiven ? 0 : 1);
}

/** Шансы для окна «Шансы»: «Фиолетовый — 4%». */
export function ratesLines(rates: readonly { rarity: CardRarity; chance: number }[], names: (r: CardRarity) => string): string[] {
  return rates.map((r) => `${names(r.rarity)} — ${formatPct(r.chance)}`);
}

function formatPct(x: number): string {
  const p = Math.round(x * 1000) / 10;
  return `${String(p).replace('.', ',')}%`;
}
