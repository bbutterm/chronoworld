import Phaser from 'phaser';
import { FONT, GAME_H, GAME_W } from './layout';
import { clamp01, ease, Pool, TextStyleCache } from './perf';
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
  /** Видимые сейчас плашки. */
  private readonly banners: Record<'A' | 'B', Phaser.GameObjects.Container | null> = { A: null, B: null };
  /** Построенные плашки сторон (живут до конца боя) и их текущие цепочки твинов. */
  private readonly parts: Record<'A' | 'B', BannerParts | null> = { A: null, B: null };
  private readonly chains: Record<'A' | 'B', Phaser.Tweens.TweenChain | null> = { A: null, B: null };
  private readonly glows: Pool<Phaser.GameObjects.Ellipse>;

  constructor(private readonly scene: Phaser.Scene) {
    this.glows = new Pool(() => scene.add.ellipse(0, 0, 190, 60, 0xffd84a, 0.55).setDepth(DEPTH.spotlight - 1));
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
   * Новая ульта той же стороны заменяет плашку. Плашка каждой стороны строится один раз и переиспользуется
   * (ульт за бой десятки — раньше это были десятки контейнеров и Text на каждую).
   */
  showBanner(caster: string, skillName: string, ally: boolean, iconKey?: string): void {
    const side = ally ? 'A' : 'B';
    const b = (this.parts[side] ??= this.buildBanner(ally));
    this.chains[side]?.stop();
    const w = BANNER_W;
    let tx = 0;
    if (iconKey && this.scene.textures.exists(iconKey)) {
      b.icon.setTexture(iconKey).setScale(1).setDisplaySize(72, 72).setVisible(true);
      tx = 45;
    } else b.icon.setVisible(false);
    const maxW = w - (tx ? 150 : 50);
    b.who.setText(caster);
    b.what.setText(skillName);
    for (const t of [b.who, b.what]) {
      t.setX(tx).setScale(1);
      if (t.width > maxW) t.setScale(maxW / t.width);
    }
    const x = ally ? BANNER_W / 2 + 20 : GAME_W - BANNER_W / 2 - 20;
    const c = b.node.setPosition(x + (ally ? -80 : 80), BANNER_Y).setAlpha(0).setVisible(true);
    // Как и прежде, свежая плашка — поверх остальных объектов того же слоя.
    this.scene.children.bringToTop(c);
    this.banners[side] = c;
    this.chains[side] = this.scene.tweens.chain({
      targets: c,
      tweens: [
        { x, alpha: 1, duration: 160, ease: 'Quad.easeOut' },
        { alpha: 1, duration: 1100 },
        { alpha: 0, duration: 260 },
      ],
      onComplete: () => {
        c.setVisible(false);
        this.chains[side] = null;
        if (this.banners[side] === c) this.banners[side] = null;
      },
    });
  }

  private buildBanner(ally: boolean): BannerParts {
    const w = BANNER_W;
    const h = 104;
    const edge = ally ? 0xffd84a : 0xff6a5a;
    const bg = this.scene.add.rectangle(0, 0, w, h, 0x120c06, 0.9).setStrokeStyle(5, edge);
    const stripe = this.scene.add.rectangle(ally ? -w / 2 + 8 : w / 2 - 8, 0, 10, h - 10, edge);
    const icon = this.scene.add.image(-w / 2 + 62, 0, '__DEFAULT').setVisible(false);
    const who = text(this.scene, 0, -26, '', 26, ally ? '#e0cfb0' : '#f0b0a8');
    const what = text(this.scene, 0, 14, '', 42, ally ? '#ffd84a' : '#ff9a8a', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 });
    const node = this.scene.add.container(0, BANNER_Y, [bg, stripe, icon, who, what]).setDepth(DEPTH.banner).setAlpha(0).setVisible(false);
    return { node, icon, who, what };
  }

  /** Сцена выключается: плашки и свечения уничтожит она сама, забываем ссылки. */
  clear(): void {
    this.banners.A = null;
    this.banners.B = null;
    this.parts.A = null;
    this.parts.B = null;
    this.chains.A = null;
    this.chains.B = null;
    this.glows.clear();
  }

  /** Самая заметная из видимых плашек (для проверок и скриншотов). */
  get banner(): Phaser.GameObjects.Container | null {
    const all = [this.banners.A, this.banners.B].filter((b): b is Phaser.GameObjects.Container => !!b);
    return all.sort((a, b) => b.alpha - a.alpha)[0] ?? null;
  }

  /** Золотое свечение под ногами кастера (эллипсы из пула). */
  glow(x: number, y: number): void {
    const g = this.glows.acquire().setPosition(x, y).setScale(1).setAlpha(1);
    this.scene.children.bringToTop(g);
    this.scene.tweens.add({ targets: g, scaleX: 1.35, scaleY: 1.35, alpha: 0, duration: 900, onComplete: () => this.glows.release(g) });
  }
}

interface BannerParts {
  node: Phaser.GameObjects.Container;
  icon: Phaser.GameObjects.Image;
  who: Phaser.GameObjects.Text;
  what: Phaser.GameObjects.Text;
}

/** Сколько всплывающих надписей (цифры, подписи статусов) может быть на экране одновременно — старые уходят первыми. */
export const MAX_FLOATS = 24;

const Kind = { Number: 0, Headline: 1, Fx: 2, Projectile: 3 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

/** Одна живая анимация слоя. Записи тоже переиспользуются — в бою ничего не создаётся заново. */
interface Transient {
  kind: Kind;
  obj: Phaser.GameObjects.Text | Phaser.GameObjects.Image;
  /** Прошло времени, мс боя (с учётом скорости). */
  t: number;
  dur: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Цифра: когда начать гаснуть. Вспышка: начальная прозрачность. */
  a: number;
  /** Вспышка: начальный масштаб. Цифра: 1 — удар ульты (с «хлопком»). */
  s: number;
}

/** Кривые твинов, которые раньше делали то же самое (время — мс на 1x). */
const NUM_RISE_MS = 800;
const NUM_FADE_MS = 350;
const NUM_POP_MS = 220;
const HEADLINE_MS = 1000;
const HEADLINE_RISE = 50;

/**
 * Короткоживущие объекты боя — цифры урона, подписи статусов, вспышки попаданий и снаряды — из пулов,
 * а их движение считается в update сцены, без отдельного твина и Text/Image на каждое событие.
 * Вид тот же, что у прежних твинов: те же длительности, кривые и слои.
 */
export class FloatLayer {
  private readonly styles = new TextStyleCache(FONT);
  private readonly live: Transient[] = [];
  private readonly spare: Transient[] = [];
  private readonly texts: Pool<Phaser.GameObjects.Text>;
  private readonly images: Pool<Phaser.GameObjects.Image>;

  constructor(private readonly scene: Phaser.Scene) {
    this.texts = new Pool(
      () => scene.add.text(0, 0, '', { fontFamily: FONT, align: 'center' }).setOrigin(0.5),
      MAX_FLOATS,
      (obj) => this.drop(obj),
    );
    this.images = new Pool(() => scene.add.image(0, 0, '__DEFAULT'));
  }

  /** Сколько объектов создали пулы (для замеров): после разогрева не растёт. */
  get created(): number {
    return this.texts.created + this.images.created;
  }

  get activeTexts(): number {
    return this.texts.active.length;
  }

  /**
   * Всплывающая цифра: поднимается на rise за 800 мс, гаснет с fadeDelay за 350 мс;
   * big — «хлопок» масштабом 1.6 → 1. Возвращает объект (x уже можно поправить).
   */
  number(x: number, y: number, value: string, size: number, color: string, stroke: string, thick: number, depth: number, rise: number, fadeDelay: number, big: boolean): Phaser.GameObjects.Text {
    const t = this.text(x, y, value, size, color, stroke, thick, depth);
    const r = this.start(Kind.Number, t, Math.max(NUM_RISE_MS, fadeDelay + NUM_FADE_MS));
    r.x0 = x;
    r.y0 = y;
    r.y1 = y - rise;
    r.a = fadeDelay;
    r.s = big ? 1 : 0;
    if (big) t.setScale(1.6);
    return t;
  }

  /** Подпись над именем (пассивка, статус): уходит вверх на 50 и гаснет за 1 с (Quad.easeOut). */
  headline(x: number, y: number, value: string, size: number, color: string, depth: number): void {
    const t = this.text(x, y, value, size, color, '#000000', 5, depth);
    const r = this.start(Kind.Headline, t, HEADLINE_MS);
    r.y0 = y;
  }

  /** Вспышка: картинка size×size гаснет от alpha до 0 и растёт в 1.2 раза за duration. */
  flash(x: number, y: number, texId: string, size: number, alpha: number, duration: number, depth: number): void {
    const img = this.image(x, y, texId, size, depth).setAlpha(alpha);
    const r = this.start(Kind.Fx, img, duration);
    r.a = alpha;
    r.s = img.scale;
  }

  /** Снаряд size×size летит по прямой за duration. */
  projectile(x0: number, y0: number, x1: number, y1: number, texId: string, size: number, duration: number, depth: number): void {
    const img = this.image(x0, y0, texId, size, depth);
    const r = this.start(Kind.Projectile, img, duration);
    r.x0 = x0;
    r.y0 = y0;
    r.x1 = x1;
    r.y1 = y1;
  }

  /** Продвинуть все анимации на dt мс боя (уже умноженные на скорость). */
  step(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const r = this.live[i];
      r.t += dt;
      const o = r.obj;
      switch (r.kind) {
        case Kind.Number: {
          o.y = r.y0 + (r.y1 - r.y0) * ease.quadOut(clamp01(r.t / NUM_RISE_MS));
          o.alpha = r.t <= r.a ? 1 : 1 - clamp01((r.t - r.a) / NUM_FADE_MS);
          if (r.s) o.setScale(1.6 - 0.6 * ease.backOut(clamp01(r.t / NUM_POP_MS)));
          break;
        }
        case Kind.Headline: {
          const p = ease.quadOut(clamp01(r.t / r.dur));
          o.y = r.y0 - HEADLINE_RISE * p;
          o.alpha = 1 - p;
          break;
        }
        case Kind.Fx: {
          const p = clamp01(r.t / r.dur);
          o.alpha = r.a * (1 - p);
          o.setScale(r.s * (1 + 0.2 * p));
          break;
        }
        case Kind.Projectile: {
          const p = clamp01(r.t / r.dur);
          o.x = r.x0 + (r.x1 - r.x0) * p;
          o.y = r.y0 + (r.y1 - r.y0) * p;
          break;
        }
      }
      if (r.t >= r.dur) this.finish(i);
    }
  }

  /** Сцена выключается — объекты уничтожит она сама, забываем ссылки. */
  clear(): void {
    this.live.length = 0;
    this.spare.length = 0;
    this.texts.clear();
    this.images.clear();
  }

  private text(x: number, y: number, value: string, size: number, color: string, stroke: string, thick: number, depth: number): Phaser.GameObjects.Text {
    const style = this.styles.get(size, color, stroke, thick, true);
    const t = this.texts.acquire();
    // Стиль без перерисовки (и без замера шрифта, если он уже в кэше), затем один updateText.
    t.style.setStyle(style, false);
    if (t.text !== value) t.setText(value);
    else t.updateText();
    if (!style.metrics) this.styles.remember(style, t.style.getTextMetrics());
    t.setPosition(x, y).setScale(1).setAlpha(1).setDepth(depth);
    this.scene.children.bringToTop(t);
    return t;
  }

  private image(x: number, y: number, texId: string, size: number, depth: number): Phaser.GameObjects.Image {
    const img = this.images.acquire();
    img.setTexture(texId).setPosition(x, y).setScale(1).setDisplaySize(size, size).setAlpha(1).setDepth(depth);
    this.scene.children.bringToTop(img);
    return img;
  }

  private start(kind: Kind, obj: Transient['obj'], dur: number): Transient {
    const r = this.spare.pop() ?? { kind, obj, t: 0, dur, x0: 0, y0: 0, x1: 0, y1: 0, a: 0, s: 0 };
    r.kind = kind;
    r.obj = obj;
    r.t = 0;
    r.dur = dur;
    r.a = 0;
    r.s = 0;
    this.live.push(r);
    return r;
  }

  private finish(i: number): void {
    const r = this.live[i];
    const last = this.live.pop()!;
    if (last !== r) this.live[i] = last;
    this.spare.push(r);
    if (r.kind === Kind.Number || r.kind === Kind.Headline) this.texts.release(r.obj as Phaser.GameObjects.Text);
    else this.images.release(r.obj as Phaser.GameObjects.Image);
  }

  /** Пул вытесняет старую надпись — снять её с анимации (объект вернёт сам пул). */
  private drop(obj: Phaser.GameObjects.Text): void {
    const i = this.live.findIndex((r) => r.obj === obj);
    if (i < 0) return;
    const r = this.live[i];
    const last = this.live.pop()!;
    if (last !== r) this.live[i] = last;
    this.spare.push(r);
  }
}
