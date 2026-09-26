import Phaser from 'phaser';
import { buildPlaceholders, queueAssets, setupLoadedAssets } from '../assets';
import { CONTENT } from '../content';
import { queueSprites, setupSprites } from '../sprites';

/**
 * Все спрайты игры (профессии героев игрока и юниты: герои теста, монстры, боссы) → роль.
 * Роль задаёт цвет и предмет силуэта-плейсхолдера (у Послушника и Торговца пока нет спрайтов).
 */
function spriteRoles(): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const j of Object.values(CONTENT.jobs)) roles[j.visual.sprite] ??= j.role;
  for (const u of Object.values(CONTENT.units)) roles[u.visual.sprite] ??= u.role;
  return roles;
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // Файл не найден — не страшно, будет плейсхолдер.
    this.load.on('loaderror', (file: Phaser.Loader.File) => console.warn(`Ассет ${file.key} не загрузился, рисую плейсхолдер`));
    queueAssets(this);
    queueSprites(this, Object.keys(spriteRoles()));
  }

  create(): void {
    setupLoadedAssets(this);
    buildPlaceholders(this);
    const roles = spriteRoles();
    setupSprites(this, Object.keys(roles), roles);
    this.scene.start('Home');
  }
}
