import Phaser from 'phaser';
import type { CardRarity, EventRewardEvent, RewardBundle } from '../core';
import { hasArt } from './assets';
import { GAME } from './content';
import { formatNumber } from './flow';
import { gemIcon } from './screen';
import { SKIN_TINT, skinIcon } from './skin';
import { C, FS, OUTLINE } from './theme';
import { icon, text } from './ui';
import { heroCardIcon, rarityName } from './heroCard';

/**
 * Награды событий и писем (RewardBundle, src/core/events): строки «иконка + число» для плиток и текст для тостов.
 * Используют EventsScene и MailScene.
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

/** Иконка вида награды (size — высота). Карты героя и контракт — мини-карта в рамке редкости (item — редкость, герой). */
export function rewardIcon(scene: Phaser.Scene, x: number, y: number, kind: RewardItem['kind'], size: number, dim = false, item?: Pick<RewardItem, 'rarity' | 'templateId'>): Phaser.GameObjects.GameObject {
  const tint = dim ? SKIN_TINT.creamDim : undefined;
  if (kind === 'heroCard' || kind === 'heroPick' || (kind === 'hero' && item?.templateId)) {
    return heroCardIcon(scene, x, y, size * 1.2, item?.rarity ?? 'blue', kind === 'hero' ? item?.templateId : undefined, { dim, pick: kind === 'heroPick' });
  }
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
