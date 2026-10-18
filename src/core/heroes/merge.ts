import type { GameContext, ProgressEvent } from '../progression/types';
import type { HeroState, SaveState } from '../save/schema';
import { assertBranch, heroProfessionBlocker } from './branch';
import { activeForm, branchOf, branchOptions, heroName, heroTemplate, nextRarity, type BranchView } from './card';
import { HeroError } from './errors';
import { findHero, paidHeroTraining, type LevelCost } from './level';
import { BRANCH_RARITY, rarityIndex, type CardRarity, type FodderSlot, type MergeRule } from './schema';
import { groupDigits } from '../format';
import { rememberHeroJourney } from './training';

/**
 * Вознесение героя на следующую редкость (docs/design/heroes-v2.md, раздел 2.2; правила — data/cards.json → merge):
 * одна дорожка для всех героев — копии «того же» героя (same) и «любых» (any) нужной редкости плюс золото
 * (копии — из Таверны, сюжета и карт героя из наград, cardDrops.ts). На переходе с branch: true игрок выбирает ветку второй профессии. Уровень цели сохраняется; опыт и золото,
 * вложенные в корм, возвращаются (пул и золото), вещи корма — в инвентарь.
 */

export interface FodderSlotView {
  kind: 'same' | 'any';
  rarity: CardRarity;
  count: number;
  /** Подходящие экземпляры игрока (свободные), слабые первыми. */
  candidates: string[];
}

export interface AscendRequirement {
  heroId: string;
  from: CardRarity;
  to: CardRarity;
  gold: number;
  fodder: FodderSlotView[];
  /** На этом переходе выбирается ветка (показать две карточки веток). */
  branch: boolean;
  /** Ветки на выбор (только при branch). */
  branches?: BranchView[];
  /** Что мешает прямо сейчас (кроме выбора корма): «не хватает золота» и т. п. Пусто — можно (при выбранном корме). */
  blockers: string[];
}

export interface AscendOptions {
  /** Ветка второй профессии (обязательна на переходе с branch: true, если у героя её ещё нет). */
  branch?: string;
  /**
   * Не требовать ветку на переходе с branch: true — герой станет фиолетовым без ветки («Выберите ветку!», выбор
   * бесплатный, branch.ts chooseBranch). Так возносит «Вознести всех» (ascendAll).
   */
  deferBranch?: boolean;
}

/** Правило перехода для героя на его редкости; null — максимум. */
export function mergeRule(hero: HeroState, ctx: GameContext): MergeRule | null {
  const t = heroTemplate(ctx, hero.templateId);
  if (hero.rarity === t.maxRarity) return null;
  return ctx.cards.merge.find((m) => m.from === hero.rarity) ?? null;
}

/** Почему экземпляр нельзя отдать в корм (null — можно): закреплён, в отряде/Башне, в пресете, в экспедиции. */
export function fodderBlocker(save: SaveState, fodderId: string, ctx: GameContext): string | null {
  const h = save.heroes.find((x) => x.id === fodderId);
  if (!h) return 'карточка не найдена';
  const name = heroName(h, ctx);
  if (h.locked) return `${name} закреплён (замок)`;
  if (save.squad.includes(h.id)) return `${name} стоит в отряде`;
  if (save.presets.some((p) => p.squad.includes(h.id))) return `${name} есть в пресете отряда`;
  if (save.bounties.active.some((b) => b.heroIds.includes(h.id))) return `${name} в экспедиции`;
  const towerRun = save.tower.run;
  if (towerRun?.squad.includes(h.id) || towerRun?.fallen.includes(h.id)) return `${name} участвует в забеге Башни — сначала завершите забег`;
  const paid = paidHeroTraining(h, ctx);
  if (paid.exp > 0 || paid.gold > 0) return `${name} обучен: сначала верните вложенные ресурсы`;
  if (h.journey?.focus) return `${name} выбрал специализацию тренировки`;
  return null;
}

function fits(target: HeroState, fodder: HeroState, slot: Pick<FodderSlot, 'kind' | 'rarity'>): boolean {
  if (fodder.id === target.id || fodder.rarity !== slot.rarity) return false;
  return slot.kind === 'any' || fodder.templateId === target.templateId;
}

/** Слабые первыми: ниже уровень, затем больший id (новые — первыми в корм). */
function weakFirst(a: HeroState, b: HeroState): number {
  return a.level - b.level || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** Слоты правила по одному: сначала «та же», потом «любая». */
function slotList(rule: MergeRule): Pick<FodderSlot, 'kind' | 'rarity'>[] {
  const out: Pick<FodderSlot, 'kind' | 'rarity'>[] = [];
  for (const kind of ['same', 'any'] as const) for (const f of rule.fodder) if (f.kind === kind) for (let i = 0; i < f.count; i++) out.push({ kind, rarity: f.rarity });
  return out;
}

/** Свободные экземпляры (кроме цели), слабые первыми. */
function freeHeroes(save: SaveState, heroId: string, ctx: GameContext, withCompanions = false): HeroState[] {
  // Спутник — корм только по выбору игрока (кандидаты ascendRequirement); «Авто», цепочки и «Вознести всех» его не берут.
  return save.heroes.filter((h) => h.id !== heroId && (withCompanions || !h.companion) && fodderBlocker(save, h.id, ctx) === null).sort(weakFirst);
}

/** Что нужно для вознесения; null — герой на максимальной редкости. */
export function ascendRequirement(save: SaveState, heroId: string, ctx: GameContext): AscendRequirement | null {
  const hero = findHero(save, heroId);
  const rule = mergeRule(hero, ctx);
  const to = nextRarity(hero.rarity);
  if (!rule || !to) return null;
  const blockers: string[] = [];
  const busy = heroProfessionBlocker(save, heroId);
  if (busy) blockers.push(busy);
  if (save.resources.gold < rule.gold) blockers.push(`Не хватает золота: нужно ${groupDigits(rule.gold)}, есть ${groupDigits(save.resources.gold)}`);
  const free = freeHeroes(save, heroId, ctx, true);
  const fodder = rule.fodder.map((f) => ({ kind: f.kind, rarity: f.rarity, count: f.count, candidates: free.filter((h) => fits(hero, h, f)).map((h) => h.id) }));
  const branch = !!rule.branch;
  return {
    heroId,
    from: hero.rarity,
    to,
    gold: rule.gold,
    fodder,
    branch,
    ...(branch ? { branches: branchOptions(hero.templateId, ctx) } : {}),
    blockers,
  };
}

/** Разложить корм по слотам: копии того же героя — сначала в слоты «та же», остальное — в «любая». null — не подходит. */
function assignFodder(save: SaveState, hero: HeroState, rule: MergeRule, fodderIds: readonly string[]): HeroState[] | null {
  if (new Set(fodderIds).size !== fodderIds.length) return null;
  const pool = fodderIds.map((id) => save.heroes.find((h) => h.id === id));
  if (pool.some((h) => !h)) return null;
  const heroes = pool as HeroState[];
  const open = slotList(rule);
  if (heroes.length !== open.length) return null;
  const place = (h: HeroState, kind: 'same' | 'any') => {
    const i = open.findIndex((s) => s.kind === kind && fits(hero, h, s));
    if (i < 0) return false;
    open.splice(i, 1);
    return true;
  };
  for (const h of heroes) if (!place(h, 'same') && !place(h, 'any')) return null;
  return heroes;
}

/** «Авто»: самые слабые подходящие свободные копии на слоты вознесения. */
export interface AscendPlan {
  /** Корм (id экземпляров) по слотам. */
  fodder: string[];
  /** Все слоты закрыты. */
  complete: boolean;
  /** Слотов, которые нечем закрыть (не хватает копий). */
  missing: number;
}

/** «Авто»: самые слабые подходящие свободные копии (null — герой на максимуме). */
export function ascendPlan(save: SaveState, heroId: string, ctx: GameContext): AscendPlan | null {
  const hero = findHero(save, heroId);
  const rule = mergeRule(hero, ctx);
  if (!rule) return null;
  const free = freeHeroes(save, heroId, ctx);
  const chosen: string[] = [];
  let missing = 0;
  for (const s of slotList(rule)) {
    // «Любая» — сначала копии других героев, чтобы копии того же не уходили зря.
    const cands = free.filter((h) => !chosen.includes(h.id) && fits(hero, h, s));
    const pick = s.kind === 'any' ? (cands.find((h) => h.templateId !== hero.templateId) ?? cands[0]) : cands[0];
    if (pick) chosen.push(pick.id);
    else missing++;
  }
  return { fodder: chosen, complete: missing === 0, missing };
}

/** Самый слабый набор копий на все слоты; null — не хватает копий. */
export function autoFodder(save: SaveState, heroId: string, ctx: GameContext): string[] | null {
  const p = ascendPlan(save, heroId, ctx);
  return p && p.complete ? p.fodder : null;
}

/** Хватает ли копий (и золота) на вознесение прямо сейчас (ветку выберут на экране). */
export function canAscend(save: SaveState, heroId: string, ctx: GameContext): boolean {
  const req = ascendRequirement(save, heroId, ctx);
  if (!req || req.blockers.length) return false;
  return !!ascendPlan(save, heroId, ctx)?.complete;
}

/**
 * Цепочка «Авто» (раздел 5): свободные копии того же героя редкостью ниже нужной сливаются вверх (3 зелёные → синяя),
 * чтобы закрыть слоты «та же» вознесения heroId. Шаги — вознесения других экземпляров (ascendHero по порядку);
 * переходы с выбором ветки цепочка не делает. Пусто — сливать нечего.
 */
export function autoChain(save: SaveState, heroId: string, ctx: GameContext): { targetId: string; fodderIds: string[] }[] {
  const steps: { targetId: string; fodderIds: string[] }[] = [];
  let cur = save;
  for (let guard = 0; guard < 20; guard++) {
    const hero = findHero(cur, heroId);
    const rule = mergeRule(hero, ctx);
    if (!rule) break;
    const plan = ascendPlan(cur, heroId, ctx);
    if (!plan || plan.complete) break;
    const need = rule.fodder.find((f) => f.kind === 'same');
    if (!need) break;
    // Копии того же героя на одну редкость ниже слота, не выбранные в корм.
    const lower = ctx.cards.merge.find((m) => m.to === need.rarity);
    if (!lower || lower.branch) break;
    const copies = freeHeroes(cur, heroId, ctx).filter((h) => h.templateId === hero.templateId && h.rarity === lower.from);
    // Цель цепочки — сильнейшая из копий, корм — остальные слабые.
    const target = [...copies].sort(weakFirst).at(-1);
    if (!target) break;
    const sub = autoFodder(cur, target.id, ctx);
    if (!sub || sub.includes(heroId)) break;
    try {
      cur = ascendHero(cur, target.id, sub, ctx).save;
    } catch {
      break;
    }
    steps.push({ targetId: target.id, fodderIds: sub });
  }
  return steps;
}

/**
 * Вознести героя heroId: fodderIds — копии (ровно по правилу), opts.branch — ветка (обязательна на переходе
 * с branch: true, если ветки ещё нет). HeroError: unknown_hero, max_rarity, not_enough_gold, bad_fodder, fodder_busy,
 * branch_required, bad_branch. События ascended (+ branchChosen и skillUnlocked навыков новой формы). Чистая функция.
 */
export function ascendHero(
  save: SaveState,
  heroId: string,
  fodderIds: readonly string[],
  ctx: GameContext,
  opts: AscendOptions = {},
): { save: SaveState; events: ProgressEvent[]; refund: LevelCost; consumed: string[] } {
  const hero = findHero(save, heroId);
  const busy = heroProfessionBlocker(save, heroId);
  if (busy) throw new HeroError('hero_busy', busy);
  const t = heroTemplate(ctx, hero.templateId);
  const name = t.name;
  const rule = mergeRule(hero, ctx);
  const to = nextRarity(hero.rarity);
  if (!rule || !to) throw new HeroError('max_rarity', `${name}: максимальная редкость`);
  if (save.resources.gold < rule.gold) throw new HeroError('not_enough_gold', `Не хватает золота: нужно ${groupDigits(rule.gold)}, есть ${groupDigits(save.resources.gold)}`);
  if (opts.branch !== undefined) assertBranch(hero, opts.branch, ctx);
  // Выбранная ветка не меняется вознесением (смена — branch.ts changeBranch); opts.branch действует, только если ветки
  // ещё нет и новая редкость — фиолетовая или выше.
  const keepBranch = branchOf(t, hero.branch)?.job
    ?? (rarityIndex(to) >= rarityIndex(BRANCH_RARITY) ? branchOf(t, hero.journey?.lastBranch)?.job : undefined);
  const branch = keepBranch ?? (rarityIndex(to) >= rarityIndex(BRANCH_RARITY) ? opts.branch : undefined);
  if (rule.branch && !branch && !opts.deferBranch) throw new HeroError('branch_required', `${name}: выберите ветку — ${t.branches.map((b) => ctx.content.jobs[b.job]?.name ?? b.job).join(' или ')}`);
  for (const id of fodderIds) {
    if (id === heroId) throw new HeroError('bad_fodder', `${name}: герой не может быть кормом сам себе`);
  }
  const consumed = assignFodder(save, hero, rule, fodderIds);
  if (!consumed) {
    const rn = (r: CardRarity) => ctx.cards.rarities.find((x) => x.id === r)?.name.toLowerCase() ?? r;
    throw new HeroError('bad_fodder', `${name}: корм не подходит — нужно ${rule.fodder.map((f) => `${f.count} × ${f.kind === 'same' ? name : 'любой герой'} (${rn(f.rarity)})`).join(' + ')}`);
  }
  for (const fodder of consumed) {
    const why = fodderBlocker(save, fodder.id, ctx);
    if (why) throw new HeroError('fodder_busy', why);
  }
  const refund = consumed.reduce((sum, f) => {
    const c = paidHeroTraining(f, ctx);
    return { exp: sum.exp + c.exp, gold: sum.gold + c.gold };
  }, { exp: 0, gold: 0 });
  const gone = new Set(consumed.map((h) => h.id));
  const before = activeForm(t, hero);
  const upgraded: HeroState = branch && branch !== hero.branch
    ? rememberHeroJourney({ ...hero, rarity: to, branch })
    : { ...hero, rarity: to };
  const after = activeForm(t, upgraded);
  // Спутник ушёл в корм — звание переходит к лучшей оставшейся карте того же героя (цель — первой); не осталось
  // карт — следующая полученная станет спутником сама (roster.ts addHeroCard).
  let heroes = save.heroes.filter((h) => !gone.has(h.id)).map((h) => (h.id === heroId ? upgraded : h));
  for (const lost of consumed.filter((h) => h.companion)) {
    if (heroes.some((h) => h.templateId === lost.templateId && h.companion)) continue;
    const heir = heroes
      .filter((h) => h.templateId === lost.templateId)
      .sort((a, b) => Number(b.id === heroId) - Number(a.id === heroId) || rarityIndex(b.rarity) - rarityIndex(a.rarity) || b.level - a.level || (a.id < b.id ? -1 : 1))[0];
    if (heir) heroes = heroes.map((h) => (h.id === heir.id ? { ...h, companion: true } : h));
  }
  const next: SaveState = {
    ...save,
    heroes,
    resources: { ...save.resources, gold: save.resources.gold - rule.gold + refund.gold, heroExp: save.resources.heroExp + refund.exp },
    inventory: gone.size ? { ...save.inventory, items: save.inventory.items.map((it) => (it.equippedBy && gone.has(it.equippedBy) ? { ...it, equippedBy: null } : it)) } : save.inventory,
  };
  const jobChanged = after.job !== before.job;
  const events: ProgressEvent[] = [{ type: 'ascended', heroId, from: hero.rarity, to, job: after.job, jobChanged }];
  if (branch && !hero.branch && after.branch) events.push({ type: 'branchChosen', heroId, branch, changed: false, gems: 0 });
  if (jobChanged) {
    // Навыки новой формы, уже открытые на текущем уровне.
    for (const s of after.skills) if (s.level <= hero.level) events.push({ type: 'skillUnlocked', heroId, skill: s.skill, level: s.level });
  }
  return { save: next, events, refund, consumed: [...gone] };
}

/**
 * Лучший экземпляр каждого героя (выше редкость, в отряде, выше уровень, меньший id) — его «Вознести всех» не отдаёт в
 * корм слотов «любой».
 */
export function keeperIds(save: Pick<SaveState, 'heroes' | 'squad'>): Set<string> {
  const best = new Map<string, HeroState>();
  const better = (a: HeroState, b: HeroState) =>
    Number(!!a.companion) - Number(!!b.companion) ||
    Number(!!a.locked) - Number(!!b.locked) ||
    Number(!!a.journey?.focus) - Number(!!b.journey?.focus) ||
    rarityIndex(a.rarity) - rarityIndex(b.rarity) ||
    Number(save.squad.includes(a.id)) - Number(save.squad.includes(b.id)) ||
    a.level - b.level ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  for (const h of save.heroes) {
    const cur = best.get(h.templateId);
    if (!cur || better(h, cur) > 0) best.set(h.templateId, h);
  }
  return new Set([...best.values()].map((h) => h.id));
}

/**
 * Бронь слотов «та же» для «Вознести всех»: герои, которые могут вознестись прямо сейчас (не заняты профессией, хватает
 * золота) и у которых все слоты «та же» закрываются свободными копиями. fodder — самые слабые такие копии.
 */
function sameClaims(save: SaveState, heroes: readonly HeroState[], ctx: GameContext): { heroId: string; rarity: CardRarity; fodder: string[] }[] {
  const out: { heroId: string; rarity: CardRarity; fodder: string[] }[] = [];
  for (const hero of heroes) {
    const rule = mergeRule(hero, ctx);
    if (!rule || save.resources.gold < rule.gold || heroProfessionBlocker(save, hero.id)) continue;
    const slots = slotList(rule).filter((x) => x.kind === 'same');
    if (!slots.length) continue;
    const free = freeHeroes(save, hero.id, ctx);
    const chosen: string[] = [];
    for (const slot of slots) {
      const pick = free.find((h) => !chosen.includes(h.id) && fits(hero, h, slot));
      if (!pick) break;
      chosen.push(pick.id);
    }
    if (chosen.length === slots.length) out.push({ heroId: hero.id, rarity: hero.rarity, fodder: chosen });
  }
  return out;
}

/**
 * Какие вознесения из targetIds возможны одновременно — без общего корма и с общим золотом (значок «Герои»).
 * Порядок targetIds — приоритет. Сначала по порядку закрываются дефицитные слоты «та же», затем слоты «любой» (копии
 * других героев первыми) и золото; цель не идёт в корм другой цели. Каждая копия — не больше чем в одно вознесение.
 */
export function ascendAllocation(save: SaveState, targetIds: readonly string[], ctx: GameContext): { heroId: string; fodder: string[] }[] {
  const targets = targetIds.filter((id, i) => targetIds.indexOf(id) === i && save.heroes.some((h) => h.id === id && ctx.content.heroes[h.templateId]));
  const isTarget = new Set(targets);
  const used = new Set<string>();
  const take = (hero: HeroState, slots: Pick<FodderSlot, 'kind' | 'rarity'>[], free: HeroState[]): string[] | null => {
    const chosen: string[] = [];
    for (const slot of slots) {
      const cands = free.filter((h) => !used.has(h.id) && !isTarget.has(h.id) && !chosen.includes(h.id) && fits(hero, h, slot));
      const pick = slot.kind === 'any' ? (cands.find((h) => h.templateId !== hero.templateId) ?? cands[0]) : cands[0];
      if (!pick) return null;
      chosen.push(pick.id);
    }
    return chosen;
  };
  const stage1: { hero: HeroState; rule: MergeRule; same: string[]; free: HeroState[] }[] = [];
  for (const id of targets) {
    const req = ascendRequirement(save, id, ctx);
    if (!req || req.blockers.length) continue;
    const hero = findHero(save, id);
    const rule = mergeRule(hero, ctx)!;
    const free = freeHeroes(save, id, ctx);
    const same = take(hero, slotList(rule).filter((x) => x.kind === 'same'), free);
    if (!same) continue;
    for (const f of same) used.add(f);
    stage1.push({ hero, rule, same, free });
  }
  const out: { heroId: string; fodder: string[] }[] = [];
  let gold = save.resources.gold;
  for (const { hero, rule, same, free } of stage1) {
    const any = gold >= rule.gold ? take(hero, slotList(rule).filter((x) => x.kind === 'any'), free) : null;
    if (!any) {
      for (const f of same) used.delete(f);
      continue;
    }
    for (const f of any) used.add(f);
    gold -= rule.gold;
    out.push({ heroId: hero.id, fodder: [...same, ...any] });
  }
  return out;
}

/** Одно вознесение «Вознести всех». */
export interface AscendAllStep {
  heroId: string;
  templateId: string;
  name: string;
  from: CardRarity;
  to: CardRarity;
  /** Стал фиолетовым без ветки — игрок выберет её на карточке («Выберите ветку!»). */
  branchPending: boolean;
  /** Съеденные копии (id экземпляров). */
  consumed: string[];
}

/**
 * «Вознести всех» (экран «Герои»): по кругу возносит всех, кому хватает свободных копий и золота, — сначала дешёвые
 * переходы (зелёные → синие), чтобы их итог шёл в корм следующих. Цель — сильнейший экземпляр своей редкости (в отряде —
 * первым, затем выше уровень), корм — самые слабые свободные копии (fodderBlocker: не отряд, не пресет, не экспедиция,
 * не замок). Слоты «та же» — копии того же героя. Слоты «любой» (золотой → красный, BUG-168) — сначала лишние копии
 * того же героя, затем лишние копии других героев: лучший экземпляр каждого героя (keeperIds) в корм не идёт никогда,
 * так что «Вознести всех» не убирает героя из коллекции. Свои вознесения других героев идут раньше (они дешевле), и
 * их копии уходят сначала на них. Дефицитные слоты «та же» бронируются (sameClaims): копии, которые закрывают «та же»
 * другого героя (золотой → красный, синий → фиолетовый), не идут ни в «любой», ни целью дешёвого перехода — пока тот
 * герой может вознестись. Переход с выбором ветки — без ветки (deferBranch; уже выбранная сохраняется).
 * Чистая функция; пусто — нечего.
 */
export function ascendAll(save: SaveState, ctx: GameContext): { save: SaveState; events: ProgressEvent[]; done: AscendAllStep[] } {
  let cur = save;
  const events: ProgressEvent[] = [];
  const done: AscendAllStep[] = [];
  const order = (s: SaveState) => (a: HeroState, b: HeroState) =>
    rarityIndex(a.rarity) - rarityIndex(b.rarity) ||
    Number(!!b.companion) - Number(!!a.companion) ||
    Number(s.squad.includes(b.id)) - Number(s.squad.includes(a.id)) ||
    b.level - a.level ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Каждое вознесение убирает хотя бы одну карточку — цикл конечен; guard — на всякий случай.
  for (let guard = 0; guard < 1000; guard++) {
    const s = cur;
    const keep = keeperIds(s);
    const heroes = [...s.heroes].filter((h) => ctx.content.heroes[h.templateId]).sort(order(s));
    const claims = sameClaims(s, heroes, ctx);
    const pickStep = (reserve: boolean): { hero: HeroState; fodder: string[]; to: CardRarity } | null => {
      for (const hero of heroes) {
        if (heroProfessionBlocker(s, hero.id)) continue;
        const rule = mergeRule(hero, ctx);
        const to = nextRarity(hero.rarity);
        if (!rule || !to || s.resources.gold < rule.gold) continue;
        // Копии, нужные слотам «та же» другого героя (другой редкости), который может вознестись прямо сейчас, — не трогаем:
        // ни целью, ни кормом. Иначе дешёвый «любой» (фиолетовый → золотой) съест копии золотого → красного.
        const reserved = new Set<string>();
        if (reserve) for (const c of claims) if (c.heroId !== hero.id && c.rarity !== hero.rarity) for (const id of c.fodder) reserved.add(id);
        if (reserved.has(hero.id)) continue;
        const all = freeHeroes(s, hero.id, ctx).filter((h) => !reserved.has(h.id));
        // Сначала копии того же героя, затем лишние копии других (не лучший экземпляр своего героя); слабые первыми.
        const free = [...all.filter((h) => h.templateId === hero.templateId), ...all.filter((h) => h.templateId !== hero.templateId && !keep.has(h.id))];
        const chosen: string[] = [];
        let ok = true;
        for (const slot of slotList(rule)) {
          const pick = free.find((h) => !chosen.includes(h.id) && fits(hero, h, slot));
          if (!pick) {
            ok = false;
            break;
          }
          chosen.push(pick.id);
        }
        if (ok) return { hero, fodder: chosen, to };
      }
      return null;
    };
    // Без брони — только если с бронёй не вышло ничего (страховка: бронь дают лишь те, кто сам может вознестись).
    const step = pickStep(true) ?? (claims.length ? pickStep(false) : null);
    if (!step) break;
    const r = ascendHero(s, step.hero.id, step.fodder, ctx, { deferBranch: true });
    cur = r.save;
    events.push(...r.events);
    const after = findHero(cur, step.hero.id);
    const t = heroTemplate(ctx, after.templateId);
    done.push({
      heroId: after.id,
      templateId: after.templateId,
      name: t.name,
      from: step.hero.rarity,
      to: step.to,
      branchPending: rarityIndex(after.rarity) >= rarityIndex(BRANCH_RARITY) && !branchOf(t, after.branch),
      consumed: r.consumed,
    });
  }
  return { save: cur, events, done };
}

/**
 * Итог «Вознести всех» по героям (для окна подтверждения и тоста): у каждого экземпляра — первая и последняя
 * редкость цепочки («Вика: зелёная → фиолетовая»), порядок — первого вознесения.
 */
export function ascendAllSummary(done: readonly AscendAllStep[]): { heroId: string; name: string; from: CardRarity; to: CardRarity; branchPending: boolean }[] {
  const out = new Map<string, { heroId: string; name: string; from: CardRarity; to: CardRarity; branchPending: boolean }>();
  const eaten = new Set(done.flatMap((d) => d.consumed));
  for (const d of done) {
    const g = out.get(d.heroId);
    if (g) {
      g.to = d.to;
      g.branchPending = d.branchPending;
    } else out.set(d.heroId, { heroId: d.heroId, name: d.name, from: d.from, to: d.to, branchPending: d.branchPending });
  }
  // Промежуточные ступени (синяя из зелёных, съеденная потом в фиолетовую) — не отдельной строкой.
  return [...out.values()].filter((x) => !eaten.has(x.heroId));
}
