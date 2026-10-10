import { buildContent, COMBAT, rarityForLevel, type CardRarity, type CombatConfig, type Content, type GameContext, type HeroState } from '../src/core';
import type { Unit } from '../src/core';
import { featureStage, recordActivity, rollDay, type FeatureContext, type QuestDef, type SaveState } from '../src/core';

// ---------- Карточки героев (docs/design/heroes.md) ----------

/**
 * Карточка по классу — для тестов, где раньше герой задавался профессией (первые — сюжетные/призывные; вторые —
 * «герой/ветка» героев v2: фиолетовый экземпляр с этой веткой, cardHero понимает запись через «/»).
 * Вторые профессии — те же пол и роль, что у прежних фиолетовых шаблонов (таблица миграции v7).
 */
export const JOB_CARD: Record<string, string> = {
  swordman: 'alan',
  archer: 'bran',
  acolyte: 'vika',
  merchant: 'greta',
  thief: 'dorn',
  mage: 'kai',
  knight: 'alan/knight',
  crusader: 'alan/crusader',
  hunter: 'meilin/hunter',
  bard: 'bran/bard',
  dancer: 'meilin/dancer',
  wizard: 'lira/wizard',
  sage: 'lira/sage',
  assassin: 'dorn/assassin',
  rogue: 'zara/rogue',
  priest: 'vika/priest',
  monk: 'teo/monk',
  blacksmith: 'otto/blacksmith',
  alchemist: 'otto/alchemist',
};

/**
 * Экземпляр карточки templateId на уровне level: редкость — самая низкая, чей предел вмещает уровень (не ниже baseRarity
 * шаблона), если не задана явно. id по умолчанию — h_<шаблон>. «герой/ветка» (alan/knight) — экземпляр с веткой второй
 * профессии, редкость не ниже фиолетовой.
 */
export function cardHero(ctx: GameContext, templateId: string, level = 1, opts: { id?: string; rarity?: CardRarity } = {}): HeroState {
  const [tid, branch] = templateId.split('/');
  const base = branch ? 'purple' : (ctx.content.heroes[tid]?.baseRarity ?? 'green');
  return { id: opts.id ?? `h_${tid}${branch ? `_${branch}` : ''}`, templateId: tid, rarity: opts.rarity ?? rarityForLevel(ctx, level, base), level, ...(branch ? { branch } : {}) };
}

export const cfg: CombatConfig = COMBAT;

type Json = Record<string, unknown>;

/** Навык для тестов: по умолчанию — обычная атака дальнего боя по ближайшему. */
export function skill(id: string, patch: Json = {}): Json {
  return {
    id,
    name: id,
    range: 'ranged',
    target: { side: 'enemy', pick: 'nearest' },
    effects: [{ type: 'damage', k: 1 }],
    ...patch,
  };
}

/** Юнит для тестов. */
export function unitDef(id: string, patch: Json = {}, stats: Json = {}): Json {
  return {
    id,
    name: id,
    kind: 'hero',
    role: 'damage',
    stats: { hp: 1000, atk: 100, def: 0, spd: 100, ...stats },
    skills: { basic: 'shot', passives: [] },
    visual: { sprite: id },
    ...patch,
  };
}

/** Контент из объектов; навык shot (дальняя атака) добавляется всегда. */
export function content(units: Json[], skills: Json[] = []): Content {
  const all = [skill('shot'), skill('hit', { range: 'melee' }), ...skills];
  return buildContent({
    units: units.map((data, i) => ({ file: `unit${i}`, data })),
    skills: all.map((data, i) => ({ file: `skill${i}`, data })),
  });
}

/** Юнит боя для тестов выбора цели. */
export function unit(side: 'A' | 'B', slot: number, x: number, y: number, patch: Partial<Unit> = {}): Unit {
  return {
    uid: `${side}${slot}`,
    side,
    slot,
    unitId: 'u',
    def: {} as Unit['def'],
    basic: {} as Unit['basic'],
    passives: [],
    actives: [],
    readyAt: {},
    casting: null,
    maxHp: 1000,
    hp: 1000,
    base: { atk: 100, def: 0, spd: 100 },
    energy: 0,
    gauge: 0,
    shield: 0,
    alive: true,
    statuses: [],
    x,
    y,
    moveSpeed: 300,
    body: 0,
    range: Infinity,
    engage: null,
    moving: null,
    behavior: 'line',
    bh: { name: 'Держит линию' },
    ...patch,
  };
}

// ---------- Задания дня (docs/design/daily-loop-2026-10-10.md) ----------

/**
 * Сохранение, где выполнены задания quests на день day: функции заданий (unlock) открыты — их этапы пройдены,
 * записываемые виды — recordActivity, производные (Охота, Лавка, Арена) — их суточное состояние на day.
 */
export function withQuestsDone(save: SaveState, day: string, ctx: FeatureContext, quests: readonly QuestDef[] = ctx.features.quests.quests): SaveState {
  const stages = quests.flatMap((q) => (q.unlock ? [featureStage(q.unlock, ctx)] : [])).filter((x): x is string => !!x);
  let s: SaveState = rollDay({ ...save, campaign: { ...save.campaign, cleared: [...new Set([...save.campaign.cleared, ...stages])] } }, day);
  for (const q of quests) {
    if (q.event === 'hunt_attempt') s = { ...s, hunt: { day, used: q.target, best: { ...(s.hunt?.best ?? {}) } } };
    else if (q.event === 'shop_buy') s = { ...s, shop: { day, refreshes: 0, slots: [], boughtToday: { test: q.target } } };
    else if (q.event === 'arena_wins') s = { ...s, autobattler: { seq: 0, bestWins: q.target, completed: 1, rewardDay: day, rewardWins: q.target } };
    else s = recordActivity(s, day, q.event, q.target);
  }
  return s;
}
