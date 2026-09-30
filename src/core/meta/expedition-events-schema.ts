/**
 * Схема data/expedition_events.json — события экспедиций («текстовые приключения», docs/design/expedition-adventures.md).
 */
import { z } from 'zod';
import { MetaError } from './errors';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/** Ступени награды исхода (доля «куска» базовой добычи экспедиции: снимок / число событий). */
export const EXPEDITION_TIERS = ['none', 'small', 'medium', 'big', 'loss'] as const;
export type ExpeditionTier = (typeof EXPEDITION_TIERS)[number];

/** Кто нужен, чтобы вариант был надёжным: линия профессии (класс), роль или конкретный герой (id карточки). Любое из. */
export const ExpeditionRequiresSchema = z
  .object({
    /** Линии профессий: swordman, archer, thief, merchant, mage, acolyte. */
    line: z.array(id).min(1).optional(),
    /** Роли: tank, damage, healer, support. */
    role: z.array(z.enum(['tank', 'damage', 'healer', 'support'])).min(1).optional(),
    /** id карточек героев (data/heroes) — «характер»: Кай поджигает, Грета торгуется. */
    hero: z.array(id).min(1).optional(),
  })
  .refine((r) => r.line || r.role || r.hero, { message: 'requires: нужен line, role или hero' });

/** Исход варианта. В text: {hero} — кто действовал, {partner} — второй герой (bond), [он|она] — род того, кто действовал. */
export const ExpeditionOutcomeSchema = z.object({
  text: z.string().min(1).max(280),
  /** Ступень золота и опыта (tiers). */
  reward: z.enum(EXPEDITION_TIERS).default('none'),
  /** Предмет из добычи локации (случайный из её первого, обычного списка item). */
  item: z.boolean().default(false),
  /** Гемы (редко). */
  gems: z.number().int().min(0).max(10).default(0),
  /** Строка в Летопись экспедиций (те же подстановки). */
  lore: z.string().min(1).max(200).optional(),
  /** Герой ранен (часть добычи — на зелья; только запись в рассказе, героя не теряем). */
  wound: z.boolean().default(false),
  /** Герои сблизились: {hero} и {partner} — запись в bounties.bonds. */
  bond: z.boolean().default(false),
});

export const ExpeditionChoiceSchema = z
  .object({
    id,
    /** Надпись на кнопке. */
    label: z.string().min(1).max(34),
    requires: ExpeditionRequiresSchema.optional(),
    /** Шанс успеха без нужного героя (или всегда, если requires нет). */
    chance: z.number().min(0).max(1),
    /** Шанс успеха, если нужный герой в отряде. */
    chanceWith: z.number().min(0).max(1).default(0.95),
    /** Осторожный вариант по умолчанию (не решил — выбран он). Ровно один на событие. */
    default: z.boolean().default(false),
    success: ExpeditionOutcomeSchema,
    /** Исход неудачи (нужен, если шанс может быть < 1). */
    fail: ExpeditionOutcomeSchema.optional(),
  })
  .superRefine((c, ctx) => {
    const canFail = c.chance < 1 || (c.requires !== undefined && c.chanceWith < 1);
    if (canFail && !c.fail) ctx.addIssue({ code: 'custom', path: ['fail'], message: 'шанс меньше 1 — нужен исход fail' });
    if (c.default) {
      if (c.requires) ctx.addIssue({ code: 'custom', path: ['requires'], message: 'вариант по умолчанию — без требований' });
      if (c.chance !== 1) ctx.addIssue({ code: 'custom', path: ['chance'], message: 'вариант по умолчанию — шанс 1' });
      const s = c.success;
      if (s.reward !== 'none' || s.item || s.gems || s.wound) {
        ctx.addIssue({ code: 'custom', path: ['success'], message: 'вариант по умолчанию не меняет добычу: reward none, без item, gems и wound' });
      }
    }
  });

export const ExpeditionEventSchema = z
  .object({
    id,
    /** Заголовок окна. */
    title: z.string().min(1).max(36),
    /** Локации (id из data/expeditions.json); пусто — общее событие для любой. */
    locations: z.array(id).default([]),
    /** 2–4 предложения. */
    text: z.string().min(1).max(420),
    choices: z.array(ExpeditionChoiceSchema).min(2).max(3),
  })
  .superRefine((e, ctx) => {
    const defs = e.choices.filter((c) => c.default).length;
    if (defs !== 1) ctx.addIssue({ code: 'custom', path: ['choices'], message: `нужен ровно один вариант default (сейчас ${defs})` });
    const seen = new Set<string>();
    e.choices.forEach((c, i) => {
      if (seen.has(c.id)) ctx.addIssue({ code: 'custom', path: ['choices', i, 'id'], message: `вариант ${c.id} встречается дважды` });
      seen.add(c.id);
    });
  });

export const ExpeditionEventsConfigSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    /** Сколько событий за экспедицию: первая строка, где hours ≤ maxHours. */
    perExpedition: z.array(z.object({ maxHours: z.number().positive(), count: z.number().int().min(0).max(5) })).min(1),
    /** Доля «куска» базовой добычи (золото и опыт) по ступеням. */
    tiers: z.object({ none: z.literal(0), small: z.number().min(0).max(2), medium: z.number().min(0).max(2), big: z.number().min(0).max(3), loss: z.number().min(-1).max(0) }),
    /** Сколько записей хранить в Летописи экспедиций и «сблизились». */
    journalMax: z.number().int().positive().default(40),
    /** Вес событий своей локации при выборе (общие — вес 1). */
    localWeight: z.number().positive().default(2),
    events: z.array(ExpeditionEventSchema).min(1),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    cfg.events.forEach((e, i) => {
      if (seen.has(e.id)) ctx.addIssue({ code: 'custom', path: ['events', i, 'id'], message: `событие ${e.id} встречается дважды` });
      seen.add(e.id);
    });
  });

export type ExpeditionRequires = z.infer<typeof ExpeditionRequiresSchema>;
export type ExpeditionOutcome = z.infer<typeof ExpeditionOutcomeSchema>;
export type ExpeditionChoice = z.infer<typeof ExpeditionChoiceSchema>;
export type ExpeditionEventDef = z.infer<typeof ExpeditionEventSchema>;
export type ExpeditionEventsConfig = z.infer<typeof ExpeditionEventsConfigSchema>;

/** Разобрать data/expedition_events.json. Ошибка → MetaError('invalid_config'). */
export function parseExpeditionEvents(json: unknown): ExpeditionEventsConfig {
  const r = ExpeditionEventsConfigSchema.safeParse(json);
  if (!r.success) {
    const msg = r.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
      .join('; ');
    throw new MetaError('invalid_config', `data/expedition_events.json: ${msg}`);
  }
  return r.data;
}
