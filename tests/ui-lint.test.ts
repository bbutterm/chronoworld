// Храповик линта интерфейса (scripts/ui-lint.ts, правила — docs/content/ui.md): ни один счётчик не растёт.
import { describe, expect, it } from 'vitest';
import { countsOf, growths, lex, loadBaseline, lowered, METRICS, scanAll, scanSource, totalsOf } from '../scripts/ui-lint';

describe('ui-lint: разбор исходника', () => {
  it('комментарии не считаются, строки и шаблоны — считаются', () => {
    const src = [
      "// Нажмите сюда — комментарий, '#ff0000'",
      '/* 0xff0000, toast(scene, x) */',
      "const a = 'Нажмите на героя';",
      'const b = `Коснитесь ${n > 1 ? "чтобы" : \'\'} раз`;',
      "const re = /'#abc/;",
      'const half = w / 2 / 3;',
    ].join('\n');
    const { strings } = lex(src);
    expect(strings.map((s) => s.value)).toContain('Нажмите на героя');
    const c = countsOf(scanSource(src, 'src/game/scenes/X.ts'));
    expect(c.instr).toBe(3);
    expect(c.color).toBe(0);
    expect(c.toast).toBe(0);
  });

  it('цвета, размеры шрифта, главные кнопки, тосты', () => {
    const src = [
      "text(this, 0, 0, 'Имя', 32, '#ffffff');",
      'text(this, 0, 0, `x`, T.body, COLOR.textPrimary);',
      "this.add.text(0, 0, 'a', { fontSize: '28px' });",
      'g.fillStyle(0x1a120a, 1);',
      "button(this, 0, 0, 100, 96, 'ui_btn_primary', 'Ок', () => {}, 40);",
      "button(this, 0, 0, 100, 96, '', 'Ок', () => {}, T.body, { variant: 'primary' });",
      "cta(this, 0, 0, 'В бой', go);",
      "toast(this, 'Не хватает золота', C.error);",
      'export function toast(scene: unknown) {}',
    ].join('\n');
    const c = countsOf(scanSource(src, 'src/game/scenes/X.ts'));
    expect(c).toEqual({ instr: 0, color: 2, fontSize: 3, primary: 3, toast: 1 });
    expect(countsOf(scanSource(src, 'src/game/theme.ts')).color).toBe(0);
  });

  it('--update только опускает линию и не добавляет новые файлы без --add-new', () => {
    const base = { note: '', totals: totalsOf({ 'a.ts': { color: 5, toast: 2 } }), files: { 'a.ts': { color: 5, toast: 2 } } };
    const zero = { instr: 0, color: 0, fontSize: 0, primary: 0, toast: 0 };
    const scan = { files: { 'a.ts': { ...zero, color: 3, toast: 4 }, 'b.ts': { ...zero, color: 1 } }, findings: {} };
    expect(lowered(scan, base, false).files).toEqual({ 'a.ts': { color: 3, toast: 2 } });
    expect(lowered(scan, base, true).files['b.ts']).toEqual({ color: 1 });
    expect(growths(scan, base).map((g) => `${g.file}:${g.metric}`)).toEqual(['a.ts:toast', 'b.ts:color']);
  });
});

describe('ui-lint: базовая линия', () => {
  it('ни один счётчик ни в одном файле экранов не вырос (npm run ui:lint — отчёт, правила — docs/content/ui.md)', () => {
    const grown = growths(scanAll(), loadBaseline()).map((g) => `${g.file}: ${g.metric} ${g.baseline} → ${g.now}`);
    expect(grown).toEqual([]);
  });

  it('итоги в файле линии сходятся с её строками', () => {
    const base = loadBaseline();
    expect(base.totals).toEqual(totalsOf(base.files));
    for (const row of Object.values(base.files)) for (const k of Object.keys(row)) expect(METRICS).toContain(k);
  });
});
