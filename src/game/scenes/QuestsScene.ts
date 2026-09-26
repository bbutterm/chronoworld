import Phaser from 'phaser';
import { claimActivity, claimQuest, questStatus, type MilestoneRewards, type MilestoneView, type QuestView } from '../../core';
import { GAME } from '../content';
import { describeEvents, formatNumber, questDestination, untilReset } from '../flow';
import { GAME_W } from '../layout';
import { badge, card, CONTENT_BOTTOM, CONTENT_TOP, screen } from '../screen';
import { commit, session, today } from '../session';
import { button, icon, progressBar, text, toast } from '../ui';

const BAR_X = 110;
const BAR_W = 860;

/** K5. Ежедневные задания: полоса активности с наградами-порогами и список заданий. */
export class QuestsScene extends Phaser.Scene {
  constructor() {
    super('Quests');
  }

  create(): void {
    screen(this, 'Задания дня', 'Home', { to: 'Home' });
    const st = questStatus(session.save, GAME, today());

    // --- Активность ---
    const top = CONTENT_TOP;
    card(this, GAME_W / 2, top + 200, 1040, 400);
    text(this, GAME_W / 2, top + 55, `Очки активности: ${st.activity} / ${st.maxActivity}`, 40, '#ffe9a8', {
      fontStyle: 'bold',
      stroke: '#3a2412',
      strokeThickness: 6,
    });
    const reset = text(this, GAME_W / 2, top + 105, '', 28, '#e0cfb0');
    const tick = () => reset.setText(`Задания обновятся через ${untilReset(new Date())}`);
    tick();
    this.time.addEvent({ delay: 30_000, loop: true, callback: tick });

    const barY = top + 200;
    progressBar(this, BAR_X, barY, BAR_W, 34, st.maxActivity ? st.activity / st.maxActivity : 0, 0x6fd06f);
    for (const m of st.milestones) this.milestone(m, BAR_X + (BAR_W * m.points) / Math.max(1, st.maxActivity), barY);

    // --- Задания ---
    const listTop = top + 430;
    const rowH = Math.min(190, (CONTENT_BOTTOM - listTop) / Math.max(1, st.quests.length));
    st.quests.forEach((q, i) => this.questRow(q, listTop + rowH * (i + 0.5), rowH - 14));
  }

  private milestone(m: MilestoneView, x: number, y: number): void {
    const ready = m.reached && !m.claimed;
    const frame = m.claimed ? 'k:buttonSquare_grey' : ready ? 'k:buttonSquare_blue' : 'k:buttonSquare_beige';
    const x0 = Math.min(x, BAR_X + BAR_W - 20);
    const b = button(this, x0, y, 104, 104, frame, String(m.points), () => this.claimMilestone(m), 34);
    if (m.claimed) icon(this, x0 + 36, y - 36, 'iconCheck_bronze', 44);
    if (ready) {
      badge(this, x0 + 42, y - 44, 1);
      this.tweens.add({ targets: b.container, scale: 1.08, yoyo: true, repeat: -1, duration: 600 });
    }
    text(this, x0, y + 95, rewardText(m.rewards), 28, m.claimed ? '#9a9aa0' : '#ffffff', { stroke: '#000000', strokeThickness: 4, lineSpacing: 2 });
  }

  private questRow(q: QuestView, y: number, h: number): void {
    card(this, GAME_W / 2, y, 1040, h, q.claimed);
    const dark = q.claimed;
    text(this, 70, y - h * 0.22, q.name, 32, dark ? '#4a3520' : '#ffffff', {
      fontStyle: 'bold',
      stroke: dark ? '#00000000' : '#000000',
      strokeThickness: dark ? 0 : 4,
      align: 'left',
      wordWrap: { width: 640 },
    }).setOrigin(0, 0.5);
    progressBar(this, 70, y + h * 0.22, 440, 30, q.progress / q.target, q.done ? 0xffd84a : 0x6fd06f);
    text(this, 290, y + h * 0.22, `${q.progress} / ${q.target}`, 26, '#ffffff', { stroke: '#000000', strokeThickness: 4 });
    text(this, 600, y + h * 0.22, `+${q.points} очк.`, 30, dark ? '#6a4a2a' : '#9fe0a6', { fontStyle: 'bold' });

    const bx = 880;
    if (q.claimed) {
      icon(this, bx - 60, y, 'iconCheck_bronze', 56);
      text(this, bx + 20, y, 'Готово', 32, '#4a3520', { fontStyle: 'bold' });
    } else if (q.done) {
      const b = button(this, bx, y, 250, 110, 'ui_btn_primary', 'Забрать', () => this.claim(q), 38);
      this.tweens.add({ targets: b.container, scale: 1.05, yoyo: true, repeat: -1, duration: 700 });
    } else {
      button(this, bx, y, 250, 110, 'k:buttonLong_beige', 'Перейти', () => this.scene.start(questDestination(q.event)), 36);
    }
  }

  private claim(q: QuestView): void {
    try {
      const r = claimQuest(session.save, today(), q.id, GAME);
      commit(r.save);
      this.restartWithToast(`«${q.name}»: +${r.points} очков активности`);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), '#ffb4a0');
    }
  }

  private claimMilestone(m: MilestoneView): void {
    if (m.claimed) {
      toast(this, 'Эта награда уже получена');
      return;
    }
    if (!m.reached) {
      toast(this, `Нужно ${m.points} очков активности. Выполняйте задания и забирайте за них очки.`);
      return;
    }
    try {
      const r = claimActivity(session.save, today(), m.points, GAME);
      commit(r.save);
      this.restartWithToast([`Награда за ${m.points} очков: ${rewardText(r.rewards).replace(/\n/g, ', ')}`, ...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы'))].join('\n'));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), '#ffb4a0');
    }
  }

  private restartWithToast(message: string): void {
    this.scene.restart();
    this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, message, '#9fe0a6', 4000));
  }
}

/** Награда порога: «200 золота», «20 гемов», «100 опыта» (по строке на вид). */
function rewardText(r: MilestoneRewards): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${formatNumber(r.gold)} зол.`);
  if (r.gems) parts.push(`${r.gems} гем.`);
  if (r.jobExp) parts.push(`${r.jobExp} оп.`);
  return parts.join('\n') || '—';
}
