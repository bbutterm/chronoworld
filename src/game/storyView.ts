/**
 * Сюжет в UI без Phaser (тесты — tests/story.test.ts): кто говорит и чей портрет показать.
 */
import type { GameContext, SaveState, SpeakerDef, StoryDef } from '../core';
import { heroSprite } from './flow';

export interface SpeakerView {
  name: string;
  /** id спрайта для портрета; null — картинки нет (UI ставит иконку скина). */
  sprite: string | null;
}

/** hero1..heroN → герой сохранения по порядку. */
export function speakerHero(key: string, save: SaveState) {
  const m = /^hero(\d+)$/.exec(key);
  return m ? save.heroes[Number(m[1]) - 1] : undefined;
}

/**
 * Спрайт портрета спикера: 'hero' — текущая профессия героя (нет героя — стартовая профессия);
 * 'unit:<id>' — спрайт юнита (юнита нет — null); иначе id профессии, а если такой нет — id спрайта как есть.
 */
export function portraitSprite(portrait: string, ctx: GameContext, hero?: SaveState['heroes'][number]): string | null {
  if (portrait === 'hero') return hero ? heroSprite(hero, ctx) : (ctx.content.jobs[ctx.progression.heroes.startJob]?.visual.sprite ?? null);
  if (portrait.startsWith('unit:')) return ctx.content.units[portrait.slice(5)]?.visual.sprite ?? null;
  return ctx.content.jobs[portrait]?.visual.sprite ?? portrait;
}

/** Имя и портрет спикера реплики. Имя героев hero1..heroN — из сохранения (игрок мог их переименовать). */
export function speakerView(story: StoryDef | undefined, key: string, save: SaveState, ctx: GameContext): SpeakerView {
  const sp: SpeakerDef | undefined = story?.speakers[key];
  const hero = speakerHero(key, save);
  return {
    name: hero?.name ?? sp?.name ?? key,
    sprite: sp ? portraitSprite(sp.portrait, ctx, hero) : hero ? heroSprite(hero, ctx) : null,
  };
}
