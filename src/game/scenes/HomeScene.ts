import Phaser from 'phaser';
import { hasArt } from '../assets';
import { achievementStatus, heroesWithGearUpgrades, stageStatus, actClaimOffline, actUseFastRewards, fastRewardsLoot, fastRewardsPreview, fastRewardsStatus, offlineRewards, questStatus, towerStatus } from '../../core';
import { GAME } from '../content';
import { claimableAchievements, claimableCount, currentStage, describeEvents, finishedBounties, formatNumber, levelUpReady, powerCheck } from '../flow';
import { HINT_TEXT, markHint, pickHomeHint, resetHints, type HintId } from '../hints';
import { GAME_H, GAME_W, HEADER_H } from '../layout';
import { card, confirm, confirmOpen, cornerBadge, gemIcon, NAV_H, popIn, powerChip, screen } from '../screen';
import { afterRewardFly, collect, pulse, queueRewardFly, staggerIn } from '../juice';
import { commit, now, resetProgress, restartOnNewDay, session, today } from '../session';
import { button, dangerButton, hintPointer, icon, panel, pressable, text, toast } from '../ui';
import { C, FS, OUTLINE, TINT, TITLE_STYLE, TOUCH } from '../theme';
import { SKIN, SKIN_TINT, skinIcon, type SkinIcon } from '../skin';
import { ctaShine, glow, medallion, motes, ribbon, slowRays } from '../decor';
import { fps, motion, nextFpsCap, nextPlaybackSpeed, playback, setFpsCap, setPlaybackSpeed, setReducedMotion } from '../state';
import { lifecycle } from '../lifecycle';
import { version } from '../../../package.json';
import { audioSettings, setAudioSettings, sfx } from '../audio';
import { nextVolume, volumeLabel } from '../audioCore';
import { tavernTile } from '../tavernEntry';
import { homeEventIcons } from '../homeEvents';
import { ChestCardView, chestHeadline, lootLines, lootSummary } from '../chestView';

/** Размер сундука офлайн-наград. */
const CHEST = 180;

/** Кнопка быстрых наград (центр по x). */
const FAST_BTN_X = 840;

/**
 * Раскладка главной (S): сундук, быстрые награды, плитки 2×2, «В кампанию». Между блоками оставлено место,
 * чтобы плашка подсказки (≈125 ед. от края цели) вставала, не закрывая другие кнопки:
 * над плиткой «Башня» — до кнопки быстрых наград, под «В кампанию» и над навигацией — свободная полоса.
 */
const L = {
  chestY: 390,
  chestH: 440,
  claimY: 530,
  /** Сундук слева в карточке, текст и «Собрать» — справа от него (как панель наград AFK Arena). */
  chestX: 200,
  chestIconY: 380,
  claimX: 600,
  claimW: 420,
  /** Строки «Накоплено…» — во всю ширину над медальоном Таверны; подпись и «Собрать» — левее медальона. */
  chestTextX: 640,
  /** Медальон Таверны — справа внизу карточки сундука, под строками накопленного (не перекрывает текст). */
  tavernX: 925,
  tavernY: 470,
  fastY: 825,
  fastH: 230,
  /** Кнопка быстрых наград чуть выше центра карточки: над плиткой «Башня» остаётся место для подсказки. */
  fastBtnY: 814,
  tileW: 500,
  tileH: 170,
  tileXL: 280,
  tileXR: 800,
  tileY1: 1085,
  tileY2: 1271,
  campaignY: 1444,
  campaignH: 130,
} as const;

/**
 * Главная: сундук офлайн-наград, быстрые награды (K1), плитки задания (K5) / башня (K4) / поручения (K9) / достижения (K10), кампания.
 * Тестовый бой, сброс подсказок и прогресса — в настройках (шестерёнка в шапке, S).
 */
/** Инструменты разработчика (тестовый бой): dev-сборка или ?dev=1 в адресе. */
function devTools(): boolean {
  return import.meta.env.DEV || new URLSearchParams(location.search).has('dev');
}

export class HomeScene extends Phaser.Scene {
  private chestText!: Phaser.GameObjects.Text;
  /** Иконки накопленного и таймер «Полон через» (chestView.ts). */
  private chestView?: ChestCardView;
  private chestImg?: Phaser.GameObjects.Image;
  private chestRays?: Phaser.GameObjects.Image;
  private chestGlow?: Phaser.GameObjects.Image;
  private claimBtn!: ReturnType<typeof button>;
  /** Сколько поручений было завершено при отрисовке плитки (раз в секунду сверяем — значок не отстаёт). */
  private bountiesDone = 0;
  /** R: показанная подсказка (одна за раз) и её указатель. */
  private hintId: HintId | null = null;
  private hintView: Phaser.GameObjects.Container | null = null;
  /** Объекты блоков главной (сундук, быстрые награды, ряды плиток) — для «выезда» при первом открытии. */
  private blocks: Phaser.GameObjects.GameObject[][] = [];
  /** «Собрать» уже пульсирует (сундук не пуст). */
  private claimPulsing = false;

  constructor() {
    super('Home');
  }

  create(): void {
    this.hintId = null;
    this.hintView = null;
    this.blocks = [];
    // Сцена-синглтон живёт всю игру: после выхода с главной не держать её уничтоженные объекты (npm run perf — «dead»).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.blocks = [];
      this.hintView = null;
      this.chestImg = undefined;
      this.chestView = undefined;
      this.chestRays = undefined;
      this.chestGlow = undefined;
      this.chestText = undefined as unknown as Phaser.GameObjects.Text;
      this.claimBtn = undefined as unknown as ReturnType<typeof button>;
    });
    this.claimPulsing = false;
    restartOnNewDay(this);
    screen(this, 'Лагерь героев', 'Home', undefined, { settings: () => this.openSettings(), player: true });
    this.blocks.push(collect(this.children, () => this.chest()));
    // H5: вход в Таверну — медальон в правом нижнем углу карточки сундука (tavernEntry.ts), под строками накопленного.
    tavernTile(this, L.tavernX, L.tavernY);
    // События новичка и почта — иконки в шапке слева от шестерёнки (homeEvents.ts).
    homeEventIcons(this);
    this.blocks.push(collect(this.children, () => this.fastRewards()));
    this.tiles();

    const cur = currentStage(session.save, GAME);
    const campaign = collect(this.children, () => {
      // Главная кнопка экрана: тёплый ореол, скрещённые мечи у подписи и пробегающий блик (как CTA в AFK Arena).
      glow(this, GAME_W / 2, L.campaignY, 980, 0xffc860, 0.22, true).setScale(980 / 128, 260 / 128);
      const cta = button(this, GAME_W / 2, L.campaignY, 780, L.campaignH, 'ui_btn_primary', cur ? `В кампанию · этап ${cur.globalIndex + 1}` : 'В кампанию', () => {
        markHint('home_campaign');
        this.scene.start('Campaign');
      }, FS.h1);
      // «Почти готово»: мощь отряда против рекомендуемой для следующего этапа — плашкой внизу кнопки.
      const open = cur && stageStatus(session.save, cur.id, GAME) === 'open';
      const labelY = open ? -24 : -4;
      cta.label.setPosition(32, labelY);
      cta.container.add(this.add.image(32 - cta.label.width / 2 - 44, labelY, skinIcon('swords')).setDisplaySize(58, 58).setTint(0x3a2408));
      ctaShine(this, cta.container, 780, L.campaignH);
      if (open) cta.container.add(powerChip(this, 0, 30, powerCheck(session.save, cur.id, GAME), { minW: 420 }));
    });
    // Живой фон: несколько светлячков медленно поднимаются (без «Уменьшить анимацию»).
    motes(this, { x: 40, y: HEADER_H + 40, w: GAME_W - 80, h: L.campaignY - HEADER_H }, 7);

    // Подсказка строится по настоящим местам кнопок — до «выезда» блоков.
    this.refresh();
    staggerIn(this, 'Home', [...this.blocks, campaign]);
    // Сундук считаем раз в секунду, а не каждый кадр.
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.refresh() });
  }

  // ---------- сундук ----------

  private chest(): void {
    const y = L.chestY;
    card(this, GAME_W / 2, y, 1000, L.chestH);
    const cx = L.chestX;
    const cy = L.chestIconY;
    // Подложка под сундуком — тёмная ниша, чтобы лучи и сундук читались «в рамке».
    this.add.image(cx, cy, 'skin_glow').setDisplaySize(330, 330).setTint(0x000000).setAlpha(0.5);
    if (hasArt('ui_chest_empty')) {
      // За сундуком — медленные лучи и ореол, пока в нём что-то есть (refresh включает).
      this.chestRays = slowRays(this, cx, cy, 300, 0.55).setVisible(false);
      this.chestGlow = glow(this, cx, cy + 10, 240, 0xffd27a, 0.5, true).setVisible(false);
      // Сундук: пустой / наполняется / полный (текстура меняется в refresh).
      this.chestImg = this.add.image(cx, cy, 'ui_chest_empty').setDisplaySize(CHEST, CHEST);
    } else {
      // Нет арта — рамка из атласа, «крышка» и замок.
      card(this, cx, cy + 10, 220, 110, true);
      this.add.rectangle(cx, cy - 28, 220, 34, 0x8a5a2b).setStrokeStyle(6, 0x3a2412);
      icon(this, cx, cy + 18, 'iconCircle_brown', 56).setTint(TINT.gold);
    }
    // Лента-заголовок у верхней кромки карточки (поверх лучей).
    ribbon(this, GAME_W / 2, y - L.chestH / 2 + 46, 'Сундук офлайн-наград', { minW: 600, size: FS.h3 });
    this.chestText = text(this, L.chestTextX, y - 108, '', FS.body, C.text, { lineSpacing: 8, ...OUTLINE });
    // Золото и опыт, трофеи (предметы, осколки, гемы, свитки) иконками и «Полон через Ч:ММ» (лимит — capHours).
    this.chestView = new ChestCardView(this, { incomeX: L.chestTextX, incomeY: y - 58, lootX: L.claimX, lootY: y - 12, timerX: L.claimX, timerY: y + 30 });
    this.chestView.update(session.save, now());
    this.claimBtn = button(this, L.claimX, L.claimY, L.claimW, TOUCH + 10, 'ui_btn_primary', 'Собрать', () => this.claim(), FS.h2);
  }

  private refresh(): void {
    const r = this.chestView?.update(session.save, now()) ?? offlineRewards(session.save, now(), GAME);
    const full = r.gold > 0 || r.jobExp > 0;
    // Есть накопленное — заголовок в одну строку над иконками; иначе две строки пояснения чуть ниже ленты.
    this.chestText.setText(chestHeadline(r, session.save.campaign.cleared.length)).setY(L.chestY + (full ? -108 : -76));
    this.claimBtn.setEnabled(full);
    // Есть что собрать — кнопка мягко пульсирует (один раз запускаем; пустой сундук бывает только после сбора — это перезапуск).
    if (full && !this.claimPulsing) {
      this.claimPulsing = true;
      pulse(this, this.claimBtn.container);
    }
    if (this.chestImg) {
      const capMin = GAME.progression.offline.capHours * 60;
      const state = r.gold === 0 && r.jobExp === 0 ? 'empty' : r.minutes >= capMin * 0.9 ? 'full' : 'filling';
      this.chestImg.setTexture(`ui_chest_${state}`).setDisplaySize(CHEST, CHEST);
      this.chestRays?.setVisible(state !== 'empty');
      this.chestGlow?.setVisible(state !== 'empty');
    }
    this.updateHint(r.gold > 0 || r.jobExp > 0);
    // Поручение завершилось, пока игрок на главной, — обновить плитку и значок.
    // Не при открытом окне (настройки, подтверждение): перезапуск молча закрыл бы его — обновим, когда закроют.
    const modal = !!this.children.getByName('settingsModal') || confirmOpen(this);
    if (!modal && finishedBounties(session.save, now()) !== this.bountiesDone) this.scene.restart();
  }

  private claim(): void {
    const r = actClaimOffline(session.save, now(), today(), GAME);
    if (r.rewards.gold === 0 && r.rewards.jobExp === 0) {
      // T4-06: пустой сбор всё равно записывается — ядро сдвигает якорь сундука (часы переводили).
      commit(r.save);
      toast(this, 'Сундук пока пуст');
      return;
    }
    const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
    commit(r.save);
    markHint('chest_claim');
    // Монеты вылетают из сундука и летят в золото в шапке (juice.ts).
    queueRewardFly('Home', { x: L.chestX, y: L.chestIconY }, before, { burst: true });
    this.restartWithToast([`Собрано: золото +${formatNumber(r.rewards.gold)}, опыт +${formatNumber(r.rewards.jobExp)}`, ...lootLines(r.loot), ...describeEvents(r.events, r.save, GAME)]);
  }

  // ---------- R. Подсказки первой сессии ----------

  /** Одна подсказка на следующем полезном действии; пересчитывается раз в секунду (сундук наполняется). */
  private updateHint(chestHasIncome: boolean): void {
    const save = session.save;
    const id = pickHomeHint({
      cleared: save.campaign.cleared.length,
      chestHasIncome,
      levelUpReady: levelUpReady(save, GAME).length > 0,
      towerUnlocked: towerStatus(save, GAME).unlocked,
      gearUpgrade: heroesWithGearUpgrades(save, GAME).length > 0,
    });
    if (id === this.hintId) return;
    this.hintView?.destroy();
    this.hintView = null;
    this.hintId = id;
    if (!id) return;
    const msg = HINT_TEXT[id];
    // Сторону плашки выбирает hintPointer (S): так, чтобы не закрыть другие кнопки и плитки.
    if (id === 'home_campaign') this.hintView = hintPointer(this, GAME_W / 2, L.campaignY, msg, 'below', { w: 780, h: L.campaignH });
    if (id === 'chest_claim') this.hintView = hintPointer(this, L.claimX, L.claimY, msg, 'below', { w: L.claimW, h: TOUCH + 10 });
    if (id === 'tower_open') this.hintView = hintPointer(this, L.tileXR, L.tileY1, msg, 'above', { w: L.tileW, h: L.tileH });
    // Вкладка «Герои» — средняя в нижней навигации.
    if (id === 'level_up' || id === 'equip_gear') this.hintView = hintPointer(this, GAME_W / 2, GAME_H - NAV_H / 2 + 4, msg, 'above', { w: GAME_W / 3 - 30, h: NAV_H - 40 });
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

  // ---------- K1. Быстрые награды ----------

  private fastRewards(): void {
    const save = session.save;
    const hours = GAME.features.fastRewards.hours;
    const preview = fastRewardsPreview(save, GAME);
    const st = fastRewardsStatus(save, today(), GAME);
    const y = L.fastY;
    card(this, GAME_W / 2, y, 1000, L.fastH);
    // Медальон с песочными часами слева, тексты — правее него.
    medallion(this, 120, y - 10, 120, 'hourglass');
    const tx = 200;
    text(this, tx, y - 72, `Быстрые награды · ${hours} ч`, FS.h2, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5);
    const noIncome = preview.gold <= 0 && preview.jobExp <= 0;
    text(
      this,
      tx,
      y - 6,
      noIncome ? 'Откроются после этапа 1' : `+${formatNumber(preview.gold)} золота, +${formatNumber(preview.jobExp)} опыта в запас`,
      FS.body,
      C.text,
      { align: 'left', wordWrap: { width: 490 }, stroke: C.stroke, strokeThickness: 4 },
    ).setOrigin(0, 0.5);
    const left = st.nextCost === null ? 'На сегодня всё — приходите завтра' : `Осталось сегодня: ${st.usesLeft} · бесплатно ${st.freeLeft}`;
    text(this, tx, y + 72, left, FS.small, C.muted, { wordWrap: { width: 490 }, align: 'left' }).setOrigin(0, 0.5);

    const bx = FAST_BTN_X;
    const label = st.nextCost === null ? 'Лимит' : st.nextCost === 0 ? 'Бесплатно' : formatNumber(st.nextCost);
    const btn = button(this, bx, L.fastBtnY, 280, 110, st.nextCost === 0 ? 'ui_btn_primary' : 'ui_btn_secondary', label, () => this.useFast(), FS.h3);
    if (st.nextCost !== null && st.nextCost > 0) {
      // Цена: ромб гема + число.
      btn.label.setX(22);
      btn.container.add(gemIcon(this, 22 - btn.label.width / 2 - 30, -4, 36));
    }
    if (st.nextCost === null || noIncome) btn.setEnabled(false);
    // Бесплатные быстрые награды — готовы к получению: пульс, как у «Собрать».
    else if (st.nextCost === 0) pulse(this, btn.container);
  }

  private useFast(): void {
    const save = session.save;
    const day = today();
    const st = fastRewardsStatus(save, day, GAME);
    const preview = fastRewardsPreview(save, GAME);
    if (st.nextCost === null) {
      toast(this, 'Быстрые награды на сегодня закончились');
      return;
    }
    if (preview.gold <= 0 && preview.jobExp <= 0) {
      toast(this, 'Пройдите хотя бы один этап кампании, чтобы получать быстрые награды');
      return;
    }
    const price = st.nextCost === 0 ? 'Бесплатно.' : `Цена: ${formatNumber(st.nextCost)} гемов (у вас ${formatNumber(save.currency.gems)}).`;
    const loot = lootSummary(fastRewardsLoot(save, day, GAME));
    const q = `Забрать ${GAME.features.fastRewards.hours} ч дохода сразу?\nЗолото +${formatNumber(preview.gold)}, опыт +${formatNumber(preview.jobExp)} в запас.${loot ? `\n${loot}` : ''}\n${price}`;
    confirm(this, q, 'Забрать', () => {
      try {
        const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
        const r = actUseFastRewards(session.save, day, GAME);
        commit(r.save);
        queueRewardFly('Home', { x: FAST_BTN_X, y: L.fastBtnY }, before);
        this.restartWithToast([`Быстрые награды: золото +${formatNumber(r.rewards.gold)}, опыт +${formatNumber(r.rewards.jobExp)}`, ...lootLines(r.loot), ...describeEvents(r.events, r.save, GAME)]);
      } catch (e) {
        toast(this, e instanceof Error ? e.message : String(e), C.error);
      }
    });
  }

  // ---------- Плитки 2×2: задания, башня, поручения, достижения ----------

  private tiles(): void {
    const save = session.save;
    const [y1, y2] = [L.tileY1, L.tileY2];
    const [xl, xr] = [L.tileXL, L.tileXR];
    const qs = questStatus(save, GAME, today());
    const row1 = collect(this.children, () => {
      this.tile(xl, y1, 'Задания', `Активность ${qs.activity} / ${qs.maxActivity}`, C.success, () => this.scene.start('Quests'), 'scroll');
      this.towerTile(xr, y1);
    });
    const row2 = collect(this.children, () => {
      const done = finishedBounties(save, now());
      const active = save.bounties.active.length;
      const bsub = done ? `Готово: ${done} — заберите` : active ? `В работе: ${active}` : 'Отправьте героев';
      this.tile(xl, y2, 'Поручения', bsub, done ? C.success : C.muted, () => this.scene.start('Bounties'), 'flag');
      this.bountiesDone = done;

      const views = achievementStatus(save, GAME);
      const got = views.filter((a) => a.claimed).length;
      this.tile(xr, y2, 'Достижения', `Получено ${got} / ${views.length}`, C.info, () => this.scene.start('Achievements', { from: 'Home' }), 'trophy');
    });
    this.blocks.push(row1, row2);
    // Значки — после «выезда» плиток на своих местах (не в группах): в правом верхнем углу, как у вкладки «Герои».
    cornerBadge(this, xl, y1, L.tileW, L.tileH, claimableCount(qs));
    cornerBadge(this, xl, y2, L.tileW, L.tileH, this.bountiesDone);
    cornerBadge(this, xr, y2, L.tileW, L.tileH, claimableAchievements(achievementStatus(save, GAME)));
  }

  private towerTile(xr: number, y1: number): void {
    const save = session.save;

    const ts = towerStatus(save, GAME);
    if (ts.unlocked) {
      const sub = ts.next === null ? 'Вершина взята!' : `Этаж ${ts.floor} · дальше ${ts.next}`;
      this.tile(xr, y1, 'Башня', sub, C.gold, () => {
        markHint('tower_open');
        this.scene.start('Tower');
      }, 'tower');
    } else {
      const stage = GAME.content.stages.find((s) => s.id === ts.unlockAfterStage);
      const hint = stage ? `Откроется после этапа ${stage.globalIndex + 1}` : 'Пока закрыта';
      const t = this.tile(xr, y1, 'Башня', hint, C.dim, () => toast(this, `Башня испытаний: ${hint.toLowerCase()} кампании`), 'tower', true);
      t.setAlpha(0.75);
      // Закрыта — замок из скина в углу плитки (T1-11/T3-20: не «✖», который читается как «закрыть»).
      this.add.image(xr + L.tileW / 2 - 40, y1 - L.tileH / 2 + 34, skinIcon('lock')).setDisplaySize(44, 44).setTint(SKIN_TINT.creamDim);
    }
  }

  /** Плитка функции: медальон с иконкой слева, название и состояние справа от него. locked — иконка приглушена. */
  private tile(x: number, y: number, title: string, sub: string, subColor: string, onClick: () => void, iconName: SkinIcon, locked = false): Phaser.GameObjects.NineSlice {
    const bg = pressable(this, card(this, x, y, L.tileW, L.tileH), L.tileW, L.tileH, onClick);
    const left = x - L.tileW / 2;
    medallion(this, left + 78, y, 116, iconName, locked ? SKIN_TINT.creamDim : SKIN_TINT.gold);
    const tx = left + 150;
    const tw = L.tileW - 150 - 24;
    text(this, tx, y - 30, title, FS.h2, locked ? SKIN.creamDim : C.title, TITLE_STYLE).setOrigin(0, 0.5);
    text(this, tx, y + 10, sub, FS.small, subColor, { ...OUTLINE, wordWrap: { width: tw }, align: 'left' }).setOrigin(0, 0);
    return bg;
  }

  /** Перезапустить экран и показать тост уже на новом экземпляре сцены. */
  private restartWithToast(lines: string[]): void {
    this.scene.restart();
    this.events.once(Phaser.Scenes.Events.CREATE, () => afterRewardFly(this, () => toast(this, lines.join('\n'), C.success, 5000)));
  }
}
