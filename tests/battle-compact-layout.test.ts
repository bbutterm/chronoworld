import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { battleResultLayout, battleScreenLayout, chapterDoneLayout, presentedBattleY } from '../src/game/battleScreenLayout';
import { battleSpritePresentation, separateBattleSprites, type BattlePresentedUnit } from '../src/game/battlePresentation';
import { computeView } from '../src/game/viewLayout';
import { scrollLayout } from '../src/game/scroll';
import { normalizeV2, type SpritesV2 } from '../src/pipeline/sprites';

const registry = normalizeV2(JSON.parse(readFileSync('assets/sprites/sprites.json', 'utf8')) as SpritesV2);
const insets = { top: 136, bottom: 34, left: 0, right: 0 };

describe('короткий Telegram: боевые действия и конечные экраны сохраняют CSS-размеры', () => {
  it.each([[360, 640], [390, 844]])('доступные HUD/медальоны и отдельное поле на %s×%s', (w, h) => {
    const v = computeView(w, h, 2, insets, 2, true);
    const scale = v.cssW / v.worldW;
    const touch = Math.max(132, Math.ceil(44 / scale));
    const l = battleScreenLayout(v.uiHeight, v.safeTop, v.safeBottom, touch, true);
    const buttons = ['sound', 'speed', 'auto', 'skip'] as const;
    expect(l.height * scale).toBeGreaterThanOrEqual(44);
    for (const [i, name] of buttons.entries()) {
      const x = l.controls[name], width = l.widths[name];
      expect(width * scale).toBeGreaterThanOrEqual(44);
      expect(l.hudY - l.height / 2).toBeGreaterThanOrEqual(v.safeTop);
      expect(x + width / 2).toBeLessThanOrEqual(1040);
      if (i) {
        const previous = buttons[i - 1];
        expect(x - width / 2).toBeGreaterThan(l.controls[previous] + l.widths[previous] / 2);
      }
    }
    // Existing 180-wide portrait circles remain 60 CSS px on the narrowest phone.
    expect(180 * scale).toBeGreaterThanOrEqual(44);
    expect(1790 + l.panelShift + 108).toBeLessThan(l.bottom);
    expect(l.arena.maxY).toBeLessThan(1790 + l.panelShift - 85);
    const rows = [1090, 1410, 1730].map(y => presentedBattleY(y, l.arena, l.compact, 0));
    expect(rows[0]).toBeGreaterThan(l.arena.minY + 200);
    expect(rows[1] - rows[0]).toBeGreaterThan(200);
    expect(rows[2]).toBeLessThan(l.arena.maxY);
  });

  it.each([[360, 640], [390, 844]])('победа/поражение/глава прокручиваются выше доступных CTA на %s×%s', (w, h) => {
    const v = computeView(w, h, 2, insets, 2, true);
    const result = battleResultLayout(v.uiHeight, v.safeBottom);
    const chapter = chapterDoneLayout(v.uiHeight, v.safeBottom);
    expect(result.row2 + 66).toBeLessThan(v.safeBottom);
    expect(result.row1 + 72).toBeLessThan(result.row2 - 66);
    expect(result.bodyBottom).toBeLessThan(result.row1 - 72);
    expect(chapter.ctaY + 72).toBeLessThan(v.safeBottom);
    expect(chapter.bodyBottom).toBeLessThan(chapter.ctaY - 72);
    for (const endpoint of [result, chapter]) {
      const atEnd = scrollLayout(2800, endpoint.bodyTop, endpoint.bodyBottom, Number.MAX_SAFE_INTEGER);
      expect(atEnd.y + 2800).toBeCloseTo(endpoint.bodyBottom);
      expect(atEnd.height).toBeGreaterThan(600);
    }
  });

  it('изменение Telegram insets сохраняет offset результата и возвращает полное поле', () => {
    const before = battleResultLayout(1920, 1920);
    const during = battleResultLayout(1410, 1410);
    const short = scrollLayout(2400, during.bodyTop, during.bodyBottom, 600);
    const expanded = scrollLayout(2400, before.bodyTop, before.bodyBottom, short.offset);
    expect(expanded.offset).toBe(short.offset);
    const arena = battleScreenLayout(1920, 0, 1920, 96, true).arena;
    expect(presentedBattleY(1410, arena, false, 161)).toBe(1249);
  });

  it('короткое поле использует все анимации Lord и сохраняет исправление BUG158', () => {
    const v = computeView(360, 640, 2, insets, 2, true);
    const l = battleScreenLayout(v.uiHeight, v.safeTop, v.safeBottom, 132, true);
    const make = (id: string, side: 'A' | 'B', x: number, y: number): BattlePresentedUnit => {
      const def = registry.find(s => s.id === id)!;
      const native = Math.min(def.scale, Math.max(0.5, Math.round(def.scale * l.actorFactor * 2) / 2));
      return { side, active: true, faceDir: side === 'A' ? 1 : -1, displayX: x,
        displayY: presentedBattleY(y, l.arena, true, 0), node: { scaleX: 1.12, scaleY: 1.12 },
        presentation: battleSpritePresentation(def, native, l.arena, true) };
    };
    const heroes = [make('knight_m', 'A', 422, 1250), make('sage_f', 'A', 229, 1410), make('priest_f', 'A', 229, 1730)];
    const lord = make('lord_of_death', 'B', 658, 1570);
    const units = [...heroes, lord];
    expect(lord.presentation.scale).toBe(2);
    separateBattleSprites(units, l.arena);
    for (const u of units) {
      const b = u.presentation.animated;
      expect(u.displayY + b.top * u.node.scaleY).toBeGreaterThanOrEqual(l.arena.minY - 1e-6);
      expect(u.displayY + b.bottom * u.node.scaleY).toBeLessThanOrEqual(l.arena.maxY + 1e-6);
    }
    const bossLeft = lord.displayX - lord.presentation.animated.right * lord.node.scaleX;
    for (const hero of heroes) expect(hero.displayX + hero.presentation.body.right * hero.node.scaleX + 20).toBeLessThanOrEqual(bossLeft + 1e-6);
  });
});
