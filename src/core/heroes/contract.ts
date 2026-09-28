import type { GameContext, ProgressEvent } from '../progression/types';
import type { HeroPick, SaveState } from '../save/schema';
import { assertBranch } from './branch';
import { heroTemplate } from './card';
import { HeroError } from './errors';
import { addHeroCard } from './roster';
import { BRANCH_RARITY, rarityIndex } from './schema';

/**
 * «Контракт героя» (docs/design/heroes-v2.md, раздел 4.2): награда события — герой на выбор игрока нужной редкости
 * (у фиолетового — и ветка на выбор). grantRewards кладёт контракт в save.pendingPicks, игрок выбирает героя
 * сейчас или позже (значок на «Героях»).
 */

/** Невыбранные контракты по порядку. */
export function pendingPicks(save: Pick<SaveState, 'pendingPicks'>): HeroPick[] {
  return save.pendingPicks ?? [];
}

/** Кого можно выбрать по контракту: все герои, у которых maxRarity не ниже редкости контракта (по id). */
export function pickOptions(pick: Pick<HeroPick, 'rarity'>, ctx: GameContext): string[] {
  return Object.values(ctx.content.heroes)
    .filter((t) => rarityIndex(t.maxRarity) >= rarityIndex(pick.rarity))
    .map((t) => t.id)
    .sort();
}

/**
 * Забрать контракт index: новый экземпляр героя templateId редкости контракта, ур. 1, «Новый!». branch — ветка
 * (обязательна, если редкость ≥ фиолетовой; ниже — игнорируется). HeroError: unknown_pick, unknown_hero,
 * branch_required, bad_branch. События heroCard (+ branchChosen). Чистая функция.
 */
export function claimHeroPick(save: SaveState, index: number, templateId: string, branch: string | undefined, ctx: GameContext): { save: SaveState; heroId: string; events: ProgressEvent[] } {
  const picks = pendingPicks(save);
  const pick = picks[index];
  if (!pick) throw new HeroError('unknown_pick', 'Этот контракт героя уже использован');
  const t = ctx.content.heroes[templateId];
  if (!t || !pickOptions(pick, ctx).includes(templateId)) throw new HeroError('unknown_hero', `Героя ${templateId} нельзя выбрать по контракту`);
  const withBranch = rarityIndex(pick.rarity) >= rarityIndex(BRANCH_RARITY);
  if (withBranch && !branch) throw new HeroError('branch_required', `${t.name}: выберите ветку — ${heroTemplate(ctx, templateId).branches.map((b) => ctx.content.jobs[b.job]?.name ?? b.job).join(' или ')}`);
  if (withBranch && branch) assertBranch({ templateId }, branch, ctx);
  const added = addHeroCard(save, templateId, pick.rarity, { isNew: true });
  const heroes = withBranch && branch ? added.save.heroes.map((h) => (h.id === added.hero.id ? { ...h, branch } : h)) : added.save.heroes;
  const rest = picks.filter((_, i) => i !== index);
  const { pendingPicks: _p, ...base } = added.save;
  const next: SaveState = { ...base, heroes, ...(rest.length ? { pendingPicks: rest } : {}) };
  const events: ProgressEvent[] = [{ type: 'heroCard', heroId: added.hero.id, templateId, rarity: pick.rarity, name: t.name }];
  if (withBranch && branch) events.push({ type: 'branchChosen', heroId: added.hero.id, branch, changed: false, gems: 0 });
  return { save: next, heroId: added.hero.id, events };
}
