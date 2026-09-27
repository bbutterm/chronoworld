import Phaser from 'phaser';
import { buildPlaceholders, queueAssets, setupLoadedAssets } from '../assets';
import { buildSkin } from '../skin';
import { CONTENT, GAME } from '../content';
import { heroSprite } from '../flow';
import { session } from '../session';
import { FONT, GAME_H, GAME_W } from '../layout';
import { queuePortraitFiles, requestPortrait, setupSprites } from '../sprites';

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

const BAR_W = 760;
const BAR_H = 44;
const BAR_Y = GAME_H / 2 + 120;

function style(size: number, color: string, bold = false): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONT,
    fontSize: `${size}px`,
    color,
    fontStyle: bold ? 'bold' : 'normal',
    stroke: '#000000',
    strokeThickness: bold ? 8 : 0,
    align: 'center',
  };
}

/**
 * Экран загрузки. Пока ничего не загружено, рисуем только примитивами (прямоугольники, текст):
 * название, полоса прогресса по событиям загрузчика и «Загрузка… N%». Файл не нашёлся — не ошибка:
 * считаем такие файлы, пишем «не загрузилось N — будут заглушки» и идём дальше.
 */
export class BootScene extends Phaser.Scene {
  private failed = 0;

  constructor() {
    super('Boot');
  }

  preload(): void {
    this.failed = 0;
    const cx = GAME_W / 2;
    this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, 0x11131a);
    this.add.text(cx, GAME_H / 2 - 200, 'Chronoworld', style(100, '#ffe9a8', true)).setOrigin(0.5);
    this.add.rectangle(cx, GAME_H / 2 - 110, 460, 5, 0xc8a060);

    this.add.rectangle(cx, BAR_Y, BAR_W + 14, BAR_H + 14, 0x000000).setStrokeStyle(4, 0xc8a060);
    const fill = this.add.rectangle(cx - BAR_W / 2, BAR_Y, 0, BAR_H, 0xe0a82a).setOrigin(0, 0.5);
    const shine = this.add.rectangle(cx - BAR_W / 2, BAR_Y - BAR_H / 4, 0, BAR_H / 4, 0xfff0b0, 0.7).setOrigin(0, 0.5);
    const label = this.add.text(cx, BAR_Y + 80, 'Загрузка… 0%', style(42, '#ffffff')).setOrigin(0.5);
    const hint = this.add.text(cx, BAR_Y + 145, '', style(28, '#8a8e98')).setOrigin(0.5);

    this.load.on('progress', (p: number) => {
      fill.width = BAR_W * p;
      shine.width = BAR_W * p;
      label.setText(`Загрузка… ${Math.round(p * 100)}%`);
    });
    this.load.on('filecomplete', (key: string) => {
      if (!this.failed) hint.setText(key);
    });
    // Файл не найден — не страшно, будет плейсхолдер.
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      this.failed++;
      console.warn(`Ассет ${file.key} не загрузился, рисую плейсхолдер`);
      hint.setText(`Не загрузилось файлов: ${this.failed} — будут заглушки`).setColor('#ffb4a0');
    });

    queueAssets(this);
    // U: листы юнитов (до 12 МБ каждый в памяти GPU) не грузим — только маленькие файлы портретов.
    queuePortraitFiles(this, Object.keys(spriteRoles()));
  }

  create(): void {
    setupLoadedAssets(this);
    buildSkin(this);
    buildPlaceholders(this);
    setupSprites(this, spriteRoles());
    // Небольшой набор портретов сразу: герои игрока (список героев, отряд). Листы для них грузятся по одному
    // и сразу выгружаются — в памяти остаются только портреты. Остальные портреты — по требованию экранов.
    const own = [...new Set(session.save.heroes.map((h) => heroSprite(h, GAME)))];
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      this.scene.start('Home');
    };
    void Promise.all(own.map((id) => requestPortrait(this.game, id))).then(go);
    // Сеть подвисла — не держим игрока на экране загрузки: портреты догрузятся на экранах.
    setTimeout(go, 4000);
  }
}
