import { readFileSync } from 'node:fs';

/** Размер PNG из заголовка IHDR (без зависимостей). */
export function pngSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  if (b.readUInt32BE(12) !== 0x49484452) throw new Error(`${path}: не PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
