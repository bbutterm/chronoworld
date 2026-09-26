import Phaser from 'phaser';
import { claimOffline, offlineRewards } from '../../core';
import { GAME } from '../content';
import { describeEvents } from '../flow';
import { GAME_W } from '../layout';
import { card, confirm, screen } from '../screen';
import { commit, now, resetProgress, session } from '../session';
import { button, icon, text, toast } from '../ui';

/** Главная: сундук офлайн-наград, тестовый бой, сброс прогресса. */
export class HomeScene extends Phaser.Scene {
  private chestText!: Phaser.GameObjects.Text;
  private claimBtn!: ReturnType<typeof button>;

  constructor() {
    super('Home');
  }

  create(): void {
    screen(this, 'Лагерь героев', 'Home');
    const cap = GAME.progression.offline.capHours;

    // Сундук: пока нет арта — рамка из атласа, «крышка» и замок.
    card(this, GAME_W / 2, 620, 960, 760);
    text(this, GAME_W / 2, 300, 'Сундук офлайн-наград', 46, '#ffe9a8', { fontStyle: 'bold', stroke: '#3a2412', strokeThickness: 6 });
    card(this, GAME_W / 2, 520, 440, 260, true);
    this.add.rectangle(GAME_W / 2, 430, 440, 60, 0x8a5a2b).setStrokeStyle(6, 0x3a2412);
    icon(this, GAME_W / 2, 520, 'iconCircle_brown', 90).setTint(0xffd84a);
    this.chestText = text(this, GAME_W / 2, 750, '', 38, '#ffffff', { lineSpacing: 10, stroke: '#000000', strokeThickness: 4 });
    text(this, GAME_W / 2, 850, `Копится до ${cap} ч. Доход — от последнего пройденного этапа.`, 28, '#e0cfb0', {
      wordWrap: { width: 860 },
    });
    this.claimBtn = button(this, GAME_W / 2, 950, 520, 130, 'ui_btn_primary', 'Собрать', () => this.claim());

    button(this, GAME_W / 2, 1180, 700, 130, 'ui_btn_secondary', 'В кампанию', () => this.scene.start('Campaign'));
    button(this, GAME_W / 2, 1340, 700, 130, 'k:buttonLong_beige', 'Тестовый бой', () => this.scene.start('Prep'));
    button(this, GAME_W / 2, 1560, 560, 110, 'k:buttonLong_grey', 'Сбросить прогресс', () =>
      confirm(this, 'Сбросить весь прогресс? Герои, этапы и золото пропадут.', 'Сбросить', () =>
        confirm(this, 'Точно? Отменить будет нельзя.', 'Да, сбросить', () => {
          resetProgress();
          this.scene.restart();
        }),
      ),
    38);

    this.refresh();
    // Сундук считаем раз в секунду, а не каждый кадр.
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.refresh() });
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
          : `Накоплено за ${h} ч ${m} мин\nЗолото +${r.gold}   Опыт +${r.jobExp} каждому`,
    );
    this.claimBtn.container.setAlpha(r.gold > 0 || r.jobExp > 0 ? 1 : 0.45);
  }

  private claim(): void {
    const before = session.save;
    const r = claimOffline(before, now(), GAME);
    if (r.rewards.gold === 0 && r.rewards.jobExp === 0) {
      toast(this, 'Сундук пока пуст');
      return;
    }
    commit(r.save);
    const lines = [`Собрано: золото +${r.rewards.gold}, опыт +${r.rewards.jobExp}`, ...describeEvents(r.events, r.save, GAME)];
    this.scene.restart();
    // Тост после рестарта — на новом экземпляре сцены.
    this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, lines.join('\n'), '#9fe0a6', 5000));
  }
}
