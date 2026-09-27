/**
 * Q: фазз прогрессии и сохранения. Случайные последовательности действий игрока (act*, поручения, задания,
 * достижения, пресеты, отряд, смена дня, скачки времени вперёд и назад). После каждого шага — инварианты
 * сохранения (tests/invariants.ts saveProblems). Входной save глубоко заморожен: изменение его на месте —
 * TypeError, т. е. баг «нечистой» функции. Ожидаемые ошибки — только классы правил игры (RULE_ERRORS).
 * Воспроизведение: FUZZ_SEED=<seed> npx vitest run tests/fuzz-progression.test.ts (см. docs/content/testing.md).
 */
import { describe, expect, it } from 'vitest';
import {
  actChangeJob,
  actClaimOffline,
  actClimbTower,
  actEquip,
  actPlayStage,
  actSkipStage,
  actUnequip,
  actUseFastRewards,
  addItems,
  addJobExp,
  applyPreset,
  autoFormation,
  availableJobChanges,
  claimAchievement,
  claimActivity,
  claimBounty,
  claimQuest,
  deletePreset,
  deserialize,
  loadOrNew,
  MemoryStorage,
  SaveError,
  ensureBoard,
  newGame,
  refreshBoard,
  Rng,
  savePreset,
  serialize,
  startBounty,
  stageStatus,
  syncAchievementCounters,
  type SaveState,
} from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { deepFreeze, fuzzSeeds, isRuleError, saveProblems } from './invariants';

const ctx = loadFullContext();
const STEPS = Number(process.env.FUZZ_STEPS ?? '') || 100;
const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 0, 1, 12);
const JOB_IDS = Object.keys(ctx.content.jobs).sort();
const ITEM_IDS = Object.keys(ctx.equipment.items).sort();

const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[rng.int(arr.length)];
const dayString = (i: number) => new Date(T0 + i * DAY_MS).toISOString().slice(0, 10);
const seed32 = (rng: Rng) => Math.floor(rng.next() * 2 ** 32);

interface World {
  save: SaveState;
  /** Часы игрока (мс) и номер дня — меняются независимо, в том числе назад. */
  now: number;
  dayIdx: number;
}

/**
 * Стартовое состояние: новая игра, либо «ветеран» (герои прокачаны addJobExp, пройдена часть кампании,
 * есть гемы и предметы) — чтобы фазз доходил до смены профессий, башни и экипировки за 100 шагов.
 */
function start(rng: Rng): World {
  const dayIdx = rng.int(30);
  let save = newGame(ctx, T0 + dayIdx * DAY_MS, dayString(dayIdx));
  if (rng.next() < 0.5) {
    const cleared = ctx.content.stages.slice(0, rng.int(ctx.content.stages.length + 1)).map((s) => s.id);
    save = {
      ...save,
      heroes: save.heroes.map((h) => addJobExp(h, rng.int(200_000), ctx).hero),
      campaign: { cleared },
      currency: { gems: rng.int(500) },
      resources: { gold: rng.int(100_000) },
    };
    save = addItems(save, Array.from({ length: rng.int(12) }, () => pick(rng, ITEM_IDS))).save;
    save = syncAchievementCounters(save);
  }
  return { save, now: T0 + dayIdx * DAY_MS, dayIdx };
}

/** Следующий этап для штурма: чаще открытый, иначе пройденный, любой или несуществующий. */
function pickStage(rng: Rng, save: SaveState): string {
  const r = rng.next();
  if (r < 0.03) return 'no_such_stage';
  if (r < 0.2) return pick(rng, ctx.content.stages).id;
  const open = ctx.content.stages.find((s) => stageStatus(save, s.id, ctx) === 'open');
  if (open && r < 0.8) return open.id;
  return save.campaign.cleared.length ? pick(rng, save.campaign.cleared) : ctx.content.stages[0].id;
}

function heroId(rng: Rng, save: SaveState): string {
  return rng.next() < 0.05 ? 'ghost' : pick(rng, save.heroes).id;
}

/** Случайные неповторяющиеся герои (иногда с повтором или неизвестным — для проверки ошибок). */
function heroGroup(rng: Rng, save: SaveState, n: number): string[] {
  const ids = save.heroes.map((h) => h.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const group = ids.slice(0, n);
  if (rng.next() < 0.05 && group.length) group[group.length - 1] = group[0];
  if (rng.next() < 0.03) group.push('ghost');
  return group;
}

type Op = (w: World, rng: Rng, day: string) => SaveState;

/** Действия игрока с весами. Каждое возвращает новый save (или бросает ошибку правил). */
const OPS: [string, number, Op][] = [
  ['playStage', 20, (w, rng, day) => actPlayStage(w.save, day, pickStage(rng, w.save), seed32(rng), ctx).save],
  ['skipStage', 6, (w, rng, day) => actSkipStage(w.save, day, pickStage(rng, w.save), seed32(rng), ctx).save],
  [
    'claimOffline',
    8,
    (w, rng, day) => {
      const r = rng.next();
      // Скачок часов: обычно вперёд до суток, иногда далеко вперёд (больше лимита сундука) или назад.
      w.now += r < 0.15 ? -rng.int(3 * DAY_MS) : r < 0.25 ? rng.int(10 * DAY_MS) : rng.int(DAY_MS);
      return actClaimOffline(w.save, w.now, day, ctx).save;
    },
  ],
  ['fastRewards', 5, (w, _rng, day) => actUseFastRewards(w.save, day, ctx).save],
  [
    'changeJob',
    5,
    (w, rng, day) => {
      const hero = pick(rng, w.save.heroes);
      const avail = availableJobChanges(hero, ctx);
      const job = avail.length && rng.next() < 0.9 ? pick(rng, avail) : pick(rng, JOB_IDS);
      return actChangeJob(w.save, day, rng.next() < 0.03 ? 'ghost' : hero.id, job, ctx).save;
    },
  ],
  [
    'equip',
    6,
    (w, rng) => {
      const items = w.save.inventory.items;
      const item = items.length && rng.next() > 0.05 ? pick(rng, items).id : 'it_missing';
      return actEquip(w.save, heroId(rng, w.save), item, ctx);
    },
  ],
  [
    'unequip',
    3,
    (w, rng) => {
      const items = w.save.inventory.items;
      return actUnequip(w.save, items.length && rng.next() > 0.05 ? pick(rng, items).id : 'it_missing');
    },
  ],
  ['tower', 6, (w, rng, day) => actClimbTower(w.save, day, seed32(rng), ctx).save],
  ['ensureBoard', 3, (w, rng, day) => ensureBoard(w.save, day, seed32(rng), ctx)],
  ['refreshBoard', 2, (w, rng, day) => refreshBoard(w.save, day, seed32(rng), ctx)],
  [
    'startBounty',
    5,
    (w, rng) => {
      const board = w.save.bounties.board;
      const b = board.length && rng.next() > 0.05 ? pick(rng, board) : undefined;
      const n = b ? (rng.next() < 0.9 ? b.heroCount : 1 + rng.int(5)) : 1;
      return startBounty(w.save, b?.id ?? 'b_missing', heroGroup(rng, w.save, n), w.now, ctx);
    },
  ],
  [
    'claimBounty',
    4,
    (w, rng) => {
      const active = w.save.bounties.active;
      if (active.length && rng.next() < 0.5) w.now = Math.max(w.now, pick(rng, active).endsAt);
      return claimBounty(w.save, active.length ? pick(rng, active).id : 'b_missing', w.now, ctx).save;
    },
  ],
  ['claimQuest', 4, (w, rng, day) => claimQuest(w.save, day, rng.next() < 0.05 ? 'no_quest' : pick(rng, ctx.features.quests.quests).id, ctx).save],
  [
    'claimActivity',
    3,
    (w, rng, day) => claimActivity(w.save, day, rng.next() < 0.05 ? 7 : pick(rng, ctx.features.quests.milestones).points, ctx).save,
  ],
  [
    'claimAchievement',
    3,
    (w, rng) => claimAchievement(w.save, rng.next() < 0.05 ? 'no_achievement' : pick(rng, ctx.meta.achievements.achievements).id, ctx).save,
  ],
  [
    'savePreset',
    3,
    (w, rng) => {
      const name = pick(rng, ['Атака', '  ', '', 'x'.repeat(40), ' Защита ', 'Башня']);
      const id = w.save.presets.length && rng.next() < 0.3 ? pick(rng, w.save.presets).id : rng.next() < 0.05 ? 'p999' : undefined;
      const squad = rng.next() < 0.3 ? [...heroGroup(rng, w.save, rng.int(6)), null, null, null, null, null].slice(0, rng.next() < 0.05 ? 4 : 5) : undefined;
      return savePreset(w.save, name, ctx, { id, squad }).save;
    },
  ],
  ['applyPreset', 2, (w, rng) => applyPreset(w.save, w.save.presets.length && rng.next() > 0.1 ? pick(rng, w.save.presets).id : 'p999')],
  ['deletePreset', 1, (w, rng) => deletePreset(w.save, w.save.presets.length && rng.next() > 0.1 ? pick(rng, w.save.presets).id : 'p999')],
  ['autoFormation', 2, (w) => ({ ...w.save, squad: autoFormation(w.save, ctx) })],
  [
    'assignSlot',
    4,
    (w, rng) => {
      // Как в UI (src/game/flow.ts assignSlot): герой уникален — при повторе меняется местами.
      const slot = rng.int(5);
      const id = rng.next() < 0.2 ? null : pick(rng, w.save.heroes).id;
      const squad = [...w.save.squad];
      const from = id === null ? -1 : squad.indexOf(id);
      if (from >= 0) squad[from] = squad[slot];
      squad[slot] = id;
      return { ...w.save, squad };
    },
  ],
  [
    'changeDay',
    4,
    (w, rng) => {
      w.dayIdx += rng.next() < 0.15 ? -1 - rng.int(3) : 1 + rng.int(2);
      return w.save;
    },
  ],
  ['roundTrip', 2, (w) => deserialize(serialize(w.save))],
];
const TOTAL_WEIGHT = OPS.reduce((s, [, wt]) => s + wt, 0);

function pickOp(rng: Rng): [string, Op] {
  let x = rng.next() * TOTAL_WEIGHT;
  for (const [name, wt, op] of OPS) {
    if (x < wt) return [name, op];
    x -= wt;
  }
  const [name, , op] = OPS[OPS.length - 1];
  return [name, op];
}

interface RunStats {
  ok: Record<string, number>;
  ruleErrors: number;
}

/** Один прогон: null — всё хорошо, иначе описание первой проблемы (шаг, действие, нарушения). */
function fuzzRun(seed: number, stats: RunStats): string | null {
  const rng = new Rng(seed);
  const w = start(rng);
  const initial = saveProblems(w.save, ctx);
  if (initial.length) return `старт: ${initial.join('; ')}`;
  const trace: string[] = [];
  for (let step = 0; step < STEPS; step++) {
    const [name, op] = pickOp(rng);
    const day = dayString(w.dayIdx);
    const before = serialize(w.save);
    deepFreeze(w.save);
    trace.push(`${step}:${name}`);
    try {
      w.save = op(w, rng, day);
      stats.ok[name] = (stats.ok[name] ?? 0) + 1;
    } catch (e) {
      if (!isRuleError(e)) {
        return `шаг ${step} (${name}, день ${day}): неожиданное исключение ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n  путь: ${trace.slice(-15).join(' ')}`;
      }
      stats.ruleErrors++;
      if (serialize(w.save) !== before) return `шаг ${step} (${name}): save изменился, хотя действие бросило ошибку`;
    }
    const problems = saveProblems(w.save, ctx);
    if (problems.length) return `шаг ${step} (${name}, день ${day}): ${problems.slice(0, 6).join('; ')}\n  путь: ${trace.slice(-15).join(' ')}`;
  }
  return null;
}

describe('Q: фазз прогрессии и сохранения', () => {
  it('50 прогонов × 100 шагов: инварианты сохранения после каждого шага', () => {
    const stats: RunStats = { ok: {}, ruleErrors: 0 };
    const failures: string[] = [];
    for (const seed of fuzzSeeds(1000, 50)) {
      const f = fuzzRun(seed, stats);
      if (f) failures.push(`seed ${seed} (FUZZ_SEED=${seed}): ${f}`);
      if (failures.length >= 5) break;
    }
    expect(failures, failures.join('\n')).toEqual([]);
    if (process.env.FUZZ_SEED === undefined) {
      // Фазз действительно доходит до ключевых действий, а не упирается в ошибки правил.
      for (const name of ['playStage', 'skipStage', 'claimOffline', 'changeJob', 'equip', 'tower', 'startBounty', 'claimBounty', 'claimQuest', 'savePreset']) {
        expect(stats.ok[name] ?? 0, `успешных ${name}`).toBeGreaterThan(0);
      }
    }
    if (process.env.FUZZ_VERBOSE) console.log(stats);
  }, 600_000);
});

/** Случайная порча JSON-значения: удалить ключ, заменить тип, странное число, лишний элемент. */
function mutate(v: unknown, rng: Rng, depth = 0): unknown {
  const weird = [null, -1, 1.5, 1e308, -0, '', 'x', true, [], {}, 'NaN', 2 ** 53, '1970-13-40'];
  if (depth > 0 && rng.next() < 0.08) return pick(rng, weird);
  if (Array.isArray(v)) {
    const out = v.map((x) => (rng.next() < 0.3 ? mutate(x, rng, depth + 1) : x));
    if (rng.next() < 0.05) out.push(out.length ? out[0] : pick(rng, weird));
    if (rng.next() < 0.05) out.pop();
    return out;
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (depth > 0 && rng.next() < 0.03) continue;
      out[k] = rng.next() < 0.3 ? mutate(x, rng, depth + 1) : x;
    }
    return out;
  }
  if (typeof v === 'number' && rng.next() < 0.3) return pick(rng, [v + 1, -v, v * 1e6, Math.floor(v / 2)]);
  if (typeof v === 'string' && rng.next() < 0.3) return pick(rng, [`${v}_x`, '', v.toUpperCase()]);
  return v;
}

describe('Q: фазз испорченных сохранений', () => {
  it('deserialize бросает только SaveError; принятое сохранение не роняет действия игрока', () => {
    const failures: string[] = [];
    let accepted = 0;
    for (const seed of fuzzSeeds(5000, 300)) {
      const rng = new Rng(seed);
      const w = start(rng);
      // Немного поиграть, чтобы в сохранении были предметы, поручения, пресеты.
      for (let i = 0; i < 20; i++) {
        const [, op] = pickOp(rng);
        try {
          w.save = op(w, rng, dayString(w.dayIdx));
        } catch {
          /* ошибки правил здесь не важны */
        }
      }
      let raw: unknown = JSON.parse(serialize(w.save));
      // Иногда — «старая» версия формата, чтобы через порчу прошли и миграции.
      if (rng.next() < 0.2) raw = { ...(raw as object), version: rng.int(3) };
      const text = rng.next() < 0.03 ? serialize(w.save).slice(0, rng.int(200)) : JSON.stringify(mutate(raw, rng));
      let loaded: SaveState;
      try {
        loaded = deserialize(text);
      } catch (e) {
        if (!(e instanceof SaveError)) failures.push(`seed ${seed} (FUZZ_SEED=${seed}): deserialize бросил ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
        const storage = new MemoryStorage();
        storage.save(text);
        try {
          if (loadOrNew(storage, ctx, w.now).source !== 'reset') failures.push(`seed ${seed}: loadOrNew не сообщил о сбросе`);
        } catch (e2) {
          failures.push(`seed ${seed}: loadOrNew бросил ${String(e2)}`);
        }
        continue;
      }
      // Принятое (пусть и странное) сохранение: действия бросают только ошибки правил.
      w.save = loaded;
      accepted++;
      for (let i = 0; i < 15; i++) {
        const [name, op] = pickOp(rng);
        try {
          w.save = op(w, rng, dayString(w.dayIdx));
        } catch (e) {
          if (!isRuleError(e)) {
            failures.push(`seed ${seed} (FUZZ_SEED=${seed}): после загрузки ${name} бросил ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n  сохранение: ${text.slice(0, 400)}`);
            break;
          }
        }
      }
      if (failures.length >= 5) break;
    }
    expect(failures, failures.join('\n')).toEqual([]);
    if (process.env.FUZZ_VERBOSE) console.log({ accepted });
    // Часть испорченных сохранений должна проходить схему — иначе проверка действий ничего не проверяет.
    if (process.env.FUZZ_SEED === undefined) expect(accepted).toBeGreaterThan(10);
  }, 600_000);
});
