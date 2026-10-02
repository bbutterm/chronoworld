import Phaser from 'phaser';
import { claimAllMail, claimMail, deleteReadMail, isEmptyRewards, letterClaimable, mailStatus, readMail, type Letter, type StoryDef } from '../../core';
import { GAME } from '../content';
import { envelopeIcon, touchToday } from '../homeEvents';
import { collect, queueRewardFly, staggerIn, type Point } from '../juice';
import { GAME_W } from '../layout';
import { rewardToast } from '../rewardsView';
import { bottomSheet, confirm, CONTENT_TOP, cta, screen } from '../screen';
import { commit, session } from '../session';
import { framedPortrait } from '../portraitFrame';
import { speakerView } from '../storyView';
import { C, COLOR, COLOR_N, leading, S, T } from '../theme';
import { button, emptyState, rewardRow, ScrollArea, text, toast } from '../ui';
import { groupRows, letterState, type RowState } from '../inboxOrder';
import { bundleChips, claimAllButton, claimAllY, inboxRow, listBottom, playClaimFx, queueClaimFx, ROW_STEP } from '../inboxRows';

export interface MailData {
  /** Открыть письмо сразу (id). */
  open?: string;
  scroll?: number;
}

/** 'YYYY-MM-DD' → «27.09». */
function shortDate(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

/** Подпись письма «Гаррет» — спикер сюжета «Капитан Гаррет». */
function isSender(name: string | undefined, from: string): boolean {
  return !!name && (name === from || name.endsWith(` ${from}`));
}

/** Размер аватара отправителя в строке. */
const AVATAR = 96;

/**
 * Почта: письма строками — аватар отправителя (или конверт), точка «не прочитано», тема, «от кого · дата», вложение
 * чипами справа. С вложением — сверху с золотой кромкой; прочитанные — приглушены внизу. Нажатие — лист снизу
 * с текстом и «Забрать». «Забрать всё» — внизу, только когда есть вложения. Ядро — src/core/events/mail.ts.
 */
export class MailScene extends Phaser.Scene {
  private area!: ScrollArea;
  /** Отправитель → ключ сюжетного спикера (портрет). */
  private speakers = new Map<string, { story: StoryDef | undefined; key: string } | null>();

  constructor() {
    super('Mail');
  }

  create(data: MailData = {}): void {
    touchToday();
    screen(this, 'Почта', 'Home', { to: 'Home' });
    const st = mailStatus(session.save);
    if (st.claimable) claimAllButton(this, () => this.claimAll(), 'mailClaimAll');

    this.area = new ScrollArea(this, CONTENT_TOP + S.xs, listBottom(st.claimable > 0));
    if (!st.letters.length) this.area.add(emptyState(this, GAME_W / 2, 200, 'Писем нет'));
    const g = groupRows(st.letters, (l) => letterState(l, letterClaimable(l)));
    const rows: Phaser.GameObjects.GameObject[][] = [];
    let y = 0;
    const list = [...g.ready.map((l) => [l, 'ready'] as const), ...g.active.map((l) => [l, 'active'] as const), ...g.done.map((l) => [l, 'done'] as const)];
    for (const [l, state] of list) {
      const cy = y + (ROW_STEP - S.xs) / 2;
      rows.push(collect(this.area.content, () => this.area.add(this.row(l, state, cy))));
      y += ROW_STEP;
    }
    // Прочитанные без вложений — удалить разом (тёмная кнопка с красной подписью в конце списка).
    const removable = st.letters.filter((l) => l.read && !letterClaimable(l)).length;
    if (removable) {
      const del = button(this, GAME_W / 2, y + 60, 520, 96, '', 'Удалить прочитанные', this.area.tap(() => this.deleteRead(removable)), T.body, { variant: 'danger' });
      del.container.setName('mailDelete');
      this.area.add(del.container);
      y += 120 + S.xs;
    }
    this.area.setContentHeight(y);
    if (data.scroll) this.area.offset = data.scroll;
    staggerIn(this, 'Mail', rows);
    playClaimFx(this);

    const open = data.open && st.letters.find((l) => l.id === data.open);
    if (open) this.openLetter(open);
  }

  /** Портрет отправителя, если это персонаж сюжета (Гаррет); иначе конверт. */
  private avatar(from: string, state: RowState): Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform {
    if (!this.speakers.has(from)) {
      const stories: StoryDef[] = Object.values(GAME.story.chapters);
      let found: { story: StoryDef; key: string } | null = null;
      for (const story of stories) {
        const key = Object.keys(story.speakers ?? {}).find((k) => isSender(story.speakers[k]?.name, from));
        if (key) {
          found = { story, key };
          break;
        }
      }
      this.speakers.set(from, found);
    }
    const sp = this.speakers.get(from);
    const who = sp ? speakerView(sp.story, sp.key, session.save, GAME) : null;
    if (who?.sprite) {
      const face = framedPortrait(this, 0, 0, who.sprite, AVATAR, who.gender);
      if (state === 'done') face.setAlpha(0.55);
      return face;
    }
    return envelopeIcon(this, 0, 0, 60, state === 'done' ? COLOR_N.textTertiary : state === 'ready' ? COLOR_N.accent : COLOR_N.textSecondary);
  }

  private row(l: Letter, state: RowState, cy: number): Phaser.GameObjects.Container {
    // Вложение — чипами второй строкой (отправителя видно по аватару); без вложения — «от кого · дата».
    const line = isEmptyRewards(l.rewards) ? { text: `${l.from} · ${shortDate(l.day)}` } : { chips: bundleChips(l.rewards) };
    const row = inboxRow(this, GAME_W / 2, cy, {
      state,
      icon: this.avatar(l.from, state),
      title: l.title,
      line,
      onTap: this.area.tap(() => this.openLetter(l)),
    }).setName(`letter_${l.id}`);
    if (!l.read) {
      // Не прочитано — красная точка в углу аватара.
      const ix = -row.width / 2 + S.s + 52;
      row.add(this.add.circle(ix + 44, -44, 12, COLOR_N.badge).setStrokeStyle(3, COLOR_N.bg, 0.9).setName('unread'));
    }
    return row;
  }

  /** Письмо в листе снизу: от кого, текст, вложение и «Забрать». Открытие отмечает прочитанным. */
  private openLetter(l: Letter): void {
    const fresh = !l.read;
    if (fresh) commit(readMail(session.save, l.id));
    const claimable = letterClaimable(l);
    let claiming = false;
    bottomSheet(
      this,
      l.title,
      (c, width, close) => {
        let y = 0;
        c.add(text(this, 0, y, `${l.from} · ${shortDate(l.day)}`, T.caption, COLOR.textSecondary).setOrigin(0, 0));
        y += T.caption + S.s;
        const body = text(this, 0, y, l.body || '…', T.body, COLOR.textPrimary, { align: 'left', wordWrap: { width, useAdvancedWrap: true }, lineSpacing: leading(T.body) }).setOrigin(0, 0);
        c.add(body);
        y += body.height + S.l;
        if (!isEmptyRewards(l.rewards)) {
          const r = rewardRow(this, 0, 0, bundleChips(l.rewards), { maxW: width });
          r.setPosition(r.width / 2, y + 36);
          if (!claimable) r.setAlpha(0.45);
          c.add(r);
          y += r.height + S.l;
        }
        if (claimable) {
          const b = cta(this, width / 2, y + 61, 'Забрать', () => {
            claiming = true;
            close();
            this.claim(l, { x: GAME_W / 2, y: claimAllY() - 200 });
          }, { w: 600, h: 122 });
          b.container.setName('letterClaim');
          c.add(b.container);
          y += 122;
        }
        return y;
      },
      // Прочитанное письмо уходит вниз списка — перестроить (кроме «Забрать»: тот перезапускает экран сам).
      { onClose: () => !claiming && fresh && this.scene.restart({ scroll: this.area.offset } satisfies MailData) },
    );
  }

  private claim(l: Letter, at: Point): void {
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = claimMail(session.save, l.id, GAME);
      commit(r.save);
      queueRewardFly('Mail', at, before);
      this.after(r.events, rewardToast('Получено', r.rewards, r.events), at, bundleChips(r.rewards));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private claimAll(): void {
    const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
    const r = claimAllMail(session.save, GAME);
    if (!r.count) return;
    commit(r.save);
    const at = { x: GAME_W / 2, y: claimAllY() };
    queueRewardFly('Mail', at, before, { burst: true });
    this.after(r.events, rewardToast(`Писем: ${r.count}`, r.rewards, r.events), at, bundleChips(r.rewards));
  }

  private deleteRead(n: number): void {
    confirm(this, `Удалить прочитанные письма (${n})? Письма с вложением останутся.`, 'Удалить', () => {
      commit(deleteReadMail(session.save).save);
      this.scene.restart();
    }, { danger: true });
  }

  /**
   * После получения: «Контракт героя» — сразу выбор героя (назад — в почту), с пояснением тостом; иначе экран
   * перестраивается, монеты летят в шапку, опыт и карты всплывают чипами, выпавшие карты героев — тостом.
   */
  private after(events: readonly { type: string; name?: string }[], message: string, at: Point, chips: ReturnType<typeof bundleChips>): void {
    if (events.some((e) => e.type === 'heroPick')) {
      this.scene.start('HeroPick', { back: { to: 'Mail' } });
      const sc = this.scene.get('HeroPick');
      sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, message, C.success, 4000));
      return;
    }
    const cards = message.split('\n').filter((s) => s.startsWith('Карта героя'));
    queueClaimFx('Mail', at, chips, cards);
    this.scene.restart({ scroll: this.area.offset } satisfies MailData);
  }
}
