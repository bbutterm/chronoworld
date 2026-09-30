/**
 * События экспедиций — «текстовые приключения» (docs/design/expedition-adventures.md).
 *
 * При отправке экспедиции выпадают 1–3 события (data/expedition_events.json: своя локация — с весом localWeight, общие —
 * с весом 1) и время каждого внутри срока. Событие «случилось», когда now ≥ at: игрок выбирает вариант, исход бросается
 * сразу и хранится в сохранении (переиграть нельзя). Не решил до «Забрать» — вариант по умолчанию (default: прежняя
 * добыча, только строчка в рассказе).
 *
 * Вариант с requires (линия профессии, роль или конкретный герой) надёжен (chanceWith), если такой герой в отряде; нет —
 * только шанс (chance). Награда — ступень tiers: доля «куска» базовой добычи = снимок золота (опыта) / число событий.
 * Всё детерминировано: Rng от seed сохранения (createdAt), локации, времени отправки, номера события и варианта; время
 * (now) передаёт UI.
 */
import { lootSeed } from '../equipment/chest';
import type { GameContext } from '../progression/types';
import { Rng } from '../rng';
import type { ActiveExpedition, ExpeditionBond, ExpeditionEventState, ExpeditionJournalEntry, ExpeditionRewards, SaveState } from '../save/schema';
import type { ExpeditionLocation } from './config';
import { MetaError } from './errors';
import type { ExpeditionChoice, ExpeditionEventDef, ExpeditionEventsConfig, ExpeditionOutcome, ExpeditionRequires } from './expedition-events-schema';

/** Контекст событий: игра + (необязательно) конфиг событий и локации экспедиций. */
export type ExpeditionEventsContext = GameContext & {
  expeditionEvents?: ExpeditionEventsConfig;
  meta?: { expeditions: { locations: readonly ExpeditionLocation[] } };
};

/** Герой отряда, как его видят события. */
export interface EventHero {
  id: string;
  templateId: string;
  name: string;
  line: string;
  role: string;
  gender: 'm' | 'f';
}

/** Сколько событий за экспедицию на hours часов. */
export function expeditionEventCount(hours: number, cfg: ExpeditionEventsConfig): number {
  const row = cfg.perExpedition.find((r) => hours <= r.maxHours) ?? cfg.perExpedition[cfg.perExpedition.length - 1];
  return row.count;
}

/** События, которые могут случиться в локации: свои и общие. */
export function eventsForLocation(locationId: string, cfg: ExpeditionEventsConfig): ExpeditionEventDef[] {
  return cfg.events.filter((e) => !e.locations.length || e.locations.includes(locationId));
}

/**
 * События новой экспедиции: count штук без повторов (своя локация — вес localWeight, общие — 1), время каждого — внутри
 * своей доли срока: startedAt + срок × (k + 0.2 + 0.6·r) / count.
 */
export function rollExpeditionEvents(locationId: string, startedAt: number, endsAt: number, hours: number, seed: number, cfg: ExpeditionEventsConfig): ExpeditionEventState[] {
  const n = expeditionEventCount(hours, cfg);
  const pool = eventsForLocation(locationId, cfg).map((e) => ({ e, w: e.locations.length ? cfg.localWeight : 1 }));
  const rng = new Rng(seed);
  const out: ExpeditionEventState[] = [];
  const span = endsAt - startedAt;
  for (let k = 0; k < n && pool.length; k++) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let x = rng.next() * total;
    let i = 0;
    while (i < pool.length - 1 && x >= pool[i].w) {
      x -= pool[i].w;
      i++;
    }
    const [{ e }] = pool.splice(i, 1);
    out.push({ id: e.id, at: startedAt + Math.round((span * (k + 0.2 + 0.6 * rng.next())) / n) });
  }
  return out;
}

/** seed выбора событий экспедиции. */
export function expeditionEventsSeed(save: Pick<SaveState, 'createdAt'>, locationId: string, startedAt: number): number {
  return lootSeed('expedition_events', save.createdAt, locationId, startedAt);
}

/** seed исхода: событие (номер) и вариант. */
function outcomeSeed(save: Pick<SaveState, 'createdAt'>, e: Pick<ActiveExpedition, 'location' | 'startedAt'>, index: number, choice: string): number {
  return lootSeed('expedition_event', save.createdAt, e.location, e.startedAt, index, choice);
}

/** Отряд экспедиции (герои, которые ещё есть в сохранении). */
export function eventParty(save: Pick<SaveState, 'heroes'>, heroIds: readonly string[], ctx: GameContext): EventHero[] {
  const out: EventHero[] = [];
  for (const id of heroIds) {
    const h = save.heroes.find((x) => x.id === id);
    const t = h && ctx.content.heroes[h.templateId];
    if (!h || !t) continue;
    out.push({ id: h.id, templateId: h.templateId, name: t.name, line: t.line, role: t.role, gender: t.gender === 'f' ? 'f' : 'm' });
  }
  return out;
}

/** Подходит ли герой под требование варианта. */
export function meetsRequirement(h: EventHero, r: ExpeditionRequires): boolean {
  return !!(r.line?.includes(h.line) || r.role?.includes(h.role as never) || r.hero?.includes(h.templateId));
}

/** Шанс варианта для этого отряда и кто из отряда подходит под требование. */
export function choiceOdds(choice: ExpeditionChoice, party: readonly EventHero[]): { chance: number; fits: EventHero[] } {
  if (!choice.requires) return { chance: choice.chance, fits: [] };
  const fits = party.filter((h) => meetsRequirement(h, choice.requires!));
  return { chance: fits.length ? choice.chanceWith : choice.chance, fits };
}

/** Ожидаемая ступень варианта (доля куска) для этого отряда — для баланса и «лучшего выбора». */
export function choiceExpectation(choice: ExpeditionChoice, party: readonly EventHero[], cfg: ExpeditionEventsConfig): number {
  const { chance } = choiceOdds(choice, party);
  const fail = choice.fail ? cfg.tiers[choice.fail.reward] : 0;
  return chance * cfg.tiers[choice.success.reward] + (1 - chance) * fail;
}

/** Подстановки: {hero}, {partner}, [мужской|женский] — по роду того, кто действовал. */
export function fillEventText(text: string, actor?: Pick<EventHero, 'name' | 'gender'>, partner?: Pick<EventHero, 'name'>): string {
  return text
    .replace(/\{hero\}/g, actor?.name ?? 'Отряд')
    .replace(/\{partner\}/g, partner?.name ?? 'товарищ')
    .replace(/\[([^|\]]*)\|([^\]]*)\]/g, (_m, m: string, f: string) => (actor?.gender === 'f' ? f : m));
}

function eventDef(id: string, cfg: ExpeditionEventsConfig | undefined): ExpeditionEventDef | undefined {
  return cfg?.events.find((e) => e.id === id);
}

function locationItems(locationId: string, ctx: ExpeditionEventsContext): string[] {
  const loc = ctx.meta?.expeditions.locations.find((l) => l.id === locationId);
  // Первый (обычный) список предметов локации: редкие находки остаются броскам добычи.
  return loc?.loot.find((l) => l.kind === 'item')?.items ?? [];
}

/** Бросить исход варианта: успех, кто действовал, второй герой, предмет. Детерминированно. */
function rollOutcome(
  save: Pick<SaveState, 'createdAt' | 'heroes'>,
  e: ActiveExpedition,
  index: number,
  choice: ExpeditionChoice,
  ctx: ExpeditionEventsContext,
): Omit<ExpeditionEventState, 'id' | 'at'> {
  const party = eventParty(save, e.heroIds, ctx);
  const rng = new Rng(outcomeSeed(save, e, index, choice.id));
  const { chance, fits } = choiceOdds(choice, party);
  const ok = rng.next() < chance;
  const who = fits.length ? fits : party;
  const actor = who.length ? who[Math.floor(rng.next() * who.length)] : undefined;
  const others = party.filter((h) => h !== actor);
  const partner = others.length ? others[Math.floor(rng.next() * others.length)] : undefined;
  const out = ok ? choice.success : choice.fail!;
  const items = locationItems(e.location, ctx);
  const pick = rng.next();
  const state: Omit<ExpeditionEventState, 'id' | 'at'> = { choice: choice.id, ok };
  if (actor) state.actor = actor.id;
  if (partner) state.partner = partner.id;
  if (out.item && items.length) state.item = items[Math.floor(pick * items.length)];
  return state;
}

/** Событие ждёт решения: случилось и не решено. */
export function eventPending(ev: ExpeditionEventState, now: number): boolean {
  return ev.choice === undefined && now >= ev.at;
}

/** Сколько событий ждут решения во всех экспедициях (для значка). */
export function pendingExpeditionEvents(save: Pick<SaveState, 'bounties'>, now: number): number {
  return save.bounties.active.reduce((n, e) => n + (e.events ?? []).filter((ev) => eventPending(ev, now)).length, 0);
}

/**
 * Решить событие index экспедиции в локации: исход бросается и сохраняется.
 * MetaError: expedition_not_running, unknown_event (нет такого события или его нет в data), event_not_ready (ещё не
 * случилось), event_resolved (уже решено), unknown_choice.
 */
export function chooseExpeditionEvent(save: SaveState, locationId: string, index: number, choiceId: string, now: number, ctx: ExpeditionEventsContext): SaveState {
  const e = save.bounties.active.find((x) => x.location === locationId);
  if (!e) throw new MetaError('expedition_not_running', 'Экспедиции в пути нет');
  const ev = e.events?.[index];
  const def = ev && eventDef(ev.id, ctx.expeditionEvents);
  if (!ev || !def) throw new MetaError('unknown_event', 'Такого события нет');
  if (ev.choice !== undefined) throw new MetaError('event_resolved', 'Решение уже принято');
  if (now < ev.at) throw new MetaError('event_not_ready', 'Это ещё не случилось');
  const choice = def.choices.find((c) => c.id === choiceId);
  if (!choice) throw new MetaError('unknown_choice', `Нет варианта ${choiceId}`);
  const patch = rollOutcome(save, e, index, choice, ctx);
  const events = e.events!.map((x, i) => (i === index ? { ...x, ...patch } : x));
  const next = { ...e, events };
  // Летопись и «сблизились» — сразу (решённое игроком); выбранное само — при «Забрать».
  const line = eventOutcome(save, next, index, ctx);
  const bounties = recordStory({ ...save.bounties, active: save.bounties.active.map((x) => (x === e ? next : x)) }, e.location, line ? [line] : [], ctx.expeditionEvents);
  return { ...save, bounties };
}

/** Все нерешённые события экспедиции — вариант по умолчанию (auto). Для «Забрать». */
export function autoResolveEvents(save: Pick<SaveState, 'createdAt' | 'heroes'>, e: ActiveExpedition, ctx: ExpeditionEventsContext): ActiveExpedition {
  if (!e.events?.some((ev) => ev.choice === undefined)) return e;
  const events = e.events.map((ev, i) => {
    if (ev.choice !== undefined) return ev;
    const def = eventDef(ev.id, ctx.expeditionEvents);
    const choice = def?.choices.find((c) => c.default);
    if (!choice) return ev;
    return { ...ev, ...rollOutcome(save, e, i, choice, ctx), auto: true };
  });
  return { ...e, events };
}

/** Одна строка рассказа экспедиции. */
export interface ExpeditionStoryLine {
  eventId: string;
  /** Когда случилось (мс). */
  at: number;
  title: string;
  /** Надпись выбранного варианта. */
  choice: string;
  auto: boolean;
  ok: boolean;
  /** Текст исхода с подстановками. */
  text: string;
  gold: number;
  jobExp: number;
  gems: number;
  item?: string;
  /** id раненого героя. */
  wounded?: string;
  /** Пара «сблизились». */
  bond?: [string, string];
  /** Строка в Летопись (с подстановками). */
  lore?: string;
}

/** Исход решённого события (текст, добыча). null — событие не решено или его больше нет в data. */
export function eventOutcome(
  save: Pick<SaveState, 'heroes'>,
  e: ActiveExpedition,
  index: number,
  ctx: ExpeditionEventsContext,
): ExpeditionStoryLine | null {
  const ev = e.events?.[index];
  const cfg = ctx.expeditionEvents;
  const def = ev && eventDef(ev.id, cfg);
  if (!ev || !def || !cfg || ev.choice === undefined) return null;
  const choice = def.choices.find((c) => c.id === ev.choice);
  if (!choice) return null;
  const out: ExpeditionOutcome = ev.ok ? choice.success : (choice.fail ?? choice.success);
  const party = eventParty(save, e.heroIds, ctx);
  const known = (id?: string) => (id ? party.find((h) => h.id === id) : undefined);
  const actor = known(ev.actor);
  const partner = known(ev.partner);
  const n = Math.max(1, e.events!.length);
  const tier = cfg.tiers[out.reward];
  const line: ExpeditionStoryLine = {
    eventId: def.id,
    at: ev.at,
    title: def.title,
    choice: choice.label,
    auto: !!ev.auto,
    ok: !!ev.ok,
    text: fillEventText(out.text, actor, partner),
    gold: Math.round((e.rewards.gold / n) * tier),
    jobExp: Math.round((e.rewards.jobExp / n) * tier),
    gems: out.gems,
  };
  if (ev.item) line.item = ev.item;
  if (out.wound && actor) line.wounded = actor.id;
  if (out.bond && actor && partner) line.bond = [actor.id, partner.id];
  if (out.lore) line.lore = fillEventText(out.lore, actor, partner);
  return line;
}

/** Рассказ экспедиции: исходы решённых событий по порядку. */
export function expeditionStory(save: Pick<SaveState, 'heroes'>, e: ActiveExpedition, ctx: ExpeditionEventsContext): ExpeditionStoryLine[] {
  return (e.events ?? []).map((_, i) => eventOutcome(save, e, i, ctx)).filter((x): x is ExpeditionStoryLine => x !== null);
}

/** Добыча с учётом событий: снимок + золото/опыт ступеней (не ниже 0), гемы, предметы. */
export function rewardsWithStory(base: ExpeditionRewards, story: readonly ExpeditionStoryLine[]): ExpeditionRewards {
  const sum = (k: 'gold' | 'jobExp' | 'gems') => story.reduce((s, l) => s + l[k], 0);
  return {
    ...base,
    gold: Math.max(0, base.gold + sum('gold')),
    jobExp: Math.max(0, base.jobExp + sum('jobExp')),
    gems: base.gems + sum('gems'),
    items: [...base.items, ...story.flatMap((l) => (l.item ? [l.item] : []))],
  };
}

/** Записать Летопись и «сблизились» из рассказа (хранится не больше journalMax последних). */
export function recordStory(
  bounties: SaveState['bounties'],
  location: string,
  story: readonly ExpeditionStoryLine[],
  cfg: ExpeditionEventsConfig | undefined,
): SaveState['bounties'] {
  const max = cfg?.journalMax ?? 40;
  const journal: ExpeditionJournalEntry[] = story.flatMap((l) => (l.lore ? [{ at: l.at, location, text: l.lore }] : []));
  const bonds: ExpeditionBond[] = story.flatMap((l) => (l.bond ? [{ heroes: l.bond, location, at: l.at }] : []));
  if (!journal.length && !bonds.length) return bounties;
  const next = { ...bounties };
  if (journal.length) next.journal = [...(bounties.journal ?? []), ...journal].slice(-max);
  if (bonds.length) next.bonds = [...(bounties.bonds ?? []), ...bonds].slice(-max);
  return next;
}

/** Вариант события на экране: надпись, шанс, кто из отряда подходит. */
export interface EventChoiceView {
  id: string;
  label: string;
  /** Шанс успеха для этого отряда. */
  chance: number;
  /** Нужный герой в отряде (показать его портрет); null — вариант без требований или героя нет. */
  hero: EventHero | null;
  /** Требование есть, а героя нет — «нет героя, только шанс». */
  missing: boolean;
  isDefault: boolean;
}

/** Событие экспедиции на экране. */
export interface ExpeditionEventView {
  location: string;
  index: number;
  def: ExpeditionEventDef;
  state: ExpeditionEventState;
  pending: boolean;
  /** Текст события с подстановками ({hero} — один из отряда). */
  text: string;
  choices: EventChoiceView[];
  /** Исход, если решено. */
  outcome: ExpeditionStoryLine | null;
}

/** События экспедиции, которые уже случились (к now): ждут решения или решены. */
export function expeditionEventViews(save: SaveState, locationId: string, now: number, ctx: ExpeditionEventsContext): ExpeditionEventView[] {
  const e = save.bounties.active.find((x) => x.location === locationId);
  if (!e?.events) return [];
  const party = eventParty(save, e.heroIds, ctx);
  const out: ExpeditionEventView[] = [];
  e.events.forEach((state, index) => {
    const def = eventDef(state.id, ctx.expeditionEvents);
    if (!def || (now < state.at && state.choice === undefined)) return;
    const choices = def.choices.map((c) => {
      const { chance, fits } = choiceOdds(c, party);
      return { id: c.id, label: c.label, chance, hero: fits[0] ?? null, missing: !!c.requires && !fits.length, isDefault: c.default };
    });
    const text = fillEventText(def.text, party[index % Math.max(1, party.length)], party[(index + 1) % Math.max(1, party.length)]);
    out.push({ location: locationId, index, def, state, pending: eventPending(state, now), text, choices, outcome: eventOutcome(save, e, index, ctx) });
  });
  return out;
}

/**
 * Перекрёстные проверки data/expedition_events.json: локации событий существуют, у каждой локации ≥ 3 своих событий,
 * герои в requires.hero есть в data/heroes, линии в requires.line — у кого-то из героев.
 */
export function validateExpeditionEvents(cfg: ExpeditionEventsConfig, locations: readonly { id: string }[], ctx: GameContext, problems: string[]): void {
  const locIds = new Set(locations.map((l) => l.id));
  const lines = new Set(Object.values(ctx.content.heroes).map((h) => h.line));
  for (const ev of cfg.events) {
    const at = `data/expedition_events.json: событие ${ev.id}`;
    for (const l of ev.locations) if (!locIds.has(l)) problems.push(`${at} — локация ${l} не найдена в data/expeditions.json`);
    for (const c of ev.choices) {
      for (const h of c.requires?.hero ?? []) if (!ctx.content.heroes[h]) problems.push(`${at}, вариант ${c.id} — герой ${h} не найден в data/heroes`);
      for (const l of c.requires?.line ?? []) if (!lines.has(l)) problems.push(`${at}, вариант ${c.id} — ни у одного героя нет линии ${l}`);
    }
  }
  for (const l of locations) {
    const own = cfg.events.filter((e) => e.locations.includes(l.id)).length;
    if (own < 3) problems.push(`data/expedition_events.json: у локации ${l.id} своих событий ${own} — нужно не меньше 3`);
  }
}
