import Phaser from 'phaser';
import { offlineFullInMs, offlineLoot, offlineRewards, RARITIES, type ChestLoot, type OfflineRewards, type Rarity, type SaveState } from '../core';
import { heroCardIcon } from './heroCard';
import { GAME } from './content';
import { formatNumber, RARITY_COLORS } from './flow';
import { compactNumber } from './frame';
import { rewardIcon } from './rewardsView';
import { RO_ICON_PX, roIcon } from './itemIcons';
import { skinIcon } from './skin';
import { COLOR, COLOR_N, S, T } from './theme';
import { rewardRow, text, type ChipSpec } from './ui';
import { chestFill, type ChestFill } from './campaignView';

/**
 * Содержимое карточки сундука на странице «Кампания» (как сундук AFK Arena): полоса наполнения «1ч 05м / 12ч»
 * («Полон» — золотом) и под ней накопленное чипами «иконка + число» (золото, опыт, трофеи — предметы, карты героя, гемы,
 * свитки). Слов нет: что это сундук, видно по картинке, когда полон — по полосе. CampaignScene создаёт ChestCardView
 * и зовёт update раз в секунду; картинка сундука, «Собрать» и полёт наград живут в сцене.
 */

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Лучшая редкость среди предметов (для цвета иконки). */
function bestRarity(items: readonly string[]): Rarity | null {
  let best = -1;
  for (const id of items) best = Math.max(best, RARITIES.indexOf(GAME.equipment.items[id]?.rarity ?? 'common'));
  return best >= 0 ? RARITIES[best] : null;
}

/** Трофеи: иконка RO лучшего предмета (рамка цветом его редкости), без иконки — мешок цветом редкости. */
function itemsIcon(scene: Phaser.Scene, x: number, y: number, size: number, items: readonly string[]): Phaser.GameObjects.GameObject {
  const rarity = bestRarity(items);
  const color = Phaser.Display.Color.HexStringToColor(RARITY_COLORS[rarity ?? 'common']).color;
  const best = items.find((id) => (GAME.equipment.items[id]?.rarity ?? 'common') === (rarity ?? 'common'));
  const key = roIcon(scene, best);
  if (!key) return scene.add.image(x, y, skinIcon('bag')).setDisplaySize(size, size).setTint(color);
  // Контейнер: чип двигает иконку (setPosition) — рамка и иконка едут вместе.
  const cell = scene.add.rectangle(0, 0, size, size, color, 0.2).setStrokeStyle(2, color, 1);
  const ico = scene.add.image(0, 0, key).setScale(Math.max(1, Math.floor(size / RO_ICON_PX)));
  return scene.add.container(x, y, [cell, ico]);
}

/** Накопленное чипами: золото и опыт, затем трофеи (только ненулевые; карты героя — по редкости, старшая первой). */
export function chestChips(r: Pick<OfflineRewards, 'gold' | 'jobExp'>, loot: Pick<ChestLoot, 'items' | 'cards' | 'gems' | 'scrolls'>): ChipSpec[] {
  const out: ChipSpec[] = [];
  if (r.gold > 0) out.push({ icon: (s, x, y, size) => rewardIcon(s, x, y, 'gold', size), value: `+${compactNumber(r.gold)}`, tone: 'gold' });
  if (r.jobExp > 0) out.push({ icon: (s, x, y, size) => rewardIcon(s, x, y, 'exp', size), value: `+${compactNumber(r.jobExp)}` });
  if (loot.items.length) out.push({ icon: (s, x, y, size) => itemsIcon(s, x, y, size, loot.items), value: `×${loot.items.length}` });
  for (const rarity of ['red', 'gold', 'purple', 'blue', 'green'] as const) {
    const cards = loot.cards.filter((c) => c.rarity === rarity);
    if (cards.length) out.push({ icon: (s, x, y, size) => heroCardIcon(s, x, y, size * 1.2, rarity, cards[0].templateId), value: `×${cards.length}`, tone: 'info' });
  }
  if (loot.gems) out.push({ icon: (s, x, y, size) => rewardIcon(s, x, y, 'gems', size), value: compactNumber(loot.gems), tone: 'gem' });
  if (loot.scrolls) out.push({ icon: (s, x, y, size) => rewardIcon(s, x, y, 'scrolls', size), value: `×${loot.scrolls}` });
  return out;
}

export interface ChestCardLayout {
  /** Левый край полосы и чипов. */
  x: number;
  /** Ширина полосы. */
  w: number;
  /** Ширина ряда чипов (справа от него — «Собрать»). */
  chipsW: number;
  /** Центр полосы наполнения. */
  barY: number;
  /** Центр ряда чипов. */
  chipsY: number;
}

/** Что показывает сундук сейчас: накопленное, наполнение, есть ли что собрать. */
export interface ChestState {
  rewards: OfflineRewards;
  fill: ChestFill;
  hasIncome: boolean;
}

const BAR_H = 40;

/** Полоса наполнения и чипы накопленного. update — раз в секунду из CampaignScene.refresh. */
export class ChestCardView {
  private chips: Phaser.GameObjects.Container | null = null;
  private key = '';
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly at: ChestCardLayout,
  ) {
    const { x, w, barY } = at;
    // Утопленный жёлоб и золотая заливка с бликом; подпись — поверх, по центру.
    scene.add.rectangle(x + w / 2, barY, w, BAR_H, COLOR_N.surfaceSunken).setStrokeStyle(2, COLOR_N.border);
    this.fill = scene.add.rectangle(x + 3, barY, 0, BAR_H - 8, COLOR_N.accent).setOrigin(0, 0.5);
    this.label = text(scene, x + w / 2, barY, '', T.caption, COLOR.textPrimary, { fontStyle: 'bold' }).setName('chestFill');
    this.label.setShadow(0, 2, 'rgba(0,0,0,0.85)', 3, false, true);
  }

  /** Пересчитать на момент now. */
  update(save: SaveState, now: number): ChestState {
    const r = offlineRewards(save, now, GAME);
    const fill = chestFill(r.minutes, GAME.progression.offline.capHours, offlineFullInMs(save, now, GAME));
    const hasIncome = r.gold > 0 || r.jobExp > 0;
    this.fill.width = Math.max(0, (this.at.w - 6) * fill.frac);
    this.fill.setFillStyle(fill.full ? COLOR_N.gold : COLOR_N.accent);
    this.label.setText(fill.label).setColor(fill.full ? COLOR.gold : COLOR.textPrimary);
    // Чипы перестраиваются только когда что-то изменилось (раз в минуту / тик), полоса — каждую секунду.
    const loot = hasIncome ? offlineLoot(save, now, GAME) : null;
    const key = loot ? JSON.stringify([r.gold, r.jobExp, loot.items, loot.cards, loot.gems, loot.scrolls]) : '';
    if (key !== this.key) {
      this.key = key;
      this.chips?.destroy();
      this.chips = null;
      if (loot) {
        // Один ряд: не влезает — последние трофеи сворачиваются в «+N».
        const all = chestChips(r, loot);
        const build = (n: number) =>
          rewardRow(this.scene, 0, this.at.chipsY, n >= all.length ? all : [...all.slice(0, n), { value: `+${all.length - n}` }], { size: 's', gap: S.s, bg: false, maxW: this.at.chipsW });
        let n = all.length;
        let row = build(n);
        while (row.height > 64 && n > 1) {
          row.destroy();
          row = build(--n);
        }
        // Ряд — от левого края (§3 п. 6), не по центру.
        this.chips = row.setX(this.at.x + row.width / 2).setName('chestChips');
      }
    }
    return { rewards: r, fill, hasIncome };
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
