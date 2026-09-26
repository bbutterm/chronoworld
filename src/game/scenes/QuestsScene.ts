import Phaser from 'phaser';
import { claimActivity, claimQuest, questStatus, type MilestoneRewards, type MilestoneView, type QuestView } from '../../core';
import { GAME } from '../content';
import { describeEvents, formatNumber, questDestination, untilReset } from '../flow';
import { GAME_W } from '../layout';
import { badge, card, CONTENT_BOTTOM, CONTENT_TOP, screen } from '../screen';
import { commit, session, today } from '../session';
import { button, emptyState, icon, progressBar, ScrollArea, text, toast } from '../ui';
import { C, FS, TINT } from '../theme';

const BAR_X = 110;
const BAR_W = 860;
/** Высота строки задания: фиксированная, список прокручивается (R). */
const ROW_H = 190;
const ROW_GAP = 14;

/** K5. Ежедневные задания: полоса активности с наградами-порогами и список заданий. */
export class QuestsScene extends Phaser.Scene {
  private area!: ScrollArea;

  constructor() {
    super('Quests');
  }

  create(): void {
    screen(this, 'Задания дня', 'Home', { to: 'Home' });
    const st = questStatus(session.save, GAME, today());

    // --- Активность ---
    const top = CONTENT_TOP;
    card(this, GAME_W / 2, top + 200, 1040, 400);
    text(this, GAME_W / 2, top + 55, `Очки активности: ${st.activity} / ${st.maxActivity}`, FS.h2, C.title, {
      fontStyle: 'bold',
      stroke: C.titleStroke,
      strokeThickness: 6,
    });
    const reset = text(this, GAME_W / 2, top + 105, '', FS.small, C.muted);
    const tick = () => reset.setText(`Задания обновятся через ${untilReset(new Date())}`);
    tick();
    this.time.addEvent({ delay: 30_000, loop: true, callback: tick });

    const barY = top + 200;
    progressBar(this, BAR_X, barY, BAR_W, 34, st.maxActivity ? st.activity / st.maxActivity : 0, TINT.success);
    for (const m of st.milestones) this.milestone(m, BAR_X + (BAR_W * m.points) / Math.max(1, st.maxActivity), barY);

    // --- Задания ---
    // R: строки не сжимаются — список тянется пальцем (ScrollArea).
    const listTop = top + 420;
    this.area = new ScrollArea(this, listTop, CONTENT_BOTTOM + 10);
    if (!st.quests.length) this.area.add(emptyState(this, GAME_W / 2, 200, 'На сегодня заданий нет.\nНовые появятся после полуночи.'));
    st.quests.forEach((q, i) => this.questRow(q, ROW_H * (i + 0.5), ROW_H - ROW_GAP));
    this.area.setContentHeight(ROW_H * st.quests.length);
  }

  private milestone(m: MilestoneView, x: number, y: number): void {
    const ready = m.reached && !m.claimed;
    // Готовый к получению порог — светлая рамка с золотым свечением и пульсом; не достигнутый — тёмный.
    const frame = m.claimed ? 'k:buttonSquare_grey' : ready ? 'k:buttonSquare_beige' : 'k:buttonSquare_brown';
    const x0 = Math.min(x, BAR_X + BAR_W - 20);
    if (ready) {
      const glow = this.add.rectangle(x0, y, 128, 128, 0xffd84a, 0.35).setStrokeStyle(6, 0xffd84a);
      this.tweens.add({ targets: glow, alpha: 0.35, yoyo: true, repeat: -1, duration: 600 });
    }
    const b = button(this, x0, y, 104, 104, frame, String(m.points), () => this.claimMilestone(m), FS.h3);
    if (m.claimed) b.label.setColor(C.disabled);
    if (m.claimed) icon(this, x0 + 36, y - 36, 'iconCheck_bronze', 44);
    if (ready) {
      badge(this, x0 + 42, y - 44, 1);
      this.tweens.add({ targets: b.container, scale: 1.08, yoyo: true, repeat: -1, duration: 600 });
    }
    text(this, x0, y + 95, rewardText(m.rewards), FS.small, m.claimed ? C.disabled : C.text, { stroke: C.stroke, strokeThickness: 4, lineSpacing: 2 });
  }

  private questRow(q: QuestView, y: number, h: number): void {
    const a = this.area;
    a.add(card(this, GAME_W / 2, y, 1040, h, q.claimed));
    const dark = q.claimed;
    a.add(text(this, 70, y - h * 0.22, q.name, FS.body, dark ? C.ink : C.text, {
      fontStyle: 'bold',
      stroke: dark ? C.none : C.stroke,
      strokeThickness: dark ? 0 : 4,
      align: 'left',
      wordWrap: { width: 640 },
    }).setOrigin(0, 0.5));
    a.add(progressBar(this, 70, y + h * 0.22, 440, 30, q.progress / q.target, q.done ? TINT.gold : TINT.success));
    a.add(text(this, 290, y + h * 0.22, `${q.progress} / ${q.target}`, FS.caption, C.text, { stroke: C.stroke, strokeThickness: 4 }));
    a.add(text(this, 600, y + h * 0.22, `+${q.points} очк.`, FS.body, dark ? C.inkMuted : C.success, { fontStyle: 'bold' }));

    const bx = 880;
    if (q.claimed) {
      a.add(icon(this, bx - 60, y, 'iconCheck_bronze', 56));
      a.add(text(this, bx + 20, y, 'Готово', FS.body, C.ink, { fontStyle: 'bold' }));
    } else if (q.done) {
      const b = button(this, bx, y, 250, 110, 'ui_btn_primary', 'Забрать', a.tap(() => this.claim(q)), FS.h3);
      a.add(b.container);
      this.tweens.add({ targets: b.container, scale: 1.05, yoyo: true, repeat: -1, duration: 700 });
    } else {
      a.add(button(this, bx, y, 250, 110, 'k:buttonLong_beige', 'Перейти', a.tap(() => this.scene.start(questDestination(q.event))), FS.h3).container);
    }
  }

  private claim(q: QuestView): void {
    try {
      const r = claimQuest(session.save, today(), q.id, GAME);
      commit(r.save);
      this.restartWithToast(`«${q.name}»: +${r.points} очков активности`);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
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
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private restartWithToast(message: string): void {
    this.scene.restart();
    this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, message, C.success, 4000));
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
