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

/**
 * Гарант первого ×10 словами: одна карта — «синяя карта гарантирована» / «хотя бы одна синяя карта», несколько —
 * «не меньше 2 синих гарантированно» / «не меньше 2 синих карт» (rule — строка правил).
 */
export function firstTenText(count: number, rarity: CardRarity, rule = false): string {
  if (count === 1) return rule ? `хотя бы одна ${RARITY_CARD[rarity]} карта` : `${RARITY_CARD[rarity]} карта гарантирована`;
  return rule ? `не меньше ${count} ${RARITY_PLURAL[rarity]} карт` : `не меньше ${count} ${RARITY_PLURAL[rarity]} гарантированно`;
}

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
 * лучшая (bestResult — её же показывает момент), если она синяя и выше; иначе null (все открываются быстро).
 */
export function tensionIndex(results: readonly Pick<SummonResult, 'rarity' | 'isNew'>[]): number | null {
  const best = bestResult(results);
  if (!best) return null;
  return tensionMs(best.rarity) > 0 ? results.indexOf(best) : null;
}

/** Шаг между переворотами простых карт в «Открыть все», мс. */
export const FLIP_STEP_MS = 240;

/**
 * Ритм «Открыть все»: когда (мс от нажатия) начать переворот каждой карты в порядке revealOrder. Простые — через
 * FLIP_STEP_MS; карта с нарастанием ждёт, пока предыдущие откроются, и ещё pause (её свою задержку даст summonSound).
 */
export function revealSchedule(results: readonly Pick<SummonResult, 'rarity' | 'isNew'>[], pause = 350): { index: number; at: number; tension: boolean }[] {
  const t = tensionIndex(results);
  const order = revealOrder(results);
  // Карта с нарастанием — последней (при равной редкости лучшая может стоять раньше по месту на столе).
  if (t !== null) order.push(...order.splice(order.indexOf(t), 1));
  let at = 0;
  return order.map((index, n) => {
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

/** Метка под картой в итоге: новый герой — «Новый» (золото), копия — маленькое «+1 копия». */
export function resultTag(r: Pick<SummonResult, 'isNew'> | { kind: 'new' | 'copy' | 'loot' }): { text: string; kind: 'new' | 'copy' | 'loot' } {
  // Награда (не герой): метки нет — название и количество уже на самой карте.
  if ('kind' in r && r.kind === 'loot') return { text: '', kind: 'loot' };
  const fresh = 'kind' in r ? r.kind === 'new' : r.isNew;
  return fresh ? { text: 'Новый', kind: 'new' } : { text: '+1 копия', kind: 'copy' };
}

/**
 * Была ли карта копией героя, который уже был у игрока (тот же templateId), и сколько экземпляров героя стало.
 * heroesNow — save.heroes после призыва. Первая карта нового героя в серии — «Новый герой!», следующие такие же — копии.
 * big — крупный показ (×1): «копия · теперь ×N»; в сетке ×10 — короче («копия ×N»), чтобы не наезжать на соседей.
 * NB-12 / LT-15: N — сколько карт героя стало с этой картой (четыре Брана при трёх — ×4, ×5, ×6, ×7), а не итог серии у всех.
 */
export function copyTags(results: readonly ({ kind?: 'hero'; templateId: string } | { kind: 'loot' })[], heroesNow: readonly { templateId: string }[], big: boolean): { text: string; kind: 'new' | 'copy' | 'loot'; total: number }[] {
  const total = new Map<string, number>();
  for (const h of heroesNow) total.set(h.templateId, (total.get(h.templateId) ?? 0) + 1);
  const heroes = results.filter((r): r is { templateId: string } => r.kind !== 'loot');
  const inBatch = new Map<string, number>();
  for (const r of heroes) inBatch.set(r.templateId, (inBatch.get(r.templateId) ?? 0) + 1);
  const seen = new Map<string, number>();
  return results.map((r) => {
    if (r.kind === 'loot') return { text: '', kind: 'loot' as const, total: 0 };
    const n = total.get(r.templateId) ?? 0;
    const before = n - (inBatch.get(r.templateId) ?? 0) + (seen.get(r.templateId) ?? 0);
    seen.set(r.templateId, (seen.get(r.templateId) ?? 0) + 1);
    if (before <= 0) return { text: big ? 'Новый герой!' : 'Новый!', kind: 'new' as const, total: n };
    const k = before + 1;
    return { text: big ? `копия · теперь ×${k}` : `копия ×${k}`, kind: 'copy' as const, total: n };
  });
}

/** Лучшая карта серии (момент и нарастание): самая редкая, при равенстве — новая, затем последняя на столе. */
export function bestResult<T extends Pick<SummonResult, 'rarity' | 'isNew'> & { kind?: 'hero' | 'loot' }>(results: readonly T[]): T | undefined {
  let best: T | undefined;
  // Награды (не герои) в «лучшую карту» не идут: момент и нарастание — только у героя.
  for (const r of results) {
    if (r.kind === 'loot') continue;
    if (!best) best = r;
    else {
      const d = rarityIndex(r.rarity) - rarityIndex(best.rarity);
      if (d > 0 || (d === 0 && (r.isNew || !best.isNew))) best = r;
    }
  }
  return best;
}

/** Итог серии одной строкой: «Фиолетовых 1 · синих 3 · зелёных 6 · новых 4 · копий 6» (NB-12: «копии», не «дубли»). */
export function summaryLine(all: readonly (Pick<SummonResult, 'rarity' | 'isNew'> & { kind?: 'hero' | 'loot' })[]): string {
  const results = all.filter((r) => r.kind !== 'loot');
  const counts = new Map<CardRarity, number>();
  for (const r of results) counts.set(r.rarity, (counts.get(r.rarity) ?? 0) + 1);
  const parts = [...counts.entries()].sort((a, b) => rarityIndex(b[0]) - rarityIndex(a[0])).map(([r, n]) => `${RARITY_PLURAL[r]} ${n}`);
  const fresh = results.filter((r) => r.isNew).length;
  const dups = results.length - fresh;
  if (fresh) parts.push(`новых ${fresh}`);
  if (dups) parts.push(`копий ${dups}`);
  if (all.length > results.length) parts.push(`наград ${all.length - results.length}`);
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

/** Цена кнопки призыва: иконка (id иконки RO) и число; null — бесплатно. */
export interface PullCost {
  icon: 'scrolls' | 'gems';
  value: number;
}

/** Кнопка призыва экрана: что нажимаем (PullOption) и цена чипом. */
export interface SummonButton extends PullOption {
  cost: PullCost | null;
  free: boolean;
}

/**
 * Две кнопки призыва (как в AFK): ×1 и ×10, валюта выбирается сама — бесплатный (×1, раз в день), иначе свитки,
 * если их хватает, иначе гемы. enabled — хватает ли на этот способ (гемы не хватает — кнопка серая, нажатие объясняет тост).
 */
export function summonButtons(st: SummonStatus): { one: SummonButton; ten: SummonButton } {
  const by = Object.fromEntries(pullOptions(st).map((o) => [o.id, o])) as Record<PullOption['id'], PullOption>;
  const one: SummonButton = by.free.enabled
    ? { ...by.free, label: 'Призыв ×1', cost: null, free: true }
    : by.scroll1.enabled
      ? { ...by.scroll1, label: 'Призыв ×1', cost: { icon: 'scrolls', value: 1 }, free: false }
      : { ...by.gems1, label: 'Призыв ×1', cost: { icon: 'gems', value: st.costs.single }, free: false };
  const ten: SummonButton = by.scroll10.enabled
    ? { ...by.scroll10, label: 'Призыв ×10', cost: { icon: 'scrolls', value: 10 }, free: false }
    : { ...by.gems10, label: 'Призыв ×10', cost: { icon: 'gems', value: st.costs.ten }, free: false };
  return { one, ten };
}

/** «Ещё ×10» в итоге: свитками, если их хватает, иначе за гемы; null — не на что (кнопка серая, тост с ценой). */
export function againOption(st: SummonStatus): PullOption | null {
  const ten = summonButtons(st).ten;
  return ten.enabled ? ten : null;
}

/** Метка над ×10, пока не было первого ×10: «Синяя гарантирована» / «Гарант: 2 синих». */
export function firstTenTag(count: number, rarity: CardRarity): string {
  if (count === 1) {
    const r = RARITY_CARD[rarity];
    const name = r.charAt(0).toUpperCase() + r.slice(1);
    return `${name} гарантирована`;
  }
  return `Гарант: ${count} ${RARITY_PLURAL[rarity]}`;
}

/** Сколько ждать следующего бесплатного призыва (до полуночи игрока): «Бесплатно через 5 ч» / «… через 40 мин». */
export function freeInLabel(msLeft: number): string {
  const min = Math.max(1, Math.ceil(msLeft / 60000));
  return min >= 60 ? `Бесплатно через ${Math.ceil(min / 60)} ч` : `Бесплатно через ${min} мин`;
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
