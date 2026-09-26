import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContentError, buildContent } from '../src/core';
import { loadContent, ROOT } from '../scripts/lib/content-node';
import { generateSchemas } from '../scripts/lib/schemas';
import { skill, unitDef } from './helpers';

const build = (units: object[], skills: object[]) =>
  buildContent(
    units.map((data, i) => ({ file: `u${i}.json`, data })),
    skills.map((data, i) => ({ file: `s${i}.json`, data })),
  );

const problems = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ContentError) return e.problems;
    throw e;
  }
  return [];
};

describe('контент игры', () => {
  it('data/units и data/skills валидны', () => {
    const c = loadContent();
    expect(Object.keys(c.units).length).toBeGreaterThan(0);
  });

  it('JSON-схемы для редактора не устарели (npm run content:schema)', () => {
    for (const [file, body] of Object.entries(generateSchemas())) expect(readFileSync(join(ROOT, file), 'utf8')).toBe(body);
  });
});

describe('buildContent', () => {
  it('ошибка схемы указывает файл и поле', () => {
    const p = problems(() => build([{ ...unitDef('x'), role: 'dps' }], [skill('shot')]));
    expect(p.join('\n')).toMatch(/u0\.json: role/);
  });

  it('ссылка на несуществующий навык', () => {
    expect(problems(() => build([unitDef('x', { skills: { basic: 'nope', passives: [] } })], []))).toEqual([
      'юнит x: skills.basic ссылается на несуществующий навык nope',
    ]);
  });

  it('пассивка без trigger и обычная атака с trigger — ошибки', () => {
    const p = problems(() =>
      build([unitDef('x', { skills: { basic: 'shot', passives: ['aura'] } })], [skill('shot', { trigger: 'hit' }), skill('aura')]),
    );
    expect(p).toContain('юнит x: пассивка aura без trigger');
    expect(p).toContain('юнит x: обычная атака shot не может иметь trigger');
  });

  it('дубликаты id и битый fallback', () => {
    const p = problems(() => build([unitDef('x'), unitDef('x')], [skill('shot', { fallback: 'ghost' })]));
    expect(p.some((s) => s.includes('уже объявлен'))).toBe(true);
    expect(p).toContain('навык shot: fallback ghost не найден');
  });

  it('значения по умолчанию подставляются', () => {
    const c = build([unitDef('x')], [skill('shot')]);
    expect(c.skills.shot).toMatchObject({ range: 'ranged', hits: 1, target: { row: 'any', count: 1 } });
    expect(c.units.x.skills.passives).toEqual([]);
  });
});
