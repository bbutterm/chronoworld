import Phaser from 'phaser';
import {
  actClaimBounty,
  bountyName,
  bountyStatus,
  ensureBoard,
  refreshBoard,
  refreshesLeft,
  startBounty,
  type ActiveBountyView,
  type Bounty,
  heroCard,
} from '../../core';
import { GAME } from '../content';
import {
  BOUNTY_RARITY_COLORS,
  BOUNTY_RARITY_NAMES,
  bountyPickBlocker,
  countdownText,
  describeEvents,
  durationText,
  heroSprite,
  metaRewardsText,
  ROLE_NAMES,
} from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { confirm, confirmOpen, CONTENT_BOTTOM, CONTENT_TOP, portrait, screen } from '../screen';
import { commit, now, session, today } from '../session';
import { portraitKey } from '../sprites';
import { button, ellipsize, emptyState, panel, pressable, progressBar, ScrollArea, text, toast } from '../ui';
import { C, FS, TINT, TOUCH } from '../theme';
import { afterRewardFly, collect, pulse, queueRewardFly, staggerIn, type Point } from '../juice';

const LIST_TOP = CONTENT_TOP + 120;
const ACTIVE_H = 170;
const BOARD_H = 210;

interface Timer {
  bounty: ActiveBountyView;
  label: Phaser.GameObjects.Text;
  fill: Phaser.GameObjects.Rectangle;
  barW: number;
}

/**
 * K9. Доска поручений: поручения в работе (обратный отсчёт, «Забрать») и доска на сегодня
 * (нажатие — выбор героев и отправка). Обновление доски — раз в день бесплатно + ручные обновления.
 */
export class BountiesScene extends Phaser.Scene {
  private area!: ScrollArea;
  private timers: Timer[] = [];

  constructor() {
    super('Bounties');
  }

  create(data: { scroll?: number } = {}): void {
    screen(this, 'Поручения', 'Home', { to: 'Home' });
    // Новый день — новая доска (бесплатно). Та же доска — тот же объект, запись не нужна.
    const ensured = ensureBoard(session.save, today(), session.save.battleSeq, GAME);
    if (ensured !== session.save) commit(ensured);

    const save = session.save;
    const st = bountyStatus(save, now());
    const left = refreshesLeft(save, today(), GAME);
    text(this, 40, CONTENT_TOP + 50, 'Герои на поручении\nпродолжают сражаться', FS.small, C.muted, { align: 'left', lineSpacing: 4 }).setOrigin(0, 0.5);
    const rb = button(this, 790, CONTENT_TOP + 50, 520, 100, left > 0 ? 'ui_btn_secondary' : 'k:buttonLong_grey', `Обновить доску (${left})`, () => this.refresh(), FS.h3);
    if (left <= 0) rb.container.setAlpha(0.6);

    this.area = new ScrollArea(this, LIST_TOP, CONTENT_BOTTOM + 10);
    this.timers = [];
    const rows: Phaser.GameObjects.GameObject[][] = [];
    let y = 0;
    if (!st.active.length && st.board.length) {
      this.area.add(emptyState(this, GAME_W / 2, y + 50, 'Сейчас никто не на поручении — выберите поручение ниже.', 980).setFontSize(FS.small));
      y += 100;
    }
    if (st.active.length) {
      y = this.header(y, `В работе · ${st.active.length}`);
      for (const b of st.active) {
        const yy = y;
        rows.push(collect(this.area.content, () => this.activeRow(b, yy + ACTIVE_H / 2)));
        y += ACTIVE_H;
      }
      y += 20;
    }
    y = this.header(y, `Доска на сегодня · ${st.board.length}`);
    if (!st.board.length) {
      this.area.add(emptyState(this, GAME_W / 2, y + 90, 'Все поручения розданы.\nНовая доска — завтра или по кнопке «Обновить доску».'));
      y += 200;
    }
    const busy = new Set(st.busyHeroes);
    for (const b of st.board) {
      const yy = y;
      rows.push(collect(this.area.content, () => this.boardRow(b, yy + BOARD_H / 2, busy)));
      y += BOARD_H;
    }
    this.area.setContentHeight(y + 20);
    if (data.scroll) this.area.offset = data.scroll;
    staggerIn(this, 'Bounties', rows);

    // Отсчёт — раз в секунду, а не каждый кадр. Поручение завершилось — перерисовать (появится «Забрать»).
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
  }

  private header(y: number, title: string): number {
    this.area.add(text(this, 50, y + 32, title, FS.h3, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5));
    return y + 70;
  }

  private heroFaces(ids: readonly string[], x0: number, y: number, size: number): void {
    ids.forEach((id, i) => {
      const hero = session.save.heroes.find((h) => h.id === id);
      const x = x0 + i * (size + 8);
      this.area.add(this.add.rectangle(x, y, size, size, 0x1a120a, 0.6).setStrokeStyle(2, 0x000000, 0.5));
      if (hero) this.area.add(portrait(this, x, y, portraitKey(heroSprite(hero, GAME)), size - 4));
    });
  }

  private activeRow(b: ActiveBountyView, y: number): void {
    const a = this.area;
    a.add(panel(this, GAME_W / 2, y, 1020, ACTIVE_H - 14, b.done ? 'ui_panel_light' : 'ui_panel'));
    const color = b.done ? C.ink : (BOUNTY_RARITY_COLORS[b.rarity] ?? C.text);
    a.add(
      ellipsize(
        text(this, 70, y - 45, bountyName(b, GAME), FS.h3, color, {
          fontStyle: 'bold',
          stroke: b.done ? C.none : C.stroke,
          strokeThickness: b.done ? 0 : 5,
        }).setOrigin(0, 0.5),
        660,
      ),
    );
    this.heroFaces(b.heroIds, 100, y + 20, 64);
    a.add(text(this, 100 + b.heroIds.length * 72, y + 20, metaRewardsText(b.rewards), FS.small, b.done ? C.inkMuted : C.gold, { fontStyle: 'bold' }).setOrigin(0, 0.5));
    if (b.done) {
      const btn = button(this, 880, y, 250, 110, 'ui_btn_primary', 'Забрать', a.tap(() => this.claim(b, { x: 880, y: this.area.content.y + y })), FS.h3);
      a.add(btn.container);
      pulse(this, btn.container);
      return;
    }
    const label = a.add(text(this, 880, y - 45, countdownText(b.remainingMs), FS.h3, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }));
    const barW = 1000 - 80;
    const bar = a.add(progressBar(this, 70, y + 66, barW, 16, 0, TINT.info));
    const fill = bar.list[1] as Phaser.GameObjects.Rectangle;
    const t: Timer = { bounty: b, label, fill, barW };
    this.updateTimer(t, now());
    this.timers.push(t);
  }

  private updateTimer(t: Timer, at: number): void {
    const b = t.bounty;
    const total = Math.max(1, b.endsAt - b.startedAt);
    const pct = Phaser.Math.Clamp((at - b.startedAt) / total, 0, 1);
    t.label.setText(countdownText(b.endsAt - at));
    t.fill.width = (t.barW - 4) * pct;
  }

  private tick(): void {
    const at = now();
    // Окно выбора героев или подтверждение открыто — не перезапускать экран (выбор пропал бы); перерисуем после.
    const modal = this.area.locked || confirmOpen(this);
    if (!modal && this.timers.some((t) => at >= t.bounty.endsAt)) {
      this.scene.restart({ scroll: this.area.offset });
      return;
    }
    for (const t of this.timers) this.updateTimer(t, at);
  }

  private boardRow(b: Bounty, y: number, busy: Set<string>): void {
    const a = this.area;
    const bg = a.add(panel(this, GAME_W / 2, y, 1020, BOARD_H - 14, 'ui_panel'));
    pressable(this, bg, 1020, BOARD_H - 14, a.tap(() => this.pick(b, busy)));
    const color = BOUNTY_RARITY_COLORS[b.rarity] ?? C.text;
    // Редкое и выше — цветная полоса у левого края карточки и лёгкий отсвет (видно ценность, не читая подпись).
    if (b.rarity !== 'common') {
      const tint = Phaser.Display.Color.HexStringToColor(color).color;
      a.add(this.add.image(GAME_W / 2 - 300, y, 'skin_glow').setDisplaySize(700, BOARD_H).setTint(tint).setAlpha(0.1).setBlendMode(Phaser.BlendModes.ADD));
      a.add(this.add.rectangle(GAME_W / 2 - 1020 / 2 + 16, y, 7, BOARD_H - 60, tint, 0.9));
    }
    a.add(ellipsize(text(this, 70, y - 55, bountyName(b, GAME), FS.h3, color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5), 700));
    a.add(text(this, 70, y - 8, BOUNTY_RARITY_NAMES[b.rarity] ?? b.rarity, FS.caption, color, { stroke: C.stroke, strokeThickness: 3 }).setOrigin(0, 0.5));
    const need = `${durationText(b.durationMinutes)} · героев: ${b.heroCount}${b.role ? ` · нужен ${(ROLE_NAMES[b.role] ?? b.role).toLowerCase()}` : ''}`;
    a.add(ellipsize(text(this, 260, y - 8, need, FS.small, C.text, { stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5), 1000 - 260));
    a.add(ellipsize(text(this, 70, y + 45, `Награда: ${metaRewardsText(b.rewards, ' в запас')}`, FS.small, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5), 940));
    // Золотая кнопка на экране — только «Забрать» (готово к получению); «Выбрать» — вторичная, карточка нажимается целиком.
    a.add(button(this, 895, y - 40, 200, TOUCH, 'ui_btn_secondary', 'Выбрать', a.tap(() => this.pick(b, busy)), FS.body).container);
  }

  // ---------- выбор героев ----------

  private pick(b: Bounty, busy: Set<string>): void {
    this.area.locked = true;
    const save = session.save;
    const chosen: string[] = [];
    const layer = this.add.container(0, 0).setDepth(9000);
    const close = () => {
      layer.destroy();
      this.area.locked = false;
    };
    const cy = GAME_H / 2;
    layer.add(this.add.rectangle(GAME_W / 2, cy, GAME_W, GAME_H, 0x000000, 0.75).setInteractive());
    layer.add(panel(this, GAME_W / 2, cy, 1040, 1000, 'ui_panel'));
    const color = BOUNTY_RARITY_COLORS[b.rarity] ?? C.text;
    layer.add(text(this, GAME_W / 2, cy - 420, bountyName(b, GAME), FS.h2, color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }));
    const role = b.role ? `, среди них ${(ROLE_NAMES[b.role] ?? b.role).toLowerCase()}` : '';
    layer.add(text(this, GAME_W / 2, cy - 360, `${durationText(b.durationMinutes)} · нужно героев: ${b.heroCount}${role}`, FS.body, C.text));
    layer.add(text(this, GAME_W / 2, cy - 315, `Награда: ${metaRewardsText(b.rewards, ' в запас')}`, FS.body, C.gold, { fontStyle: 'bold' }));

    const tiles = this.add.container(0, 0);
    layer.add(tiles);
    const status = text(this, GAME_W / 2, cy + 230, '', FS.body, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5, wordWrap: { width: 900 } });
    layer.add(status);
    const send = button(this, GAME_W / 2 - 230, cy + 380, 420, 120, 'ui_btn_primary', 'Отправить', () => {
      const blocker = bountyPickBlocker(b, chosen, session.save, GAME);
      if (blocker) {
        // T3-28: причина — в самом окне (строка статуса), а не тостом под шапкой за затемнением.
        status.setText(blocker).setColor(C.error);
        this.tweens.add({ targets: status, x: { from: GAME_W / 2 - 14, to: GAME_W / 2 }, duration: 260, ease: 'Elastic.easeOut' });
        return;
      }
      try {
        commit(startBounty(session.save, b.id, chosen, now(), GAME));
        close();
        this.scene.restart({ scroll: this.area.offset });
        this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, `Герои отправлены: «${bountyName(b, GAME)}»`, C.success));
      } catch (e) {
        toast(this, e instanceof Error ? e.message : String(e), C.error);
      }
    }, FS.h2);
    layer.add(send.container);
    layer.add(button(this, GAME_W / 2 + 230, cy + 380, 420, 120, 'k:buttonLong_beige', 'Отмена', close, FS.h2).container);

    const draw = () => {
      tiles.removeAll(true);
      const n = save.heroes.length;
      const step = Math.min(196, 1000 / Math.max(1, n));
      save.heroes.forEach((h, i) => {
        const x = GAME_W / 2 + (i - (n - 1) / 2) * step;
        const y = cy - 60;
        const isBusy = busy.has(h.id);
        const sel = chosen.includes(h.id);
        const c = heroCard(h, GAME);
        const bg = panel(this, x, y, step - 12, 330, sel ? 'ui_slot_selected' : 'ui_slot_filled');
        tiles.add(bg);
        const face = portrait(this, x, y - 60, portraitKey(heroSprite(h, GAME)), 140);
        tiles.add(face);
        tiles.add(ellipsize(text(this, x, y + 45, c.name, FS.body, sel ? C.ink : C.text, { fontStyle: 'bold', stroke: sel ? C.none : C.stroke, strokeThickness: sel ? 0 : 5 }), step - 24));
        const roleOk = b.role && c.role === b.role;
        tiles.add(text(this, x, y + 85, ROLE_NAMES[c.role] ?? '', FS.caption, roleOk ? C.inkSuccess : sel ? C.inkMuted : C.title, { fontStyle: roleOk ? 'bold' : 'normal', stroke: sel ? C.none : C.stroke, strokeThickness: sel ? 0 : 3 }));
        tiles.add(ellipsize(text(this, x, y + 120, c.jobName, FS.caption, sel ? C.inkMuted : C.muted, { stroke: sel ? C.none : C.stroke, strokeThickness: sel ? 0 : 3 }), step - 24));
        if (isBusy) {
          bg.setAlpha(0.4);
          face.setAlpha(0.35);
          tiles.add(text(this, x, y - 60, 'занят', FS.body, C.text, { fontStyle: 'bold', backgroundColor: C.labelBusy, padding: { x: 10, y: 4 } }));
          return;
        }
        pressable(this, bg, step - 12, 330, () => {
          const at = chosen.indexOf(h.id);
          if (at >= 0) chosen.splice(at, 1);
          else if (chosen.length < b.heroCount) chosen.push(h.id);
          else if (b.heroCount === 1) chosen.splice(0, 1, h.id);
          else {
            status.setText(`Уже выбрано ${b.heroCount} — снимите кого-нибудь`).setColor(C.error);
            return;
          }
          draw();
        });
      });
      const free = save.heroes.filter((h) => !busy.has(h.id)).length;
      const blocker = free < b.heroCount ? `Свободных героев: ${free} из ${b.heroCount} — дождитесь возвращения` : bountyPickBlocker(b, chosen, session.save, GAME);
      status.setText(blocker ?? 'Готово к отправке').setColor(blocker ? C.warning : C.success);
      send.container.setAlpha(blocker ? 0.5 : 1);
    };
    draw();
  }

  // ---------- действия ----------

  private claim(b: ActiveBountyView, at: Point): void {
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = actClaimBounty(session.save, today(), b.id, now(), GAME);
      commit(r.save);
      queueRewardFly('Bounties', at, before);
      const lines = [`«${bountyName(b, GAME)}»: ${metaRewardsText(r.rewards, ' в запас')}`, ...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы'))];
      this.scene.restart({ scroll: this.area.offset });
      this.events.once(Phaser.Scenes.Events.CREATE, () => afterRewardFly(this, () => toast(this, lines.join('\n'), C.success, 4500)));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private refresh(): void {
    if (refreshesLeft(session.save, today(), GAME) <= 0) {
      toast(this, 'Обновления на сегодня закончились — новая доска будет завтра');
      return;
    }
    confirm(this, 'Обновить доску?\nНевзятые поручения заменятся новыми, поручения в работе останутся.', 'Обновить', () => this.doRefresh());
  }

  private doRefresh(): void {
    try {
      const next = refreshBoard(session.save, today(), session.save.battleSeq, GAME);
      commit(next);
      this.scene.restart();
      this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, 'Доска обновлена', C.success));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }
}
