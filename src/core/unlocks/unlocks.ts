/**
 * Открытие функций по ходу кампании (data/unlocks.json): что открыто, какие баннеры «Новая функция!» ещё не показаны.
 * Функция открыта, если её этап пройден (save.campaign.cleared) или её нет в таблице. Показанные баннеры —
 * save.seenUnlocks (каждый — один раз). Ядро только отвечает на вопросы; блокируют кнопки экраны.
 */
import type { SaveState } from '../save/schema';
import type { Content } from '../types';
import { UnlocksConfigSchema, type FeatureId, type UnlockDef, type UnlocksConfig } from './schema';

/** Контекст с таблицей открытий (нет таблицы — всё открыто сразу). */
export interface UnlocksContext {
  content: Content;
  unlocks?: UnlocksConfig;
}

/** Функция для экранов: строка таблицы + состояние игрока. */
export interface FeatureView extends UnlockDef {
  /** «1-8»: глава-этап, как в AFK. */
  stageLabel: string;
  unlocked: boolean;
  /** Баннер «Новая функция!» уже показан. */
  seen: boolean;
}

/** Разобрать data/unlocks.json. Ошибка схемы — Error с путём до поля. */
export function parseUnlocks(json: unknown): UnlocksConfig {
  const r = UnlocksConfigSchema.safeParse(json);
  if (!r.success) {
    throw new Error(
      `data/unlocks.json: ${r.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return r.data;
}

/** Перекрёстные проверки с кампанией (content:check ✗): этапы существуют. */
export function validateUnlocks(cfg: UnlocksConfig, content: Content, problems: string[]): void {
  const stages = new Set(content.stages.map((s) => s.id));
  for (const f of cfg.features) {
    if (stages.size && !stages.has(f.stage)) problems.push(`data/unlocks.json: ${f.id} — этап ${f.stage} не найден в data/campaign`);
  }
}

/** Строка таблицы функции или undefined (функция открыта сразу). */
export function unlockDef(id: FeatureId, ctx: UnlocksContext): UnlockDef | undefined {
  return ctx.unlocks?.features.find((f) => f.id === id);
}

/** Этап открытия функции или null (открыта сразу). */
export function featureStage(id: FeatureId, ctx: UnlocksContext): string | null {
  return unlockDef(id, ctx)?.stage ?? null;
}

/** «1-8» — номер главы на маршруте (order) и этапа внутри неё (как в AFK Arena). Неизвестный этап — его id. */
export function stageLabel(stageId: string, content: Content): string {
  const st = content.stages.find((s) => s.id === stageId);
  if (!st) return stageId;
  const ch = content.chapters.find((c) => c.id === st.chapter);
  return `${ch?.order ?? 1}-${st.index + 1}`;
}

/** Открыта ли функция: нет в таблице или её этап пройден. */
export function featureUnlocked(save: Pick<SaveState, 'campaign'>, id: FeatureId, ctx: UnlocksContext): boolean {
  const stage = featureStage(id, ctx);
  return stage === null || save.campaign.cleared.includes(stage);
}

/** Подпись закрытой функции: «Откроется на этапе 1-8». Открыта — пустая строка. */
export function lockedText(save: Pick<SaveState, 'campaign'>, id: FeatureId, ctx: UnlocksContext): string {
  const stage = featureStage(id, ctx);
  if (stage === null || save.campaign.cleared.includes(stage)) return '';
  return `Откроется на этапе ${stageLabel(stage, ctx.content)}`;
}

/** Все функции таблицы (в её порядке) с состоянием игрока. */
export function featureViews(save: Pick<SaveState, 'campaign' | 'seenUnlocks'>, ctx: UnlocksContext): FeatureView[] {
  const seen = new Set(save.seenUnlocks ?? []);
  return (ctx.unlocks?.features ?? []).map((f) => ({
    ...f,
    stageLabel: stageLabel(f.stage, ctx.content),
    unlocked: save.campaign.cleared.includes(f.stage),
    seen: seen.has(f.id),
  }));
}

/** Открытые, но ещё не показанные баннером функции — по порядку таблицы. */
export function pendingUnlocks(save: Pick<SaveState, 'campaign' | 'seenUnlocks'>, ctx: UnlocksContext): FeatureView[] {
  return featureViews(save, ctx).filter((f) => f.unlocked && !f.seen);
}

/** Функции, которые открывает этап (для итогов боя и модели игрока). */
export function unlocksOfStage(stageId: string, ctx: UnlocksContext): UnlockDef[] {
  return (ctx.unlocks?.features ?? []).filter((f) => f.stage === stageId);
}

/** Баннер показан — больше не показывать. Уже отмеченные не дублируются; тот же объект, если ничего не изменилось. */
export function markUnlocksSeen<S extends Pick<SaveState, 'seenUnlocks'>>(save: S, ids: readonly FeatureId[]): S {
  const seen = save.seenUnlocks ?? [];
  const add = ids.filter((id, i) => !seen.includes(id) && ids.indexOf(id) === i);
  if (!add.length && save.seenUnlocks) return save;
  return { ...save, seenUnlocks: [...seen, ...add] };
}

/**
 * Старое сохранение без seenUnlocks (до таблицы открытий): всё, что игрок уже открыл, считаем показанным —
 * иначе при первом запуске новой сборки на него вывалится пачка баннеров. Поле есть — тот же объект.
 */
export function initSeenUnlocks<S extends Pick<SaveState, 'campaign' | 'seenUnlocks'>>(save: S, ctx: UnlocksContext): S {
  if (save.seenUnlocks) return save;
  const seenUnlocks = featureViews(save, ctx).filter((f) => f.unlocked).map((f) => f.id);
  // Поле — сразу после seenScenes, как в SaveStateSchema: serialize(deserialize(x)) даёт ту же строку.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(save)) {
    out[k] = v;
    if (k === 'seenScenes') out.seenUnlocks = seenUnlocks;
  }
  if (!('seenUnlocks' in out)) out.seenUnlocks = seenUnlocks;
  return out as S;
}
