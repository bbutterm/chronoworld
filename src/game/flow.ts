/**
 * Чистые помощники экранов (без Phaser) — их проверяют тесты tests/game-flow.test.ts.
 */
import { getJob, stageStatus, type GameContext, type HeroState, type ProgressEvent, type SaveState, type StageInfo } from '../core';

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

/** Этап, на который стоит вести игрока: первый не пройденный открытый, иначе последний. */
export function currentStage(save: SaveState, ctx: GameContext): StageInfo | undefined {
  const stages = ctx.content.stages;
  return stages.find((s) => stageStatus(save, s.id, ctx) === 'open') ?? stages[stages.length - 1];
}

/** Строки для экрана итогов/тоста по событиям прогрессии (без повторов «доступна смена профессии»). */
export function describeEvents(events: ProgressEvent[], save: SaveState, ctx: GameContext): string[] {
  const heroName = (id: string) => save.heroes.find((h) => h.id === id)?.name ?? id;
  const skillName = (id: string) => ctx.content.skills[id]?.name ?? id;
  const jobName = (id: string) => ctx.content.jobs[id]?.name ?? id;
  const lines: string[] = [];
  // Несколько level-up подряд у одного героя — одна строка с итоговым уровнем.
  const levels = new Map<string, number>();
  for (const e of events) if (e.type === 'levelUp') levels.set(e.heroId, Math.max(levels.get(e.heroId) ?? 0, e.jobLevel));
  for (const [heroId, level] of levels) lines.push(`${heroName(heroId)}: джоб ${level}`);
  for (const e of events) {
    if (e.type === 'skillUnlocked') lines.push(`${heroName(e.heroId)}: новый навык «${skillName(e.skill)}»`);
    if (e.type === 'jobChanged') lines.push(`${heroName(e.heroId)}: ${jobName(e.from)} → ${jobName(e.to)}`);
    if (e.type === 'stageUnlocked') {
      const s = ctx.content.stages.find((x) => x.id === e.stageId);
      if (s) lines.push(`Открыт этап ${s.globalIndex + 1}: ${s.name}`);
    }
  }
  const jobReady = events.filter((e) => e.type === 'jobChangeAvailable');
  if (jobReady.length) lines.push(`Смена профессии доступна! (${jobReady.map((e) => heroName(e.heroId)).join(', ')})`);
  return lines;
}

/** Навык профессии, ещё не открытый у героя: имя и уровень открытия. */
export function lockedJobSkills(jobId: string, jobLevel: number, ctx: GameContext): { skill: string; jobLevel: number }[] {
  return getJob(ctx, jobId)
    .skills.filter((s) => s.jobLevel > jobLevel)
    .sort((a, b) => a.jobLevel - b.jobLevel);
}

/** id спрайта героя — от его текущей профессии. */
export function heroSprite(hero: HeroState, ctx: GameContext): string {
  return ctx.content.jobs[hero.job]?.visual.sprite ?? hero.job;
}
