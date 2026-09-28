import Phaser from 'phaser';
import { claimAllMail, claimMail, deleteReadMail, isEmptyRewards, letterClaimable, mailStatus, readMail, type Letter } from '../../core';
import { GAME } from '../content';
import { ribbon } from '../decor';
import { envelopeIcon, touchToday } from '../homeEvents';
import { afterRewardFly, collect, pulse, queueRewardFly, staggerIn } from '../juice';
import { GAME_H, GAME_W } from '../layout';
import { rewardRow, rewardToast } from '../rewardsView';
import { badge, card, CONTENT_BOTTOM, CONTENT_TOP, confirm, popIn, screen } from '../screen';
import { commit, session } from '../session';
import { SKIN_TINT } from '../skin';
import { C, FS, OUTLINE, TITLE_STYLE, TOUCH } from '../theme';
import { button, dangerButton, ellipsize, emptyState, panel, pressable, ScrollArea, text, toast } from '../ui';

const ROW_H = 190;
const BOTTOM_Y = CONTENT_BOTTOM - 60;

export interface MailData {
  /** Открыть письмо сразу (id). */
  open?: string;
}

/** 'YYYY-MM-DD' → «27.09». */
function shortDate(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

/**
 * Почта: письма (новые сверху) — от кого, тема, вложение. Нажатие — письмо целиком и «Забрать»;
 * внизу «Забрать всё» и «Удалить прочитанные». Ядро — src/core/events/mail.ts.
 */
export class MailScene extends Phaser.Scene {
  private area!: ScrollArea;

  constructor() {
    super('Mail');
  }

  create(data: MailData = {}): void {
    touchToday();
    screen(this, 'Почта', 'Home', { to: 'Home' });
    const st = mailStatus(session.save);
    text(this, 50, CONTENT_TOP + 40, `Писем: ${st.letters.length}`, FS.h3, C.title, TITLE_STYLE).setOrigin(0, 0.5);
    if (st.unread) text(this, GAME_W - 50, CONTENT_TOP + 40, `Непрочитанных: ${st.unread}`, FS.body, C.success, { fontStyle: 'bold', ...OUTLINE }).setOrigin(1, 0.5);

    this.area = new ScrollArea(this, CONTENT_TOP + 90, BOTTOM_Y - 80);
    if (!st.letters.length) this.area.add(emptyState(this, GAME_W / 2, 200, 'Писем нет.\nПодарки и новости придут сюда.'));
    const rows = st.letters.map((l, i) => collect(this.area.content, () => this.row(l, ROW_H * (i + 0.5))));
    this.area.setContentHeight(ROW_H * st.letters.length + 10);
    staggerIn(this, 'Mail', rows);

    const all = button(this, GAME_W / 2 + 250, BOTTOM_Y, 460, TOUCH + 14, st.claimable ? 'ui_btn_primary' : 'ui_btn_secondary', 'Забрать всё', () => this.claimAll(), FS.h3);
    all.setEnabled(st.claimable > 0);
    all.container.setName('mailClaimAll');
    if (st.claimable) {
      pulse(this, all.container);
      badge(this, GAME_W / 2 + 250 + 230 - 22, BOTTOM_Y - (TOUCH + 14) / 2 + 16, st.claimable);
    }
    const removable = st.letters.filter((l) => l.read && !letterClaimable(l)).length;
    const del = dangerButton(this, GAME_W / 2 - 250, BOTTOM_Y, 460, TOUCH + 14, 'Удалить прочитанные', () => this.deleteRead(), FS.h3);
    del.setEnabled(removable > 0);

    const open = data.open && st.letters.find((l) => l.id === data.open);
    if (open) this.openLetter(open);
  }

  private row(l: Letter, y: number): void {
    const a = this.area;
    const claimable = letterClaimable(l);
    const fresh = !l.read;
    const bg = a.add(card(this, GAME_W / 2, y, 1020, ROW_H - 16, claimable || fresh));
    pressable(this, bg, 1020, ROW_H - 16, a.tap(() => this.openLetter(l)));
    bg.setName(`letter_${l.id}`);
    const dark = claimable || fresh;
    const main = dark ? C.ink : C.disabled;
    // Конверт: новое письмо — золотой, прочитанное — тусклый.
    a.add(this.add.image(110, y, 'skin_medallion').setDisplaySize(118, 118).setAlpha(dark ? 1 : 0.6));
    a.add(envelopeIcon(this, 110, y + 2, 58, dark ? SKIN_TINT.gold : SKIN_TINT.creamDim));
    a.add(ellipsize(text(this, 190, y - 50, l.title, FS.h3, main, { fontStyle: 'bold' }).setOrigin(0, 0.5), 620));
    a.add(text(this, 190, y - 5, `${l.from} · ${shortDate(l.day)}`, FS.small, dark ? C.inkMuted : C.disabled).setOrigin(0, 0.5));
    if (!isEmptyRewards(l.rewards)) {
      const r = rewardRow(this, 190, y + 45, l.rewards, { size: 36, font: FS.small, dim: !claimable });
      for (const o of r.objects) a.add(o);
    }
    const bx = 900;
    if (claimable) {
      const b = button(this, bx, y, 200, 96, 'ui_btn_primary', 'Забрать', a.tap(() => this.claim(l, { x: bx, y: this.area.content.y + y })), FS.h3);
      a.add(b.container);
      pulse(this, b.container);
    } else if (fresh) a.add(text(this, bx, y, 'Новое', FS.body, C.success, { fontStyle: 'bold' }));
    else if (l.claimed) a.add(text(this, bx, y, 'Получено', FS.small, C.disabled, { fontStyle: 'bold' }));
  }

  /** Письмо целиком: тема, от кого, текст, вложение и «Забрать» / «Закрыть». Открытие отмечает прочитанным. */
  private openLetter(l: Letter): void {
    if (!l.read) commit(readMail(session.save, l.id));
    const cx = GAME_W / 2;
    const cy = GAME_H / 2 - 40;
    const w = 940;
    const h = 1040;
    const layer = this.add.container(0, 0).setDepth(8500).setName('letterModal');
    this.area.locked = true;
    const close = () => {
      layer.destroy();
      this.scene.restart();
    };
    const shade = this.add.rectangle(cx, GAME_H / 2, GAME_W * 3, GAME_H * 3, 0x000000, 0.7).setInteractive();
    shade.on('pointerup', close);
    const box = panel(this, cx, cy, w, h, 'ui_panel').setInteractive();
    layer.add([shade, box]);
    layer.add(ribbon(this, cx, cy - h / 2 + 20, l.title, { size: FS.h2, minW: 520, maxW: 900 }));
    layer.add(text(this, cx, cy - h / 2 + 110, `От: ${l.from} · ${shortDate(l.day)}`, FS.small, C.muted, OUTLINE));
    layer.add(
      text(this, cx - w / 2 + 70, cy - h / 2 + 170, l.body || '(без текста)', FS.body, C.text, { ...OUTLINE, wordWrap: { width: w - 140 }, lineSpacing: 8, align: 'left' }).setOrigin(0, 0),
    );
    const claimable = letterClaimable(l);
    if (!isEmptyRewards(l.rewards)) {
      const ay = cy + h / 2 - 280;
      layer.add(text(this, cx, ay - 60, claimable ? 'Вложение' : 'Вложение получено', FS.h3, claimable ? C.title : C.disabled, TITLE_STYLE));
      const r = rewardRow(this, 0, ay + 10, l.rewards, { size: 48, font: FS.h3, dim: !claimable });
      const shift = cx - r.width / 2;
      for (const o of r.objects) {
        (o as unknown as Phaser.GameObjects.Components.Transform).x += shift;
        layer.add(o);
      }
    }
    const by = cy + h / 2 - 110;
    if (claimable) {
      const b = button(this, cx + 190, by, 340, TOUCH + 10, 'ui_btn_primary', 'Забрать', () => {
        layer.destroy();
        this.claim(l, { x: cx, y: by });
      }, FS.h2);
      b.container.setName('letterClaim');
      layer.add(b.container);
      layer.add(button(this, cx - 190, by, 340, TOUCH + 10, 'ui_btn_secondary', 'Закрыть', close, FS.h2).container);
    } else {
      layer.add(button(this, cx, by, 400, TOUCH + 10, 'ui_btn_secondary', 'Закрыть', close, FS.h2).container);
    }
    popIn(this, layer, shade);
  }

  private claim(l: Letter, at: { x: number; y: number }): void {
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = claimMail(session.save, l.id, GAME);
      commit(r.save);
      queueRewardFly('Mail', at, before);
      this.restartWithToast(rewardToast('Получено', r.rewards, r.events), r.events);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private claimAll(): void {
    const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
    const r = claimAllMail(session.save, GAME);
    if (!r.count) return toast(this, 'Забирать нечего');
    commit(r.save);
    queueRewardFly('Mail', { x: GAME_W / 2 + 250, y: BOTTOM_Y }, before, { burst: true });
    this.restartWithToast(rewardToast(`Писем: ${r.count}`, r.rewards, r.events), r.events);
  }

  private deleteRead(): void {
    const n = mailStatus(session.save).letters.filter((l) => l.read && !letterClaimable(l)).length;
    if (!n) return toast(this, 'Удалять нечего: прочитанных писем без вложений нет');
    confirm(this, `Удалить прочитанные письма (${n})? Письма с незабранным вложением останутся.`, 'Удалить', () => {
      const r = deleteReadMail(session.save);
      commit(r.save);
      this.scene.restart();
      this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, `Удалено писем: ${r.removed}`));
    }, { danger: true });
  }

  /** Вложение с «Контрактом героя» — сразу экран выбора героя (назад — в почту). */
  private restartWithToast(message: string, events: readonly { type: string }[] = []): void {
    if (events.some((e) => e.type === 'heroPick')) {
      this.scene.start('HeroPick', { back: { to: 'Mail' } });
      const sc = this.scene.get('HeroPick');
      sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, message, C.success, 4000));
      return;
    }
    this.scene.restart();
    this.events.once(Phaser.Scenes.Events.CREATE, () => afterRewardFly(this, () => toast(this, message, C.success, 4500)));
  }
}
