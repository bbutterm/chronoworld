import type { z } from 'zod';
import type { RawFile } from '../content/build';
import type { GameContext } from '../progression/types';
import { EquipmentError } from './errors';
import { DropsConfigSchema, ItemsFileSchema, type DropsConfig, type ItemDef } from './schema';

/** Предметы и правила выпадения — часть контекста для K6. */
export interface EquipmentConfig {
  /** id предмета → описание. */
  items: Record<string, ItemDef>;
  drops: DropsConfig;
}

/** GameContext + экипировка. */
export interface EquipmentContext extends GameContext {
  equipment: EquipmentConfig;
}

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
    .join('; ');
}

/**
 * Собрать предметы из сырых файлов data/items/*.json (ядро файлы не читает: Node — readJsonDir('data/items'),
 * браузер — import.meta.glob). Ошибка схемы или повтор id → EquipmentError('invalid_config') с именем файла.
 */
export function buildItems(files: readonly RawFile[]): Record<string, ItemDef> {
  const items: Record<string, ItemDef> = {};
  for (const f of files) {
    const r = ItemsFileSchema.safeParse(f.data);
    if (!r.success) throw new EquipmentError('invalid_config', `${f.file}: ${describe(r.error)}`);
    for (const item of r.data.items) {
      if (items[item.id]) throw new EquipmentError('invalid_config', `${f.file}: повтор id предмета ${item.id}`);
      items[item.id] = item;
    }
  }
  return items;
}

/** Разобрать data/drops.json. Ошибка → EquipmentError('invalid_config'). */
export function parseDrops(json: unknown): DropsConfig {
  const r = DropsConfigSchema.safeParse(json);
  if (!r.success) throw new EquipmentError('invalid_config', `data/drops.json: ${describe(r.error)}`);
  return r.data;
}

/**
 * Перекрёстные ссылки: профессии в items[].jobs и главы в drops.rules[].chapter должны существовать.
 * Возвращает список ошибок (пустой — всё хорошо); для content:check.
 */
export function validateEquipment(config: EquipmentConfig, ctx: GameContext): string[] {
  const errors: string[] = [];
  for (const item of Object.values(config.items)) {
    for (const job of item.jobs ?? []) {
      if (!ctx.content.jobs[job]) errors.push(`предмет ${item.id}: неизвестная профессия ${job}`);
    }
  }
  const chapters = new Set(ctx.content.stages.map((s) => s.chapter));
  config.drops.rules.forEach((rule, i) => {
    if (rule.chapter && !chapters.has(rule.chapter)) errors.push(`drops.rules.${i}: неизвестная глава ${rule.chapter}`);
  });
  if (!config.drops.rules.some((r) => !r.chapter) && ctx.content.stages.some((s) => !config.drops.rules.some((r) => r.chapter === s.chapter))) {
    errors.push('drops.rules: нет правила по умолчанию (без chapter), а у части глав нет своего');
  }
  return errors;
}

/** Собрать и проверить конфиг экипировки. */
export function buildEquipment(itemFiles: readonly RawFile[], dropsJson: unknown, ctx: GameContext): EquipmentConfig {
  const config = { items: buildItems(itemFiles), drops: parseDrops(dropsJson) };
  const errors = validateEquipment(config, ctx);
  if (errors.length) throw new EquipmentError('invalid_config', errors.join('; '));
  return config;
}

/** GameContext (или FeatureContext) → + equipment. UI: `withEquipment(ctx, itemFiles, dropsJson)`. */
export function withEquipment<C extends GameContext>(ctx: C, itemFiles: readonly RawFile[], dropsJson: unknown): C & EquipmentContext {
  return { ...ctx, equipment: buildEquipment(itemFiles, dropsJson, ctx) };
}
