import Phaser from 'phaser';
import { animatedFrameAt, animatedFxDuration, animatedFxKey, selectedAnimatedEffect, type AnimatedEffect } from './animatedFx';
import { FONT, GAME_H, GAME_W } from './layout';
import { coversNumber, coversRoDigits, numberFont, numberFrameWidth, numberOrigin, RO_DIGIT_H, roDamageFont } from './numberFont';
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
    // Надписи кэшируются по имени героя и названию навыка (в бою их ≤ 10 на сторону): повторная ульта
    // только показывает готовый Text, без перерисовки canvas и загрузки текстуры.
    b.who?.setVisible(false);
    b.what?.setVisible(false);
    b.who = this.label(b, b.whos, caster, false);
    b.what = this.label(b, b.whats, skillName, true);
    for (const t of [b.who, b.what]) {
      t.setX(tx).setScale(1).setVisible(true);
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
    const node = this.scene.add.container(0, BANNER_Y, [bg, stripe, icon]).setDepth(DEPTH.banner).setAlpha(0).setVisible(false);
    return { node, icon, ally, who: null, what: null, whos: new Map(), whats: new Map() };
  }

  /** Надпись плашки из кэша стороны (строится при первой ульте с этим именем/навыком). */
  private label(b: BannerParts, cache: Map<string, Phaser.GameObjects.Text>, value: string, skill: boolean): Phaser.GameObjects.Text {
    let t = cache.get(value);
    if (t) return t;
    if (skill) {
      t = text(this.scene, 0, 14, value, 42, b.ally ? '#ffd84a' : '#ff9a8a', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 });
      b.node.add(t);
    } else {
      t = text(this.scene, 0, -26, value, 26, b.ally ? '#e0cfb0' : '#f0b0a8');
      // Имена — под названиями навыков (как раньше: имя, затем навык поверх).
      b.node.addAt(t, 3);
    }
    cache.set(value, t);
    return t;
  }

  /** «Пропустить» (T2-12): сразу убрать затемнение, плашки и свечения — поверх итога боя ничего не доигрывается. */
  cancel(): void {
    this.scene.tweens.killTweensOf(this.dim);
    this.dim.setAlpha(0);
    for (const side of ['A', 'B'] as const) {
      this.chains[side]?.stop();
      this.chains[side] = null;
      this.banners[side]?.setVisible(false);
      this.banners[side] = null;
    }
    for (const g of [...this.glows.active]) {
      this.scene.tweens.killTweensOf(g);
      this.glows.release(g);
    }
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
  ally: boolean;
  /** Надписи, показанные сейчас. */
  who: Phaser.GameObjects.Text | null;
  what: Phaser.GameObjects.Text | null;
  /** Готовые надписи по имени героя / названию навыка. */
  whos: Map<string, Phaser.GameObjects.Text>;
  whats: Map<string, Phaser.GameObjects.Text>;
}

/** Сколько всплывающих надписей (цифры, подписи статусов) может быть на экране одновременно — старые уходят первыми. */
export const MAX_FLOATS = 24;

const Kind = { Number: 0, Headline: 1, Fx: 2, Projectile: 3 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

/** Одна живая анимация слоя. Записи тоже переиспользуются — в бою ничего не создаётся заново. */
interface Transient {
  kind: Kind;
  obj: Phaser.GameObjects.Text | Phaser.GameObjects.BitmapText | Phaser.GameObjects.Image;
  /** Порядок появления (при переполнении MAX_FLOATS уходит самая старая надпись). */
  seq: number;
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
  /** Captured RO sequence, if the atlas was available at load time. */
  effect?: AnimatedEffect;
  /** Чья надпись (uid юнита): у одного юнита на экране не больше нескольких надписей своего вида. */
  key?: string;
  /** Цифра RO: 0 — прежняя цифра шрифтом, RO_HIT — урон (дуга в сторону), RO_RISE — лечение/щит (прямо вверх). */
  mode: number;
}

/** Кривые твинов, которые раньше делали то же самое (время — мс на 1x). */
const NUM_RISE_MS = 800;
const NUM_FADE_MS = 350;
const NUM_POP_MS = 220;
const HEADLINE_MS = 1000;
const HEADLINE_RISE = 50;
/** Подпись держится непрозрачной до этой доли жизни, дальше гаснет. */
const HEADLINE_HOLD = 0.45;
/** Подписей над одним юнитом одновременно (T3-02): новая сдвигает прежнюю вверх, прежняя сразу гаснет. */
export const HEADLINES_PER_UNIT = 2;
/** На сколько сдвигается вверх прежняя подпись юнита, когда приходит новая. */
const HEADLINE_STACK = 32;
/** Цифр над одним юнитом одновременно: лишняя самая старая уходит. */
export const NUMBERS_PER_UNIT = 4;
/** Отступ надписи от края экрана. */
const EDGE = 8;

/**
 * Цифры RO (roBrowser Renderer/Effects/Damage.js): урон вылетает над целью, по дуге подпрыгивает вверх и в сторону,
 * опускается ниже старта, уменьшаясь и угасая; лечение поднимается прямо вверх, не меняя размера.
 */
export const RO_HIT = 1;
export const RO_RISE = 2;
const RO_HIT_MS = 1100;
const RO_RISE_MS = 1300;
/** Высота дуги урона и снос в сторону (единицы игры, экран 1080×1920). */
const RO_ARC = 64;
const RO_DRIFT = 96;
/** Подъём цифры лечения. */
const RO_RISE_H = 110;
/** К концу дуги цифра урона уменьшается до этой доли (в RO — до нуля; так её ещё можно прочесть). */
const RO_END_SCALE = 0.5;
/** Доля жизни цифры RO, после которой она гаснет. */
const RO_FADE_AT = 0.55;

/**
 * Короткоживущие объекты боя — цифры урона, подписи статусов, вспышки попаданий и снаряды — из пулов,
 * а их движение считается в update сцены, без отдельного твина и Text/Image на каждое событие.
 * Вид тот же, что у прежних твинов: те же длительности, кривые и слои.
 */
export class FloatLayer {
  private readonly styles = new TextStyleCache(FONT);
  private readonly live: Transient[] = [];
  private readonly spare: Transient[] = [];
  /** Подписи (и цифры с символами вне растрового шрифта) — Text. */
  private readonly texts: Pool<Phaser.GameObjects.Text>;
  /** Цифры урона/лечения/щита — BitmapText на растровых шрифтах (numberFont.ts): setText без перерисовки canvas. */
  private readonly digits: Pool<Phaser.GameObjects.BitmapText>;
  private readonly images: Pool<Phaser.GameObjects.Image>;
  /** Служебный Text, которым рисуются глифы растровых шрифтов (невидимый, один на сцену). */
  private probe: Phaser.GameObjects.Text | null = null;
  private seq = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.texts = new Pool(() => scene.add.text(0, 0, '', { fontFamily: FONT, align: 'center' }).setOrigin(0.5));
    this.digits = new Pool(() => scene.add.bitmapText(0, 0, this.fontFor(this.styles.get(40, '#ffffff', '#000000', 6, true)).key));
    this.images = new Pool(() => scene.add.image(0, 0, '__DEFAULT'));
  }

  /** Сколько объектов создали пулы (для замеров): после разогрева не растёт. */
  get created(): number {
    return this.texts.created + this.digits.created + this.images.created;
  }

  /** Сколько надписей (цифр и подписей) сейчас на экране. */
  get activeTexts(): number {
    return this.texts.active.length + this.digits.active.length;
  }

  /**
   * Всплывающая цифра: поднимается на rise за 800 мс, гаснет с fadeDelay за 350 мс;
   * big — «хлопок» масштабом 1.6 → 1. Центр по x удерживается в пределах экрана (по ширине рамки, как у Text).
   */
  number(x: number, y: number, value: string, size: number, color: string, stroke: string, thick: number, depth: number, rise: number, fadeDelay: number, big: boolean, key?: string): Phaser.GameObjects.Text | Phaser.GameObjects.BitmapText {
    if (key) this.limit(Kind.Number, key, NUMBERS_PER_UNIT - 1);
    let t: Phaser.GameObjects.Text | Phaser.GameObjects.BitmapText;
    if (coversNumber(value)) t = this.digit(x, y, value, size, color, stroke, thick, depth);
    else {
      t = this.text(x, y, value, size, color, stroke, thick, depth);
      t.x = clampX(x, t.width);
    }
    const r = this.start(Kind.Number, t, Math.max(NUM_RISE_MS, fadeDelay + NUM_FADE_MS));
    r.key = key;
    r.x0 = t.x;
    r.y0 = y;
    r.y1 = y - rise;
    r.a = fadeDelay;
    r.s = big ? 1 : 0;
    if (big) t.setScale(1.6);
    return t;
  }

  /**
   * Цифра урона RO (только 0–9, атлас numbers): tint — цвет (белый — по монстру, красный — по герою, зелёный — лечение,
   * жёлтый — ульта), scale — начальный размер (1 = 42 единицы), mode — RO_HIT (дуга в сторону dir) или RO_RISE (вверх).
   * false — атлас не загрузился или в строке не только цифры: вызывающий рисует прежней цифрой (number).
   */
  roNumber(x: number, y: number, value: string, tint: number, scale: number, depth: number, mode: number, dir: number, key?: string): boolean {
    const font = coversRoDigits(value) ? roDamageFont(this.scene) : null;
    if (!font) return false;
    if (key) this.limit(Kind.Number, key, NUMBERS_PER_UNIT - 1);
    this.room();
    const t = this.digits.acquire();
    if (t.font !== font) t.setFont(font, RO_DIGIT_H);
    t.setScale(scale).setText(value).setOrigin(0.5, 0.5).setTint(tint).setAlpha(1).setDepth(depth);
    const w = t.getTextBounds(true).local.width * scale;
    const x0 = clampX(x, w);
    // Снос в сторону — туда, где хватает места до края экрана.
    let drift = mode === RO_HIT ? dir * RO_DRIFT : 0;
    if (clampX(x0 + drift, w) !== x0 + drift) drift = -drift;
    t.setPosition(x0, y);
    this.scene.children.bringToTop(t);
    const r = this.start(Kind.Number, t, mode === RO_HIT ? RO_HIT_MS : RO_RISE_MS);
    r.key = key;
    r.mode = mode;
    r.x0 = x0;
    r.y0 = y;
    r.x1 = drift;
    r.s = scale;
    return true;
  }

  /** Цифра растровым шрифтом стиля: рамка, центр и шаг символов — как у Text той же строки. */
  private digit(x: number, y: number, value: string, size: number, color: string, stroke: string, thick: number, depth: number): Phaser.GameObjects.BitmapText {
    const font = this.fontFor(this.styles.get(size, color, stroke, thick, true));
    this.room();
    const t = this.digits.acquire();
    if (t.font !== font.key) t.setFont(font.key, font.size);
    t.setScale(1).clearTint().setText(value);
    const w = t.getTextBounds(false).local.width;
    t.setOrigin(numberOrigin(font, w), 0.5);
    t.setPosition(clampX(x, numberFrameWidth(font, w)), y).setAlpha(1).setDepth(depth);
    this.scene.children.bringToTop(t);
    return t;
  }

  private fontFor(style: ReturnType<TextStyleCache['get']>) {
    this.probe ??= this.scene.add.text(0, 0, '', { fontFamily: FONT, align: 'center' }).setOrigin(0.5).setVisible(false).setActive(false);
    return numberFont(this.scene, style, this.probe);
  }

  /**
   * Подпись над именем (пассивка, статус, навык): уходит вверх на 50 за 1 с, гаснет со второй половины.
   * key — чья подпись: прежние подписи того же юнита сдвигаются вверх и сразу гаснут, лишние снимаются (T3-02).
   * Подпись не выходит за края экрана.
   */
  headline(x: number, y: number, value: string, size: number, color: string, depth: number, key?: string): Phaser.GameObjects.Text {
    if (key) {
      // Та же надпись у того же юнита только что была (пассивка «Уклонение» и её статус «Уклонение») — не дублируем.
      const same = this.live.find((r) => r.kind === Kind.Headline && r.key === key && (r.obj as Phaser.GameObjects.Text).text === value && r.t < r.dur * HEADLINE_HOLD);
      if (same) return same.obj as Phaser.GameObjects.Text;
      this.limit(Kind.Headline, key, HEADLINES_PER_UNIT - 1);
      for (const r of this.live) {
        if (r.kind !== Kind.Headline || r.key !== key) continue;
        r.y0 -= HEADLINE_STACK;
        r.t = Math.max(r.t, r.dur * HEADLINE_HOLD);
      }
    }
    const t = this.text(x, y, value, size, color, '#000000', 5, depth);
    t.x = clampX(x, t.width);
    const r = this.start(Kind.Headline, t, HEADLINE_MS);
    r.y0 = y;
    r.key = key;
    return t;
  }

  /** Оставить у юнита key не больше keep надписей вида kind (самые старые снимаются). */
  private limit(kind: Kind, key: string, keep: number): void {
    const mine = this.live.filter((r) => r.kind === kind && r.key === key).sort((a, b) => b.t - a.t);
    for (let n = mine.length; n > keep; n--) this.finish(this.live.indexOf(mine[mine.length - n]));
  }

  /** Не больше MAX_FLOATS надписей на экране: при переполнении уходит самая старая (цифра или подпись). */
  private room(): void {
    if (this.texts.active.length + this.digits.active.length < MAX_FLOATS) return;
    let oldest = -1;
    for (let i = 0; i < this.live.length; i++) {
      const r = this.live[i];
      if ((r.kind === Kind.Number || r.kind === Kind.Headline) && (oldest < 0 || r.seq < this.live[oldest].seq)) oldest = i;
    }
    if (oldest >= 0) this.finish(oldest);
  }

  /** «Пропустить» (T2-12): убрать все цифры, подписи, вспышки и снаряды сразу. */
  cancel(): void {
    while (this.live.length) this.finish(this.live.length - 1);
  }

  /** Stop a caster cue on cast completion/interrupt, without removing other combat FX. */
  cancelFx(key: string): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      if (this.live[i].kind === Kind.Fx && this.live[i].key === key) this.finish(i);
    }
  }

  /** Atlas-only role: absent atlas leaves the procedural fallback in charge (never a missing static texture). */
  catalogFlash(x: number, feetY: number, id: string | undefined, size: number, key?: string): boolean {
    if (!id || !selectedAnimatedEffect(id, 'flash', this.scene.textures.exists(animatedFxKey(id)))) return false;
    this.flash(x, feetY, id, size, 1, 250, DEPTH.fx, feetY, key);
    return true;
  }

  /** Вспышка: картинка size×size гаснет от alpha до 0 и растёт в 1.2 раза за duration. */
  flash(x: number, y: number, texId: string, size: number, alpha: number, duration: number, depth: number, feetY = y, key?: string): void {
    const effect = selectedAnimatedEffect(texId, 'flash', this.scene.textures.exists(animatedFxKey(texId)));
    const img = this.image(x, effect ? feetY : y, effect ? animatedFxKey(texId) : texId, size, depth).setAlpha(alpha);
    if (effect) {
      img.setFrame(0).setOrigin(effect.anchor[0] / effect.cell[0], effect.anchor[1] / effect.cell[1]);
      // Атлас навыка со своим масштабом (effects.json → scale): размер кадра RO, непрозрачный — роль не сжимает
      // крупный лист до точки и не делает его полупрозрачным.
      if (effect.scale) img.setScale(effect.scale).setAlpha(effect.alpha ?? 1);
      else img.setDisplaySize(size, size * effect.cell[1] / effect.cell[0]);
      img.setBlendMode(effect.blend === 'add' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL).setVisible(effect.delayMs === 0);
    }
    const r = this.start(Kind.Fx, img, effect ? animatedFxDuration(effect) : duration);
    r.effect = effect;
    r.key = key;
    r.a = alpha;
    r.s = img.scale;
  }

  /** Снаряд size×size летит по прямой за duration. */
  projectile(x0: number, y0: number, x1: number, y1: number, texId: string, size: number, duration: number, depth: number): void {
    const effect = selectedAnimatedEffect(texId, 'projectile', this.scene.textures.exists(animatedFxKey(texId)));
    const img = this.image(x0, y0, effect ? animatedFxKey(texId) : texId, size, depth);
    if (effect) img.setFrame(0).setDisplaySize(size, size * effect.cell[1] / effect.cell[0]).setFlipX(x1 < x0);
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
          if (r.mode) {
            const p = clamp01(r.t / r.dur);
            o.alpha = p <= RO_FADE_AT ? 1 : 1 - (p - RO_FADE_AT) / (1 - RO_FADE_AT);
            if (r.mode === RO_HIT) {
              // Дуга RO: вверх до пика на трети пути, затем вниз ниже старта; снос в сторону и уменьшение — равномерно.
              o.x = r.x0 + r.x1 * p;
              o.y = r.y0 - RO_ARC * Math.sin(1.5 * Math.PI * p);
              o.setScale(r.s * (1 - (1 - RO_END_SCALE) * p));
            } else o.y = r.y0 - RO_RISE_H * ease.quadOut(p);
            break;
          }
          o.y = r.y0 + (r.y1 - r.y0) * ease.quadOut(clamp01(r.t / NUM_RISE_MS));
          o.alpha = r.t <= r.a ? 1 : 1 - clamp01((r.t - r.a) / NUM_FADE_MS);
          if (r.s) o.setScale(1.6 - 0.6 * ease.backOut(clamp01(r.t / NUM_POP_MS)));
          break;
        }
        case Kind.Headline: {
          const q = clamp01(r.t / r.dur);
          o.y = r.y0 - HEADLINE_RISE * ease.quadOut(q);
          o.alpha = q <= HEADLINE_HOLD ? 1 : 1 - (q - HEADLINE_HOLD) / (1 - HEADLINE_HOLD);
          break;
        }
        case Kind.Fx: {
          if (r.effect) {
            const frame = animatedFrameAt(r.effect, r.t);
            o.setVisible(frame >= 0);
            if (frame >= 0) (o as Phaser.GameObjects.Image).setFrame(frame);
            if (r.effect.rise && r.effect.scale) {
              // Камень растёт из земли (origin — точка ног) и уходит обратно в последнюю четверть жизни.
              const up = clamp01(r.t / r.effect.rise);
              const down = clamp01((r.dur - r.t) / (r.dur * 0.25));
              (o as Phaser.GameObjects.Image).scaleY = r.effect.scale * ease.backOut(Math.min(up, down));
            }
          } else {
            const p = clamp01(r.t / r.dur);
            o.alpha = r.a * (1 - p);
            o.setScale(r.s * (1 + 0.2 * p));
          }
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
    this.digits.clear();
    this.images.clear();
    this.probe = null;
  }

  private text(x: number, y: number, value: string, size: number, color: string, stroke: string, thick: number, depth: number): Phaser.GameObjects.Text {
    const style = this.styles.get(size, color, stroke, thick, true);
    this.room();
    const t = this.texts.acquire();
    // Стиль без перерисовки (и без замера шрифта, если он уже в кэше), затем один updateText.
    t.style.setStyle(style, false);
    if (!style.metrics) {
      // Первый текст этого размера: setStyle без метрик оставил бы метрики прошлого стиля (цифры обрезались
      // сверху и снизу) — замерить шрифт один раз и запомнить.
      t.style.update(true);
      this.styles.remember(style, t.style.getTextMetrics());
    }
    if (t.text !== value) t.setText(value);
    else t.updateText();
    t.setPosition(x, y).setScale(1).setAlpha(1).setDepth(depth);
    this.scene.children.bringToTop(t);
    return t;
  }

  private image(x: number, y: number, texId: string, size: number, depth: number): Phaser.GameObjects.Image {
    const img = this.images.acquire();
    img.setTexture(texId).setPosition(x, y).setOrigin(0.5).setFlipX(false).setScale(1).setDisplaySize(size, size).setAlpha(1).setDepth(depth).setBlendMode(Phaser.BlendModes.NORMAL);
    this.scene.children.bringToTop(img);
    return img;
  }

  private start(kind: Kind, obj: Transient['obj'], dur: number): Transient {
    const r = this.spare.pop() ?? { kind, obj, seq: 0, t: 0, dur, x0: 0, y0: 0, x1: 0, y1: 0, a: 0, s: 0, mode: 0 };
    r.kind = kind;
    r.seq = this.seq++;
    r.obj = obj;
    r.t = 0;
    r.dur = dur;
    r.a = 0;
    r.s = 0;
    r.effect = undefined;
    r.key = undefined;
    r.mode = 0;
    this.live.push(r);
    return r;
  }

  private finish(i: number): void {
    const r = this.live[i];
    const last = this.live.pop()!;
    if (last !== r) this.live[i] = last;
    this.spare.push(r);
    const o = r.obj;
    if (o instanceof Phaser.GameObjects.BitmapText) this.digits.release(o);
    else if (o instanceof Phaser.GameObjects.Text) this.texts.release(o);
    else this.images.release(o);
  }
}

/** x центра надписи шириной w — целиком в пределах экрана. */
export const clampX = (x: number, w: number): number => Math.min(Math.max(x, w / 2 + EDGE), GAME_W - w / 2 - EDGE);

/** Сколько висит реплика босса (мс игрового времени сцены) и её ширина. */
const BARK_MS = 2600;
const BARK_W = 520;

/** Кто говорит: точка ног фигуры и высота подписи над ней (UnitView боя). */
export interface BarkTarget {
  node: { x: number; y: number };
  nameY: number;
}

/**
 * Реплики босса (lore-route §5.5, поле юнита barks): облачко над фигурой — едет за ней, живёт BARK_MS и гаснет.
 * Одно облачко на говорящего (новое заменяет старое). Только вид: без интерактива, бой и авто не ждут.
 */
export class BarkLayer {
  private readonly items: { target: BarkTarget; box: Phaser.GameObjects.Container; left: number; w: number; h: number }[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  show(target: BarkTarget, line: string): void {
    const old = this.items.findIndex((b) => b.target === target);
    if (old >= 0) this.items.splice(old, 1)[0].box.destroy();
    const s = this.scene;
    const t = text(s, 0, 0, line, 28, '#2a1c08', { fontStyle: 'bold', wordWrap: { width: BARK_W - 40, useAdvancedWrap: true }, align: 'center', lineSpacing: 2 });
    const w = Math.min(BARK_W, t.width + 44);
    const h = t.height + 30;
    const g = s.add.graphics();
    g.fillStyle(0x000000, 0.35).fillRoundedRect(-w / 2 + 4, -h + 6, w, h, 18);
    g.fillStyle(0xfff4dc, 0.97).fillRoundedRect(-w / 2, -h, w, h, 18);
    g.lineStyle(4, 0x6b4a1a, 1).strokeRoundedRect(-w / 2, -h, w, h, 18);
    // Хвостик облачка — вниз, к говорящему.
    g.fillStyle(0xfff4dc, 0.97).fillTriangle(-16, -2, 16, -2, 0, 22);
    g.lineStyle(4, 0x6b4a1a, 1).lineBetween(-16, 0, 0, 22).lineBetween(16, 0, 0, 22);
    t.setPosition(0, -h / 2);
    const box = s.add.container(0, 0, [g, t]).setDepth(DEPTH.numbers + 50).setName('bossBark').setData('text', line);
    box.setScale(0.6).setAlpha(0);
    s.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
    const item = { target, box, left: BARK_MS, w, h };
    this.items.push(item);
    this.place(item);
  }

  private place(b: { target: BarkTarget; box: Phaser.GameObjects.Container; w: number; h: number }): void {
    const x = Phaser.Math.Clamp(b.target.node.x, b.w / 2 + 10, GAME_W - b.w / 2 - 10);
    const y = Math.max(b.h + 20, b.target.node.y + b.target.nameY - 40);
    b.box.setPosition(x, Math.min(y, GAME_H - 40));
  }

  /** dt — мс игрового времени. */
  step(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const b = this.items[i];
      b.left -= dt;
      this.place(b);
      if (b.left > 0) continue;
      this.items.splice(i, 1);
      this.scene.tweens.add({ targets: b.box, alpha: 0, duration: 250, onComplete: () => b.box.destroy() });
    }
  }

  clear(): void {
    for (const b of this.items) b.box.destroy();
    this.items.length = 0;
  }
}
