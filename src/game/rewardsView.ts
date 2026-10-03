import Phaser from 'phaser';
import type { CardRarity, EventRewardEvent, RewardBundle } from '../core';
import { hasArt } from './assets';
import { GAME } from './content';
import { formatNumber } from './flow';
import { gemIcon } from './screen';
import { SKIN_TINT, skinIcon } from './skin';
import { C, E, FS, M, OUTLINE } from './theme';
import { juiceOn } from './juice';
import { icon, text } from './ui';
import { heroCardIcon, rarityName } from './heroCard';
import { roIconImage } from './itemIcons';

/**
 * Награды событий и писем (RewardBundle, src/core/events): строки «иконка + число» для плиток и текст для тостов.
 * Используют EventsScene и MailScene; ниже — награды итога боя чипами, плитки «как стать сильнее» и Reveal
 * («по одной», §4.6) для ResultScene и ChapterDoneScene.
 */

export interface RewardItem {
  kind: 'gold' | 'gems' | 'scrolls' | 'exp' | 'hero' | 'heroCard' | 'heroPick';
  amount: number;
  /** Редкость карты героя / контракта; у 'hero' — герой (templateId) для мини-иконки. */
  rarity?: CardRarity;
  templateId?: string;
  /** Подпись для тоста: «1 000 золота», «Сейрен Виндзор». */
  label: string;
  /** Короткая подпись рядом с иконкой: «1 000», «Сейрен». */
  short: string;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «Синяя карта героя» и т. п. — по редкости. */
const CARD_ADJ: Record<CardRarity, [string, string, string]> = {
  green: ['зелёная', 'зелёные', 'зелёных'],
  blue: ['синяя', 'синие', 'синих'],
  purple: ['фиолетовая', 'фиолетовые', 'фиолетовых'],
  gold: ['золотая', 'золотые', 'золотых'],
  red: ['красная', 'красные', 'красных'],
};

/** «2 синие карты героя». */
export function heroCardsLabel(rarity: CardRarity, n: number): string {
  const adj = CARD_ADJ[rarity];
  return `${n} ${plural(n, adj[0], adj[1], adj[2])} ${plural(n, 'карта', 'карты', 'карт')} героя`;
}

/** Награда по строкам (порядок: контракты, герои, карты героя, свитки, гемы, золото, опыт). */
export function rewardItems(r: RewardBundle): RewardItem[] {
  const out: RewardItem[] = [];
  for (const p of r.heroPicks ?? []) {
    out.push({ kind: 'heroPick', amount: 1, rarity: p.rarity, label: `«Контракт героя» — ${rarityName(p.rarity).toLowerCase()} герой на выбор`, short: 'Контракт' });
  }
  for (const id of r.heroes ?? []) {
    const t = GAME.content.heroes[id];
    const name = t?.name ?? id;
    out.push({ kind: 'hero', amount: 1, templateId: id, rarity: t?.baseRarity ?? 'green', label: `карточка «${name}»`, short: name.split(' ')[0] });
  }
  for (const rarity of ['purple', 'blue'] as const) {
    const v = r.heroCards?.[rarity] ?? 0;
    const n = Math.floor(v);
    if (n > 0) out.push({ kind: 'heroCard', amount: n, rarity, label: heroCardsLabel(rarity, n), short: `×${n}` });
    else if (v > 0) {
      const pct = `${String(Math.round(v * 1000) / 10).replace('.', ',')}%`;
      out.push({ kind: 'heroCard', amount: v, rarity, label: `${CARD_ADJ[rarity][0]} карта героя (шанс ${pct})`, short: pct });
    }
  }
  if (r.scrolls) out.push({ kind: 'scrolls', amount: r.scrolls, label: `${r.scrolls} ${plural(r.scrolls, 'свиток', 'свитка', 'свитков')} призыва`, short: `×${r.scrolls}` });
  if (r.gems) out.push({ kind: 'gems', amount: r.gems, label: `${formatNumber(r.gems)} ${plural(r.gems, 'гем', 'гема', 'гемов')}`, short: formatNumber(r.gems) });
  if (r.gold) out.push({ kind: 'gold', amount: r.gold, label: `${formatNumber(r.gold)} золота`, short: formatNumber(r.gold) });
  if (r.jobExp) out.push({ kind: 'exp', amount: r.jobExp, label: `${formatNumber(r.jobExp)} опыта в запас`, short: formatNumber(r.jobExp) });
  return out;
}

/** «1 000 золота, 50 гемов, карточка «Сейрен»» — для тостов. */
export function rewardText(r: RewardBundle): string {
  return rewardItems(r).map((i) => i.label).join(', ') || 'ничего';
}

/** Итоги получения: награда одной строкой и новые карточки отдельными строками (крупные — первыми). */
export function rewardToast(title: string, r: RewardBundle, events: readonly EventRewardEvent[]): string {
  const lines: string[] = [];
  for (const e of events) {
    if (e.type === 'heroPick') lines.push(`«Контракт героя»: ${rarityName(e.rarity).toLowerCase()} герой на выбор — выберите в «Героях»!`);
    if (e.type === 'heroCard') lines.push(`Карта героя: ${e.name} (${CARD_ADJ[e.rarity][0]}) — копия для вознесения`);
  }
  const rest = rewardItems({ ...r, heroes: [], heroPicks: [], heroCards: {} }).map((i) => i.label).join(', ');
  return [...lines, rest ? `${title}: ${rest}` : title].join('\n');
}

/** Иконка RO вида награды (src/game/itemIcons.ts, assets/ui/icons/item_<id>.png). */
const RO_REWARD_ICON: Partial<Record<RewardItem['kind'], string>> = { gold: 'gold', gems: 'gems', scrolls: 'scrolls', exp: 'hero_exp' };

/** Иконка вида награды (size — высота). Карты героя и контракт — мини-карта в рамке редкости (item — редкость, герой). */
export function rewardIcon(scene: Phaser.Scene, x: number, y: number, kind: RewardItem['kind'], size: number, dim = false, item?: Pick<RewardItem, 'rarity' | 'templateId'>): Phaser.GameObjects.GameObject {
  const tint = dim ? SKIN_TINT.creamDim : undefined;
  if (kind === 'heroCard' || kind === 'heroPick' || (kind === 'hero' && item?.templateId)) {
    return heroCardIcon(scene, x, y, size * 1.2, item?.rarity ?? 'blue', kind === 'hero' ? item?.templateId : undefined, { dim, pick: kind === 'heroPick' });
  }
  // Иконки RO (Bag of Gold Coins, 1carat Diamond, Worn Out Scroll, Battle Manual) — целым масштабом, без tint.
  const ro = roIconImage(scene, x, y, RO_REWARD_ICON[kind] ?? '', size);
  if (ro) return dim ? ro.setAlpha(0.55) : ro;
  if (kind === 'gold') {
    if (hasArt('ui_icon_gold')) return scene.add.image(x, y, 'ui_icon_gold').setDisplaySize(size, size).setAlpha(dim ? 0.6 : 1);
    return icon(scene, x, y, 'iconCircle_beige', size * 0.8).setTint(0xffc83a);
  }
  if (kind === 'gems') {
    if (hasArt('ui_icon_gem')) return scene.add.image(x, y, 'ui_icon_gem').setDisplaySize(size, size).setAlpha(dim ? 0.6 : 1);
    return gemIcon(scene, x, y, size * 0.75);
  }
  const name = kind === 'scrolls' ? 'scroll' : kind === 'exp' ? 'star' : 'helmet';
  const color = kind === 'scrolls' ? 0xf0d9a0 : kind === 'exp' ? 0x9fe0a6 : 0xd890ff;
  return scene.add.image(x, y, skinIcon(name)).setDisplaySize(size, size).setTint(tint ?? color);
}

/**
 * Столбик наград «иконка + число» с центром по x, первая строка — на y; шаг строки — step.
 * Возвращает созданные объекты (для контейнера или ScrollArea).
 */
export function rewardColumn(
  scene: Phaser.Scene,
  x: number,
  y: number,
  r: RewardBundle,
  opts: { size?: number; step?: number; font?: number; dim?: boolean; skipHeroes?: boolean } = {},
): Phaser.GameObjects.GameObject[] {
  const size = opts.size ?? 44;
  const step = opts.step ?? size + 10;
  const out: Phaser.GameObjects.GameObject[] = [];
  const items = rewardItems(r).filter((i) => !(opts.skipHeroes && i.kind === 'hero'));
  items.forEach((it, i) => {
    const t = text(scene, 0, y + i * step, it.short, opts.font ?? FS.small, opts.dim ? C.disabled : it.kind === 'gems' ? C.gem : it.kind === 'gold' ? C.gold : C.text, {
      fontStyle: 'bold',
      ...OUTLINE,
    }).setOrigin(0, 0.5);
    const total = size + 8 + t.width;
    const left = x - total / 2;
    t.setX(left + size + 8);
    out.push(rewardIcon(scene, left + size / 2, y + i * step, it.kind, size, opts.dim, it), t);
  });
  return out;
}

/** Строка наград слева направо от x (центр по y); возвращает объекты и ширину. */
export function rewardRow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  r: RewardBundle,
  opts: { size?: number; font?: number; gap?: number; dim?: boolean } = {},
): { objects: Phaser.GameObjects.GameObject[]; width: number } {
  const size = opts.size ?? 40;
  const gap = opts.gap ?? 26;
  const out: Phaser.GameObjects.GameObject[] = [];
  let cx = x;
  for (const it of rewardItems(r)) {
    out.push(rewardIcon(scene, cx + size / 2, y, it.kind, size, opts.dim, it));
    const t = text(scene, cx + size + 6, y, it.short, opts.font ?? FS.small, opts.dim ? C.disabled : it.kind === 'gems' ? C.gem : it.kind === 'gold' ? C.gold : C.text, {
      fontStyle: 'bold',
      ...OUTLINE,
    }).setOrigin(0, 0.5);
    out.push(t);
    cx += size + 6 + t.width + gap;
  }
  return { objects: out, width: Math.max(0, cx - gap - x) };
}

// ---------- итог боя: награда чипами (ResultScene) ----------

/** Одна награда итога боя — по порядку появления на экране «ПОБЕДА» (чип rewardRow из ui.ts). */
export type BattleReward =
  | { kind: 'gold' | 'exp' | 'gems'; amount: number }
  | { kind: 'item'; itemId: string }
  | { kind: 'heroCard'; templateId: string; rarity: CardRarity; name: string }
  | { kind: 'ore'; amount: number };

/** Событие итога, из которого берутся награды (StageOutcome / TowerOutcome events; прочие поля не нужны). */
type RewardEvent = { type: string; gold?: number; heroExp?: number; amount?: number; count?: number; templateId?: string; rarity?: CardRarity; name?: string };

/**
 * Награды боя по порядку (§4.6: «награды по одной»): золото, опыт в запас, гемы, трофеи, карты героев, руда.
 * Нулевые не попадают. Чистая функция (tests/rewards-view.test.ts).
 */
export function battleRewards(events: readonly RewardEvent[], drops: readonly { itemId: string }[] = []): BattleReward[] {
  const out: BattleReward[] = [];
  let gold = 0;
  let exp = 0;
  let gems = 0;
  let ore = 0;
  for (const e of events) {
    if (e.type === 'rewards') {
      gold += e.gold ?? 0;
      exp += e.heroExp ?? 0;
    } else if (e.type === 'gems') gems += e.amount ?? 0;
    else if (e.type === 'blessedOre') ore += e.count ?? 0;
  }
  if (gold > 0) out.push({ kind: 'gold', amount: gold });
  if (exp > 0) out.push({ kind: 'exp', amount: exp });
  if (gems > 0) out.push({ kind: 'gems', amount: gems });
  for (const d of drops) out.push({ kind: 'item', itemId: d.itemId });
  for (const e of events) {
    if (e.type === 'heroCard' && e.templateId && e.rarity) out.push({ kind: 'heroCard', templateId: e.templateId, rarity: e.rarity, name: e.name ?? e.templateId });
  }
  if (ore > 0) out.push({ kind: 'ore', amount: ore });
  return out;
}

/**
 * Строки событий под наградами: только то, что не показано чипом. Убраны «Карта героя», «Благословенная руда»,
 * «Гемы +» (это чипы) и «Открыт этап …» (это видно на карте — §5 «Итог боя», P1).
 */
export function resultEventLines(lines: readonly string[]): string[] {
  return lines.filter((l) => !/^(Карта героя:|Благословенная руда|Гемы \+|Открыт этап )/.test(l));
}

/** Ярлык «как стать сильнее» после поражения (большая плитка-иконка, как в AFK). */
export interface DefeatShortcut {
  id: 'heroes' | 'gear' | 'tavern' | 'squad';
  /** Подпись плитки и строка под ней (2–3 слова). */
  label: string;
  sub: string;
  /** Совет по делу (flow.ts defeatAdvice) — плитка выделена. */
  advised: boolean;
}

/**
 * Три плитки после поражения: «Герои» (уровень), «Снаряжение» (лучшее — сразу всему отряду), «Таверна» (призыв;
 * пока закрыта — «Отряд»). advice — действие defeatAdvice, tavernOpen — Таверна открыта, gearReady — есть вещи получше.
 */
export function defeatShortcuts(advice: 'EquipBest' | 'Heroes' | 'Squad' | 'Campaign', tavernOpen: boolean, gearReady: boolean): DefeatShortcut[] {
  const out: DefeatShortcut[] = [
    { id: 'heroes', label: 'Герои', sub: 'Уровень', advised: advice === 'Heroes' },
    { id: 'gear', label: 'Снаряжение', sub: gearReady ? 'Надеть лучшее' : 'Сумка', advised: advice === 'EquipBest' },
  ];
  if (tavernOpen && advice !== 'Squad') out.push({ id: 'tavern', label: 'Таверна', sub: 'Новые герои', advised: false });
  else out.push({ id: 'squad', label: 'Отряд', sub: 'Состав', advised: advice === 'Squad' });
  return out;
}

// ---------- появление по одной (итог боя, «Глава пройдена») ----------

/** Объект, который проявляется (масштаб и прозрачность). */
export type RevealObj = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.AlphaSingle;
type Obj = RevealObj;

/** Шаг «наград по одной» (§4.6: по 120 мс). */
export const REVEAL_STEP = M.release;

/**
 * Появление по одной (§4.6): шаги показываются через REVEAL_STEP (alpha 0 → 1, масштаб 0.86 → 1, E.pop), после
 * последнего — пауза hold, затем onDone (кнопки). Касание в любом месте — всё сразу. Без анимации — сразу.
 */
export class Reveal {
  private steps: { objs: Obj[]; fn?: (instant: boolean) => void; shown: boolean }[] = [];
  private alpha = new Map<Obj, number>();
  private tick: (() => void) | null = null;
  private finished = false;
  private onDone: () => void = () => undefined;

  constructor(private scene: Phaser.Scene) {}

  /** Шаг: объекты (скрыты до своей очереди) и что сделать в этот миг (отсчёт числа). */
  step(objs: Obj[], fn?: (instant: boolean) => void): void {
    for (const o of objs) {
      this.alpha.set(o, o.alpha);
      o.setAlpha(0);
    }
    this.steps.push({ objs, fn, shown: false });
  }

  play(onDone: () => void, hold: number = M.emphasis): void {
    this.onDone = onDone;
    if (!juiceOn()) return this.finish();
    // Расписание — по реальному времени кадров (game.loop.time), не по часам сцены: на медленном устройстве часы
    // сцены отстают (шаг кадра ограничен), и кнопки появлялись бы через десяток секунд.
    const loop = this.scene.game.loop;
    const t0 = loop.time;
    const end = Math.max(0, this.steps.length - 1) * REVEAL_STEP + hold;
    let next = 0;
    this.tick = () => {
      const t = loop.time - t0;
      while (next < this.steps.length && t >= next * REVEAL_STEP) this.show(this.steps[next++], false);
      if (t >= end) this.finish();
    };
    this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.stop, this);
    this.tick();
    this.scene.input.once('pointerdown', this.finish, this);
  }

  /** Снять обработчики (готово или экран закрыт). */
  private stop(): void {
    if (this.tick) this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick);
    this.tick = null;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.stop, this);
    this.scene.input.off('pointerdown', this.finish, this);
  }

  private show(s: { objs: Obj[]; fn?: (instant: boolean) => void; shown: boolean }, instant: boolean): void {
    if (s.shown) return;
    s.shown = true;
    for (const o of s.objs) {
      if (!o.scene) continue;
      const a = this.alpha.get(o) ?? 1;
      if (instant) {
        o.setAlpha(a);
        continue;
      }
      const sc = o.scaleX;
      o.setScale(sc * 0.86);
      this.scene.tweens.add({ targets: o, alpha: a, scale: sc, duration: M.fast, ease: E.pop });
    }
    s.fn?.(instant);
  }

  /** Всё сразу и onDone (один раз). */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stop();
    for (const s of this.steps) this.show(s, true);
    this.onDone();
  }
}
