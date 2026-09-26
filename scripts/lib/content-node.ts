import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { buildContent, type Content, type RawFile } from '../../src/core';

export const ROOT = resolve(import.meta.dirname, '../..');

export function readJsonDir(dir: string): RawFile[] {
  const abs = join(ROOT, dir);
  return readdirSync(abs)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = join(abs, f);
      try {
        return { file: relative(ROOT, path), data: JSON.parse(readFileSync(path, 'utf8')) };
      } catch (e) {
        return { file: relative(ROOT, path), data: { __parseError: String(e) } };
      }
    });
}

/** Контент с диска (для CLI и тестов). В браузере — src/game/content.ts через import.meta.glob. */
export function loadContent(): Content {
  return buildContent(readJsonDir('data/units'), readJsonDir('data/skills'));
}
