import Phaser from 'phaser';
import { buildPlaceholders, queueAssets, setupLoadedAssets } from '../assets';
import { assetUrl, bootPack, packPath, revokePack, sheetLoader, sheetPiece, sheetSlot, unpack, type SheetSlot } from '../assetUrl';
import { buildSkin } from '../skin';
import { CONTENT, GAME, LORE } from '../content';
import { heroSprite } from '../flow';
import { session } from '../session';
import { BOOT, drawBoot } from '../bootLook';
import { FONT, GAME_W } from '../layout';
import { portraitKey, queuePortraitFiles, requestPortrait, setupSprites } from '../sprites';
import { installAudio } from '../audio';
import { sceneSoundOf } from '../sceneAudio';

/**
 * Все спрайты игры (профессии героев игрока и юниты: герои теста, монстры, боссы) → роль.
 * Роль задаёт цвет и предмет силуэта-плейсхолдера (у Послушника и Торговца пока нет спрайтов).
 */
function spriteRoles(): Record<string, string> {
  const roles: Record<string, string> = {};
  for (const j of Object.values(CONTENT.jobs)) roles[j.visual.sprite] ??= j.role;
  for (const u of Object.values(CONTENT.units)) roles[u.visual.sprite] ??= u.role;
  return roles;
}

/** Картинка загрузчика Phaser в режиме HTMLImageElement (ImageFile): что нужно, чтобы отдать ей готовый canvas. */
type SheetFile = Phaser.Loader.File & { useImageElementLoad?: boolean; load(): void };

/**
 * Значок из листа пакета (scripts/lib/boot-sheets.ts) вместо своей картинки: тот же файл загрузчика и тот же ключ, но
 * данные — canvas, вырезанный из листа (один декод на лист вместо ~200 картинок по blob:-адресам). Дальше всё как
 * у картинки: ImageFile.onProcessImage → текстура под ключом значка, события filecomplete. Лист не загрузился —
 * значок грузится своим файлом, как раньше.
 */
function fromSheet(file: SheetFile, slot: SheetSlot, sheetImage: (sheet: string) => Promise<HTMLImageElement | null>): void {
  const own = file.load;
  const path = file.url as string;
  file.load = () => {
    file.state = Phaser.Loader.FILE_LOADING;
    void sheetImage(slot[0]).then((img) => {
      const piece = img && sheetPiece(img, slot);
      if (!piece) {
        file.load = own;
        file.url = assetUrl(path);
        own.call(file);
        return;
      }
      file.data = piece;
      file.state = Phaser.Loader.FILE_LOADED;
      file.loader.nextFile(file, true);
    });
  };
}

/** Ключ пакета загрузки в загрузчике (прод-сборка, vite.config.ts). */
const PACK_KEY = '__boot_pack';

/**
 * Экран загрузки. Пока ничего не загружено, рисуем маленькими canvas-текстурами (bootLook.ts):
 * лента с названием, полоса прогресса по событиям загрузчика и «Загрузка… N%». Файл не нашёлся — не ошибка:
 * считаем такие файлы, пишем «не загрузилось N — будут заглушки» и идём дальше.
 */
export class BootScene extends Phaser.Scene {
  private failed = 0;
  /** blob:-адреса файлов из пакета загрузки — освобождаются, когда загрузка закончилась. */
  private packUrls: Map<string, string> | null = null;

  constructor() {
    super('Boot');
  }

  preload(): void {
    // Метки фаз для npm run perf:load (scripts/perf-load.mjs печатает все cw:*): пакет пришёл → create → скин → переход.
    performance.mark('cw:boot-preload');
    this.failed = 0;
    // Лента, орнамент и полоса с фаской — как HTML-заставка (index.html), она сменяется этим кадром без скачка.
    const { setProgress: drawProgress, label, hint } = drawBoot(this);
    // Строка из летописи мира вместо совета (lore-route §5.8, data/lore/lines.json → loading): это только вид — Math.random.
    const lines = LORE.lines.loading;
    if (lines.length) {
      const line = lines[Math.floor(Math.random() * lines.length)];
      this.add
        .text(GAME_W / 2, BOOT.hintY + 110, `«${line}»`, { fontFamily: FONT, fontSize: '32px', fontStyle: 'italic', color: '#e8d6ae', align: 'center', wordWrap: { width: 860 }, lineSpacing: 6 })
        .setOrigin(0.5, 0)
        .setName('loadingLine');
    }

    // Надписи перерисовываются не чаще раза в кадр: файлы из пакета приходят пачкой, а каждый setText —
    // перерисовка canvas и загрузка текстуры (на слабом телефоне ~1 мс на надпись).
    let progress = 0;
    let hintText = '';
    const flush = () => {
      drawProgress(progress);
      const text = `Загрузка… ${Math.round(progress * 100)}%`;
      if (label.text !== text) label.setText(text);
      if (hint.text !== hintText) hint.setText(hintText);
    };
    this.game.events.on(Phaser.Core.Events.PRE_RENDER, flush);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(Phaser.Core.Events.PRE_RENDER, flush));
    const setProgress = (p: number) => (progress = p);
    this.load.on('filecomplete', (key: string) => {
      // Имя файла (латиница: tile_grass_dry) — только в dev-сборке; игроку — строка летописи и процент.
      if (import.meta.env.DEV && !this.failed && key !== PACK_KEY) hintText = key;
    });
    // Файл не найден — не страшно, будет плейсхолдер.
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      if (file.key === PACK_KEY) return;
      this.failed++;
      console.warn(`Ассет ${file.key} не загрузился, рисую плейсхолдер`);
      hintText = `Не загрузилось файлов: ${this.failed} — будут заглушки`;
      hint.setColor('#ffb4a0');
    });

    const queueAll = () => {
      queueAssets(this);
      // U: листы юнитов (до 12 МБ каждый в памяти GPU) не грузим — только маленькие файлы портретов.
      // Личные/половые варианты тоже берём до revokePack: их файлы уже могут лежать в пакете загрузки.
      const own = session.save.heroes.map((h) => heroSprite(h, GAME));
      queuePortraitFiles(this, [...new Set([...Object.keys(spriteRoles()), ...own])]);
    };
    const pack = bootPack();
    if (!pack) {
      // dev-сервер: файлы по одному, прогресс — по числу файлов.
      this.load.on('progress', setProgress);
      queueAll();
      return;
    }
    // Прод: сначала пакет загрузки (один запрос, прогресс по байтам — 90 % полосы), затем те же файлы из него
    // по blob:-адресам (без сети). Чего нет в пакете — грузится как раньше. Пакет не загрузился — всё по одному.
    const PACK_SHARE = 0.9;
    this.load.on('fileprogress', (file: Phaser.Loader.File, p: number) => {
      if (file.key === PACK_KEY) setProgress(PACK_SHARE * p);
    });
    const rest = () => {
      let total = 0;
      let done = 0;
      const tick = () => setProgress(PACK_SHARE + (1 - PACK_SHARE) * (total ? ++done / total : 1));
      this.load.on('addfile', () => total++);
      this.load.on('filecomplete', tick);
      this.load.on('loaderror', tick);
    };
    this.load.binary(PACK_KEY, pack.url);
    // Картинки из пакета — сразу в <img> по blob:-адресу, без второго XHR и второго Blob внутри Phaser.
    this.load.imageLoadType = 'HTMLImageElement';
    // Файл из пакета — по blob:-адресу, прочие — WebP-копия, если есть (assetUrl). Значок из листа — вырезается из него.
    let sheetImage: ((sheet: string) => Promise<HTMLImageElement | null>) | null = null;
    this.load.on('addfile', (key: string, _t: string, _l: unknown, file: Phaser.Loader.File) => {
      if (key === PACK_KEY || typeof file.url !== 'string') return;
      const slot = sheetImage ? sheetSlot(pack, file.url) : undefined;
      if (slot && sheetImage && (file as SheetFile).useImageElementLoad) fromSheet(file as SheetFile, slot, sheetImage);
      else file.url = this.packUrls?.get(packPath(file.url)) ?? assetUrl(file.url);
    });
    this.load.once(`filecomplete-binary-${PACK_KEY}`, (_key: string, _type: string, data: ArrayBuffer) => {
      performance.mark('cw:boot-pack');
      this.cache.binary.remove(PACK_KEY);
      this.packUrls = unpack(pack, data);
      sheetImage = sheetLoader(this.packUrls);
      rest();
      queueAll();
    });
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      if (file.key !== PACK_KEY) return;
      console.warn('Пакет загрузки не загрузился — грузим файлы по одному');
      rest();
      queueAll();
    });
  }

  create(): void {
    performance.mark('cw:boot-create');
    if (this.packUrls) revokePack(this.packUrls);
    this.packUrls = null;
    setupLoadedAssets(this);
    buildSkin(this);
    performance.mark('cw:boot-skin');
    buildPlaceholders(this);
    setupSprites(this, spriteRoles());
    // Звук (issue #26): шины громкости, заглушки, музыка экранов по старту сцен.
    installAudio(this.game, sceneSoundOf);
    // Файлы портретов героев уже прошли preload. Если файла нет/он не загрузился, requestPortrait
    // последовательно вырезает портрет из листа и выгружает лист. Остальные портреты — по требованию экранов.
    const own = [...new Set(session.save.heroes.map((h) => heroSprite(h, GAME)))];
    for (const id of own) {
      const key = portraitKey(id);
      if (this.game.textures.exists(key)) this.game.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      performance.mark('cw:boot-done');
      // Игра открывается на странице «Кампания» (как в AFK Arena): карта, сундук и «В бой». Новичку там же — вступление
      // главы; перезагрузка на «Глава пройдена» (или на финале перед ним) — кампания доиграет финал из очереди.
      this.scene.start('Campaign');
    };
    void Promise.all(own.map((id) => requestPortrait(this.game, id))).then(go);
    // Сеть подвисла — не держим игрока на экране загрузки: портреты догрузятся на экранах.
    setTimeout(go, 4000);
  }
}
