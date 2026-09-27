import type { GameContext, ProgressEvent } from '../progression/types';
import type { HeroState, SaveState } from '../save/schema';
import { activeForm, cardTrack, heroName, heroTemplate, nextRarity } from './card';
import { HeroError } from './errors';
import { findHero, levelRangeCost, type LevelCost } from './level';
import { shardCount } from './shards';
import type { CardRarity, MergeRule } from './schema';

/**
 * Вознесение карточки на следующую редкость (docs/design/heroes.md, раздел 2; правила — data/cards.json → merge):
 * призывные — кормом (копии той же карточки и карточки линии), сюжетные — осколками героя (+ уровень для второй
 * профессии). Плюс золото. Уровень цели сохраняется, предел растёт. Опыт и золото, вложенные в корм, возвращаются
 * (пул и золото), вещи корма — в инвентарь.
 */

export interface FodderSlotView {
  kind: 'same' | 'line';
  rarity: CardRarity;
  count: number;
  /** Подходящие карточки игрока (свободные), слабые первыми. */
  candidates: string[];
}

export interface AscendRequirement {
  heroId: string;
  from: CardRarity;
  to: CardRarity;
  track: MergeRule['track'];
  gold: number;
  /** Нужный уровень (сюжетные: ур. 40 для второй профессии). */
  minLevel?: number;
  /** Сюжетные: осколки героя. */
  shards?: { templateId: string; have: number; need: number };
  /** Призывные: слоты корма. */
  fodder: FodderSlotView[];
  /** Класс после вознесения, если он меняется (сюжетные на фиолетовом — вторая профессия). */
  newJob?: string;
  /** Что мешает прямо сейчас (кроме выбора корма): «не хватает золота» и т. п. Пусто — можно (при корме — если выбран). */
  blockers: string[];
}

/** Правило перехода для карточки на её редкости; null — максимум. */
export function mergeRule(hero: HeroState, ctx: GameContext): MergeRule | null {
  const t = heroTemplate(ctx, hero.templateId);
  if (hero.rarity === t.maxRarity) return null;
  const track = cardTrack(t, ctx);
  return ctx.cards.merge.find((m) => m.track === track && m.from === hero.rarity) ?? null;
}

/**
 * Почему карточку нельзя отдать в корм (null — можно): сюжетная, закреплена, в отряде, в пресете, на поручении.
 */
export function fodderBlocker(save: SaveState, fodderId: string, ctx: GameContext): string | null {
  const h = save.heroes.find((x) => x.id === fodderId);
  if (!h) return 'карточка не найдена';
  const name = heroName(h, ctx);
  if (heroTemplate(ctx, h.templateId).source === 'story') return `${name} — сюжетный герой, его нельзя отдать в корм`;
  if (h.locked) return `${name} закреплён (замок)`;
  if (save.squad.includes(h.id)) return `${name} стоит в отряде`;
  if (save.presets.some((p) => p.squad.includes(h.id))) return `${name} есть в пресете отряда`;
  if (save.bounties.active.some((b) => b.heroIds.includes(h.id))) return `${name} на поручении`;
  return null;
}

function fits(target: HeroState, fodder: HeroState, slot: { kind: 'same' | 'line'; rarity: CardRarity }, ctx: GameContext): boolean {
  if (fodder.id === target.id || fodder.rarity !== slot.rarity) return false;
  const ft = heroTemplate(ctx, fodder.templateId);
  if (ft.source !== 'summon') return false;
  if (slot.kind === 'same') return fodder.templateId === target.templateId;
  return ft.line === heroTemplate(ctx, target.templateId).line;
}

/** Слабые первыми: ниже уровень, затем больший id (новые — первыми в корм). */
function weakFirst(a: HeroState, b: HeroState): number {
  return a.level - b.level || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** Что нужно для вознесения; null — карточка на максимальной редкости. */
export function ascendRequirement(save: SaveState, heroId: string, ctx: GameContext): AscendRequirement | null {
  const hero = findHero(save, heroId);
  const rule = mergeRule(hero, ctx);
  const to = nextRarity(hero.rarity);
  if (!rule || !to) return null;
  const t = heroTemplate(ctx, hero.templateId);
  const blockers: string[] = [];
  if (save.resources.gold < rule.gold) blockers.push(`Не хватает золота: нужно ${rule.gold}, есть ${save.resources.gold}`);
  if (rule.minLevel && hero.level < rule.minLevel) blockers.push(`Нужен уровень ${rule.minLevel} (сейчас ${hero.level})`);
  let shards: AscendRequirement['shards'];
  if (rule.shards > 0) {
    const have = shardCount(save, t.id);
    shards = { templateId: t.id, have, need: rule.shards };
    if (have < rule.shards) blockers.push(`Не хватает осколков: ${have} / ${rule.shards}`);
  }
  const free = save.heroes.filter((h) => h.id !== heroId && fodderBlocker(save, h.id, ctx) === null).sort(weakFirst);
  const fodder = rule.fodder.map((f) => ({ kind: f.kind, rarity: f.rarity, count: f.count, candidates: free.filter((h) => fits(hero, h, f, ctx)).map((h) => h.id) }));
  const before = activeForm(t, hero.rarity).job;
  const after = activeForm(t, to).job;
  return { heroId, from: hero.rarity, to, track: rule.track, gold: rule.gold, ...(rule.minLevel ? { minLevel: rule.minLevel } : {}), ...(shards ? { shards } : {}), fodder, ...(after !== before ? { newJob: after } : {}), blockers };
}

/**
 * Разложить корм по слотам: сначала «та же», потом «линии». null — не подходит (не то число, не та карточка).
 */
function assignFodder(save: SaveState, hero: HeroState, rule: MergeRule, fodderIds: readonly string[], ctx: GameContext): HeroState[] | null {
  const need = rule.fodder.reduce((s, f) => s + f.count, 0);
  if (fodderIds.length !== need || new Set(fodderIds).size !== fodderIds.length) return null;
  const pool = fodderIds.map((id) => save.heroes.find((h) => h.id === id));
  if (pool.some((h) => !h)) return null;
  const left = [...(pool as HeroState[])];
  const slots = [...rule.fodder].sort((a, b) => (a.kind === 'same' ? 0 : 1) - (b.kind === 'same' ? 0 : 1));
  for (const slot of slots) {
    for (let k = 0; k < slot.count; k++) {
      // «Та же» — только тот же шаблон; «линии» — сначала другие шаблоны линии, чтобы копии той же не терялись зря.
      const i = left.findIndex((h) => fits(hero, h, slot, ctx) && (slot.kind === 'same' || h.templateId !== hero.templateId));
      const j = i >= 0 ? i : left.findIndex((h) => fits(hero, h, slot, ctx));
      if (j < 0) return null;
      left.splice(j, 1);
    }
  }
  return pool as HeroState[];
}

/** Самый слабый подходящий набор корма для вознесения (null — не хватает карточек или корм не нужен). */
export function autoFodder(save: SaveState, heroId: string, ctx: GameContext): string[] | null {
  const req = ascendRequirement(save, heroId, ctx);
  if (!req || req.fodder.length === 0) return null;
  const chosen: string[] = [];
  const slots = [...req.fodder].sort((a, b) => (a.kind === 'same' ? 0 : 1) - (b.kind === 'same' ? 0 : 1));
  const templateOf = (id: string) => save.heroes.find((h) => h.id === id)!.templateId;
  const target = findHero(save, heroId);
  for (const s of slots) {
    const cands = s.candidates.filter((id) => !chosen.includes(id));
    const ordered = s.kind === 'line' ? [...cands.filter((id) => templateOf(id) !== target.templateId), ...cands.filter((id) => templateOf(id) === target.templateId)] : cands;
    if (ordered.length < s.count) return null;
    chosen.push(...ordered.slice(0, s.count));
  }
  return chosen;
}

/**
 * Вознести карточку heroId. Призывные: fodderIds — корм (ровно по правилу). Сюжетные: fodderIds пустой, тратятся осколки.
 * HeroError: unknown_hero, max_rarity, not_enough_gold, level_required, not_enough_shards, bad_fodder, fodder_busy.
 * Событие ascended (jobChanged — сменился класс: вторая профессия сюжетного героя). Чистая функция.
 */
export function ascendHero(
  save: SaveState,
  heroId: string,
  fodderIds: readonly string[],
  ctx: GameContext,
): { save: SaveState; events: ProgressEvent[]; refund: LevelCost; consumed: string[] } {
  const hero = findHero(save, heroId);
  const t = heroTemplate(ctx, hero.templateId);
  const name = t.name;
  const rule = mergeRule(hero, ctx);
  const to = nextRarity(hero.rarity);
  if (!rule || !to) throw new HeroError('max_rarity', `${name}: максимальная редкость`);
  if (rule.minLevel && hero.level < rule.minLevel) throw new HeroError('level_required', `${name}: нужен уровень ${rule.minLevel} (сейчас ${hero.level})`);
  if (save.resources.gold < rule.gold) throw new HeroError('not_enough_gold', `Не хватает золота: нужно ${rule.gold}, есть ${save.resources.gold}`);
  if (rule.shards > 0 && shardCount(save, t.id) < rule.shards) {
    throw new HeroError('not_enough_shards', `Не хватает осколков героя ${name}: ${shardCount(save, t.id)} / ${rule.shards}`);
  }
  let consumed: HeroState[] = [];
  if (rule.fodder.length) {
    for (const id of fodderIds) {
      const why = fodderBlocker(save, id, ctx);
      if (why && save.heroes.some((h) => h.id === id)) throw new HeroError('fodder_busy', why);
    }
    const fit = assignFodder(save, hero, rule, fodderIds, ctx);
    if (!fit) throw new HeroError('bad_fodder', `${name}: корм не подходит — нужно ${rule.fodder.map((f) => `${f.count} × ${f.kind === 'same' ? 'та же карточка' : 'карточка линии'} (${f.rarity})`).join(' + ')}`);
    consumed = fit;
  } else if (fodderIds.length) throw new HeroError('bad_fodder', `${name}: корм не нужен — сюжетные герои растут осколками`);

  const refund = consumed.reduce((sum, f) => {
    const c = levelRangeCost(1, f.level, ctx);
    return { exp: sum.exp + c.exp, gold: sum.gold + c.gold };
  }, { exp: 0, gold: 0 });
  const gone = new Set(consumed.map((h) => h.id));
  const before = activeForm(t, hero.rarity).job;
  const after = activeForm(t, to).job;
  const next: SaveState = {
    ...save,
    heroes: save.heroes.filter((h) => !gone.has(h.id)).map((h) => (h.id === heroId ? { ...h, rarity: to } : h)),
    resources: { ...save.resources, gold: save.resources.gold - rule.gold + refund.gold, heroExp: save.resources.heroExp + refund.exp },
    inventory: gone.size ? { ...save.inventory, items: save.inventory.items.map((it) => (it.equippedBy && gone.has(it.equippedBy) ? { ...it, equippedBy: null } : it)) } : save.inventory,
    ...(rule.shards > 0 ? { shards: { ...save.shards, [t.id]: shardCount(save, t.id) - rule.shards } } : {}),
  };
  const events: ProgressEvent[] = [{ type: 'ascended', heroId, from: hero.rarity, to, job: after, jobChanged: after !== before }];
  if (after !== before) {
    // Навыки новой формы, уже открытые на текущем уровне.
    for (const s of activeForm(t, to).skills) if (s.level <= hero.level) events.push({ type: 'skillUnlocked', heroId, skill: s.skill, level: s.level });
  }
  return { save: next, events, refund, consumed: [...gone] };
}
