import Phaser from 'phaser';
import { buildPlaceholders, queueAssets, setupLoadedAssets } from '../assets';
import { CONTENT } from '../content';
import { queueSprites, setupSprites } from '../sprites';

/** Все спрайты игры: профессии героев игрока и юниты (герои теста, монстры, боссы). id спрайта → подпись плейсхолдера. */
function spriteLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const j of Object.values(CONTENT.jobs)) labels[j.visual.sprite] ??= j.name;
  for (const u of Object.values(CONTENT.units)) labels[u.visual.sprite] ??= u.name;
  return labels;
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // Файл не найден — не страшно, будет плейсхолдер.
    this.load.on('loaderror', (file: Phaser.Loader.File) => console.warn(`Ассет ${file.key} не загрузился, рисую плейсхолдер`));
    queueAssets(this);
    queueSprites(this, Object.keys(spriteLabels()));
  }

  create(): void {
    setupLoadedAssets(this);
    buildPlaceholders(this);
    const labels = spriteLabels();
    setupSprites(this, Object.keys(labels), labels);
    this.scene.start('Home');
  }
}
