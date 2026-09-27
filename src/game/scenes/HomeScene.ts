import Phaser from 'phaser';
import { hasArt } from '../assets';
import { achievementStatus, actClaimOffline, actUseFastRewards, fastRewardsPreview, fastRewardsStatus, offlineRewards, questStatus, towerStatus } from '../../core';
import { GAME } from '../content';
import { claimableAchievements, claimableCount, currentStage, describeEvents, finishedBounties, formatNumber, jobChangeReadyCount } from '../flow';
import { HINT_TEXT, markHint, pickHomeHint, resetHints, type HintId } from '../hints';
import { GAME_H, GAME_W } from '../layout';
import { badge, card, confirm, confirmOpen, gemIcon, NAV_H, screen } from '../screen';
import { commit, now, resetProgress, session, today } from '../session';
import { button, dangerButton, hintPointer, icon, panel, pressable, text, toast } from '../ui';
import { C, FS, OUTLINE, TINT, TITLE_STYLE, TOUCH } from '../theme';
import { fps, nextFpsCap, nextPlaybackSpeed, playback, setFpsCap, setPlaybackSpeed } from '../state';
import { lifecycle } from '../lifecycle';
import { version } from '../../../package.json';

/**
 * Раскладка главной (S): сундук, быстрые награды, плитки 2×2, «В кампанию». Между блоками оставлено место,
 * чтобы плашка подсказки (≈125 ед. от края цели) вставала, не закрывая другие кнопки:
 * над плиткой «Башня» — до кнопки быстрых наград, под «В кампанию» и над навигацией — свободная полоса.
 */
const L = {
  chestY: 390,
  chestH: 460,
  claimY: 563,
  fastY: 771,
  fastH: 230,
  /** Кнопка быстрых наград чуть выше центра карточки: над плиткой «Башня» остаётся место для подсказки. */
  fastBtnY: 760,
  tileW: 500,
  tileH: 170,
  tileXL: 280,
  tileXR: 800,
  tileY1: 1031,
  tileY2: 1217,
  campaignY: 1390,
  campaignH: 130,
} as const;

/**
 * Главная: сундук офлайн-наград, быстрые награды (K1), плитки задания (K5) / башня (K4) / поручения (K9) / достижения (K10), кампания.
 * Тестовый бой, сброс подсказок и прогресса — в настройках (шестерёнка в шапке, S).
 */
export class HomeScene extends Phaser.Scene {
  private chestText!: Phaser.GameObjects.Text;
  private chestImg?: Phaser.GameObjects.Image;
  private claimBtn!: ReturnType<typeof button>;
  /** Сколько поручений было завершено при отрисовке плитки (раз в секунду сверяем — значок не отстаёт). */
  private bountiesDone = 0;
  /** R: показанная подсказка (одна за раз) и её указатель. */
  private hintId: HintId | null = null;
  private hintView: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Home');
  }

  create(): void {
    this.hintId = null;
    this.hintView = null;
    screen(this, 'Лагерь героев', 'Home', undefined, { settings: () => this.openSettings() });
    this.chest();
    this.fastRewards();
    this.tiles();

    const cur = currentStage(session.save, GAME);
    button(this, GAME_W / 2, L.campaignY, 780, L.campaignH, 'ui_btn_primary', cur ? `В кампанию · этап ${cur.globalIndex + 1}` : 'В кампанию', () => {
      markHint('home_campaign');
      this.scene.start('Campaign');
    }, FS.h1);

    this.refresh();
    // Сундук считаем раз в секунду, а не каждый кадр.
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.refresh() });
  }

  // ---------- сундук ----------

  private chest(): void {
    const cap = GAME.progression.offline.capHours;
    const y = L.chestY;
    card(this, GAME_W / 2, y, 1000, L.chestH);
    text(this, GAME_W / 2, y - 187, 'Сундук офлайн-наград', FS.h2, C.title, TITLE_STYLE);
    if (hasArt('ui_chest_empty')) {
      // Сундук: пустой / наполняется / полный (текстура меняется в refresh).
      this.chestImg = this.add.image(GAME_W / 2, y - 95, 'ui_chest_empty').setDisplaySize(170, 170);
    } else {
      // Нет арта — рамка из атласа, «крышка» и замок.
      card(this, GAME_W / 2, y - 95, 300, 110, true);
      this.add.rectangle(GAME_W / 2, y - 133, 300, 34, 0x8a5a2b).setStrokeStyle(6, 0x3a2412);
      icon(this, GAME_W / 2, y - 87, 'iconCircle_brown', 56).setTint(TINT.gold);
    }
    this.chestText = text(this, GAME_W / 2, y + 25, '', FS.h3, C.text, { lineSpacing: 8, ...OUTLINE });
    text(this, GAME_W / 2, y + 99, `Копится до ${cap} ч. Доход — от последнего пройденного этапа.`, FS.small, C.muted, { wordWrap: { width: 900 } });
    this.claimBtn = button(this, GAME_W / 2, L.claimY, 460, TOUCH, 'ui_btn_primary', 'Собрать', () => this.claim(), FS.h2);
  }

  private refresh(): void {
    const r = offlineRewards(session.save, now(), GAME);
    const h = Math.floor(r.minutes / 60);
    const m = r.minutes % 60;
    this.chestText.setText(
      session.save.campaign.cleared.length === 0
        ? 'Пройдите первый этап кампании,\nчтобы сундук начал наполняться'
        : r.gold === 0 && r.jobExp === 0
          ? 'Сундук пуст — награды\nкопятся каждую минуту'
          : `Накоплено за ${h} ч ${m} мин\nЗолото +${formatNumber(r.gold)}   Опыт +${formatNumber(r.jobExp)} каждому`,
    );
    this.claimBtn.container.setAlpha(r.gold > 0 || r.jobExp > 0 ? 1 : 0.45);
    if (this.chestImg) {
      const capMin = GAME.progression.offline.capHours * 60;
      const state = r.gold === 0 && r.jobExp === 0 ? 'empty' : r.minutes >= capMin * 0.9 ? 'full' : 'filling';
      this.chestImg.setTexture(`ui_chest_${state}`).setDisplaySize(170, 170);
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
      toast(this, 'Сундук пока пуст');
      return;
    }
    commit(r.save);
    markHint('chest_claim');
    this.restartWithToast([`Собрано: золото +${r.rewards.gold}, опыт +${r.rewards.jobExp}`, ...describeEvents(r.events, r.save, GAME)]);
  }

  // ---------- R. Подсказки первой сессии ----------

  /** Одна подсказка на следующем полезном действии; пересчитывается раз в секунду (сундук наполняется). */
  private updateHint(chestHasIncome: boolean): void {
    const save = session.save;
    const id = pickHomeHint({
      cleared: save.campaign.cleared.length,
      chestHasIncome,
      jobChangeReady: jobChangeReadyCount(save, GAME) > 0,
      towerUnlocked: towerStatus(save, GAME).unlocked,
    });
    if (id === this.hintId) return;
    this.hintView?.destroy();
    this.hintView = null;
    this.hintId = id;
    if (!id) return;
    const msg = HINT_TEXT[id];
    // Сторону плашки выбирает hintPointer (S): так, чтобы не закрыть другие кнопки и плитки.
    if (id === 'home_campaign') this.hintView = hintPointer(this, GAME_W / 2, L.campaignY, msg, 'below', { w: 780, h: L.campaignH });
    if (id === 'chest_claim') this.hintView = hintPointer(this, GAME_W / 2, L.claimY, msg, 'below', { w: 460, h: TOUCH });
    if (id === 'tower_open') this.hintView = hintPointer(this, L.tileXR, L.tileY1, msg, 'above', { w: L.tileW, h: L.tileH });
    // Вкладка «Герои» — средняя в нижней навигации.
    if (id === 'job_change') this.hintView = hintPointer(this, GAME_W / 2, GAME_H - NAV_H / 2 + 4, msg, 'above', { w: GAME_W / 3 - 30, h: NAV_H - 40 });
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
    layer.add(text(this, cx, cy - 540, 'Настройки', FS.h1, C.title, TITLE_STYLE));

    let y = cy - 430;
    layer.add(text(this, cx - bw / 2, y, 'Скорость боя', FS.h3, C.text, OUTLINE).setOrigin(0, 0.5));
    const speed = button(this, cx + bw / 2 - 110, y, 220, TOUCH, 'ui_btn_secondary', `${playback.speed}x`, () => {
      setPlaybackSpeed(nextPlaybackSpeed());
      speed.setLabel(`${playback.speed}x`);
    }, FS.h2);
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
    }, FS.h3);
    fpsBtn.container.setName('fpsCap');
    layer.add(fpsBtn.container);
    y += 70;
    layer.add(text(this, cx, y, '30 — меньше нагрев и расход батареи', FS.small, C.muted));

    y += 110;
    layer.add(button(this, cx, y, bw, 110, 'k:buttonLong_beige', 'Тестовый бой', () => this.scene.start('Prep'), FS.h2).container);
    y += 140;
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
          }),
        ),
      FS.h2).container,
    );
    y += 130;
    layer.add(text(this, cx, y, `Версия ${version} · сборка ${import.meta.env.MODE}`, FS.small, C.dim));
    y += 120;
    layer.add(button(this, cx, y, 460, 120, 'ui_btn_primary', 'Закрыть', close, FS.h2).container);
  }

  // ---------- K1. Быстрые награды ----------

  private fastRewards(): void {
    const save = session.save;
    const hours = GAME.features.fastRewards.hours;
    const preview = fastRewardsPreview(save, GAME);
    const st = fastRewardsStatus(save, today(), GAME);
    const y = L.fastY;
    card(this, GAME_W / 2, y, 1000, L.fastH);
    text(this, 80, y - 72, `Быстрые награды · ${hours} ч`, FS.h2, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5);
    const noIncome = preview.gold <= 0 && preview.jobExp <= 0;
    text(
      this,
      80,
      y - 6,
      noIncome ? 'Откроются после первого этапа кампании' : `+${formatNumber(preview.gold)} золота, +${formatNumber(preview.jobExp)} опыта каждому`,
      FS.body,
      C.text,
      { align: 'left', wordWrap: { width: 600 }, stroke: C.stroke, strokeThickness: 4 },
    ).setOrigin(0, 0.5);
    const left = st.nextCost === null ? 'На сегодня всё — приходите завтра' : `Осталось сегодня: ${st.usesLeft} (бесплатно: ${st.freeLeft})`;
    text(this, 80, y + 72, left, FS.small, C.muted).setOrigin(0, 0.5);

    const bx = 840;
    const label = st.nextCost === null ? 'Лимит' : st.nextCost === 0 ? 'Бесплатно' : `${st.nextCost}`;
    const btn = button(this, bx, L.fastBtnY, 280, 110, st.nextCost === 0 ? 'ui_btn_primary' : 'ui_btn_secondary', label, () => this.useFast(), FS.h3);
    if (st.nextCost !== null && st.nextCost > 0) {
      // Цена: ромб гема + число.
      btn.label.setX(22);
      btn.container.add(gemIcon(this, 22 - btn.label.width / 2 - 30, -4, 36));
    }
    if (st.nextCost === null || noIncome) btn.container.setAlpha(0.45);
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
    const price = st.nextCost === 0 ? 'Бесплатно.' : `Цена: ${st.nextCost} гемов (у вас ${save.currency.gems}).`;
    const q = `Забрать ${GAME.features.fastRewards.hours} ч дохода сразу?\nЗолото +${formatNumber(preview.gold)}, опыт +${formatNumber(preview.jobExp)} каждому.\n${price}`;
    confirm(this, q, 'Забрать', () => {
      try {
        const r = actUseFastRewards(session.save, day, GAME);
        commit(r.save);
        this.restartWithToast([`Быстрые награды: золото +${r.rewards.gold}, опыт +${r.rewards.jobExp}`, ...describeEvents(r.events, r.save, GAME)]);
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
    this.tile(xl, y1, 'Задания', `Активность ${qs.activity} / ${qs.maxActivity}`, C.success, () => this.scene.start('Quests'));
    badge(this, xl + 215, y1 - 67, claimableCount(qs));

    const ts = towerStatus(save, GAME);
    if (ts.unlocked) {
      const sub = ts.next === null ? 'Вершина взята!' : `Этаж ${ts.floor} · дальше ${ts.next}`;
      this.tile(xr, y1, 'Башня', sub, C.gold, () => {
        markHint('tower_open');
        this.scene.start('Tower');
      });
    } else {
      const stage = GAME.content.stages.find((s) => s.id === ts.unlockAfterStage);
      const hint = stage ? `Откроется после этапа ${stage.globalIndex + 1}` : 'Пока закрыта';
      const t = this.tile(xr, y1, 'Башня', hint, C.dim, () => toast(this, `Башня испытаний: ${hint.toLowerCase()} кампании`));
      t.setAlpha(0.75);
      icon(this, xr + 200, y1 - 55, 'iconCross_grey', 44);
    }

    const done = finishedBounties(save, now());
    const active = save.bounties.active.length;
    const bsub = done ? `Готово: ${done} — заберите` : active ? `В работе: ${active}` : 'Отправьте героев';
    this.tile(xl, y2, 'Поручения', bsub, done ? C.success : C.muted, () => this.scene.start('Bounties'));
    this.bountiesDone = done;
    badge(this, xl + 215, y2 - 67, done);

    const views = achievementStatus(save, GAME);
    const got = views.filter((a) => a.claimed).length;
    this.tile(xr, y2, 'Достижения', `Получено ${got} / ${views.length}`, C.info, () => this.scene.start('Achievements', { from: 'Home' }));
    badge(this, xr + 215, y2 - 67, claimableAchievements(views));
  }

  private tile(x: number, y: number, title: string, sub: string, subColor: string, onClick: () => void): Phaser.GameObjects.NineSlice {
    const bg = pressable(this, card(this, x, y, L.tileW, L.tileH), L.tileW, L.tileH, onClick);
    text(this, x, y - 30, title, FS.h2, C.title, TITLE_STYLE);
    text(this, x, y + 36, sub, FS.body, subColor, { ...OUTLINE, wordWrap: { width: 460 } });
    return bg;
  }

  /** Перезапустить экран и показать тост уже на новом экземпляре сцены. */
  private restartWithToast(lines: string[]): void {
    this.scene.restart();
    this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, lines.join('\n'), C.success, 5000));
  }
}
