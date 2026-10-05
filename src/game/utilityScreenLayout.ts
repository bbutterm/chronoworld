import Phaser from 'phaser';
import type { ShopSlotView } from '../core';
import { FOLD_H, inboxRow as legacyInboxRow, ROW_H, ROW_W, type InboxRowSpec, type RowLine } from './inboxRows';
import { GAME_W } from './layout';
import { COLOR, COLOR_N, S, T, TOUCH_COMFORT } from './theme';
import { clampLines, ellipsize, groupNum, progressBar, rewardRow, text } from './ui';
import { view } from './viewport';

/** A list and its sole footer action share the same current safe content bottom. */
export function utilityListLayout(top: number, bottom: number, hasClaimAll: boolean) {
  const claimH = TOUCH_COMFORT;
  const claimY = bottom - S.xs - claimH / 2;
  return { top, bottom: hasClaimAll ? claimY - claimH / 2 - S.xs : bottom, claimY };
}

/** Phones get two readable product columns; the original wider layout stays available. */
export function utilityShopLayout(adaptive: boolean, count = 8) {
  const cols = adaptive ? 2 : 4;
  const gap = S.s;
  const width = GAME_W - 2 * S.l;
  const tileW = (width - (cols - 1) * gap) / cols;
  const tileH = 400;
  const bannerH = adaptive ? 360 : 440;
  const gridTop = bannerH + S.m;
  return {
    cols, tileW, tileH, bannerH, gridTop,
    height: gridTop + Math.ceil(count / cols) * (tileH + gap) - gap + S.xs,
    tilePos: (i: number) => ({
      x: S.l + tileW / 2 + (i % cols) * (tileW + gap),
      y: gridTop + tileH / 2 + Math.floor(i / cols) * (tileH + gap),
    }),
  };
}

/** Captured purchase intents expire after a purchase, refresh or the daily stock reset. */
export function sameShopOffer(
  offered: ShopSlotView,
  current: ShopSlotView | undefined,
  day: string,
  currentDay: string,
  refreshes: number,
  currentRefreshes: number,
): boolean {
  return !!current && day === currentDay && refreshes === currentRefreshes
    && offered.index === current.index && offered.bought === current.bought
    && offered.good === current.good && offered.itemId === current.itemId
    && offered.hero === current.hero && offered.rarity === current.rarity
    && offered.price === current.price && offered.currency === current.currency;
}

export function utilityRowHeight(line?: RowLine, adaptive = view().adaptive): number {
  if (!adaptive) return line ? ROW_H : FOLD_H;
  return line ? ('progress' in line && line.chips?.length ? 296 : 248) : 160;
}

/** Compact utility rows keep two title lines and separate progress from their rewards. */
export function utilityInboxRow(scene: Phaser.Scene, x: number, y: number, spec: InboxRowSpec): Phaser.GameObjects.Container {
  if (!view().adaptive) return legacyInboxRow(scene, x, y, spec);
  const h = spec.h ?? utilityRowHeight(spec.line);
  const row = legacyInboxRow(scene, x, y, { ...spec, line: undefined, h });
  const title = [...row.list].reverse().find((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text);
  if (!title) return row;
  const left = title.x;
  const tr = spec.trailing as (NonNullable<InboxRowSpec['trailing']> & { displayWidth?: number }) | undefined;
  const right = tr ? tr.x - (tr.displayWidth ?? 0) / 2 - S.s : ROW_W / 2 - S.m;
  const avail = Math.max(160, right - left);
  title.setText(spec.title).setWordWrapWidth(avail, true).setLineSpacing(S.xxs).setName('utilityRowTitle');
  clampLines(title, 2);
  title.setOrigin(0, spec.line ? 0 : 0.5).setY(spec.line ? -h / 2 + S.s : 0);
  const line = spec.line;
  if (!line) return row;
  const muted = spec.state === 'done';
  if ('progress' in line) {
    const y = line.chips?.length ? 16 : h / 2 - 56;
    const number = text(scene, right, y, `${groupNum(line.progress)} / ${groupNum(line.target)}`, T.caption, COLOR.textSecondary, { fontStyle: 'bold' }).setOrigin(1, 0.5);
    const width = Math.max(160, Math.min(380, avail - number.width - S.s));
    row.add(progressBar(scene, left, y, width, 24, line.target ? line.progress / line.target : 1, COLOR_N.positive, { key: line.key }));
    row.add(number);
    if (line.chips?.length) row.add(rewardRow(scene, left, h / 2 - 54, line.chips, { size: 's', maxW: avail, gap: S.xxs, align: 'left' }));
  } else if ('chips' in line) {
    const rewards = rewardRow(scene, left, h / 2 - 54, line.chips, { size: 's', maxW: avail, gap: S.xxs, align: 'left' });
    if (muted) rewards.setAlpha(0.5);
    row.add(rewards);
  } else {
    const label = text(scene, left, h / 2 - 54, line.text, T.caption, muted ? COLOR.textTertiary : COLOR.textSecondary).setOrigin(0, 0.5);
    row.add(ellipsize(label, avail));
  }
  return row;
}
