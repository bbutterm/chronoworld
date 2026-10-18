import { z } from 'zod';

/**
 * Коды (раздел «Коды» в настройках): игрок вводит слово — получает награду. Регистр и пробелы по краям не важны,
 * в data/codes.json код записан в нижнем регистре.
 * - once: true — одноразовый (на сохранение игрока; отметка — save.codesUsed);
 * - gems — алмазы (гемы) на счёт;
 * - scrolls — свитки призыва Таверны;
 * - hours — игровые часы вперёд (сундук офлайн-наград, экспедиции, новый день). Сдвиг часов делает интерфейс
 *   (src/game/session.ts shiftTime): ядро про «сейчас» не знает.
 */
export const CodeSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9]+$/, 'код: латиница в нижнем регистре и цифры'),
    once: z.boolean(),
    gems: z.number().int().nonnegative().default(0),
    hours: z.number().int().nonnegative().default(0),
    scrolls: z.number().int().nonnegative().default(0),
  })
  .refine((c) => c.gems > 0 || c.hours > 0 || c.scrolls > 0, { message: 'код ничего не даёт: нужен gems, scrolls или hours' });

export const CodesConfigSchema = z
  .object({ codes: z.array(CodeSchema) })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    cfg.codes.forEach((c, i) => {
      if (seen.has(c.code)) ctx.addIssue({ code: 'custom', path: ['codes', i, 'code'], message: `код «${c.code}» повторяется` });
      seen.add(c.code);
    });
  });

export type CodeDef = z.infer<typeof CodeSchema>;
export type CodesConfig = z.infer<typeof CodesConfigSchema>;

export function parseCodesConfig(raw: unknown): CodesConfig {
  return CodesConfigSchema.parse(raw);
}
