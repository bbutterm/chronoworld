/**
 * Вечера в «Двух колоколах» и близость с сюжетными героями (docs/design/tavern-evenings.md).
 * Чистые функции: разбор data/story/tavern.json с проверками, доступность вечеров, выбор, близость, личные задания
 * и связки. Время и случайность — параметрами (seed боя задания даёт UI).
 */
import type { z } from 'zod';
import { simulateBattle } from '../battle';
import { enemySquad, squadUnits } from '../campaign/campaign';
import type { RawFile } from '../content/build';
import { withGear } from '../equipment/equipment';
import type { GameContext } from '../progression/types';
import type { SaveState } from '../save/schema';
import type { BattleResult, Content, UnitDef } from '../types';
import {
  EVENING_LINES_MAX,
  EVENING_LINES_MIN,
  TavernSchema,
  type BondHeroDef,
  type BondLinkDef,
  type BondQuestDef,
  type ChoiceDef,
  type EveningDef,
  type PersonalSceneDef,
  type TavernDef,
  type TavernLine,
  type TavernStep,
} from './schema';

/** Контекст с вечерами (ctx.story.tavern). Нет файла — вечеров нет. */
export interface TavernContext {
  story: { tavern?: TavernDef };
}

type Ctx = GameContext & Partial<TavernContext>;

export const tavernOfCtx = (ctx: Partial<TavernContext>): TavernDef | undefined => ctx.story?.tavern;

/** Шаг — выбор? */
export const isChoice = (s: TavernStep): s is { choice: ChoiceDef } => 'choice' in s;

/** Реплики шагов (без ответов на выбор). */
const mainLines = (steps: readonly TavernStep[]): TavernLine[] => steps.filter((s): s is TavernLine => !isChoice(s));

/**
 * Разобрать data/story/tavern.json и проверить ссылки: главы и этапы существуют, герои — сюжетные карточки, спикеры
 * объявлены, id вечеров/сцен/выборов/заданий уникальны, у вечера 8–16 реплик и не больше одного выбора, when ссылается на
 * существующий выбор и вариант (выбор — в этом же или более раннем вечере), партнёр связки — другой сюжетный герой.
 */
export function buildTavern(f: RawFile, content: Content, problems: string[], storyHeroes: readonly string[] = []): TavernDef | undefined {
  const r = (TavernSchema as z.ZodType<TavernDef>).safeParse(f.data);
  if (!r.success) {
    for (const i of r.error.issues) problems.push(`${f.file}: ${i.path.map(String).join('.') || '(корень)'} — ${i.message}`);
    return undefined;
  }
  const t = r.data;
  const p = (msg: string) => problems.push(`${f.file}: ${msg}`);
  const ids = new Set<string>();
  const unique = (x: string, where: string) => {
    if (ids.has(x)) p(`${where}: id ${x} уже занят`);
    ids.add(x);
  };
  const isStoryHero = (h: string) => (storyHeroes.length ? storyHeroes.includes(h) : !!content.heroes[h]);
  /** Выборы, объявленные до текущего места: id → варианты. */
  const choices = new Map<string, Set<string>>();
  const checkLines = (where: string, lines: readonly TavernLine[]) => {
    lines.forEach((l, j) => {
      if (!t.speakers[l.speaker]) p(`${where}: реплика ${j + 1} — спикер ${l.speaker} не объявлен в speakers`);
      if (l.when) {
        const opts = choices.get(l.when.choice);
        if (!opts) p(`${where}: реплика ${j + 1} — when ссылается на выбор ${l.when.choice}, которого нет раньше`);
        else if (l.when.is !== 'none' && !opts.has(l.when.is)) p(`${where}: реплика ${j + 1} — у выбора ${l.when.choice} нет варианта ${l.when.is}`);
      }
    });
  };
  const checkSteps = (where: string, steps: readonly TavernStep[]) => {
    for (const s of steps) {
      if (!isChoice(s)) {
        checkLines(where, [s]);
        continue;
      }
      const c = s.choice;
      unique(c.id, `${where}: выбор`);
      const opts = new Set<string>();
      for (const o of c.options) {
        if (opts.has(o.id)) p(`${where}: выбор ${c.id} — вариант ${o.id} повторяется`);
        opts.add(o.id);
        for (const h of Object.keys(o.bond)) if (!isStoryHero(h)) p(`${where}: выбор ${c.id}.${o.id} — близость с ${h}, а это не сюжетный герой`);
      }
      choices.set(c.id, opts);
      checkLines(`${where}: выбор ${c.id}`, c.options.flatMap((o) => o.reply));
    }
  };
  const chapters = new Set<string>();
  for (const e of t.evenings) {
    const where = `вечер ${e.id}`;
    unique(e.id, where);
    if (!e.id.startsWith('tav_')) p(`${where}: id вечера начинается с tav_`);
    if (!content.chapters.some((c) => c.id === e.after)) p(`${where}: глава ${e.after} не найдена в data/campaign`);
    if (chapters.has(e.after)) p(`${where}: у главы ${e.after} уже есть вечер`);
    chapters.add(e.after);
    const n = mainLines(e.steps).length;
    if (n < EVENING_LINES_MIN || n > EVENING_LINES_MAX) p(`${where}: реплик ${n}, нужно ${EVENING_LINES_MIN}–${EVENING_LINES_MAX}`);
    if (e.steps.filter(isChoice).length > 1) p(`${where}: больше одного выбора за вечер`);
    checkSteps(where, e.steps);
  }
  for (const [heroId, h] of Object.entries(t.heroes)) {
    const where = `герой ${heroId}`;
    if (!isStoryHero(heroId)) p(`${where}: не сюжетный герой (progression.heroes)`);
    unique(h.scene.id, `${where}: сцена`);
    unique(h.quest.id, `${where}: задание`);
    unique(h.link.id, `${where}: связка`);
    if (h.scene.steps.filter(isChoice).length > 1) p(`${where}: в личной сцене больше одного выбора`);
    checkSteps(`${where}: сцена ${h.scene.id}`, h.scene.steps);
    if (!content.stages.some((s) => s.id === h.quest.stage)) p(`${where}: задание ${h.quest.id} — этап ${h.quest.stage} не найден`);
    if (h.quest.after) checkLines(`${where}: задание ${h.quest.id}`, [h.quest.after]);
    if (h.link.partner === heroId || !isStoryHero(h.link.partner)) p(`${where}: связка ${h.link.id} — партнёр ${h.link.partner} должен быть другим сюжетным героем`);
  }
  if (t.bond.sceneAt > t.bond.questAt || t.bond.questAt > t.bond.max) p('bond: нужно sceneAt ≤ questAt ≤ max');
  return t;
}

// ---------- Состояние ----------

export interface TavernState {
  seen: string[];
  choices: Record<string, string>;
  bond: Record<string, number>;
  quests: string[];
}

/** Состояние вечеров из сохранения (нет поля — пусто). */
export function tavernOf(save: Pick<SaveState, 'tavern'>): TavernState {
  const t = save.tavern ?? {};
  return { seen: t.seen ?? [], choices: t.choices ?? {}, bond: t.bond ?? {}, quests: t.quests ?? [] };
}

function withTavern(save: SaveState, next: TavernState): SaveState {
  const out: NonNullable<SaveState['tavern']> = {};
  if (next.seen.length) out.seen = next.seen;
  if (Object.keys(next.choices).length) out.choices = next.choices;
  if (Object.keys(next.bond).length) out.bond = next.bond;
  if (next.quests.length) out.quests = next.quests;
  return { ...save, tavern: out };
}

/** Близость с героем (id карточки). */
export function bondOf(save: Pick<SaveState, 'tavern'>, templateId: string): number {
  return tavernOf(save).bond[templateId] ?? 0;
}

/** Прибавить близость (с потолком). Возвращает новое состояние и фактические прибавки. */
function addBond(st: TavernState, gains: Record<string, number>, max: number): { st: TavernState; got: Record<string, number> } {
  const bond = { ...st.bond };
  const got: Record<string, number> = {};
  for (const [h, d] of Object.entries(gains)) {
    const cur = bond[h] ?? 0;
    const nv = Math.min(max, cur + d);
    if (nv > cur) {
      bond[h] = nv;
      got[h] = nv - cur;
    }
  }
  return { st: { ...st, bond }, got };
}

// ---------- Вечера ----------

export type EveningStatus = 'locked' | 'new' | 'seen';

function chapterDone(save: SaveState, chapterId: string, ctx: GameContext): boolean {
  const last = ctx.content.stages.filter((s) => s.chapter === chapterId).at(-1);
  return !!last && save.campaign.cleared.includes(last.id);
}

export function findEvening(id: string, ctx: Partial<TavernContext>): EveningDef | undefined {
  return tavernOfCtx(ctx)?.evenings.find((e) => e.id === id);
}

/** Вечер: закрыт (глава не пройдена), новый или уже увиден. */
export function eveningStatus(save: SaveState, e: EveningDef, ctx: GameContext): EveningStatus {
  if (tavernOf(save).seen.includes(e.id)) return 'seen';
  return chapterDone(save, e.after, ctx) ? 'new' : 'locked';
}

/** Вечер после главы chapterId, если он открыт и ещё не увиден. */
export function pendingEvening(save: SaveState, chapterId: string, ctx: Ctx): EveningDef | undefined {
  const e = tavernOfCtx(ctx)?.evenings.find((x) => x.after === chapterId);
  return e && eveningStatus(save, e, ctx) === 'new' ? e : undefined;
}

/** Все открытые и не увиденные вечера (для отметки «новое»). */
export function newEvenings(save: SaveState, ctx: Ctx): EveningDef[] {
  return (tavernOfCtx(ctx)?.evenings ?? []).filter((e) => eveningStatus(save, e, ctx) === 'new');
}

/** Показать ли реплику: нет условия — да; when — в выборе выбран этот вариант ('none' — выбора не было). */
export function lineVisible(line: TavernLine, save: Pick<SaveState, 'tavern'>): boolean {
  if (!line.when) return true;
  const got = tavernOf(save).choices[line.when.choice];
  return line.when.is === 'none' ? got === undefined : got === line.when.is;
}

/** Выбранный вариант (или undefined). */
export function chosenOption(save: Pick<SaveState, 'tavern'>, choiceId: string): string | undefined {
  return tavernOf(save).choices[choiceId];
}

function findChoice(t: TavernDef, choiceId: string): ChoiceDef | undefined {
  const all = [...t.evenings.map((e) => e.steps), ...Object.values(t.heroes).map((h) => h.scene.steps)].flat();
  for (const s of all) if (isChoice(s) && s.choice.id === choiceId) return s.choice;
  return undefined;
}

export interface BondGains {
  save: SaveState;
  /** id карточки → на сколько выросла близость. */
  gains: Record<string, number>;
}

/**
 * Сделать выбор: записать вариант и прибавить близость. Выбор делается один раз — повторный вызов (пересмотр)
 * ничего не меняет. Неизвестный выбор или вариант — ошибка.
 */
export function chooseOption(save: SaveState, choiceId: string, optionId: string, ctx: Partial<TavernContext>): BondGains {
  const t = tavernOfCtx(ctx);
  const c = t && findChoice(t, choiceId);
  const o = c?.options.find((x) => x.id === optionId);
  if (!t || !c || !o) throw new Error(`Нет выбора ${choiceId}.${optionId}`);
  const st = tavernOf(save);
  if (st.choices[choiceId] !== undefined) return { save, gains: {} };
  const { st: next, got } = addBond({ ...st, choices: { ...st.choices, [choiceId]: optionId } }, o.bond, t.bond.max);
  return { save: withTavern(save, next), gains: got };
}

/** Сюжетные герои (id карточек), чьи копии стоят в отряде. */
export function storyHeroesInSquad(save: SaveState, ctx: Ctx): string[] {
  const t = tavernOfCtx(ctx);
  if (!t) return [];
  const inSquad = new Set(save.squad.filter((x): x is string => x !== null).map((id) => save.heroes.find((h) => h.id === id)?.templateId));
  return Object.keys(t.heroes).filter((h) => inSquad.has(h));
}

/**
 * Вечер закончен (дослушан или «Пропустить»): пометить увиденным и один раз дать близость героям отряда
 * (bond.squadGain — «прошли главу вместе»). Повторный вызов (пересмотр) ничего не меняет.
 */
export function finishEvening(save: SaveState, eveningId: string, ctx: Ctx): BondGains {
  const t = tavernOfCtx(ctx);
  const st = tavernOf(save);
  if (!t || st.seen.includes(eveningId)) return { save, gains: {} };
  const gains: Record<string, number> = {};
  if (t.evenings.some((e) => e.id === eveningId)) for (const h of storyHeroesInSquad(save, ctx)) gains[h] = t.bond.squadGain;
  const { st: next, got } = addBond({ ...st, seen: [...st.seen, eveningId] }, gains, t.bond.max);
  return { save: withTavern(save, next), gains: got };
}

/** Личная сцена показана (или пропущена). */
export function finishPersonalScene(save: SaveState, sceneId: string): SaveState {
  const st = tavernOf(save);
  if (st.seen.includes(sceneId)) return save;
  return withTavern(save, { ...st, seen: [...st.seen, sceneId] });
}

// ---------- Близость ----------

export interface BondView {
  templateId: string;
  points: number;
  max: number;
  scene: PersonalSceneDef & { at: number; open: boolean; seen: boolean };
  quest: BondQuestDef & { at: number; open: boolean; done: boolean; stageCleared: boolean };
  link: BondLinkDef & { open: boolean };
}

/** Всё о близости с героем для экранов. Нет такого героя в data — undefined. */
export function bondView(save: SaveState, templateId: string, ctx: Ctx): BondView | undefined {
  const t = tavernOfCtx(ctx);
  const h: BondHeroDef | undefined = t?.heroes[templateId];
  if (!t || !h) return undefined;
  const st = tavernOf(save);
  const points = st.bond[templateId] ?? 0;
  const done = st.quests.includes(h.quest.id);
  return {
    templateId,
    points,
    max: t.bond.max,
    scene: { ...h.scene, at: t.bond.sceneAt, open: points >= t.bond.sceneAt, seen: st.seen.includes(h.scene.id) },
    quest: { ...h.quest, at: t.bond.questAt, open: points >= t.bond.questAt, done, stageCleared: save.campaign.cleared.includes(h.quest.stage) },
    link: { ...h.link, open: done },
  };
}

/** Герои с близостью (порядок файла). */
export function bondHeroes(ctx: Partial<TavernContext>): string[] {
  return Object.keys(tavernOfCtx(ctx)?.heroes ?? {});
}

/** Что открылось, когда близость выросла с before до after: личная сцена / задание. */
export function bondUnlocks(before: number, after: number, ctx: Partial<TavernContext>): ('scene' | 'quest')[] {
  const t = tavernOfCtx(ctx);
  if (!t) return [];
  const out: ('scene' | 'quest')[] = [];
  if (before < t.bond.sceneAt && after >= t.bond.sceneAt) out.push('scene');
  if (before < t.bond.questAt && after >= t.bond.questAt) out.push('quest');
  return out;
}

/** Найти личную сцену по id (для пересмотра). */
export function findPersonalScene(sceneId: string, ctx: Partial<TavernContext>): { templateId: string; scene: PersonalSceneDef } | undefined {
  for (const [templateId, h] of Object.entries(tavernOfCtx(ctx)?.heroes ?? {})) if (h.scene.id === sceneId) return { templateId, scene: h.scene };
  return undefined;
}

// ---------- Связки ----------

/** Связки, которые действуют в отряде: задание героя выполнено, и оба героя связки стоят в отряде. */
export function activeLinks(save: SaveState, ctx: Ctx): (BondLinkDef & { owner: string })[] {
  const t = tavernOfCtx(ctx);
  if (!t) return [];
  const st = tavernOf(save);
  const inSquad = new Set(storyHeroesInSquad(save, ctx));
  return Object.entries(t.heroes)
    .filter(([owner, h]) => st.quests.includes(h.quest.id) && inSquad.has(owner) && inSquad.has(h.link.partner))
    .map(([owner, h]) => ({ ...h.link, owner }));
}

/**
 * Прибавки связок к юнитам отряда (до боя; battle.ts о связках не знает): юнит — копия героя из save.squad, id юнита =
 * id героя. Нет активных связок — тот же массив. Точка подключения для обычных боёв — squadUnits (campaign.ts).
 */
export function withBondLinks(squad: readonly (UnitDef | null)[], save: SaveState, ctx: Ctx): (UnitDef | null)[] {
  const links = activeLinks(save, ctx);
  if (!links.length) return squad as (UnitDef | null)[];
  const tmplOf = (unitId: string) => save.heroes.find((h) => h.id === unitId)?.templateId;
  return squad.map((u) => {
    if (!u) return u;
    const tid = tmplOf(u.id);
    const mine = links.filter((l) => l.owner === tid || l.partner === tid);
    if (!mine.length) return u;
    const stats = { ...u.stats };
    for (const l of mine) stats[l.stat] = Math.round(stats[l.stat] * (1 + l.pct / 100));
    return { ...u, stats };
  });
}

// ---------- Личное задание ----------

export interface BondQuestOutcome {
  save: SaveState;
  result: BattleResult;
  /** Бой выигран. */
  win: boolean;
  /** Условие задания выполнено (при победе). */
  goal: boolean;
  /** Задание выполнено впервые — награда выдана. */
  firstTime: boolean;
  /** Кто из отряда пал (id героев). */
  fallen: string[];
}

export class BondQuestError extends Error {
  constructor(
    readonly code: 'unknown' | 'locked' | 'stage' | 'hero_missing',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Личное задание героя templateId: бой ядром (отряд из сохранения со связками и экипировкой, враги этапа quest.stage ×
 * quest.mult). Нужно: близость ≥ questAt, этап пройден, герой задания в отряде. Успех — победа и условие; впервые —
 * награда (золото, гемы, свитки) и отметка в save.tavern.quests. battleSeq растёт всегда.
 */
export function fightBondQuest(save: SaveState, templateId: string, seed: number, ctx: Ctx): BondQuestOutcome {
  const v = bondView(save, templateId, ctx);
  if (!v) throw new BondQuestError('unknown', `Нет задания героя ${templateId}`);
  if (!v.quest.open) throw new BondQuestError('locked', `Задание откроется на близости ${v.quest.at}`);
  if (!v.quest.stageCleared) throw new BondQuestError('stage', 'Сначала пройдите этот этап кампании');
  if (!storyHeroesInSquad(save, ctx).includes(templateId)) throw new BondQuestError('hero_missing', 'Герой задания должен быть в отряде');
  const q = v.quest;
  const gctx = withGear(ctx, save);
  const { squad } = squadUnits(save, gctx);
  const enemies = enemySquad(q.stage, ctx).map((u) =>
    u ? { ...u, stats: { ...u.stats, hp: Math.max(1, Math.round(u.stats.hp * q.mult)), atk: Math.round(u.stats.atk * q.mult), def: Math.round(u.stats.def * q.mult) } } : u,
  );
  const result = simulateBattle(ctx.content, squad, enemies, seed, { combat: ctx.combat });
  const win = result.winner === 'A';
  const mine = save.squad.filter((x): x is string => x !== null);
  // Отчёт боя — по uid; id юнита героя = id героя, сторона игрока — A.
  const sideA = new Set(result.units.filter((u) => u.side === 'A').map((u) => u.uid));
  const alive = new Map<string, boolean>();
  for (const r of Object.values(result.report)) if (sideA.has(r.uid) && mine.includes(r.unitId)) alive.set(r.unitId, r.alive);
  const fallen = mine.filter((id) => alive.get(id) === false);
  const heroIds = save.heroes.filter((h) => h.templateId === templateId && mine.includes(h.id)).map((h) => h.id);
  const cond = q.condition;
  const goal =
    win &&
    (cond.type === 'alive' ? heroIds.some((id) => alive.get(id) === true) : cond.type === 'noLoss' ? fallen.length === 0 : result.duration <= cond.seconds);
  let next: SaveState = { ...save, battleSeq: save.battleSeq + 1 };
  const firstTime = goal && !v.quest.done;
  if (firstTime) {
    const r = q.reward;
    next = {
      ...next,
      resources: { ...next.resources, gold: next.resources.gold + (r.gold ?? 0) },
      currency: { ...next.currency, gems: next.currency.gems + (r.gems ?? 0), scrolls: next.currency.scrolls + (r.scrolls ?? 0) },
    };
    const st = tavernOf(next);
    next = withTavern(next, { ...st, quests: [...st.quests, q.id] });
  }
  return { save: next, result, win, goal, firstTime, fallen };
}
