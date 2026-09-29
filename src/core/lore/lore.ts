/**
 * Сборка и проверка лора (data/lore/*.json). Ядро файлы не читает: браузер — src/game/content.ts (import.meta.glob ?raw),
 * Node — scripts/content-check.ts. Лор не входит в FullContext: игра без data/lore работает как раньше.
 */
import type { z } from 'zod';
import type { RawFile } from '../content/build';
import type { ItemDef } from '../equipment/schema';
import type { HuntConfig } from '../hunt/schema';
import type { TowerConfig } from '../tower/schema';
import { extraBestiaryUnits } from './chronicle';
import type { Content } from '../types';
import { HeroesLoreSchema, ItemsLoreSchema, JobsLoreSchema, LINE_KINDS, LinesLoreSchema, LORE_LIMITS, MonstersLoreSchema, WorldLoreSchema, type LineKind, type Lore } from './schema';

export const emptyLines = (): Lore['lines'] => Object.fromEntries(Object.keys(LINE_KINDS).map((k) => [k, []])) as unknown as Record<LineKind, string[]>;

export const emptyLore = (): Lore => ({ monsters: {}, items: {}, heroes: {}, jobs: {}, chapters: {}, world: [], lines: emptyLines() });

/** Файлы data/lore и их схемы. */
export const LORE_FILES = {
  'monsters.json': MonstersLoreSchema,
  'items.json': ItemsLoreSchema,
  'heroes.json': HeroesLoreSchema,
  'jobs.json': JobsLoreSchema,
  'world.json': WorldLoreSchema,
  'lines.json': LinesLoreSchema,
} as const;

const issues = (e: z.ZodError) =>
  e.issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корень)'}: ${i.message}`)
    .join('; ');

/**
 * Лор из сырых файлов. data — разобранный JSON или текст файла (пустой текст — файла как будто нет).
 * Битый файл не роняет игру: его раздел пуст, ошибка — в problems (content:check покажет ✗).
 */
export function parseLore(files: readonly RawFile[]): { lore: Lore; problems: string[] } {
  const lore = emptyLore();
  const problems: string[] = [];
  for (const f of files) {
    const name = f.file.replace(/\\/g, '/').split('/').pop() ?? f.file;
    const label = `data/lore/${name}`;
    let data = f.data;
    if (typeof data === 'string') {
      if (!data.trim()) continue;
      try {
        data = JSON.parse(data);
      } catch (e) {
        problems.push(`${label}: не JSON — ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }
    if (data === undefined || data === null) continue;
    if (!(name in LORE_FILES)) {
      problems.push(`${label}: неизвестный файл лора (ожидаются ${Object.keys(LORE_FILES).join(', ')})`);
      continue;
    }
    const r = LORE_FILES[name as keyof typeof LORE_FILES].safeParse(data);
    if (!r.success) {
      problems.push(`${label}: ${issues(r.error)}`);
      continue;
    }
    const d = r.data as Record<string, unknown>;
    if (name === 'monsters.json') lore.monsters = d.entries as Lore['monsters'];
    else if (name === 'items.json') lore.items = d.entries as Lore['items'];
    else if (name === 'heroes.json') lore.heroes = d.entries as Lore['heroes'];
    else if (name === 'jobs.json') lore.jobs = d.entries as Lore['jobs'];
    else if (name === 'lines.json') {
      for (const k of Object.keys(LINE_KINDS) as LineKind[]) lore.lines[k] = (d[k] as string[] | undefined) ?? [];
    } else {
      lore.chapters = d.chapters as Lore['chapters'];
      lore.world = d.world as Lore['world'];
    }
  }
  return { lore, problems };
}

/** Что нужно для проверки ссылок лора. */
export interface LoreCheckContext {
  content: Pick<Content, 'units' | 'heroes' | 'jobs' | 'chapters' | 'stages'>;
  items: Record<string, ItemDef>;
  /** Башня и Охота: их монстры тоже в бестиарии (без них такие записи — ⚠ «вне кампании»). */
  tower?: TowerConfig;
  hunt?: HuntConfig;
}

/**
 * Проверка лора против контента: id монстров/предметов/героев/профессий/глав/этапов существуют (иначе ✗);
 * длина текстов сверх LORE_LIMITS, юнит-герой в бестиарии, монстр вне кампании (в «Летописи» не покажется) — ⚠.
 * Отсутствие записи — не ошибка.
 */
export function validateLore(lore: Lore, ctx: LoreCheckContext): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const long = (where: string, s: string | undefined, max: number) => {
    if (s && s.length > max) warnings.push(`${where}: ${s.length} симв. — больше ${max}, на телефоне будет длинно`);
  };
  const inStages = new Set(ctx.content.stages.flatMap((s) => s.enemies.filter((e) => !!e).map((e) => e!.unit)));
  for (const u of extraBestiaryUnits(ctx)) inStages.add(u);

  for (const [id, m] of Object.entries(lore.monsters)) {
    const at = `data/lore/monsters.json: ${id}`;
    const u = ctx.content.units[id];
    if (!u) {
      errors.push(`${at} — нет юнита в data/units`);
      continue;
    }
    if (u.kind === 'hero') warnings.push(`${at} — это юнит-герой, в бестиарии не покажется`);
    else if (!inStages.has(id)) warnings.push(`${at} — не встречается ни на этапах кампании, ни в Башне, ни на Охоте — в бестиарии не покажется`);
    long(`${at}.title`, m.title, LORE_LIMITS.title);
    long(`${at}.text`, m.text, LORE_LIMITS.text);
    long(`${at}.quote`, m.quote, LORE_LIMITS.quote);
  }
  for (const [id, s] of Object.entries(lore.items)) {
    const at = `data/lore/items.json: ${id}`;
    if (!ctx.items[id]) errors.push(`${at} — нет предмета в data/items`);
    else long(at, s, LORE_LIMITS.item);
  }
  for (const [id, h] of Object.entries(lore.heroes)) {
    const at = `data/lore/heroes.json: ${id}`;
    if (!ctx.content.heroes[id]) {
      errors.push(`${at} — нет карточки героя в data/heroes`);
      continue;
    }
    long(`${at}.story`, h.story, LORE_LIMITS.text);
    if (h.quirks.length > LORE_LIMITS.quirks) warnings.push(`${at}.quirks: ${h.quirks.length} черт — больше ${LORE_LIMITS.quirks}`);
    h.quirks.forEach((q, i) => long(`${at}.quirks.${i}`, q, LORE_LIMITS.quirk));
  }
  for (const [id, s] of Object.entries(lore.jobs)) {
    const at = `data/lore/jobs.json: ${id}`;
    if (!ctx.content.jobs[id]) errors.push(`${at} — нет профессии в data/jobs`);
    else long(at, s, LORE_LIMITS.job);
  }
  const chapterIds = new Set(ctx.content.chapters.map((c) => c.id));
  for (const [id, c] of Object.entries(lore.chapters)) {
    const at = `data/lore/world.json: chapters.${id}`;
    if (!chapterIds.has(id)) {
      errors.push(`${at} — нет главы в data/campaign`);
      continue;
    }
    long(`${at}.title`, c.title, LORE_LIMITS.title);
    long(`${at}.text`, c.text, LORE_LIMITS.text);
  }
  const stageIds = new Set(ctx.content.stages.map((s) => s.id));
  const seen = new Set<string>();
  for (const w of lore.world) {
    const at = `data/lore/world.json: world.${w.id}`;
    if (seen.has(w.id)) errors.push(`${at} — id повторяется`);
    seen.add(w.id);
    if (w.unlockAfterStage && !stageIds.has(w.unlockAfterStage)) errors.push(`${at}.unlockAfterStage = "${w.unlockAfterStage}" — нет такого этапа`);
    long(`${at}.title`, w.title, LORE_LIMITS.title);
    long(`${at}.text`, w.text, LORE_LIMITS.text);
  }
  for (const [kind, list] of Object.entries(lore.lines)) {
    const dup = list.filter((x, i) => list.indexOf(x) !== i);
    if (dup.length) warnings.push(`data/lore/lines.json: ${kind} — строка повторяется: «${dup[0]}»`);
  }
  return { errors, warnings };
}

/** Первое предложение текста (для подсказки о враге на экране этапа). */
export function firstSentence(s: string): string {
  const m = /^.*?[.!?…](?=\s|$)/s.exec(s.trim());
  return (m ? m[0] : s).trim();
}
