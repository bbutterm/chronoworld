import type Phaser from 'phaser';
import { getStage } from '../core';
import { sfx } from './audio';
import { sceneSound, type SceneSound, type Theme as SoundTheme } from './audioCore';
import { themeOfBattle, themeOfChapter, type Theme } from './backdrops';
import { CONTENT, GAME } from './content';
import { currentStage } from './flow';
import { session } from './session';

/**
 * Звуковая тема по теме фона (музыка карты, боя и фон). Бой с боссом — общая тема `boss` во всех главах (узнаваемый
 * сигнал «MVP», как в RO), вкус главы в нём держит фон главы (amb_*), который играет и там. Гласт Хейм (гл. 8) звучит
 * как старая глава 3 («склеп»), Нифльхейм (гл. 10) — как старая глава 7. Слоты маршрута без своей музыки пока берут
 * подходящую из имеющейся: канализация — топь (вода, капли), орки — пустыня (боевые барабаны), часовая башня — склеп
 * (колокола), лабиринт — ночной лес. Своя музыка слота — новые дорожки в audioCatalog.ts/audioSynth.ts и строка здесь.
 */
const SOUND_THEME: Record<Theme, SoundTheme> = {
  meadow: 'meadow',
  sewer: 'swamp',
  orc: 'desert',
  desert: 'desert',
  grove: 'grove',
  shipwreck: 'shipwreck',
  clocktower: 'crypt',
  crypt: 'crypt',
  labyrinth: 'grove',
  niflheim: 'niflheim',
  swamp: 'swamp',
};
export const soundTheme = (t: Theme): SoundTheme => SOUND_THEME[t];

/**
 * Звук экрана при его старте (installAudio в BootScene): музыка и фон по сцене, теме главы и боссу;
 * заодно стингер начала боя (рог) или баннера босса. Экраны сами ничего не вызывают.
 */
export function sceneSoundOf(scene: Phaser.Scene): SceneSound {
  const key = scene.sys.settings.key;
  const data = (scene.sys.settings.data ?? {}) as { chapter?: number; stageId?: string; mode?: string };
  if (key === 'Campaign') {
    const ci = data.chapter ?? Math.max(0, CONTENT.chapters.findIndex((c) => c.id === currentStage(session.save, GAME)?.chapter));
    return sceneSound(key, { theme: soundTheme(themeOfChapter(CONTENT.chapters[ci]?.id)) });
  }
  if (key === 'Stage' && data.stageId) return sceneSound(key, { theme: soundTheme(themeOfBattle({ stageId: data.stageId })) });
  if (key === 'Battle') {
    let boss = false;
    try {
      boss = data.mode === 'stage' && !!data.stageId && getStage(GAME, data.stageId).boss;
    } catch {
      boss = false;
    }
    sfx(boss ? 'boss_intro' : 'battle_start', { delay: 0.2 });
    const theme = data.mode === 'tower' ? 'crypt' : soundTheme(themeOfBattle({ stageId: data.stageId }));
    return sceneSound(key, { theme, boss });
  }
  return sceneSound(key);
}
