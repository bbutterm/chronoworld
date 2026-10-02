import Phaser from 'phaser';
import {
  actClaimAllExpeditions,
  actClaimExpedition,
  autoParty,
  expectedExpeditionLoot,
  expeditionStatus,
  finishedExpeditions,
  pendingExpeditionEvents,
  startExpedition,
  type ActiveExpeditionView,
  type ExpectedLoot,
  type ExpeditionStoryLine,
  type ExpeditionView,
} from '../../core';
import { EVENT_MODAL, openExpeditionEvent, outcomeRewardText } from '../expeditionEventModal';
import { GAME } from '../content';
import { lootLines } from '../chestView';
import { countdownText, describeEvents, expectedLootText, formatNumber, heroSprite, RARITY_COLORS } from '../flow';
import { GAME_W } from '../layout';
import { bottomSheet, confirmOpen, CONTENT_TOP, contentBottom, dot, noticeModal, portrait, powerCompare, screen, unitFigure, unitTint } from '../screen';
import { commit, now, session, today } from '../session';
import { skinIcon } from '../skin';
import { portraitKey } from '../sprites';
import { BTN, button, chip, ellipsize, plate, pressable, progressBar, rewardRow, ScrollArea, segmented, SURFACE, tag, text, toast, type ChipSpec } from '../ui';
import { randomLine } from '../loreView';
import { C, COLOR, COLOR_N, FAMILY, R, S, T } from '../theme';
import { afterRewardFly, collect, pulse, queueRewardFly, staggerIn, type Point } from '../juice';
import { heroCardIcon } from '../heroCard';
import { rewardIcon } from '../rewardsView';

/** Карточка локации: ширина — по полям экрана, высота и шаг списка. */
const CARD_W = GAME_W - 2 * S.l;
const CARD_H = 436;
/** Закрытая локация — низкая карточка: название и замок с этапом. */
const LOCKED_H = 216;
const cardH = (v: ExpeditionView): number => (v.unlocked ? CARD_H : LOCKED_H);
const LEFT = S.l;
/** «Картина» места слева и колонка справа. */
const ART_W = 264;
const ART_PAD = S.xs;
const COL_X = LEFT + ART_PAD + ART_W + S.m;
const COL_R = LEFT + CARD_W - S.m;
const COL_W = COL_R - COL_X;
const FACE = 80;
/** Ряды правой колонки (от верха карточки): название, состояние, отряд, действие, добыча. */
const ROW = { name: 56, state: 134, squad: 218, action: 304, loot: 388 } as const;
/** Полоса над списком: «Забрать всё» / счётчики и «Летопись». */
const BAR_Y = CONTENT_TOP + 56;
const LIST_TOP = CONTENT_TOP + 124;

/** Выбранный срок (часы) — запоминается между заходами (localStorage; нет доступа — самый долгий). */
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

interface Timer {
  e: ActiveExpeditionView;
  label: Phaser.GameObjects.Text;
  fill: Phaser.GameObjects.Rectangle;
  barW: number;
}

/** Ожидаемая добыча чипами: золото и опыт «≈», гемы «≈N». Прочие находки — значками без чисел (findIcons). */
export function expectedChips(e: ExpectedLoot): ChipSpec[] {
  const out: ChipSpec[] = [{ icon: 'gold', value: `≈${formatNumber(e.gold)}`, tone: 'gold' }, { icon: 'hero_exp', value: `≈${formatNumber(e.jobExp)}` }];
  if (e.gems > 0) out.push({ icon: 'gems', value: `≈${Math.max(1, Math.round(e.gems))}`, tone: 'gem' });
  return out;
}

type IconFactory = (s: Phaser.Scene, x: number, y: number, size: number) => Phaser.GameObjects.GameObject;
/** Находки, которые «могут найтись» (карты героя, снаряжение, свитки): одни значки — число неизвестно до возвращения. */
export function findIcons(e: Pick<ExpectedLoot, 'heroCards' | 'items' | 'scrolls'>): IconFactory[] {
  const out: IconFactory[] = [];
  if (e.heroCards > 0) out.push((s, x, y, size) => heroCardIcon(s, x, y, size, 'blue'));
  if (e.items > 0) out.push((s, x, y, size) => s.add.image(x, y, skinIcon('helmet')).setDisplaySize(size, size).setTint(0xd890ff));
  if (e.scrolls > 0) out.push((s, x, y, size) => rewardIcon(s, x, y, 'scrolls', size));
  return out;
}

/** Добыча вернувшейся экспедиции чипами: золото, опыт, гемы, карты героя, свитки, предметы. */
export function returnedChips(r: ActiveExpeditionView['rewards']): ChipSpec[] {
  const out: ChipSpec[] = [{ icon: 'gold', value: `+${formatNumber(r.gold)}`, tone: 'gold' }, { icon: 'hero_exp', value: `+${formatNumber(r.jobExp)}` }];
  if (r.gems) out.push({ icon: 'gems', value: `+${r.gems}`, tone: 'gem' });
  for (const rar of ['purple', 'blue'] as const) if (r.heroCards[rar]) out.push({ icon: (s, x, y, size) => heroCardIcon(s, x, y, size, rar), value: `×${r.heroCards[rar]}`, tone: 'info' });
  if (r.scrolls) out.push({ icon: (s, x, y, size) => rewardIcon(s, x, y, 'scrolls', size), value: `×${r.scrolls}` });
  if (r.items.length) {
    const id = r.items[0];
    const rar = GAME.equipment.items[id]?.rarity ?? 'common';
    out.push({ icon: (s, x, y, size) => s.add.image(x, y, skinIcon('helmet')).setDisplaySize(size, size).setTint(Phaser.Display.Color.HexStringToColor(RARITY_COLORS[rar]).color), value: `×${r.items.length}` });
  }
  return out;
}

/** Текстура «картины» места: скруглённый градиент цвета локации с виньеткой (одна на локацию, кэш на игру). */
function artTexture(scene: Phaser.Scene, id: string, tintHex: string, w: number, h: number): string {
  const key = `exp_art_${id}_${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const ct = scene.textures.createCanvas(key, w, h);
  if (!ct) return '__DEFAULT';
  const c = ct.getContext();
  const base = Phaser.Display.Color.HexStringToColor(tintHex);
  const dark = Phaser.Display.Color.IntegerToColor(base.color).darken(58);
  const r = R.l;
  c.beginPath();
  c.moveTo(r, 0);
  c.arcTo(w, 0, w, h, r);
  c.arcTo(w, h, 0, h, r);
  c.arcTo(0, h, 0, 0, r);
  c.arcTo(0, 0, w, 0, r);
  c.closePath();
  const lg = c.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, `rgb(${base.red},${base.green},${base.blue})`);
  lg.addColorStop(1, `rgb(${dark.red},${dark.green},${dark.blue})`);
  c.fillStyle = lg;
  c.fill();
  c.save();
  c.clip();
  const rg = c.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h * 0.5, h * 0.75);
  rg.addColorStop(0, 'rgba(255,240,200,0.28)');
  rg.addColorStop(0.55, 'rgba(255,240,200,0)');
  rg.addColorStop(1, 'rgba(0,0,0,0.45)');
  c.fillStyle = rg;
  c.fillRect(0, 0, w, h);
  c.restore();
  ct.refresh();
  return key;
}

/**
 * K9. Экспедиции по локациям (в духе AFK Arena): карточка на локацию — «картина» места с его монстром, название и «i»
 * (лор и находки — листом снизу), мощь отряда (галка или «Не хватает N»), портреты отряда, срок сегментом
 * 1 / 4 / 8 ч и «Отправить», ожидаемая добыча чипами. В пути — отсчёт и полоса; событие в пути — тег с точкой (окно
 * expeditionEventModal); вернулись — добыча чипами и «Забрать» (монеты летят в «таблетки»). Закрытая — замок и этап.
 * Главная (золотая) кнопка на экране одна: «Забрать всё» → «Забрать» → первая «Отправить».
 */
export class ExpeditionsScene extends Phaser.Scene {
  private area!: ScrollArea;
  private timers: Timer[] = [];
  private hours = 8;
  /** Сколько событий ждали решения при отрисовке (появилось новое — перерисовать). */
  private pendingShown = 0;

  constructor() {
    super('Expeditions');
  }

  create(data: { scroll?: number } = {}): void {
    screen(this, 'Экспедиции', 'Adventure', { to: 'Adventure' });
    this.hours = loadHours();
    const save = session.save;
    this.pendingShown = pendingExpeditionEvents(save, now());
    const views = expeditionStatus(save, now(), GAME);
    this.topBar(views);

    this.area = new ScrollArea(this, LIST_TOP, contentBottom() + 10);
    this.timers = [];
    // Порядок важен для золотой кнопки: вернувшиеся — первыми получают «Забрать», затем первая свободная — «Отправить».
    const rows: Phaser.GameObjects.GameObject[][] = [];
    const ready = views.filter((v) => v.active?.done).length;
    const primaryFor = this.pickPrimary(views, ready);
    let y = 0;
    for (const v of views) {
      const h = cardH(v);
      const cy = y + h / 2;
      rows.push(collect(this.area.content, () => this.card(v, cy, v === primaryFor)));
      y += h + S.s;
    }
    this.area.setContentHeight(y + S.s);
    if (data.scroll) this.area.offset = data.scroll;
    staggerIn(this, 'Expeditions', rows);

    // Отсчёт — раз в секунду. Экспедиция вернулась — перерисовать (появится «Забрать»).
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
  }

  /** Какая карточка получает золотую кнопку: одна вернувшаяся — её «Забрать»; ни одной — первая «Отправить». */
  private pickPrimary(views: readonly ExpeditionView[], ready: number): ExpeditionView | undefined {
    if (ready > 1) return undefined;
    if (ready === 1) return views.find((v) => v.active?.done);
    return views.find((v) => v.unlocked && !v.active && v.party?.ok);
  }

  /** Полоса над списком: несколько вернулись — «Забрать всё»; иначе счётчики чипами. Справа — «Летопись» значком. */
  private topBar(views: readonly ExpeditionView[]): void {
    const ready = views.filter((v) => v.active?.done).length;
    const going = views.filter((v) => v.active && !v.active.done).length;
    const chron = button(this, GAME_W - S.l - BTN.icon / 2, BAR_Y, BTN.icon, BTN.icon, '', '', () => this.chronicle(), T.body, { variant: 'icon' });
    chron.container.add(this.add.image(0, -2, skinIcon('scroll')).setDisplaySize(56, 56).setTint(COLOR_N.title));
    chron.container.setName('expChronicle');
    if (ready > 1) {
      const all = button(this, GAME_W / 2 - 40, BAR_Y, 600, BTN.l, 'ui_btn_primary', `Забрать всё (${ready})`, () => this.claimAll(), T.heading);
      all.container.setName('claimAll');
      pulse(this, all.container);
      return;
    }
    let x = LEFT;
    const add = (c: Phaser.GameObjects.Container) => {
      x += c.width + S.xs;
    };
    if (going) add(chip(this, x, BAR_Y, 'hourglass', `В пути ${going}`, 'neutral', { size: 's', align: 'left' }).setName('expGoing'));
    if (ready) add(chip(this, x, BAR_Y, 'flag', 'Вернулись', 'positive', { size: 's', align: 'left' }).setName('expReady'));
    const free = views.filter((v) => v.unlocked && !v.active).length;
    if (free) add(chip(this, x, BAR_Y, 'map', `Свободно ${free}`, 'neutral', { size: 's', align: 'left' }).setName('expFree'));
  }

  // ---------- карточка локации ----------

  private card(v: ExpeditionView, y: number, primary: boolean): void {
    const a = this.area;
    const loc = v.location;
    const h = cardH(v);
    const top = y - h / 2;
    const done = !!v.active?.done;
    a.add(plate(this, GAME_W / 2, y, CARD_W, h, { ...SURFACE.raised, border: done ? COLOR.accent : COLOR.border, r: R.l })).setName(`exp_${loc.id}`);
    this.art(v, top, h);
    const name = a.add(text(this, COL_X, top + ROW.name, loc.name, T.heading, v.unlocked ? COLOR.title : COLOR.textTertiary, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5));
    ellipsize(name, COL_W);

    if (!v.unlocked) {
      // Закрытая — замок с этапом; нужная мощь и находки — в листе по касанию «картины».
      a.add(chip(this, COL_X, top + ROW.state - 10, 'lock', v.lockedText.replace(/^Откроется на этапе /, 'Этап '), 'neutral', { size: 's', align: 'left' }));
      return;
    }
    if (v.active) {
      this.activeRows(v.active, top, primary);
      return;
    }
    this.idleRows(v, top, primary);
  }

  /** «Картина» места: скруглённый градиент цвета локации, свечение, земля и монстр места; закрытая — силуэт. */
  private art(v: ExpeditionView, top: number, h: number): void {
    const a = this.area;
    const loc = v.location;
    const ah = h - 2 * ART_PAD;
    const x0 = LEFT + ART_PAD;
    const cx = x0 + ART_W / 2;
    a.add(this.add.image(cx, top + ART_PAD + ah / 2, artTexture(this, loc.id, loc.tint, ART_W, ah)));
    a.add(this.add.ellipse(cx, top + ART_PAD + ah - 40, ART_W * 0.66, 32, 0x000000, 0.35));
    const locked = !v.unlocked;
    const unit = loc.monster ? GAME.content.units[loc.monster] : undefined;
    if (unit) {
      const area = this.area;
      unitFigure(this, unit.visual.sprite, cx, top + ART_PAD + ah - 38, ah * 0.62 * (loc.monsterScale ?? 1), {
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
    const frame = a.add(plate(this, cx, top + ART_PAD + ah / 2, ART_W, ah, { fill: COLOR.bg, alpha: locked ? 0.45 : 0, border: COLOR.border, borderW: 3, r: R.l }).setName(`expArt_${loc.id}`));
    // Лор места и находки — по касанию «картины» (лист снизу), на карточке их нет.
    pressable(this, frame, ART_W, ah, a.tap(() => this.lore(v)));
  }

  /** Ряд чипов добычи от левого края колонки, за ним — значки возможных находок (без подложки и чисел). */
  private lootRow(items: ChipSpec[], y: number, finds: IconFactory[] = []): void {
    const row = rewardRow(this, COL_X, y, items, { maxW: COL_W, size: 's', gap: S.xxs, align: 'left' });
    this.area.add(row);
    let x = COL_X + row.width + S.xs + 22;
    for (const f of finds) {
      if (x + 22 > COL_R) break;
      this.area.add(f(this, x, y, 40) as Phaser.GameObjects.GameObject);
      x += 40 + S.xs;
    }
  }

  private faces(ids: readonly string[], y: number): number {
    ids.forEach((id, i) => {
      const hero = session.save.heroes.find((h) => h.id === id);
      const x = COL_X + FACE / 2 + i * (FACE + S.xxs);
      this.area.add(plate(this, x, y, FACE, FACE, { ...SURFACE.sunken, r: R.s }));
      if (hero) this.area.add(portrait(this, x, y, portraitKey(heroSprite(hero, GAME)), FACE - 10));
    });
    return COL_X + ids.length * (FACE + S.xxs);
  }

  /**
   * Почему отряд не собирается (BUG-161): герои вернувшихся, но не забранных экспедиций ещё числятся в пути. Если с
   * ними мощи хватило бы — «Сначала заберите вернувшихся»; иначе причину и так видно по «Не хватает N» мощи.
   */
  private shortHint(locationId: string): string | null {
    const save = session.save;
    const t = now();
    if (finishedExpeditions(save, t) > 0) {
      const freed = { ...save, bounties: { ...save.bounties, active: save.bounties.active.filter((e) => t < e.endsAt) } };
      if (autoParty(freed, locationId, GAME).ok) return 'Сначала заберите вернувшихся';
    }
    return null;
  }

  private idleRows(v: ExpeditionView, top: number, primary: boolean): void {
    const a = this.area;
    const loc = v.location;
    const party = v.party!;
    a.add(powerCompare(this, COL_X, top + ROW.state, party.power, party.need, { align: 'left' }));
    if (party.ok) this.faces(party.heroIds, top + ROW.squad);
    else {
      const why = this.shortHint(loc.id);
      if (why) a.add(ellipsize(text(this, COL_X, top + ROW.squad, why, T.caption, COLOR.warning, { fontStyle: 'bold' }).setOrigin(0, 0.5), COL_W));
    }
    // Срок — сегмент 1 / 4 / 8 ч (выбор общий для всех локаций и запоминается), справа — «Отправить».
    const ds = GAME.meta.expeditions.durations;
    const segW = 330;
    const seg = segmented(this, COL_X + segW / 2, top + ROW.action, segW, ds.map((d) => `${d.hours} ч`), Math.max(0, ds.findIndex((d) => d.hours === this.hours)), (i) => a.tap(() => this.pickHours(ds[i].hours))(), { h: 84 });
    seg.container.setName(`hours_${loc.id}`);
    a.add(seg.container);
    const sendW = COL_R - (COL_X + segW + S.s);
    const sendX = COL_R - sendW / 2;
    const send = button(this, sendX, top + ROW.action, sendW, BTN.m, primary ? 'ui_btn_primary' : '', 'Отправить', a.tap(() => this.send(v)), T.body, primary ? {} : { variant: 'secondary' });
    send.container.setName(`send_${loc.id}`);
    if (!party.ok) send.setEnabled(false);
    a.add(send.container);
    const exp = expectedExpeditionLoot(loc, this.hours, GAME);
    this.lootRow(expectedChips(exp), top + ROW.loot, findIcons(exp));
  }

  private activeRows(e: ActiveExpeditionView, top: number, primary: boolean): void {
    const a = this.area;
    const facesEnd = this.faces(e.heroIds, top + ROW.squad);
    this.eventTag(e, facesEnd + S.xs, top + ROW.squad);
    if (e.done) {
      a.add(tag(this, COL_X, top + ROW.state, 'Отряд вернулся', 'positive', { align: 'left' }));
      const btnW = 260;
      const bx = COL_R - btnW / 2;
      const by = top + ROW.action + 34;
      const btn = button(this, bx, by, btnW, BTN.l, primary ? 'ui_btn_primary' : '', 'Забрать', a.tap(() => this.claim(e, { x: bx, y: this.area.content.y + by })), T.heading, primary ? {} : { variant: 'secondary' });
      btn.container.setName(`claim_${e.location}`);
      a.add(btn.container);
      if (primary) pulse(this, btn.container);
      // Добыча — чипами в два ряда слева от кнопки.
      const row = rewardRow(this, COL_X, top + ROW.action, returnedChips(e.rewards), { maxW: COL_W - btnW - S.s, size: 's', gap: S.xxs, align: 'left' });
      a.add(row.setName(`loot_${e.location}`));
      return;
    }
    a.add(tag(this, COL_X, top + ROW.state, `В пути · ${e.hours} ч`, 'neutral', { align: 'left' }));
    const label = a.add(text(this, COL_R, top + ROW.state, countdownText(e.remainingMs), T.heading, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(1, 0.5));
    const bar = a.add(progressBar(this, COL_X, top + ROW.action, COL_W, 24, 0, COLOR_N.info));
    const fill = bar.list[1] as Phaser.GameObjects.Rectangle;
    // Золото и опыт уже известны; находки — сундук без числа (откроются по возвращении).
    const chest: IconFactory = (s, x, y, size) => s.add.image(x, y, skinIcon('chest')).setDisplaySize(size, size).setTint(COLOR_N.textSecondary);
    this.lootRow([{ icon: 'gold', value: `+${formatNumber(e.rewards.gold)}`, tone: 'gold' }, { icon: 'hero_exp', value: `+${formatNumber(e.rewards.jobExp)}` }], top + ROW.loot, [chest]);
    const t: Timer = { e, label, fill, barW: COL_W };
    this.updateTimer(t, now());
    this.timers.push(t);
  }

  /** Событие в пути, ждущее решения: тег «Событие» с красной точкой рядом с отрядом — касание открывает окно. */
  private eventTag(e: ActiveExpeditionView, x: number, y: number): void {
    const n = (e.events ?? []).filter((ev) => ev.choice === undefined && now() >= ev.at).length;
    if (!n) return;
    const t = tag(this, x, y, n > 1 ? `Событие ×${n}` : 'Событие', 'warning', { align: 'left' }).setName(`event_${e.location}`);
    this.area.add(t);
    this.area.add(dot(this, t.x + t.width / 2 - 4, t.y - 22));
    pressable(this, t, t.width, Math.max(t.height, 96), this.area.tap(() => this.openEvent(e.location)));
  }

  private openEvent(location: string): void {
    const scroll = this.area.offset;
    openExpeditionEvent(this, location, () => this.scene.restart({ scroll }));
  }

  /** Лор места и что там находят — лист снизу (на карточке — только название). */
  private lore(v: ExpeditionView): void {
    const loc = v.location;
    bottomSheet(this, loc.name, (c, w) => {
      let y = 0;
      const add = (s: string, color: string, size: number) => {
        const t = text(this, 0, y, s, size, color, { align: 'left', wordWrap: { width: w, useAdvancedWrap: true } }).setOrigin(0, 0);
        c.add(t);
        y += t.height + S.s;
      };
      add(loc.description, COLOR.textPrimary, T.body);
      const exp = expectedLootText(expectedExpeditionLoot(loc, this.hours, GAME));
      add(`За ${this.hours} ч: ≈ ${exp.base}`, COLOR.textSecondary, T.caption);
      if (exp.finds) add(exp.finds, COLOR.textSecondary, T.caption);
      add(`Нужна мощь отряда: ${formatNumber(loc.power)}${v.unlocked ? '' : ` · ${v.lockedText}`}`, COLOR.textSecondary, T.caption);
      return y;
    });
  }

  /** Летопись экспедиций: последние записи и кто с кем сблизился. */
  private chronicle(): void {
    const b = session.save.bounties;
    const loc = (id: string) => GAME.meta.expeditions.locations.find((l) => l.id === id)?.name ?? id;
    const name = (id: string) => {
      const h = session.save.heroes.find((x) => x.id === id);
      return h ? (GAME.content.heroes[h.templateId]?.name ?? id) : 'герой';
    };
    const lines = [...(b.journal ?? [])].reverse().slice(0, 8).map((j) => `${loc(j.location)}: ${j.text}`);
    const bonds = [...(b.bonds ?? [])].reverse().slice(0, 4).map((x) => `${name(x.heroes[0])} и ${name(x.heroes[1])} сблизились (${loc(x.location)})`);
    const body = [...lines, ...bonds];
    noticeModal(this, 'Летопись экспедиций', body.length ? body : ['Пока пусто. События в пути попадут сюда.']);
  }

  private updateTimer(t: Timer, at: number): void {
    const total = Math.max(1, t.e.endsAt - t.e.startedAt);
    const pct = Phaser.Math.Clamp((at - t.e.startedAt) / total, 0, 1);
    t.label.setText(countdownText(t.e.endsAt - at));
    t.fill.width = (t.barW - 4) * pct;
  }

  private tick(): void {
    const at = now();
    const modal = confirmOpen(this) || !!this.children.getByName(EVENT_MODAL) || !!this.children.getByName('noticeModal') || !!this.children.getByName('bottomSheet');
    const newEvent = pendingExpeditionEvents(session.save, at) !== this.pendingShown;
    if (!modal && (newEvent || this.timers.some((t) => at >= t.e.endsAt))) {
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
      const lines = [`«${name}»: ${formatNumber(r.rewards.gold)} золота · ${formatNumber(r.rewards.jobExp)} опыта в запас`, ...lootLines(r.rewards), ...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы'))];
      // Строка возвращения (lore-route §5.8, data/lore/lines.json → expeditionReturn) — первой.
      const said = randomLine('expeditionReturn');
      this.scene.restart({ scroll: this.area.offset });
      this.events.once(Phaser.Scenes.Events.CREATE, () => afterRewardFly(this, () => this.report(`«${name}»`, [{ location: e.location, story: r.story }], lines, said)));
    } catch (err) {
      toast(this, err instanceof Error ? err.message : String(err), C.error);
    }
  }

  /**
   * Итог возвращения: был рассказ (события в пути) — окно «рассказ + добыча»; не было — тост, как раньше.
   */
  private report(title: string, stories: readonly { location: string; story: readonly ExpeditionStoryLine[] }[], lines: readonly string[], said?: string | null): void {
    const told = stories.filter((s) => s.story.length);
    if (!told.length) {
      // Строка возвращения (lore-route §5.8, data/lore/lines.json → expeditionReturn) — первой.
      toast(this, [...(said ? [said] : []), ...lines].join('\n'), C.success, 5500);
      return;
    }
    // BUG-184: итог добычи — первым и крупно (виден без прокрутки), рассказ — ниже, прокручивается; события, которые
    // отряд решил сам, — одной строкой.
    const many = told.length > 1;
    const paragraphs: string[] = [];
    if (said) paragraphs.push(said);
    for (const s of told) {
      const place = GAME.meta.expeditions.locations.find((l) => l.id === s.location)?.name ?? s.location;
      // Решённые сами — строками подряд, рассказанные — абзацами.
      let part = '';
      let prevAuto = false;
      for (const l of s.story) {
        const rew = outcomeRewardText(l);
        const piece = l.auto ? `• ${l.title} — отряд решил сам: «${l.choice}»${rew ? ` · ${rew}` : ''}` : `${l.title}: «${l.choice}»\n${l.text}${rew ? `\n${rew}` : ''}`;
        part += part ? (l.auto && prevAuto ? '\n' : '\n\n') + piece : piece;
        prevAuto = l.auto;
      }
      paragraphs.push(`${many ? `— ${place} —\n` : ''}${part}`);
    }
    noticeModal(this, title, paragraphs, undefined, lines.join('\n'));
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
      queueRewardFly('Expeditions', { x: GAME_W / 2, y: BAR_Y }, before);
      const lines = [
        `Экспедиций: ${r.claimed.length} · ${formatNumber(r.rewards.gold)} золота · ${formatNumber(r.rewards.jobExp)} опыта в запас`,
        ...lootLines(r.rewards),
        ...describeEvents(r.events, r.save, GAME).filter((l) => !l.startsWith('Гемы')),
      ];
      const said = randomLine('expeditionReturn');
      this.scene.restart({ scroll: this.area.offset });
      this.events.once(Phaser.Scenes.Events.CREATE, () => afterRewardFly(this, () => this.report('Экспедиции вернулись', r.stories, lines, said)));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }
}
