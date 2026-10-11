import { tacticalDefeat } from './tactics';
import type { BattleResult, UnitDef } from '../core/types';
import { COMBAT } from '../core/config';

/**
 * Чистые помощники экранов (без Phaser) — их проверяют тесты tests/game-flow.test.ts.
 */
import {
  ascendAllocation,
  ascendRequirement,
  ascendPlan,
  maxLevelOf,
  canEquip,
  actEquipBest,
  heroesWithGearUpgrades,
  groupDigits,
  heroPower,
  itemScore,
  type PowerConfig,
  needsBranch,
  pendingPicks,
  heroGender,
  heroJobId,
  heroName,
  jobTitle,
  heroSpriteOverride,
  levelUpInfo,
  misplacedInFront,
  type GearContext,
  RARITIES,
  SLOTS,
  squadPower,
  finishedExpeditions,
  pendingExpeditionEvents,
  type ExpeditionContext,
  type ExpectedLoot,
  towerStatus,
  type TowerContext,
  recommendedPower as coreRecommendedPower,
  levelTone,
  squadAverageLevel,
  stageLevels,
  enemyLevels,
  enemySquad,
  recommendedFactor,
  type StageLevels,
  type CardRarity,
  type LevelTone,
  type RecommendedLevel,
  stageStatus,
  type AchievementView,
  type ActivityKind,
  type EquipmentContext,
  type FeatureContext,
  type GameContext,
  type HeroState,
  type ItemDef,
  type ItemInstance,
  type ItemStats,
  type EventRewardEvent,
  type MetaEvent,
  type MetaRewards,
  type Preset,
  type QuestStatus,
  type Rarity,
  type SaveState,
  type Slot,
  type StageInfo,
  type TowerEvent,
  featureUnlocked,
  kitchenReady,
  offlineFullInMs,
  type KitchenContext,
} from '../core';
import { genderedSpriteId } from '../pipeline/sprites';
import { badgeSeen } from './badgeSeen';
import { hasSprite } from './spriteRegistry';
import { plural } from './skillFacts';
import { C } from './theme';

export const ROLE_NAMES: Record<string, string> = { tank: 'Танк', damage: 'Урон', healer: 'Лекарь', support: 'Поддержка' };

/** Локальная дата 'YYYY-MM-DD' (для ежедневных механик). */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Seed боя этапа — детерминирован из сохранения: одно и то же сохранение даёт один и тот же бой. */
export function stageSeed(save: SaveState): number {
  return (save.createdAt ^ Math.imul(save.battleSeq + 1, 0x9e3779b1)) >>> 0;
}

/**
 * Поставить героя в слот отряда. Герой уникален: если он уже стоит в другом слоте, герои меняются местами.
 * heroId = null — убрать героя из слота. Возвращает новый массив.
 */
export function assignSlot(squad: (string | null)[], slot: number, heroId: string | null): (string | null)[] {
  const next = [...squad];
  if (heroId === null) {
    next[slot] = null;
    return next;
  }
  const existing = next.indexOf(heroId);
  if (existing >= 0) next[existing] = next[slot];
  next[slot] = heroId;
  return next;
}

/** Следующий этап кампании после stageId, если он открыт (иначе null). */
export function nextOpenStage(save: SaveState, stageId: string, ctx: GameContext): StageInfo | null {
  const cur = ctx.content.stages.find((s) => s.id === stageId);
  const next = cur ? ctx.content.stages[cur.globalIndex + 1] : undefined;
  if (!next) return null;
  return stageStatus(save, next.id, ctx) === 'locked' ? null : next;
}

/** R. Почему авто-прохождение остановилось (null — идёт дальше). */
export type AutoStop = 'defeat' | 'chapter_end' | 'no_next' | 'replay';

/**
 * R. Авто-прохождение кампании: какой этап запустить после боя на stageId, или почему остановиться.
 * Идёт только по новым этапам. Останавливается на поражении, на конце главы, если следующий этап
 * закрыт/отсутствует и если он уже пройден (повтор старого этапа не запускает цепочку повторов).
 */
export function autoNextStage(save: SaveState, stageId: string, win: boolean, ctx: GameContext): { next: StageInfo | null; stop: AutoStop | null } {
  if (!win) return { next: null, stop: 'defeat' };
  const cur = ctx.content.stages.find((s) => s.id === stageId);
  const next = nextOpenStage(save, stageId, ctx);
  if (!next) return { next: null, stop: 'no_next' };
  if (cur && next.chapter !== cur.chapter) return { next: null, stop: 'chapter_end' };
  if (stageStatus(save, next.id, ctx) === 'cleared') return { next: null, stop: 'replay' };
  return { next, stop: null };
}

/** Герои отряда, которых можно «Улучшить» прямо сейчас (хватает опыта пула и золота, не предел). */
export function levelUpReady(save: SaveState, ctx: GameContext): HeroState[] {
  return save.heroes.filter((h) => save.squad.includes(h.id) && ctx.content.heroes[h.templateId] && levelUpInfo(save, h.id, ctx).canLevel);
}

/** Карточки, которые можно вознести прямо сейчас: хватает золота и отдельных свободных копий на все слоты. */
export function ascendReady(save: SaveState, ctx: GameContext): HeroState[] {
  return save.heroes.filter((h) => {
    if (!ctx.content.heroes[h.templateId]) return false;
    const req = ascendRequirement(save, h.id, ctx);
    return !!req && req.blockers.length === 0 && ascendPlan(save, h.id, ctx)?.complete === true;
  });
}

/**
 * Повод для красной точки «Герои» (§2.4 docs/design/ui-polish-research.md): только «можно сделать выгодное сейчас» и
 * только про отряд — вознести, выбрать ветку (бесплатно), поднять уровень за опыт из запаса; плюс «Контракт героя»
 * (герой на выбор — забрать). «Вещь получше» и «новая история» точку вкладки не зажигают — это метки на карточке.
 * key — для «уже видел» (badgeSeen.ts): ту же строку ставит карточка героя (heroCard.ts), когда рисует метку.
 */
export interface HeroAlert {
  kind: 'pick' | 'ascend' | 'branch' | 'level';
  heroId?: string;
  key: string;
}

/** Ключ «уже видел» повода героя: смена уровня или редкости — новый повод. */
export function heroAlertKey(kind: 'ascend' | 'level', hero: Pick<HeroState, 'id' | 'level' | 'rarity'>): string {
  return kind === 'ascend' ? `asc:${hero.id}:${hero.rarity}` : `lvl:${hero.id}:${hero.level}`;
}

/** Все поводы «Героев» сейчас (без учёта «уже видел»): по одному на героя отряда — самый важный. */
export function heroAlerts(save: SaveState, ctx: GameContext): HeroAlert[] {
  const out: HeroAlert[] = pendingPicks(save).map((p, i) => ({ kind: 'pick' as const, key: `pick:${i}:${p.rarity}` }));
  const squad = save.heroes.filter((h) => save.squad.includes(h.id) && ctx.content.heroes[h.templateId]);
  if (!squad.length) return out;
  // Вознести — только столько героев отряда, сколько можно вознести одновременно: одна лишняя копия не зажигает повод у
  // каждого героя (ascendAllocation, приоритет — порядок в отряде). Метка на карточке (ascendReady) — у всех кандидатов.
  const order = squad.map((h) => h.id).sort((a, b) => save.squad.indexOf(a) - save.squad.indexOf(b));
  const ready = new Set(ascendAllocation(save, order, ctx).map((a) => a.heroId));
  for (const h of squad) {
    if (ready.has(h.id)) out.push({ kind: 'ascend', heroId: h.id, key: heroAlertKey('ascend', h) });
    else if (needsBranch(h, ctx)) out.push({ kind: 'branch', heroId: h.id, key: `branch:${h.id}` });
    else if (levelUpInfo(save, h.id, ctx).canLevel) out.push({ kind: 'level', heroId: h.id, key: heroAlertKey('level', h) });
  }
  return out;
}

/**
 * Сколько поводов «Героев» игрок ещё не видел. Контракт и ветка гаснут только делом (забрать / выбрать); вознести и
 * «Улучшить» — ещё и когда игрок посмотрел на карточку с меткой (seen), пока не сменятся уровень или редкость.
 */
export function heroesBadgeCount(save: SaveState, ctx: GearContext & GameContext, seen: (key: string) => boolean = () => false): number {
  return heroAlerts(save, ctx).filter((a) => a.kind === 'pick' || a.kind === 'branch' || !seen(a.key)).length;
}

/**
 * Значок вкладки «Герои» — всегда точка (вкладка числа не показывает, §2.4). Тип { kind: 'count' } оставлен для
 * screen.ts (рисует dot); зелёная стрелка «levelUp» больше не возвращается — «Улучшить» тоже точка, одна на вкладку.
 */
export type HeroesNavBadge = { kind: 'count'; count: number } | { kind: 'levelUp' } | null;

export function heroesNavBadge(save: SaveState, ctx: GearContext & GameContext, seen: (key: string) => boolean = badgeSeen): HeroesNavBadge {
  const count = heroesBadgeCount(save, ctx, seen);
  return count > 0 ? { kind: 'count', count } : null;
}

/** Значок-повод на карточке героя (heroCard.ts): один, по приоритету (§2.4 п. 5). */
export type HeroCardMark = 'ascend' | 'branch' | 'level' | 'gear' | 'story' | 'new';

/** Какой единственный значок-повод показать: вознести > ветка > улучшить > вещь получше > новая история > новый. */
export function heroCardMark(o: { canAscend?: boolean; needsBranch?: boolean; canLevel?: boolean; gearUpgrade?: boolean; storyNew?: boolean; isNew?: boolean }): HeroCardMark | null {
  if (o.canAscend) return 'ascend';
  if (o.needsBranch) return 'branch';
  if (o.canLevel) return 'level';
  if (o.gearUpgrade) return 'gear';
  if (o.storyNew) return 'story';
  if (o.isNew) return 'new';
  return null;
}

/** Этап, на который стоит вести игрока: первый не пройденный открытый, иначе последний. */
export function currentStage(save: SaveState, ctx: GameContext): StageInfo | undefined {
  const stages = ctx.content.stages;
  return stages.find((s) => stageStatus(save, s.id, ctx) === 'open') ?? stages[stages.length - 1];
}

/** Строки для экрана итогов/тоста по событиям прогрессии. */
export function describeEvents(events: readonly (TowerEvent | MetaEvent | EventRewardEvent)[], save: SaveState, ctx: GameContext): string[] {
  const nameOf = (id: string) => {
    const h = save.heroes.find((x) => x.id === id);
    return h ? heroName(h, ctx) : id;
  };
  const skillName = (id: string) => ctx.content.skills[id]?.name ?? id;
  // Профессия по полу героя события («теперь Жрица!», не «Жрец»).
  const jobName = (id: string, heroId?: string) => {
    const h = heroId ? save.heroes.find((x) => x.id === heroId) : undefined;
    return jobTitle(ctx, id, h ? heroGender(h, ctx) : 'm');
  };
  const rarityName = (id: string) => ctx.cards.rarities.find((r) => r.id === id)?.name ?? id;
  const lines: string[] = [];
  // Несколько level-up подряд у одного героя — одна строка с итоговым уровнем.
  const levels = new Map<string, { from: number; to: number }>();
  for (const e of events) {
    if (e.type !== 'levelUp') continue;
    const l = levels.get(e.heroId);
    levels.set(e.heroId, { from: Math.min(l?.from ?? Infinity, e.level - 1), to: Math.max(l?.to ?? 0, e.level) });
  }
  for (const [heroId, l] of levels) lines.push(`${nameOf(heroId)}: ур. ${l.from} → ${l.to}`);
  for (const e of events) {
    if (e.type === 'skillUnlocked') lines.push(`${nameOf(e.heroId)}: новый навык «${skillName(e.skill)}»`);
    if (e.type === 'heroJoined') lines.unshift(
      e.copy
        ? `${e.name}: пришла копия героя (для вознесения)` +
            (e.caughtUp ? ` — лучшая карточка героя теперь ур. ${e.level}, как у отряда` : '') +
            (e.benched ? ' · поставьте в отряд: «Герои» или «Авто»' : '')
        : e.benched
          ? `${e.name} с вами${e.level && e.level > 1 ? ` (ур. ${e.level})` : ''} — поставьте в отряд: «Герои» или «Авто» перед боем`
          : `Новый герой в отряде: ${e.name}${e.level && e.level > 1 ? ` (ур. ${e.level})` : ''}!`,
    );
    if (e.type === 'ascended') lines.push(`${nameOf(e.heroId)}: ${rarityName(e.from)} → ${rarityName(e.to)}${e.jobChanged ? ` — теперь ${jobName(e.job, e.heroId)}!` : ''}`);
    if (e.type === 'heroCard') lines.push(`Карта героя: ${e.name} (${rarityName(e.rarity)})`);
    if (e.type === 'heroPick') lines.push(`Контракт героя: ${rarityName(e.rarity).toLowerCase()} герой на выбор — «Герои»`);
    if (e.type === 'branchChosen') lines.push(`${nameOf(e.heroId)}: ветка — ${jobName(e.branch, e.heroId)}${e.gems ? ` (−${formatNumber(e.gems)} гемов)` : ''}`);
    if (e.type === 'blessedOre') lines.push(`Благословенная руда ×${e.count}`);
    if (e.type === 'tavernUnlocked') lines.unshift(`Открыта Таверна! Подарок: гемы +${formatNumber(e.gems)}, свитки призыва +${e.scrolls}`);
    if (e.type === 'stageUnlocked') {
      const s = ctx.content.stages.find((x) => x.id === e.stageId);
      if (s) lines.push(`Открыт этап ${stageNo(s, ctx)}: ${s.name}`);
    }
  }
  const gems = events.reduce((sum, e) => sum + (e.type === 'gems' ? e.amount : 0), 0);
  if (gems > 0) lines.unshift(`Гемы +${formatNumber(gems)}`);
  return lines;
}

/**
 * P10 (T1-09). Порядок строк итогов: сначала ключевые события — новый герой, Таверна, вознесение, новые навыки,
 * рост уровня, — затем остальное (осколки, открытые этапы, гемы…). Внутри группы порядок сохраняется.
 */
export function keyEventsFirst(lines: readonly string[]): string[] {
  const rank = (l: string) =>
    l.startsWith('Новый герой') ? 0 : l.startsWith('Открыта Таверна') ? 1 : l.includes(' → ') && !l.includes(': ур. ') ? 1 : l.includes('новый навык') ? 2 : l.includes(': ур. ') ? 3 : 4;
  return lines.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).map((x) => x.l);
}

/** Десятичная дробь по-русски: 1.5 → «1,5» (digits — знаков после запятой; без него — как есть). */
export function decimal(n: number, digits?: number): string {
  return (digits === undefined ? String(n) : n.toFixed(digits)).replace('.', ',');
}

/** «Ур. 4 / 20» (без max — «Ур. 4»). */
export function levelText(level: number, max?: number): string {
  return `Ур. ${level}${max === undefined ? '' : ` / ${max}`}`;
}

/** Опыт в запасе (пул) и сколько уровней он даст отряду: подпись для экранов. */
export function poolText(save: SaveState): string {
  return `Опыт в запасе: ${formatNumber(save.resources.heroExp)}`;
}

/** RN-10. Герои отряда, которым в сумке есть вещи лучше надетых. */
export function squadGearUpgrades(save: SaveState, ctx: GearContext): string[] {
  return heroesWithGearUpgrades(save, ctx).filter((id) => save.squad.includes(id));
}

/** RN-10. «Надеть лучшее» всему отряду (по порядку слотов): сколько вещей надето. */
export function equipBestSquad(save: SaveState, ctx: GearContext): { save: SaveState; equipped: number } {
  let s = save;
  let equipped = 0;
  for (const id of save.squad) {
    if (!id) continue;
    const r = actEquipBest(s, id, ctx);
    s = r.save;
    equipped += r.equipped.length;
  }
  return { save: s, equipped };
}

/**
 * P10 (T1-07). Совет после поражения на этапе — по делу, по порядку пользы:
 * вещи получше в инвентаре → «Улучшить» (хватает опыта) → вознесение → стрелки во фронте → свободные слоты при
 * запасных героях → прокачка. action — куда ведёт кнопка совета.
 */
export function defeatAdvice(save: SaveState, ctx: GearContext & GameContext, battle?: { result: BattleResult; defs: Record<string, UnitDef> }): { text: string; action: 'EquipBest' | 'Heroes' | 'Squad' | 'Campaign' } {
  const tactic = battle ? tacticalDefeat(battle.result, battle.defs, { content: ctx.content, combat: ctx.combat ?? COMBAT }) : null;
  if (tactic) return { text: `${tactic.text} ${tactic.advice}`, action: 'Squad' };
  // RN-10: только герои отряда (вещи «получше» для запасных ур. 1 в бою не помогут); кнопка «Надеть лучшее» — прямо на итогах.
  if (squadGearUpgrades(save, ctx).length) return { text: 'В сумке есть вещи получше для отряда — «Надеть лучшее» ниже.', action: 'EquipBest' };
  if (levelUpReady(save, ctx).length) return { text: 'Опыта хватает на новый уровень — «Герои» → герой → «Улучшить».', action: 'Heroes' };
  if (ascendReady(save, ctx).some((h) => save.squad.includes(h.id))) return { text: 'Герой отряда готов к вознесению — оно сильно его усилит («Герои»).', action: 'Heroes' };
  if (misplacedInFront(save, ctx).length) return { text: 'Стрелки и лекари стоят во фронте — «Отряд» → «Переставить».', action: 'Squad' };
  const free = save.heroes.filter((h) => !save.squad.includes(h.id)).length;
  if (free > 0 && save.squad.includes(null)) return { text: 'В отряде есть пустые места — возьмите всех героев («Отряд»).', action: 'Squad' };
  // RR-02: отряд упёрся в пределы уровней редкостей — «ждите и прокачивайте» не поможет: нужны копии и вознесение.
  if (squadAtLevelCap(save, ctx)) {
    const canAscendFurther = save.heroes.some((h) => save.squad.includes(h.id) && ascendRequirement(save, h.id, ctx) !== null);
    if (canAscendFurther) return { text: 'Отряд на пределе уровней своих редкостей. Героям ниже максимальной редкости нужны копии и «Вознести» («Герои»).', action: 'Heroes' };
    return { text: 'Отряд на пределе уровней и редкости. Попробуйте другую расстановку и сочетание навыков («Отряд»).', action: 'Squad' };
  }
  return { text: 'Прокачайте героев: заберите сундук и быстрые награды в кампании, затем «Улучшить».', action: 'Campaign' };
}

/** Куда ведёт совет стены (касание строки): экран игры или никуда (только подождать). */
export type WallAction = 'Heroes' | 'Kitchen' | 'Adventure' | 'Campaign' | null;

/**
 * Аудит 11.10 (ux 1): «стена» — мощи отряда меньше рекомендуемой для этапа. Игра говорит, что делать сейчас, по порядку
 * пользы: уровни из запаса опыта → вещи получше → вознесение → блюдо дня → сундук (полон — забрать; нет — через
 * сколько он наполнится, а пока Башня и Охота). Мощи хватает — null (стены нет, говорить нечего). Без новых полей
 * сохранения: всё из текущего состояния; now и day передаёт экран (ядро детерминировано).
 */
export function wallAdvice(save: SaveState, stageId: string, ctx: GearContext & GameContext, now: number, day: string): { text: string; action: WallAction } | null {
  const needs = stageNeeds(save, stageId, ctx, day);
  if (needs.own >= needs.power) return null;
  const inSquad = (h: HeroState) => save.squad.includes(h.id);
  if (levelUpReady(save, ctx).some(inSquad)) return { text: 'Опыта хватает на уровни: «Герои» → герой → «Улучшить».', action: 'Heroes' };
  if (squadGearUpgrades(save, ctx).length) return { text: 'В сумке есть вещи получше: «Герои» → «Надеть лучшее».', action: 'Heroes' };
  if (ascendReady(save, ctx).some(inSquad)) return { text: 'Герой отряда готов к вознесению: «Герои» → «Вознести».', action: 'Heroes' };
  if (kitchenReady(save, day, ctx as unknown as KitchenContext)) return { text: 'Блюдо дня не готово: Кухня в «Городе» усилит отряд на сегодня.', action: 'Kitchen' };
  const fullIn = offlineFullInMs(save, now, ctx);
  if (fullIn !== null && fullIn <= 0) return { text: 'Сундук полон: заберите добычу в «Кампании» — опыт на новые уровни.', action: 'Campaign' };
  const meanwhile = featureUnlocked(save, 'tower', ctx);
  if (fullIn !== null) {
    const wait = `Сундук наполнится через ${durationText(fullIn / 60_000)} — вернитесь за опытом.`;
    return meanwhile ? { text: `${wait} А пока — Башня и Охота.`, action: 'Adventure' } : { text: wait, action: null };
  }
  return { text: 'Мощи мало: копите опыт и возвращайтесь — сундук кампании копит его без вас.', action: null };
}

/** RR-02. Все герои отряда — на пределе уровня своей редкости (опыт уже не поднимет никому уровень). */
export function squadAtLevelCap(save: SaveState, ctx: GameContext): boolean {
  const squad = save.squad.map((id) => save.heroes.find((h) => h.id === id)).filter((h): h is HeroState => !!h);
  const capped = squad.filter((h) => h.level >= maxLevelOf(ctx, h.rarity)).length;
  return squad.length > 0 && capped === squad.length;
}

/**
 * id спрайта героя: свой лист карточки (visual.sprite формы или шаблона: knight_m, priest_f…), если он есть в реестре;
 * иначе лист класса карточки (с учётом формы) по полу — `<спрайт класса>_f` / `_m`, если такой есть, иначе базовый лист
 * класса (он одного пола — см. genderedSpriteId). has — проверка реестра (для тестов).
 */
export function heroSprite(hero: HeroState, ctx: GameContext, has: (id: string) => boolean = hasSprite): string {
  const own = heroSpriteOverride(hero, ctx);
  if (own && has(own)) return own;
  const job = ctx.content.heroes[hero.templateId] ? heroJobId(hero, ctx) : 'novice';
  const base = ctx.content.jobs[job]?.visual.sprite ?? job;
  return genderedSpriteId(base, heroGender(hero, ctx), has);
}

// ---------- K2. Мощь ----------

/** Сравнение мощи отряда с противником: не слабее / чуть слабее (до 20%) / намного слабее. */
export type PowerTone = 'ahead' | 'close' | 'behind';

export function powerTone(squad: number, enemy: number): PowerTone {
  if (squad >= enemy) return 'ahead';
  return squad >= enemy * 0.8 ? 'close' : 'behind';
}

export const POWER_COLORS: Record<PowerTone, string> = { ahead: C.positive, close: C.gold, behind: C.dangerStrong };
/** Числовые цвета тех же тонов (обводки, подложки плашек). */
export const POWER_TINTS: Record<PowerTone, number> = { ahead: 0x3fae4f, close: 0xd6a92a, behind: 0xc2402f };
/** Мощь сравнивает характеристики; роли и контригра определяют исход боя отдельно. */
export const POWER_VERDICT: Record<PowerTone, string> = { ahead: 'Выше ориентира', close: 'Близко к ориентиру', behind: 'Ниже ориентира' };

/**
 * Рекомендуемая мощь этапа — из баланса (`recommendedPower` ядра, `data/progression.json` → power.recommended):
 * ориентир развития характеристик. Не является прогнозом победы конкретного состава.
 */
export function recommendedPower(stageId: string, ctx: FeatureContext, choices?: SaveState['campaignChoices']): number {
  return coreRecommendedPower(stageId, ctx, choices);
}

// ---------- Уровни врагов (core/features/levels.ts) ----------

/** Цвет уровня врага против среднего уровня отряда: выше больше чем на 5 — красный, выше — жёлтый, иначе белый. */
export const LEVEL_COLORS: Record<LevelTone, string> = { red: C.dangerStrong, yellow: C.gold, white: C.text };

/** Редкость во множественном числе — для «герои ур. 18 (синие)». */
export const RARITY_PLURAL: Record<CardRarity, string> = { green: 'зелёные', blue: 'синие', purple: 'фиолетовые', gold: 'золотые', red: 'красные' };

/** Цвет уровня врага для отряда из сохранения (средний уровень героев в save.squad). */
export function enemyLevelColor(level: number, save: Pick<SaveState, 'squad' | 'heroes'>): string {
  return LEVEL_COLORS[levelTone(level, squadAverageLevel(save))];
}

/**
 * RN-11. Редкость отряда для уровней врагов: самая частая среди героев отряда (при равенстве — ниже). Уровень врага —
 * «герой этой редкости такого же уровня»: так «ур. 12» у врага и «ур. 12» у ваших героев — одно и то же, а не уровень
 * синего героя против зелёного отряда (глава 2: «враги ур. 1, а бьют отряд ур. 6»). Пустой отряд — null.
 */
export function squadRarity(save: Pick<SaveState, 'squad' | 'heroes'>): CardRarity | null {
  const count = new Map<CardRarity, number>();
  for (const id of save.squad) {
    const h = id ? save.heroes.find((x) => x.id === id) : undefined;
    if (h) count.set(h.rarity, (count.get(h.rarity) ?? 0) + 1);
  }
  let best: CardRarity | null = null;
  for (const r of ['green', 'blue', 'purple', 'gold', 'red'] as const) {
    const n = count.get(r) ?? 0;
    if (n > 0 && (best === null || n > (count.get(best) ?? 0))) best = r;
  }
  return best;
}

/** RR-16: рекомендация уровня «по своему отряду». own — посчитана по героям игрока; capped — не хватает и на пределах редкостей. */
export type StageRecommend = RecommendedLevel & { own?: boolean; capped?: boolean };

/**
 * RR-16. Уровень, до которого нужно поднять героев отряда игрока (те же герои, редкости и вещи; каждый — не выше предела
 * своей редкости), чтобы мощь отряда дошла до рекомендуемой мощи этапа. Это та же проверка, что «Сил хватает / Нужно N»,
 * только в уровнях: «Сил хватает» ⇔ средний уровень отряда ≥ этого. null — пустой отряд.
 */
export function ownRecommendedLevel(save: Pick<SaveState, 'squad' | 'heroes' | 'campaignChoices'>, stageId: string, ctx: FeatureContext): { level: number; capped: boolean } | null {
  const squad = save.squad.map((id) => save.heroes.find((h) => h.id === id)).filter((h): h is HeroState => !!h);
  if (!squad.length) return null;
  const need = coreRecommendedPower(stageId, ctx, save.campaignChoices);
  const full = 'inventory' in save ? (save as SaveState) : undefined;
  const powerAt = (level: number) => squad.reduce((sum, h) => sum + heroPower({ ...h, level: Math.min(level, maxLevelOf(ctx as GameContext, h.rarity)) }, ctx, full), 0);
  const top = Math.max(...squad.map((h) => maxLevelOf(ctx as GameContext, h.rarity)));
  if (powerAt(top) < need) return { level: top, capped: true };
  let lo = 1;
  let hi = top;
  if (powerAt(1) >= need) return { level: 1, capped: false };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (powerAt(mid) >= need) hi = mid;
    else lo = mid;
  }
  return { level: hi, capped: false };
}

/**
 * RN-11 / RR-16. Уровни этапа для отряда игрока — одна шкала на экране этапа и в бою. Рекомендация — уровень героев
 * отряда игрока, при котором их мощь = рекомендуемой (ownRecommendedLevel: «Сил хватает» ⇔ уровень отряда не ниже).
 * Уровни врагов — в редкости отряда (squadRarity) и сдвинуты так, что типичный враг этапа = этому уровню (shift;
 * разница между врагами — как у ядра). Раньше на одном экране были «враги ур. 30–40», «Сил хватает 128 %» и
 * «Фиолетовые герои ур. 6» у синего отряда ур. 24. Пустой отряд — как в ядре (полоса этапа).
 */
export function stageLevelsFor(save: Pick<SaveState, 'squad' | 'heroes' | 'campaignChoices'>, stageId: string, ctx: FeatureContext): StageLevels & { shift: number; recommended: StageRecommend } {
  const base = stageLevels(stageId, ctx, save.campaignChoices);
  const rarity = squadRarity(save);
  const own = ownRecommendedLevel(save, stageId, ctx);
  if (!rarity || !own) return { ...base, shift: 0 };
  const raw = rarity === base.rarity ? base : { ...base, rarity, ...enemyLevels(enemySquad(stageId, ctx, save.campaignChoices), rarity, ctx, recommendedFactor(stageId, ctx, save.campaignChoices), save.campaignChoices) };
  // На пределах редкостей сил не хватает — враги без сдвига (честно «выше» отряда), рекомендация — «нужны копии».
  const shift = own.capped ? 0 : own.level - raw.typical;
  const lv = (l: number) => Math.max(1, l + shift);
  return {
    ...raw,
    recommended: { level: own.level, rarity, squad: save.squad.filter(Boolean).length, own: true, ...(own.capped ? { capped: true } : {}) },
    enemies: raw.enemies.map((l) => (l === null ? null : lv(l))),
    typical: lv(raw.typical),
    ...(raw.boss !== undefined ? { boss: lv(raw.boss) } : {}),
    shift,
  };
}

/** «ур. 18» — подпись уровня врага. */
export function levelLabel(level: number): string {
  return `ур. ${level}`;
}

/** «Синие герои ур. 18» — рекомендуемый уровень этапа (под «Нужно N» на экране этапа). */
export function recommendText(rec: Pick<StageRecommend, 'level' | 'rarity' | 'own' | 'capped'>): string {
  // RR-16: по своему отряду — «Героям нужен ур. 17»; на пределах редкостей — копии и вознесение (RR-02).
  if (rec.capped) return 'Уровней не хватит — нужны копии и «Вознести»';
  if (rec.own) return `Героям нужен ур. ${rec.level}`;
  // RN-11: редкость — словом впереди («синие герои ур. 18»), а не пометкой в скобках, которую новичок не читал.
  const r = RARITY_PLURAL[rec.rarity];
  return `${r.charAt(0).toUpperCase()}${r.slice(1)} герои ур. ${rec.level}`;
}

/**
 * Что этап требует от отряда — для экрана этапа (итерация 4 полировки, правило 11: требования — только при нехватке).
 * power — нужная мощь, own — мощь отряда, enemyLevel — типичный враг этапа в уровнях героев отряда (одно число вместо
 * «ур. N» у каждого врага: у врагов разброс по hp·atk в десятки уровней, после сдвига к отряду слабые упирались в
 * «ур. 1» рядом с «ур. 17» у танка — выглядело случайным). short — только когда мощи не хватает: до какого уровня
 * поднять героев отряда (capped — и пределов редкостей не хватит).
 * day — день боя: own — с блюдом дня Кухни, как в бою кампании (squadPower). Уровни (enemyLevel, short) — без блюда:
 * та же шкала, что у подписей врагов в бою (stageLevelsFor), с блюдом нужный уровень только ниже.
 */
export interface StageNeeds {
  power: number;
  own: number;
  enemyLevel: number;
  short?: { level: number; capped?: boolean };
}

export function stageNeeds(save: SaveState, stageId: string, ctx: FeatureContext & EquipmentContext, day?: string): StageNeeds {
  const own = squadPower(save, ctx, day);
  const power = recommendedPower(stageId, ctx, save.campaignChoices);
  const lv = stageLevelsFor(save, stageId, ctx);
  const rec = lv.recommended;
  const short = own < power && rec.own ? { level: rec.level, ...(rec.capped ? { capped: true } : {}) } : undefined;
  return { power, own, enemyLevel: lv.typical, ...(short ? { short } : {}) };
}

/** Подпись под мощью при нехватке (коротко, ≤ 26 символов): «Героям нужен ур. 30» / «Нужны копии и «Вознести»». */
export function shortfallHint(short: { level: number; capped?: boolean }): string {
  return short.capped ? 'Нужны копии и «Вознести»' : `Героям нужен ур. ${short.level}`;
}

/** Мощь текущего отряда против рекомендуемой мощи этапа: числа, тон (цвет) и подпись для плашек. */
export interface PowerCheck {
  squad: number;
  recommended: number;
  tone: PowerTone;
  verdict: string;
}

/** day — день боя: мощь отряда с блюдом дня Кухни (как stageNeeds). */
export function powerCheck(save: SaveState, stageId: string, ctx: FeatureContext & EquipmentContext, day?: string): PowerCheck {
  const squad = squadPower(save, ctx, day);
  const recommended = recommendedPower(stageId, ctx, save.campaignChoices);
  const tone = powerTone(squad, recommended);
  return { squad, recommended, tone, verdict: POWER_VERDICT[tone] };
}

// ---------- Плашка игрока (шапка главной) ----------

/**
 * «Уровень лагеря» — уровень игрока, выведенный из прогресса (своего поля в сохранении нет): опыт лагеря =
 * CAMP_EXP.stage за каждый пройденный этап + CAMP_EXP.floor за этаж башни + CAMP_EXP.heroLevel за каждый уровень
 * героев сверх первого. Уровень L → L+1 стоит campLevelCost(L) (растёт линейно): первые уровни — за пару этапов.
 */
export const CAMP_EXP = { stage: 100, floor: 40, heroLevel: 10 } as const;

export function campLevelCost(level: number): number {
  return 200 + 100 * (level - 1);
}

export interface CampLevel {
  level: number;
  /** Опыт внутри текущего уровня и сколько нужно до следующего. */
  exp: number;
  need: number;
  /** Весь опыт лагеря. */
  total: number;
}

export function campLevel(save: SaveState): CampLevel {
  const stages = new Set(save.campaign.cleared).size;
  const heroLevels = save.heroes.reduce((sum, h) => sum + Math.max(0, h.level - 1), 0);
  const total = stages * CAMP_EXP.stage + save.tower.floor * CAMP_EXP.floor + heroLevels * CAMP_EXP.heroLevel;
  let level = 1;
  let rest = total;
  while (rest >= campLevelCost(level)) {
    rest -= campLevelCost(level);
    level++;
  }
  return { level, exp: rest, need: campLevelCost(level), total };
}

/** Лицо лагеря (аватар в шапке главной): первый герой отряда, иначе самый прокачанный. */
export function leadHero(save: SaveState): HeroState | undefined {
  for (const id of save.squad) {
    const h = id === null ? undefined : save.heroes.find((x) => x.id === id);
    if (h) return h;
  }
  return [...save.heroes].sort((a, b) => b.level - a.level)[0];
}

/** Число с разбивкой по разрядам: 12345 → «12 345». */
export function formatNumber(n: number): string {
  // LT-13: разряды — неразрывным пробелом (core groupDigits): перенос строки внутри числа невозможен.
  return groupDigits(n);
}

/**
 * MT-05 / NB-10: номер этапа «глава-этап», как в AFK Arena («2-5») — один формат на карте, в «В бой», в баннерах и
 * замках. Номер в главе — по месту в списке главы (index), а не по id: этапы вставляют в середину главы.
 */
export function stageNo(stage: { chapter: string; index: number }, ctx: { content: { chapters: readonly { id: string; order: number }[] } }): string {
  // Номер главы — на маршруте (order): после главы 8 идёт «10-1», пока глава 9 не написана.
  const ch = ctx.content.chapters.find((c) => c.id === stage.chapter);
  return `${ch?.order ?? 1}-${stage.index + 1}`;
}

// ---------- K6. Экипировка ----------

export const SLOT_NAMES: Record<Slot, string> = { weapon: 'Оружие', armor: 'Доспех', helmet: 'Шлем', boots: 'Обувь' };
export const RARITY_NAMES: Record<Rarity, string> = { common: 'Обычный', rare: 'Редкий', epic: 'Эпический' };
export const RARITY_COLORS: Record<Rarity, string> = { common: '#e6e2d6', rare: '#6fb8ff', epic: '#d890ff' };
export const RARITY_TINTS: Record<Rarity, number> = { common: 0x8a8f99, rare: 0x3d7fd6, epic: 0x9a4fd0 };

export const STAT_KEYS = ['hp', 'atk', 'def', 'spd'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
/** Короткие подписи статов — одни на все экраны: ОЗ (очки здоровья), АТК, ЗАЩ, СКР (скорость). */
export const STAT_LABELS: Record<StatKey, string> = { hp: 'ОЗ', atk: 'АТК', def: 'ЗАЩ', spd: 'СКР' };

/** «ОЗ 450 · АТК 40 · ЗАЩ 12 · СКР 95» — все четыре стата (или только keys). */
export function statsLine(stats: Partial<Record<StatKey, number>>, sep = ' · ', keys: readonly StatKey[] = STAT_KEYS): string {
  return keys.map((k) => `${STAT_LABELS[k]} ${stats[k] ?? 0}`).join(sep);
}

/** «+18 АТК · +3 СКР» (нулевые статы не пишем). */
export function itemStatsText(stats: ItemStats): string {
  const parts = STAT_KEYS.filter((k) => (stats[k] ?? 0) > 0).map((k) => `+${stats[k]} ${STAT_LABELS[k]}`);
  return parts.length ? parts.join(' · ') : 'без статов';
}

/** Разница статов при замене current на candidate (только ненулевые, по порядку ОЗ АТК ЗАЩ СКР). */
export function statDiff(current: ItemStats | undefined, candidate: ItemStats): { stat: string; delta: number }[] {
  return STAT_KEYS.map((k) => ({ stat: STAT_LABELS[k], delta: (candidate[k] ?? 0) - (current?.[k] ?? 0) })).filter((d) => d.delta !== 0);
}

/** «+4 АТК  −2 СКР» или «без изменений». */
export function diffText(diff: { stat: string; delta: number }[]): string {
  if (!diff.length) return 'без изменений';
  return diff.map((d) => `${d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)} ${d.stat}`).join('  ');
}

/** Веса мощи совпадают с «Надеть лучшее»; смешанные изменения статов не красим как однозначный выигрыш. */
export function equipmentComparison(current: ItemStats | undefined, candidate: ItemStats, power: PowerConfig): { text: string; tone: 'positive' | 'negative' | 'neutral'; gain: number } {
  const diff = statDiff(current, candidate);
  const gain = itemScore({ stats: candidate }, power) - itemScore({ stats: current ?? {} }, power);
  const up = diff.some((d) => d.delta > 0);
  const down = diff.some((d) => d.delta < 0);
  const tone = gain > 0 && up && !down ? 'positive' : gain < 0 && down && !up ? 'negative' : 'neutral';
  const powerText = `${gain > 0 ? '+' : gain < 0 ? '−' : ''}${decimal(Number(Math.abs(gain).toFixed(2)))} мощь`;
  return { text: `${powerText} · ${diffText(diff)}`, tone, gain };
}

export interface InventoryRow {
  instance: ItemInstance;
  /** Нет описания — предмет пропал из data/items (статов не даёт, не надевается). */
  def?: ItemDef;
  /** Имя героя, на котором предмет, или null. */
  wornBy: string | null;
}

/**
 * Предметы инвентаря для экрана: фильтр по слоту, сначала эпические, потом по слоту и имени.
 * Неизвестные контенту предметы — в конце.
 */
export function inventoryRows(save: SaveState, ctx: EquipmentContext, slot?: Slot): InventoryRow[] {
  const name = (id: string | null) => {
    const h = id === null ? undefined : save.heroes.find((x) => x.id === id);
    return id === null ? null : h ? heroName(h, ctx) : id;
  };
  const rows = save.inventory.items
    .map((instance): InventoryRow => ({ instance, def: ctx.equipment.items[instance.itemId], wornBy: name(instance.equippedBy) }))
    .filter((r) => !slot || r.def?.slot === slot);
  const rank = (r: InventoryRow) => (r.def ? RARITIES.length - RARITIES.indexOf(r.def.rarity) : 99);
  return rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      SLOTS.indexOf(a.def?.slot ?? 'boots') - SLOTS.indexOf(b.def?.slot ?? 'boots') ||
      (a.def?.name ?? a.instance.itemId).localeCompare(b.def?.name ?? b.instance.itemId, 'ru') ||
      a.instance.id.localeCompare(b.instance.id),
  );
}

/** Можно ли надеть предмет из строки инвентаря на героя: причина отказа или null. */
export function equipBlocker(row: InventoryRow, hero: HeroState, ctx: GameContext): string | null {
  if (!row.def) return 'предмета больше нет в игре';
  if (!canEquip(hero, row.def, ctx)) return `только для: ${(row.def.jobs ?? []).map((j) => ctx.content.jobs[j]?.name ?? j).join(', ')}`;
  return null;
}

// ---------- K5. Задания ----------

/** Сколько наград можно забрать сейчас: выполненные задания + достигнутые пороги активности. */
export function claimableCount(status: QuestStatus): number {
  return status.quests.filter((q) => q.done && !q.claimed).length + status.milestones.filter((m) => m.reached && !m.claimed).length;
}

/** Время до локальной полуночи (сброс заданий и быстрых наград): «5 ч 12 мин». */
export function untilReset(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const min = Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 60000));
  return `${Math.floor(min / 60)} ч ${min % 60} мин`;
}

/** Куда вести игрока, чтобы выполнить задание. */
export function questDestination(event: ActivityKind): 'Campaign' | 'Tavern' | 'Heroes' | 'Tower' | 'Expeditions' | 'Hunt' | 'Shop' | 'Autobattler' | 'Kitchen' {
  switch (event) {
    case 'stage_win':
    // Победы кампании или Башни — ведём на текущий этап кампании (Башня видна рядом в «Приключениях»).
    case 'battle_win':
    case 'stage_attempt':
    // Сундук и быстрые награды — на странице «Кампания».
    case 'offline_claim':
    case 'fast_rewards':
      return 'Campaign';
    case 'summon':
      return 'Tavern';
    case 'hero_level_up':
    case 'hero_ascend':
      return 'Heroes';
    case 'tower_attempt':
      return 'Tower';
    case 'expedition_claim':
      return 'Expeditions';
    case 'hunt_attempt':
      return 'Hunt';
    case 'shop_buy':
      return 'Shop';
    case 'arena_wins':
      return 'Autobattler';
    case 'kitchen_cook':
      return 'Kitchen';
  }
}

// ---------- K8. Пресеты ----------

/** Имя нового пресета: «Отряд N» с наименьшим свободным N. */
export function nextPresetName(presets: readonly Pick<Preset, 'name'>[]): string {
  const names = new Set(presets.map((p) => p.name));
  let n = 1;
  while (names.has(`Отряд ${n}`)) n++;
  return `Отряд ${n}`;
}

/** Совпадает ли пресет с текущим отрядом (подсветка «выбран»). */
export function presetMatches(preset: Pick<Preset, 'squad'>, squad: readonly (string | null)[]): boolean {
  return preset.squad.length === squad.length && preset.squad.every((id, i) => id === squad[i]);
}

// ---------- K9. Экспедиции ----------

/** Длительность: «30 мин», «2 ч», «1 ч 30 мин». */
export function durationText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  if (h === 0) return `${m} мин`;
  return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`;
}

/** Обратный отсчёт: «1:05:09», «4:07»; 0 — «готово». */
export function countdownText(ms: number): string {
  if (ms <= 0) return 'готово';
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

/** «5 гемов», «1 гем», «22 гема». */
export function gemsText(n: number): string {
  return `${formatNumber(n)} ${plural(n, 'гем', 'гема', 'гемов')}`;
}

/** «10 очков», «1 очко», «3 очка» (задания, события). */
export function pointsText(n: number): string {
  return `${formatNumber(n)} ${plural(n, 'очко', 'очка', 'очков')}`;
}

/** «3 дня», «1 день», «5 дней». */
export function daysText(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

/** Награда K10 одной строкой: «300 золота · 50 опыта · 5 гемов» (нулевые не пишем; MT-19 — без «зол./гем.»). */
export function metaRewardsText(r: Omit<MetaRewards, 'heroCards'> & { heroCards?: MetaRewards['heroCards'] }, jobExpSuffix = ''): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${formatNumber(r.gold)} золота`);
  if (r.jobExp) parts.push(`${formatNumber(r.jobExp)} опыта${jobExpSuffix}`);
  if (r.gems) parts.push(gemsText(r.gems));
  const cards = (r.heroCards?.blue ?? 0) + (r.heroCards?.purple ?? 0);
  if (cards > 0) parts.push(cards >= 1 && Number.isInteger(cards) ? `${cards} ${plural(cards, 'карта', 'карты', 'карт')} героя` : `карта героя ${Math.round(cards * 100)}%`);
  return parts.join(' · ') || '—';
}

/** Что даст экспедиция (до отправки): «≈ 660 золота · 880 опыта» и находки «гемы, карты героя, предметы» — по средним. */
export function expectedLootText(e: ExpectedLoot): { base: string; finds: string } {
  const finds: string[] = [];
  if (e.gems > 0) finds.push(`гемы ≈${Math.max(1, Math.round(e.gems))}`);
  if (e.heroCards > 0) finds.push('карты героя');
  if (e.items > 0) finds.push('снаряжение');
  if (e.scrolls > 0) finds.push('свитки');
  return { base: `${formatNumber(e.gold)} золота · ${formatNumber(e.jobExp)} опыта`, finds: finds.length ? `Находки: ${finds.join(', ')}` : '' };
}

/**
 * Точка плитки «Экспедиции»: вернувшиеся (забрать добычу) и события в пути, ждущие решения. Свободные локации — не
 * повод (§2.4 п. 6: «можно отправить» — постоянное состояние, а не событие; раньше давало вечные «3» на «Приключениях»).
 */
export function expeditionsBadgeCount(save: SaveState, now: number, _ctx?: ExpeditionContext): number {
  return finishedExpeditions(save, now) + pendingExpeditionEvents(save, now);
}

// ---------- K10. Достижения ----------

/** Сколько достижений можно забрать. */
export function claimableAchievements(views: readonly AchievementView[]): number {
  return views.filter((a) => a.done && !a.claimed).length;
}

/** Порядок на экране: готовые к получению, затем в процессе (ближе к цели — выше), полученные — в конце. */
export function sortAchievements(views: readonly AchievementView[]): AchievementView[] {
  const group = (a: AchievementView) => (a.claimed ? 2 : a.done ? 0 : 1);
  return views
    .map((a, i) => ({ a, i }))
    .sort((x, y) => group(x.a) - group(y.a) || (group(x.a) === 1 ? y.a.progress / y.a.target - x.a.progress / x.a.target : 0) || x.i - y.i)
    .map((x) => x.a);
}

// ---------- K4. Башня ----------

/**
 * Точка плитки «Башня» (забег-рогалик, docs/design/tower-roguelite.md): только когда в начатом забеге ждёт выбор (карта
 * или событие). «Добыча дня не взята» / «этаж по силам» — постоянное состояние, не повод (§2.4 п. 6). day оставлен для
 * совместимости вызовов. 1 или 0.
 */
export function towerBadgeCount(save: SaveState, ctx: TowerContext & FeatureContext & Partial<Pick<EquipmentContext, 'equipment'>>, _day: string = save.daily.day): number {
  if (!towerStatus(save, ctx).unlocked) return 0;
  return save.tower.run?.pending ? 1 : 0;
}
