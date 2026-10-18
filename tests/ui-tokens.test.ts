import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { C, COLOR, COLOR_N, E, FAMILY, familyFor, FONT_FACES, FONT_FILES, FS, M, R, S, T, TITLE_STYLE, Z } from '../src/game/theme';
import { collectUsedAssets } from '../scripts/lib/used-assets';

const ROOT = join(import.meta.dirname, '..');

/** Относительная яркость и контраст по WCAG 2.1. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('дизайн-токены (docs/design/ui-polish-research.md §4)', () => {
  it('шкала шрифта: пять размеров по убыванию с шагом 1.13–1.5, меньше T.caption (34) не бывает', () => {
    const sizes = [T.display, T.title, T.heading, T.body, T.caption];
    expect(Math.min(...sizes, ...Object.values(T))).toBe(T.caption);
    expect(T.caption).toBeGreaterThanOrEqual(34);
    for (let i = 1; i < sizes.length; i++) {
      const step = sizes[i - 1] / sizes[i];
      expect(step).toBeGreaterThanOrEqual(1.13);
      expect(step).toBeLessThanOrEqual(1.5);
    }
  });

  it('старые размеры FS — алиасы: не меньше 30, крупные уже на шкале T', () => {
    for (const size of Object.values(FS)) expect(size).toBeGreaterThanOrEqual(30);
    expect(FS.hero).toBe(T.title);
    expect(FS.h1).toBe(T.heading);
    expect(FS.h2).toBe(T.body);
  });

  it('отступы — сетка 8, радиусы и глубины по возрастанию', () => {
    for (const v of Object.values(S)) expect(v % 8).toBe(0);
    expect(R.s).toBeLessThan(R.m);
    expect(R.m).toBeLessThan(R.l);
    expect(R.l).toBeLessThan(R.xl);
    const z = [Z.content, Z.sticky, Z.nav, Z.hint, Z.modal, Z.confirm, Z.toast];
    expect([...z].sort((a, b) => a - b)).toEqual(z);
  });

  it('движение: нажатие быстрее 100 мс, кривые — имена Phaser', () => {
    expect(M.press).toBeLessThan(100);
    expect(M.press).toBeLessThan(M.release);
    expect(M.fast).toBeLessThan(M.base);
    for (const e of Object.values(E)) expect(e).toMatch(/^(Cubic|Quad|Sine|Back)\.ease(In|Out|InOut)$/);
  });

  it('цвета по ролям — #rrggbb (экраны переводят их в числа), числа совпадают', () => {
    for (const [k, v] of Object.entries(COLOR)) {
      expect(v, k).toMatch(/^#[0-9a-f]{6}$/);
      expect(COLOR_N[k as keyof typeof COLOR]).toBe(parseInt(v.slice(1), 16));
    }
    // Старые ключи C — тоже #rrggbb, кроме обводки светлого текста и «без обводки» (#rrggbbaa: полупрозрачные).
    for (const [k, v] of Object.entries(C)) expect(v, k).toMatch(k === 'stroke' || k === 'none' ? /^#[0-9a-f]{8}$/ : /^#[0-9a-f]{6}$/);
  });

  it('контраст текста на поверхности: основной ≥ 12, вторичный ≥ 7, третичный ≥ 4.5 (WCAG AA)', () => {
    expect(contrast(COLOR.textPrimary, COLOR.surface)).toBeGreaterThanOrEqual(12);
    expect(contrast(COLOR.textSecondary, COLOR.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(COLOR.textTertiary, COLOR.surface)).toBeGreaterThanOrEqual(4.5);
    for (const role of ['title', 'positive', 'negative', 'warning', 'info', 'gold', 'gem'] as const) {
      expect(contrast(COLOR[role], COLOR.surface), role).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(COLOR.onAccent, COLOR.accent)).toBeGreaterThanOrEqual(7);
  });
});

describe('гарнитуры', () => {

  it('familyFor: крупный текст и золотые заголовки — заголовочная, остальное — текстовая, явная гарнитура главнее', () => {
    expect(familyFor(T.title)).toBe(FAMILY.heading);
    expect(familyFor(T.display)).toBe(FAMILY.heading);
    expect(familyFor(FS.hero)).toBe(FAMILY.heading);
    expect(familyFor(FS.h1, TITLE_STYLE)).toBe(FAMILY.heading);
    expect(familyFor(FS.h1, { fontStyle: 'bold', stroke: C.titleStroke } as never)).toBe(FAMILY.heading);
    expect(familyFor(FS.h2, TITLE_STYLE)).toBe(FAMILY.heading);
    expect(familyFor(FS.h3, TITLE_STYLE)).toBe(FAMILY.body);
    expect(familyFor(FS.h1)).toBe(FAMILY.body);
    expect(familyFor(FS.caption, { stroke: C.stroke })).toBe(FAMILY.body);
    expect(familyFor(T.display, { fontFamily: 'monospace' })).toBe('monospace');
  });

  it('файлы шрифтов лежат в assets/fonts (woff2, ≤ 40 КБ), с лицензией OFL и попадают в сборку', () => {
    const used = new Set(collectUsedAssets(ROOT).files);
    for (const file of FONT_FILES) {
      const abs = join(ROOT, 'assets', file);
      expect(existsSync(abs), file).toBe(true);
      expect(readFileSync(abs).subarray(0, 4).toString('latin1'), file).toBe('wOF2');
      expect(statSync(abs).size, file).toBeLessThanOrEqual(40 * 1024);
      expect(used.has(file), `${file} в dist`).toBe(true);
    }
    expect(readFileSync(join(ROOT, 'assets/fonts/OFL.txt'), 'utf8')).toContain('SIL Open Font License');
    expect(used.has('fonts/OFL.txt')).toBe(true);
  });

  it('index.html объявляет @font-face и preload для каждого файла', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    for (const file of FONT_FILES) {
      expect(html).toContain(`<link rel="preload" href="${file}" as="font" type="font/woff2" crossorigin />`);
      expect(html).toContain(`src: url('${file}') format('woff2')`);
    }
    for (const face of FONT_FACES) {
      const family = face.split(' ').pop()!;
      expect(html).toContain(`font-family: '${family}'`);
    }
  });
});
