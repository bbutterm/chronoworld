/**
 * Production content is validated once during the build, then decoded by native JSON.parse.
 * Dev and tests still build the context at runtime. This module belongs to the Node build only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGameContext, ContentError, parseLore, validateLore, type RawFile, type RawGameData } from '../../src/core';
import { readRawGameData, ROOT } from './content-node';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type ContentPath = (string | number)[];
type SharedReference = [destination: ContentPath, source: ContentPath];

export interface CompiledGameContent {
  /** Standalone ESM: GAME, CONTENT and LORE; no imports or runtime schema validators. */
  code: string;
  /** The same non-blocking lore diagnostics as content:check. */
  warnings: string[];
  stats: {
    /** Validated, deduplicated JSON including the shared-reference table. */
    jsonBytes: number;
    moduleBytes: number;
    sharedReferences: number;
  };
}

/** Keep text input semantics: absent/empty lore is optional; malformed text is a build error. */
export function readLoreFiles(root: string = ROOT): RawFile[] {
  const dir = join(root, 'data/lore');
  return existsSync(dir)
    ? readdirSync(dir).filter((file) => file.endsWith('.json')).sort().map((file) => ({
      file: `data/lore/${file}`,
      data: readFileSync(join(dir, file), 'utf8'),
    }))
    : [];
}

/**
 * JSON.stringify alone loses shared references and silently drops unsupported values.
 * Replace only repeated objects with null, then restore their original aliases after decoding.
 * This also avoids shipping chapter stages and story scene contents twice.
 */
function encodeGraph(value: unknown): { data: JsonValue; references: SharedReference[] } {
  const seen = new WeakMap<object, ContentPath>();
  const ancestors = new Set<object>();
  const references: SharedReference[] = [];
  const fail = (path: ContentPath, reason: string): never => {
    throw new ContentError([`compiled content: ${JSON.stringify(path)} — ${reason}`]);
  };
  const encode = (node: unknown, path: ContentPath): JsonValue => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return node;
    if (typeof node === 'number') {
      if (!Number.isFinite(node) || Object.is(node, -0)) return fail(path, 'число не сохраняется точно в JSON');
      return node;
    }
    if (typeof node !== 'object') return fail(path, `тип ${typeof node} не сохраняется в JSON`);
    if (ancestors.has(node)) return fail(path, 'цикл ссылок не является JSON-контентом');
    const previous = seen.get(node);
    if (previous) {
      references.push([path, previous]);
      return null;
    }
    const array = Array.isArray(node);
    if (Object.getPrototypeOf(node) !== (array ? Array.prototype : Object.prototype)) {
      return fail(path, 'ожидается обычный объект или массив, без Map/Set/Date и пользовательского прототипа');
    }
    const properties = Object.getOwnPropertyDescriptors(node);
    for (const key of Reflect.ownKeys(properties)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') return fail(path, 'символьный ключ не сохраняется в JSON');
      const property = properties[key];
      if (!property.enumerable || !('value' in property)) return fail([...path, key], 'ожидается перечислимое поле данных');
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= node.length)) {
        return fail([...path, key], 'дополнительное поле массива не сохраняется в JSON');
      }
    }
    seen.set(node, path);
    ancestors.add(node);
    let result: JsonValue;
    if (array) {
      if (Object.keys(node).length !== node.length) return fail(path, 'массив с пропусками не сохраняется точно в JSON');
      result = node.map((entry, index) => encode(entry, [...path, index]));
    } else {
      result = Object.fromEntries(Object.entries(properties).map(([key, property]) => [key, encode(property.value, [...path, key])]));
    }
    ancestors.delete(node);
    return result;
  };
  return { data: encode(value, []), references };
}

/** Run the exact game schemas/reference checks, and the existing lore checks, before emitting code. */
export function compileGameContent(raw: RawGameData, loreFiles: readonly RawFile[]): CompiledGameContent {
  const GAME = buildGameContext(raw);
  const parsed = parseLore(loreFiles);
  const loreCheck = validateLore(parsed.lore, {
    content: GAME.content,
    items: GAME.equipment.items,
    tower: GAME.tower,
    hunt: GAME.hunt,
    cards: GAME.cards,
  });
  const problems = [...parsed.problems, ...loreCheck.errors];
  if (problems.length) throw new ContentError(problems);
  const graph = encodeGraph({ GAME, LORE: parsed.lore });
  const json = JSON.stringify(graph);
  // A quoted JSON string cannot turn text, quotes, backticks or ${...} in story data into JS.
  const literal = JSON.stringify(json).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const code = `// Generated from schema-validated content; runtime parsers remain in dev and tests.
const { GAME, LORE } = (() => {
  const { data, references } = JSON.parse(${literal});
  const at = (path) => {
    let node = data;
    for (const key of path) node = node[key];
    return node;
  };
  for (const [destination, source] of references) {
    let parent = data;
    for (let i = 0; i < destination.length - 1; i++) parent = parent[destination[i]];
    parent[destination[destination.length - 1]] = at(source);
  }
  return data;
})();
const CONTENT = GAME.content;
export { GAME, CONTENT, LORE };
`;
  return {
    code,
    warnings: loreCheck.warnings,
    stats: { jsonBytes: Buffer.byteLength(json), moduleBytes: Buffer.byteLength(code), sharedReferences: graph.references.length },
  };
}

/** Disk inputs match scripts/lib/content-node.ts and the browser's eager globs. */
export function compileGameContentFromDisk(root: string = ROOT): CompiledGameContent {
  return compileGameContent(readRawGameData(root), readLoreFiles(root));
}
