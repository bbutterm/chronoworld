import Phaser from 'phaser';
import { GAME_H, GAME_W } from './layout';
import { text } from './ui';

/** Слои глубины боя: юниты — по y (до ~1700), затемнение ульты, выделенный кастер, эффекты, цифры, баннер. */
export const DEPTH = {
  dim: 2900,
  spotlight: 3000,
  fx: 4000,
  numbers: 5000,
  banner: 6000,
} as const;

/** Где висит баннер ульты: между кнопками скорости и первым рядом героев — не поверх отрядов. */
const BANNER_Y = 540;
/** Ширина плашки: две (своя слева, чужая справа) помещаются в ряд. */
const BANNER_W = 510;

/**
 * Затемнение экрана и баннер с названием ульты (как в AFK Arena): экран на миг темнеет,
 * кастер остаётся ярким поверх затемнения, сверху — плашка «Герой · Название».
 * Один объект на сцену: новая ульта перезапускает затемнение; у каждой стороны своя плашка.
 */
export class UltPresenter {
  private readonly dim: Phaser.GameObjects.Rectangle;
  private readonly banners: Record<'A' | 'B', Phaser.GameObjects.Container | null> = { A: null, B: null };

  constructor(private readonly scene: Phaser.Scene) {
    this.dim = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 1).setAlpha(0).setDepth(DEPTH.dim);
  }

  /** Затемнить экран на holdMs (мс сцены, уже с учётом скорости боя через timeScale). */
  flashDim(holdMs = 650): void {
    this.scene.tweens.killTweensOf(this.dim);
    this.scene.tweens.chain({
      targets: this.dim,
      tweens: [
        { alpha: 0.5, duration: 120 },
        { alpha: 0.5, duration: holdMs },
        { alpha: 0, duration: 260 },
      ],
    });
  }

  /**
   * Плашка ульты. ally — своя сторона (золотая рамка, слева) или противник (красная, справа):
   * у каждой стороны своё место, так что одновременные ульты двух сторон видны обе.
   * Новая ульта той же стороны заменяет плашку.
   */
  showBanner(caster: string, skillName: string, ally: boolean, iconKey?: string): void {
    const side = ally ? 'A' : 'B';
    this.banners[side]?.destroy();
    const w = BANNER_W;
    const h = 104;
    const edge = ally ? 0xffd84a : 0xff6a5a;
    const bg = this.scene.add.rectangle(0, 0, w, h, 0x120c06, 0.9).setStrokeStyle(5, edge);
    const stripe = this.scene.add.rectangle(ally ? -w / 2 + 8 : w / 2 - 8, 0, 10, h - 10, edge);
    const parts: Phaser.GameObjects.GameObject[] = [bg, stripe];
    let tx = 0;
    if (iconKey && this.scene.textures.exists(iconKey)) {
      parts.push(this.scene.add.image(-w / 2 + 62, 0, iconKey).setDisplaySize(72, 72));
      tx = 45;
    }
    const maxW = w - (tx ? 150 : 50);
    const who = text(this.scene, tx, -26, caster, 26, ally ? '#e0cfb0' : '#f0b0a8');
    const what = text(this.scene, tx, 14, skillName, 42, ally ? '#ffd84a' : '#ff9a8a', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 });
    for (const t of [who, what]) if (t.width > maxW) t.setScale(maxW / t.width);
    parts.push(who, what);
    const x = ally ? BANNER_W / 2 + 20 : GAME_W - BANNER_W / 2 - 20;
    const c = this.scene.add.container(x + (ally ? -80 : 80), BANNER_Y, parts).setDepth(DEPTH.banner).setAlpha(0);
    this.banners[side] = c;
    this.scene.tweens.chain({
      targets: c,
      tweens: [
        { x, alpha: 1, duration: 160, ease: 'Quad.easeOut' },
        { alpha: 1, duration: 1100 },
        { alpha: 0, duration: 260 },
      ],
      onComplete: () => {
        c.destroy();
        if (this.banners[side] === c) this.banners[side] = null;
      },
    });
  }

  /** Самая заметная из видимых плашек (для проверок и скриншотов). */
  get banner(): Phaser.GameObjects.Container | null {
    const all = [this.banners.A, this.banners.B].filter((b): b is Phaser.GameObjects.Container => !!b);
    return all.sort((a, b) => b.alpha - a.alpha)[0] ?? null;
  }

  /** Золотое свечение под ногами кастера. */
  glow(x: number, y: number): void {
    const g = this.scene.add.ellipse(x, y, 190, 60, 0xffd84a, 0.55).setDepth(DEPTH.spotlight - 1);
    this.scene.tweens.add({ targets: g, scaleX: 1.35, scaleY: 1.35, alpha: 0, duration: 900, onComplete: () => g.destroy() });
  }
}
