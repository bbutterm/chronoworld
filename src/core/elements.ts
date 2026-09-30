import { z } from 'zod';
import type { SkillDef, UnitDef } from './content/schema';

/**
 * Стихии RO (docs/design/battle-decisions.md §3): защита врага — поле element юнита, атака — поле element навыка
 * (обычные атаки нейтральны). Множители — data/combat.json → elements.chart (атака → защита → множитель, нет — ×1).
 * Минимум правил: круг огонь > земля > ветер > вода > огонь, святость/тьма/нежить; нейтраль без модификаторов.
 */
export const ELEMENTS = ['neutral', 'fire', 'water', 'earth', 'wind', 'holy', 'dark', 'undead'] as const;
export type Element = (typeof ELEMENTS)[number];
export const ElementSchema = z.enum(ELEMENTS);

/** Названия для игрока. */
export const ELEMENT_NAMES: Record<Element, string> = {
  neutral: 'нейтраль',
  fire: 'огонь',
  water: 'вода',
  earth: 'земля',
  wind: 'ветер',
  holy: 'святость',
  dark: 'тьма',
  undead: 'нежить',
};

/** Цвет значка стихии (кружок, рисуется кодом). */
export const ELEMENT_TINT: Record<Element, number> = {
  neutral: 0xb8b0a0,
  fire: 0xff6a2a,
  water: 0x4aa8ff,
  earth: 0xb08040,
  wind: 0x7ee07a,
  holy: 0xfff0a0,
  dark: 0x9a5ad8,
  undead: 0x6a8a70,
};

/** Символ на значке. */
export const ELEMENT_GLYPH: Record<Element, string> = {
  neutral: '·',
  fire: 'О',
  water: 'В',
  earth: 'З',
  wind: 'Вт',
  holy: 'С',
  dark: 'Т',
  undead: 'Н',
};

export const ElementsConfigSchema = z.object({
  $comment: z.string().optional(),
  /** Атака → защита → множитель урона (нет в таблице — ×1). */
  chart: z.partialRecord(ElementSchema, z.partialRecord(ElementSchema, z.number().positive())),
  /** Подпись «Слабость!» / «Стойкость» над одной целью — не чаще раза в столько секунд (только вид). */
  popupSeconds: z.number().nonnegative().default(6),
});
export type ElementsConfig = z.infer<typeof ElementsConfigSchema>;

/** Множитель урона атаки стихии atk по защите def. */
export function elementMult(cfg: ElementsConfig | undefined, atk: Element, def: Element): number {
  if (!cfg || atk === 'neutral' && def === 'neutral') return 1;
  return cfg.chart[atk]?.[def] ?? 1;
}

/** Стихия атаки навыка. */
export const skillElement = (s: Pick<SkillDef, 'element'>): Element => s.element ?? 'neutral';

/** Стихия защиты юнита. */
export const defenseElement = (u: Pick<UnitDef, 'element'>): Element => u.element ?? 'neutral';

/**
 * Стихия атаки бойца для значка: чаще всего встречающаяся ненейтральная стихия его атакующих навыков (обычная атака,
 * активные, ульта); равенство — первая по порядку. Нет — нейтраль.
 */
export function attackElement(def: UnitDef, skills: Record<string, SkillDef>): Element {
  const count = new Map<Element, number>();
  for (const id of [def.skills.basic, def.skills.ult, ...def.skills.actives]) {
    const s = id ? skills[id] : undefined;
    if (!s || !s.effects.some((e) => e.type === 'damage')) continue;
    const el = skillElement(s);
    if (el !== 'neutral') count.set(el, (count.get(el) ?? 0) + 1);
  }
  let best: Element = 'neutral';
  let n = 0;
  for (const [el, c] of count)
    if (c > n) {
      best = el;
      n = c;
    }
  return best;
}

/** Против каких стихий защиты атака stronger (×>1) — для подсказок «берите огонь». */
export function weakTo(cfg: ElementsConfig | undefined, def: Element): Element[] {
  if (!cfg) return [];
  return ELEMENTS.filter((a) => (cfg.chart[a]?.[def] ?? 1) > 1);
}
