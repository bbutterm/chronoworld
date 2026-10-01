/**
 * Диорама «idle-бой» на странице «Город» (idleDiorama.ts) — чистая часть без Phaser: кого показать (отряд игрока,
 * враги текущего этапа кампании), волны и сценарий одной волны (кто бьёт, когда падает монстр, когда ульта),
 * раскладка в полосе и что лететь в сундук. Это украшение: ядро боя не зовём, сценарий — скриптовый и проверяется
 * в tests/idle-diorama.test.ts. Случайность — свой маленький генератор от номера волны (одна волна — один сценарий).
 */

/** Размер полосы диорамы в единицах поля (1080×1920). */
export const DIORAMA_W = 1040;
export const DIORAMA_H = 360;

/** Масштаб листов RO в диораме (в бою — V2_SCALE 3.2): герой в стойке ≈ 90 px листа → ≈ 170 ед. */
export const DIORAMA_SCALE = 1.9;

/** Не больше листов монстров на волну (и разных листов в памяти). */
export const MAX_ENEMIES = 3;
export const MAX_HEROES = 5;

/** Самая высокая клетка листа монстра, которую берём (лист `monster` 240×224): крупные XL-листы и боссы — тяжёлые. */
export const MAX_ENEMY_CELL_H = 224;

/** Тайминги волны, мс. */
export const T = {
  /** Монстры выходят справа. */
  walkIn: 1100,
  /** Между действиями героев. */
  heroGap: 520,
  /** От начала удара до попадания (кадр удара листа при ~100 мс на кадр). */
  hit: 300,
  /** Падение монстра (анимация смерти + растворение). */
  death: 750,
  /** Пауза после волны до следующей. */
  rest: 700,
  /** Каждое какое действие героя монстр отвечает ударом. */
  enemyEvery: 3,
} as const;

/** Каждая какая волна — с ультой (номер волны с 0: 2, 5, 8…). */
export const ULT_EVERY = 3;

/** Точки ног героев по слотам отряда (0–1 фронт, 2–4 тыл) — относительно левого верхнего угла полосы. */
export const HERO_SLOTS: readonly { x: number; y: number }[] = [
  { x: 420, y: 272 },
  { x: 375, y: 340 },
  { x: 260, y: 256 },
  { x: 225, y: 326 },
  { x: 100, y: 292 },
];

/** Точки ног монстров волны (до трёх). */
export const ENEMY_SLOTS: readonly { x: number; y: number }[] = [
  { x: 655, y: 284 },
  { x: 780, y: 338 },
  { x: 830, y: 248 },
];

/** Насколько правее своего места монстр появляется (проявляется и подходит; за край полосы не заходит). */
export const ENEMY_SPAWN_DX = 140;

/** Маленький детерминированный генератор (mulberry32) — сценарий волны не «прыгает» при перезапуске экрана. */
export function waveRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Этап кампании — только то, что нужно диораме. */
export interface StageLike {
  id: string;
  chapter: string;
  enemies: readonly ({ unit: string } | null)[];
}

/**
 * Монстры для волн: уникальные юниты текущего этапа по порядку слотов, у которых есть лист не крупнее обычного
 * монстра (spriteCellH ≤ MAX_ENEMY_CELL_H; босс и XL-листы тяжёлые — их пропускаем). На этапе таких нет (этап босса) —
 * ближайшие этапы той же главы: сначала предыдущие, потом следующие. Совсем нет — юниты этапа как есть (без проверки листа).
 * spriteOf — id листа юнита (undefined — юнита нет), spriteCellH — высота клетки листа (undefined — листа нет).
 */
export function enemyPool(
  stages: readonly StageLike[],
  currentId: string,
  spriteOf: (unitId: string) => string | undefined,
  spriteCellH: (spriteId: string) => number | undefined,
  max = MAX_ENEMIES,
): string[] {
  const ci = stages.findIndex((s) => s.id === currentId);
  if (ci < 0) return [];
  const unitsOf = (s: StageLike) => [...new Set(s.enemies.filter((e): e is { unit: string } => !!e).map((e) => e.unit))];
  const light = (u: string) => {
    const sp = spriteOf(u);
    const h = sp ? spriteCellH(sp) : undefined;
    return h !== undefined && h <= MAX_ENEMY_CELL_H;
  };
  const chapter = stages[ci].chapter;
  const order = [ci];
  for (let d = 1; d < stages.length; d++) {
    if (ci - d >= 0 && stages[ci - d].chapter === chapter) order.push(ci - d);
  }
  for (let d = 1; d < stages.length; d++) {
    if (ci + d < stages.length && stages[ci + d].chapter === chapter) order.push(ci + d);
  }
  for (const i of order) {
    // Разные листы: у двух юнитов может быть один лист (перекраска) — в волне это выглядело бы одинаково.
    const seen = new Set<string>();
    const pick = unitsOf(stages[i]).filter((u) => {
      if (!light(u)) return false;
      const sp = spriteOf(u) as string;
      if (seen.has(sp)) return false;
      seen.add(sp);
      return true;
    });
    if (pick.length) return pick.slice(0, max);
  }
  return unitsOf(stages[ci]).filter((u) => spriteOf(u)).slice(0, max);
}

/** Сколько монстров в волне wave (1–3, по кругу, чтобы волны отличались). */
export const WAVE_SIZES = [2, 3, 1, 3, 2, 2] as const;

/** Монстры волны wave: юниты пула по кругу (начиная со сдвига wave), не больше MAX_ENEMIES. Пул пуст — пусто. */
export function waveUnits(pool: readonly string[], wave: number): string[] {
  if (!pool.length) return [];
  const n = Math.min(MAX_ENEMIES, WAVE_SIZES[((wave % WAVE_SIZES.length) + WAVE_SIZES.length) % WAVE_SIZES.length]);
  return Array.from({ length: n }, (_, i) => pool[(wave + i) % pool.length]);
}

/** Герой отряда для диорамы. */
export interface LineupHero {
  heroId: string;
  /** Слот отряда (0–1 фронт, 2–4 тыл) — по нему точка на полосе. */
  slot: number;
  sprite: string;
  atk: number;
  /** id ульты (для её эффекта и названия); нет — герой ульту не показывает. */
  ult?: string;
}

/** Описание юнита героя (UnitDef из squadDefs) — только нужные поля. */
export interface HeroDefLike {
  visual: { sprite: string };
  stats: { atk: number };
  skills: { ult?: string };
}

/** Герои текущего отряда по слотам (пустые слоты и неизвестные id пропускаются), не больше MAX_HEROES. */
export function squadLineup(squad: readonly (string | null | undefined)[], defs: Readonly<Record<string, HeroDefLike>>): LineupHero[] {
  const out: LineupHero[] = [];
  squad.forEach((id, slot) => {
    const def = id ? defs[id] : undefined;
    if (!id || !def || out.length >= MAX_HEROES) return;
    out.push({ heroId: id, slot: Math.min(slot, HERO_SLOTS.length - 1), sprite: def.visual.sprite, atk: Math.max(1, Math.round(def.stats.atk)), ult: def.skills.ult || undefined });
  });
  return out;
}

/** Чей ход ульты в волне wave (индекс в lineup) или null: каждая ULT_EVERY-я волна, герои с ультой по очереди. */
export function ultHeroFor(wave: number, lineup: readonly Pick<LineupHero, 'ult'>[]): number | null {
  if (wave % ULT_EVERY !== ULT_EVERY - 1) return null;
  const withUlt = lineup.map((h, i) => (h.ult ? i : -1)).filter((i) => i >= 0);
  if (!withUlt.length) return null;
  return withUlt[Math.floor(wave / ULT_EVERY) % withUlt.length];
}

export type WaveEvent =
  /** Герой hero начинает удар по монстру target; попадание — через T.hit: урон dmg, kill — монстр падает. */
  | { at: number; type: 'attack'; hero: number; target: number; dmg: number; kill: boolean }
  /** Ульта героя hero: попадание через T.hit по всем targets (все живые монстры падают). */
  | { at: number; type: 'ult'; hero: number; targets: number[]; dmg: number }
  /** Монстр enemy бьёт героя hero (урон dmg, маленькая красная цифра). */
  | { at: number; type: 'enemyAttack'; enemy: number; hero: number; dmg: number };

export interface WavePlan {
  events: WaveEvent[];
  /** Когда волна кончается (последний монстр упал и отдохнули) — начинать следующую. */
  end: number;
}

/**
 * Сценарий волны: монстры выходят (T.walkIn), герои бьют по очереди (через T.heroGap) ближайшего живого монстра,
 * монстру нужно 2–3 попадания; каждое T.enemyEvery-е действие героя живой монстр отвечает по фронту. Волна с ультой
 * (ult — индекс героя): после двух обычных ударов (не позже предпоследнего) герой ult добивает всех оставшихся. Урон — атака героя ×0.85–1.15
 * (ульта ×3), урон монстра — enemyAtk ×0.85–1.15. Чистая функция: одна волна — один сценарий.
 */
export function planWave(o: { heroes: readonly Pick<LineupHero, 'atk' | 'slot'>[]; enemies: number; wave: number; ult: number | null; enemyAtk?: number }): WavePlan {
  const events: WaveEvent[] = [];
  const nh = o.heroes.length;
  const ne = Math.min(MAX_ENEMIES, o.enemies);
  if (!nh || !ne) return { events, end: T.walkIn + T.rest };
  const rnd = waveRng(0x9e3779b9 ^ Math.imul(o.wave + 1, 0x85ebca6b));
  const need = Array.from({ length: ne }, () => 2 + (rnd() < 0.5 ? 1 : 0));
  const alive = () => need.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0);
  const roll = (base: number) => Math.max(1, Math.round(base * (0.85 + rnd() * 0.3)));
  // Фронт — герои слотов 0–1 (если их нет — первый в строю): по ним бьют монстры.
  const front = o.heroes.map((h, i) => (h.slot <= 1 ? i : -1)).filter((i) => i >= 0);
  const targetsOfEnemy = front.length ? front : [0];
  let t = T.walkIn;
  let action = 0;
  let lastKill = t;
  let ultDone = o.ult === null;
  // Ульта — после двух обычных ударов, но раньше последнего удара волны (у одного монстра на 2 удара — после первого).
  const ultAt = Math.min(2, need.reduce((x, n) => x + n, 0) - 1);
  while (alive().length) {
    const hero = action % nh;
    if (!ultDone && action >= ultAt) {
      const targets = alive();
      const u = o.ult as number;
      events.push({ at: t, type: 'ult', hero: u, targets, dmg: roll(o.heroes[u].atk * 3) });
      for (const i of targets) need[i] = 0;
      lastKill = t + T.hit;
      ultDone = true;
      break;
    }
    const target = alive()[0];
    need[target]--;
    const kill = need[target] === 0;
    events.push({ at: t, type: 'attack', hero, target, dmg: roll(o.heroes[hero].atk), kill });
    if (kill) lastKill = t + T.hit;
    action++;
    if (action % T.enemyEvery === 0 && alive().length) {
      const enemy = alive()[alive().length - 1];
      events.push({ at: t + T.heroGap / 2, type: 'enemyAttack', enemy, hero: targetsOfEnemy[action % targetsOfEnemy.length], dmg: roll(o.enemyAtk ?? 20) });
    }
    t += T.heroGap;
  }
  events.sort((a, b) => a.at - b.at);
  return { events, end: lastKill + T.death + T.rest };
}

/**
 * Скорость проигрывания анимации листа: кадры не чаще чем раз в minFrameMs (8–10 кадров в секунду — меньше работы
 * у слабых телефонов). Кадр медленнее — как есть (1).
 */
export function animTimeScale(frameMs: number, minFrameMs = 100): number {
  if (!(frameMs > 0)) return 1;
  return Math.min(1, frameMs / minFrameMs);
}

/** Сундук «как есть» (числа ядра): золото и число предметов. */
export interface ChestSnapshot {
  gold: number;
  items: readonly string[];
}

/**
 * Что лететь к сундуку, когда падает монстр: монетки всегда (2, если золото в сундуке выросло с прошлого раза, иначе 1),
 * опыт — через раз, предмет — только если в сундуке правда прибавился предмет (id последнего нового).
 * Сундук не копится (нет пройденных этапов, prev/next null) — ничего.
 */
export function chestFlight(prev: ChestSnapshot | null, next: ChestSnapshot | null, kill: number): { coins: number; exp: boolean; item: string | null } {
  if (!next) return { coins: 0, exp: false, item: null };
  const grew = !!prev && next.gold > prev.gold;
  const item = prev && next.items.length > prev.items.length ? next.items[next.items.length - 1] : null;
  return { coins: grew ? 2 : 1, exp: kill % 2 === 1, item };
}

/** Позиция героя на полосе по слоту. */
export const heroPoint = (slot: number) => HERO_SLOTS[Math.max(0, Math.min(HERO_SLOTS.length - 1, slot))];
/** Позиция монстра волны по номеру. */
export const enemyPoint = (i: number) => ENEMY_SLOTS[Math.max(0, Math.min(ENEMY_SLOTS.length - 1, i))];
