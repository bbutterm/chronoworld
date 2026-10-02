import Phaser from 'phaser';
import type { CardRarity, MetaRewards, RewardBundle } from '../core';
import { heroCardIcon } from './heroCard';
import { afterRewardFly, juiceOn, pulse, type Point } from './juice';
import { GAME_W } from './layout';
import { rewardIcon, rewardItems } from './rewardsView';
import { contentBottom, cta } from './screen';
import { skinIcon, type SkinIcon } from './skin';
import { C, COLOR, COLOR_N, E, M, R, S, T, Z } from './theme';
import { BTN, button, groupNum, listRow, mixHex, plate, progressBar, rewardRow, text, toast, type ButtonView, type ChipSpec, type IconSpec } from './ui';
import { ratio, type RowState } from './inboxOrder';

/**
 * Общая строка «входящих» — Задания дня, Достижения, Почта (ui-polish-research §5, итерация 8C): listRow из ui.ts
 * (иконка, заголовок, вторая строка — полоса прогресса или чипы, справа — «Забрать» / чип награды / галочка).
 * Готовые к получению — сверху с золотой кромкой, полученные — внизу (свёрнуты или приглушены), «Забрать всё» —
 * единственная главная кнопка внизу экрана, только когда есть что забрать.
 */

/** Ширина строки (поля экрана S.l), высота и шаг. */
export const ROW_W = GAME_W - 2 * S.l;
export const ROW_H = 150;
export const ROW_STEP = ROW_H + S.xs;
/** Строка-свёртка «Выполнено · 7». */
export const FOLD_H = 112;
const CTA_H = 122;

type Placed = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;

/** Центр «Забрать всё» над навигацией. */
export function claimAllY(): number {
  return contentBottom() - CTA_H / 2 - S.xs;
}

/** Низ списка: над «Забрать всё», если она есть. */
export function listBottom(hasClaimAll: boolean): number {
  return hasClaimAll ? claimAllY() - CTA_H / 2 - S.xs : contentBottom() + 10;
}

/** «Забрать всё» — главная кнопка экрана (одна, золото, §3 п. 1). Имя контейнера — name. */
export function claimAllButton(scene: Phaser.Scene, onClick: () => void, name = 'claimAll'): ButtonView {
  const b = cta(scene, GAME_W / 2, claimAllY(), 'Забрать всё', onClick, { w: 640, h: CTA_H });
  b.container.setName(name);
  pulse(scene, b.container, 1.03, M.emphasis * 1.5);
  return b;
}

/** Контурная иконка скина цветом роли (иконка строки). */
export function glyph(name: SkinIcon, color: string): IconSpec {
  return (scene, x, y, size) => scene.add.image(x, y, skinIcon(name)).setDisplaySize(size, size).setTint(parseInt(color.slice(1, 7), 16));
}

/** Цвет иконки строки по состоянию. */
export function glyphColor(state: RowState): string {
  return state === 'ready' ? COLOR.accent : state === 'active' ? COLOR.textSecondary : COLOR.textTertiary;
}

/** «Забрать» в строке: тёмная плитка с золотой подписью (главная — одна «Забрать всё»). */
export function claimButton(scene: Phaser.Scene, onTap: () => void): Placed {
  const b = button(scene, 0, 0, 184, BTN.m, '', 'Забрать', onTap, T.body, { variant: 'secondary' });
  b.label.setColor(COLOR.accent);
  b.container.setName('rowClaim');
  return b.container;
}

/** Галочка «получено». */
export function checkMark(scene: Phaser.Scene): Placed {
  return scene.add.image(0, 0, skinIcon('check')).setDisplaySize(52, 52).setTint(parseInt(COLOR.positive.slice(1, 7), 16)).setAlpha(0.8);
}

/** Справа: шеврон «перейти» (нажатие по строке ведёт туда, где дело делается). */
export function chevron(scene: Phaser.Scene): Placed {
  return scene.add.image(0, 0, skinIcon('next')).setDisplaySize(36, 36).setTint(parseInt(COLOR.textTertiary.slice(1, 7), 16));
}

/** Вторая строка: полоса прогресса с числом, чипы или короткий текст. */
export type RowLine = { progress: number; target: number; key: string; chips?: ChipSpec[] } | { chips: ChipSpec[] } | { text: string };

export interface InboxRowSpec {
  state: RowState;
  icon: IconSpec | Placed;
  title: string;
  line?: RowLine;
  trailing?: Placed;
  /** Высота (по умолчанию ROW_H; полученные без второй строки — FOLD_H). */
  h?: number;
  /** Нажатие по строке (в ScrollArea — через area.tap). */
  onTap?: () => void;
}

/**
 * Строка входящих с центром (x, y): ready — поднятая карточка с золотой кромкой, done — приглушена.
 * Заголовок — первой строкой, line — второй (по левому краю заголовка).
 */
export function inboxRow(scene: Phaser.Scene, x: number, y: number, spec: InboxRowSpec): Phaser.GameObjects.Container {
  const ready = spec.state === 'ready';
  const done = spec.state === 'done';
  const h = spec.h ?? ROW_H;
  const row = listRow(scene, x, y, ROW_W, { icon: spec.icon, title: spec.title, trailing: spec.trailing, h, raised: ready, dim: done, onTap: spec.onTap });
  if (ready) {
    row.addAt(plate(scene, 0, 0, ROW_W, h, { fill: mixHex(COLOR.surfaceRaised, COLOR.accent, 0.12), alpha: 0.97, border: COLOR.accent, borderW: 3, r: R.m, hl: 0.18 }), 1);
  }
  if (!spec.line) return row;
  const title = [...row.list].reverse().find((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text);
  if (!title) return row;
  title.setY(-ROW_H * 0.18);
  const left = title.x;
  const ly = ROW_H * 0.2;
  const tr = spec.trailing as (Placed & { displayWidth?: number }) | undefined;
  const right = tr ? tr.x - (tr.displayWidth ?? 0) / 2 - S.s : ROW_W / 2 - S.m;
  const avail = right - left;
  const l = spec.line;
  if ('progress' in l) {
    // Награда — справа на той же строке (заголовку достаётся вся ширина).
    let reward = 0;
    if (l.chips?.length) {
      const r = rewardRow(scene, 0, ly, l.chips, { size: 's', gap: S.xxs });
      r.setX(right - r.width / 2);
      row.add(r);
      reward = r.width + S.s;
    }
    const bw = Math.max(160, Math.min(380, avail - 150 - reward));
    const p = ratio(l.progress, l.target);
    row.add(progressBar(scene, left, ly, bw, 24, p, p >= 1 ? COLOR_N.accent : COLOR_N.positive, { key: l.key }));
    row.add(text(scene, left + bw + S.xs, ly, `${groupNum(l.progress)} / ${groupNum(l.target)}`, T.caption, COLOR.textSecondary, { fontStyle: 'bold' }).setOrigin(0, 0.5));
  } else if ('chips' in l) {
    const r = rewardRow(scene, 0, ly, l.chips, { size: 's', gap: S.xxs, maxW: avail });
    r.setX(left + r.width / 2);
    if (done) r.setAlpha(0.5);
    row.add(r);
  } else {
    const t = text(scene, left, ly, l.text, T.caption, done ? COLOR.textTertiary : COLOR.textSecondary).setOrigin(0, 0.5);
    while (t.width > avail && t.text.length > 2) t.setText(`${t.text.slice(0, -2)}…`);
    row.add(t);
  }
  return row;
}

/** Свёртка «Выполнено · 7» — нажатие раскрывает/сворачивает полученные строки. */
export function foldRow(scene: Phaser.Scene, x: number, y: number, label: string, count: number, open: boolean, onTap: () => void): Phaser.GameObjects.Container {
  const ch = scene.add.image(0, 0, skinIcon('next')).setDisplaySize(36, 36).setTint(parseInt(COLOR.textTertiary.slice(1, 7), 16)).setAngle(open ? -90 : 90);
  const row = listRow(scene, x, y, ROW_W, { icon: glyph('check', COLOR.positive), title: `${label} · ${count}`, trailing: ch, h: FOLD_H, onTap });
  row.setName('fold').setAlpha(0.85);
  return row;
}

// ---------- награды чипами ----------

/** Награда чипом и «валюта ли» (золото и гемы летят в «таблетки» шапки — их не повторяем). */
export type RewardChip = ChipSpec & { currency?: boolean };

function cardChip(rarity: CardRarity, v: number): RewardChip {
  const value = v >= 1 && Number.isInteger(v) ? `×${v}` : `${Math.round(v * 100)}%`;
  return { icon: (s, x, y, size) => heroCardIcon(s, x, y, size * 1.15, rarity), value, tone: 'info' };
}

/** Награда задания/достижения/порога (MetaRewards без карт — пороги активности). */
export function metaChips(r: Partial<MetaRewards>): RewardChip[] {
  const out: RewardChip[] = [];
  if (r.gold) out.push({ icon: 'gold', value: r.gold, tone: 'gold', currency: true });
  if (r.gems) out.push({ icon: 'gems', value: r.gems, tone: 'gem', currency: true });
  if (r.jobExp) out.push({ icon: 'hero_exp', value: r.jobExp, tone: 'positive' });
  for (const rarity of ['purple', 'blue'] as const) {
    const v = r.heroCards?.[rarity] ?? 0;
    if (v > 0) out.push(cardChip(rarity, v));
  }
  return out;
}

/** Вложение письма / награда события (RewardBundle) чипами. */
export function bundleChips(r: RewardBundle): RewardChip[] {
  return rewardItems(r).map((it) => ({
    icon: (s: Phaser.Scene, x: number, y: number, size: number) => rewardIcon(s, x, y, it.kind, size, false, it),
    value: it.short,
    tone: it.kind === 'gold' ? 'gold' : it.kind === 'gems' ? 'gem' : it.kind === 'exp' ? 'positive' : 'neutral',
    currency: it.kind === 'gold' || it.kind === 'gems',
  }));
}

// ---------- после «Забрать»: что не долетает до шапки ----------

interface PendingFx {
  scene: string;
  at: Point;
  chips: ChipSpec[];
  lines: string[];
}

let pendingFx: PendingFx | null = null;

/**
 * Перед перезапуском экрана с наградой: награды не-валюты (опыт, карты) всплывут чипами из точки at, строки
 * событий (какая карта героя выпала) — тостом после полёта монет. Валюта — queueRewardFly (juice.ts).
 */
export function queueClaimFx(sceneKey: string, at: Point, chips: RewardChip[], lines: string[] = []): void {
  pendingFx = { scene: sceneKey, at, chips: chips.filter((c) => !c.currency), lines };
}

/** В конце create(): показать отложенное (один раз). */
export function playClaimFx(scene: Phaser.Scene): void {
  const p = pendingFx;
  pendingFx = null;
  if (!p || p.scene !== scene.scene.key) return;
  if (p.chips.length) floatChips(scene, p.at, p.chips);
  if (p.lines.length) afterRewardFly(scene, () => toast(scene, p.lines.join('\n'), C.success));
}

/** Чипы наград всплывают из точки и тают (локальная анимация вместо тоста, §3 п. 10). */
export function floatChips(scene: Phaser.Scene, at: Point, chips: ChipSpec[]): Phaser.GameObjects.Container {
  const row = rewardRow(scene, GAME_W / 2, at.y, chips, { size: 'm' }).setDepth(Z.toast - 1).setName('claimFx');
  row.setX(Phaser.Math.Clamp(at.x, S.l + row.width / 2, GAME_W - S.l - row.width / 2));
  if (!juiceOn()) {
    scene.time.delayedCall(1500, () => row.destroy());
    return row;
  }
  row.setAlpha(0).setScale(0.85);
  scene.tweens.add({ targets: row, alpha: 1, scale: 1, duration: M.base, ease: E.pop });
  scene.tweens.add({ targets: row, y: at.y - 110, alpha: 0, delay: M.base + M.count, duration: M.slow, ease: E.in, onComplete: () => row.destroy() });
  return row;
}
