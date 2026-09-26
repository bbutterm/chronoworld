import Phaser from 'phaser';
import { buildPlaceholders, queueAssets, setupLoadedAssets } from '../assets';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // Файл из манифеста не найден — не страшно, будет плейсхолдер.
    this.load.on('loaderror', (file: Phaser.Loader.File) => console.warn(`Ассет ${file.key} не загрузился, рисую плейсхолдер`));
    queueAssets(this);
  }

  create(): void {
    setupLoadedAssets(this);
    buildPlaceholders(this);
    this.scene.start('Prep');
  }
}
