/**
 * Доски рекордов cw-api (docs/design/online.md, «Доски»): чистая логика без Deno API и базы — какая доска, порядок,
 * места (одинаковый результат — одно место), строки ответа. Тесты — tests/online-boards.test.ts.
 *
 * - Недельные (`cw_score`): `tower` — лучший этаж Башни, `mvp` — лучший зачёт охоты на MVP.
 * - Постоянные (`cw_player`): `power` — сила отряда (как «Мощь отряда» в игре), `progress` — глава, затем этап.
 */

export type BoardKind = 'tower' | 'mvp' | 'power' | 'progress';
export type BoardScope = 'all' | 'friends';

/** Сколько строк в топе. */
export const BOARD_TOP = 50;
/** Друзей для доски «друзья» берём не больше стольких (запрос `in`). */
export const FRIENDS_MAX = 500;

/** Доска из запроса; неизвестное — `tower` (старый клиент присылал только tower/mvp). */
export function boardKind(v: unknown): BoardKind {
  return v === 'mvp' || v === 'power' || v === 'progress' ? v : 'tower';
}

export const boardScope = (v: unknown): BoardScope => (v === 'friends' ? 'friends' : 'all');

/** Недельная доска (cw_score), иначе — из cw_player. */
export const isWeekly = (k: BoardKind): boolean => k === 'tower' || k === 'mvp';

/** Строка cw_player, нужная доскам. */
export interface PlayerRow {
  tg_id: number | string;
  first_name?: string | null;
  chapter?: number | null;
  stage?: number | null;
  power?: number | null;
  tower_best?: number | null;
}

/** Участник доски: id и значение (для progress — глава·100 + этап), плюс сведения для строки. */
export interface Entry {
  id: number;
  value: number;
  /** Для progress — вторичный порядок (сила); места он не делит. */
  tie?: number;
}

export interface BoardRow {
  place: number;
  name: string;
  value: number;
  me: boolean;
  chapter: number;
  stage: number;
  power: number;
}

export interface BoardMine {
  place: number;
  value: number;
  chapter: number;
  stage: number;
  power: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** Значение прогресса: глава 4, этап 12 → 412 (этапов в главе меньше 100). */
export const progressValue = (chapter: number, stage: number): number => num(chapter) * 100 + Math.min(99, num(stage));

/** Значение игрока на постоянной доске (0 — на доску не попадает: ещё не присылал sync). */
export function playerValue(kind: 'power' | 'progress', p: PlayerRow): number {
  if (kind === 'power') return num(p.power);
  return num(p.chapter) > 0 ? progressValue(num(p.chapter), num(p.stage)) : 0;
}

/** Участник постоянной доски из строки cw_player (null — не на доске). */
export function playerEntry(kind: 'power' | 'progress', p: PlayerRow): Entry | null {
  const value = playerValue(kind, p);
  if (value <= 0) return null;
  return { id: Number(p.tg_id), value, ...(kind === 'progress' ? { tie: num(p.power) } : {}) };
}

/** Порядок: значение по убыванию, затем tie по убыванию, затем id (стабильно). */
export function compareEntries(a: Entry, b: Entry): number {
  return b.value - a.value || (b.tie ?? 0) - (a.tie ?? 0) || a.id - b.id;
}

export interface Ranked extends Entry {
  place: number;
}

/**
 * Места по отсортированным участникам: одинаковое значение — одно место («1, 2, 2, 4»). entries сортируются здесь же.
 */
export function rankEntries(entries: Entry[]): Ranked[] {
  const sorted = [...entries].sort(compareEntries);
  const out: Ranked[] = [];
  sorted.forEach((e, i) => {
    const prev = out[i - 1];
    out.push({ ...e, place: prev && prev.value === e.value ? prev.place : i + 1 });
  });
  return out;
}

/**
 * Топ и моё место по полному списку участников (доска «друзья»: все друзья и я). Нет меня в списке — mine null.
 */
export function rankBoard(entries: Entry[], me: number, limit = BOARD_TOP): { top: Ranked[]; mine: Ranked | null } {
  const ranked = rankEntries(entries);
  return { top: ranked.slice(0, limit), mine: ranked.find((r) => r.id === me) ?? null };
}

/**
 * Доска «все»: база отдала первые участники (уже по порядку) и число тех, кто строго лучше меня (betterThanMe; null —
 * меня нет на доске). Моё место — из топа, если я в нём, иначе betterThanMe + 1.
 */
export function rankTop(topEntries: Entry[], me: number, myEntry: Entry | null, betterThanMe: number | null, limit = BOARD_TOP): { top: Ranked[]; mine: Ranked | null } {
  const top = rankEntries(topEntries).slice(0, limit);
  const inTop = top.find((r) => r.id === me);
  if (inTop) return { top, mine: inTop };
  if (!myEntry || betterThanMe === null) return { top, mine: null };
  return { top, mine: { ...myEntry, place: betterThanMe + 1 } };
}

/**
 * Фильтр PostgREST «строго лучше меня» для подсчёта места на постоянной доске «все» (`.or(...)`):
 * power — power > N; progress — chapter > C или (chapter = C и stage > S).
 */
export function betterFilter(kind: 'power' | 'progress', p: PlayerRow): string {
  if (kind === 'power') return `power.gt.${num(p.power)}`;
  const c = num(p.chapter);
  return `chapter.gt.${c},and(chapter.eq.${c},stage.gt.${Math.min(99, num(p.stage))})`;
}

/** Строки ответа: имя, глава, этап и сила — из cw_player (нет строки — «…» и нули). */
export function boardRows(top: Ranked[], players: PlayerRow[], me: number): BoardRow[] {
  const byId = new Map(players.map((p) => [Number(p.tg_id), p]));
  return top.map((r) => {
    const p = byId.get(r.id);
    return {
      place: r.place,
      name: (p?.first_name ?? '').slice(0, 64) || '…',
      value: r.value,
      me: r.id === me,
      chapter: num(p?.chapter),
      stage: num(p?.stage),
      power: num(p?.power),
    };
  });
}

export function boardMine(mine: Ranked | null, myPlayer: PlayerRow | null | undefined): BoardMine | null {
  if (!mine) return null;
  return { place: mine.place, value: mine.value, chapter: num(myPlayer?.chapter), stage: num(myPlayer?.stage), power: num(myPlayer?.power) };
}

/** Колонки cw_player для досок и списка друзей. */
export const PLAYER_COLS = 'tg_id, first_name, chapter, stage, power, tower_best';
