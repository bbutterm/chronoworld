import { openCodes } from '../codesView';
import Phaser from 'phaser';
import { resetHints } from '../hints';
import { GAME_H, GAME_W, HEADER_H } from '../layout';
import { confirm, contentBottom, popIn, screen } from '../screen';
import { collect, staggerIn } from '../juice';
import { restartOnNewDay, session, startOver, today } from '../session';
import { button, dangerButton, ellipsize, panel, text, toast, tutorialHint } from '../ui';
import { cityHint } from '../tutorial';
import { C, COLOR, COLOR_N, FAMILY, FS, OUTLINE, S, T, TOUCH } from '../theme';
import { ribbon } from '../decor';
import { fps, motion, nextFpsCap, nextPlaybackSpeed, playback, setFpsCap, setPlaybackSpeed, setReducedMotion } from '../state';
import { lifecycle } from '../lifecycle';
import { version } from '../../../package.json';
import { audioSettings, setAudioSettings, sfx } from '../audio';
import { hapticSettings, setHapticsOn } from '../haptics';
import { battleSfxLabel, nextVolume, ownMusicLabel, ownMusicToast, volumeLabel } from '../audioCore';
import { tavernTile } from '../tavernEntry';
import { shopTile } from '../shopEntry';
import { compactEntry, ROUND_ICON } from '../homeBuildings';
import { isUnlocked, showUnlockBanners } from '../unlockBanner';
import { homeEventIcons, touchToday } from '../homeEvents';
import { chronicleButton } from '../loreView';
import { friendsButton } from '../online/entry';
import { idleDiorama } from '../idleDiorama';
import { DIORAMA_H } from '../idleDioramaPlan';
import { achievementStatus, heroGender, questStatus } from '../../core';
import { GAME } from '../content';
import { campLevel, claimableAchievements, claimableCount, heroSprite, leadHero } from '../flow';
import { framedPortrait } from '../portraitFrame';

/**
 * Страница «Город» (вкладка нижней навигации, сцена Home) — живой лагерь, как главная AFK Arena:
 * - шапка: компактная плашка игрока (лидер отряда, кольцо уровня лагеря, имя), круглые иконки событий, контракта и
 *   почты (homeEvents.ts) и шестерёнка настроек;
 * - диорама «Отряд в походе» во всю ширину — главный герой экрана (idle-бой отряда с монстрами текущего этапа,
 *   монетки летят в сундук; касание — «Кампания», idleDiorama.ts); на ней слева — «Летопись» (и «Друзья» в Telegram);
 * - «здания» разного размера по важности (homeBuildings.ts): Таверна — большая витрина, Лавка — витрина поуже,
 *   Задания и Достижения — небольшие входы. Без строк-пояснений: состояние — тегом, полоской или числом.
 * Сундук, быстрые награды и «В бой» — на странице «Кампания», Башня, экспедиции и охота — «Приключения».
 */
const L = {
  /** Колонки «зданий»: поля S.l, между карточками S.s. */
  left: S.l,
  width: GAME_W - 2 * S.l,
  gap: S.s,
  /** Доля ширины ряда у Таверны (Лавка — остальное). */
  tavernShare: 0.6,
  /** Высота небольших входов (Задания, Достижения) и пределы высоты витрин. */
  compactH: 168,
  bigMin: 520,
  bigMax: 760,
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
    // Название в шапке не пишем: вкладка «Город» и так подсвечена; место — плашке игрока (playerPlate ниже).
    screen(this, '', 'Home', undefined, { settings: () => this.openSettings() });
    // События, контракт героя и почта — круглые иконки в шапке слева от шестерёнки (homeEvents.ts).
    const iconsLeft = homeEventIcons(this);
    this.playerPlate(iconsLeft - S.xs);

    // Отряд в походе: idle-бой с волнами монстров текущего этапа (касание — к сундуку на «Кампании»).
    const dTop = HEADER_H;
    idleDiorama(this, 0, dTop, { onTap: () => this.scene.start('Campaign') });
    // «Летопись» (лор мира) — круглая иконка в левом верхнем углу диорамы; «Друзья и рекорды» (только в Telegram) — рядом.
    const iy = dTop + S.s + ROUND_ICON.size / 2;
    chronicleButton(this, L.left + ROUND_ICON.size / 2 - 8, iy);
    friendsButton(this, L.left + ROUND_ICON.size + S.s + 130 - 8, iy, 260, 96);

    // «Здания»: высота витрин — по месту до навигации (вытянутый экран — выше), лишнее — поровну в отступы.
    const top = dTop + DIORAMA_H + S.xxs;
    const bottom = contentBottom();
    const free = bottom - top - L.compactH - L.gap;
    const bigH = Phaser.Math.Clamp(free, L.bigMin, L.bigMax);
    const pad = Math.max(0, (free - bigH) / 3);
    const bigY = top + pad + bigH / 2;
    const tw = Math.round((L.width - L.gap) * L.tavernShare);
    const sw = L.width - L.gap - tw;
    const tavern = { x: L.left + tw / 2, y: bigY, w: tw, h: bigH };
    const cw = (L.width - L.gap) / 2;
    const cy = bigY + bigH / 2 + L.gap + pad + L.compactH / 2;
    const quests = { x: L.left + cw / 2, y: cy, w: cw, h: L.compactH };
    const rows = [
      collect(this.children, () => {
        tavernTile(this, tavern.x, tavern.y, tavern.w, tavern.h);
        shopTile(this, GAME_W - L.left - sw / 2, bigY, sw, bigH);
      }),
      collect(this.children, () => {
        this.questsEntry(quests.x, cy, cw, L.compactH);
        this.achievementsEntry(GAME_W - L.left - cw / 2, cy, cw, L.compactH);
      }),
    ];
    staggerIn(this, 'Home', rows);
    // Открылась новая функция (data/unlocks.json) — баннер «Новая функция!», один раз.
    // Ведущее обучение (tutorial.ts): Таверна ×10, затем задания — указатель на «здание» (после баннера).
    showUnlockBanners(this, () => {
      const id = cityHint(session.save);
      if (id === 'tavern_summon') tutorialHint(this, id, tavern.x, tavern.y, 'above', { w: tavern.w, h: tavern.h });
      if (id === 'quests_open') tutorialHint(this, id, quests.x, quests.y, 'above', { w: quests.w, h: quests.h });
    });
  }

  /**
   * Плашка игрока в шапке (как в AFK Arena, компактно): лидер отряда в рамке, уровень лагеря — число в медальоне
   * с кольцом опыта до следующего уровня (flow.ts campLevel), имя лагеря. Места — от левого поля до right.
   */
  private playerPlate(right: number): void {
    const save = session.save;
    const lead = leadHero(save);
    const cy = HEADER_H / 2;
    const size = 112;
    const ax = L.left + size / 2 - 8;
    framedPortrait(this, ax, cy, lead ? heroSprite(lead, GAME) : null, size, lead ? heroGender(lead, GAME) : undefined).setName('playerAvatar');
    const lv = campLevel(save);
    // Медальон уровня в правом нижнем углу портрета; кольцо вокруг — опыт лагеря до следующего уровня.
    const mx = ax + size / 2 - 6;
    const my = cy + size / 2 - 18;
    const r = 26;
    const g = this.add.graphics();
    g.fillStyle(COLOR_N.surfaceSunken, 1).fillCircle(mx, my, r + 6);
    g.lineStyle(5, COLOR_N.border, 1).strokeCircle(mx, my, r + 2);
    const frac = Phaser.Math.Clamp(lv.exp / lv.need, 0, 1);
    if (frac > 0) {
      g.lineStyle(5, COLOR_N.accent, 1).beginPath();
      g.arc(mx, my, r + 2, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
      g.strokePath();
    }
    text(this, mx, my, String(lv.level), lv.level >= 100 ? T.caption - 6 : T.caption, COLOR.title, { fontStyle: 'bold' }).setName('campLevel');
    const tx = mx + r + S.s;
    const w = right - tx;
    // Мало места (9:16 с контрактом и событиями) — только портрет и уровень.
    if (w < 120) return;
    const nm = text(this, tx, cy, 'Лагерь героев', T.body, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
    nm.setShadow(0, 3, 'rgba(0,0,0,0.7)', 3, true, true);
    ellipsize(nm, w);
  }

  /** Задания дня: полоска активности; красное число — сколько наград можно забрать. */
  private questsEntry(x: number, y: number, w: number, h: number): void {
    const open = isUnlocked('quests');
    const qs = questStatus(session.save, GAME, today());
    compactEntry(this, x, y, w, h, {
      name: 'questsTile',
      title: 'Задания',
      icon: 'scroll',
      open,
      lockId: 'quests',
      onOpen: () => this.scene.start('Quests'),
      bar: qs.maxActivity > 0 ? qs.activity / qs.maxActivity : 0,
      badge: open ? claimableCount(qs) : 0,
    });
  }

  /** Достижения: «получено / всего»; красное число — сколько можно забрать. */
  private achievementsEntry(x: number, y: number, w: number, h: number): void {
    const open = isUnlocked('achievements');
    const views = achievementStatus(session.save, GAME);
    compactEntry(this, x, y, w, h, {
      name: 'achievementsTile',
      title: 'Достижения',
      icon: 'trophy',
      open,
      lockId: 'achievements',
      onOpen: () => this.scene.start('Achievements', { from: 'Home' }),
      status: { text: `${views.filter((a) => a.claimed).length} / ${views.length}` },
      badge: open ? claimableAchievements(views) : 0,
    });
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

    // Звук (issue #26): громкость музыки и звуков шагами по кругу, «Звуки боя» вкл/выкл, «Без звука» — всё молчит (громкости помнятся).
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
    // «Своя музыка»: игрок слушает Spotify / Яндекс Музыку — музыка игры не играет и не забирает у них звук (audio.ts).
    volumeRow('Своя музыка', 'ownMusic', () => ownMusicLabel(audioSettings), () => {
      setAudioSettings({ ownMusic: !audioSettings.ownMusic, ownMusicHint: true });
      toast(this, ownMusicToast(audioSettings), undefined, 3000);
    });
    volumeRow('Музыка', 'musicVolume', () => volumeLabel(audioSettings.music), () => setAudioSettings({ music: nextVolume(audioSettings.music) }));
    volumeRow('Звуки', 'sfxVolume', () => volumeLabel(audioSettings.sfx), () => setAudioSettings({ sfx: nextVolume(audioSettings.sfx) }));
    // Та же настройка, что значок динамика в верхней панели боя: удары, навыки и смерти (музыка и интерфейс звучат).
    volumeRow('Звуки боя', 'battleSfx', () => battleSfxLabel(audioSettings), () => setAudioSettings({ battleSfx: !audioSettings.battleSfx }));
    volumeRow('Без звука', 'muteAll', () => (audioSettings.muted ? 'Вкл' : 'Выкл'), () => setAudioSettings({ muted: !audioSettings.muted }));
    // Вибрация (Telegram HapticFeedback, на Android вне Telegram — vibrate; haptics.ts).
    volumeRow('Вибрация', 'haptics', () => (hapticSettings.on ? 'Вкл' : 'Выкл'), () => setHapticsOn(!hapticSettings.on));

    y += 110;
    // T3-24/T5-26: тестовый бой — инструмент разработчика (dev-сборка или ?dev=1 в адресе), игроку не показываем.
    if (devTools()) {
      layer.add(button(this, cx, y, bw, 110, 'k:buttonLong_beige', 'Тестовый бой', () => this.scene.start('Prep'), FS.h2).container);
      y += 140;
    }
    // Коды (data/codes.json): алмазы, часы вперёд — вместо кнопок тестировщика «+300 гемов» / «+12 ч». В ряд со сбросом
    // подсказок: окно и так во весь экран 9:16.
    const half = (bw - S.s) / 2;
    const codesBtn = button(this, cx - (half + S.s) / 2, y, half, 110, 'k:buttonLong_beige', 'Коды', () => {
      close();
      openCodes(this, () => this.scene.restart());
    }, FS.h2);
    codesBtn.container.setName('codesBtn');
    layer.add(codesBtn.container);
    layer.add(
      button(this, cx + (half + S.s) / 2, y, half, 110, 'k:buttonLong_beige', 'Сброс подсказок', () => {
        resetHints();
        this.scene.restart();
        this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, 'Подсказки покажутся снова'));
      }, FS.h3).container,
    );
    y += 140;
    layer.add(
      dangerButton(this, cx, y, bw, 110, 'Начать заново', () =>
        confirm(this, 'Весь прогресс будет удалён: герои, этапы, золото и предметы. Настройки звука, вибрации и скорости боя останутся. Начать игру с самого начала?', 'Удалить', () =>
          confirm(this, 'Точно? Отменить будет нельзя.', 'Да, заново', () => {
            // Чистое сохранение, сдвиг часов тестировщика и ключи прогресса — в ноль (настройки звука, вибрации и скорости остаются); перезагрузка → вступление главы 1.
            startOver();
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
