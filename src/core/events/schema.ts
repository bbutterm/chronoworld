import { z } from 'zod';
import { ACHIEVEMENT_COUNTER_KEYS } from '../meta/config';
import { DayStringSchema, RewardBundleSchema } from '../save/schema';

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id: латиница в нижнем регистре, цифры и _');

/** Награда события: та же форма, что у вложения письма (save/schema.ts RewardBundleSchema). */
export const EventRewardsSchema = RewardBundleSchema;

/** Один день календаря «Вход 7 дней». */
export const LoginDaySchema = z.object({
  rewards: EventRewardsSchema,
  /** Подпись крупной награды на плитке дня (необязательно, например «Фиолетовый герой»). */
  label: z.string().optional(),
});

/**
 * Задание «7 дней новичка»: счётчик достижений (meta/config.ts ACHIEVEMENT_COUNTERS — копится с начала игры)
 * достиг target → можно забрать points очков.
 */
export const NewbieTaskSchema = z.object({
  id,
  name: z.string(),
  counter: z.enum(ACHIEVEMENT_COUNTER_KEYS),
  target: z.number().int().positive(),
  points: z.number().int().positive(),
});

export const NewbieMilestoneSchema = z.object({
  /** Порог очков новичка. */
  points: z.number().int().positive(),
  rewards: EventRewardsSchema,
});

/** Системное письмо из данных: доставляется каждому сохранению один раз (при открытии игры). */
export const MailLetterDefSchema = z.object({
  /** id письма — не менять после выпуска (лежит в сохранениях: mail.delivered). */
  id,
  from: z.string().default('Гаррет'),
  title: z.string().min(1),
  body: z.string(),
  rewards: EventRewardsSchema.default({}),
  /** Последний день доставки 'YYYY-MM-DD' (компенсация «до такого-то числа»); нет — всегда. */
  untilDay: DayStringSchema.optional(),
  /**
   * Только тем, у кого этот этап уже пройден при первой проверке письма (объявление для уже игравших: «мир изменился»).
   * Остальным (новый игрок, не дошедший до этапа) письмо молча помечается доставленным и больше не приходит.
   */
  onlyIfCleared: z.string().optional(),
});

/** data/events.json — «Вход 7 дней», «7 дней новичка», системные письма. Формат — docs/CONTENT_RECIPES.md «Награды событий». */
export const EventsConfigSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    login: z.object({
      name: z.string(),
      /** Награды по дням входа: день N — N-й разный календарный день, когда игрок открыл игру. */
      days: z.array(LoginDaySchema).min(1),
    }),
    newbie: z.object({
      name: z.string(),
      /** Сколько дней идёт событие (задания открываются по одному дню). */
      durationDays: z.number().int().positive(),
      /** Дней после конца, когда ещё можно забрать выполненное. */
      graceDays: z.number().int().nonnegative(),
      /** Задания по дням: days[i] открывается на (i+1)-й день события. */
      days: z.array(z.object({ tasks: z.array(NewbieTaskSchema).min(1) })).min(1),
      milestones: z.array(NewbieMilestoneSchema).min(1),
    }),
    mail: z.object({
      /** Системные письма (первое — «Добро пожаловать»). */
      letters: z.array(MailLetterDefSchema),
    }),
  })
  .superRefine((cfg, c) => {
    const seen = new Set<string>();
    cfg.newbie.days.forEach((d, i) =>
      d.tasks.forEach((t, j) => {
        if (seen.has(t.id)) c.addIssue({ code: 'custom', path: ['newbie', 'days', i, 'tasks', j, 'id'], message: `задание ${t.id} встречается дважды` });
        seen.add(t.id);
      }),
    );
    if (cfg.newbie.days.length > cfg.newbie.durationDays) {
      c.addIssue({ code: 'custom', path: ['newbie', 'days'], message: `дней с заданиями (${cfg.newbie.days.length}) больше, чем длится событие (${cfg.newbie.durationDays})` });
    }
    const total = cfg.newbie.days.reduce((a, d) => a + d.tasks.reduce((b, t) => b + t.points, 0), 0);
    cfg.newbie.milestones.forEach((m, i) => {
      if (i > 0 && m.points <= cfg.newbie.milestones[i - 1].points) c.addIssue({ code: 'custom', path: ['newbie', 'milestones', i, 'points'], message: 'пороги очков должны строго возрастать' });
      if (m.points > total) c.addIssue({ code: 'custom', path: ['newbie', 'milestones', i, 'points'], message: `порог ${m.points} недостижим: за все задания — ${total} очков` });
    });
    const letters = new Set<string>();
    cfg.mail.letters.forEach((l, i) => {
      if (letters.has(l.id)) c.addIssue({ code: 'custom', path: ['mail', 'letters', i, 'id'], message: `письмо ${l.id} встречается дважды` });
      letters.add(l.id);
    });
  });

export type EventRewards = z.infer<typeof EventRewardsSchema>;
export type NewbieTask = z.infer<typeof NewbieTaskSchema>;
export type NewbieMilestone = z.infer<typeof NewbieMilestoneSchema>;
export type MailLetterDef = z.infer<typeof MailLetterDefSchema>;
export type EventsConfig = z.infer<typeof EventsConfigSchema>;
