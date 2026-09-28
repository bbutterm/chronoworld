import { heroName, heroRole } from '../heroes/card';
import { CARD_RARITIES, rarityIndex } from '../heroes/schema';
import { Rng } from '../rng';
import { DayStringSchema, type ActiveBounty, type Bounty, type HeroState, type SaveState } from '../save/schema';
import { grantMetaRewards, syncAchievementCounters, trackAchievement, type MetaEvent } from './achievements';
import type { BountyTemplate, MetaContext, MetaRewards } from './config';
import { MetaError } from './errors';

const MINUTE_MS = 60_000;

function assertDay(day: string): void {
  if (!DayStringSchema.safeParse(day).success) throw new MetaError('invalid_day', `Неверный день: ${JSON.stringify(day)} (нужно YYYY-MM-DD)`);
}

/** Детерминированный seed доски из seed UI, дня и номера обновления за день (FNV-1a по строке). */
function boardSeed(seed: number, day: string, refresh: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${day}#${refresh}#${seed >>> 0}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Шаблон поручения: редкость по весам, затем шаблон этой редкости. T3-12: шаблон, уже стоящий на доске (used),
 * не повторяется, пока в каталоге есть другие, — две одинаковые карточки подряд выглядели как дубль отрисовки.
 * Веса делятся между редкостями, где ещё есть свободные шаблоны. Случайных чисел тратится столько же (детерминизм по seed).
 */
function pickTemplate(rng: Rng, ctx: MetaContext, used: ReadonlySet<string> = new Set()): BountyTemplate {
  const cfg = ctx.meta.bounties;
  // Порядок редкостей — как в JSON; редкости без шаблонов (вес 0) пропускаются.
  const withTemplates = Object.entries(cfg.rarities).filter(([r, w]) => w > 0 && cfg.templates.some((t) => t.rarity === r));
  // Редкости, где остались не выставленные на доску шаблоны; все исчерпаны — снова все (доска больше каталога).
  const open = withTemplates.filter(([r]) => cfg.templates.some((t) => t.rarity === r && !used.has(t.id)));
  const rarities = open.length ? open : withTemplates;
  const total = rarities.reduce((s, [, w]) => s + w, 0);
  let x = rng.next() * total;
  let rarity = rarities[rarities.length - 1][0];
  for (const [r, w] of rarities) {
    if (x < w) {
      rarity = r;
      break;
    }
    x -= w;
  }
  const all = cfg.templates.filter((t) => t.rarity === rarity);
  const fresh = all.filter((t) => !used.has(t.id));
  const pool = fresh.length ? fresh : all;
  return pool[rng.int(pool.length)];
}

/** Сгенерировать доску (boardSize поручений) — детерминированно по seed, day и номеру обновления. */
export function generateBoard(day: string, seed: number, refresh: number, ctx: MetaContext): Bounty[] {
  const rng = new Rng(boardSeed(seed, day, refresh));
  const used = new Set<string>();
  return Array.from({ length: ctx.meta.bounties.boardSize }, (_, i): Bounty => {
    const t = pickTemplate(rng, ctx, used);
    used.add(t.id);
    return {
      id: `b_${day}_${refresh}_${i + 1}`,
      templateId: t.id,
      rarity: t.rarity,
      durationMinutes: t.durationMinutes,
      heroCount: t.heroCount,
      role: t.role,
      rewards: { gold: t.rewards.gold, jobExp: t.rewards.jobExp, gems: t.rewards.gems, ...(t.rewards.shards ? { shards: t.rewards.shards } : {}) },
    };
  });
}

/**
 * K9. Автообновление доски при смене дня: day новее bounties.lastRefreshDay → новая доска (бесплатно),
 * счётчик ручных обновлений обнуляется. Тот же день — тот же объект save; более ранний (часы назад) —
 * день принимается, доска и счётчик не меняются (P11, T4-07).
 * Поручения в работе (active) не трогаются. UI вызывает при открытии экрана доски.
 */
export function ensureBoard(save: SaveState, day: string, seed: number, ctx: MetaContext): SaveState {
  assertDay(day);
  if (day === save.bounties.lastRefreshDay) return save;
  // P11 (T4-07): часы переведены назад — доска и счётчик остаются, но день принимается: следующая
  // реальная полночь снова обновит доску (раньше она замирала до сохранённого «будущего» дня).
  if (day < save.bounties.lastRefreshDay) return { ...save, bounties: { ...save.bounties, lastRefreshDay: day } };
  return { ...save, bounties: { ...save.bounties, board: generateBoard(day, seed, 0, ctx), lastRefreshDay: day, refreshesUsed: 0 } };
}

/**
 * K9. Обновить доску. Детерминирована по (seed, day, номер обновления за день).
 * Новый день → то же, что ensureBoard (бесплатно). Тот же день → ручное обновление: не больше dailyRefreshes
 * раз в день (MetaError('refresh_limit')), доска целиком заменяется. День раньше сохранённого — как тот же день
 * (новых бесплатных обновлений переводом часов не получить). Поручения в работе не трогаются.
 */
export function refreshBoard(save: SaveState, day: string, seed: number, ctx: MetaContext): SaveState {
  assertDay(day);
  if (day > save.bounties.lastRefreshDay) return ensureBoard(save, day, seed, ctx);
  const used = save.bounties.refreshesUsed;
  const max = ctx.meta.bounties.dailyRefreshes;
  if (used >= max) throw new MetaError('refresh_limit', `Обновлять доску можно ${max} раз в день`);
  const board = generateBoard(save.bounties.lastRefreshDay, seed, used + 1, ctx);
  return { ...save, bounties: { ...save.bounties, board, refreshesUsed: used + 1 } };
}

/** Сколько ручных обновлений доски осталось на день day (новый день — все). */
export function refreshesLeft(save: SaveState, day: string, ctx: MetaContext): number {
  assertDay(day);
  const max = ctx.meta.bounties.dailyRefreshes;
  return day > save.bounties.lastRefreshDay ? max : Math.max(0, max - save.bounties.refreshesUsed);
}

/** id героев, которые сейчас на поручениях (в том числе на завершённых, но не забранных). */
export function busyHeroes(save: SaveState): string[] {
  return save.bounties.active.flatMap((b) => b.heroIds);
}

/**
 * K9. Отправить героев на поручение с доски. now — время в мс (как у офлайн-сундука).
 * Поручение переходит с доски в active, endsAt = now + durationMinutes.
 * Герой может быть только на одном поручении, но на поручении он **продолжает сражаться** (кампания, башня,
 * отряд — без ограничений): поручение занимает только «слот поручений» героя.
 * MetaError: unknown_bounty, wrong_hero_count (нужно ровно heroCount), duplicate_hero, unknown_hero,
 * hero_busy, role_required (в группе нет героя нужной роли).
 */
export function startBounty(save: SaveState, bountyId: string, heroIds: readonly string[], now: number, ctx: MetaContext): SaveState {
  const b = save.bounties.board.find((x) => x.id === bountyId);
  if (!b) throw new MetaError('unknown_bounty', `Поручение ${bountyId} не найдено на доске`);
  if (heroIds.length !== b.heroCount) throw new MetaError('wrong_hero_count', `На это поручение нужно отправить героев: ${b.heroCount}`);
  if (new Set(heroIds).size !== heroIds.length) throw new MetaError('duplicate_hero', 'Один герой указан дважды');
  const busy = new Set(busyHeroes(save));
  const heroes: HeroState[] = heroIds.map((id) => {
    const h = save.heroes.find((x) => x.id === id);
    if (!h) throw new MetaError('unknown_hero', `Герой ${id} не найден`);
    if (busy.has(id)) throw new MetaError('hero_busy', `${heroName(h, ctx)} уже на другом поручении`);
    return h;
  });
  if (b.role && !heroes.some((h) => heroRole(h, ctx) === b.role)) {
    throw new MetaError('role_required', `Нужен хотя бы один герой с ролью «${ROLE_NAMES[b.role]}»`);
  }
  const active: ActiveBounty = { ...b, heroIds: [...heroIds], startedAt: now, endsAt: now + Math.round(b.durationMinutes * MINUTE_MS) };
  return { ...save, bounties: { ...save.bounties, board: save.bounties.board.filter((x) => x.id !== b.id), active: [...save.bounties.active, active] } };
}

export const ROLE_NAMES = { tank: 'танк', damage: 'урон', healer: 'лекарь', support: 'поддержка' } as const;

export interface ActiveBountyView extends ActiveBounty {
  /** Сколько мс осталось (0 — готово). */
  remainingMs: number;
  done: boolean;
}

export interface BountyStatus {
  board: Bounty[];
  active: ActiveBountyView[];
  busyHeroes: string[];
  lastRefreshDay: string;
  refreshesUsed: number;
}

/** K9. Состояние доски для экрана на момент now (мс). Время назад (now < startedAt) — просто «не готово». */
export function bountyStatus(save: SaveState, now: number): BountyStatus {
  return {
    board: save.bounties.board,
    active: save.bounties.active.map((b) => ({ ...b, remainingMs: Math.max(0, b.endsAt - now), done: now >= b.endsAt })),
    busyHeroes: busyHeroes(save),
    lastRefreshDay: save.bounties.lastRefreshDay,
    refreshesUsed: save.bounties.refreshesUsed,
  };
}

/**
 * K9. Забрать награду завершённого поручения (now ≥ endsAt). Золото и гемы — в ресурсы, jobExp — в общий пул опыта,
 * shards — осколки «отстающему» сюжетному герою. Герои освобождаются.
 * Достижения: bounties_done + 1 и счётчики-максимумы (уровни героев).
 * MetaError: unknown_bounty (нет среди active), bounty_not_finished.
 */
export function claimBounty(save: SaveState, bountyId: string, now: number, ctx: MetaContext): { save: SaveState; rewards: MetaRewards; events: MetaEvent[] } {
  const b = save.bounties.active.find((x) => x.id === bountyId);
  if (!b) throw new MetaError('unknown_bounty', `Поручение ${bountyId} не выполняется`);
  if (now < b.endsAt) {
    const min = Math.ceil((b.endsAt - now) / MINUTE_MS);
    throw new MetaError('bounty_not_finished', `Поручение ещё не завершено (осталось ${min} мин.)`);
  }
  const rewards: MetaRewards = { gold: b.rewards.gold, gems: b.rewards.gems, jobExp: b.rewards.jobExp, shards: b.rewards.shards ?? 0 };
  const heroIds = b.heroIds.filter((id) => save.heroes.some((h) => h.id === id));
  const events: MetaEvent[] = [{ type: 'bountyDone', bountyId: b.id, heroIds }];
  let next = grantMetaRewards({ ...save, bounties: { ...save.bounties, active: save.bounties.active.filter((x) => x.id !== b.id) } }, rewards, ctx, events);
  next = syncAchievementCounters(trackAchievement(next, 'bounties_done', 1, 'add'));
  return { save: next, rewards, events };
}

/** Название поручения по шаблону (шаблон удалён из конфига — id шаблона). */
export function bountyName(b: Pick<Bounty, 'templateId'>, ctx: MetaContext): string {
  return ctx.meta.bounties.templates.find((t) => t.id === b.templateId)?.name ?? b.templateId;
}

// ---------- «Отправить всё» / «Забрать всё» (как Dispatch All в AFK Arena) ----------

/** Одна отправка из плана «Отправить всё». */
export interface DispatchPlanItem {
  bountyId: string;
  heroIds: string[];
}

/** Ранг редкости поручения 0…1 (порядок редкостей — как в data/bounties.json: common → epic). */
function bountyTier(b: Bounty, ctx: MetaContext): number {
  const order = Object.keys(ctx.meta.bounties.rarities);
  const i = order.indexOf(b.rarity);
  return order.length > 1 && i >= 0 ? i / (order.length - 1) : 0;
}

/** Ранг редкости карточки 0…1 (зелёная → красная). */
function heroTier(h: HeroState): number {
  return rarityIndex(h.rarity) / (CARD_RARITIES.length - 1);
}

/**
 * План «Отправить всё»: свободные герои распределяются по поручениям доски — детерминированно, без случайности.
 * - Порядок поручений: редкость (эпическое → обычное), затем с требованием роли, затем больше героев, затем порядок доски.
 * - Герой — только на одном поручении (занятые — busyHeroes — и уже распределённые в плане не берутся).
 * - Роль: в группу обязательно входит герой нужной роли; для остальных мест сначала берутся герои, чья роль
 *   не понадобится ещё не обслуженным поручениям с требованием роли (танка не «тратят» на патруль, если ждёт караван).
 * - Редкость: карточка подбирается ближе к редкости поручения (эпическое — старшие карточки, обычное — младшие);
 *   при равенстве — порядок героев в сохранении.
 * - Поручение, на которое не хватает героев (или нет нужной роли), пропускается целиком — частичных групп нет.
 */
export function planDispatchAll(save: SaveState, ctx: MetaContext): DispatchPlanItem[] {
  const busy = new Set(busyHeroes(save));
  const free = save.heroes.filter((h) => !busy.has(h.id) && ctx.content.heroes[h.templateId]);
  const order = new Map(save.heroes.map((h, i) => [h.id, i]));
  const role = (h: HeroState) => heroRole(h, ctx);
  const bounties = save.bounties.board
    .map((b, i) => ({ b, i }))
    .sort((x, y) => bountyTier(y.b, ctx) - bountyTier(x.b, ctx) || Number(!!y.b.role) - Number(!!x.b.role) || y.b.heroCount - x.b.heroCount || x.i - y.i)
    .map((x) => x.b);
  const used = new Set<string>();
  const plan: DispatchPlanItem[] = [];
  bounties.forEach((b, bi) => {
    const tier = bountyTier(b, ctx);
    const fit = (h: HeroState) => Math.abs(heroTier(h) - tier);
    const byFit = (a: HeroState, c: HeroState) => fit(a) - fit(c) || order.get(a.id)! - order.get(c.id)!;
    const avail = free.filter((h) => !used.has(h.id));
    if (avail.length < b.heroCount) return;
    // Сколько ещё героев каждой роли нужно поручениям после этого (только обязательные роли).
    const demand = new Map<string, number>();
    for (const later of bounties.slice(bi + 1)) if (later.role) demand.set(later.role, (demand.get(later.role) ?? 0) + 1);
    const group: HeroState[] = [];
    if (b.role) {
      const lead = avail.filter((h) => role(h) === b.role).sort(byFit)[0];
      if (!lead) return;
      group.push(lead);
    }
    const rest = avail
      .filter((h) => !group.includes(h))
      .sort((a, c) => Number((demand.get(role(a)) ?? 0) > 0) - Number((demand.get(role(c)) ?? 0) > 0) || byFit(a, c));
    group.push(...rest.slice(0, b.heroCount - group.length));
    for (const h of group) used.add(h.id);
    plan.push({ bountyId: b.id, heroIds: group.map((h) => h.id) });
  });
  return plan;
}

/**
 * «Отправить всё»: planDispatchAll + startBounty для каждой группы (те же проверки). started — отправленные поручения
 * в порядке плана; пусто — отправлять некого или нечего (save тот же объект).
 */
export function dispatchAllBounties(save: SaveState, now: number, ctx: MetaContext): { save: SaveState; started: Bounty[] } {
  const started: Bounty[] = [];
  let next = save;
  for (const p of planDispatchAll(save, ctx)) {
    const b = next.bounties.board.find((x) => x.id === p.bountyId)!;
    next = startBounty(next, p.bountyId, p.heroIds, now, ctx);
    started.push(b);
  }
  return { save: next, started };
}

/** Сложить награды K9/K10 (осколки — сумма; кому достались — в событиях shards). */
export function sumMetaRewards(list: readonly MetaRewards[]): MetaRewards {
  return list.reduce((s, r) => ({ gold: s.gold + r.gold, gems: s.gems + r.gems, jobExp: s.jobExp + r.jobExp, shards: s.shards + r.shards }), { gold: 0, gems: 0, jobExp: 0, shards: 0 });
}

/**
 * «Забрать всё»: claimBounty для каждого завершённого (now ≥ endsAt) поручения в порядке active.
 * rewards — сумма, events — события всех наград подряд, claimed — id забранных. Нечего забрать — тот же save.
 */
export function claimAllBounties(save: SaveState, now: number, ctx: MetaContext): { save: SaveState; rewards: MetaRewards; events: MetaEvent[]; claimed: string[] } {
  let next = save;
  const all: MetaRewards[] = [];
  const events: MetaEvent[] = [];
  const claimed: string[] = [];
  for (const b of save.bounties.active) {
    if (now < b.endsAt) continue;
    const r = claimBounty(next, b.id, now, ctx);
    next = r.save;
    all.push(r.rewards);
    events.push(...r.events);
    claimed.push(b.id);
  }
  return { save: next, rewards: sumMetaRewards(all), events, claimed };
}
