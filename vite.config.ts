import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { ASSETS_DIR, bootFiles, collectUsedAssets } from './scripts/lib/used-assets.ts';
import { SKIN_REPLACED } from './src/pipeline/bootAssets.ts';

/** WebP-копии PNG без потерь (tools/build_webp.py, `npm run assets:webp`). */
const WEBP_DIR = 'assets-webp';

interface Built {
  /** Нужные файлы из assets/ (пути как в манифесте) — копируются в dist как есть. */
  files: string[];
  /** PNG → байты WebP-копии (только свежие: sha1 PNG совпал с assets-webp/index.json). */
  webp: Map<string, Buffer>;
  packs: Record<'png' | 'webp', { fileName: string; source: Buffer; files: Record<string, [number, number, string]> }>;
}

const MIME: Record<string, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', xml: 'text/xml' };
const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');

/** Собрать всё для dist: нужные файлы, WebP-копии, два варианта пакета загрузки. */
function buildAssets(root: string, warn: (m: string) => void): Built {
  const used = collectUsedAssets(root);
  const files: string[] = [];
  for (const file of used.files) {
    if (existsSync(join(root, ASSETS_DIR, file))) files.push(file);
    else warn(`assets/${file} не найден (ссылки: ${used.refs[file].join(', ')}) — в игре будет плейсхолдер`);
  }
  const index = existsSync(join(root, WEBP_DIR, 'index.json'))
    ? (JSON.parse(readFileSync(join(root, WEBP_DIR, 'index.json'), 'utf8')) as Record<string, { sha1: string; webp: number | null }>)
    : {};
  const webp = new Map<string, Buffer>();
  let stale = 0;
  for (const file of files) {
    const rec = index[file];
    if (!file.endsWith('.png') || !rec?.webp) continue;
    const out = join(root, WEBP_DIR, file.replace(/\.png$/, '.webp'));
    if (rec.sha1 !== sha1(readFileSync(join(root, ASSETS_DIR, file))) || !existsSync(out)) {
      stale++;
      continue;
    }
    webp.set(file, readFileSync(out));
  }
  if (stale) warn(`WebP-копии устарели у ${stale} PNG — они уйдут в игру как PNG; обновить: npm run assets:webp`);
  const boot = bootFiles(root, SKIN_REPLACED).filter((f) => files.includes(f));
  const pack = (variant: 'png' | 'webp') => {
    const parts: Buffer[] = [];
    const map: Record<string, [number, number, string]> = {};
    let offset = 0;
    for (const file of boot) {
      const w = variant === 'webp' ? webp.get(file) : undefined;
      const data = w ?? readFileSync(join(root, ASSETS_DIR, file));
      map[file] = [offset, data.length, w ? MIME.webp : (MIME[file.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream')];
      parts.push(data);
      offset += data.length;
    }
    const source = Buffer.concat(parts);
    return { fileName: `assets/boot-${variant}-${sha1(source).slice(0, 10)}.bin`, source, files: map };
  };
  return { files, webp, packs: { png: pack('png'), webp: pack('webp') } };
}

const VIRTUAL_PACK = 'virtual:asset-pack';

/**
 * O: в dist попадают только ассеты, которые игра может запросить (scripts/lib/used-assets.ts),
 * по тем же относительным путям, что и в assets/ — URL в рантайме не меняются. Отчёт: `npm run assets:report`.
 *
 * Загрузка (docs/content/performance.md): рядом кладутся WebP-копии PNG без потерь (`webp/<путь>.webp`, из assets-webp/,
 * `npm run assets:webp`) и «пакет загрузки» — всё, что грузит BootScene, одним файлом с хэшем в имени (PNG- и
 * WebP-вариант). Модуль `virtual:asset-pack` сообщает игре адреса (src/game/assetUrl.ts). В dev и тестах он пустой.
 */
function assetPackPlugin(): Plugin {
  const root = import.meta.dirname;
  let build = false;
  let built: Built | null = null;
  return {
    name: 'idle-rpg:used-assets',
    configResolved(config) {
      build = config.command === 'build' && !process.env.VITEST;
    },
    resolveId(id) {
      return id === VIRTUAL_PACK ? `\0${VIRTUAL_PACK}` : null;
    },
    load(id) {
      if (id !== `\0${VIRTUAL_PACK}`) return null;
      if (!build) return 'export const PACKS = null;\nexport const WEBP = [];\n';
      built ??= buildAssets(root, (m) => this.warn(m));
      const packs = Object.fromEntries(
        Object.entries(built.packs).map(([k, p]) => [k, { url: p.fileName, bytes: p.source.length, files: p.files }]),
      );
      return `export const PACKS = ${JSON.stringify(packs)};\nexport const WEBP = ${JSON.stringify([...built.webp.keys()])};\n`;
    },
    // Пакет загрузки (WebP-вариант — его берут почти все браузеры) качается параллельно с JS, а не после него:
    // загрузчик BootScene потом получает его из кэша предзагрузки (тот же URL и режим запроса — XHR, same-origin).
    transformIndexHtml() {
      if (!build) return;
      built ??= buildAssets(root, (m) => this.warn(m));
      return [{ tag: 'link', attrs: { rel: 'preload', href: built.packs.webp.fileName, as: 'fetch', type: 'application/octet-stream', crossorigin: '', fetchpriority: 'low' }, injectTo: 'head' }];
    },
    generateBundle() {
      if (!build) return;
      built ??= buildAssets(root, (m) => this.warn(m));
      for (const file of built.files) this.emitFile({ type: 'asset', fileName: file, source: readFileSync(join(root, ASSETS_DIR, file)) });
      for (const [file, data] of built.webp) this.emitFile({ type: 'asset', fileName: `webp/${file.replace(/\.png$/, '.webp')}`, source: data });
      for (const p of Object.values(built.packs)) this.emitFile({ type: 'asset', fileName: p.fileName, source: p.source });
      built = null;
    },
  };
}

/**
 * Из assets/sprites/sprites.json игре нужны классы, анимации и у спрайтов id/class/file/portrait/hitFrames/bbox;
 * остальное — заметки конвейера арта (source*, sourceFrameBboxes, originReconstruction…), ≈ 65 КБ бандла.
 * Их читают только Node-скрипты (content:check, tools) — с диска, не из бандла.
 */
function trimSpritesJson(): Plugin {
  return {
    name: 'idle-rpg:trim-sprites-json',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]assets[\\/]sprites[\\/]sprites\.json$/.test(id)) return null;
      const json = JSON.parse(code) as { notes?: unknown; sprites?: Record<string, unknown>[] };
      delete json.notes;
      for (const s of json.sprites ?? []) {
        for (const k of Object.keys(s)) if (/^source|^originReconstruction$|^samplingExceptions$/.test(k)) delete s[k];
      }
      return { code: JSON.stringify(json), map: null };
    },
  };
}

/**
 * vite preview отдаёт те же заголовки кэша, что Vercel (vercel.json): хэшированные файлы из assets/ — навсегда.
 * Нужен, чтобы `npm run perf:load` честно мерил повторный визит.
 */
function previewCacheHeaders(): Plugin {
  return {
    name: 'idle-rpg:preview-cache',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        next();
      });
    },
  };
}

/**
 * Флаги сборки Phaser из исходников (как DefinePlugin в его webpack-конфиге). Без замены `typeof X` всегда истинно:
 * WEBGL_DEBUG потянул бы отладчик spectorjs, PLUGIN_CAMERA3D — лишний плагин. Canvas оставляем — запасной рендер,
 * если WebGL на телефоне недоступен.
 */
const PHASER_FLAGS: Record<string, boolean> = {
  WEBGL_RENDERER: true,
  CANVAS_RENDERER: true,
  FEATURE_SOUND: true,
  WEBGL_DEBUG: false,
  EXPERIMENTAL: false,
  PLUGIN_CAMERA3D: false,
  PLUGIN_FBINSTANT: false,
};
const PHASER_FLAG_RE = new RegExp(`typeof (${Object.keys(PHASER_FLAGS).join('|')})\\b`, 'g');

function phaserFlags() {
  return {
    name: 'idle-rpg:phaser-flags',
    transform(code: string, id: string) {
      if (!/[\\/]phaser[\\/]src[\\/]/.test(id) || !code.includes('typeof ')) return null;
      const out = code.replace(PHASER_FLAG_RE, (_, k: string) => String(PHASER_FLAGS[k]));
      return out === code ? null : { code: out, map: null };
    },
  };
}

/** Phaser без физики и тайловых карт (src/vendor/phaser-lite.cjs) — и в сборке, и на dev-сервере. */
const PHASER_LITE = join(import.meta.dirname, 'src/vendor/phaser-lite.cjs');

/**
 * Dev-сервер: предсборщик зависимостей Vite не берёт файлы вне node_modules, а сотни CommonJS-модулей Phaser
 * браузер без сборки не загрузит. Поэтому phaser-lite один раз собирается в ESM (node_modules/.cache/phaser-lite,
 * имя — по хэшу входа и версии Phaser) и dev-сервер отдаёт его. e2e и perf так гоняют тот же Phaser, что и прод.
 */
function phaserLiteDev(): Plugin {
  return {
    name: 'idle-rpg:phaser-lite-dev',
    apply: 'serve',
    async config() {
      if (process.env.VITEST) return;
      const root = import.meta.dirname;
      const version = JSON.parse(readFileSync(join(root, 'node_modules/phaser/package.json'), 'utf8')).version as string;
      const hash = createHash('sha1').update(readFileSync(PHASER_LITE)).update(version).update(JSON.stringify(PHASER_FLAGS)).digest('hex').slice(0, 10);
      const outDir = join(root, 'node_modules/.cache/phaser-lite');
      const file = join(outDir, `phaser-lite-${hash}.mjs`);
      if (!existsSync(file)) {
        await build({
          configFile: false,
          logLevel: 'warn',
          plugins: [phaserFlags()],
          build: { lib: { entry: PHASER_LITE, formats: ['es'], fileName: () => `phaser-lite-${hash}.mjs` }, outDir, emptyOutDir: false, minify: false, copyPublicDir: false },
        });
      }
      return { resolve: { alias: [{ find: /^phaser$/, replacement: file }] }, optimizeDeps: { exclude: ['phaser'] } };
    },
  };
}

export default defineConfig(({ command }) => ({
  // Арт лежит в assets/ и отдаётся с корня, пути берутся из assets/manifest.json.
  // В dev отдаём всю папку; при сборке копирует только нужное usedAssetsPlugin.
  publicDir: command === 'build' ? false : 'assets',
  base: './',
  plugins: [phaserLiteDev(), phaserFlags(), trimSpritesJson(), assetPackPlugin(), previewCacheHeaders()],
  resolve: { alias: command === 'build' ? [{ find: /^phaser$/, replacement: PHASER_LITE }] : [] },
  build: {
    // Phaser (≈ 0.9 МБ без физики) — отдельным файлом: он меняется редко, и после обновления игры повторный визит
    // качает только код игры (≈ 0.6 МБ), а Phaser берёт из кэша (хэшированные assets/ кэшируются навсегда, vercel.json).
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'phaser', test: /[\\/]node_modules[\\/]phaser[\\/]|[\\/]src[\\/]vendor[\\/]phaser-lite/ }] } },
    },
  },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
  },
}));
