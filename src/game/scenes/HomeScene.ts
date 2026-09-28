import Phaser from 'phaser';
import { resetHints } from '../hints';
import { GAME_H, GAME_W, HEADER_H } from '../layout';
import { confirm, popIn, screen } from '../screen';
import { collect, staggerIn } from '../juice';
import { resetProgress, restartOnNewDay } from '../session';
import { button, dangerButton, panel, text, toast } from '../ui';
import { C, FS, OUTLINE, TOUCH } from '../theme';
import { motes, ribbon } from '../decor';
import { fps, motion, nextFpsCap, nextPlaybackSpeed, playback, setFpsCap, setPlaybackSpeed, setReducedMotion } from '../state';
import { lifecycle } from '../lifecycle';
import { version } from '../../../package.json';
import { audioSettings, setAudioSettings, sfx } from '../audio';
import { nextVolume, volumeLabel } from '../audioCore';
import { tavernTile } from '../tavernEntry';
import { shopTile } from '../shopEntry';
import { achievementsTile, questsTile } from '../featureTiles';
import { showUnlockBanners } from '../unlockBanner';
import { homeEventIcons, touchToday } from '../homeEvents';

/**
 * Страница «Город» (вкладка нижней навигации, сцена Home): четыре крупных «здания» 2×2 — Таверна, Лавка, Задания,
 * Достижения (buildingTile в tavernEntry.ts: медальон, название, состояние, пояснение, значок или зелёная точка, замок
 * «Откроется на этапе …»). В шапке — плашка игрока, иконки событий, почты и контракта (homeEvents.ts) и шестерёнка
 * настроек. Сундук, быстрые награды и «В бой» — на странице «Кампания», Башня, экспедиции и охота — «Приключения».
 */
const L = {
  ribbonY: 238,
  tileW: 490,
  tileH: 640,
  tileXL: 286,
  tileXR: 794,
  tileY1: 628,
  tileY2: 1298,
} as const;

/** Инструменты разработчика (тестовый бой): dev-сборка или ?dev=1 в адресе. */
function devTools(): boolean {
  return import.meta.env.DEV || new URLSearchParams(location.search).has('dev');
}

export class HomeScene extends Phaser.Scene {
  constructor() {
    super('Home');
  }

  create(): void {
    restartOnNewDay(this);
    // Сегодняшний вход и системные письма — до шапки и навигации (их значки это учитывают).
    touchToday();
    screen(this, 'Лагерь героев', 'Home', undefined, { settings: () => this.openSettings(), player: true });
    // События новичка, почта и контракт героя — иконки в шапке слева от шестерёнки (homeEvents.ts).
    homeEventIcons(this);
    ribbon(this, GAME_W / 2, L.ribbonY, 'Город', { size: FS.h2, minW: 420 });
    const { tileW: w, tileH: h, tileXL: xl, tileXR: xr, tileY1: y1, tileY2: y2 } = L;
    const rows = [
      collect(this.children, () => {
        tavernTile(this, xl, y1, w, h);
        shopTile(this, xr, y1, w, h);
      }),
      collect(this.children, () => {
        questsTile(this, xl, y2, w, h);
        achievementsTile(this, xr, y2, w, h);
      }),
    ];
    // Живой фон: несколько светлячков медленно поднимаются (без «Уменьшить анимацию»).
    motes(this, { x: 40, y: HEADER_H + 40, w: GAME_W - 80, h: y2 + h / 2 - HEADER_H }, 6);
    staggerIn(this, 'Home', rows);
    // Открылась новая функция (data/unlocks.json) — баннер «Новая функция!», один раз.
    showUnlockBanners(this);
  }

  // ---------- S. Настройки (шестерёнка в шапке) ----------

  /** Модальное окно: скорость боя, тестовый бой, сброс подсказок и прогресса, версия. Касание мимо окна — закрыть. */
  private openSettings(): void {
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const bw = 720;
    const layer = this.add.container(0, 0).setDepth(8500).setName('settingsModal');
    const close = () => layer.destroy();
    const shade = this.add.rectangle(cx, cy, GAME_W, GAME_H, 0x000000, 0.7).setInteractive();
    shade.on('pointerup', close);
    // Само окно тоже ловит нажатия — иначе касание по фону окна закрыло бы его.
    const box = panel(this, cx, cy, 880, 1240, 'ui_panel').setInteractive();
    layer.add([shade, box]);
    layer.add(ribbon(this, cx, cy - 545, 'Настройки', { size: FS.h1, minW: 460 }));

    let y = cy - 430;
    layer.add(text(this, cx - bw / 2, y, 'Скорость боя', FS.h3, C.text, OUTLINE).setOrigin(0, 0.5));
    const speed = button(this, cx + bw / 2 - 110, y, 220, TOUCH, 'ui_btn_secondary', `${playback.speed}x`, () => {
      setPlaybackSpeed(nextPlaybackSpeed());
      speed.setLabel(`${playback.speed}x`);
    }, FS.h2, { repeat: true });
    layer.add(speed.container);
    y += 70;
    layer.add(text(this, cx, y, 'Запоминается; меняется и прямо в бою', FS.small, C.muted));

    // U: ограничение кадров — на слабых телефонах 30 вдвое снижает нагрузку и нагрев; бой не замедляется.
    y += 90;
    layer.add(text(this, cx - bw / 2, y, 'Частота кадров', FS.h3, C.text, OUTLINE).setOrigin(0, 0.5));
    const fpsBtn = button(this, cx + bw / 2 - 110, y, 220, TOUCH, 'ui_btn_secondary', `${fps.cap} FPS`, () => {
      setFpsCap(nextFpsCap());
      lifecycle()?.setFpsCap(fps.cap);
      fpsBtn.setLabel(`${fps.cap} FPS`);
    }, FS.h3, { repeat: true });
    fpsBtn.container.setName('fpsCap');
    layer.add(fpsBtn.container);
    y += 70;
    layer.add(text(this, cx, y, '30 — меньше нагрев и расход батареи', FS.small, C.muted));

    // «Уменьшить анимацию»: без полёта наград, отсчёта чисел, пульса и «выезда» списков (juice.ts).
    y += 90;
    layer.add(text(this, cx - bw / 2, y, 'Уменьшить анимацию', FS.h3, C.text, OUTLINE).setOrigin(0, 0.5));
    const motionBtn = button(this, cx + bw / 2 - 110, y, 220, TOUCH, 'ui_btn_secondary', motion.reduced ? 'Вкл' : 'Выкл', () => {
      setReducedMotion(!motion.reduced);
      motionBtn.setLabel(motion.reduced ? 'Вкл' : 'Выкл');
    }, FS.h3, { repeat: true });
    motionBtn.container.setName('reduceMotion');
    layer.add(motionBtn.container);
    y += 70;
    layer.add(text(this, cx, y, 'Без полёта наград, пульса и «выезда» списков', FS.small, C.muted));

    // Звук (issue #26): громкость музыки и звуков шагами по кругу, «Без звука» — всё молчит (громкости помнятся).
    const volumeRow = (label: string, name: string, get: () => string, change: () => void) => {
      y += 100;
      layer.add(text(this, cx - bw / 2, y, label, FS.h3, C.text, OUTLINE).setOrigin(0, 0.5));
      const btn = button(this, cx + bw / 2 - 110, y, 220, TOUCH, 'ui_btn_secondary', get(), () => {
        change();
        btn.setLabel(get());
        sfx('ui_toggle');
      }, FS.h3, { repeat: true, sound: null });
      btn.container.setName(name);
      layer.add(btn.container);
    };
    volumeRow('Музыка', 'musicVolume', () => volumeLabel(audioSettings.music), () => setAudioSettings({ music: nextVolume(audioSettings.music) }));
    volumeRow('Звуки', 'sfxVolume', () => volumeLabel(audioSettings.sfx), () => setAudioSettings({ sfx: nextVolume(audioSettings.sfx) }));
    volumeRow('Без звука', 'muteAll', () => (audioSettings.muted ? 'Вкл' : 'Выкл'), () => setAudioSettings({ muted: !audioSettings.muted }));

    y += 110;
    // T3-24/T5-26: тестовый бой — инструмент разработчика (dev-сборка или ?dev=1 в адресе), игроку не показываем.
    if (devTools()) {
      layer.add(button(this, cx, y, bw, 110, 'k:buttonLong_beige', 'Тестовый бой', () => this.scene.start('Prep'), FS.h2).container);
      y += 140;
    }
    layer.add(
      button(this, cx, y, bw, 110, 'k:buttonLong_beige', 'Сбросить подсказки', () => {
        resetHints();
        this.scene.restart();
        this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, 'Подсказки покажутся снова'));
      }, FS.h2).container,
    );
    y += 140;
    layer.add(
      dangerButton(this, cx, y, bw, 110, 'Сбросить прогресс', () =>
        confirm(this, 'Сбросить весь прогресс? Герои, этапы, золото и предметы пропадут.', 'Сбросить', () =>
          confirm(this, 'Точно? Отменить будет нельзя.', 'Да, сбросить', () => {
            resetProgress();
            // Новая игра — новичок: подсказки первой сессии снова нужны.
            resetHints();
            this.scene.restart();
          }, { danger: true }),
        { danger: true }),
      FS.h2).container,
    );
    y += 130;
    layer.add(text(this, cx, y, devTools() ? `Версия ${version} · сборка ${import.meta.env.MODE}` : `Chronoworld · версия ${version}`, FS.small, C.dim));
    y += 120;
    layer.add(button(this, cx, y, 460, 120, 'ui_btn_primary', 'Закрыть', close, FS.h2).container);
    // Окно — по содержимому (без тестового боя оно ниже).
    const boxTop = cy - 620;
    const boxH = y + 100 - boxTop;
    box.setSize(880, boxH);
    box.input?.hitArea.setSize(880, boxH);
    const shift = (1240 - boxH) / 2;
    for (const o of layer.list) if (o !== shade && o !== box) (o as unknown as Phaser.GameObjects.Components.Transform).y += shift;
    box.setY(cy);
    popIn(this, layer, shade);
  }
}
