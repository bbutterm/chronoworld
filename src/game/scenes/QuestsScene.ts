import Phaser from 'phaser';
import { actClaimActivity, actClaimAllQuests, actClaimQuest, questStatus, type MilestoneRewards, type MilestoneView, type QuestView } from '../../core';
import { GAME } from '../content';
import { claimableCount, describeEvents, formatNumber, gemsText, pointsText, questDestination, untilReset } from '../flow';
import { GAME_W } from '../layout';
import { card, CONTENT_BOTTOM, CONTENT_TOP, cornerBadge, screen } from '../screen';
import { afterRewardFly, collect, juiceOn, pulse, queueRewardFly, staggerIn, type Point } from '../juice';
import { commit, now, restartOnNewDay, session, today } from '../session';
import { button, emptyState, progressBar, ScrollArea, text, toast } from '../ui';
import { markHint } from '../hints';
import { SKIN, SKIN_TINT, skinIcon } from '../skin';
import { C, FS, TINT } from '../theme';

/** Цвет галочки «получено» (как на лестнице Башни). */
const SKIN_TINT_SUCCESS = 0x9fe0a6;

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
    // Обучение (hints.ts): последний шаг цепочки главы 1 — задания открыты и найдены.
    markHint('quests_open');
    restartOnNewDay(this);
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
    const tick = () => reset.setText(`Задания обновятся через ${untilReset(new Date(now()))}`);
    tick();
    this.time.addEvent({ delay: 30_000, loop: true, callback: tick });

    const barY = top + 200;
    progressBar(this, BAR_X, barY, BAR_W, 34, st.maxActivity ? st.activity / st.maxActivity : 0, TINT.success, { key: 'quests:activity' });
    for (const m of st.milestones) this.milestone(m, BAR_X + (BAR_W * m.points) / Math.max(1, st.maxActivity), barY);

    // --- Задания ---
    // R: строки не сжимаются — список тянется пальцем (ScrollArea).
    // «Забрать всё» — когда готовы две награды и больше (задания и пороги активности, до которых они доберут).
    const ready = claimableCount(st);
    let listTop = top + 420;
    if (ready > 1) {
      const all = button(this, GAME_W / 2, top + 470, 520, 100, 'ui_btn_primary', `Забрать всё (${ready})`, () => this.claimAll({ x: GAME_W / 2, y: top + 470 }), FS.h3);
      pulse(this, all.container, 1.04, 700);
      listTop = top + 540;
    }
    this.area = new ScrollArea(this, listTop, CONTENT_BOTTOM + 10);
    if (!st.quests.length) this.area.add(emptyState(this, GAME_W / 2, 200, 'На сегодня заданий нет.\nНовые появятся после полуночи.'));
    const rows = st.quests.map((q, i) => collect(this.area.content, () => this.questRow(q, ROW_H * (i + 0.5), ROW_H - ROW_GAP)));
    this.area.setContentHeight(ROW_H * st.quests.length);
    staggerIn(this, 'Quests', rows);
  }

  private milestone(m: MilestoneView, x: number, y: number): void {
    const ready = m.reached && !m.claimed;
    // Готовый к получению порог — светлая рамка с золотым свечением и пульсом; не достигнутый — тёмный.
    const frame = m.claimed ? 'k:buttonSquare_grey' : ready ? 'k:buttonSquare_beige' : 'k:buttonSquare_brown';
    const x0 = Math.min(x, BAR_X + BAR_W - 20);
    if (ready) {
      const glow = this.add.rectangle(x0, y, 128, 128, 0xffd84a, 0.35).setStrokeStyle(6, 0xffd84a);
      if (juiceOn()) this.tweens.add({ targets: glow, alpha: 0.35, yoyo: true, repeat: -1, duration: 600 });
    }
    // Порог — сундучок (как в AFK Arena) с числом очков на нижней кромке.
    const b = button(this, x0, y, 104, 104, frame, String(m.points), () => this.claimMilestone(m, { x: x0, y }), FS.caption);
    b.label.setY(30).setColor(m.claimed ? C.disabled : ready ? SKIN.goldLight : SKIN.cream).setStroke('#000000', 5);
    b.container.addAt(this.add.image(0, -14, skinIcon('chest')).setDisplaySize(58, 58).setTint(m.claimed ? 0x6a6a70 : ready ? SKIN_TINT.gold : SKIN_TINT.creamDim), 1);
    if (m.claimed) this.add.image(x0 + 36, y - 36, skinIcon('check')).setDisplaySize(44, 44).setTint(SKIN_TINT_SUCCESS);
    if (ready) {
      cornerBadge(this, x0, y, 104, 104, 1);
      pulse(this, b.container, 1.08, 600);
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
    a.add(progressBar(this, 70, y + h * 0.22, 440, 30, q.progress / q.target, q.done ? TINT.gold : TINT.success, { key: `quest:${q.id}` }));
    // На жёлтой (выполнено) полосе — тёмная подпись без обводки (как в достижениях), на зелёной — белая с обводкой.
    const onGold = q.done;
    a.add(text(this, 290, y + h * 0.22, `${formatNumber(q.progress)} / ${formatNumber(q.target)}`, FS.caption, onGold ? C.titleStroke : C.text, {
      fontStyle: 'bold',
      stroke: onGold ? C.none : C.stroke,
      strokeThickness: onGold ? 0 : 4,
    }));
    a.add(text(this, 600, y + h * 0.22, `+${pointsText(q.points)}`, FS.body, dark ? C.inkMuted : C.success, { fontStyle: 'bold' }));

    const bx = 880;
    if (q.claimed) {
      // Галочка из скина (как на лестнице Башни) слева от подписи, без наложения.
      const done = a.add(text(this, bx + 24, y, 'Готово', FS.body, C.success, { fontStyle: 'bold' }));
      a.add(this.add.image(done.x - done.width / 2 - 34, y, skinIcon('check')).setDisplaySize(48, 48).setTint(SKIN_TINT_SUCCESS));
    } else if (q.done) {
      const b = button(this, bx, y, 250, 110, 'ui_btn_primary', 'Забрать', a.tap(() => this.claim(q)), FS.h3);
      a.add(b.container);
      pulse(this, b.container);
    } else {
      a.add(button(this, bx, y, 250, 110, 'ui_btn_secondary', 'Перейти', a.tap(() => this.scene.start(questDestination(q.event))), FS.h3).container);
    }
  }

  private claim(q: QuestView): void {
    try {
      const r = actClaimQuest(session.save, today(), q.id, GAME);
      commit(r.save);
      this.restartWithToast(`«${q.name}»: +${r.points} очков активности`);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private claimMilestone(m: MilestoneView, at: Point): void {
    if (m.claimed) {
      toast(this, 'Эта награда уже получена');
      return;
    }
    if (!m.reached) {
      toast(this, `Нужно ${m.points} очков активности. Выполняйте задания и забирайте за них очки.`);
      return;
    }
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = actClaimActivity(session.save, today(), m.points, GAME);
      commit(r.save);
      queueRewardFly('Quests', at, before);
      this.restartWithToast([`Награда за ${m.points} очков: ${rewardText(r.rewards).replace(/\n/g, ', ')}`, ...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы'))].join('\n'), true);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** «Забрать всё»: все выполненные задания, затем все достигнутые пороги (ядро — claimAllQuests). */
  private claimAll(at: Point): void {
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = actClaimAllQuests(session.save, today(), GAME);
      commit(r.save);
      const lines: string[] = [];
      if (r.quests.length) lines.push(`Заданий: ${r.quests.length} · +${r.points} очков активности`);
      if (r.milestones.length) {
        queueRewardFly('Quests', at, before);
        lines.push(`Наград активности: ${r.milestones.length} · ${rewardText(r.rewards).replace(/\n/g, ', ')}`);
      }
      lines.push(...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы')));
      this.restartWithToast(lines.join('\n') || 'Забирать пока нечего', r.milestones.length > 0);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** fly — награда летит в валюту: тост после её полёта. */
  private restartWithToast(message: string, fly = false): void {
    this.scene.restart();
    this.events.once(Phaser.Scenes.Events.CREATE, () => (fly ? afterRewardFly(this, () => toast(this, message, C.success, 4000)) : toast(this, message, C.success, 4000)));
  }
}

/** Награда порога: «200 золота», «20 гемов», «100 опыта» (по строке на вид). */
function rewardText(r: MilestoneRewards): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${formatNumber(r.gold)} золота`);
  if (r.gems) parts.push(gemsText(r.gems));
  if (r.jobExp) parts.push(`${formatNumber(r.jobExp)} опыта`);
  return parts.join('\n') || '—';
}
