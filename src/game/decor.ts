import Phaser from 'phaser';
import { juiceOn } from './juice';
import { SKIN, SKIN_TINT, skinIcon, type SkinIcon } from './skin';
import { text } from './ui';
import { FS } from './theme';

/**
 * Украшения экранов в духе AFK Arena (текстуры — skin.ts buildDecor): лента заголовка, медальон иконки,
 * блик по главной кнопке, медленные лучи за наградой, плавающие искры. Всё движение — дешёвые твины
 * (без масок и перерисовки текстур) и выключается «Уменьшить анимацию»: тогда украшения стоят неподвижно.
 */

/** Лента-заголовок (тёмно-красное полотно с золотой кромкой): по ширине текста, не уже minW. */
export function ribbon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  opts: { size?: number; minW?: number; maxW?: number } = {},
): Phaser.GameObjects.Container {
  const size = opts.size ?? FS.h2;
  const t = text(scene, 0, -2, label, size, SKIN.goldLight, { fontStyle: 'bold', stroke: '#1a0806', strokeThickness: 6 });
  t.setShadow(0, 3, 'rgba(0,0,0,0.6)', 2, true, false);
  const maxW = opts.maxW ?? 900;
  if (t.width > maxW - 120) t.setScale((maxW - 120) / t.width);
  const w = Phaser.Math.Clamp(t.displayWidth + 140, opts.minW ?? 360, maxW);
  const h = Math.round(size * 2.1);
  const band = scene.add.nineslice(0, 0, 'skin_ribbon', undefined, w, h, 48, 48, 0, 0);
  return scene.add.container(x, y, [band, t]);
}

/** Медальон с контурной иконкой скина (плитки главной, строки списков). */
export function medallion(scene: Phaser.Scene, x: number, y: number, size: number, icon: SkinIcon, tint: number = SKIN_TINT.gold): Phaser.GameObjects.Container {
  const disc = scene.add.image(0, 0, 'skin_medallion').setDisplaySize(size, size);
  const ico = scene.add.image(0, 0, skinIcon(icon)).setDisplaySize(size * 0.5, size * 0.5).setTint(tint);
  return scene.add.container(x, y, [disc, ico]);
}

/**
 * Блик, пробегающий по главной кнопке раз в несколько секунд. Полоса обрезается по ширине кнопки (setCrop),
 * живёт в её контейнере (двигается и «проседает» вместе с ней). Без «Уменьшить анимацию».
 */
export function ctaShine(scene: Phaser.Scene, container: Phaser.GameObjects.Container, w: number, h: number, delay = 900): void {
  if (!juiceOn() || !scene.textures.exists('skin_shine')) return;
  const inner = w / 2 - 14;
  const sh = h - 22;
  const img = scene.add.image(0, -6, 'skin_shine').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.45);
  img.setDisplaySize((sh * 96) / 160, sh);
  const sw = img.displayWidth;
  const k = img.scaleX;
  const place = () => {
    const left = img.x - sw / 2;
    const from = Math.max(0, -inner - left);
    const to = Math.min(sw, inner - left);
    img.setVisible(to > from);
    if (to > from) img.setCrop(from / k, 0, (to - from) / k, img.height);
  };
  img.x = -inner - sw;
  place();
  container.add(img);
  scene.tweens.add({
    targets: img,
    x: inner + sw,
    delay,
    duration: 750,
    repeatDelay: 2800,
    repeat: -1,
    ease: 'Sine.easeInOut',
    onUpdate: place,
  });
}

/** Разлёт золотых искр от плашки (итог победы): ~14 искр, одна волна; без «Уменьшить анимацию» — ничего. */
export function sparkBurst(scene: Phaser.Scene, x: number, y: number, w: number, n = 14): void {
  if (!juiceOn() || !scene.sys.displayList || !scene.textures.exists('skin_spark')) return;
  for (let i = 0; i < n; i++) {
    const sx = x + (Math.random() - 0.5) * w * 0.8;
    const s = Phaser.Math.Between(26, 54);
    const img = scene.add.image(sx, y + (Math.random() - 0.5) * 80, 'skin_spark').setDisplaySize(s, s).setTint(0xffe2a0).setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
    scene.tweens.add({
      targets: img,
      x: sx + (sx - x) * 0.35,
      y: img.y + Phaser.Math.Between(-150, 110),
      angle: Phaser.Math.Between(-90, 90),
      alpha: 0,
      scale: img.scale * 0.4,
      delay: i * 25,
      duration: Phaser.Math.Between(700, 1100),
      ease: 'Cubic.easeOut',
      onComplete: () => img.destroy(),
    });
  }
}

/** Медленно вращающиеся золотые лучи за наградой/баннером (без анимации — неподвижные). */
export function slowRays(scene: Phaser.Scene, x: number, y: number, size: number, alpha = 0.45, tint = 0xffffff): Phaser.GameObjects.Image {
  const img = scene.add.image(x, y, 'skin_rays').setDisplaySize(size, size).setAlpha(alpha).setTint(tint).setBlendMode(Phaser.BlendModes.ADD);
  if (juiceOn()) scene.tweens.add({ targets: img, angle: 360, duration: 40000, repeat: -1 });
  return img;
}

/** Мягкое свечение (подсветка иконки, узла, награды); pulse — медленно «дышит». */
export function glow(scene: Phaser.Scene, x: number, y: number, size: number, tint: number, alpha = 0.5, pulse = false): Phaser.GameObjects.Image {
  const img = scene.add.image(x, y, 'skin_glow').setDisplaySize(size, size).setTint(tint).setAlpha(alpha).setBlendMode(Phaser.BlendModes.ADD);
  if (pulse && juiceOn()) scene.tweens.add({ targets: img, alpha: alpha * 0.45, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.easeInOut' });
  return img;
}

/**
 * Плавающие искры поверх фона экрана (светлячки/пылинки): n картинок, каждая медленно поднимается и гаснет.
 * Без «Уменьшить анимацию» — нет вовсе (в фоне и так нарисованы неподвижные светлячки).
 */
export function motes(scene: Phaser.Scene, area: { x: number; y: number; w: number; h: number }, n = 8, tint = 0xd8ffb0, depth = 0): void {
  if (!juiceOn() || !scene.textures.exists('skin_glow')) return;
  for (let i = 0; i < n; i++) {
    const s = Phaser.Math.Between(10, 22);
    const img = scene.add.image(0, 0, 'skin_glow').setDisplaySize(s, s).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(depth);
    const fly = () => {
      if (!img.scene) return;
      img.setPosition(area.x + Math.random() * area.w, area.y + area.h * (0.3 + Math.random() * 0.7));
      scene.tweens.add({
        targets: img,
        y: img.y - Phaser.Math.Between(120, 320),
        x: img.x + Phaser.Math.Between(-60, 60),
        alpha: { from: 0, to: 0.75 },
        yoyo: false,
        duration: Phaser.Math.Between(3500, 6500),
        ease: 'Sine.easeInOut',
        onComplete: () => scene.tweens.add({ targets: img, alpha: 0, duration: 700, onComplete: fly }),
      });
    };
    scene.time.delayedCall(i * 450, fly);
  }
}
