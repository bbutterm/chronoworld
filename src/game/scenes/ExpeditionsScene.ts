import Phaser from 'phaser';
import {
  actClaimAllExpeditions,
  actClaimExpedition,
  expectedExpeditionLoot,
  expeditionStatus,
  finishedExpeditions,
  startExpedition,
  type ActiveExpeditionView,
  type ExpeditionView,
} from '../../core';
import { GAME } from '../content';
import { lootLines } from '../chestView';
import { countdownText, describeEvents, expectedLootText, formatNumber, heroSprite } from '../flow';
import { GAME_W } from '../layout';
import { confirmOpen, CONTENT_BOTTOM, CONTENT_TOP, portrait, screen, unitFigure, unitTint } from '../screen';
import { commit, now, session, today } from '../session';
import { SKIN_TINT, skinIcon } from '../skin';
import { portraitKey } from '../sprites';
import { button, ellipsize, panel, progressBar, ScrollArea, text, toast } from '../ui';
import { C, FS, TINT } from '../theme';
import { afterRewardFly, collect, pulse, queueRewardFly, staggerIn, type Point } from '../juice';

const LIST_TOP = CONTENT_TOP + 170;
const CARD_H = 480;
const CARD_W = 1020;
/** Левый край карточки и колонка текста (правее «картины» локации). */
const LEFT = (GAME_W - CARD_W) / 2;
const ART_W = 290;
const COL_X = LEFT + ART_W + 40;
const COL_W = LEFT + CARD_W - 24 - COL_X;
const FACE = 68;

/** Выбранный срок (часы) — запоминается между заходами (localStorage; нет доступа — 8 ч). */
const HOURS_KEY = 'chronoworld.expeditionHours';
function loadHours(): number {
  try {
    const v = Number(localStorage.getItem(HOURS_KEY));
    if (GAME.meta.expeditions.durations.some((d) => d.hours === v)) return v;
  } catch {
    /* хранилище недоступно */
  }
  const ds = GAME.meta.expeditions.durations;
  return ds[ds.length - 1].hours;
}
function saveHours(h: number): void {
  try {
    localStorage.setItem(HOURS_KEY, String(h));
  } catch {
    /* хранилище недоступно */
  }
}

/** Строки правой колонки карточки (y): статус, отряд, кнопки/полоса, две строки добычи. */
interface Rows {
  a: number;
  b: number;
  c: number;
  d1: number;
  d2: number;
}

interface Timer {
  e: ActiveExpeditionView;
  label: Phaser.GameObjects.Text;
  fill: Phaser.GameObjects.Rectangle;
  barW: number;
}

const hexTint = (hex: string) => Phaser.Display.Color.HexStringToColor(hex).color;

/**
 * K9. Экспедиции по локациям (замена доски поручений): карточка на каждую локацию — «картина» (цвет места и его
 * монстр), описание, мощь отряда «N / нужно M», сроки 1 / 4 / 8 ч и одна кнопка «Отправить» (отряд собирает ядро,
 * autoParty). В пути — отсчёт и полоса, вернулись — «Забрать»; сверху — «Забрать всё». Закрытая локация — замок и
 * «Откроется на этапе …».
 */
export class ExpeditionsScene extends Phaser.Scene {
  private area!: ScrollArea;
  private timers: Timer[] = [];
  private hours = 8;

  constructor() {
    super('Expeditions');
  }

  create(data: { scroll?: number } = {}): void {
    screen(this, 'Экспедиции', 'Adventure', { to: 'Adventure' });
    this.hours = loadHours();
    const save = session.save;
    const views = expeditionStatus(save, now(), GAME);

    const ready = finishedExpeditions(save, now());
    const claimAll = button(this, GAME_W / 2, CONTENT_TOP + 52, 560, 104, ready ? 'ui_btn_primary' : 'k:buttonLong_grey', ready > 1 ? `Забрать всё (${ready})` : 'Забрать всё', () => this.claimAll(), FS.h3);
    claimAll.container.setName('claimAll');
    if (!ready) claimAll.setEnabled(false);
    else pulse(this, claimAll.container);
    text(this, GAME_W / 2, CONTENT_TOP + 132, 'Отряд собирается сам · герои в экспедиции продолжают сражаться', FS.small, C.muted);

    this.area = new ScrollArea(this, LIST_TOP, CONTENT_BOTTOM + 10);
    this.timers = [];
    const rows: Phaser.GameObjects.GameObject[][] = [];
    let y = 0;
    for (const v of views) {
      const cy = y + CARD_H / 2;
      rows.push(collect(this.area.content, () => this.card(v, cy)));
      y += CARD_H;
    }
    this.area.setContentHeight(y + 20);
    if (data.scroll) this.area.offset = data.scroll;
    staggerIn(this, 'Expeditions', rows);

    // Отсчёт — раз в секунду. Экспедиция вернулась — перерисовать (появится «Забрать»).
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
  }

  // ---------- карточка локации ----------

  private card(v: ExpeditionView, y: number): void {
    const a = this.area;
    const loc = v.location;
    const h = CARD_H - 20;
    const done = !!v.active?.done;
    a.add(panel(this, GAME_W / 2, y, CARD_W, h, done ? 'ui_panel_light' : 'ui_panel')).setName(`exp_${loc.id}`);
    if (done && this.textures.exists('skin_glow')) {
      a.add(this.add.image(GAME_W / 2 + 150, y, 'skin_glow').setDisplaySize(900, h).setTint(0xf0cf8a).setAlpha(0.12).setBlendMode(Phaser.BlendModes.ADD));
    }
    this.art(v, y, h);

    const top = y - h / 2;
    a.add(ellipsize(text(this, COL_X, top + 44, loc.name, FS.h2, v.unlocked ? C.title : C.disabled, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5), COL_W));
    a.add(text(this, COL_X, top + 80, loc.description, FS.small, v.unlocked ? C.muted : C.disabled, { align: 'left', wordWrap: { width: COL_W } }).setOrigin(0, 0));

    const r: Rows = { a: top + 196, b: top + 256, c: top + 334, d1: top + 398, d2: top + 434 };
    if (!v.unlocked) {
      a.add(this.add.image(COL_X + 24, r.a, skinIcon('lock')).setDisplaySize(46, 46).setTint(SKIN_TINT.creamDim));
      a.add(text(this, COL_X + 60, r.a, v.lockedText, FS.h3, C.dim, { fontStyle: 'bold' }).setOrigin(0, 0.5));
      a.add(text(this, COL_X, r.b, `Нужна мощь отряда: ${formatNumber(loc.power)}`, FS.body, C.disabled).setOrigin(0, 0.5));
      this.previewLines(v, r, true);
      return;
    }
    if (v.active) {
      this.activeRows(v.active, r);
      return;
    }
    this.idleRows(v, r);
  }

  /** «Картина» локации: заливка цветом места, свечение и монстр места (пока нет арта локаций). */
  private art(v: ExpeditionView, y: number, h: number): void {
    const a = this.area;
    const loc = v.location;
    const x0 = LEFT + 20;
    const ah = h - 40;
    const top = y - ah / 2;
    const tint = hexTint(loc.tint);
    const dark = Phaser.Display.Color.IntegerToColor(tint).darken(55).color;
    const g = this.add.graphics();
    g.fillGradientStyle(tint, tint, dark, dark, 1);
    g.fillRect(x0, top, ART_W, ah);
    g.lineStyle(4, TINT.frame, 0.9).strokeRect(x0, top, ART_W, ah);
    a.add(g);
    if (this.textures.exists('skin_glow')) {
      a.add(this.add.image(x0 + ART_W / 2, top + ah * 0.45, 'skin_glow').setDisplaySize(ART_W * 1.3, ah).setTint(0xfff0c8).setAlpha(0.22).setBlendMode(Phaser.BlendModes.ADD));
    }
    // Земля под монстром.
    a.add(this.add.ellipse(x0 + ART_W / 2, top + ah - 46, ART_W * 0.7, 36, 0x000000, 0.35));
    const locked = !v.unlocked;
    const unit = loc.monster ? GAME.content.units[loc.monster] : undefined;
    if (unit) {
      const area = this.area;
      unitFigure(this, unit.visual.sprite, x0 + ART_W / 2, top + ah - 44, ah * 0.6 * (loc.monsterScale ?? 1), {
        // Пиксель-арт — не крупнее ×1.8: широкие монстры (жук, мимик) остаются внутри «картины».
        maxScale: 1.8,
        onReady: (o) => {
          // Лист догрузился после перезапуска экрана — объект уже не нужен.
          if (!this.sys.isActive() || area !== this.area) {
            o.destroy();
            return;
          }
          area.add(o);
          o.setTint(locked ? 0x202020 : unitTint(unit.visual));
          if (locked) o.setAlpha(0.8);
        },
      });
    }
    if (locked) a.add(this.add.rectangle(x0 + ART_W / 2, y, ART_W, ah, 0x000000, 0.45));
  }

  /** Две строки «чего ждать» для выбранного срока: золото и опыт, затем находки локации. */
  private previewLines(v: ExpeditionView, r: Rows, dim = false): void {
    const exp = expectedLootText(expectedExpeditionLoot(v.location, this.hours, GAME));
    const line1 = `≈ ${exp.base} за ${this.hours} ч`;
    this.area.add(ellipsize(text(this, COL_X, r.d1, line1, FS.small, dim ? C.disabled : C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: dim ? 0 : 4 }).setOrigin(0, 0.5), COL_W));
    if (exp.finds) this.area.add(ellipsize(text(this, COL_X, r.d2, exp.finds, FS.small, dim ? C.disabled : C.info, { stroke: C.stroke, strokeThickness: dim ? 0 : 4 }).setOrigin(0, 0.5), COL_W));
  }

  /** Находки вернувшейся экспедиции: «гемы +3 · синие карты героя +1 · Нож». */
  private findsText(e: ActiveExpeditionView): string {
    const r = e.rewards;
    const parts: string[] = [];
    if (r.gems) parts.push(`гемы +${r.gems}`);
    if (r.heroCards.blue) parts.push(`синие карты героя +${r.heroCards.blue}`);
    if (r.heroCards.purple) parts.push(`фиолетовые карты героя +${r.heroCards.purple}`);
    if (r.scrolls) parts.push(`свитки +${r.scrolls}`);
    for (const id of r.items) parts.push(GAME.equipment.items[id]?.name ?? id);
    return parts.length ? `Находки: ${parts.join(' · ')}` : 'Находок в этот раз нет';
  }

  private faces(ids: readonly string[], y: number): void {
    ids.forEach((id, i) => {
      const hero = session.save.heroes.find((h) => h.id === id);
      const x = COL_X + FACE / 2 + i * (FACE + 10);
      this.area.add(this.add.rectangle(x, y, FACE, FACE, 0x1a120a, 0.7).setStrokeStyle(2, TINT.frame, 0.8));
      if (hero) this.area.add(portrait(this, x, y, portraitKey(heroSprite(hero, GAME)), FACE - 6));
    });
  }

  private idleRows(v: ExpeditionView, r: Rows): void {
    const a = this.area;
    const loc = v.location;
    const party = v.party!;
    a.add(
      text(this, COL_X, r.a, `Мощь ${formatNumber(party.power)} / нужно ${formatNumber(party.need)}`, FS.h3, party.ok ? C.success : C.danger, {
        fontStyle: 'bold',
        stroke: C.stroke,
        strokeThickness: 5,
      }).setOrigin(0, 0.5),
    );
    if (party.ok) this.faces(party.heroIds, r.b);
    else a.add(ellipsize(text(this, COL_X, r.b, 'Не хватает свободных героев — усильте отряд', FS.small, C.warning).setOrigin(0, 0.5), COL_W));

    // Сроки: 1 / 4 / 8 ч (выбор общий для всех локаций и запоминается).
    const ds = GAME.meta.expeditions.durations;
    const chipW = 128;
    ds.forEach((d, i) => {
      const x = COL_X + chipW / 2 + i * (chipW + 12);
      const on = d.hours === this.hours;
      const chip = button(this, x, r.c, chipW, 88, on ? 'k:buttonLong_brown' : 'k:buttonLong_beige', `${d.hours} ч`, a.tap(() => this.pickHours(d.hours)), FS.h3, { sound: 'ui_tab' });
      chip.container.setName(`hours_${loc.id}_${d.hours}`);
      if (on) chip.label.setColor('#f0cf8a');
      a.add(chip.container);
    });
    const sendX = LEFT + CARD_W - 24 - 115;
    const send = button(this, sendX, r.c, 230, 110, party.ok ? 'ui_btn_primary' : 'k:buttonLong_grey', 'Отправить', a.tap(() => this.send(v)), FS.h3);
    send.container.setName(`send_${loc.id}`);
    if (!party.ok) send.setEnabled(false);
    a.add(send.container);
    this.previewLines(v, r);
  }

  private activeRows(e: ActiveExpeditionView, r: Rows): void {
    const a = this.area;
    this.faces(e.heroIds, r.b);
    if (e.done) {
      a.add(text(this, COL_X, r.a, 'Отряд вернулся!', FS.h3, C.inkSuccess, { fontStyle: 'bold' }).setOrigin(0, 0.5));
      a.add(ellipsize(text(this, COL_X, r.d1, `Добыча: ${formatNumber(e.rewards.gold)} зол. · ${formatNumber(e.rewards.jobExp)} опыта`, FS.small, C.inkGold, { fontStyle: 'bold' }).setOrigin(0, 0.5), COL_W));
      a.add(ellipsize(text(this, COL_X, r.d2, this.findsText(e), FS.small, C.inkInfo).setOrigin(0, 0.5), COL_W));
      const bx = LEFT + CARD_W - 24 - 130;
      const btn = button(this, bx, r.c, 260, 112, 'ui_btn_primary', 'Забрать', a.tap(() => this.claim(e, { x: bx, y: this.area.content.y + r.c })), FS.h3);
      btn.container.setName(`claim_${e.location}`);
      a.add(btn.container);
      pulse(this, btn.container);
      return;
    }
    a.add(text(this, COL_X, r.a, `В пути · ${e.hours} ч`, FS.h3, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5));
    const label = a.add(text(this, LEFT + CARD_W - 30, r.a, countdownText(e.remainingMs), FS.h3, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(1, 0.5));
    const barW = COL_W;
    const bar = a.add(progressBar(this, COL_X, r.c, barW, 26, 0, TINT.info));
    const fill = bar.list[1] as Phaser.GameObjects.Rectangle;
    a.add(ellipsize(text(this, COL_X, r.d1, `${formatNumber(e.rewards.gold)} зол. · ${formatNumber(e.rewards.jobExp)} опыта`, FS.small, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5), COL_W));
    a.add(text(this, COL_X, r.d2, 'Находки — по возвращении', FS.small, C.muted).setOrigin(0, 0.5));
    const t: Timer = { e, label, fill, barW };
    this.updateTimer(t, now());
    this.timers.push(t);
  }

  private updateTimer(t: Timer, at: number): void {
    const total = Math.max(1, t.e.endsAt - t.e.startedAt);
    const pct = Phaser.Math.Clamp((at - t.e.startedAt) / total, 0, 1);
    t.label.setText(countdownText(t.e.endsAt - at));
    t.fill.width = (t.barW - 4) * pct;
  }

  private tick(): void {
    const at = now();
    if (!confirmOpen(this) && this.timers.some((t) => at >= t.e.endsAt)) {
      this.scene.restart({ scroll: this.area.offset });
      return;
    }
    for (const t of this.timers) this.updateTimer(t, at);
  }

  // ---------- действия ----------

  private pickHours(h: number): void {
    if (h === this.hours) return;
    saveHours(h);
    this.scene.restart({ scroll: this.area.offset });
  }

  private send(v: ExpeditionView): void {
    const party = v.party;
    if (!party?.ok) {
      toast(this, `${v.location.name}: мало мощи — ${formatNumber(party?.power ?? 0)} / нужно ${formatNumber(v.location.power)}`, C.warning);
      return;
    }
    try {
      commit(startExpedition(session.save, v.location.id, this.hours, now(), GAME));
      const msg = `Отряд ушёл: «${v.location.name}» · ${this.hours} ч`;
      this.scene.restart({ scroll: this.area.offset });
      this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, msg, C.success));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private claim(e: ActiveExpeditionView, at: Point): void {
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = actClaimExpedition(session.save, today(), e.location, now(), GAME);
      commit(r.save);
      queueRewardFly('Expeditions', at, before);
      const name = GAME.meta.expeditions.locations.find((l) => l.id === e.location)?.name ?? e.location;
      const lines = [`«${name}»: ${formatNumber(r.rewards.gold)} зол. · ${formatNumber(r.rewards.jobExp)} опыта в запас`, ...lootLines(r.rewards), ...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы'))];
      this.scene.restart({ scroll: this.area.offset });
      this.events.once(Phaser.Scenes.Events.CREATE, () => afterRewardFly(this, () => toast(this, lines.join('\n'), C.success, 4500)));
    } catch (err) {
      toast(this, err instanceof Error ? err.message : String(err), C.error);
    }
  }

  /** «Забрать всё»: все вернувшиеся экспедиции одним нажатием, добыча — одной суммой. */
  private claimAll(): void {
    try {
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = actClaimAllExpeditions(session.save, today(), now(), GAME);
      if (!r.claimed.length) {
        toast(this, 'Пока никто не вернулся');
        return;
      }
      commit(r.save);
      queueRewardFly('Expeditions', { x: GAME_W / 2, y: CONTENT_TOP + 52 }, before);
      const lines = [
        `Экспедиций: ${r.claimed.length} · ${formatNumber(r.rewards.gold)} зол. · ${formatNumber(r.rewards.jobExp)} опыта в запас`,
        ...lootLines(r.rewards),
        ...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы')),
      ];
      this.scene.restart({ scroll: this.area.offset });
      this.events.once(Phaser.Scenes.Events.CREATE, () => afterRewardFly(this, () => toast(this, lines.join('\n'), C.success, 4500)));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }
}
