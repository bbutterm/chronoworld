import Phaser from 'phaser';
import { buildPlaceholders, queueAssets, setupLoadedAssets } from '../assets';
import { CONTENT } from '../content';
import { queueSprites, setupSprites } from '../sprites';

const units = () => Object.values(CONTENT.units);

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // Файл не найден — не страшно, будет плейсхолдер.
    this.load.on('loaderror', (file: Phaser.Loader.File) => console.warn(`Ассет ${file.key} не загрузился, рисую плейсхолдер`));
    queueAssets(this);
    queueSprites(this, units().map((u) => u.visual.sprite));
  }

  create(): void {
    setupLoadedAssets(this);
    buildPlaceholders(this);
    setupSprites(
      this,
      units().map((u) => u.visual.sprite),
      Object.fromEntries(units().map((u) => [u.visual.sprite, u.name])),
    );
    this.scene.start('Prep');
  }
}
