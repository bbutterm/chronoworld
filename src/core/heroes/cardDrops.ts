import type { StageInfo } from '../campaign/schema';
import type { GameContext, ProgressEvent } from '../progression/types';
import { Rng } from '../rng';
import type { SaveState } from '../save/schema';
import { summonPool } from './config';
import { addHeroCard } from './roster';
import type { CardRarity, HeroCardDrop } from './schema';

/**
 * Карты героя из источников (docs/design/heroes-v2.md, раздел 2.3; решение владельца 28.09): синие и фиолетовые
 * карты выпадают случайно — этапы кампании (data/cards.json → heroCards), сундук и быстрые награды (data/drops.json),
 * охота (data/hunt.json), поручения и достижения, Лавка, награды событий. Каждая карта — экземпляр случайного героя
 * этой редкости (равновероятно среди героев пула Таверны) с «Новый!»: копия ему в рост (корм для вознесения).
 * Заменили осколки сюжетных героев (сохранения до v6).
 */

export interface DropCounts {
  blue: number;
  purple: number;
}

/** Выпавшая карта: герой (шаблон) и редкость. */
export interface DroppedCard {
  templateId: string;
  rarity: CardRarity;
}

/** Есть ли что выдавать (ожидаемое число > 0). */
export function dropNonEmpty(d: HeroCardDrop | undefined): boolean {
  return !!d && ((d.blue ?? 0) > 0 || (d.purple ?? 0) > 0);
}

/** Ожидаемое число карт (для подсказок и баланса). */
export function dropExpectation(d: HeroCardDrop | undefined): DropCounts {
  return { blue: d?.blue ?? 0, purple: d?.purple ?? 0 };
}

/**
 * Бросок числа карт: по каждой редкости — целая часть ожидаемого числа точно, дробная — шанс ещё одной.
 * Два вызова rng.next() всегда (поток случайности не зависит от чисел в данных).
 */
export function rollDropCounts(d: HeroCardDrop | undefined, rng: Rng): DropCounts {
  const one = (x: number | undefined) => {
    const v = Math.max(0, x ?? 0);
    const whole = Math.floor(v);
    return whole + (rng.next() < v - whole ? 1 : 0);
  };
  return { blue: one(d?.blue), purple: one(d?.purple) };
}

/** Случайный герой редкости rarity (пул Таверны; пуст — null). */
export function randomHero(rarity: CardRarity, rng: Rng, ctx: GameContext): string | null {
  const pool = summonPool(ctx, rarity);
  return pool.length ? pool[rng.int(pool.length)] : null;
}

/** Бросок карт: сколько (rollDropCounts), затем для каждой — случайный герой. Синие первыми. */
export function rollHeroCards(d: HeroCardDrop | undefined, rng: Rng, ctx: GameContext): DroppedCard[] {
  return pickHeroCards(rollDropCounts(d, rng), rng, ctx);
}

/** Для уже известного числа карт — случайные герои (синие первыми). */
export function pickHeroCards(n: DropCounts, rng: Rng, ctx: GameContext): DroppedCard[] {
  const out: DroppedCard[] = [];
  for (const rarity of ['blue', 'purple'] as const) {
    for (let i = 0; i < n[rarity]; i++) {
      const templateId = randomHero(rarity, rng, ctx);
      if (templateId) out.push({ templateId, rarity });
    }
  }
  return out;
}

/**
 * Выдать карты: новые экземпляры (с «Новый!», фиолетовые — без ветки) в save.heroes. Шаблона уже нет — пропуск.
 * События heroCard (для итогов). Чистая функция.
 */
export function grantHeroCards(save: SaveState, cards: readonly DroppedCard[], ctx: GameContext): { save: SaveState; events: ProgressEvent[] } {
  let next = save;
  const events: ProgressEvent[] = [];
  for (const c of cards) {
    const t = ctx.content.heroes[c.templateId];
    if (!t) continue;
    const r = addHeroCard(next, c.templateId, c.rarity, { isNew: true });
    next = r.save;
    events.push({ type: 'heroCard', heroId: r.hero.id, templateId: c.templateId, rarity: c.rarity, name: t.name });
  }
  return { save: next, events };
}

/** Отдельный поток случайности для карт — от seed (бой и выпадение предметов его не трогают). */
export function cardRng(seed: number): Rng {
  return new Rng(Math.imul((seed ^ 0x51ed27f1) >>> 0, 0x2c1b3c6d) >>> 0);
}

/** seed по набору частей (FNV-1a) — для наград без своего seed (достижения, поручения, события). */
export function cardSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of `cards#${parts.join('#')}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Что даёт этап (ожидаемое число карт): первое прохождение обычного / босса главы или повтор. Для экрана подготовки. */
export function stageCardDrop(stage: Pick<StageInfo, 'boss'>, firstTime: boolean, ctx: GameContext): HeroCardDrop {
  const c = ctx.cards.heroCards;
  return firstTime ? (stage.boss ? c.bossFirstClear : c.firstClear) : c.replay;
}

/** Карты за победу на этапе (детерминированно по seed боя). */
export function stageHeroCards(stage: Pick<StageInfo, 'boss'>, firstTime: boolean, seed: number, ctx: GameContext): DroppedCard[] {
  return rollHeroCards(stageCardDrop(stage, firstTime, ctx), cardRng(seed), ctx);
}

/** Ожидаемое число карт → подпись «синяя карта героя: 5%» для экранов. */
export function dropText(d: HeroCardDrop | undefined): string {
  const parts: string[] = [];
  const f = (x: number) => (x >= 1 && Number.isInteger(x) ? `×${x}` : x >= 1 ? `≈${x}` : `${Math.round(x * 1000) / 10}%`);
  if ((d?.blue ?? 0) > 0) parts.push(`синяя карта героя ${f(d!.blue!)}`);
  if ((d?.purple ?? 0) > 0) parts.push(`фиолетовая карта героя ${f(d!.purple!)}`);
  return parts.join(', ');
}
