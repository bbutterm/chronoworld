import Phaser from 'phaser';
import { COMBAT as COMBAT_CFG, type UnitDef } from '../core';
import { enemyTraits } from '../core/behavior';
import { attackElement, defenseElement, ELEMENT_NAMES, weakTo, type Element } from '../core/elements';
import { elementBadge, elementTitle } from './battleElements';
import { CONTENT, GAME } from './content';
import { formatNumber, type StageNeeds } from './flow';
import { GAME_W } from './layout';
import { bottomSheet } from './screen';
import { chip, pressable, stat, tag, text, type Tone } from './ui';
import { C, COLOR, FS, S, T } from './theme';

/**
 * Разведка врагов (docs/design/battle-decisions.md §2): лист снизу по кнопке «i» на экране этапа и по строке на превью
 * этажа Башни (BUG-189, BUG-198). Враги группируются по виду («Фабр ×2»), а не по слотам; особенности — тегами,
 * слабости — чипами стихий, под ними — кто из отряда бьёт нужной стихией. На самом экране этапа постоянного текста
 * разведки нет (§3 правило 3 исследования ui-polish-research.md): только «i».
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

/** Две самые частые слабости врагов (стихии, которыми их выгодно бить). */
export function scoutWeakness(enemies: readonly (UnitDef | null | undefined)[]): Element[] {
  const cfg = GAME.combat ?? COMBAT_CFG;
  const weak = new Map<Element, number>();
  for (const u of enemies) if (u) for (const el of weakTo(cfg.elements, defenseElement(u))) weak.set(el, (weak.get(el) ?? 0) + 1);
  return [...weak.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([el]) => el);
}

/** Короткая строка: главные особенности и две самые частые слабости. Пусто — «обычные враги». */
export function scoutSummary(enemies: readonly (UnitDef | null | undefined)[]): string {
  const cfg = GAME.combat ?? COMBAT_CFG;
  const traits: string[] = [];
  for (const { def } of scoutGroups(enemies)) {
    const t = enemyTraits(def, CONTENT, cfg)[0];
    if (t && !traits.includes(t)) traits.push(t);
  }
  const best = scoutWeakness(enemies).map((el) => ELEMENT_NAMES[el]);
  const parts = [traits.slice(0, 3).join(', '), best.length ? `слабость: ${best.join(', ')}` : ''].filter(Boolean);
  return parts.join(' · ') || 'обычные враги';
}

/** Тон тега особенности: опасное для отряда — предупреждение, помощь врагам друг другу — инфо. */
export function traitTone(trait: string): Tone {
  if (/заряд|тыл|оглуш|ярость|площади|свиту/.test(trait)) return 'warning';
  if (/лечит|щиты/.test(trait)) return 'info';
  return 'neutral';
}

/** Строка «Разведка: … ›» в (x, y) шириной не больше maxW; касание — лист разведки (превью этажа Башни). */
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
  pressable(scene, zone, maxW + 20, 48, () => scoutSheet(scene, enemies, squad));
  return line;
}

/** Что этап требует от отряда (flow.ts stageNeeds); в листе — без own. */
export type ScoutNeeds = Omit<StageNeeds, 'own'>;

/**
 * Лист «Разведка»: сверху (если есть needs) — нужная мощь и уровень врагов; ниже по виду врага — значок стихии,
 * «имя ×N», «БОСС», особенности тегами, слабости чипами стихий и кто из отряда ими бьёт.
 */
export function scoutSheet(
  scene: Phaser.Scene,
  enemies: readonly (UnitDef | null | undefined)[],
  squad: readonly UnitDef[],
  needs?: ScoutNeeds,
): void {
  const cfg = GAME.combat ?? COMBAT_CFG;
  const groups = scoutGroups(enemies);
  const heroEls = squad.map((d) => ({ name: d.name, el: attackElement(d, CONTENT.skills) }));
  bottomSheet(scene, 'Разведка', (c, width) => {
    let y = 0;
    if (needs) {
      const rows: [string, string, Tone?][] = [['Нужная мощь', formatNumber(needs.power)]];
      // Без пределов редкостей типичный враг = нужный уровень героев (flow.ts stageLevelsFor) — одно число, не два.
      if (needs.short && !needs.short.capped) rows.push(['Героям нужен', `ур. ${needs.short.level}`, 'negative']);
      else rows.push(['Уровень врагов', `≈ ${needs.enemyLevel}`]);
      for (const [label, value, tone] of rows) {
        c.add(stat(scene, width / 2, y + 28, label, value, { w: width, tone }));
        y += 64;
      }
      if (needs.short?.capped) {
        const t = text(scene, 0, y + 8, 'Уровней не хватит — нужны копии героев и «Вознести»', T.caption, COLOR.warning, { wordWrap: { width }, align: 'left' }).setOrigin(0, 0);
        c.add(t);
        y += t.height + S.xs;
      }
      y += S.m;
    }
    groups.forEach((g, gi) => {
      const u = g.def;
      const el = defenseElement(u);
      if (gi > 0) {
        c.add(scene.add.rectangle(width / 2, y, width, 2, 0x5c4b31, 0.6));
        y += S.m;
      }
      // Шапка вида: значок стихии, имя ×N, «БОСС».
      let x = 0;
      if (el !== 'neutral') {
        c.add(elementBadge(scene, 28, y + 28, el, 52));
        x = 56 + S.xs;
      }
      const name = text(scene, x, y + 28, `${u.name}${g.count > 1 ? ` ×${g.count}` : ''}`, T.body, u.kind === 'boss' ? COLOR.negative : COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5);
      c.add(name);
      if (u.kind === 'boss') c.add(tag(scene, x + name.width + S.xs, y + 28, 'БОСС', 'negative', { solid: true, align: 'left' }));
      y += 56 + S.xs;
      // Особенности — теги в строку с переносом.
      const traits = enemyTraits(u, CONTENT, cfg);
      const shown = u.kind === 'boss' ? traits : traits.slice(0, 3);
      x = 0;
      for (const tr of shown) {
        const t = tag(scene, 0, 0, tr, traitTone(tr), { align: 'left' });
        if (x > 0 && x + t.width > width) {
          x = 0;
          y += 52 + S.xxs;
        }
        t.setPosition(x + t.width / 2, y + 26);
        c.add(t);
        x += t.width + S.xxs;
      }
      if (shown.length) y += 52 + S.xs;
      // Слабость — чипы стихий; ниже — кто из отряда ею бьёт.
      const weakEls = weakTo(cfg.elements, el);
      if (weakEls.length) {
        const lab = text(scene, 0, y + 28, 'Слабость', T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
        c.add(lab);
        x = lab.width + S.xs;
        for (const w of weakEls) {
          const ch = chip(scene, x, y + 28, (s, cx, cy, size) => elementBadge(s, cx, cy, w, size), elementTitle(w), 'neutral', { size: 's', align: 'left' });
          c.add(ch);
          x += ch.width + S.xxs;
        }
        y += 56 + S.xxs;
        const hitters = [...new Set(heroEls.filter((h) => weakEls.includes(h.el)).map((h) => h.name))];
        const who = text(scene, 0, y + 4, hitters.length ? `Бьёт этим: ${hitters.join(', ')}` : 'В отряде так никто не бьёт', T.caption, hitters.length ? COLOR.positive : COLOR.textTertiary, {
          wordWrap: { width },
          align: 'left',
        }).setOrigin(0, 0);
        c.add(who);
        y += who.height + S.xs;
      }
      y += S.xs;
    });
    return y;
  });
}
