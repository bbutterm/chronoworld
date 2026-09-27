/**
 * `npm run assets:webp` — пересобрать WebP без потерь для всех PNG, которые попадают в dist (tools/build_webp.py).
 * Нужен Python 3 с Pillow (как для остальных tools/*.py). Запускать после замены/добавления арта; без этого
 * сборка просто отдаёт такие файлы как PNG. Подробности — docs/content/performance.md, «Загрузка».
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './lib/content-node';
import { collectUsedAssets } from './lib/used-assets';

const pngs = collectUsedAssets(ROOT).files.filter((f) => f.endsWith('.png'));
const r = spawnSync('python3', [join(ROOT, 'tools/build_webp.py')], { input: pngs.join('\n'), stdio: ['pipe', 'inherit', 'inherit'] });
process.exit(r.status ?? 1);
