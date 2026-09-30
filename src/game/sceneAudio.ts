import type Phaser from 'phaser';
import { getStage, towerStatus } from '../core';
import { sfx } from './audio';
import { sceneSound, type SceneSound, type Theme as SoundTheme } from './audioCore';
import { themeOfBattle, themeOfChapter, themeOfTowerFloor, type Theme } from './backdrops';
import { CONTENT, GAME } from './content';
import { currentStage } from './flow';
import { session } from './session';

/**
 * Звуковая тема = тема фона главы (у каждой темы — своя музыка карты и боя, docs/design/audio.md). Бой с боссом — общая
 * тема `boss` во всех главах (узнаваемый сигнал «MVP», как в RO), вкус главы в нём держит фон главы (amb_*).
 */
export const soundTheme = (t: Theme): SoundTheme => t;

/**
 * Звук экрана при его старте (installAudio в BootScene): музыка и фон по сцене, теме главы и боссу;
 * заодно стингер начала боя (рог) или баннера босса. Экраны сами ничего не вызывают.
 */
export function sceneSoundOf(scene: Phaser.Scene): SceneSound {
  const key = scene.sys.settings.key;
  const data = (scene.sys.settings.data ?? {}) as { chapter?: number; stageId?: string; mode?: string; chapterId?: string };
  if (key === 'Campaign') {
    const ci = data.chapter ?? Math.max(0, CONTENT.chapters.findIndex((c) => c.id === currentStage(session.save, GAME)?.chapter));
    return sceneSound(key, { theme: soundTheme(themeOfChapter(CONTENT.chapters[ci]?.id)) });
  }
  if (key === 'ChapterDone') return sceneSound(key, { theme: soundTheme(themeOfChapter(data.chapterId)) });
  if (key === 'Stage' && data.stageId) return sceneSound(key, { theme: soundTheme(themeOfBattle({ stageId: data.stageId })) });
  if (key === 'Battle') {
    let boss = false;
    try {
      boss = data.mode === 'stage' && !!data.stageId && getStage(GAME, data.stageId).boss;
    } catch {
      boss = false;
    }
    sfx(boss ? 'boss_intro' : 'battle_start', { delay: 0.2 });
    if (data.mode === 'tower') return sceneSound(key, { theme: soundTheme(towerTheme()), tower: true });
    return sceneSound(key, { theme: soundTheme(themeOfBattle({ stageId: data.stageId })), boss });
  }
  return sceneSound(key);
}

/** Тема яруса Башни, на который идёт бой (фон боя в Башне — по ярусу). */
function towerTheme(): Theme {
  try {
    const next = towerStatus(session.save, GAME).next;
    return next !== null ? themeOfTowerFloor(next) : 'crypt';
  } catch {
    return 'crypt';
  }
}
