import Phaser from 'phaser';
import { achievementStatus, actClaimOffline, actUseFastRewards, fastRewardsPreview, fastRewardsStatus, offlineRewards, questStatus, towerStatus } from '../../core';
import { GAME } from '../content';
import { claimableAchievements, claimableCount, currentStage, describeEvents, finishedBounties, formatNumber } from '../flow';
import { GAME_W } from '../layout';
import { badge, card, confirm, gemIcon, screen } from '../screen';
import { commit, now, resetProgress, session, today } from '../session';
import { button, dangerButton, icon, pressable, text, toast } from '../ui';
import { C, FS } from '../theme';

/** Главная: сундук офлайн-наград, быстрые награды (K1), плитки задания (K5) / башня (K4) / поручения (K9) / достижения (K10), кампания, тестовый бой, сброс. */
export class HomeScene extends Phaser.Scene {
  private chestText!: Phaser.GameObjects.Text;
  private claimBtn!: ReturnType<typeof button>;
  /** Сколько поручений было завершено при отрисовке плитки (раз в секунду сверяем — значок не отстаёт). */
  private bountiesDone = 0;

  constructor() {
    super('Home');
  }

  create(): void {
    screen(this, 'Лагерь героев', 'Home');
    this.chest();
    this.fastRewards();
    this.tiles();

    const cur = currentStage(session.save, GAME);
    button(this, GAME_W / 2, 1480, 780, 130, 'ui_btn_primary', cur ? `В кампанию · этап ${cur.globalIndex + 1}` : 'В кампанию', () => this.scene.start('Campaign'), FS.h1);
    button(this, 300, 1640, 460, 100, 'k:buttonLong_beige', 'Тестовый бой', () => this.scene.start('Prep'), FS.h3);
    dangerButton(this, 800, 1640, 400, 100, 'Сбросить', () =>
      confirm(this, 'Сбросить весь прогресс? Герои, этапы, золото и предметы пропадут.', 'Сбросить', () =>
        confirm(this, 'Точно? Отменить будет нельзя.', 'Да, сбросить', () => {
          resetProgress();
          this.scene.restart();
        }),
      ),
    FS.h3);

    this.refresh();
    // Сундук считаем раз в секунду, а не каждый кадр.
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.refresh() });
  }

  // ---------- сундук ----------

  private chest(): void {
    const cap = GAME.progression.offline.capHours;
    card(this, GAME_W / 2, 445, 1000, 520);
    text(this, GAME_W / 2, 235, 'Сундук офлайн-наград', FS.h2, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 });
    // Пока нет арта — рамка из атласа, «крышка» и замок.
    card(this, GAME_W / 2, 350, 320, 140, true);
    this.add.rectangle(GAME_W / 2, 295, 320, 40, 0x8a5a2b).setStrokeStyle(6, 0x3a2412);
    icon(this, GAME_W / 2, 355, 'iconCircle_brown', 64).setTint(0xffd84a);
    this.chestText = text(this, GAME_W / 2, 485, '', FS.h3, C.text, { lineSpacing: 8, stroke: C.stroke, strokeThickness: 4 });
    text(this, GAME_W / 2, 565, `Копится до ${cap} ч. Доход — от последнего пройденного этапа.`, FS.small, C.muted, { wordWrap: { width: 900 } });
    this.claimBtn = button(this, GAME_W / 2, 640, 460, 100, 'ui_btn_primary', 'Собрать', () => this.claim(), FS.h2);
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
    // Поручение завершилось, пока игрок на главной, — обновить плитку и значок.
    if (finishedBounties(session.save, now()) !== this.bountiesDone) this.scene.restart();
  }

  private claim(): void {
    const r = actClaimOffline(session.save, now(), today(), GAME);
    if (r.rewards.gold === 0 && r.rewards.jobExp === 0) {
      toast(this, 'Сундук пока пуст');
      return;
    }
    commit(r.save);
    this.restartWithToast([`Собрано: золото +${r.rewards.gold}, опыт +${r.rewards.jobExp}`, ...describeEvents(r.events, r.save, GAME)]);
  }

  // ---------- K1. Быстрые награды ----------

  private fastRewards(): void {
    const save = session.save;
    const hours = GAME.features.fastRewards.hours;
    const preview = fastRewardsPreview(save, GAME);
    const st = fastRewardsStatus(save, today(), GAME);
    const y = 855;
    card(this, GAME_W / 2, y, 1000, 250);
    text(this, 80, y - 78, `Быстрые награды · ${hours} ч`, FS.h2, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5);
    const noIncome = preview.gold <= 0 && preview.jobExp <= 0;
    text(
      this,
      80,
      y - 10,
      noIncome ? 'Откроются после первого этапа кампании' : `+${formatNumber(preview.gold)} золота, +${formatNumber(preview.jobExp)} опыта каждому`,
      FS.body,
      C.text,
      { align: 'left', wordWrap: { width: 600 }, stroke: C.stroke, strokeThickness: 4 },
    ).setOrigin(0, 0.5);
    const left = st.nextCost === null ? 'На сегодня всё — приходите завтра' : `Осталось сегодня: ${st.usesLeft} (бесплатно: ${st.freeLeft})`;
    text(this, 80, y + 62, left, FS.small, C.muted).setOrigin(0, 0.5);

    const bx = 840;
    const label = st.nextCost === null ? 'Лимит' : st.nextCost === 0 ? 'Бесплатно' : `${st.nextCost}`;
    const btn = button(this, bx, y, 280, 130, st.nextCost === 0 ? 'ui_btn_primary' : 'ui_btn_secondary', label, () => this.useFast(), FS.h3);
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
    const y1 = 1090;
    const y2 = 1285;
    const [xl, xr] = [280, 800];
    const qs = questStatus(save, GAME, today());
    this.tile(xl, y1, 'Задания', `Активность ${qs.activity} / ${qs.maxActivity}`, C.success, () => this.scene.start('Quests'));
    badge(this, xl + 215, y1 - 72, claimableCount(qs));

    const ts = towerStatus(save, GAME);
    if (ts.unlocked) {
      const sub = ts.next === null ? 'Вершина взята!' : `Этаж ${ts.floor} · дальше ${ts.next}`;
      this.tile(xr, y1, 'Башня', sub, C.gold, () => this.scene.start('Tower'));
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
    badge(this, xl + 215, y2 - 72, done);

    const views = achievementStatus(save, GAME);
    const got = views.filter((a) => a.claimed).length;
    this.tile(xr, y2, 'Достижения', `Получено ${got} / ${views.length}`, C.info, () => this.scene.start('Achievements', { from: 'Home' }));
    badge(this, xr + 215, y2 - 72, claimableAchievements(views));
  }

  private tile(x: number, y: number, title: string, sub: string, subColor: string, onClick: () => void): Phaser.GameObjects.NineSlice {
    const bg = pressable(this, card(this, x, y, 500, 180), 500, 180, onClick);
    text(this, x, y - 30, title, FS.h2, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 });
    text(this, x, y + 38, sub, FS.body, subColor, { stroke: C.stroke, strokeThickness: 4, wordWrap: { width: 460 } });
    return bg;
  }

  /** Перезапустить экран и показать тост уже на новом экземпляре сцены. */
  private restartWithToast(lines: string[]): void {
    this.scene.restart();
    this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, lines.join('\n'), C.success, 5000));
  }
}
