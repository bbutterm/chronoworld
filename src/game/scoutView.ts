import Phaser from 'phaser';
import { COMBAT as COMBAT_CFG, type UnitDef } from '../core';
import { enemyTraits } from '../core/behavior';
import { attackElement, defenseElement, ELEMENT_NAMES, weakTo, type Element } from '../core/elements';
import { elementBadge, elementTitle } from './battleElements';
import { CONTENT, GAME } from './content';
import { GAME_H, GAME_W } from './layout';
import { pressable, text } from './ui';
import { C, FS } from './theme';

/**
 * Разведка врагов (docs/design/battle-decisions.md §2) — строка под полем и окно по касанию; общая для экрана этапа и
 * превью этажа Башни (BUG-189, BUG-198). Враги группируются по виду («Фабр ×2»), а не по слотам; одно слово —
 * «слабость»; у босса особенности — в две строки; в окне — кто из отряда бьёт нужной стихией.
 */

export interface ScoutGroup {
  def: UnitDef;
  count: number;
}

/** Враги по видам: одинаковое имя, стихия и тип (у этапа id юнитов — по слотам, «Фабр» в двух слотах — один вид). */
export function scoutGroups(enemies: readonly (UnitDef | null | undefined)[]): ScoutGroup[] {
  const map = new Map<string, ScoutGroup>();
  for (const u of enemies) {
    if (!u) continue;
    const key = `${u.name}|${defenseElement(u)}|${u.kind}`;
    const g = map.get(key);
    if (g) g.count++;
    else map.set(key, { def: u, count: 1 });
  }
  return [...map.values()];
}

/** Короткая строка: главные особенности и две самые частые слабости. Пусто — «обычные враги». */
export function scoutSummary(enemies: readonly (UnitDef | null | undefined)[]): string {
  const cfg = GAME.combat ?? COMBAT_CFG;
  const traits: string[] = [];
  for (const { def } of scoutGroups(enemies)) {
    const t = enemyTraits(def, CONTENT, cfg)[0];
    if (t && !traits.includes(t)) traits.push(t);
  }
  const weak = new Map<Element, number>();
  for (const u of enemies) if (u) for (const el of weakTo(cfg.elements, defenseElement(u))) weak.set(el, (weak.get(el) ?? 0) + 1);
  const best = [...weak.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([el]) => ELEMENT_NAMES[el]);
  const parts = [traits.slice(0, 3).join(', '), best.length ? `слабость: ${best.join(', ')}` : ''].filter(Boolean);
  return parts.join(' · ') || 'обычные враги';
}

/** Строка «Разведка: … ›» в (x, y) шириной не больше maxW; касание — окно разведки. */
export function scoutLine(
  scene: Phaser.Scene,
  y: number,
  enemies: readonly (UnitDef | null | undefined)[],
  squad: readonly UnitDef[],
  maxW = GAME_W - 60,
  depth = 0,
  color: string = C.info,
): Phaser.GameObjects.Text | null {
  if (!enemies.some(Boolean)) return null;
  const line = text(scene, GAME_W / 2, y, `Разведка: ${scoutSummary(enemies)}  ›`, FS.caption, color, { stroke: C.stroke, strokeThickness: 4 }).setName('stageScout').setDepth(depth);
  if (line.width > maxW) line.setScale(maxW / line.width);
  const zone = scene.add.zone(GAME_W / 2, y, maxW + 20, 48).setName('stageScoutZone').setDepth(depth);
  pressable(scene, zone, maxW + 20, 48, () => scoutPanel(scene, enemies, squad));
  return line;
}

/** Окно разведки: по строке на вид врага (значок стихии, «имя ×N», особенности, слабость и кто из отряда ею бьёт). */
export function scoutPanel(scene: Phaser.Scene, enemies: readonly (UnitDef | null | undefined)[], squad: readonly UnitDef[]): void {
  const cfg = GAME.combat ?? COMBAT_CFG;
  const groups = scoutGroups(enemies);
  const W = 980;
  const textW = W - 150;
  const D = 5050;
  const block = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W * 2, GAME_H * 2, 0x000000, 0.6).setDepth(D).setInteractive();
  const nodes: Phaser.GameObjects.GameObject[] = [block];
  const body: { node: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform; dy: number }[] = [];
  let y = 0;
  const heroEls = squad.map((d) => ({ name: d.name, el: attackElement(d, CONTENT.skills) }));
  for (const g of groups) {
    const u = g.def;
    const el = defenseElement(u);
    const rowTop = y;
    const name = text(scene, 0, 0, `${u.name}${g.count > 1 ? ` ×${g.count}` : ''}${u.kind === 'boss' ? ' · босс' : ''}${el !== 'neutral' ? ` · ${elementTitle(el)}` : ''}`, FS.small, u.kind === 'boss' ? C.danger : C.text, {
      fontStyle: 'bold',
      stroke: C.stroke,
      strokeThickness: 4,
    })
      .setOrigin(0, 0)
      .setDepth(D + 1);
    if (name.width > textW) name.setScale(textW / name.width);
    body.push({ node: name, dy: rowTop });
    y += name.displayHeight + 6;
    const tr = enemyTraits(u, CONTENT, cfg);
    const weakEls = weakTo(cfg.elements, el);
    const weak = weakEls.map((x) => ELEMENT_NAMES[x]);
    const hitters = [...new Set(heroEls.filter((h) => weakEls.includes(h.el)).map((h) => h.name))];
    const lines = [
      tr.length ? (u.kind === 'boss' ? tr.join(', ') : tr.slice(0, 3).join(', ')) : 'без особенностей',
      weak.length ? `слабость: ${weak.join(', ')}${hitters.length ? ` — бьёт: ${hitters.join(', ')}` : ' — в отряде таких нет'}` : '',
    ].filter(Boolean);
    const d = text(scene, 0, 0, lines.join('\n'), FS.caption, C.muted, { stroke: C.stroke, strokeThickness: 3, wordWrap: { width: textW }, lineSpacing: 4, align: 'left' })
      .setOrigin(0, 0)
      .setDepth(D + 1);
    body.push({ node: d, dy: y });
    y += d.height + 22;
    const badge = elementBadge(scene, 0, 0, el, 44).setDepth(D + 1);
    body.push({ node: badge, dy: rowTop + 22 });
    if (el === 'neutral') badge.setVisible(false);
  }
  const h = Math.min(GAME_H - 200, y + 190);
  const top = GAME_H / 2 - h / 2;
  const box = scene.add.rectangle(GAME_W / 2, GAME_H / 2, W, h, 0x1d1510, 0.97).setStrokeStyle(4, 0xc9a45c, 0.9).setDepth(D);
  nodes.push(box);
  nodes.push(text(scene, GAME_W / 2, top + 50, 'Разведка', FS.h2, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setDepth(D + 1));
  for (const b of body) {
    const isBadge = b.node.name.startsWith('element_');
    b.node.setPosition(isBadge ? GAME_W / 2 - W / 2 + 60 : GAME_W / 2 - W / 2 + 110, top + 100 + b.dy);
    nodes.push(b.node);
  }
  nodes.push(text(scene, GAME_W / 2, top + h - 34, 'Коснитесь, чтобы закрыть', FS.caption, C.dim).setDepth(D + 1));
  block.once('pointerup', () => nodes.forEach((n) => n.destroy()));
}
