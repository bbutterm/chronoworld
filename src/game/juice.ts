import type Phaser from 'phaser';
import { formatNumber } from './flow';
import { motion } from './state';
import { TINT } from './theme';

/**
 * «Сочность» меню в духе AFK Arena — дёшево и сдержанно: награды летят к валюте в шапке, числа отсчитываются,
 * «таблетки» валюты подпрыгивают, готовое к получению пульсирует, списки коротко «выезжают» при первом открытии
 * экрана за сессию, полосы прогресса доезжают до нового значения.
 *
 * Всё выключается настройкой «Уменьшить анимацию» (state.motion, localStorage) — тогда сразу конечное состояние.
 * Временные объекты (монеты, искры) уничтожаются по окончании своего твина; твины сцены Phaser сам снимает
 * при её остановке. В onUpdate нет выделений памяти, кроме setText при смене отображаемого числа.
 */
export const juiceOn = (): boolean => !motion.reduced;

/** Глубина летящих наград: над окнами (9000), под тостами (10000). */
const FLY_DEPTH = 9500;

// ---------- повторные открытия за сессию ----------

const seen = new Set<string>();

/** Первое открытие экрана/списка key за сессию (повторные открытия — без «выезда»). Отмечает key увиденным. */
export function firstVisit(key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

type Animatable = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Alpha;

/**
 * Строки списка «выезжают» снизу и проявляются друг за другом: ≤ 250 мс на весь список. Только при первом
 * открытии экрана key за сессию и без «Уменьшить анимацию». groups — объекты каждой строки (по порядку).
 * Один счётчик-твин на строку.
 */
export function staggerIn(scene: Phaser.Scene, key: string, groups: Phaser.GameObjects.GameObject[][]): void {
  if (!groups.length || !juiceOn() || !firstVisit(key)) return;
  const DUR = 140;
  const RISE = 26;
  const step = Math.min(35, 110 / groups.length);
  groups.forEach((g, i) => {
    const objs = g.filter((o) => 'alpha' in o && 'y' in o) as Animatable[];
    if (!objs.length) return;
    const alpha = objs.map((o) => o.alpha);
    const y = objs.map((o) => o.y);
    const apply = (v: number) => {
      for (let k = 0; k < objs.length; k++) {
        const o = objs[k];
        if (!o.scene) continue;
        o.setAlpha(alpha[k] * v);
        o.y = y[k] + RISE * (1 - v);
      }
    };
    apply(0);
    scene.tweens.addCounter({ from: 0, to: 1, delay: i * step, duration: DUR, ease: 'Cubic.easeOut', onUpdate: (tw) => apply(tw.getValue() ?? 1), onComplete: () => apply(1) });
  });
}

/** Записать, какие объекты добавил в контейнер build() (строка списка), — для staggerIn. */
export function collect(container: { list: Phaser.GameObjects.GameObject[] }, build: () => void): Phaser.GameObjects.GameObject[] {
  const from = container.list.length;
  build();
  return container.list.slice(from);
}

// ---------- числа ----------

/**
 * Отсчёт числа в тексте от from до to (формат — fmt). Без анимации — сразу to.
 * onDone — когда показано конечное значение.
 */
export function countUp(
  scene: Phaser.Scene,
  t: Phaser.GameObjects.Text,
  from: number,
  to: number,
  fmt: (n: number) => string = formatNumber,
  opts: { duration?: number; delay?: number; onDone?: () => void } = {},
): void {
  if (!juiceOn() || from === to) {
    t.setText(fmt(to));
    opts.onDone?.();
    return;
  }
  let last = from;
  t.setText(fmt(from));
  scene.tweens.addCounter({
    from,
    to,
    duration: opts.duration ?? 600,
    delay: opts.delay ?? 0,
    ease: 'Cubic.easeOut',
    onUpdate: (tw) => {
      const v = Math.round(tw.getValue() ?? to);
      if (v === last || !t.scene) return;
      last = v;
      t.setText(fmt(v));
    },
    onComplete: () => {
      if (t.scene) t.setText(fmt(to));
      opts.onDone?.();
    },
  });
}

/** Короткий «подскок» (масштаб туда-обратно) — число или значок изменились. */
export function bump(scene: Phaser.Scene, target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject, amount = 1.15): void {
  if (!juiceOn() || !target.scene) return;
  const base = (target.getData('bumpBase') as number | undefined) ?? target.scaleX;
  target.setData('bumpBase', base);
  scene.tweens.killTweensOf(target);
  target.setScale(base);
  scene.tweens.add({ targets: target, scale: base * amount, duration: 110, yoyo: true, ease: 'Quad.easeOut', onComplete: () => target.scene && target.setScale(base) });
}

/** Готово к получению: мягкий бесконечный пульс (кнопка «Забрать», порог наград). Без анимации — ничего. */
export function pulse(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject, amount = 1.05, duration = 700): void {
  if (!juiceOn()) return;
  scene.tweens.add({ targets: target, scale: amount, yoyo: true, repeat: -1, duration, ease: 'Sine.easeInOut' });
}

/** «Сердцебиение» красного значка: короткий подскок раз в пару секунд — заметно, но не мельтешит. */
export function heartbeat(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject): void {
  if (!juiceOn()) return;
  scene.tweens.add({ targets: target, scale: 1.18, yoyo: true, repeat: -1, duration: 150, repeatDelay: 1800, delay: 400, ease: 'Quad.easeOut' });
}

// ---------- полосы прогресса ----------

const bars = new Map<string, number>();

/**
 * С какой доли начинать полосу key (0…1): прошлое показанное значение, при первом показе за сессию — 0.
 * null — не анимировать (выключено или значение то же). Запоминает pct.
 */
export function barFrom(key: string, pct: number): number | null {
  const prev = bars.get(key);
  bars.set(key, pct);
  if (!juiceOn()) return null;
  const from = prev ?? 0;
  return Math.abs(from - pct) < 0.001 ? null : from;
}

// ---------- награды летят в валюту ----------

export interface Point {
  x: number;
  y: number;
}

interface PendingFly {
  scene: string;
  from: Point;
  gold: number;
  gems: number;
  burst: boolean;
}

let pending: PendingFly | null = null;

/**
 * Перед перезапуском экрана с наградой: откуда полетят монеты (from — в координатах поля) и сколько было
 * валюты до награды. Новый экземпляр сцены (screen → animateCurrency) покажет прежние числа, пустит монеты
 * в «таблетки» и отсчитает до нового значения. burst — вспышка искр в точке from (сундук).
 */
export function queueRewardFly(sceneKey: string, from: Point, before: { gold: number; gems: number }, opts: { burst?: boolean } = {}): void {
  pending = { scene: sceneKey, from, gold: before.gold, gems: before.gems, burst: !!opts.burst };
}

/**
 * Тост о полученной награде — после того как монеты долетели (иначе плашка под шапкой закрывает их полёт).
 * Без анимации — сразу.
 */
export function afterRewardFly(scene: Phaser.Scene, fn: () => void): void {
  if (!juiceOn()) fn();
  else scene.time.delayedCall(850, fn);
}

/** Забрать отложенный полёт наград для экрана sceneKey (один раз). */
export function takeRewardFly(sceneKey: string): PendingFly | null {
  const p = pending;
  if (!p) return null;
  pending = null;
  return p.scene === sceneKey ? p : null;
}

/** «Таблетка» валюты в шапке: её число, контейнер (для подскока) и где иконка (куда летят монеты). */
export interface CurrencyPill {
  kind: 'gold' | 'gems';
  value: number;
  text: Phaser.GameObjects.Text;
  box: Phaser.GameObjects.Container;
  icon: Point;
}

/** Последние показанные значения валют — чтобы заметить изменение между экранами (награда за бой и т. п.). */
let shown: { gold: number; gems: number } | null = null;

/**
 * После постройки шапки: если с прошлого экрана валюта изменилась — прежнее число отсчитывается до нового,
 * «таблетка» подпрыгивает; отложенная награда (queueRewardFly) ещё и прилетает монетами из точки получения.
 */
export function animateCurrency(scene: Phaser.Scene, pills: CurrencyPill[]): void {
  const fly = takeRewardFly(scene.scene.key);
  const now = { gold: 0, gems: 0 };
  for (const p of pills) now[p.kind] = p.value;
  const prev = fly ? { gold: fly.gold, gems: fly.gems } : shown;
  shown = now;
  if (!prev || !juiceOn()) return;
  if (fly?.burst) burst(scene, fly.from);
  for (const p of pills) {
    const from = prev[p.kind];
    if (from === p.value) continue;
    const settle = () => countUp(scene, p.text, from, p.value, formatNumber, { duration: 650, onDone: () => bump(scene, p.box, 1.12) });
    if (fly && p.value > from) {
      p.text.setText(formatNumber(from));
      flyCoins(scene, p.kind, fly.from, p.icon, () => {
        bump(scene, p.box, 1.18);
        settle();
      });
    } else {
      p.text.setText(formatNumber(from));
      scene.time.delayedCall(180, () => p.text.scene && settle());
    }
  }
}

/** Монетки (или гемы) разлетаются из точки from и слетаются к иконке валюты; onFirst — долетела первая. */
function flyCoins(scene: Phaser.Scene, kind: 'gold' | 'gems', from: Point, to: Point, onFirst: () => void): void {
  const n = kind === 'gold' ? 7 : 5;
  const art = kind === 'gold' ? 'ui_icon_gold' : 'ui_icon_gem';
  let first = true;
  for (let i = 0; i < n; i++) {
    const coin: Phaser.GameObjects.Image | Phaser.GameObjects.Arc = scene.textures.exists(art)
      ? scene.add.image(from.x, from.y, art).setDisplaySize(52, 52)
      : scene.add.circle(from.x, from.y, 22, kind === 'gold' ? TINT.gold : 0x6fd8ff).setStrokeStyle(3, 0x3a2412);
    coin.setDepth(FLY_DEPTH).setAlpha(0);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const r = 70 + Math.random() * 60;
    const sx = from.x + Math.cos(a) * r;
    const sy = from.y + Math.sin(a) * r * 0.7;
    const delay = i * 45;
    scene.tweens.add({
      targets: coin,
      x: sx,
      y: sy,
      alpha: 1,
      delay,
      duration: 200,
      ease: 'Back.easeOut',
      onComplete: () => {
        if (!coin.scene) return;
        scene.tweens.add({
          targets: coin,
          x: { value: to.x, ease: 'Sine.easeIn' },
          y: { value: to.y, ease: 'Cubic.easeIn' },
          scale: coin.scale * 0.7,
          duration: 420 + i * 25,
          onComplete: () => {
            coin.destroy();
            if (first) {
              first = false;
              onFirst();
            }
          },
        });
      },
    });
  }
}

/** Вспышка: расходящееся кольцо и искры из точки (сундук открыт). */
export function burst(scene: Phaser.Scene, at: Point): void {
  if (!juiceOn()) return;
  const ring = scene.add.circle(at.x, at.y, 40).setStrokeStyle(8, TINT.gold, 1).setDepth(FLY_DEPTH - 1);
  scene.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const spark = scene.add.rectangle(at.x, at.y, 10, 26, i % 2 ? 0xfff1b0 : TINT.gold).setRotation(a + Math.PI / 2).setDepth(FLY_DEPTH - 1);
    const r = 120 + (i % 3) * 30;
    scene.tweens.add({
      targets: spark,
      x: at.x + Math.cos(a) * r,
      y: at.y + Math.sin(a) * r,
      alpha: 0,
      scaleY: 0.3,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => spark.destroy(),
    });
  }
}
