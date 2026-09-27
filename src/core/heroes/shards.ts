import type { StageInfo } from '../campaign/schema';
import type { GameContext } from '../progression/types';
import { Rng } from '../rng';
import type { SaveState } from '../save/schema';
import { heroTemplate } from './card';
import { ownedStoryTemplates, storyHero } from './roster';
import { rarityIndex } from './schema';

/**
 * Осколки сюжетных героев (как в AFK): save.shards[<шаблон>]. Тратятся на вознесение сюжетной карточки (merge.ts).
 * Источники: первое прохождение этапа кампании (герой этапа — по кругу среди сюжетных героев игрока), повтор этапа
 * (шанс), поручения и достижения (rewards.shards → shardTarget), Таверна (summon.json → storyShard).
 */

/** Сколько осколков героя templateId. */
export function shardCount(save: Pick<SaveState, 'shards'>, templateId: string): number {
  return save.shards[templateId] ?? 0;
}

/** Добавить count осколков (count ≤ 0 — тот же save). */
export function addShards(save: SaveState, templateId: string, count: number): SaveState {
  const n = Math.floor(count);
  if (!(n > 0)) return save;
  return { ...save, shards: { ...save.shards, [templateId]: shardCount(save, templateId) + n } };
}

/**
 * Чьи осколки даёт этап: сюжетные герои игрока по кругу (порядок сюжета) по номеру этапа в кампании.
 * Сюжетных героев нет — null. Видно до боя (экран подготовки этапа).
 */
export function stageShardHero(save: Pick<SaveState, 'heroes'>, stage: Pick<StageInfo, 'globalIndex'>, ctx: GameContext): string | null {
  const owned = ownedStoryTemplates(save, ctx);
  return owned.length ? owned[stage.globalIndex % owned.length] : null;
}

/** Осколки за первое прохождение этапа (без случайности): {templateId, count} или null. */
export function stageShardReward(save: Pick<SaveState, 'heroes'>, stage: Pick<StageInfo, 'globalIndex' | 'boss'>, ctx: GameContext): { templateId: string; count: number } | null {
  const templateId = stageShardHero(save, stage, ctx);
  const count = stage.boss ? ctx.cards.shards.bossFirstClear : ctx.cards.shards.firstClear;
  return templateId && count > 0 ? { templateId, count } : null;
}

/** Отдельный поток случайности для осколков повтора — от seed боя (бой и выпадение предметов его не трогают). */
function shardRng(seed: number): Rng {
  return new Rng(Math.imul((seed ^ 0x51ed27f1) >>> 0, 0x2c1b3c6d) >>> 0);
}

/** Осколки за победу на уже пройденном этапе: с шансом replayChance — replayCount (детерминированно по seed боя). */
export function replayShardCount(seed: number, ctx: GameContext): number {
  const { replayChance, replayCount } = ctx.cards.shards;
  if (replayChance <= 0 || replayCount <= 0) return 0;
  return shardRng(seed).next() < replayChance ? replayCount : 0;
}

/**
 * «Отстающий» сюжетный герой — кому идут осколки поручений, достижений и Таверны: не на максимальной редкости,
 * с самой низкой редкостью, затем с наименьшим числом осколков, затем по порядку сюжета. Все на максимуме — первый
 * по сюжету; сюжетных нет — null.
 */
export function shardTarget(save: Pick<SaveState, 'heroes' | 'shards'>, ctx: GameContext): string | null {
  const owned = ownedStoryTemplates(save, ctx);
  if (!owned.length) return null;
  const rank = owned.map((t, i) => {
    const hero = storyHero(save, t)!;
    const atMax = hero.rarity === heroTemplate(ctx, t).maxRarity;
    return { t, i, atMax, rarity: rarityIndex(hero.rarity), shards: shardCount(save, t) };
  });
  const open = rank.filter((r) => !r.atMax);
  if (!open.length) return owned[0];
  open.sort((a, b) => a.rarity - b.rarity || a.shards - b.shards || a.i - b.i);
  return open[0].t;
}
