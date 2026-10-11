import type { EquipmentConfig } from '../equipment/load';
import { withGear } from '../equipment/equipment';
import { simulateBattle } from '../battle';
import { enemySquad, squadUnits } from '../campaign/campaign';
import type { FeatureContext } from '../features/config';
import { heroPower } from '../features/power';
import { activeForm, heroRole, heroSkills, heroTemplate } from '../heroes/card';
import { duplicateCardsInSquad } from '../heroes/roster';
import type { GameContext } from '../progression/types';
import type { HeroState, Preset, SaveState } from '../save/schema';
import type { MetaContext } from './config';
import { MetaError } from './errors';

/** Слоты отряда: 0–1 — передняя линия, 2–4 — задняя (как в бою). */
export const FRONT_SLOTS = [0, 1] as const;
export const BACK_SLOTS = [2, 3, 4] as const;
const SQUAD_SIZE = 5;

/** These ratios guide automatic selection; they do not modify combat or guarantee a win. */
export interface AutoFormationOptions {
  /** Reserve ally healing/shields by default; false supports the model's explicit --no-healer mode. */
  sustain?: boolean;
  healRatio?: number;
  shieldRatio?: number;
  frontRatio?: number;
}

const DEFAULT_FORMATION: Required<AutoFormationOptions> = { sustain: true, healRatio: 0.45, shieldRatio: 0.65, frontRatio: 0.65 };

export interface HeroSustain {
  /** An unlocked skill can restore an ally's HP. Self-healing does not qualify. */
  heals: boolean;
  /**
   * Постоянное лечение: союзника лечит обычная атака или активный навык без триггера с перезарядкой не дольше
   * MAIN_HEAL_COOLDOWN (Лечение жрицы, Восстановление создателя). Ульта, срабатывание с шансом и редкое массовое
   * лечение (Потоп Лиры-мудреца, Яблоко Идун барда, Метание зелья) — эпизодическое: heals true, mainHeals false.
   */
  mainHeals: boolean;
  /** An unlocked skill can shield an ally. Self-only shields do not qualify. */
  shields: boolean;
  /** The skills that actually provide the above support, including basic attacks and ultimates. */
  skills: string[];
}

export interface FormationCandidate {
  hero: HeroState;
  /** Current power for the game; reachable, honestly funded potential may be used by the player model. */
  power: number;
}

/** Активное лечение с перезарядкой не дольше этого (с) — постоянное (heroSustain.mainHeals). */
const MAIN_HEAL_COOLDOWN = 9;

/** Sustain comes from the current skill set, not a role name or a future profession. */
export function heroSustain(hero: HeroState, ctx: GameContext): HeroSustain {
  const open = heroSkills(hero, ctx);
  const ult = activeForm(heroTemplate(ctx, hero.templateId), hero).ult;
  const ids = new Set([open.basic, ...open.actives, ...open.passives, ...(ult ? [ult] : [])]);
  const result: HeroSustain = { heals: false, mainHeals: false, shields: false, skills: [] };
  for (const id of ids) {
    const skill = ctx.content.skills[id];
    if (!skill || skill.target.side !== 'ally' || skill.target.pick === 'self' || (skill.trigger && skill.chance <= 0)) continue;
    const heals = skill.effects.some((effect) => effect.type === 'heal');
    const shields = skill.effects.some((effect) => effect.type === 'shield');
    if (heals || shields) result.skills.push(id);
    result.heals ||= heals;
    result.shields ||= shields;
    const main = id === open.basic || (id !== ult && !skill.trigger && (skill.cooldown ?? Infinity) <= MAIN_HEAL_COOLDOWN);
    result.mainHeals ||= heals && main;
  }
  return result;
}

const byCandidatePower = <T extends FormationCandidate>(a: T, b: T): number =>
  b.power - a.power || (a.hero.id < b.hero.id ? -1 : a.hero.id > b.hero.id ? 1 : 0);

/** Replace the same template's copy if necessary, and never remove the only tank for a non-tank. */
function replacementFor<T extends FormationCandidate>(chosen: readonly T[], incoming: T, ctx: GameContext, protectedMember?: (candidate: T) => boolean): T | undefined {
  const tanks = chosen.filter((candidate) => heroRole(candidate.hero, ctx) === 'tank').length;
  const allowed = (candidate: T) => !protectedMember?.(candidate) && (tanks !== 1 || heroRole(candidate.hero, ctx) !== 'tank' || heroRole(incoming.hero, ctx) === 'tank');
  const sameTemplate = chosen.find((candidate) => candidate.hero.templateId === incoming.hero.templateId);
  if (sameTemplate) return allowed(sameTemplate) ? sameTemplate : undefined;
  return [...chosen].filter(allowed).sort((a, b) => byCandidatePower(b, a))[0];
}

/**
 * Reserve one viable source of ally healing, or an ally shield when healing is unavailable.
 * The default 45% healing / 65% shielding floor is relative to the member being replaced, independent of rarity.
 * A modest loss of displayed power can be worthwhile for support; an untrained level-1 recruit in a veteran team
 * remains far below the floor. Keep the last tank, individual IDs, one copy per template and the caller's objects.
 * The player model can pass its already-computed potential as power; this helper never grants levels or gear.
 */
export function reserveSustain<T extends FormationCandidate>(
  chosen: readonly T[],
  candidates: readonly T[],
  ctx: GameContext,
  options: AutoFormationOptions = {},
): T[] {
  if (options.sustain === false || chosen.length < 3) return [...chosen];
  const profiles = new Map<HeroState, HeroSustain>();
  const profile = (candidate: T) => {
    let support = profiles.get(candidate.hero);
    if (!support) {
      support = heroSustain(candidate.hero, ctx);
      profiles.set(candidate.hero, support);
    }
    return support;
  };
  // 3 — постоянное лечение, 2 — эпизодическое (ульта, шанс, редкое массовое), 1 — щит союзникам. Эпизодическое
  // лечение не заменяет лекаря: Потоп Лиры-мудреца раз в ~20 с не держит отряд, и «Авто» не убирает ради него жрицу.
  const priority = (candidate: T) => profile(candidate).mainHeals ? 3 : profile(candidate).heals ? 2 : profile(candidate).shields ? 1 : 0;
  const current = Math.max(...chosen.map(priority));
  if (current === 3) return [...chosen];
  const selectedIds = new Set(chosen.map((candidate) => candidate.hero.id));
  const eligible = [...candidates]
    .filter((candidate) => !selectedIds.has(candidate.hero.id) && Number.isFinite(candidate.power) && candidate.power > 0 && priority(candidate) > current)
    .sort((a, b) => priority(b) - priority(a) || byCandidatePower(a, b));
  for (const incoming of eligible) {
    const outgoing = replacementFor(chosen, incoming, ctx);
    const ratio = profile(incoming).heals ? options.healRatio ?? DEFAULT_FORMATION.healRatio : options.shieldRatio ?? DEFAULT_FORMATION.shieldRatio;
    if (outgoing && incoming.power >= outgoing.power * ratio) return chosen.map((candidate) => candidate === outgoing ? incoming : candidate);
  }
  return [...chosen];
}

/** Reserve a viable tank when the strongest five otherwise provide no tank at all. */
function reserveFrontline<T extends FormationCandidate>(chosen: readonly T[], candidates: readonly T[], ctx: GameContext, ratio: number): T[] {
  if (chosen.length < 3 || chosen.some((candidate) => heroRole(candidate.hero, ctx) === 'tank')) return [...chosen];
  const selected = new Set(chosen.map((candidate) => candidate.hero.id));
  const healers = chosen.filter((candidate) => heroSustain(candidate.hero, ctx).mainHeals);
  const tanks = [...candidates].filter((candidate) => !selected.has(candidate.hero.id) && heroRole(candidate.hero, ctx) === 'tank').sort(byCandidatePower);
  for (const incoming of tanks) {
    const outgoing = replacementFor(chosen, incoming, ctx, (candidate) => healers.length === 1 && candidate === healers[0] && !heroSustain(incoming.hero, ctx).mainHeals);
    if (outgoing && incoming.power >= outgoing.power * ratio) return chosen.map((candidate) => candidate === outgoing ? incoming : candidate);
  }
  return [...chosen];
}

/**
 * Проверить расстановку: 5 слотов, герои существуют и не повторяются, одна копия каждой карточки.
 * MetaError('invalid_squad' | 'unknown_hero' | 'duplicate_card').
 */
function checkSquad(save: SaveState, squad: readonly (string | null)[]): (string | null)[] {
  if (squad.length !== SQUAD_SIZE) throw new MetaError('invalid_squad', `В отряде должно быть ${SQUAD_SIZE} слотов`);
  const seen = new Set<string>();
  for (const id of squad) {
    if (id === null) continue;
    if (!save.heroes.some((h) => h.id === id)) throw new MetaError('unknown_hero', `Герой ${id} не найден`);
    if (seen.has(id)) throw new MetaError('invalid_squad', `Герой ${id} стоит в отряде дважды`);
    seen.add(id);
  }
  if (duplicateCardsInSquad(save, squad).length) throw new MetaError('duplicate_card', 'В отряде может быть только одна копия каждой карточки');
  return [...squad];
}

/**
 * Поставить отряд squad (5 слотов) с проверкой: герои существуют, не повторяются, одна копия каждой карточки.
 * MetaError('invalid_squad' | 'unknown_hero' | 'duplicate_card'). Экраны отряда — через эту функцию.
 */
export function setSquad(save: SaveState, squad: readonly (string | null)[]): SaveState {
  return { ...save, squad: checkSquad(save, squad) };
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
  const cfg = ctx.meta.expeditions.presets;
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
 * Герои в экспедиции (K9) ставятся как обычно — экспедиция не мешает сражаться.
 * MetaError('unknown_preset').
 */
export function applyPreset(save: SaveState, presetId: string): SaveState {
  const p = save.presets.find((x) => x.id === presetId);
  if (!p) throw new MetaError('unknown_preset', `Пресет ${presetId} не найден`);
  const used = new Set<string>();
  const cards = new Set<string>();
  const squad = p.squad.map((id) => {
    const hero = id === null ? undefined : save.heroes.find((h) => h.id === id);
    // Нет героя, повтор или вторая копия карточки — пустой слот.
    if (!hero || used.has(hero.id) || cards.has(hero.templateId)) return null;
    used.add(hero.id);
    cards.add(hero.templateId);
    return hero.id;
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
 * Роль — карточки (форма), дальность — по обычной атаке класса (skill.range).
 */
export function formationRank(hero: HeroState, ctx: GameContext): number {
  const role = heroRole(hero, ctx);
  if (role === 'tank') return 0;
  if (role === 'healer') return 3;
  const basic = ctx.content.skills[heroSkills(hero, ctx).basic];
  if (basic?.target.side === 'ally' && basic.target.pick !== 'self' && basic.effects.some((effect) => effect.type === 'heal')) return 3;
  return basic?.range === 'melee' ? 1 : 2;
}

/**
 * K8. Авто-расстановка. Возвращает новый squad (save не меняет).
 * 1. Берутся 5 самых сильных разных карточек по heroPower (с экипировкой); при равной мощи — id по возрастанию.
 * 2. Если нет танка или поддержки, резервируется жизнеспособный танк и источник лечения союзников (иначе — щита).
 *    Это эвристика состава: мощь может немного снизиться, уровень/экипировка не меняются, победа не гарантирована.
 * 3. «Передние» (танки, затем ближний бой; внутри — мощь ↓, id ↑) занимают слоты 0, 1, 2, 3, 4 по порядку
 *    первого свободного; «задние» (лекари, затем дальний бой; внутри — мощь ↓, id ↑) — с конца: 4, 3, 2, 1, 0.
 *    Так танки всегда в 0–1, лекари — в самом тылу, а при нехватке одной из групп другая занимает её слоты.
 * Героев меньше 5 — лишние слоты null. Герои в экспедиции участвуют (экспедиция не мешает сражаться).
 */
export function autoFormation(save: SaveState, ctx: FeatureContext & { equipment?: EquipmentConfig }, options: AutoFormationOptions = {}): (string | null)[] {
  const gear = withGear(ctx, save);
  const rated = save.heroes.map((hero) => ({ hero, power: heroPower(hero, gear), rank: formationRank(hero, ctx) }));
  const templates = new Set<string>();
  const strongest = [...rated]
    .sort(byCandidatePower)
    .filter((r) => {
      const t = r.hero.templateId;
      if (templates.has(t)) return false;
      templates.add(t);
      return true;
    })
    .slice(0, SQUAD_SIZE);
  const front = reserveFrontline(strongest, rated, ctx, options.frontRatio ?? DEFAULT_FORMATION.frontRatio);
  const chosen = options.sustain === false ? front : reserveSustain(front, rated, ctx, options);
  const squad: (string | null)[] = Array(SQUAD_SIZE).fill(null);
  const place = (id: string, order: readonly number[]) => {
    const slot = order.find((i) => squad[i] === null)!;
    squad[slot] = id;
  };
  const frontline = chosen.filter((h) => h.rank <= 1).sort((a, b) => a.rank - b.rank || byCandidatePower(a, b));
  const back = chosen.filter((h) => h.rank >= 2).sort((a, b) => b.rank - a.rank || byCandidatePower(a, b));
  for (const h of frontline) place(h.hero.id, [0, 1, 2, 3, 4]);
  for (const h of back) place(h.hero.id, [4, 3, 2, 1, 0]);
  return squad;
}

/** Seeds of the stage check: fixed, never the seed of the player's next battle (no peeking at the real outcome). */
export const STAGE_FORMATION_SEEDS = [9001, 9002, 9003, 9004] as const;
/** Second pass for the best swap only; the swap must win at least STAGE_CONFIRM_MARGIN more of all 12 battles. */
const STAGE_CONFIRM_SEEDS = [9005, 9006, 9007, 9008, 9009, 9010, 9011, 9012] as const;
const STAGE_CONFIRM_MARGIN = 3;

export interface StageFormationOptions extends AutoFormationOptions {
  /** Day of the battle: today's Kitchen dish counts, as in playStage. */
  day?: string;
}

/**
 * «Авто» под конкретный этап. Состав — тот же, что у autoFormation; расстановка проверяется боями ядра:
 * кандидаты — обмены двух слотов autoFormation внутри своей группы (ближние между собой, дальние между собой),
 * каждый — STAGE_FORMATION_SEEDS.length боёв simulateBattle без лога против врагов этапа. Лучший обмен
 * перепроверяется ещё на 8 seed и берётся, только если из 12 боёв выигрывает хотя бы на 3 больше autoFormation;
 * иначе (и если autoFormation и так выигрывает все 4) — autoFormation, расстановка не прыгает.
 * Так прыгуны (Сворд-фиш на ch6_s1) не застают отряд, где страж стоит не там: перехват дотягивается до тыла.
 * Детерминированно; чистая функция, save не меняет. До ~50 коротких боёв — для кнопки «Авто» на экране этапа.
 */
export function autoFormationForStage(save: SaveState, stageId: string, ctx: FeatureContext & { equipment?: EquipmentConfig }, options: StageFormationOptions = {}): (string | null)[] {
  const base = autoFormation(save, ctx, options);
  const filled = base.filter((id) => id !== null).length;
  if (filled < 2 || !ctx.content.stages.some((stage) => stage.id === stageId)) return base;
  // Обмены только внутри своей группы: ближние (танк, ближний бой) между собой, дальние и лекари между собой.
  // Маг или жрица в первом ряду ради случайной победы игроку непонятны — такие кандидаты не рассматриваются.
  const front = (id: string | null) => {
    const hero = id === null ? undefined : save.heroes.find((h) => h.id === id);
    return hero ? formationRank(hero, ctx) <= 1 : undefined;
  };
  const candidates: (string | null)[][] = [];
  for (let i = 0; i < SQUAD_SIZE; i++)
    for (let j = i + 1; j < SQUAD_SIZE; j++) {
      const a = front(base[i]);
      const b = front(base[j]);
      if (a !== b && a !== undefined && b !== undefined) continue;
      if (a === undefined && b === undefined) continue;
      const swapped = [...base];
      [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
      candidates.push(swapped);
    }
  if (candidates.length === 0) return base;
  const gear = withGear(ctx, save);
  const enemies = enemySquad(stageId, ctx, save.campaignChoices);
  const wins = (squad: (string | null)[], seeds: readonly number[]) => {
    const units = squadUnits({ ...save, squad }, gear, options.day).squad;
    return seeds.filter((seed) => simulateBattle(ctx.content, units, enemies, seed, { combat: ctx.combat, log: false }).winner === 'A').length;
  };
  const baseWins = wins(base, STAGE_FORMATION_SEEDS);
  if (baseWins === STAGE_FORMATION_SEEDS.length) return base;
  let best: (string | null)[] | undefined;
  let bestWins = baseWins;
  for (const candidate of candidates) {
    const w = wins(candidate, STAGE_FORMATION_SEEDS);
    if (w > bestWins) {
      best = candidate;
      bestWins = w;
    }
    if (bestWins === STAGE_FORMATION_SEEDS.length) break;
  }
  if (!best) return base;
  // Проверка на других seed: 4 боя шумны, обмен должен быть заметно лучше и там (иначе расстановка прыгает зря).
  const total = bestWins + wins(best, STAGE_CONFIRM_SEEDS);
  const baseTotal = baseWins + wins(base, STAGE_CONFIRM_SEEDS);
  return total >= baseTotal + STAGE_CONFIRM_MARGIN ? best : base;
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
