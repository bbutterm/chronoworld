import type { EquipmentConfig } from '../equipment/load';
import type { FeatureContext } from '../features/config';
import { heroPower } from '../features/power';
import { getJob } from '../progression/stats';
import type { GameContext } from '../progression/types';
import type { HeroState, Preset, SaveState } from '../save/schema';
import type { MetaContext } from './config';
import { MetaError } from './errors';

/** Слоты отряда: 0–1 — передняя линия, 2–4 — задняя (как в бою). */
export const FRONT_SLOTS = [0, 1] as const;
export const BACK_SLOTS = [2, 3, 4] as const;
const SQUAD_SIZE = 5;

/** Проверить расстановку: 5 слотов, герои существуют и не повторяются. MetaError('invalid_squad' | 'unknown_hero'). */
function checkSquad(save: SaveState, squad: readonly (string | null)[]): (string | null)[] {
  if (squad.length !== SQUAD_SIZE) throw new MetaError('invalid_squad', `В отряде должно быть ${SQUAD_SIZE} слотов`);
  const seen = new Set<string>();
  for (const id of squad) {
    if (id === null) continue;
    if (!save.heroes.some((h) => h.id === id)) throw new MetaError('unknown_hero', `Герой ${id} не найден`);
    if (seen.has(id)) throw new MetaError('invalid_squad', `Герой ${id} стоит в отряде дважды`);
    seen.add(id);
  }
  return [...squad];
}

function nextPresetId(save: SaveState): string {
  let max = 0;
  for (const p of save.presets) {
    const m = /^p(\d+)$/.exec(p.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `p${max + 1}`;
}

/**
 * K8. Сохранить расстановку как пресет. Чистая функция.
 * - opts.squad — какую расстановку (по умолчанию текущий save.squad);
 * - opts.id — перезаписать существующий пресет (имя и отряд); без id — новый пресет с id `p<N>`
 *   (N = наибольший номер + 1, детерминированно).
 * Имя обрезается по краям, не пустое и не длиннее presets.nameMaxLength.
 * MetaError: invalid_preset_name, preset_limit (новых больше presets.max), unknown_preset (opts.id не найден),
 * invalid_squad, unknown_hero.
 */
export function savePreset(
  save: SaveState,
  name: string,
  ctx: MetaContext,
  opts: { id?: string; squad?: readonly (string | null)[] } = {},
): { save: SaveState; preset: Preset } {
  const cfg = ctx.meta.bounties.presets;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > cfg.nameMaxLength) throw new MetaError('invalid_preset_name', `Название пресета: от 1 до ${cfg.nameMaxLength} символов`);
  const squad = checkSquad(save, opts.squad ?? save.squad);
  if (opts.id !== undefined) {
    if (!save.presets.some((p) => p.id === opts.id)) throw new MetaError('unknown_preset', `Пресет ${opts.id} не найден`);
    const preset: Preset = { id: opts.id, name: trimmed, squad };
    return { save: { ...save, presets: save.presets.map((p) => (p.id === opts.id ? preset : p)) }, preset };
  }
  if (save.presets.length >= cfg.max) throw new MetaError('preset_limit', `Можно сохранить не больше ${cfg.max} пресетов`);
  const preset: Preset = { id: nextPresetId(save), name: trimmed, squad };
  return { save: { ...save, presets: [...save.presets, preset] }, preset };
}

/**
 * K8. Поставить отряд из пресета. Герои, которых больше нет в сохранении, становятся пустыми слотами.
 * Герои на поручении (K9) ставятся как обычно — поручение не мешает сражаться.
 * MetaError('unknown_preset').
 */
export function applyPreset(save: SaveState, presetId: string): SaveState {
  const p = save.presets.find((x) => x.id === presetId);
  if (!p) throw new MetaError('unknown_preset', `Пресет ${presetId} не найден`);
  const ids = new Set(save.heroes.map((h) => h.id));
  const used = new Set<string>();
  const squad = p.squad.map((id) => {
    if (id === null || !ids.has(id) || used.has(id)) return null;
    used.add(id);
    return id;
  });
  return { ...save, squad };
}

/** K8. Удалить пресет. MetaError('unknown_preset'). */
export function deletePreset(save: SaveState, presetId: string): SaveState {
  if (!save.presets.some((p) => p.id === presetId)) throw new MetaError('unknown_preset', `Пресет ${presetId} не найден`);
  return { ...save, presets: save.presets.filter((p) => p.id !== presetId) };
}

/**
 * Куда герой встаёт при авто-расстановке: 0 — танк, 1 — ближний бой (не лекарь),
 * 2 — дальний бой (не лекарь), 3 — лекарь. Меньше — ближе к передней линии.
 * Дальность — по обычной атаке профессии (skill.range).
 */
export function formationRank(hero: HeroState, ctx: GameContext): number {
  const job = getJob(ctx, hero.job);
  if (job.role === 'tank') return 0;
  if (job.role === 'healer') return 3;
  return ctx.content.skills[job.basic]?.range === 'melee' ? 1 : 2;
}

/**
 * K8. Авто-расстановка. Возвращает новый squad (save не меняет).
 * 1. Берутся 5 самых сильных героев по heroPower (с экипировкой, если есть ctx.equipment); при равной мощи —
 *    по id героя по возрастанию.
 * 2. «Передние» (танки, затем ближний бой; внутри — мощь ↓, id ↑) занимают слоты 0, 1, 2, 3, 4 по порядку
 *    первого свободного; «задние» (лекари, затем дальний бой; внутри — мощь ↓, id ↑) — с конца: 4, 3, 2, 1, 0.
 *    Так танки всегда в 0–1, лекари — в самом тылу, а при нехватке одной из групп другая занимает её слоты.
 * Героев меньше 5 — лишние слоты null. Герои на поручении участвуют (поручение не мешает сражаться).
 */
export function autoFormation(save: SaveState, ctx: FeatureContext & { equipment?: EquipmentConfig }): (string | null)[] {
  const rated = save.heroes.map((h) => ({ id: h.id, power: heroPower(h, ctx, save), rank: formationRank(h, ctx) }));
  const byPower = (a: (typeof rated)[number], b: (typeof rated)[number]) => b.power - a.power || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const chosen = [...rated].sort(byPower).slice(0, SQUAD_SIZE);
  const squad: (string | null)[] = Array(SQUAD_SIZE).fill(null);
  const place = (id: string, order: readonly number[]) => {
    const slot = order.find((i) => squad[i] === null)!;
    squad[slot] = id;
  };
  const front = chosen.filter((h) => h.rank <= 1).sort((a, b) => a.rank - b.rank || byPower(a, b));
  const back = chosen.filter((h) => h.rank >= 2).sort((a, b) => b.rank - a.rank || byPower(a, b));
  for (const h of front) place(h.id, [0, 1, 2, 3, 4]);
  for (const h of back) place(h.id, [4, 3, 2, 1, 0]);
  return squad;
}

/**
 * P10 (T1-20). Переставить тех же героев отряда по ролям (состав не меняется): «передние» (танки, ближний бой)
 * с первого слота, «задние» (лекари, затем дальний бой) — с последнего, как в autoFormation. Внутри группы —
 * прежний порядок в отряде. Возвращает новый squad.
 */
export function arrangeSquad(save: SaveState, ctx: GameContext): (string | null)[] {
  const members = save.squad.flatMap((id) => {
    const hero = id === null ? undefined : save.heroes.find((h) => h.id === id);
    return hero ? [{ id: hero.id, rank: formationRank(hero, ctx) }] : [];
  });
  const squad: (string | null)[] = Array(SQUAD_SIZE).fill(null);
  const place = (id: string, order: readonly number[]) => {
    squad[order.find((i) => squad[i] === null)!] = id;
  };
  // Array.prototype.sort стабильна: при равном ранге остаётся порядок отряда.
  for (const h of members.filter((m) => m.rank <= 1).sort((a, b) => a.rank - b.rank)) place(h.id, [0, 1, 2, 3, 4]);
  for (const h of members.filter((m) => m.rank >= 2).sort((a, b) => b.rank - a.rank)) place(h.id, [4, 3, 2, 1, 0]);
  return squad;
}

/**
 * P10 (T1-20). Стрелки и лекари, стоящие в передней линии, хотя в отряде есть кому стоять впереди
 * (танк или боец ближнего боя) и arrangeSquad уводит их в тыл. [] — расстановка в порядке.
 */
export function misplacedInFront(save: SaveState, ctx: GameContext): string[] {
  const rank = (id: string | null) => {
    const hero = id === null ? undefined : save.heroes.find((h) => h.id === id);
    return hero ? formationRank(hero, ctx) : -1;
  };
  if (!save.squad.some((id) => rank(id) >= 0 && rank(id) <= 1)) return [];
  const arranged = arrangeSquad(save, ctx);
  return FRONT_SLOTS.map((i) => save.squad[i]).filter(
    (id): id is string => id !== null && rank(id) >= 2 && !FRONT_SLOTS.some((i) => arranged[i] === id),
  );
}
