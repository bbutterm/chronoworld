import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../scripts/lib/content-node';

/**
 * Игра собирается с урезанным Phaser (src/vendor/phaser-lite.cjs, алиас в vite.config.ts): без физики, тайловых карт
 * и плагинов Camera3D / Facebook. Тест ловит две ошибки: код игры начал пользоваться вырезанным модулем (в сборке
 * было бы `undefined`), или в новой версии Phaser появилось пространство имён, которого нет в нашей сборке.
 */
const REMOVED = ['Physics', 'Tilemaps'];

const lite = readFileSync(join(ROOT, 'src/vendor/phaser-lite.cjs'), 'utf8');
const full = readFileSync(join(ROOT, 'node_modules/phaser/src/phaser.js'), 'utf8');
const namespaces = (src: string) => [...src.matchAll(/^\s{4}(\w+): require\(/gm)].map((m) => m[1]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('phaser-lite', () => {
  it('содержит все пространства имён полного Phaser, кроме вырезанных', () => {
    const want = namespaces(full).filter((n) => !REMOVED.includes(n));
    expect(want.length).toBeGreaterThan(25);
    expect(namespaces(lite).sort()).toEqual([...want, 'Sound'].sort());
  });

  it('код игры не использует вырезанные модули', () => {
    const bad = /Phaser\.(Physics|Tilemaps)\b|\.physics\.(add|world)|\b(add|make|load)\.tilemap\w*\(|\bphysics:\s*\{/;
    const hits = sources(join(ROOT, 'src')).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ file, line: i + 1, text: line }))
        .filter((l) => bad.test(l.text)),
    );
    expect(hits.map((h) => `${h.file.slice(ROOT.length + 1)}:${h.line}: ${h.text.trim()}`)).toEqual([]);
  });
});
