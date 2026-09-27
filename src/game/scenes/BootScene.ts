import Phaser from 'phaser';
import { buildPlaceholders, queueAssets, setupLoadedAssets } from '../assets';
import { assetUrl, bootPack, packPath, revokePack, unpack } from '../assetUrl';
import { buildSkin } from '../skin';
import { CONTENT, GAME } from '../content';
import { heroSprite } from '../flow';
import { session } from '../session';
import { drawBoot } from '../bootLook';
import { queuePortraitFiles, requestPortrait, setupSprites } from '../sprites';
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
    this.failed = 0;
    // Лента, орнамент и полоса с фаской — как HTML-заставка (index.html), она сменяется этим кадром без скачка.
    const { setProgress: drawProgress, label, hint } = drawBoot(this);

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
      if (!this.failed && key !== PACK_KEY) hintText = key;
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
      queuePortraitFiles(this, Object.keys(spriteRoles()));
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
    // Файл из пакета — по blob:-адресу, прочие — WebP-копия, если есть (assetUrl).
    this.load.on('addfile', (key: string, _t: string, _l: unknown, file: Phaser.Loader.File) => {
      if (key === PACK_KEY || typeof file.url !== 'string') return;
      file.url = this.packUrls?.get(packPath(file.url)) ?? assetUrl(file.url);
    });
    this.load.once(`filecomplete-binary-${PACK_KEY}`, (_key: string, _type: string, data: ArrayBuffer) => {
      this.cache.binary.remove(PACK_KEY);
      this.packUrls = unpack(pack, data);
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
    if (this.packUrls) revokePack(this.packUrls);
    this.packUrls = null;
    setupLoadedAssets(this);
    buildSkin(this);
    buildPlaceholders(this);
    setupSprites(this, spriteRoles());
    // Звук (issue #26): шины громкости, заглушки, музыка экранов по старту сцен.
    installAudio(this.game, sceneSoundOf);
    // Небольшой набор портретов сразу: герои игрока (список героев, отряд). Листы для них грузятся по одному
    // и сразу выгружаются — в памяти остаются только портреты. Остальные портреты — по требованию экранов.
    const own = [...new Set(session.save.heroes.map((h) => heroSprite(h, GAME)))];
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      // Перезагрузка на «Глава пройдена» (или на финале главы перед ним) — сразу в кампанию: она доиграет
      // финал из очереди и откроет экран снова.
      this.scene.start(session.save.pendingChapterDone ? 'Campaign' : 'Home');
    };
    void Promise.all(own.map((id) => requestPortrait(this.game, id))).then(go);
    // Сеть подвисла — не держим игрока на экране загрузки: портреты догрузятся на экранах.
    setTimeout(go, 4000);
  }
}
