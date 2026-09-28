/**
 * K9. Экспедиции по локациям (заменили доску поручений; docs/content/meta.md, раздел K9).
 *
 * Локации (data/expeditions.json) открываются по этапам кампании. Игрок выбирает локацию и срок (1 / 4 / 8 ч) и жмёт
 * «Отправить» — отряд собирается сам (autoParty): свободные герои, сначала не из основного отряда, до maxHeroes, пока
 * сумма мощи не достигнет порога локации. Ролей и редкостей нет — только «Мощь N / нужно M». На локации — одна
 * экспедиция; герой — в одной экспедиции. Герои в экспедиции продолжают сражаться (кампания, башня, охота).
 *
 * Добыча бросается при отправке и хранится снимком (rollExpeditionLoot): золото и опыт — perHour × часы добычи,
 * находки (предметы темы, гемы, карты героя, свитки) — броски за каждый час добычи; часы добычи = часы × (1 + bonus),
 * поэтому длинные экспедиции чуть выгоднее в час. Всё детерминировано: seed — сохранение (createdAt), локация и время
 * отправки. Время (now, мс) передаёт UI; ни Date, ни Math.random здесь нет.
 */
import { lootSeed } from '../equipment/chest';
import { addItems, withGear } from '../equipment/equipment';
import type { EquipmentConfig } from '../equipment/load';
import type { FeatureContext } from '../features/config';
import { heroPower } from '../features/power';
import { heroName } from '../heroes/card';
import { cardRng, grantHeroCards, pickHeroCards } from '../heroes/cardDrops';
import { Rng } from '../rng';
import type { ActiveExpedition, ExpeditionRewards, HeroState, ItemInstance, SaveState } from '../save/schema';
import { stageLabel } from '../unlocks/unlocks';
import { grantMetaRewards, syncAchievementCounters, trackAchievement, type MetaEvent } from './achievements';
import type { ExpeditionDuration, ExpeditionLocation, ExpeditionLoot, MetaContext } from './config';
import { MetaError } from './errors';

const HOUR_MS = 3_600_000;

/** Контекст экспедиций: конфиг K9 + мощь героев (K2) + экипировка (мощь с предметами, добыча-предметы). */
export type ExpeditionContext = MetaContext & FeatureContext & { equipment?: EquipmentConfig };

/** Пустая добыча. */
export function emptyExpeditionRewards(): ExpeditionRewards {
  return { gold: 0, jobExp: 0, gems: 0, heroCards: { blue: 0, purple: 0 }, scrolls: 0, items: [] };
}

/** Локация по id. MetaError('unknown_location'). */
export function expeditionLocation(id: string, ctx: MetaContext): ExpeditionLocation {
  const loc = ctx.meta.expeditions.locations.find((l) => l.id === id);
  if (!loc) throw new MetaError('unknown_location', `Неизвестная локация: ${id}`);
  return loc;
}

/** Открыта ли локация (пройден её этап). */
export function locationUnlocked(save: Pick<SaveState, 'campaign'>, loc: Pick<ExpeditionLocation, 'stage'>): boolean {
  return save.campaign.cleared.includes(loc.stage);
}

/** «Откроется на этапе 2-6». */
export function locationLockedText(loc: Pick<ExpeditionLocation, 'stage'>, ctx: MetaContext): string {
  return `Откроется на этапе ${stageLabel(loc.stage, ctx.content)}`;
}

/** Вариант длительности. MetaError('invalid_duration'). */
export function expeditionDuration(hours: number, ctx: MetaContext): ExpeditionDuration {
  const d = ctx.meta.expeditions.durations.find((x) => x.hours === hours);
  if (!d) throw new MetaError('invalid_duration', `Нельзя отправить на ${hours} ч: доступно ${ctx.meta.expeditions.durations.map((x) => `${x.hours} ч`).join(', ')}`);
  return d;
}

/** Часы добычи: часы × (1 + надбавка длительности). */
export function lootHours(hours: number, ctx: MetaContext): number {
  return hours * (1 + expeditionDuration(hours, ctx).bonus);
}

/** id героев, которые сейчас в экспедициях (в том числе в завершённых, но не забранных). */
export function busyHeroes(save: SaveState): string[] {
  return save.bounties.active.flatMap((e) => e.heroIds);
}

/** Мощь героев (с экипировкой, если она есть в контексте): id → мощь. */
function powers(save: SaveState, heroes: readonly HeroState[], ctx: ExpeditionContext): Map<string, number> {
  const gctx = withGear(ctx, save);
  return new Map(heroes.map((h) => [h.id, heroPower(h, gctx)]));
}

/** Отряд экспедиции, подобранный autoParty. */
export interface PartyPick {
  /** Герои по убыванию мощи; пусто — порог недостижим. */
  heroIds: string[];
  /** Мощь отряда; если порог недостижим — наибольшая мощь, которую дали бы свободные герои (до maxHeroes). */
  power: number;
  /** Порог локации. */
  need: number;
  ok: boolean;
}

/**
 * Очередь героя при автоподборе: 0 — кого нельзя отдать в корм вознесения (основной отряд, сюжетные, закреплённые
 * замком), 1 — запасная карточка без копий, 2 — запасная карточка, у которой есть копия (вероятный корм).
 * Герой в экспедиции не может быть кормом (heroes/merge.ts), поэтому в экспедиции сначала идут те, кто кормом и так не
 * станет, — и экспедиции не мешают вознесению. В бою герои экспедиции участвуют как обычно.
 */
function partyTier(h: HeroState, save: SaveState, ctx: ExpeditionContext, copies: ReadonlyMap<string, number>): number {
  if (save.squad.includes(h.id) || h.locked === true || ctx.content.heroes[h.templateId].source === 'story') return 0;
  return (copies.get(h.templateId) ?? 0) > 1 ? 2 : 1;
}

/**
 * Автоподбор отряда для локации (кнопка «Отправить») — детерминированно, без случайности:
 * 1. кандидаты — свободные герои (не в экспедициях, карточка есть в игре), по очереди partyTier, внутри — по убыванию мощи;
 * 2. берутся по порядку, пока сумма мощи не достигнет порога (не больше maxHeroes); не хватило при полном отряде —
 *    слабейшего заменяет сильнейший из оставшихся;
 * 3. лишние убираются (сначала из дальней очереди, слабейшие), затем каждый участник, начиная с сильнейшего, заменяется
 *    самым слабым свободным героем не дальней очереди, если порог всё равно набирается, — сильные герои остаются для
 *    трудных локаций.
 * При равной мощи — порядок героев в сохранении. Порог недостижим — ok: false и наибольшая возможная мощь.
 */
export function autoParty(save: SaveState, locationId: string, ctx: ExpeditionContext): PartyPick {
  const loc = expeditionLocation(locationId, ctx);
  const need = loc.power;
  const max = ctx.meta.expeditions.maxHeroes;
  const busy = new Set(busyHeroes(save));
  const free = save.heroes.filter((h) => !busy.has(h.id) && ctx.content.heroes[h.templateId]);
  const power = powers(save, free, ctx);
  const p = (h: HeroState) => power.get(h.id)!;
  const order = new Map(save.heroes.map((h, i) => [h.id, i]));
  const byPower = (a: HeroState, b: HeroState) => p(b) - p(a) || order.get(a.id)! - order.get(b.id)!;
  const copies = new Map<string, number>();
  for (const h of save.heroes) copies.set(h.templateId, (copies.get(h.templateId) ?? 0) + 1);
  const tier = new Map(free.map((h) => [h.id, partyTier(h, save, ctx, copies)]));
  const t = (h: HeroState) => tier.get(h.id)!;
  const cands = [...free].sort((a, b) => t(a) - t(b) || byPower(a, b));

  const party: HeroState[] = [];
  let sum = 0;
  for (const h of cands) {
    if (sum >= need || party.length >= max) break;
    party.push(h);
    sum += p(h);
  }
  // Полный отряд, а порога нет — усилить: слабейшего участника меняет сильнейший из оставшихся.
  for (const h of [...cands].sort(byPower)) {
    if (sum >= need) break;
    if (party.includes(h)) continue;
    const weakest = [...party].sort(byPower)[party.length - 1];
    if (!weakest || p(weakest) >= p(h)) break;
    party.splice(party.indexOf(weakest), 1, h);
    sum += p(h) - p(weakest);
  }
  if (sum < need) {
    const best = [...free].sort(byPower).slice(0, max).reduce((s, h) => s + p(h), 0);
    return { heroIds: [], power: best, need, ok: false };
  }
  // Лишние: сначала из дальней очереди, слабейшие.
  for (const h of [...party].sort((a, b) => t(b) - t(a) || byPower(b, a))) {
    if (party.length > 1 && sum - p(h) >= need) {
      party.splice(party.indexOf(h), 1);
      sum -= p(h);
    }
  }
  // Сильных — на трудные локации: участника меняет самый слабый свободный герой не дальней очереди, если порог набирается.
  for (const m of [...party].sort(byPower)) {
    const swap = cands
      .filter((c) => !party.includes(c) && t(c) <= t(m) && p(c) < p(m) && sum - p(m) + p(c) >= need)
      .sort((a, b) => byPower(b, a))[0];
    if (!swap) continue;
    party.splice(party.indexOf(m), 1, swap);
    sum += p(swap) - p(m);
  }
  return { heroIds: party.sort(byPower).map((h) => h.id), power: sum, need, ok: true };
}

/** Сколько бросков и с каким шансом: целые часы добычи — полные броски, дробный остаток — бросок с уменьшенным шансом. */
function rollsOf(units: number, chance: number): number[] {
  const n = Math.floor(units + 1e-9);
  const frac = units - n;
  const out = Array.from({ length: n }, () => chance);
  if (frac > 1e-9) out.push(chance * frac);
  return out;
}

/**
 * Добыча экспедиции (при отправке, хранится снимком): золото и опыт — perHour × часы добычи (округление),
 * по каждой строке loot — броски за часы добычи. Rng от seed (сохранение, локация, время отправки).
 */
export function rollExpeditionLoot(loc: ExpeditionLocation, hours: number, seed: number, ctx: MetaContext): ExpeditionRewards {
  const units = lootHours(hours, ctx);
  const r = emptyExpeditionRewards();
  r.gold = Math.round(loc.perHour.gold * units);
  r.jobExp = Math.round(loc.perHour.jobExp * units);
  const rng = new Rng(seed);
  for (const l of loc.loot) {
    for (const chance of rollsOf(units, l.chance)) {
      const x = rng.next();
      const pick = rng.next();
      if (x >= chance) continue;
      if (l.kind === 'item') r.items.push(l.items![Math.floor(pick * l.items!.length)]);
      else if (l.kind === 'heroCard') r.heroCards[l.rarity ?? 'blue'] += l.count;
      else r[l.kind] += l.count;
    }
  }
  return r;
}

/** seed добычи экспедиции: сохранение (createdAt), локация и время отправки. */
export function expeditionSeed(save: Pick<SaveState, 'createdAt'>, locationId: string, startedAt: number): number {
  return lootSeed('expedition', save.createdAt, locationId, startedAt);
}

/** Ожидаемая добыча (для подписи на карточке): золото и опыт точно, находки — среднее число. */
export interface ExpectedLoot {
  gold: number;
  jobExp: number;
  gems: number;
  /** Карты случайных героев (синие + фиолетовые). */
  heroCards: number;
  scrolls: number;
  items: number;
}

export function expectedExpeditionLoot(loc: ExpeditionLocation, hours: number, ctx: MetaContext): ExpectedLoot {
  const units = lootHours(hours, ctx);
  const e: ExpectedLoot = { gold: Math.round(loc.perHour.gold * units), jobExp: Math.round(loc.perHour.jobExp * units), gems: 0, heroCards: 0, scrolls: 0, items: 0 };
  for (const l of loc.loot) {
    const n = rollsOf(units, l.chance).reduce((s, c) => s + c, 0);
    if (l.kind === 'item') e.items += n;
    else if (l.kind === 'heroCard') e.heroCards += n * l.count;
    else e[l.kind] += n * l.count;
  }
  return e;
}

/** Какие находки бывают в локации (порядок: предметы, гемы, карты героя, свитки). */
export function lootKinds(loc: ExpeditionLocation): ExpeditionLoot['kind'][] {
  return (['item', 'gems', 'heroCard', 'scrolls'] as const).filter((k) => loc.loot.some((l) => l.kind === k && l.chance > 0));
}

/**
 * Отправить экспедицию. heroIds не передан — отряд подбирает autoParty (одно нажатие в UI).
 * MetaError: unknown_location, location_locked, location_busy (уже в пути), invalid_duration,
 * unknown_hero, duplicate_hero, hero_busy, too_many_heroes, not_enough_power.
 */
export function startExpedition(
  save: SaveState,
  locationId: string,
  hours: number,
  now: number,
  ctx: ExpeditionContext,
  heroIds?: readonly string[],
): SaveState {
  const loc = expeditionLocation(locationId, ctx);
  if (!locationUnlocked(save, loc)) throw new MetaError('location_locked', `${loc.name}: ${locationLockedText(loc, ctx).toLowerCase()}`);
  if (save.bounties.active.some((e) => e.location === loc.id)) throw new MetaError('location_busy', `${loc.name}: экспедиция уже в пути`);
  expeditionDuration(hours, ctx);
  let ids: string[];
  let power: number;
  if (heroIds === undefined) {
    const pick = autoParty(save, loc.id, ctx);
    if (!pick.ok) throw new MetaError('not_enough_power', `${loc.name}: мало мощи — ${pick.power} / нужно ${pick.need}`);
    ids = pick.heroIds;
    power = pick.power;
  } else {
    if (!heroIds.length || heroIds.length > ctx.meta.expeditions.maxHeroes) {
      throw new MetaError('too_many_heroes', `В экспедицию — от 1 до ${ctx.meta.expeditions.maxHeroes} героев`);
    }
    if (new Set(heroIds).size !== heroIds.length) throw new MetaError('duplicate_hero', 'Один герой указан дважды');
    const busy = new Set(busyHeroes(save));
    const heroes = heroIds.map((id) => {
      const h = save.heroes.find((x) => x.id === id);
      if (!h || !ctx.content.heroes[h.templateId]) throw new MetaError('unknown_hero', `Герой ${id} не найден`);
      if (busy.has(id)) throw new MetaError('hero_busy', `${heroName(h, ctx)} уже в экспедиции`);
      return h;
    });
    const p = powers(save, heroes, ctx);
    power = heroes.reduce((s, h) => s + p.get(h.id)!, 0);
    if (power < loc.power) throw new MetaError('not_enough_power', `${loc.name}: мало мощи — ${power} / нужно ${loc.power}`);
    ids = [...heroIds];
  }
  const entry: ActiveExpedition = {
    location: loc.id,
    hours,
    heroIds: ids,
    power,
    startedAt: now,
    endsAt: now + Math.round(hours * HOUR_MS),
    rewards: rollExpeditionLoot(loc, hours, expeditionSeed(save, loc.id, now), ctx),
  };
  return { ...save, bounties: { ...save.bounties, active: [...save.bounties.active, entry] } };
}

export interface ActiveExpeditionView extends ActiveExpedition {
  /** Сколько мс осталось (0 — готово). */
  remainingMs: number;
  done: boolean;
}

/** Локация на экране. */
export interface ExpeditionView {
  location: ExpeditionLocation;
  unlocked: boolean;
  /** «Откроется на этапе 2-6» или ''. */
  lockedText: string;
  /** Экспедиция в пути (или готова к получению); null — локация свободна. */
  active: ActiveExpeditionView | null;
  /** Отряд, который соберётся по «Отправить» (только открытая и свободная локация). */
  party: PartyPick | null;
}

/** Состояние всех локаций на момент now (мс; время назад — просто «не готово»). Порядок — как в data/expeditions.json. */
export function expeditionStatus(save: SaveState, now: number, ctx: ExpeditionContext): ExpeditionView[] {
  return ctx.meta.expeditions.locations.map((loc) => {
    const unlocked = locationUnlocked(save, loc);
    const a = save.bounties.active.find((e) => e.location === loc.id);
    const active = a ? { ...a, remainingMs: Math.max(0, a.endsAt - now), done: now >= a.endsAt } : null;
    return { location: loc, unlocked, lockedText: unlocked ? '' : locationLockedText(loc, ctx), active, party: unlocked && !a ? autoParty(save, loc.id, ctx) : null };
  });
}

/** Сколько экспедиций вернулось и ждут «Забрать». */
export function finishedExpeditions(save: SaveState, now: number): number {
  return save.bounties.active.filter((e) => now >= e.endsAt).length;
}

/** Открытые свободные локации, куда можно отправить отряд прямо сейчас (хватает мощи свободных героев). */
export function idleExpeditions(save: SaveState, ctx: ExpeditionContext): number {
  return ctx.meta.expeditions.locations.filter(
    (loc) => locationUnlocked(save, loc) && !save.bounties.active.some((e) => e.location === loc.id) && autoParty(save, loc.id, ctx).ok,
  ).length;
}

/** Результат получения добычи. rewards — что реально выдано (карты героя — число; кто — в событиях heroCard). */
export interface ExpeditionClaim {
  save: SaveState;
  rewards: ExpeditionRewards;
  /** Новые экземпляры предметов в инвентаре. */
  added: ItemInstance[];
  events: MetaEvent[];
}

/**
 * Забрать добычу вернувшейся экспедиции (now ≥ endsAt): золото и гемы — в ресурсы, опыт — в общий пул, карты героя —
 * случайным героям (новые экземпляры), свитки — в валюту, предметы — в инвентарь (предмет, которого больше нет в игре, пропадает).
 * Герои свободны. Достижения: bounties_done + 1 и счётчики-«максимумы».
 * MetaError: unknown_location (нет в конфиге и нет в пути), expedition_not_running, expedition_not_finished.
 */
export function claimExpedition(save: SaveState, locationId: string, now: number, ctx: ExpeditionContext): ExpeditionClaim {
  const e = save.bounties.active.find((x) => x.location === locationId);
  // Локацию могли убрать из data/expeditions.json — начатую экспедицию всё равно можно забрать (имя — id).
  const name = ctx.meta.expeditions.locations.find((l) => l.id === locationId)?.name;
  if (!e) {
    if (!name) throw new MetaError('unknown_location', `Неизвестная локация: ${locationId}`);
    throw new MetaError('expedition_not_running', `${name}: экспедиции в пути нет`);
  }
  if (now < e.endsAt) {
    const min = Math.ceil((e.endsAt - now) / 60_000);
    throw new MetaError('expedition_not_finished', `${name ?? locationId}: отряд ещё в пути (осталось ${min} мин.)`);
  }
  const heroIds = e.heroIds.filter((id) => save.heroes.some((h) => h.id === id));
  const events: MetaEvent[] = [{ type: 'expeditionDone', location: e.location, heroIds }];
  const r = e.rewards;
  let next: SaveState = { ...save, bounties: { ...save.bounties, active: save.bounties.active.filter((x) => x !== e) } };
  next = grantMetaRewards(next, { gold: r.gold, gems: r.gems, jobExp: r.jobExp }, ctx, events, 0).save;
  // Карты героя: сколько — в снимке, какие герои — при получении (seed экспедиции).
  const cards = grantHeroCards(next, pickHeroCards(r.heroCards, cardRng(expeditionSeed(save, e.location, e.startedAt)), ctx), ctx);
  next = cards.save;
  events.push(...cards.events);
  if (r.scrolls > 0) next = { ...next, currency: { ...next.currency, scrolls: next.currency.scrolls + r.scrolls } };
  const known = ctx.equipment?.items;
  const items = known ? r.items.filter((id) => known[id]) : [];
  const got = addItems(next, items);
  next = syncAchievementCounters(trackAchievement(got.save, 'bounties_done', 1, 'add'));
  return { save: next, rewards: { ...r, items }, added: got.added, events };
}

/** Сложить добычу нескольких экспедиций. */
export function sumExpeditionRewards(list: readonly ExpeditionRewards[]): ExpeditionRewards {
  return list.reduce(
    (s, r) => ({
      gold: s.gold + r.gold,
      jobExp: s.jobExp + r.jobExp,
      gems: s.gems + r.gems,
      heroCards: { blue: s.heroCards.blue + r.heroCards.blue, purple: s.heroCards.purple + r.heroCards.purple },
      scrolls: s.scrolls + r.scrolls,
      items: [...s.items, ...r.items],
    }),
    emptyExpeditionRewards(),
  );
}

/**
 * «Забрать всё»: claimExpedition для каждой вернувшейся экспедиции (порядок локаций в data/expeditions.json; убранные из
 * конфига — в конце).
 * claimed — id локаций. Нечего забрать — тот же save.
 */
export function claimAllExpeditions(save: SaveState, now: number, ctx: ExpeditionContext): ExpeditionClaim & { claimed: string[] } {
  let next = save;
  const all: ExpeditionRewards[] = [];
  const added: ItemInstance[] = [];
  const events: MetaEvent[] = [];
  const claimed: string[] = [];
  const rank = (id: string) => {
    const i = ctx.meta.expeditions.locations.findIndex((l) => l.id === id);
    return i < 0 ? Infinity : i;
  };
  const ready = save.bounties.active.filter((e) => now >= e.endsAt).sort((a, b) => rank(a.location) - rank(b.location));
  for (const e of ready) {
    const r = claimExpedition(next, e.location, now, ctx);
    next = r.save;
    all.push(r.rewards);
    added.push(...r.added);
    events.push(...r.events);
    claimed.push(e.location);
  }
  return { save: next, rewards: sumExpeditionRewards(all), added, events, claimed };
}

/**
 * Перекрёстные проверки data/expeditions.json: этап открытия и монстр существуют, предметы добычи есть в data/items
 * (если передан каталог предметов). Проблемы — русским текстом в problems.
 */
export function validateExpeditions(
  cfg: MetaContext['meta']['expeditions'],
  content: MetaContext['content'],
  items: Record<string, unknown> | undefined,
  problems: string[],
): void {
  for (const loc of cfg.locations) {
    const at = `data/expeditions.json: локация ${loc.id}`;
    if (!content.stages.some((s) => s.id === loc.stage)) problems.push(`${at} — этап ${loc.stage} не найден в кампании`);
    if (loc.monster && !content.units[loc.monster]) problems.push(`${at} — монстр ${loc.monster} не найден в data/units`);
    if (items) {
      for (const l of loc.loot) for (const id of l.items ?? []) if (!items[id]) problems.push(`${at} — предмет ${id} не найден в data/items`);
    }
  }
}
