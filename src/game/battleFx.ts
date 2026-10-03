import Phaser from 'phaser';
import { animatedFrameAt, animatedFxDuration, animatedFxKey, selectedAnimatedEffect, type AnimatedEffect } from './animatedFx';
import { FONT, GAME_H, GAME_W } from './layout';
import { coversNumber, coversRoDigits, numberFont, numberFrameWidth, numberOrigin, RO_DIGIT_H, roDamageFont } from './numberFont';
import { clamp01, ease, Pool, TextStyleCache } from './perf';
import { FOCUS_MUTE_ALPHA, ULT_FX_BOOST } from './skillFx';
import { motion } from './state';
import { COLOR, E, FAMILY, M, T } from './theme';
import { text } from './ui';

export { FOCUS_MUTE_ALPHA, ULT_FX_BOOST };

/** Общий множитель размера атласов навыков RO в бою (владелец 30.09: «со всеми спеллами покрупнее»). */
export const SKILL_FX_SIZE = 1.35;
/**
 * RR-15: эффекты на своих героях (попадания врагов, их дебаффы, касты героев) — без укрупнения ×SKILL_FX_SIZE и
 * полупрозрачные: в поздних главах эффекты закрывали фигуры отряда 92–100 % времени.
 */
export const ALLY_FX_ALPHA = 0.55;
/**
 * Ульта героя (владелец 01.10: «где Асура должна быть видна»): её атласы — без правила RR-15 (полная яркость и на своих
 * героях) и крупнее обычного навыка в ULT_FX_BOOST раз, но не шире экрана.
 */
const ULT_FX_MAX_W = GAME_W * 0.95;
/** Бафф ульты на своих героях — такая прозрачность (не RR-15 0.55, но фигуры отряда видны сквозь лист). */
const ULT_ALLY_ALPHA = 0.8;
/** RR-15: крупных эффектов одновременно — не больше; сверх — новые бледнее, а эффекты на героях не рисуются. */
export const MAX_BIG_FX = 5;
/** «Крупный» эффект — шире этого (px поля). */
const BIG_FX_PX = 260;

/** Слои глубины боя: юниты — по y (до ~1700), затемнение ульты, выделенный кастер, эффекты, цифры, баннер. */
export const DEPTH = {
  dim: 2900,
  spotlight: 3000,
  fx: 4000,
  numbers: 5000,
  banner: 6000,
} as const;

/**
 * Где висит баннер ульты: под верхней полосой боя (таймер, скорость, «Авто»; полировка UI, итерация 5) и полосой босса —
 * над полем, а не посреди него. Панель героев теперь внизу, раньше баннер стоял под ней (792).
 */
const BANNER_Y = 300;
/** Ширина плашки: две (своя слева, чужая справа) помещаются в ряд. */
const BANNER_W = 510;
/** Высота плашки ульты: имя героя (T.caption) над названием навыка (T.heading). */
const BANNER_H = 116;

/**
 * Фон плашки ульты (итерация 5): тёмная полоса, плотная у края своей стороны и тающая к дальнему, тонкие линии цвета
 * стороны сверху и снизу и короткий акцент у края — как баннеры навыков AFK, без коробки с толстой рамкой.
 * Рисуется один раз на сторону в canvas-текстуру.
 */
function bannerTexture(scene: Phaser.Scene, ally: boolean): string {
  const key = `ultBanner_${ally ? 'A' : 'B'}`;
  if (scene.textures.exists(key)) return key;
  const w = BANNER_W;
  const h = BANNER_H;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return '__DEFAULT';
  const c = tex.getContext();
  const edge = ally ? COLOR.title : '#ff7a64';
  const grad = c.createLinearGradient(ally ? 0 : w, 0, ally ? w : 0, 0);
  grad.addColorStop(0, 'rgba(18,12,6,0.94)');
  grad.addColorStop(0.62, 'rgba(18,12,6,0.82)');
  grad.addColorStop(1, 'rgba(18,12,6,0)');
  c.fillStyle = grad;
  c.fillRect(0, 3, w, h - 6);
  const line = c.createLinearGradient(ally ? 0 : w, 0, ally ? w : 0, 0);
  line.addColorStop(0, edge);
  line.addColorStop(0.7, edge + '99');
  line.addColorStop(1, edge + '00');
  c.fillStyle = line;
  c.fillRect(0, 0, w, 3);
  c.fillRect(0, h - 3, w, 3);
  c.fillStyle = edge;
  c.fillRect(ally ? 0 : w - 8, 3, 8, h - 6);
  tex.refresh();
  return key;
}

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
      tx = ally ? 45 : -45;
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
        { x, alpha: 1, duration: M.fast, ease: E.out },
        { alpha: 1, duration: 1100 },
        { alpha: 0, duration: M.base, ease: E.in },
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
    // Значок навыка — у края своей стороны (там полоса плотнее всего).
    const icon = this.scene.add.image(ally ? -w / 2 + 62 : w / 2 - 62, 0, '__DEFAULT').setVisible(false);
    // Фон — одна картинка (полоса с градиентом к дальнему краю и тонкими линиями цвета стороны), без рамки-коробки.
    const bg = this.scene.add.image(0, 0, bannerTexture(this.scene, ally));
    const node = this.scene.add.container(0, BANNER_Y, [bg, icon]).setDepth(DEPTH.banner).setAlpha(0).setVisible(false);
    return { node, icon, ally, who: null, what: null, whos: new Map(), whats: new Map() };
  }

  /** Надпись плашки из кэша стороны (строится при первой ульте с этим именем/навыком). */
  private label(b: BannerParts, cache: Map<string, Phaser.GameObjects.Text>, value: string, skill: boolean): Phaser.GameObjects.Text {
    let t = cache.get(value);
    if (t) return t;
    if (skill) {
      // Название ульты — заголовочной гарнитурой, тонкий контур и тень вместо толстой обводки.
      t = text(this.scene, 0, 12, value, T.heading, b.ally ? COLOR.title : '#ffb4a6', { fontFamily: FAMILY.heading, fontStyle: 'bold', stroke: '#1a0e04', strokeThickness: 3 });
      t.setShadow(0, 3, 'rgba(0,0,0,0.7)', 4, true, true);
      b.node.add(t);
    } else {
      t = text(this.scene, 0, -32, value, T.caption, b.ally ? COLOR.textSecondary : '#e0b0a8', { fontFamily: FAMILY.body });
      b.node.addAt(t, 2);
    }
    cache.set(value, t);
    return t;
  }

  /** Убрать плашку стороны (ульта героя началась — плашка ульты монстра не висит поверх неё). */
  hideBanner(side: 'A' | 'B'): void {
    const c = this.banners[side];
    if (!c) return;
    this.chains[side]?.stop();
    this.chains[side] = null;
    this.scene.tweens.add({ targets: c, alpha: 0, duration: 120, onComplete: () => c.setVisible(false) });
    this.banners[side] = null;
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

const Kind = { Number: 0, Headline: 1, Fx: 2, Projectile: 3, Icon: 4 } as const;
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
  /** Подпись идёт за юнитом (RR-13: «Перехват!» — за стражем, а не на старой точке); x1 — сдвиг от него. */
  follow?: { x: number };
  /** Множитель прозрачности цифры/подписи (FOCUS_MUTE_ALPHA — появилась во время чужой ульты). */
  m: number;
  /** Цифра: смысл (вид и приоритет) и стихия — сливаются только одинаковые. */
  nk?: NumberKind;
  elem?: NumberElem;
  /** Цифра: сумма слитых ударов. */
  v: number;
  /** «Хлопок» появления: начальный множитель масштаба и его длительность (мс боя). */
  pop: number;
  popMs: number;
  /** Вытеснена (лимит цифр, новый значок статуса): с этого t быстро гаснет за EVICT_MS. −1 — живёт свой срок. */
  die: number;
  /** Габариты цифры в пике появления, для разведения соседних надписей. */
  nw: number;
  nh: number;
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
/**
 * RR-13: подписи поведения («Бежит!», «Перехват!», «Каст сорван», «Сбито!», «Отход!») — крупнее подписей статусов и
 * на своей глубине над цифрами урона (цифры поднимаются bringToTop только внутри DEPTH.numbers).
 */
export const BEHAVIOR_LABEL_SIZE = 36;
export const BEHAVIOR_LABEL_DEPTH = 5100;
/** Отступ надписи от края экрана. */
const EDGE = 8;
/** Зазор между цифрами (единицы поля, включая максимальный масштаб появления). */
const NUMBER_GAP = 10;

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
 * Итерация 5 (ui-polish-research §5 «Бой»): цифры по смыслу, иерархия как в AFK — обычный урон мелкий белый, урон по
 * героям красный (цвета RO), удар ульты («крит») крупный золотой с «хлопком» и зависает над целью, лечение зелёное и
 * щит голубой поднимаются вверх, урон со временем (яд, огонь) и ушедший в щит — мельче всех.
 */
export type NumberKind = 'hit' | 'hurt' | 'dot' | 'absorb' | 'crit' | 'ouch' | 'heal' | 'shield';
/** Стихия удара (событие damage → elem): по слабости — оранжевее и крупнее, по стойкости — серее и мельче. */
export type NumberElem = 'weak' | 'resist';

interface NumberLook {
  /** Цвет (tint белых цифр RO). */
  tint: number;
  /** Размер: 1 = RO_DIGIT_H (42 ед. ≈ 15 px на 390). */
  scale: number;
  /** «Хлопок»: появляется в pop раз крупнее и за popMs садится в размер. */
  pop: number;
  popMs: number;
  /** Кого вытеснять первым при лимите MAX_NUMBERS: меньше — раньше. */
  prio: number;
  /** Цвет прежней цифры шрифтом (если атлас RO не загрузился). */
  color: string;
}

export const NUMBER_LOOK: Record<NumberKind, NumberLook> = {
  hit: { tint: 0xffffff, scale: 1, pop: 1.35, popMs: M.fast, prio: 1, color: '#ffffff' },
  hurt: { tint: 0xff4a3a, scale: 0.95, pop: 1.35, popMs: M.fast, prio: 2, color: '#ff8a73' },
  dot: { tint: 0xc3e88a, scale: 0.75, pop: 1.15, popMs: M.fast, prio: 0, color: '#9be36b' },
  absorb: { tint: 0x8cc8ff, scale: 0.8, pop: 1.2, popMs: M.fast, prio: 0, color: '#bcd6ff' },
  crit: { tint: 0xffd23a, scale: 1.6, pop: 2.2, popMs: M.base, prio: 4, color: '#ffd84a' },
  /** Удар ульты врага по герою: крупно, но красным — золото только у своих ульт. */
  ouch: { tint: 0xff4a3a, scale: 1.3, pop: 1.8, popMs: M.base, prio: 3, color: '#ff8a73' },
  heal: { tint: 0x5cff6a, scale: 1.05, pop: 1.3, popMs: M.fast, prio: 3, color: '#8fd694' },
  shield: { tint: 0x8cc8ff, scale: 0.9, pop: 1.3, popMs: M.fast, prio: 2, color: '#7cc4ff' },
};

/** Стихия: цвет заменяет цвет вида (кроме ульты, лечения и щита), размер умножается. */
export const ELEM_LOOK: Record<NumberElem, { tint: number; scale: number }> = {
  weak: { tint: 0xffa040, scale: 1.15 },
  resist: { tint: 0xa3acb5, scale: 0.85 },
};

/** Удары по одной цели одного вида в пределах этого окна (мс боя) складываются в одну цифру. */
export const MERGE_MS = 150;
/** Цифр на экране одновременно (§5: «не больше 6», с запасом на крупные бои): сверх — самая неважная и старая гаснет. */
export const MAX_NUMBERS = 8;
/** За сколько гаснет вытесненная цифра или сменённый значок статуса. */
const EVICT_MS = M.fast;
/** Удар ульты: подъём над точкой появления и время жизни (висит дольше обычной). */
const RO_CRIT = 3;
const CRIT_RISE = 72;
const CRIT_MS = 1300;
/** Значок статуса над юнитом: размер, жизнь, подъём. */
export const STATUS_POP_SIZE = 64;
const STATUS_POP_MS = 1000;
const STATUS_POP_RISE = 40;

/** Cubic.easeOut (E.out) — посадка «хлопка» и подъёмы без перелёта. */
const cubicOut = (v: number): number => 1 - (1 - v) ** 3;

/** Прежние цвета RO из BattleScene (popRo: tint + масштаб + движение) → вид цифры. */
const LEGACY_TINT = { hero: 0xff4a3a, ult: 0xffd23a, heal: 0x5cff6a, shield: 0x8cc8ff } as const;

/**
 * Вид цифры по прежним параметрам popRo (tint, движение, масштаб, сторона цели dir: −1 — герой): цифры сцены получают
 * иерархию без её правки.
 */
export function numberKindOf(tint: number, mode: number, scale: number, dir = 1): NumberKind {
  if (mode === RO_RISE) return tint === LEGACY_TINT.heal ? 'heal' : 'shield';
  if (tint === LEGACY_TINT.ult) return dir < 0 ? 'ouch' : 'crit';
  if (tint === LEGACY_TINT.shield) return 'absorb';
  // Урон со временем сцена рисует цифрой ×0.9 (обычный удар — ×1.15).
  if (scale < 1) return 'dot';
  return tint === LEGACY_TINT.hero ? 'hurt' : 'hit';
}

/** Итоговый цвет и размер цифры вида kind со стихией elem. */
export function numberLook(kind: NumberKind, elem?: NumberElem): { tint: number; scale: number } {
  const look = NUMBER_LOOK[kind];
  if (!elem || kind === 'heal' || kind === 'shield' || kind === 'absorb') return { tint: look.tint, scale: look.scale };
  const el = ELEM_LOOK[elem];
  return { tint: kind === 'crit' ? look.tint : el.tint, scale: look.scale * el.scale };
}

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
  /** Ульта героя (BattleScene.fxMode): вспышки — полная яркость и на своих (без RR-15), крупнее ×ULT_FX_BOOST. */
  ult = false;
  /** Фокус на ульте героя: новые цифры, подписи и вспышки других бойцов — × FOCUS_MUTE_ALPHA. */
  mute = false;

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
    this.capNumbers();
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
    const bounds = t instanceof Phaser.GameObjects.BitmapText ? t.getTextBounds(true).local : t;
    this.placeNumber(r, bounds.width * (big ? 1.6 : 1), (size + thick * 2) * (big ? 1.6 : 1));
    return t;
  }

  /**
   * Цифра урона RO (только 0–9, атлас numbers). tint/scale/mode — прежние параметры сцены: по ним выбирается вид цифры
   * (numberKindOf → NUMBER_LOOK), так что цвет и размер задаёт этот слой. mode — RO_HIT (дуга в сторону dir) или
   * RO_RISE (вверх); удар ульты висит над целью. elem — стихия удара (слабость/стойкость).
   * Удары по той же цели того же вида в пределах MERGE_MS складываются в одну цифру; на экране не больше MAX_NUMBERS.
   * false — атлас не загрузился или в строке не только цифры: вызывающий рисует прежней цифрой (number).
   */
  roNumber(x: number, y: number, value: string, tint: number, scale: number, depth: number, mode: number, dir: number, key?: string, elem?: NumberElem): boolean {
    const font = coversRoDigits(value) ? roDamageFont(this.scene) : null;
    if (!font) return false;
    const kind = numberKindOf(tint, mode, scale, dir);
    const amount = Number(value);
    if (key && this.merge(key, kind, elem, amount)) return true;
    if (key) this.limit(Kind.Number, key, NUMBERS_PER_UNIT - 1);
    this.capNumbers();
    this.room();
    const look = numberLook(kind, elem);
    const t = this.digits.acquire();
    if (t.font !== font) t.setFont(font, RO_DIGIT_H);
    t.setScale(look.scale).setText(value).setOrigin(0.5, 0.5).setTint(look.tint).setAlpha(1).setDepth(depth);
    const w = t.getTextBounds(true).local.width * look.scale;
    const x0 = clampX(x, w);
    // Снос в сторону — туда, где хватает места до края экрана.
    let drift = mode === RO_HIT ? dir * RO_DRIFT : 0;
    if (clampX(x0 + drift, w) !== x0 + drift) drift = -drift;
    t.setPosition(x0, y);
    this.scene.children.bringToTop(t);
    const crit = kind === 'crit' || kind === 'ouch';
    const r = this.start(Kind.Number, t, crit ? CRIT_MS : mode === RO_HIT ? RO_HIT_MS : RO_RISE_MS);
    r.key = key;
    r.mode = crit ? RO_CRIT : mode;
    r.x0 = x0;
    r.y0 = y;
    r.x1 = drift;
    r.s = look.scale;
    r.nk = kind;
    r.elem = elem;
    r.v = amount;
    this.popIn(r, NUMBER_LOOK[kind].pop, NUMBER_LOOK[kind].popMs);
    t.setScale(look.scale * r.pop);
    this.placeNumber(r, w * r.pop, RO_DIGIT_H * look.scale * r.pop);
    return true;
  }

  /** Тот же удар по той же цели только что был: прибавить к его цифре и «хлопнуть» её заново (MERGE_MS). */
  private merge(key: string, kind: NumberKind, elem: NumberElem | undefined, amount: number): boolean {
    for (const r of this.live) {
      if (r.kind !== Kind.Number || r.key !== key || r.nk !== kind || r.elem !== elem || r.die >= 0 || r.t > MERGE_MS) continue;
      const t = r.obj as Phaser.GameObjects.BitmapText;
      r.v += amount;
      t.setText(String(Math.round(r.v)));
      r.x0 = clampX(r.x0, t.getTextBounds(true).local.width * r.s);
      // Движение начинается заново с того же места; хлопок — чуть слабее первого.
      r.t = 0;
      this.popIn(r, 1 + (NUMBER_LOOK[kind].pop - 1) * 0.7, NUMBER_LOOK[kind].popMs);
      t.setScale(r.s * r.pop);
      this.placeNumber(r, t.getTextBounds(true).local.width * r.s * r.pop, RO_DIGIT_H * r.s * r.pop);
      return true;
    }
    return false;
  }

  /**
   * Место освобождается вместе с самой цифрой, а не через независимые 420 мс сцены.
   * Проверяем все соседние цели и реальный пик «хлопка», в том числе после роста суммы.
   * Новая цифра уходит выше занятого места, не вниз на тело; dt/пауза/скорость остаются у FloatLayer.
   */
  private placeNumber(r: Transient, width: number, height: number): void {
    r.nw = width;
    r.nh = height;
    const travel = (n: Transient): { rise: number; fall: number; drift: number } =>
      n.mode === RO_HIT ? { rise: RO_ARC, fall: RO_ARC, drift: n.x1 } :
      n.mode === RO_RISE ? { rise: RO_RISE_H, fall: 0, drift: 0 } :
      n.mode === RO_CRIT ? { rise: CRIT_RISE, fall: 0, drift: n.x1 * 0.35 } :
      { rise: Math.max(0, n.y0 - n.y1), fall: 0, drift: 0 };
    const move = travel(r);
    const minY = BANNER_Y + BANNER_H / 2 + 24 + height / 2 + move.rise;
    const maxY = GAME_H - 270 - height / 2 - move.fall;
    const preferredX = clampX(r.x0, width);
    const preferredY = Math.min(maxY, Math.max(minY, r.y0));
    // Резервируем всю дугу/подъём: цифры разных видов не встретятся через несколько кадров.
    const boxes = this.live.filter((n) => n !== r && n.kind === Kind.Number && n.die < 0 && n.obj.alpha >= 0.2).map((n) => {
      const m = travel(n);
      const endX = clampX(n.x0 + m.drift, n.nw);
      return { n, left: Math.min(n.x0, endX) - n.nw / 2, right: Math.max(n.x0, endX) + n.nw / 2,
        top: n.y0 - m.rise - n.nh / 2, bottom: n.y0 + m.fall + n.nh / 2 };
    });
    let y = preferredY;
    let x = preferredX;
    const overlaps = (b: typeof boxes[number], px: number, py: number): boolean => {
      const endX = clampX(px + move.drift, width);
      return Math.min(px, endX) - width / 2 < b.right + NUMBER_GAP && Math.max(px, endX) + width / 2 > b.left - NUMBER_GAP &&
        py - move.rise - height / 2 < b.bottom + NUMBER_GAP && py + move.fall + height / 2 > b.top - NUMBER_GAP;
    };
    let placed = false;
    // Сначала столбик у цели; если над ним уже HUD, пробуем соседние столбики.
    const candidates = [preferredX, ...boxes.flatMap((b) => [
      b.left - width / 2 - NUMBER_GAP - Math.max(0, move.drift),
      b.right + width / 2 + NUMBER_GAP - Math.min(0, move.drift),
    ])].map((px) => clampX(px, width)).sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX));
    for (const candidate of candidates) {
      x = candidate;
      y = preferredY;
      for (let pass = 0; pass <= boxes.length; pass++) {
        let next = y;
        for (const b of boxes) if (overlaps(b, x, y)) next = Math.min(next, b.top - move.fall - height / 2 - NUMBER_GAP);
        if (next === y) { placed = true; break; }
        if (next < minY) break;
        y = next;
      }
      if (placed) break;
    }
    // Очень плотная очередь: новая остаётся у цели, старые конфликтующие цифры штатно гаснут.
    if (!placed) {
      x = preferredX;
      y = preferredY;
      const conflicts = boxes.filter((b) => overlaps(b, x, y));
      const priority = r.nk ? NUMBER_LOOK[r.nk].prio : 1;
      if (conflicts.some((b) => (b.n.nk ? NUMBER_LOOK[b.n.nk].prio : 1) > priority)) r.die = r.t;
      else for (const b of conflicts) b.n.die = b.n.t;
    }
    r.x0 = x;
    // Запасной шрифт использует y1 для подъёма; смещаем всю траекторию, сохраняя её длительность.
    r.y1 += y - r.y0;
    r.y0 = y;
    r.obj.setPosition(r.x0, y);
  }

  /** «Хлопок» появления (без него при «Меньше движения»). */
  private popIn(r: Transient, pop: number, ms: number): void {
    r.pop = motion.reduced ? 1 : pop;
    r.popMs = ms;
  }

  /**
   * Не больше MAX_NUMBERS цифр: самая неважная (NUMBER_LOOK.prio), из равных — самая старая, быстро гаснет за EVICT_MS
   * (не пропадает рывком).
   */
  private capNumbers(): void {
    let alive = 0;
    let victim: Transient | null = null;
    let vp = 0;
    for (const r of this.live) {
      if (r.kind !== Kind.Number || r.die >= 0) continue;
      alive++;
      const p = r.nk ? NUMBER_LOOK[r.nk].prio : 1;
      if (!victim || p < vp || (p === vp && r.seq < victim.seq)) {
        victim = r;
        vp = p;
      }
    }
    if (alive >= MAX_NUMBERS && victim) victim.die = victim.t;
  }

  /** Сколько цифр сейчас на экране (без гаснущих вытесненных) — для проверок. */
  get liveNumbers(): number {
    let n = 0;
    for (const r of this.live) if (r.kind === Kind.Number && r.die < 0) n++;
    return n;
  }

  /**
   * Значок статуса над юнитом (вместо слова «Оглушение», «Яд», «Слабость!»…): появляется с «хлопком», поднимается и
   * гаснет за STATUS_POP_MS — дальше статус виден маленьким значком у полосы ОЗ. У юнита один такой значок: новый
   * сменяет прежний (тот быстро гаснет); тот же значок, пока он на экране, не повторяется.
   */
  statusPop(x: number, y: number, texKey: string, key?: string): Phaser.GameObjects.Image | null {
    if (!this.scene.textures.exists(texKey)) return null;
    if (key) {
      for (const r of this.live) {
        if (r.kind !== Kind.Icon || r.key !== key || r.die >= 0) continue;
        if ((r.obj as Phaser.GameObjects.Image).texture.key === texKey) return r.obj as Phaser.GameObjects.Image;
        r.die = r.t;
      }
    }
    // Под цифрами: значок не закрывает число урона.
    const img = this.image(clampX(x, STATUS_POP_SIZE), y, texKey, STATUS_POP_SIZE, DEPTH.numbers - 10);
    const r = this.start(Kind.Icon, img, STATUS_POP_MS);
    r.key = key;
    r.x0 = img.x;
    r.y0 = y;
    r.s = img.scale;
    this.popIn(r, 1.6, M.base);
    img.setScale(r.s * r.pop);
    return img;
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
  headline(x: number, y: number, value: string, size: number, color: string, depth: number, key?: string, follow?: { x: number }): Phaser.GameObjects.Text {
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
    if (size >= BEHAVIOR_LABEL_SIZE) r.s = 1;
    if (follow) {
      r.follow = follow;
      r.x1 = x - follow.x;
    }
    return t;
  }

  /** Оставить у юнита key не больше keep надписей вида kind (самые старые снимаются). */
  private limit(kind: Kind, key: string, keep: number): void {
    const mine = this.live.filter((r) => r.kind === kind && r.key === key && r.die < 0).sort((a, b) => b.t - a.t);
    for (let n = mine.length; n > keep; n--) {
      const r = mine[mine.length - n];
      // Цифра не пропадает рывком — быстро гаснет; подпись снимается сразу (её место занимает новая).
      if (kind === Kind.Number) r.die = r.t;
      else this.finish(this.live.indexOf(r));
    }
  }

  /** Не больше MAX_FLOATS надписей на экране: при переполнении уходит самая старая (цифра или подпись). */
  private room(): void {
    if (this.texts.active.length + this.digits.active.length < MAX_FLOATS) return;
    let oldest = -1;
    for (let i = 0; i < this.live.length; i++) {
      const r = this.live[i];
      // Подпись поведения (s = 1, RR-13) не вытесняется цифрами урона.
      if ((r.kind === Kind.Number || (r.kind === Kind.Headline && r.s !== 1)) && (oldest < 0 || r.seq < this.live[oldest].seq)) oldest = i;
    }
    if (oldest >= 0) this.finish(oldest);
  }

  /** Началась ульта героя: всё, что уже на экране (цифры, подписи, вспышки), — приглушить до FOCUS_MUTE_ALPHA. */
  muteLive(): void {
    for (const r of this.live) {
      if (r.kind === Kind.Number || r.kind === Kind.Headline || r.kind === Kind.Icon) {
        if (r.s !== 1 || r.kind === Kind.Number) r.m = Math.min(r.m, FOCUS_MUTE_ALPHA);
      } else if (r.kind === Kind.Fx) {
        r.a *= FOCUS_MUTE_ALPHA;
        if (r.effect) r.obj.alpha *= FOCUS_MUTE_ALPHA;
      }
    }
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
  catalogFlash(x: number, feetY: number, id: string | undefined, size: number, key?: string, fromX?: number, onAlly = false): boolean {
    if (!id || !selectedAnimatedEffect(id, 'flash', this.scene.textures.exists(animatedFxKey(id)))) return false;
    this.flash(x, feetY, id, size, 1, 250, DEPTH.fx, feetY, key, fromX, onAlly);
    return true;
  }

  /** RR-15: сколько крупных эффектов сейчас на экране. */
  private bigFx(): number {
    let n = 0;
    for (const r of this.live) if (r.kind === Kind.Fx && r.obj.visible && (r.obj as Phaser.GameObjects.Image).displayWidth >= BIG_FX_PX) n++;
    return n;
  }

  /**
   * Вспышка: картинка size×size гаснет от alpha до 0 и растёт в 1.2 раза за duration. fromX — x кастера: атлас с
   * effects.json → from отражается, если кастер с другой стороны.
   */
  flash(x: number, y: number, texId: string, size: number, alpha: number, duration: number, depth: number, feetY = y, key?: string, fromX?: number, onAlly = false): void {
    const effect = selectedAnimatedEffect(texId, 'flash', this.scene.textures.exists(animatedFxKey(texId)));
    // На лечении уже есть кольцо, частицы и процедурный столб. Яркое ядро RO не должно белить фигуру,
    // в том числе во время своей ульты; кадры и полный срок атласа остаются прежними.
    if (texId === 'fx_heal' && onAlly) {
      size *= 0.8;
      alpha *= 0.45;
    }
    // RR-15: на своих героях — меньше и прозрачнее; при толпе крупных эффектов — бледнее, а на героях не рисуем вовсе.
    // Ульта героя — всегда видна целиком: не прозрачнее на своих, не бледнее в толпе, крупнее. Её бафф на своих
    // (Защита строя, Адреналин) — без укрупнения и чуть прозрачнее: белый лист во весь рост закрывал отряд целиком.
    const allyUlt = this.ult && onAlly;
    if (this.ult) onAlly = false;
    const crowded = !this.ult && this.bigFx() >= MAX_BIG_FX;
    if (crowded && onAlly) return;
    const dim = (onAlly ? ALLY_FX_ALPHA : allyUlt ? ULT_ALLY_ALPHA : 1) * (crowded ? 0.5 : 1) * (this.mute && !this.ult ? FOCUS_MUTE_ALPHA : 1);
    const boost = this.ult && !allyUlt ? ULT_FX_BOOST : 1;
    if (onAlly) size /= SKILL_FX_SIZE;
    size *= boost;
    alpha *= dim;
    const img = this.image(x, effect ? feetY : y, effect ? animatedFxKey(texId) : texId, size, depth).setAlpha(alpha);
    if (effect) {
      const flip = !!effect.from && fromX !== undefined && fromX !== x && (effect.from === 'right') === (fromX < x);
      const ox = effect.anchor[0] / effect.cell[0];
      img.setFrame(0).setOrigin(flip ? 1 - ox : ox, effect.anchor[1] / effect.cell[1]).setFlipX(flip);
      // Атлас навыка со своим масштабом (effects.json → scale): размер кадра RO, непрозрачный — роль не сжимает
      // крупный лист до точки и не делает его полупрозрачным.
      if (effect.scale) {
        img.setScale(effect.scale * (onAlly ? 1 : SKILL_FX_SIZE) * boost).setAlpha((effect.alpha ?? 1) * dim);
        if (this.ult && img.displayWidth > ULT_FX_MAX_W) img.setScale(img.scale * ULT_FX_MAX_W / img.displayWidth);
        // Ульта — целиком в кадре (иероглифы Асуры у края поля не обрезаются).
        if (this.ult) {
          const left = img.x - img.displayOriginX * img.scaleX;
          const w = img.displayWidth;
          if (left < EDGE) img.x += EDGE - left;
          else if (left + w > GAME_W - EDGE) img.x -= left + w - (GAME_W - EDGE);
        }
      } else img.setDisplaySize(size, size * effect.cell[1] / effect.cell[0]);
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
          // «Хлопок» появления: k садится от pop к 1 (у крупной — с перелётом, Back), дальше движение вида.
          const k = r.pop > 1 && r.t < r.popMs ? 1 + (r.pop - 1) * (1 - (r.nk === 'crit' || r.nk === 'ouch' ? ease.backOut : cubicOut)(r.t / r.popMs)) : 1;
          const gone = r.die >= 0 ? 1 - clamp01((r.t - r.die) / EVICT_MS) : 1;
          if (r.mode) {
            const p = clamp01(r.t / r.dur);
            o.alpha = gone * r.m * (p <= RO_FADE_AT ? 1 : 1 - (p - RO_FADE_AT) / (1 - RO_FADE_AT));
            if (r.mode === RO_HIT) {
              // Дуга RO: вверх до пика на трети пути, затем вниз ниже старта; снос в сторону и уменьшение — равномерно.
              o.x = r.x0 + r.x1 * p;
              o.y = r.y0 - RO_ARC * Math.sin(1.5 * Math.PI * p);
              o.setScale(k * r.s * (1 - (1 - RO_END_SCALE) * p));
            } else if (r.mode === RO_CRIT) {
              // Удар ульты: короткий подъём и висит над целью, к концу чуть уменьшается.
              const q = cubicOut(clamp01(p * 2.5));
              o.y = r.y0 - CRIT_RISE * q;
              // Чуть в сторону тыла цели (как дуга обычной): соседние цели не сливают крупные цифры в одну строку.
              o.x = r.x0 + r.x1 * 0.35 * q;
              o.setScale(k * r.s * (p <= RO_FADE_AT ? 1 : 1 - 0.25 * (p - RO_FADE_AT) / (1 - RO_FADE_AT)));
            } else {
              o.y = r.y0 - RO_RISE_H * ease.quadOut(p);
              o.setScale(k * r.s);
            }
            o.x = clampX(o.x, r.nw);
            break;
          }
          o.y = r.y0 + (r.y1 - r.y0) * ease.quadOut(clamp01(r.t / NUM_RISE_MS));
          o.alpha = gone * r.m * (r.t <= r.a ? 1 : 1 - clamp01((r.t - r.a) / NUM_FADE_MS));
          if (r.s) o.setScale(1.6 - 0.6 * ease.backOut(clamp01(r.t / NUM_POP_MS)));
          break;
        }
        case Kind.Icon: {
          const p = clamp01(r.t / r.dur);
          const k = r.pop > 1 && r.t < r.popMs ? 1 + (r.pop - 1) * (1 - ease.backOut(r.t / r.popMs)) : 1;
          const gone = r.die >= 0 ? 1 - clamp01((r.t - r.die) / EVICT_MS) : 1;
          o.setScale(r.s * k);
          o.y = r.y0 - STATUS_POP_RISE * cubicOut(p);
          o.alpha = gone * r.m * (p <= 0.6 ? 1 : 1 - (p - 0.6) / 0.4);
          break;
        }
        case Kind.Headline: {
          const q = clamp01(r.t / r.dur);
          o.y = r.y0 - HEADLINE_RISE * ease.quadOut(q);
          if (r.follow) o.x = clampX(r.follow.x + r.x1, (o as Phaser.GameObjects.Text).width);
          o.alpha = r.m * (q <= HEADLINE_HOLD ? 1 : 1 - (q - HEADLINE_HOLD) / (1 - HEADLINE_HOLD));
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
              (o as Phaser.GameObjects.Image).scaleY = r.s * ease.backOut(Math.min(up, down));
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
      if (r.t >= r.dur || (r.die >= 0 && r.t - r.die >= EVICT_MS)) this.finish(i);
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
    const r = this.spare.pop() ?? { kind, obj, seq: 0, t: 0, dur, x0: 0, y0: 0, x1: 0, y1: 0, a: 0, s: 0, mode: 0, m: 1, v: 0, pop: 1, popMs: 0, die: -1, nw: 0, nh: 0 };
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
    r.follow = undefined;
    r.nk = undefined;
    r.elem = undefined;
    r.v = 0;
    r.pop = 1;
    r.popMs = 0;
    r.die = -1;
    r.nw = 0;
    r.nh = 0;
    // Вспышки (Kind.Fx) приглушает flash() сам; цифры и подписи — множителем в step.
    r.m = this.mute && !this.ult && kind !== Kind.Fx ? FOCUS_MUTE_ALPHA : 1;
    if (r.m < 1) obj.setAlpha(r.m);
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

  /** minTop — облачко не выше этой линии (низ панели героев, QA RN-16): иначе реплика ложилась на портреты. */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly minTop = 0,
  ) {}

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
    const y = Math.max(b.h + 20, this.minTop + b.h + 10, b.target.node.y + b.target.nameY - 40);
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
