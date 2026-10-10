import Phaser from 'phaser';
import { actClaimActivity, actClaimAllQuests, actClaimQuest, questStatus, type ActivityKind, type MilestoneView, type QuestView } from '../../core';
import { GAME } from '../content';
import { describeEvents, questDestination, untilReset } from '../flow';
import { GAME_W } from '../layout';
import { contentBottom, CONTENT_TOP, refreshScreen, screen } from '../screen';
import { bump, collect, countUp, decorTween, juiceOn, pulse, queueRewardFly, staggerIn, type Point } from '../juice';
import { commit, now, session, today } from '../session';
import { chip, emptyState, groupNum, plate, pressable, progressBar, rewardRow, ScrollArea, shieldTaps, SURFACE, text, toast, type ButtonView, type ChipSpec } from '../ui';
import { markHint } from '../hints';
import { skinIcon, type SkinIcon } from '../skin';
import { roIconImage } from '../itemIcons';
import { C, COLOR, COLOR_N, E, M, R, S, T, Z } from '../theme';
import { claimState, groupRows, trackPos } from '../inboxOrder';
import {
  checkMark,
  chevron,
  claimAllButton,
  claimButton,
  foldRow,
  glyph,
  glyphColor,
  metaChips,
  playClaimFx,
  queueClaimFx,
  ROW_W,
} from '../inboxRows';

import { utilityInboxRow as inboxRow, utilityListLayout, utilityRowHeight } from '../utilityScreenLayout';
import { onViewChange } from '../viewport';

export interface QuestsData {
  scroll?: number;
  /** Свёртка «Выполнено» раскрыта. */
  open?: boolean;
}

/** Дорожка активности: карточка под шапкой. */
const TRACK = { h: 260, medal: 150, x0: 300, x1: GAME_W - S.l - S.m - 44, chest: 76 } as const;

/** Иконка задания по событию, которое его двигает. */
const QUEST_ICON: Record<ActivityKind, SkinIcon> = {
  stage_win: 'swords',
  stage_attempt: 'flag',
  offline_claim: 'chest',
  fast_rewards: 'hourglass',
  summon: 'scroll',
  hero_level_up: 'star',
  hero_ascend: 'helmet',
  tower_attempt: 'tower',
  expedition_claim: 'compass',
  hunt_attempt: 'trophy',
  shop_buy: 'bag',
  arena_wins: 'castle',
  kitchen_cook: 'pot',
};

/** Очки активности до «Забрать» — для отсчёта числа на новом экране. */
let pointsBefore: number | null = null;

/**
 * K5. Задания дня (AFK): сверху дорожка очков активности с сундуками-порогами, ниже — задания: готовые к получению
 * сверху (золотая кромка, «Забрать»), в процессе — с полосой (нажатие ведёт туда, где задание делается),
 * выполненные — свёрнуты в «Выполнено · N». «Забрать всё» — внизу, только когда есть что забрать.
 */
export class QuestsScene extends Phaser.Scene {
  private area!: ScrollArea;
  private open = false;
  private tip: Phaser.GameObjects.Container | null = null;
  private claimAllControl?: ButtonView;
  private trackParts: Phaser.GameObjects.GameObject[] = [];
  private trackTimer?: Phaser.GameObjects.Container;

  constructor() {
    super('Quests');
  }

  create(data: QuestsData = {}): void {
    this.tip = null;
    screen(this, 'Задания дня', 'Home', { to: 'Home' });
    // Обучение (hints.ts): последний шаг цепочки главы 1 — задания открыты и найдены.
    markHint('quests_open');
    this.claimAllControl = undefined;
    this.trackParts = [];
    this.trackTimer = undefined;
    this.area = new ScrollArea(this, CONTENT_TOP + S.xs + TRACK.h + S.s, contentBottom());
    this.area.content.setName('questsScroll');
    this.open = data.open ?? false;
    this.drawList(data.scroll ?? 0, data.open === undefined);
    onViewChange(this, () => this.layoutList());
    let day = today();
    this.time.addEvent({ delay: 5000, loop: true, callback: () => {
      if (today() === day) return;
      day = today();
      refreshScreen(this);
      this.drawList();
    } });
    this.time.addEvent({ delay: 30_000, loop: true, callback: () => this.drawTrackTimer() });
  }

  private layoutList(): void {
    const l = utilityListLayout(CONTENT_TOP + S.xs + TRACK.h + S.s, contentBottom(), !!this.claimAllControl);
    this.area.setBounds(l.top, l.bottom);
    this.claimAllControl?.container.setY(l.claimY);
  }

  private drawList(scroll = this.area.offset, defaultFold = false): void {
    this.tip?.destroy();
    this.tip = null;
    this.area.clear();
    this.claimAllControl?.container.destroy();
    this.claimAllControl = undefined;
    this.trackTimer?.destroy();
    for (const o of this.trackParts) if (o.scene) o.destroy();
    const st = questStatus(session.save, GAME, today());
    this.trackParts = collect(this.children, () => this.track(st.activity, st.maxActivity, st.milestones, CONTENT_TOP + S.xs));
    const ready = st.quests.filter((q) => q.done && !q.claimed).length + st.milestones.filter((m) => m.reached && !m.claimed).length;
    if (ready) this.claimAllControl = claimAllButton(this, () => this.claimAll(), 'questsClaimAll');
    this.layoutList();
    if (!st.quests.length) this.area.add(emptyState(this, GAME_W / 2, 160, 'На сегодня заданий нет'));
    const g = groupRows(st.quests, claimState, (q) => q.progress / q.target);
    if (defaultFold) this.open = !g.ready.length && !g.active.length;
    const rows: Phaser.GameObjects.GameObject[][] = [];
    let y = 0;
    const put = (h: number, build: (cy: number) => void) => {
      rows.push(collect(this.area.content, () => build(y + h / 2)));
      y += h + S.xs;
    };
    for (const q of [...g.ready, ...g.active]) put(this.rowHeight(q), (cy) => this.area.add(this.questRow(q, cy)));
    if (g.done.length) {
      put(utilityRowHeight(), (cy) => this.area.add(foldRow(this, GAME_W / 2, cy, 'Выполнено', g.done.length, this.open, this.area.tap(() => this.refreshKeep({ open: !this.open }))).setSize(ROW_W, utilityRowHeight())));
      if (this.open) for (const q of g.done) put(utilityRowHeight(), (cy) => this.area.add(this.questRow(q, cy)));
    }
    this.area.setContentHeight(y);
    this.area.offset = scroll;
    staggerIn(this, 'Quests', rows);
    playClaimFx(this);
  }

  private rowHeight(q: QuestView): number {
    const state = claimState(q);
    return utilityRowHeight(state === 'done' ? undefined : state === 'ready' ? { chips: [] } : { progress: q.progress, target: q.target, key: '', chips: [{ icon: glyph('star', COLOR.accent), value: q.points }] });
  }

  private drawTrackTimer(): void {
    this.trackTimer?.destroy();
    const mx = S.l + S.m + TRACK.medal / 2;
    this.trackTimer = chip(this, mx, CONTENT_TOP + S.xs + TRACK.h - 44, 'hourglass', untilReset(new Date(now())), 'neutral', { size: 's', bg: false });
  }

  /** Карточка активности: медальон с очками и таймером сброса, дорожка с сундуками-порогами. */
  private track(activity: number, max: number, milestones: MilestoneView[], top: number): void {
    const cy = top + TRACK.h / 2;
    plate(this, GAME_W / 2, cy, ROW_W, TRACK.h, { ...SURFACE.surface, r: R.l });
    const mx = S.l + S.m + TRACK.medal / 2;
    const my = cy - 22;
    const medal = this.add.container(mx, my, [
      plate(this, 0, 0, TRACK.medal, TRACK.medal, { ...SURFACE.sunken, border: COLOR.border, borderW: 3, r: R.pill }),
      this.add.image(0, -36, skinIcon('star')).setDisplaySize(44, 44).setTint(COLOR_N.accent),
    ]);
    const num = text(this, 0, 18, groupNum(activity), T.title, COLOR.title, { fontStyle: 'bold' });
    medal.add(num).setName('activity');
    if (pointsBefore !== null && pointsBefore !== activity) {
      const from = pointsBefore;
      num.setText(groupNum(from));
      countUp(this, num, from, activity, groupNum, { onDone: () => bump(this, medal, 1.08) });
    }
    pointsBefore = null;
    // Сброс заданий: песочные часы и время — под медальоном.
    this.drawTrackTimer();

    // Полоса — по центру карточки; сундуки — над ней, пороги — под ней (не поверх полосы).
    const ty = cy + S.xs;
    progressBar(this, TRACK.x0, ty, TRACK.x1 - TRACK.x0, 24, max ? activity / max : 0, COLOR_N.accent, { key: 'quests:activity' });
    for (const m of milestones) this.chest(m, TRACK.x0 + (TRACK.x1 - TRACK.x0) * trackPos(m.points, max), ty - TRACK.chest / 2 - 20, ty + 46);
  }

  /** Порог активности — сундук: готов — светится и подпрыгивает (нажатие забирает), получен — открыт и приглушён. */
  private chest(m: MilestoneView, x: number, y: number, labelY: number): void {
    const ready = m.reached && !m.claimed;
    const size = TRACK.chest;
    if (ready) {
      const glow = this.add.image(x, y, 'skin_glow').setDisplaySize(size * 1.9, size * 1.9).setTint(COLOR_N.accent).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.8);
      decorTween(this, { targets: glow, alpha: 0.35, yoyo: true, repeat: -1, duration: M.emphasis * 2, ease: E.inOut });
    }
    // Картинка RO — целым масштабом; пульс — у контейнера (масштаб картинки не трогаем).
    const img = roIconImage(this, 0, 0, 'treasure_chest', size) ?? this.add.image(0, 0, skinIcon('chest')).setDisplaySize(size, size).setTint(COLOR_N.accent);
    const box = this.add.container(x, y, [img]);
    if (m.claimed) {
      img.setAlpha(0.5);
      box.add(this.add.image(size * 0.3, size * 0.2, skinIcon('check')).setDisplaySize(48, 48).setTint(COLOR_N.positive));
    }
    if (ready) pulse(this, box, 1.12, M.emphasis);
    text(this, x, labelY, groupNum(m.points), T.caption, ready ? COLOR.accent : m.claimed ? COLOR.textTertiary : COLOR.textSecondary, { fontStyle: 'bold' });
    const hitH = labelY + 24 - (y - size / 2);
    const hit = this.add.zone(x, (y - size / 2 + labelY + 24) / 2, 120, hitH).setName(`milestone_${m.points}`);
    pressable(this, hit, 120, hitH, () => (ready ? this.claimMilestone(m, { x, y }) : this.chestTip(m, x, y)));
  }

  /** Что в сундуке — всплывающая плашка с чипами под дорожкой (до следующего касания). */
  private chestTip(m: MilestoneView, x: number, y: number): void {
    this.tip?.destroy();
    const chips = metaChips(m.rewards);
    if (!chips.length) return;
    const row = rewardRow(this, 0, 0, chips, { size: 's', gap: S.xxs });
    const w = row.width + 2 * S.s;
    const h = 96;
    const cx = Phaser.Math.Clamp(x, S.l + w / 2, GAME_W - S.l - w / 2);
    const cy = y + TRACK.chest / 2 + 110;
    const tip = this.add.container(cx, cy, [plate(this, 0, 0, w, h, { ...SURFACE.raised, r: R.m }), row]).setDepth(Z.sticky).setName('chestTip');
    if (m.claimed) row.setAlpha(0.5);
    this.tip = tip;
    if (juiceOn()) {
      tip.setAlpha(0).setY(cy + S.xs);
      this.tweens.add({ targets: tip, alpha: 1, y: cy, duration: M.fast, ease: E.out });
    }
    this.time.delayedCall(16, () => this.input.once('pointerdown', () => tip.destroy()));
  }

  private questRow(q: QuestView, cy: number): Phaser.GameObjects.Container {
    const state = claimState(q);
    const points: ChipSpec = { icon: glyph('star', COLOR.accent), value: `+${q.points}`, tone: 'accent' };
    if (state === 'ready') {
      return inboxRow(this, GAME_W / 2, cy, {
        state,
        icon: glyph(QUEST_ICON[q.event], glyphColor(state)),
        title: q.name,
        line: { chips: [points] },
        trailing: claimButton(this, this.area.tap(() => this.claim(q))),
        onTap: this.area.tap(() => this.claim(q)),
      }).setName(`quest_${q.id}`);
    }
    if (state === 'active') {
      return inboxRow(this, GAME_W / 2, cy, {
        state,
        icon: glyph(QUEST_ICON[q.event], glyphColor(state)),
        title: q.name,
        line: { progress: q.progress, target: q.target, key: `quest:${q.id}`, chips: [{ ...points, tone: 'neutral' }] },
        trailing: chevron(this),
        onTap: this.area.tap(() => this.scene.start(questDestination(q.event))),
      }).setName(`quest_${q.id}`);
    }
    return inboxRow(this, GAME_W / 2, cy, { state, icon: glyph(QUEST_ICON[q.event], glyphColor(state)), title: q.name, trailing: checkMark(this), h: utilityRowHeight() }).setName(`quest_${q.id}`);
  }

  private refreshKeep(d: QuestsData = {}): void {
    this.open = d.open ?? this.open;
    shieldTaps(this.sys?.game);
    refreshScreen(this);
    this.drawList(d.scroll ?? this.area.offset);
  }

  private claim(q: QuestView): void {
    const current = questStatus(session.save, GAME, today()).quests.find((x) => x.id === q.id);
    if (!current?.done || current.claimed) return;
    try {
      pointsBefore = questStatus(session.save, GAME, today()).activity;
      const r = actClaimQuest(session.save, today(), q.id, GAME);
      commit(r.save);
      this.refreshKeep();
    } catch (e) {
      pointsBefore = null;
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private claimMilestone(m: MilestoneView, at: Point): void {
    const current = questStatus(session.save, GAME, today()).milestones.find((x) => x.points === m.points);
    if (!current?.reached || current.claimed) return;
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = actClaimActivity(session.save, today(), m.points, GAME);
      commit(r.save);
      queueRewardFly('Quests', at, before, { burst: true });
      queueClaimFx('Quests', at, metaChips(r.rewards), this.eventLines(r.events));
      this.refreshKeep();
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** «Забрать всё»: все выполненные задания, затем все достигнутые пороги (ядро — claimAllQuests). */
  private claimAll(): void {
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      pointsBefore = questStatus(session.save, GAME, today()).activity;
      const r = actClaimAllQuests(session.save, today(), GAME);
      if (!r.quests.length && !r.milestones.length) return;
      commit(r.save);
      const at = { x: GAME_W / 2, y: CONTENT_TOP + S.xs + TRACK.h / 2 };
      if (r.milestones.length) {
        queueRewardFly('Quests', at, before, { burst: true });
        queueClaimFx('Quests', at, metaChips(r.rewards), this.eventLines(r.events));
      }
      this.refreshKeep();
    } catch (e) {
      pointsBefore = null;
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** Строки событий, которых не видно на экране (гемы и золото долетают до шапки сами). */
  private eventLines(events: Parameters<typeof describeEvents>[0]): string[] {
    return describeEvents(events, session.save, GAME).filter((l) => !l.startsWith('Гемы'));
  }
}
