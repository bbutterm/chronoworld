import Phaser from 'phaser';
import { offlineFullInMs, offlineLoot, offlineRewards, RARITIES, type ChestLoot, type OfflineRewards, type Rarity, type SaveState } from '../core';
import { GAME } from './content';
import { formatNumber, RARITY_COLORS } from './flow';
import { rewardIcon } from './rewardsView';
import { skinIcon } from './skin';
import { C, FS, OUTLINE } from './theme';
import { text } from './ui';

/**
 * Карточка сундука на главной: что накопилось (золото, опыт, трофеи — предметы, осколки, гемы, свитки) иконками
 * и таймер «Полон через Ч:ММ» / «Сундук полон»; строки итогов сбора и быстрых наград. HomeScene только создаёт
 * ChestCardView и зовёт update раз в секунду — раскладка сундука, «Собрать» и медальон Таверны не трогаются.
 */

type Obj = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Visible;

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «Ч:ММ» до заполнения (минуты — вверх, чтобы «0:00» не висело, пока сундук ещё не полон). */
export function fullInText(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

/** Заголовок карточки: состояние сундука и сколько накоплено по времени. */
export function chestHeadline(r: OfflineRewards, cleared: number): string {
  if (cleared === 0) return 'Пройдите первый этап кампании,\nчтобы сундук начал наполняться';
  if (r.gold === 0 && r.jobExp === 0) return 'Сундук пуст — награды\nкопятся каждую минуту';
  return `Накоплено за ${Math.floor(r.minutes / 60)} ч ${r.minutes % 60} мин`;
}

/** Лучшая редкость среди предметов (для цвета иконки). */
function bestRarity(items: readonly string[]): Rarity | null {
  let best = -1;
  for (const id of items) best = Math.max(best, RARITIES.indexOf(GAME.equipment.items[id]?.rarity ?? 'common'));
  return best >= 0 ? RARITIES[best] : null;
}

/** Осколок героя: вытянутый фиолетовый кристалл. */
function shardIcon(scene: Phaser.Scene, x: number, y: number, size: number): Obj {
  const w = size * 0.5;
  return scene.add.polygon(x, y, [w / 2, 0, w, size * 0.45, w / 2, size, 0, size * 0.45], 0xc58cff).setStrokeStyle(3, 0x3c1d5c);
}

/** Мешок трофеев, цвет — лучшая редкость. */
function itemsIcon(scene: Phaser.Scene, x: number, y: number, size: number, rarity: Rarity | null): Obj {
  const color = Phaser.Display.Color.HexStringToColor(RARITY_COLORS[rarity ?? 'common']).color;
  return scene.add.image(x, y, skinIcon('bag')).setDisplaySize(size, size).setTint(color);
}

type Cell = { kind: 'gold' | 'exp' | 'gems' | 'scrolls' | 'items' | 'shards'; value: string };

/** Трофеи одной строкой ячеек (только ненулевые). */
function lootCells(loot: Pick<ChestLoot, 'items' | 'cards' | 'gems' | 'scrolls'>): Cell[] {
  const cells: Cell[] = [];
  if (loot.items.length) cells.push({ kind: 'items', value: `×${loot.items.length}` });
  // Карты героя (V1: значок прежних осколков; экран — пакет V2).
  if (loot.cards.length) cells.push({ kind: 'shards', value: `×${loot.cards.length}` });
  if (loot.gems) cells.push({ kind: 'gems', value: formatNumber(loot.gems) });
  if (loot.scrolls) cells.push({ kind: 'scrolls', value: `×${loot.scrolls}` });
  return cells;
}

/** Нарисовать строку ячеек с центром (x, y). */
function drawRow(scene: Phaser.Scene, x: number, y: number, cells: Cell[], items: readonly string[], size = 44, gap = 30): Obj[] {
  const out: Obj[] = [];
  let cx = 0;
  const parts: { icon: Obj; label: Phaser.GameObjects.Text; at: number }[] = [];
  for (const c of cells) {
    const icon =
      c.kind === 'items' ? itemsIcon(scene, 0, y, size, bestRarity(items)) : c.kind === 'shards' ? shardIcon(scene, 0, y, size) : (rewardIcon(scene, 0, y, c.kind, size) as Obj);
    const color = c.kind === 'gold' ? C.gold : c.kind === 'gems' ? C.gem : c.kind === 'shards' ? '#e0b8ff' : C.text;
    const label = text(scene, 0, y, c.value, FS.small, color, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5);
    parts.push({ icon, label, at: cx });
    cx += size + 8 + label.width + gap;
  }
  const left = x - (cx - gap) / 2;
  for (const p of parts) {
    p.icon.setX(left + p.at + size / 2);
    p.label.setX(left + p.at + size + 8);
    out.push(p.icon, p.label);
  }
  return out;
}

export interface ChestCardLayout {
  /** Строка «золото + опыт» (центр). */
  incomeX: number;
  incomeY: number;
  /** Строка трофеев (центр). */
  lootX: number;
  lootY: number;
  /** Таймер (центр). */
  timerX: number;
  timerY: number;
}

/** Содержимое карточки сундука: строки иконок и таймер. update — раз в секунду из HomeScene.refresh. */
export class ChestCardView {
  private rows: Obj[] = [];
  private key = '';
  private readonly timer: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly at: ChestCardLayout,
  ) {
    this.timer = text(scene, at.timerX, at.timerY, '', FS.small, C.muted, OUTLINE);
  }

  /** Пересчитать на момент now. Возвращает накопленное золото/опыт (для кнопки и подсказки). */
  update(save: SaveState, now: number): OfflineRewards {
    const r = offlineRewards(save, now, GAME);
    const loot = offlineLoot(save, now, GAME);
    const income = r.gold > 0 || r.jobExp > 0;
    // Иконки перестраиваются только когда что-то изменилось (раз в минуту / тик), таймер — каждую секунду.
    const key = income ? JSON.stringify([r.gold, r.jobExp, loot.items, loot.cards, loot.gems, loot.scrolls]) : '';
    if (key !== this.key) {
      this.key = key;
      for (const o of this.rows) o.destroy();
      this.rows = [];
      if (income) {
        const a = this.at;
        this.rows.push(...drawRow(this.scene, a.incomeX, a.incomeY, [
          { kind: 'gold', value: `+${formatNumber(r.gold)}` },
          { kind: 'exp', value: `+${formatNumber(r.jobExp)}` },
        ], []));
        const cells = lootCells(loot);
        if (cells.length) this.rows.push(...drawRow(this.scene, a.lootX, a.lootY, cells, loot.items, 40, 26));
        else this.rows.push(text(this.scene, a.lootX, a.lootY, 'Трофеи копятся…', FS.small, C.disabled, OUTLINE));
      }
    }
    const full = offlineFullInMs(save, now, GAME);
    this.timer.setText(full === null ? '' : full <= 0 ? 'Сундук полон — заберите!' : `Полон через ${fullInText(full)}`);
    this.timer.setColor(full !== null && full <= 0 ? C.warning : C.muted);
    return r;
  }
}

/** Трофеи текстом для тоста: «Предметы: Кожаная шапка, Короткий меч ×2 · гемы +5 · свиток +1» (карты героя — в событиях). */
export function lootLines(loot: Pick<ChestLoot, 'items' | 'gems' | 'scrolls'>): string[] {
  const lines: string[] = [];
  if (loot.items.length) {
    const counts = new Map<string, number>();
    for (const id of loot.items) counts.set(id, (counts.get(id) ?? 0) + 1);
    const names = [...counts].map(([id, n]) => `${GAME.equipment.items[id]?.name ?? id}${n > 1 ? ` ×${n}` : ''}`);
    lines.push(`${loot.items.length > 1 ? 'Предметы' : 'Предмет'}: ${names.join(', ')}`);
  }
  const extra: string[] = [];
  if (loot.gems) extra.push(`гемы +${formatNumber(loot.gems)}`);
  if (loot.scrolls) extra.push(`${plural(loot.scrolls, 'свиток', 'свитка', 'свитков')} призыва +${loot.scrolls}`);
  if (extra.length) lines.push(`Трофеи: ${extra.join(', ')}`);
  return lines;
}

/** Коротко о трофеях для окна подтверждения быстрых наград: «Трофеи: 1 предмет, 5 гемов». Пусто — ''. */
export function lootSummary(loot: Pick<ChestLoot, 'items' | 'cards' | 'gems' | 'scrolls'>): string {
  const parts: string[] = [];
  const n = loot.items.length;
  if (n) parts.push(`${n} ${plural(n, 'предмет', 'предмета', 'предметов')}`);
  if (loot.cards.length) parts.push(`${loot.cards.length} ${plural(loot.cards.length, 'карта героя', 'карты героя', 'карт героя')}`);
  if (loot.gems) parts.push(`${loot.gems} ${plural(loot.gems, 'гем', 'гема', 'гемов')}`);
  if (loot.scrolls) parts.push(`${loot.scrolls} ${plural(loot.scrolls, 'свиток', 'свитка', 'свитков')}`);
  return parts.length ? `Трофеи: ${parts.join(', ')}.` : '';
}
