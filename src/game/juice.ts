import type Phaser from 'phaser';
import { MOMENT_SFX, type SfxId } from './audioCatalog';
import { sfx } from './audio';
import { formatNumber } from './flow';
import { haptic, type HapticId } from './haptics';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { motion } from './state';
import { COLOR, COLOR_N, E, FAMILY, M, RARITY, S, T, Z } from './theme';

/**
 * «Сочность» меню в духе AFK Arena — дорого в моменты, тихо в рутине (docs/design/ui-polish-research.md, §3 п. 9–10,
 * §4.6). Все длительности — токены M (press 80, release 120, fast 140, base 220, slow 360, emphasis 600, count 900),
 * все кривые — токены E (out, in, inOut, pop). Своих чисел длительности здесь нет (tests/juice.test.ts проверяет).
 *
 * API (всё безопасно при «Уменьшить анимацию»: juiceOn() = false — сразу конечное состояние, колбэки зовутся):
 *
 * Рутина (локально, без тостов):
 * - juiceOn() — анимации включены (настройка «Уменьшить анимацию», state.motion).
 * - snapMs(ms) — ближайший токен M (старые вызовы со своими 380/450/700 мс «прилипают» к шкале).
 * - staggerIn(scene, key, rows) / collect(container, build) — «выезд» строк при первом открытии экрана за сессию,
 *   M.fast на строку, шаг ≤ 24 мс, весь список ≤ 250 мс; firstVisit(key).
 * - countUp(scene, text, from, to, fmt?, { duration = M.count, delay, onDone }) — отсчёт числа.
 * - bump(scene, target, 1.15) — подскок «таблетки»/числа за M.fast.
 * - barFrom(key, pct) — с какой доли доезжает полоса прогресса (ui.ts).
 *
 * Награды:
 * - rewardFly(scene, from, to, icons, { onFirst, onDone }) — иконки вылетают из точки (M.fast, разброс 40 мс)
 *   и летят в «таблетку» валюты (M.slow); первая долетела — «таблетка» подпрыгивает 1.15. REWARD_FLY_MS — сколько
 *   длится весь полёт (тост после него — afterRewardFly).
 * - queueRewardFly / takeRewardFly / animateCurrency — награда на одном экране, монеты — на следующем (screen.ts).
 * - burst(scene, at) — кольцо и искры (сундук открыт).
 *
 * Моменты (полноэкранно, со звуком и вибрацией, пропуск по тапу):
 * - moment(scene, kind, opts) → MomentHandle: 'victory' | 'summonRare' | 'ascend' | 'newChapter' | 'firstClear'.
 *   Затемнение (M.base) → заголовок 1.4 → 1 (M.slow, E.pop) + лучи и искры, вибрация heavy → пауза → уход (M.base).
 *   opts.keep — не уходить (экран сам строит награды поверх и зовёт close()); onSettled — заголовок встал
 *   (пора показывать награды по одной, M.fast шаг); onDone — момент закончен (кнопки экрана — после него).
 *   opts.depth — глубина слоёв (экран с keep передаёт низкую и строит всё своё поверх); opts.dimAfter — keep:
 *   затемнение после «встал» отступает. «Встал» и уход — по настоящему времени (realLater), не по часам сцены.
 *   Звук и вибрация по виду — MOMENTS (sound: false, если экран уже сыграл стингер сам).
 * - momentTimeline(kind, hold?) — расписание момента (чистая функция, для экранов и тестов).
 *
 * Декоративные бесконечные твины (пульс «Забрать», «сердцебиение» значков) — с мягким лимитом на сцену (§7):
 * - pulse(scene, target, amount?, period?) — через decorTween; heartbeat(scene, target) — один общий твин на сцену.
 * - decorTween(scene, cfg) — любой бесконечный декоративный твин: null, если на сцене уже DECOR_CAP таких
 *   (объект просто остаётся неподвижным); decorStats(scene) — сколько сейчас.
 *
 * Временные объекты (монеты, искры, слои момента) уничтожаются по окончании своего твина; твины сцены Phaser сам
 * снимает при её остановке. В onUpdate нет выделений памяти, кроме setText при смене отображаемого числа.
 */
export const juiceOn = (): boolean => !motion.reduced;

/** Шкала длительностей (по возрастанию) — для snapMs. */
const SCALE: readonly number[] = Object.values(M).sort((a, b) => a - b);

/** Ближайшая длительность из токенов M (при равенстве — меньшая: интерфейс скорее быстрый, чем вязкий). */
export function snapMs(ms: number): number {
  let best = SCALE[0];
  for (const v of SCALE) if (Math.abs(v - ms) < Math.abs(best - ms)) best = v;
  return best;
}

/** Глубина момента: над окнами и подтверждениями, под летящими наградами и тостами. */
export const MOMENT_DEPTH = Z.toast - 100;
/** Глубина летящих наград: над моментом (монеты летят поверх затемнения), под тостами. */
const FLY_DEPTH = Z.toast - 50;

// ---------- повторные открытия за сессию ----------

const seen = new Set<string>();

/** Первое открытие экрана/списка key за сессию (повторные открытия — без «выезда»). Отмечает key увиденным. */
export function firstVisit(key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

type Animatable = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Alpha;
type Scalable = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;

/** Весь список «выезжает» не дольше, мс (§4.6). */
export const STAGGER_TOTAL_MS = 250;
/** Шаг между строками, мс (§4.6: 24 мс/строка). */
export const STAGGER_STEP_MS = 24;

/**
 * Строки списка «выезжают» снизу и проявляются друг за другом: ≤ 250 мс на весь список. Только при первом
 * открытии экрана key за сессию и без «Уменьшить анимацию». groups — объекты каждой строки (по порядку).
 * Один счётчик-твин на строку.
 */
export function staggerIn(scene: Phaser.Scene, key: string, groups: Phaser.GameObjects.GameObject[][]): void {
  if (!groups.length || !juiceOn() || !firstVisit(key)) return;
  const rise = S.s;
  const step = Math.min(STAGGER_STEP_MS, (STAGGER_TOTAL_MS - M.fast) / groups.length);
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
        o.y = y[k] + rise * (1 - v);
      }
    };
    apply(0);
    scene.tweens.addCounter({ from: 0, to: 1, delay: i * step, duration: M.fast, ease: E.out, onUpdate: (tw) => apply(tw.getValue() ?? 1), onComplete: () => apply(1) });
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
 * Отсчёт числа в тексте от from до to (формат — fmt) за M.count (своя длительность прилипает к шкале — snapMs).
 * Без анимации — сразу to. onDone — когда показано конечное значение.
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
    duration: opts.duration === undefined ? M.count : snapMs(opts.duration),
    delay: opts.delay ?? 0,
    ease: E.out,
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

/** «Таблетка» валюты подпрыгивает на столько (§4.6). */
export const BUMP = 1.15;

/** Короткий «подскок» (масштаб туда-обратно за M.fast) — число или значок изменились. */
export function bump(scene: Phaser.Scene, target: Scalable, amount = BUMP): void {
  if (!juiceOn() || !target.scene) return;
  const base = (target.getData('bumpBase') as number | undefined) ?? target.scaleX;
  target.setData('bumpBase', base);
  scene.tweens.killTweensOf(target);
  target.setScale(base);
  scene.tweens.add({ targets: target, scale: base * amount, duration: M.fast / 2, yoyo: true, ease: E.out, onComplete: () => target.scene && target.setScale(base) });
}

// ---------- декоративные бесконечные твины: мягкий лимит на сцену (§7) ----------

/** Сколько бесконечных декоративных твинов может жить на одной сцене (пульсы, сияния). Остальные — неподвижны. */
export const DECOR_CAP = 12;
/** Сколько значков бьются общим «сердцебиением» на сцене. */
export const HEARTBEAT_CAP = 16;
/** Пауза между «ударами» значка: два M.count — заметно, но не мельтешит. */
const HEARTBEAT_REST = 2 * M.count;
const HEARTBEAT_AMOUNT = 0.18;

interface Beat {
  target: Scalable;
  base: number;
}
interface DecorState {
  tweens: Set<Phaser.Tweens.Tween>;
  beats: Beat[];
  beat: Phaser.Tweens.Tween | null;
}

const decorBy = new WeakMap<Phaser.Scene, DecorState>();

/** Учёт декоративных твинов сцены; сцена остановлена (или перезапущена тем же экземпляром) — учёт заново. */
function decorOf(scene: Phaser.Scene): DecorState {
  let st = decorBy.get(scene);
  if (!st) {
    st = { tweens: new Set(), beats: [], beat: null };
    decorBy.set(scene, st);
    scene.events?.once?.('shutdown', () => decorBy.delete(scene));
  }
  return st;
}

const alive = (o: unknown): boolean => !!(o as { scene?: unknown } | null)?.scene;

/** Убрать из учёта законченные твины и твины уничтоженных объектов (их же и остановить). */
function pruneDecor(st: DecorState): void {
  for (const tw of st.tweens) {
    if (tw.isDestroyed?.() || tw.isFinished?.()) st.tweens.delete(tw);
    else if (!(tw.targets as unknown[]).some(alive)) {
      tw.stop?.();
      st.tweens.delete(tw);
    }
  }
}

/**
 * Бесконечный декоративный твин (repeat: -1) с мягким лимитом DECOR_CAP на сцену: сверх лимита — null, объект
 * просто остаётся неподвижным. Без анимации — null. Твин — обычный твин объекта (pressFeedback ставит его на паузу).
 */
export function decorTween(scene: Phaser.Scene, cfg: Phaser.Types.Tweens.TweenBuilderConfig): Phaser.Tweens.Tween | null {
  if (!juiceOn()) return null;
  const st = decorOf(scene);
  pruneDecor(st);
  if (st.tweens.size + (st.beat ? 1 : 0) >= DECOR_CAP) return null;
  const tw = scene.tweens.add(cfg);
  st.tweens.add(tw);
  return tw;
}

/** Сколько декоративных твинов и «сердцебиений» живёт на сцене (для perf-замеров и тестов). */
export function decorStats(scene: Phaser.Scene): { tweens: number; beats: number } {
  const st = decorBy.get(scene);
  if (!st) return { tweens: 0, beats: 0 };
  pruneDecor(st);
  st.beats = st.beats.filter((b) => alive(b.target));
  return { tweens: st.tweens.size + (st.beat ? 1 : 0), beats: st.beats.length };
}

/** Готово к получению: мягкий бесконечный пульс (кнопка «Забрать», порог наград). Период прилипает к шкале M. */
export function pulse(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject, amount = 1.05, period: number = M.emphasis): void {
  decorTween(scene, { targets: target, scale: amount, yoyo: true, repeat: -1, duration: snapMs(period), ease: E.inOut });
}

/**
 * «Сердцебиение» красного значка: короткий подскок раз в пару секунд. Все значки сцены бьются одним общим
 * твином-счётчиком (§7: один твин вместо десятка), не больше HEARTBEAT_CAP значков.
 */
export function heartbeat(scene: Phaser.Scene, target: Scalable): void {
  if (!juiceOn() || !target.scene) return;
  const st = decorOf(scene);
  st.beats = st.beats.filter((b) => alive(b.target));
  if (st.beats.length >= HEARTBEAT_CAP || st.beats.some((b) => b.target === target)) return;
  st.beats.push({ target, base: target.scaleX });
  if (st.beat && !st.beat.isDestroyed?.()) return;
  st.beat = scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: M.fast,
    yoyo: true,
    repeat: -1,
    repeatDelay: HEARTBEAT_REST,
    delay: M.slow,
    ease: E.out,
    onUpdate: (tw) => {
      const k = 1 + HEARTBEAT_AMOUNT * (tw.getValue() ?? 0);
      for (let i = 0; i < st.beats.length; i++) {
        const b = st.beats[i];
        if (b.target.scene) b.target.setScale(b.base * k);
      }
    },
  });
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

/** Иконка летящей награды: текстура, масштаб (или размер), оттенок. */
export interface FlyIcon {
  key: string;
  scale?: number;
  size?: number;
  tint?: number;
}

/** Куда летят награды: точка иконки валюты и (необязательно) «таблетка», которая подпрыгнет. */
export interface FlyTarget extends Point {
  box?: Scalable;
}

/** Разброс вылета иконок, мс (§4.6). */
const FLY_SPREAD_MS = 40;
/** Иконок за раз не больше (дальше — шум, а не награда). */
const FLY_MAX = 8;
/** Весь полёт наград (вылет M.fast + полёт M.slow + разброс), мс: тост о награде — после него. */
export const REWARD_FLY_MS = M.fast + M.slow + FLY_SPREAD_MS * (FLY_MAX - 1);

/**
 * Иконки награды вылетают из точки from веером (M.fast, E.out, разброс 40 мс) и летят к to (M.slow, E.in).
 * Первая долетела — to.box подпрыгивает (BUMP) и зовётся onFirst; все долетели — onDone; каждая — onEach(i)
 * (звон монеты). icons — текстуры (повторяются по кругу до n) или одна текстура и n. Без анимации — сразу
 * onFirst и onDone, объектов нет.
 */
export function rewardFly(
  scene: Phaser.Scene,
  from: Point,
  to: FlyTarget,
  icons: FlyIcon[] | FlyIcon,
  opts: { n?: number; onFirst?: () => void; onEach?: (i: number) => void; onDone?: () => void } = {},
): void {
  const list = Array.isArray(icons) ? icons : [icons];
  const n = Math.min(FLY_MAX, opts.n ?? list.length);
  if (!juiceOn() || !n || !list.length) {
    opts.onFirst?.();
    opts.onDone?.();
    return;
  }
  let landed = 0;
  for (let i = 0; i < n; i++) {
    const ic = list[i % list.length];
    const img = scene.add.image(from.x, from.y, ic.key).setDepth(FLY_DEPTH).setAlpha(0);
    if (ic.size) img.setDisplaySize(ic.size, ic.size);
    else img.setScale(ic.scale ?? 1);
    if (ic.tint !== undefined) img.setTint(ic.tint);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const r = 70 + Math.random() * 60;
    scene.tweens.add({
      targets: img,
      x: from.x + Math.cos(a) * r,
      y: from.y + Math.sin(a) * r * 0.7,
      alpha: 1,
      delay: i * FLY_SPREAD_MS,
      duration: M.fast,
      ease: E.out,
      onComplete: () => {
        if (!img.scene) return;
        scene.tweens.add({
          targets: img,
          x: to.x,
          y: to.y,
          scale: img.scale * 0.7,
          duration: M.slow,
          ease: E.in,
          onComplete: () => {
            img.destroy();
            landed++;
            opts.onEach?.(i);
            if (landed === 1) {
              if (to.box) bump(scene, to.box, BUMP);
              opts.onFirst?.();
            }
            if (landed === n) opts.onDone?.();
          },
        });
      },
    });
  }
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
  // Звук — в момент нажатия «Забрать» (монеты прилетят уже на новом экране и звякнут каждая своим звуком).
  sfx(opts.burst ? 'chest_open' : 'claim');
  haptic('reward');
}

/**
 * Тост о полученной награде — после того как монеты долетели (иначе плашка под шапкой закрывает их полёт).
 * Без анимации — сразу.
 */
export function afterRewardFly(scene: Phaser.Scene, fn: () => void): void {
  if (!juiceOn()) fn();
  else scene.time.delayedCall(REWARD_FLY_MS, fn);
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

/** Иконка валюты для полёта: RO-иконка (как в шапке), иначе запасная. */
function currencyIcon(scene: Phaser.Scene, kind: 'gold' | 'gems'): FlyIcon {
  const ro = kind === 'gold' ? 'item_gold' : 'item_gems';
  if (scene.textures.exists(ro)) return kind === 'gold' ? { key: ro, scale: 2 } : { key: ro, scale: 3, tint: COLOR_N.gem };
  return { key: kind === 'gold' ? 'ui_icon_gold' : 'ui_icon_gem', size: 52 };
}

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
    const settle = () => countUp(scene, p.text, from, p.value, formatNumber, { onDone: () => bump(scene, p.box) });
    p.text.setText(formatNumber(from));
    if (fly && p.value > from) {
      rewardFly(scene, fly.from, { ...p.icon, box: p.box }, currencyIcon(scene, p.kind), {
        n: p.kind === 'gold' ? 7 : 5,
        onEach: () => sfx(p.kind === 'gold' ? 'coin' : 'gem'),
        onFirst: settle,
      });
    } else {
      scene.time.delayedCall(M.base, () => p.text.scene && settle());
    }
  }
}

/** Вспышка: расходящееся кольцо и искры из точки (сундук открыт). */
export function burst(scene: Phaser.Scene, at: Point): void {
  if (!juiceOn()) return;
  const ring = scene.add.circle(at.x, at.y, 40).setStrokeStyle(8, COLOR_N.gold, 1).setDepth(FLY_DEPTH - 1);
  scene.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: M.slow, ease: E.out, onComplete: () => ring.destroy() });
  sparks(scene, at, 12, COLOR_N.gold, FLY_DEPTH - 1, 120);
}

/** n искр-лучиков разлетаются из точки и гаснут (M.slow). */
function sparks(scene: Phaser.Scene, at: Point, n: number, tint: number, depth: number, radius: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const spark = scene.add.rectangle(at.x, at.y, 10, 26, i % 2 ? 0xfff1b0 : tint).setRotation(a + Math.PI / 2).setDepth(depth);
    const r = radius + (i % 3) * 30;
    scene.tweens.add({
      targets: spark,
      x: at.x + Math.cos(a) * r,
      y: at.y + Math.sin(a) * r,
      alpha: 0,
      scaleY: 0.3,
      duration: M.slow,
      ease: E.out,
      onComplete: () => spark.destroy(),
    });
  }
}

// ---------- моменты ----------

export type MomentKind = 'victory' | 'summonRare' | 'ascend' | 'newChapter' | 'firstClear';

export interface MomentDef {
  /** Заголовок по умолчанию (экран может передать свой). */
  title: string;
  /** Стингер момента (null — звук играет сам экран). */
  sfx: SfxId | null;
  /** Вибрация (таблица HAPTICS в haptics.ts). */
  haptic: HapticId;
  /** Цвет заголовка и лучей (строка #rrggbb). */
  color: string;
}

/**
 * Моменты (§3 п. 10): звук и вибрация — здесь, в одном месте. Звуки «новой главы» и «первой победы» — MOMENT_SFX
 * (audioCatalog.ts: пока готовые звуки каталога, свои файлы — заменой там).
 */
export const MOMENTS: Record<MomentKind, MomentDef> = {
  victory: { title: 'ПОБЕДА', sfx: 'victory', haptic: 'victory', color: COLOR.title },
  summonRare: { title: 'Редкий герой!', sfx: 'summon_epic', haptic: 'cardRare', color: RARITY.purple },
  ascend: { title: 'Вознесение!', sfx: 'rarity_up', haptic: 'moment', color: COLOR.title },
  newChapter: { title: 'Новая глава', sfx: MOMENT_SFX.moment_chapter, haptic: 'moment', color: COLOR.title },
  firstClear: { title: 'Первая победа!', sfx: MOMENT_SFX.moment_first_clear, haptic: 'moment', color: COLOR.positive },
};

/** Расписание момента, мс от старта. */
export interface MomentTimeline {
  /** Затемнение 0 → DIM за dim. */
  dim: number;
  /** Заголовок появляется (1.4 → 1, E.pop) с titleAt за title; в этот же миг — вибрация, лучи и искры. */
  titleAt: number;
  title: number;
  /** Заголовок встал: можно показывать награды (onSettled). */
  settled: number;
  /** Начало ухода (если не keep) и его длительность. */
  closeAt: number;
  out: number;
  /** Конец момента (onDone). */
  end: number;
}

/** Затемнение момента (§4.6: модалка 0.65). */
export const MOMENT_DIM = 0.65;
/** Яркость лучей за заголовком (сложение цветов: ярче — «засвечивает» экран). */
const MOMENT_RAYS = 0.3;
/** Заголовок момента «падает» с такого масштаба. */
export const MOMENT_TITLE_FROM = 1.4;
/** Лучи момента делают оборот за столько мс (скорость вращения, не длительность анимации интерфейса). */
const RAY_TURN_MS = 40000;

/** Расписание момента kind; hold — сколько держать вставший заголовок до ухода (по умолчанию M.count). */
export function momentTimeline(kind: MomentKind, hold: number = M.count): MomentTimeline {
  // Редкий призыв: затемнение медленнее (фон «гаснет» перед картой) — §4.6.
  const dim = kind === 'summonRare' ? M.slow : M.base;
  const titleAt = dim;
  const title = M.slow;
  const settled = titleAt + title;
  const closeAt = settled + hold;
  const out = M.base;
  return { dim, titleAt, title, settled, closeAt, out, end: closeAt + out };
}

export interface MomentOpts {
  /** Заголовок (по умолчанию MOMENTS[kind].title). */
  title?: string;
  /** Строка под заголовком (имя героя, «Глава 3. Пайон»). */
  subtitle?: string;
  /** Картинка вместо текста заголовка (плашка «Победа» из скина) и её ширина. */
  image?: string;
  imageWidth?: number;
  /** Цвет заголовка и лучей (#rrggbb; редкость призыва — RARITY.purple/gold/red). */
  color?: string;
  /** Центр заголовка (по умолчанию — верхняя треть поля). */
  at?: Point;
  /** Держать вставший заголовок, мс (по умолчанию M.count); не действует при keep. */
  hold?: number;
  /** Не уходить самому: экран строит награды поверх (глубина > depth + 2) и сам зовёт close(). При «Уменьшить
   *  анимацию» keep рисует конечное состояние (затемнение, заголовок) без движения — экрану не нужен свой запасной. */
  keep?: boolean;
  /** Глубина нижнего слоя (затемнение; лучи +1, заголовок +2). По умолчанию MOMENT_DEPTH — над окнами и листами.
   *  Экран с keep, который строит своё содержимое поверх, передаёт низкую (1): окна, сюжет, подсказки — над моментом. */
  depth?: number;
  /** keep: после того как заголовок встал, затемнение отступает до этой яркости (M.slow) — проступает арт экрана. */
  dimAfter?: number;
  /** false — без стингера (экран уже сыграл свой). Вибрация — всегда (её повтор гасит зазор haptics.ts). */
  sound?: boolean;
  /** Заголовок встал (или пропуск тапом): пора показывать награды по одной. */
  onSettled?: () => void;
  /** Момент закончен (ушёл, пропущен или keep и встал): пора показывать кнопки. */
  onDone?: () => void;
}

export interface MomentHandle {
  /** Пропустить: не встал — сразу конечное состояние; встал — уйти (keep — остаться). */
  skip(): void;
  /** Уйти (M.fast, E.in) и убрать слои. */
  close(): void;
  readonly settled: boolean;
  readonly closed: boolean;
}


/** Часы моментов: настоящее время (не часы сцены — на медленных кадрах Phaser урезает шаг, и «встал» отставал до 4 с). */
export const realNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Отложенный вызов по настоящему времени: проверяется на каждом кадре сцены (postupdate), так что колбэк не
 * переживёт сцену. remove() — отменить.
 */
export function realLater(scene: Phaser.Scene, ms: number, fn: () => void): { remove(): void } {
  const due = realNow() + ms;
  let done = false;
  const off = () => {
    if (done) return;
    done = true;
    scene.events.off('postupdate', tick);
    scene.events.off('shutdown', off);
  };
  function tick(): void {
    if (realNow() < due) return;
    off();
    fn();
  }
  scene.events.on('postupdate', tick);
  scene.events.once('shutdown', off);
  return { remove: off };
}

/**
 * Полноэкранный момент: затемнение → заголовок 1.4 → 1 (E.pop) → лучи и искры → вибрация → пауза → уход.
 * Тап по затемнению — пропуск (ввод под ним закрыт, пока момент виден, — случайно нажать кнопку нельзя).
 * Без анимации — только звук и вибрация, колбэки сразу (keep — ещё и неподвижное конечное состояние).
 * «Встал» и «уход» — по настоящему времени (realLater): твины, отставшие на медленных кадрах, доводятся сразу.
 */
export function moment(scene: Phaser.Scene, kind: MomentKind, opts: MomentOpts = {}): MomentHandle {
  const def = MOMENTS[kind];
  const tl = momentTimeline(kind, opts.hold);
  const keep = !!opts.keep;
  if (opts.sound !== false && def.sfx) sfx(def.sfx);
  let settledFired = false;
  let doneFired = false;
  const fireSettled = () => {
    if (settledFired) return;
    settledFired = true;
    opts.onSettled?.();
  };
  const fireDone = () => {
    if (doneFired) return;
    doneFired = true;
    opts.onDone?.();
  };
  const state = { settled: false, closed: false };
  const handle = (skip: () => void, close: () => void): MomentHandle => ({
    skip,
    close,
    get settled() {
      return state.settled;
    },
    get closed() {
      return state.closed;
    },
  });

  const animate = juiceOn();
  if (!animate && !keep) {
    haptic(def.haptic);
    state.settled = true;
    state.closed = true;
    fireSettled();
    fireDone();
    return handle(
      () => undefined,
      () => undefined,
    );
  }

  const at = opts.at ?? { x: GAME_W / 2, y: GAME_H * 0.36 };
  const color = opts.color ?? def.color;
  const tint = parseInt(color.slice(1, 7), 16);
  const D = opts.depth ?? MOMENT_DEPTH;
  const dim = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, COLOR_N.bg, 1).setAlpha(0).setDepth(D).setInteractive();
  const rays: Phaser.GameObjects.Image | null =
    animate && scene.textures.exists('skin_rays')
      ? scene.add.image(at.x, at.y, 'skin_rays').setDisplaySize(GAME_W, GAME_W).setTint(tint).setBlendMode('ADD').setAlpha(0).setDepth(D + 1)
      : null;
  const raysScale = rays?.scaleX ?? 1;
  const isImage = !!opts.image && scene.textures.exists(opts.image);
  const title: Phaser.GameObjects.Image | Phaser.GameObjects.Text =
    isImage && opts.image
      ? scene.add.image(at.x, at.y, opts.image)
      : scene.add
          .text(at.x, at.y, opts.title ?? def.title, {
            fontFamily: FAMILY.heading,
            fontSize: `${T.display}px`,
            fontStyle: 'bold',
            color,
            stroke: COLOR.onAccent,
            strokeThickness: 10,
            align: 'center',
          })
          .setShadow(0, 6, '#000000', 14, true, true);
  title.setOrigin(0.5).setDepth(D + 2);
  if (isImage && opts.imageWidth) {
    const img = title as Phaser.GameObjects.Image;
    img.setDisplaySize(opts.imageWidth, (opts.imageWidth * img.height) / Math.max(1, img.width));
  } else if (!isImage && title.width > GAME_W - 2 * S.l) {
    // Длинный заголовок («Глава 10 пройдена!») — ужать по ширине поля, не обрезать.
    title.setScale((GAME_W - 2 * S.l) / title.width);
  }
  const titleScale = title.scaleX;
  const sub = opts.subtitle
    ? scene.add
        .text(at.x, at.y + T.display * 0.5 + S.m, opts.subtitle, { fontFamily: FAMILY.body, fontSize: `${T.heading}px`, color: COLOR.textPrimary, align: 'center' })
        .setOrigin(0.5, 0)
        .setShadow(0, 3, '#000000', 8, true, true)
        .setAlpha(0)
        .setDepth(D + 2)
    : null;
  const layers: Phaser.GameObjects.GameObject[] = [dim, title];
  if (rays) layers.push(rays);
  if (sub) layers.push(sub);
  const timers: { remove(): void }[] = [];
  const later = (ms: number, fn: () => void) => timers.push(realLater(scene, ms, () => dim.scene && fn()));
  /** Затемнение, на котором keep остаётся (dimAfter — отступает, проступает арт экрана). */
  const restDim = keep && opts.dimAfter !== undefined ? opts.dimAfter : MOMENT_DIM;

  function close(): void {
    if (state.closed) return;
    state.closed = true;
    for (const t of timers) t.remove();
    if (!dim.scene) {
      fireSettled();
      fireDone();
      return;
    }
    dim.disableInteractive();
    scene.tweens.killTweensOf(layers);
    if (animate) {
      scene.tweens.add({
        targets: layers,
        alpha: 0,
        duration: state.settled ? tl.out : M.fast,
        ease: E.in,
        onComplete: () => {
          for (const o of layers) o.destroy();
        },
      });
    } else for (const o of layers) o.destroy();
    fireSettled();
    fireDone();
  }

  if (!animate) {
    // keep без анимации: сразу конечное состояние, ввод — экрану.
    dim.setAlpha(restDim).disableInteractive();
    title.setAlpha(1);
    sub?.setAlpha(1);
    haptic(def.haptic);
    state.settled = true;
    fireSettled();
    fireDone();
    return handle(() => undefined, close);
  }

  title.setScale(titleScale * MOMENT_TITLE_FROM).setAlpha(0);
  let hapticDone = false;
  const pop = () => {
    if (!hapticDone) {
      hapticDone = true;
      haptic(def.haptic);
    }
  };
  const spinRays = () => {
    if (rays) scene.tweens.add({ targets: rays, angle: 360, duration: RAY_TURN_MS, repeat: -1 });
  };
  const settle = () => {
    if (state.settled || state.closed) return;
    state.settled = true;
    // Часы сцены могли отстать от настоящего времени — довести затемнение и заголовок (лучи докрутятся сами).
    scene.tweens.killTweensOf(sub ? [dim, title, sub] : [dim, title]);
    dim.setAlpha(MOMENT_DIM);
    title.setScale(titleScale).setAlpha(1);
    sub?.setAlpha(1);
    pop();
    fireSettled();
    if (keep) {
      // Остаётся фоном: ввод — экрану (награды и кнопки поверх).
      dim.disableInteractive();
      if (restDim !== MOMENT_DIM) scene.tweens.add({ targets: dim, alpha: restDim, duration: M.slow, ease: E.out });
      fireDone();
    } else later(tl.closeAt - tl.settled, close);
  };
  const skip = () => {
    if (state.closed) return;
    if (!state.settled) {
      for (const t of timers) t.remove();
      timers.length = 0;
      if (rays) {
        scene.tweens.killTweensOf(rays);
        rays.setScale(raysScale).setAlpha(MOMENT_RAYS);
        spinRays();
      }
      settle();
      if (!keep) close();
    } else if (!keep) close();
  };
  dim.on('pointerdown', skip);

  // Хореография (§4.6).
  scene.tweens.add({ targets: dim, alpha: MOMENT_DIM, duration: tl.dim, ease: E.out });
  scene.tweens.add({ targets: title, scale: titleScale, alpha: 1, delay: tl.titleAt, duration: tl.title, ease: E.pop });
  if (sub) scene.tweens.add({ targets: sub, alpha: 1, delay: tl.titleAt + M.fast, duration: M.base, ease: E.out });
  if (rays) {
    rays.setScale(raysScale * 0.6);
    scene.tweens.add({ targets: rays, alpha: MOMENT_RAYS, scale: raysScale, delay: tl.titleAt, duration: tl.title, ease: E.out });
    spinRays();
  }
  later(tl.titleAt, () => {
    pop();
    sparks(scene, at, 14, tint, D + 1, 220);
  });
  later(tl.settled, settle);

  return handle(skip, close);
}
