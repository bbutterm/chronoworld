import Phaser from 'phaser';
import { actSummon, addHeroCard, grantTavernWelcome, heroCard, rarityDef, summonPool, summonStatus, type CardRarity, type HeroState, type SummonResult, type SummonStatus } from '../../core';
import { SUMMON_REVEAL } from '../audioCatalog';
import { sfx, summonSound } from '../audio';
import { haptic } from '../haptics';
import { screenBackground } from '../backdrops';
import { GAME } from '../content';
import { currentStage, formatNumber, heroSprite, stageNo } from '../flow';
import { bump, collect, decorTween, MOMENT_DEPTH, moment, pulse, queueRewardFly } from '../juice';
import { GAME_H, GAME_W, BLEED_X, BLEED_Y } from '../layout';
import { bottomSheet, cta, CONTENT_TOP, screen, unitFigure } from '../screen';
import { commit, now, session, today } from '../session';
import { whenSprites } from '../sprites';
import { motion } from '../state';
import {
  bestResult,
  copyTags,
  firstTenTag,
  firstTenText,
  freeInLabel,
  pityInfo,
  RARITY_CARD,
  RARITY_FEM,
  resultTag,
  revealOrder,
  revealSchedule,
  SOUND_RARITY,
  summonButtons,
  tensionMs,
  type CardSlot,
  type PullCost,
  type PullOption,
} from '../tavern';
import { BEAM, CARD_BACK, CIRCLE, FLOOR_SHADE, GLOW, SPARK, setTavernBackground, TAVERN_BG, TAVERN_BG_FILE, TAVERN_LIGHTS } from '../tavernArt';
import { drawHeroCard, heroCardSize } from '../heroCard';
import { markTavernSeen } from '../tavernEntry';
import { COLOR, E, FAMILY, M, S, T, hexNum } from '../theme';
import { button, chip, plate, pressable, progressBar, rewardRow, ScrollArea, SURFACE, tag, text, toast, tutorialHint, infoButton, type ButtonView } from '../ui';
import { hintDone, markHint } from '../hints';
import { onViewChange, view } from '../viewport';
import { tavernLayout, tavernRevealLayout } from '../compactTavernLayout';

/**
 * Лицо карты призыва — общая плитка карточки героя (heroCard.ts, тот же вид, что в «Героях»): рамка редкости,
 * бюст на маленьких картах стола, фигура в стойке на крупной (×1 и показ фиолетовой). Ширина — чтобы карта
 * (высота = ширина × CARD_ASPECT) влезла в место w×h. Свечение и метки — свои у Таверны, у плитки выключены.
 */
function summonFace(scene: Phaser.Scene, x: number, y: number, w: number, h: number, hero: HeroState, big: boolean): Phaser.GameObjects.Container {
  const cw = Math.floor(Math.min(w, h / heroCardSize(1).h));
  return drawHeroCard(scene, x, y, hero, { w: cw, level: null, glow: false, figure: big ? 'sprite' : 'portrait' });
}

export interface TavernData {
  /** Показать призыв: результаты уже в сохранении (actSummon), экран только проигрывает показ. */
  reveal?: { results: SummonResult[]; count: number };
  /** Только что забран подарок Гаррета: «таблетка» свитков подпрыгивает. */
  gift?: boolean;
}

/** Раскладка зала (поле 1080×1920). */
const L = {
  /** Свитки и «i». */
  topY: CONTENT_TOP + 66,
  /** Подарок Гаррета. */
  giftY: CONTENT_TOP + 250,
  /** Ноги гостей дня, середина круга призыва. */
  feetY: 1120,
  /** Гаранты. */
  pityY: 1390,
  /** Кнопки ×1 / ×10. */
  pullY: 1660,
  pullH: 176,
  /** Подпись «Бесплатно через …». */
  freeY: 1790,
} as const;

/** Середина стола, куда ложатся карты при показе. */
const TABLE_Y = 960;
/** Откуда вылетают карты (колода у края стола). */
const DECK = { x: GAME_W / 2, y: 1720 };
const DEPTH = 5000;
/** Кнопки итога призыва; высота «Готово». */
const BTN_H = 150;

/** Фиолетовая и выше — «момент» (moment('summonRare')). */
const isEpic = (r: CardRarity): boolean => tensionMs(r) >= tensionMs('purple');
/** Вибрация переворота карты: фиолетовая и выше — тяжёлый удар, остальные — лёгкий. */
const flipHaptic = (r: CardRarity) => haptic(isEpic(r) ? 'cardRare' : 'cardFlip');
/** Строки прогресса призыва — плашка обучения их не закрывает (MT-07). */
const TAVERN_INFO = ['До синей', 'До фиолетовой', 'Гарант', 'Синяя', 'Фиолетовая'];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

type Phase = 'deal' | 'pick' | 'showcase' | 'done';

interface CardView {
  i: number;
  slot: CardSlot;
  root: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Image;
  back: Phaser.GameObjects.Image;
  face: Phaser.GameObjects.Container;
  flipped: boolean;
  busy: boolean;
}

/** Состояние показа (читает и e2e: фаза, результаты, карты). */
interface RevealState {
  results: SummonResult[];
  count: number;
  /** deal — карты летят на стол; pick — открываются (сами по очереди или касанием); showcase — момент редкой; done — итог. */
  phase: Phase;
  cards: CardView[];
  layer: Phaser.GameObjects.Container;
  body: ScrollArea;
  footer: Phaser.GameObjects.GameObject[];
  footerBottom: number;
  /** Кнопки показа (пропуск) — убираются в итоге. */
  ui: Phaser.GameObjects.GameObject[];
  /** «Новый» / копия по картам (тот же templateId уже был у игрока до призыва или раньше в серии). */
  tags: ReturnType<typeof copyTags>;
  /** Лучшая карта серии — её (фиолетовую и выше) показывает момент, один раз за призыв. */
  best: number;
  momentShown: boolean;
  pendingSkip: boolean;
  /** Ждут конца момента (очередные перевороты). */
  waiters: (() => void)[];
}

/**
 * H5. Таверна: призыв карточек героев (docs/design/heroes-v2.md, раздел 4; полировка — ui-polish-research.md §5).
 * Зал — арт с тремя «гостями дня» на круге призыва; свитки и «i» (шансы и гарант — листом снизу), гаранты двумя
 * полосами, ровно две кнопки: ×1 (вторичная; бесплатный — золотая метка) и ×10 (главная), цена — чипом.
 * Показ как в AFK: карты рубашкой вверх вылетают на стол и открываются по одной (дрожь → вспышка → разворот),
 * синяя — лучи, лучшая фиолетовая и выше — момент (moment('summonRare')) с крупной картой; касание стола — пропуск.
 * Итог — сетка карт с метками «Новый» / «+1 копия», «Ещё ×10» и «Готово». «Уменьшить анимацию» — сразу итог.
 */
export class TavernScene extends Phaser.Scene {
  reveal: RevealState | null = null;
  private mainArea?: ScrollArea;
  private get hallLayout() { return tavernLayout(view().uiHeight, view().safeBottom, session.save.summon.welcomeGiven); }

  constructor() {
    super('Tavern');
  }

  create(data: TavernData = {}): void {
    this.reveal = null;
    this.mainArea = undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.reveal = null; this.mainArea = undefined; });
    markTavernSeen();
    screen(this, 'Таверна', null, { to: 'Home' });
    const bg = screenBackground(this);
    if (bg) setTavernBackground(bg);
    this.ambience();

    const st = summonStatus(session.save, today(), GAME);
    if (!st.unlocked) {
      this.locked(st);
      return;
    }
    const initial = this.hallLayout;
    const area = this.mainArea = new ScrollArea(this, initial.bodyTop, initial.bodyBottom);
    area.content.setName('tavernScroll');
    const banner = this.add.container(0, -initial.bodyTop);
    banner.add(collect(this.children, () => this.banner(banner)));
    area.add(banner);
    const topRow = this.add.container(0, -initial.bodyTop, collect(this.children, () => this.topRow(st, !!data.gift)));
    area.add(topRow);
    const pities = this.add.container(0, -initial.bodyTop, collect(this.children, () => this.pity(st)));
    area.add(pities);
    const footer = collect(this.children, () => this.buttons(st));
    let previous = initial;
    const reflow = () => {
      const next = this.hallLayout;
      banner.y = next.feetY - initial.feetY - initial.bodyTop;
      pities.y = next.pityY - initial.pityY - initial.bodyTop;
      const dy = next.pullY - previous.pullY;
      for (const o of footer) if (o.scene && 'y' in o) (o as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform).y += dy;
      area.setBounds(next.bodyTop, next.bodyBottom);
      area.setContentHeight(next.pityY + Math.max(1, st.pities.length) * 32 + S.s - next.bodyTop);
      previous = next;
    };
    reflow();
    onViewChange(this, reflow);
    const lock = () => { area.locked = !!this.reveal || this.children.list.some((o) => !!o.getData?.('screenModal')); };
    this.events.on(Phaser.Scenes.Events.PRE_UPDATE, lock);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.mainArea = undefined; this.events.off(Phaser.Scenes.Events.PRE_UPDATE, lock); });
    if (!data.reveal?.results.length) this.tutorial(st);
    if (data.reveal?.results.length) this.startReveal(data.reveal.results, data.reveal.count);
  }

  // ---------- зал ----------

  /** Мерцающий свет фонарей и камина, искры над огнём (без «Уменьшить анимацию»). */
  private ambience(): void {
    for (const l of TAVERN_LIGHTS) {
      const g = this.add.image(l.x, l.y, GLOW).setTint(l.color).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(l.r * 2, l.r * 2).setAlpha(0.22);
      if (!motion.reduced)
        this.tweens.add({ targets: g, alpha: { from: 0.16, to: 0.3 }, duration: Phaser.Math.Between(500, 900), yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Phaser.Math.Between(0, 400) });
    }
    if (motion.reduced) return;
    // Искры из камина.
    this.time.addEvent({
      delay: 260,
      loop: true,
      callback: () => {
        if (this.reveal) return;
        const s = this.add.image(540 + Phaser.Math.Between(-70, 70), 740, SPARK).setTint(0xffb050).setBlendMode(Phaser.BlendModes.ADD).setScale(Phaser.Math.FloatBetween(0.3, 0.6));
        this.tweens.add({ targets: s, y: s.y - Phaser.Math.Between(160, 300), x: s.x + Phaser.Math.Between(-40, 40), alpha: 0, duration: Phaser.Math.Between(1200, 2000), onComplete: () => s.destroy() });
      },
    });
  }

  private locked(st: SummonStatus): void {
    const stage = GAME.content.stages.find((s) => s.id === st.unlockAfterStage);
    const y = view().uiHeight / 2;
    const panel = plate(this, GAME_W / 2, y, GAME_W - 2 * S.l, 300, { ...SURFACE.raised, r: 28 });
    const title = text(this, GAME_W / 2, y - 60, 'Таверна закрыта', T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' });
    const reason = text(this, GAME_W / 2, y + 40, `Откроется после этапа ${stage ? stageNo(stage, GAME) : st.unlockAfterStage}`, T.body, COLOR.textSecondary);
    const c = cta(this, GAME_W / 2, view().safeBottom - 280, 'В кампанию', () => this.scene.start('Campaign'));
    const notice = [panel, title, reason];
    let previous = view();
    onViewChange(this, (next) => {
      const dy = (next.uiHeight - previous.uiHeight) / 2;
      for (const o of notice) o.y += dy;
      c.container.setY(next.safeBottom - 280);
      previous = next;
    });
  }

  /**
   * Баннер пула: круг призыва перед камином и три «гостя дня» (сменяются по дате игрока) — крупно, без подписей:
   * арт говорит сам. Ниже — тень пола, на ней гаранты и кнопки читаются поверх арта.
   */
  private banner(owner: Phaser.GameObjects.Container): void {
    const cy = this.hallLayout.feetY;
    const ring = this.add.container(GAME_W / 2, cy).setScale(1.8, 0.62);
    const circle = this.add.image(0, 0, CIRCLE).setTint(0xc89bff).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD);
    const inner = this.add.image(0, 0, CIRCLE).setTint(0xffc070).setAlpha(0.3).setScale(0.62).setBlendMode(Phaser.BlendModes.ADD);
    ring.add([circle, inner]);
    this.add.image(GAME_W / 2, cy - 60, GLOW).setTint(0xa05cff).setAlpha(0.35).setDisplaySize(980, 640).setBlendMode(Phaser.BlendModes.ADD);
    if (!motion.reduced) {
      this.tweens.add({ targets: circle, angle: 360, duration: 40000, repeat: -1 });
      this.tweens.add({ targets: inner, angle: -360, duration: 26000, repeat: -1 });
      this.tweens.add({ targets: circle, alpha: { from: 0.45, to: 0.7 }, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    const shadeTop = cy + 40;
    this.add
      .image(GAME_W / 2, shadeTop, FLOOR_SHADE)
      .setOrigin(0.5, 0)
      .setDisplaySize(GAME_W + 2 * BLEED_X, GAME_H + BLEED_Y - shadeTop);
    // Пул Таверны — все герои; витрина — три «гостя дня» в форме первой профессии (ветку выбирают на фиолетовом).
    const pool = summonPool(GAME, 'green');
    if (!pool.length) return;
    const day = today();
    let h = 0;
    for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const picks = [0, 1, 2].map((k) => pool[(h + k * 5) % pool.length]).filter((t, i, a) => a.indexOf(t) === i);
    const spots = [
      { x: 290, h: 330, dy: -24 },
      { x: 540, h: 410, dy: 18 },
      { x: 790, h: 330, dy: -24 },
    ];
    picks.forEach((t, i) => {
      const hero = addHeroCard(session.save, t, 'green').hero;
      const s = spots[i];
      const feet = cy + s.dy;
      this.add.ellipse(s.x, feet + 4, 190, 38, 0x000000, 0.45);
      unitFigure(this, heroSprite(hero, GAME), s.x, feet, s.h, { maxScale: 2.8, onReady: (figure) => {
        if (owner.scene) owner.add(figure);
        else figure.destroy();
      } });
    });
  }

  /** Свитки (слева) и «i» (справа); подарок Гаррета (если не забран) — карточкой с наградой и «Забрать». */
  private topRow(st: SummonStatus, gift: boolean): void {
    const pill = chip(this, S.l, L.topY, 'scrolls', st.scrolls, 'neutral', { align: 'left' }).setName('scrollsPill');
    if (gift) this.time.delayedCall(M.base, () => bump(this, pill));
    infoButton(this, GAME_W - S.l - 32, L.topY, () => this.openRates()).setName('tavernInfo');

    if (session.save.summon.welcomeGiven) return;
    const w = GAME.summon.welcome;
    const y = L.giftY;
    const cw = GAME_W - 2 * S.l;
    plate(this, GAME_W / 2, y, cw, 200, { ...SURFACE.raised, r: 28 });
    const left = S.l + S.m;
    text(this, left, y - 44, 'Подарок Гаррета', T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
    rewardRow(this, left, y + 40, [
      { icon: 'gems', value: `+${formatNumber(w.gems)}`, tone: 'gem' },
      { icon: 'scrolls', value: `+${w.scrolls}` },
    ], { size: 's', align: 'left' });
    const bx = GAME_W - S.l - S.m - 140;
    const b = button(this, bx, y, 280, 132, '', 'Забрать', () => {
      const m = b.container.getWorldTransformMatrix();
      this.claimWelcome({ x: m.tx, y: m.ty });
    }, T.heading, { variant: 'primary' });
    b.container.setName('giftClaim');
    pulse(this, b.container);
  }

  /** Гаранты: «До синей: N» и «До фиолетовой: N» с тонкими полосами — одна поверхность без рамки. */
  private pity(st: SummonStatus): void {
    const rows = st.pities.length ? st.pities : [{ rarity: st.pityRarity, until: st.untilPity }];
    const rowH = 64;
    const h = rows.length * rowH + 2 * S.s;
    const pityY = this.hallLayout.pityY;
    plate(this, GAME_W / 2, pityY, GAME_W - 2 * S.l, h, { ...SURFACE.surface, r: 28 });
    let ry = pityY - h / 2 + S.s + rowH / 2;
    const barX = 500;
    const barW = GAME_W - S.l - S.m - barX;
    rows.forEach((p, i) => {
      const every = GAME.summon.pity.find((x) => x.rarity === p.rarity)?.every ?? p.until;
      const info = pityInfo({ untilPity: p.until, pityRarity: p.rarity }, every);
      const color = rarityDef(GAME, p.rarity).color;
      text(this, S.l + S.m, ry, `До ${RARITY_FEM[p.rarity]}: ${p.until}`, T.body, color, { fontStyle: 'bold' })
        .setOrigin(0, 0.5)
        .setName(i === 0 ? 'pityLabel' : `pityLabel_${p.rarity}`);
      progressBar(this, barX, ry, barW, 20, info.fraction, hexNum(color), { key: `tavern:pity:${p.rarity}` });
      ry += rowH;
    });
  }

  /**
   * Кнопка призыва: подпись сверху, цена чипом снизу (свитки или гемы); бесплатный ×1 — без цены, с золотой
   * меткой «Бесплатно» на кромке. Не хватает — серая, нажатие объясняет тостом (pull).
   */
  private pullButton(x: number, y: number, w: number, h: number, primary: boolean, o: PullOption, cost: PullCost | null, free: boolean, label = o.label): ButtonView {
    const b = button(this, x, y, w, h, '', label, () => this.pull(o), T.heading, { variant: primary ? 'primary' : 'secondary', sound: o.enabled ? 'ui_tap' : null });
    if (cost) {
      b.label.setY(-h * 0.19);
      b.container.add(chip(this, 0, h * 0.2, cost.icon, cost.value, cost.icon === 'gems' ? 'gem' : 'neutral', { size: 's' }));
    }
    if (free) {
      const t = tag(this, 0, -h / 2 + 10, 'Бесплатно', 'gold', { solid: true });
      t.setX(w / 2 - t.width / 2 - S.xs);
      b.container.add(t);
    }
    if (!o.enabled) b.setEnabled(false);
    return b;
  }

  /** Ровно две кнопки: ×1 — вторичная, ×10 — главная (пока подарок не забран, главная — «Забрать»). */
  private buttons(st: SummonStatus): void {
    const { one, ten } = summonButtons(st);
    const w1 = 420;
    const w10 = GAME_W - 2 * S.l - S.s - w1;
    const x1 = S.l + w1 / 2;
    const x10 = GAME_W - S.l - w10 / 2;
    const pullY = this.hallLayout.pullY;
    const b1 = this.pullButton(x1, pullY, w1, L.pullH, false, one, one.cost, one.free);
    b1.container.setName('pullOne');
    if (one.free) pulse(this, b1.container, 1.03);
    const b10 = this.pullButton(x10, pullY, w10, L.pullH, session.save.summon.welcomeGiven, ten, ten.cost, false);
    b10.container.setName('pullTen');
    if (st.firstTenBonus) {
      tag(this, x10, pullY - L.pullH / 2 - 44, firstTenTag(st.firstTenCount, st.firstTenRarity), 'warning').setName('firstTenNote');
    }
    if (!st.freeLeft) {
      const midnight = new Date(now());
      midnight.setHours(24, 0, 0, 0);
      text(this, x1, this.hallLayout.freeY, freeInLabel(midnight.getTime() - now()), T.caption, COLOR.textSecondary).setName('freeIn');
    }
  }

  /**
   * Ведущее обучение (hints.ts, шаг tavern_summon): до первого ×10 — указатель на «Забрать» подарка, затем на ×10.
   * Шаг выполнен первым ×10 (pull) или касанием плашки.
   */
  private tutorial(st: SummonStatus): void {
    if (session.save.summon.firstTenDone || hintDone('tavern_summon')) return;
    if (!session.save.summon.welcomeGiven) {
      const y = (this.mainArea?.content.y ?? CONTENT_TOP) + L.giftY - CONTENT_TOP;
      tutorialHint(this, 'tavern_summon', GAME_W - S.l - S.m - 140, y, 'below', { w: 280, h: 132 }, { text: 'Подарок — свитки на призыв', avoidText: TAVERN_INFO });
      return;
    }
    const { ten } = summonButtons(st);
    if (!ten.enabled) return;
    const w10 = GAME_W - 2 * S.l - S.s - 420;
    tutorialHint(this, 'tavern_summon', GAME_W - S.l - w10 / 2, this.hallLayout.pullY, 'above', { w: w10, h: L.pullH }, { avoidText: TAVERN_INFO });
  }

  // ---------- действия ----------

  private claimWelcome(at: { x: number; y: number }): void {
    const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
    const r = grantTavernWelcome(session.save, GAME);
    if (r.save === session.save) return;
    commit(r.save);
    queueRewardFly('Tavern', at, before);
    this.scene.restart({ gift: true } satisfies TavernData);
  }

  private pull(o: PullOption): void {
    if (this.reveal && this.reveal.phase !== 'done') return;
    try {
      const r = actSummon(session.save, today(), o.count, o.pay, GAME);
      commit(r.save);
      if (o.count === 10) markHint('tavern_summon');
      this.reveal = null;
      this.scene.restart({ reveal: { results: r.results, count: o.count } } satisfies TavernData);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), COLOR.negative);
    }
  }

  /** «i»: шансы по редкостям и правила гаранта — листом снизу. */
  private openRates(): void {
    bottomSheet(this, 'Шансы и гарант', (content, width) => {
      let y = S.xs;
      for (const r of GAME.summon.rates) {
        const def = rarityDef(GAME, r.rarity);
        content.add(this.add.circle(14, y + 24, 14, hexNum(def.color)));
        content.add(text(this, 48, y + 24, def.name, T.body, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5));
        content.add(text(this, width, y + 24, `${String(Math.round(r.chance * 1000) / 10).replace('.', ',')}%`, T.body, def.color, { fontStyle: 'bold' }).setOrigin(1, 0.5));
        y += 72;
      }
      y += S.s;
      const s = GAME.summon;
      const rules = [
        ...s.pity.map((p) => `${p.every - 1} призывов подряд без ${RARITY_FEM[p.rarity]} — следующая карта ${RARITY_CARD[p.rarity]}.`),
        `Первый ×10 (один раз) — ${firstTenText(s.firstTen.count, s.firstTen.rarity, true)}.`,
        `Бесплатно: ${s.freePerDay} призыв в день. Свиток — 1 призыв.`,
        'Фиолетовая приходит без ветки — её выбирают на карточке героя.',
        'Копии — для вознесения в «Героях».',
      ];
      for (const line of rules) {
        const t = text(this, 0, y, line, T.caption, COLOR.textSecondary, { align: 'left', wordWrap: { width } }).setOrigin(0, 0);
        content.add(t);
        y += t.height + S.xs;
      }
      return y;
    });
  }

  // ---------- показ призыва ----------

  private startReveal(results: SummonResult[], count: number): void {
    // Зал под показом почти не виден (затемнение) — прячем его: на слабых телефонах меньше перерисовки
    // (крупные светящиеся слои), показ идёт в полную частоту кадров. Остаётся только фон.
    for (const o of this.children.list) {
      const bgImage = o instanceof Phaser.GameObjects.Image && (o.texture.key === TAVERN_BG || o.texture.key === TAVERN_BG_FILE);
      if (!bgImage) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible?.(false);
    }
    const layer = this.add.container(0, 0).setDepth(DEPTH);
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x07040a, 0.9).setInteractive();
    layer.add(shade);
    // Свет над столом.
    layer.add(this.add.image(GAME_W / 2, TABLE_Y, GLOW).setTint(0xffa050).setAlpha(0.25).setDisplaySize(1300, 1100).setBlendMode(Phaser.BlendModes.ADD));
    const geometry = tavernRevealLayout(results.length, view().safeBottom, view().adaptive);
    const body = new ScrollArea(this, geometry.top, geometry.bottom);
    body.content.setName('tavernRevealScroll');
    body.setContentHeight(geometry.bodyHeight);
    layer.add(body.parts);
    const best = bestResult(results);
    const state: RevealState = {
      results,
      count,
      phase: 'deal',
      cards: [],
      layer,
      body,
      footer: [],
      footerBottom: view().safeBottom,
      ui: [],
      tags: copyTags(results, session.save.heroes, count === 1),
      best: best ? results.indexOf(best) : -1,
      momentShown: false,
      pendingSkip: false,
      waiters: [],
    };
    this.reveal = state;
    // Касание стола (мимо карт) — пропуск: все карты сразу лицом вверх.
    let armed = false;
    shade.on('pointerdown', () => { armed = true; });
    const release = () => { armed = false; };
    this.input.on('ui-cancel-press', release);
    shade.once(Phaser.GameObjects.Events.DESTROY, () => this.input.off('ui-cancel-press', release));
    shade.on('pointerup', () => {
      if (armed && (state.phase === 'deal' || state.phase === 'pick')) this.skip(state);
      armed = false;
    });
    const skip = button(this, GAME_W - S.l - 140, CONTENT_TOP + 66, 280, 132, '', 'Пропустить', () => this.skip(state), T.body, { variant: 'ghost' });
    skip.container.setName('tavernRevealSkip');
    layer.add(skip.container);
    state.ui.push(skip.container);

    const heroes = results.map((r) => session.save.heroes.find((h) => h.id === r.heroId)).filter((h): h is HeroState => !!h);
    if (heroes.length !== results.length) {
      // Сохранение успело поменяться (другая вкладка) — показывать нечего, сразу итог по данным призыва.
      this.finish(state);
      return;
    }
    const slots = geometry.slots;
    onViewChange(this, () => {
      const next = tavernRevealLayout(state.count, view().safeBottom, view().adaptive);
      body.setBounds(next.top, next.bottom);
      const dy = view().safeBottom - state.footerBottom;
      for (const o of state.footer) if (o.scene && 'y' in o) (o as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform).y += dy;
      state.footerBottom = view().safeBottom;
    });
    // Листы героев грузим до раздачи — фигуры встанут в карты без «Загрузка…» посреди показа.
    whenSprites(this, [...new Set(heroes.map((h) => heroSprite(h, GAME)))], () => {
      if (this.reveal !== state) return;
      state.cards = results.map((_, i) => this.makeCard(state, i, slots[i], heroes[i], count === 1));
      if (state.pendingSkip) { this.skip(state); return; }
      if (motion.reduced) {
        // Уменьшить анимацию: карты сразу лицом вверх, звук и вибрация лучшей карты, итог.
        for (const cv of state.cards) this.showFace(state, cv);
        this.bestSound(state);
        this.finish(state);
        return;
      }
      this.deal(state);
    });
  }

  private makeCard(state: RevealState, i: number, slot: CardSlot, hero: HeroState, big: boolean): CardView {
    const r = state.results[i];
    const col = hexNum(rarityDef(GAME, r.rarity).color);
    const root = this.add.container(slot.x, slot.y);
    const glow = this.add.image(0, 0, GLOW).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(slot.w * 2, slot.h * 1.7).setAlpha(0);
    const face = summonFace(this, 0, 0, slot.w, slot.h, hero, big).setVisible(false);
    // Рубашка — ровно по размеру лица: переворот не «прыгает».
    const back = this.add.image(0, 0, CARD_BACK).setDisplaySize(face.getData('w') as number, face.getData('h') as number);
    root.add([glow, back, face]);
    root.setSize(slot.w, slot.h).setName(`summonCard_${i}`);
    const cv: CardView = { i, slot, root, glow, back, face, flipped: false, busy: false };
    state.body.add(root);
    pressable(this, root, slot.w, slot.h, state.body.tap(() => {
      if (state.phase === 'pick') void this.flip(state, cv, 'tap');
      else if (state.phase === 'done') this.scene.start('Hero', { heroId: r.heroId, back: { to: 'Tavern' } });
    }));
    return cv;
  }

  /** Раздача: карты рубашкой вверх вылетают из колоды на свои места. */
  private deal(state: RevealState): void {
    if (state.count > 1) sfx('summon_pull');
    const n = state.cards.length;
    state.cards.forEach((cv, k) => {
      const { root, slot } = cv;
      root.setPosition(DECK.x, tavernRevealLayout(state.count, view().safeBottom, view().adaptive).deckY).setScale(0.35).setAngle(-160 + k * 12).setAlpha(0);
      this.tweens.add({
        targets: root,
        x: slot.x,
        y: slot.y,
        scale: 1,
        angle: 0,
        alpha: 1,
        delay: 70 * k,
        duration: M.slow + 100,
        ease: E.out,
        onComplete: () => {
          if (k === 0 || k === n - 1) sfx('ui_tap', { rate: 0.8 });
          if (k === n - 1) this.readyToPick(state);
        },
      });
    });
  }

  /**
   * Карты на столе. Без слов: первая карта один раз мягко «вздыхает» (её можно открыть касанием), затем карты
   * открываются сами по очереди — простые раньше, самая редкая последней, с нарастанием. ×1 ждёт касания чуть дольше.
   */
  private readyToPick(state: RevealState): void {
    if (this.reveal !== state || state.phase !== 'deal') return;
    state.phase = 'pick';
    const first = state.cards[revealOrder(state.results)[0]];
    if (first) this.tweens.add({ targets: first.root, scale: 1.06, duration: M.slow, yoyo: true, ease: E.inOut });
    this.later(state, state.count > 1 ? M.slow * 2 : 1400, () => void this.autoReveal(state));
  }

  private later(state: RevealState, ms: number, fn: () => void): void {
    this.time.delayedCall(ms, () => {
      if (this.reveal === state) fn();
    });
  }

  private sleep(state: RevealState, ms: number): Promise<void> {
    return new Promise((res) => (ms <= 0 ? res() : this.later(state, ms, res)));
  }

  /** Пока идёт момент редкой карты, очередные перевороты ждут. */
  private free(state: RevealState): Promise<void> {
    return state.phase === 'showcase' ? new Promise((res) => state.waiters.push(res)) : Promise.resolve();
  }

  /** Перевороты по очереди (revealSchedule): простые — с шагом, карта с нарастанием — после всех остальных. */
  private async autoReveal(state: RevealState): Promise<void> {
    const sched = revealSchedule(state.results);
    let t = 0;
    const flips: Promise<void>[] = [];
    for (const s of sched) {
      await this.sleep(state, s.at - t);
      t = s.at;
      await this.free(state);
      if (this.reveal !== state || state.phase === 'done') return;
      const cv = state.cards[s.index];
      if (s.tension) {
        await Promise.all(flips);
        await this.flip(state, cv, 'tension');
      } else flips.push(this.flip(state, cv, 'quick'));
    }
    await Promise.all(flips);
    this.checkDone(state);
  }

  /**
   * Переворот карты (§4.6): рубашка дрожит → вспышка → разворот. mode: tap — касание (у синей и выше — нарастание
   * по summonSound); quick — очередь, без нарастания; tension — очередь, самая редкая карта серии.
   * Синяя — лучи за картой; фиолетовая и выше — луч, стягивающиеся искры, вспышка экрана; лучшая — момент.
   */
  private flip(state: RevealState, cv: CardView, mode: 'tap' | 'quick' | 'tension'): Promise<void> {
    if (cv.flipped || cv.busy) return Promise.resolve();
    cv.busy = true;
    const r = state.results[cv.i];
    const rarity = r.rarity;
    const tense = mode === 'tension' || (mode === 'tap' && tensionMs(rarity) > 0);
    const wait = tense ? summonSound(SOUND_RARITY[rarity]) : mode === 'quick' ? 200 : 260;
    const epic = isEpic(rarity);
    const momentCard = epic && cv.i === state.best && !state.momentShown;
    const col = hexNum(rarityDef(GAME, r.rarity).color);
    const { root, glow, slot } = cv;
    state.body.content.bringToTop(root);
    // Дрожь рубашки (поворот — не сдвиг: место карты не уплывает).
    const amp = tense ? (epic ? 4 : 3) : 2;
    const shake = this.tweens.add({ targets: root, angle: { from: -amp, to: amp }, duration: 50, yoyo: true, repeat: Math.max(1, Math.floor(wait / 100)), ease: E.inOut });
    let beam: Phaser.GameObjects.Image | null = null;
    if (tense) {
      this.tweens.add({ targets: glow, alpha: 0.95, duration: wait, ease: E.in });
      this.tweens.add({ targets: root, scale: 1.08, duration: wait, ease: E.in });
      if (epic) {
        beam = this.add.image(slot.x, slot.y + slot.h / 2, BEAM).setOrigin(0.5, 1).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
        beam.setDisplaySize(slot.w * 1.2, slot.y + slot.h / 2 + 200);
        // Луч — за всеми картами (не красит соседние).
        state.body.content.addAt(beam, 0);
        this.tweens.add({ targets: beam, alpha: 0.85, duration: wait, ease: E.in });
        this.converge(state, slot, col, wait);
      }
    }
    return new Promise((resolve) => {
      this.time.delayedCall(wait, () => {
        if (this.reveal !== state || !root.scene || cv.flipped) return resolve();
        if (!tense) sfx(SUMMON_REVEAL[SOUND_RARITY[rarity]]);
        // Вибрацию лучшей фиолетовой даёт момент (один тяжёлый удар за призыв).
        if (!momentCard) flipHaptic(rarity);
        const fw = cv.face.getData('w') as number;
        const fh = cv.face.getData('h') as number;
        const flash = this.add.image(slot.x, slot.y, GLOW).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(fw * 1.5, fh * 1.3).setAlpha(0);
        state.body.add(flash);
        this.tweens.add({ targets: flash, alpha: 1, duration: M.fast / 2, yoyo: true, hold: 40, ease: E.out, onComplete: () => flash.destroy() });
        this.tweens.add({
          targets: root,
          scaleX: 0,
          duration: 110,
          delay: M.fast / 2,
          ease: E.in,
          onComplete: () => {
            shake.stop();
            root.setAngle(0);
            this.showFace(state, cv);
            this.tweens.add({ targets: root, scaleX: 1, scaleY: 1, duration: M.fast, ease: E.pop });
            this.burst(state, slot, col, epic ? 28 : rarity === 'green' ? 6 : 16, epic);
            if (tensionMs(rarity) > 0) this.rays(state, cv, col, epic);
            if (epic) {
              this.cameras.main.flash(260, 200, 150, 255);
              this.cameras.main.shake(260, 0.006);
              if (beam) this.tweens.add({ targets: beam, alpha: 0, duration: 1100, delay: 250, onComplete: () => beam?.destroy() });
            }
            this.time.delayedCall(M.base, () => {
              if (momentCard && this.reveal === state && state.phase === 'pick') this.showcase(state, cv).then(resolve);
              else resolve();
              this.checkDone(state);
            });
          },
        });
      });
    });
  }

  /** Лицо вместо рубашки; свечение по редкости; «Гарант» — меткой у верхнего края карты. */
  private showFace(state: RevealState, cv: CardView): void {
    const r = state.results[cv.i];
    cv.back.setVisible(false);
    cv.face.setVisible(true);
    cv.flipped = true;
    cv.busy = false;
    const rare = tensionMs(r.rarity) > 0;
    cv.glow.setAlpha(isEpic(r.rarity) ? 0.85 : rare ? 0.45 : 0.15);
    if (r.guaranteed) {
      const gy = cv.slot.y - (cv.face.getData('h') as number) / 2;
      state.body.add(tag(this, cv.slot.x, gy, 'Гарант', 'accent', { solid: true }).setName(`summonGuarantee_${cv.i}`));
    }
  }

  /** Лучи за открытой синей (и выше) картой — медленно вращаются до конца показа. */
  private rays(state: RevealState, cv: CardView, col: number, epic: boolean): void {
    if (!this.textures.exists('skin_rays')) return;
    const size = cv.slot.w * (epic ? 2.8 : 2.2);
    const img = this.add.image(cv.slot.x, cv.slot.y, 'skin_rays').setTint(col).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(size, size).setAlpha(0);
    state.body.content.addAt(img, Math.max(0, state.body.content.getIndex(cv.root)));
    this.tweens.add({ targets: img, alpha: epic ? 0.7 : 0.5, duration: M.slow, ease: E.out });
    decorTween(this, { targets: img, angle: 360, duration: 24000, repeat: -1 });
  }

  /** Искры цвета редкости разлетаются от карты; кольцо-волна. */
  private burst(state: RevealState, slot: CardSlot, col: number, n: number, big: boolean): void {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.3;
      const d = (big ? 260 : 150) * (0.6 + Math.random() * 0.6);
      const s = this.add.image(slot.x, slot.y, SPARK).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setScale(big ? 1.1 : 0.8);
      state.body.add(s);
      this.tweens.add({ targets: s, x: slot.x + Math.cos(a) * d, y: slot.y + Math.sin(a) * d, alpha: 0, scale: 0.2, duration: 500 + Math.random() * 300, ease: E.out, onComplete: () => s.destroy() });
    }
    const rings = big ? 2 : 1;
    for (let k = 0; k < rings; k++) {
      const ring = this.add.circle(slot.x, slot.y, slot.w * 0.4).setStrokeStyle(big ? 10 : 6, col, 1).setFillStyle(0, 0);
      state.body.add(ring);
      this.tweens.add({ targets: ring, scale: big ? 3.2 : 2, alpha: 0, duration: M.emphasis, delay: k * 150, ease: E.out, onComplete: () => ring.destroy() });
    }
  }

  /** Искры со всех сторон стягиваются к карте за ms (нарастание фиолетовой). */
  private converge(state: RevealState, slot: CardSlot, col: number, ms: number): void {
    for (let k = 0; k < 18; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 280 + Math.random() * 200;
      const s = this.add.image(slot.x + Math.cos(a) * d, slot.y + Math.sin(a) * d, SPARK).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setScale(0.7).setAlpha(0);
      state.body.add(s);
      this.tweens.add({ targets: s, x: slot.x, y: slot.y, alpha: { from: 0, to: 1 }, duration: ms * (0.6 + Math.random() * 0.4), delay: Math.random() * ms * 0.3, ease: E.in, onComplete: () => s.destroy() });
    }
  }

  /**
   * Момент лучшей фиолетовой (и выше) карты серии — один раз за призыв: moment('summonRare') (затемнение, заголовок,
   * лучи, тяжёлая вибрация) и поверх — крупная карта с лучом, «Новый» / «+1 копия» и строкой героя.
   * Касание — дальше (не раньше чем через 0,4 с); сам уходит через несколько секунд.
   */
  private showcase(state: RevealState, cv: CardView): Promise<void> {
    const r = state.results[cv.i];
    const hero = session.save.heroes.find((h) => h.id === r.heroId);
    state.momentShown = true;
    if (!hero) return Promise.resolve();
    state.phase = 'showcase';
    for (const o of state.ui) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    const def = rarityDef(GAME, r.rarity);
    const col = hexNum(def.color);
    const tpl = GAME.content.heroes[hero.templateId];
    const m = moment(this, 'summonRare', {
      keep: true,
      sound: false,
      color: def.color,
      title: `${cap(RARITY_CARD[r.rarity])} карта!`,
      subtitle: `${tpl?.name ?? hero.templateId} · ${heroCard(hero, GAME).jobName}`,
      at: { x: GAME_W / 2, y: 300 },
    });
    const D = MOMENT_DEPTH + 10;
    const box = this.add.container(0, 0).setDepth(D).setName('showcase');
    const cy = view().uiHeight / 2;
    const beam = this.add.image(GAME_W / 2, cy + 380, BEAM).setOrigin(0.5, 1).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(620, 1300).setAlpha(0.7);
    const ring = this.add.container(GAME_W / 2, cy + 330).setScale(1.3, 0.45);
    const circle = this.add.image(0, 0, CIRCLE).setTint(col).setAlpha(0.8).setBlendMode(Phaser.BlendModes.ADD);
    ring.add(circle);
    const face = summonFace(this, GAME_W / 2, cy, 440, 620, hero, true);
    const fh = face.getData('h') as number;
    const t = resultTag(state.tags[cv.i]);
    const mark = tag(this, GAME_W / 2, cy + fh / 2 + S.l, t.text, t.kind === 'new' ? 'gold' : 'neutral', { solid: t.kind === 'new' });
    box.add([beam, ring, face, mark]);
    const offResize = onViewChange(this, (next) => box.setY(next.uiHeight / 2 - cy));
    box.once(Phaser.GameObjects.Events.DESTROY, offResize);
    const said = tpl?.tavernLine;
    if (said) box.add(text(this, GAME_W / 2, mark.y + S.xl, `«${said}»`, T.body, COLOR.textSecondary, { fontStyle: 'italic', wordWrap: { width: GAME_W - 2 * S.xl }, align: 'center' }).setOrigin(0.5, 0).setName('tavernLine'));
    this.tweens.add({ targets: circle, angle: 360, duration: 9000, repeat: -1 });
    face.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: face, scale: 1, alpha: 1, duration: M.slow, delay: M.slow, ease: E.pop });
    box.setAlpha(0);
    this.tweens.add({ targets: box, alpha: 1, duration: M.base, delay: M.slow });
    // Касания момента ловит своя зона поверх (затемнение момента после «встал» пропускает ввод).
    const zone = this.add.zone(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y).setDepth(D + 1).setInteractive();
    return new Promise((resolve) => {
      let closed = false;
      let armed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        zone.destroy();
        m.close();
        this.tweens.add({
          targets: box,
          alpha: 0,
          duration: M.fast,
          ease: E.in,
          onComplete: () => {
            box.destroy();
            if (state.phase === 'showcase') state.phase = 'pick';
            for (const o of state.ui) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible?.(true);
            for (const w of state.waiters.splice(0)) w();
            resolve();
            this.checkDone(state);
          },
        });
      };
      this.time.delayedCall(400, () => (armed = true));
      zone.on('pointerup', () => {
        if (!armed) return;
        if (!m.settled) m.skip();
        else close();
      });
      this.time.delayedCall(4200, close);
    });
  }

  /** Звук и вибрация лучшей карты (пропуск, «Уменьшить анимацию»). */
  private bestSound(state: RevealState): void {
    const best = state.results[state.best];
    if (!best) return;
    sfx(SUMMON_REVEAL[SOUND_RARITY[best.rarity]]);
    flipHaptic(best.rarity);
  }

  /** Пропуск: все карты сразу лицом вверх; лучшая фиолетовая (если момента ещё не было) — всё равно моментом. */
  private skip(state: RevealState): void {
    if (state.phase !== 'deal' && state.phase !== 'pick') return;
    // Первый тап может прийти до листов героев. Запоминаем пропуск, чтобы итог не оказался пустым.
    if (state.cards.length !== state.results.length) { state.pendingSkip = true; return; }
    this.tweens.killTweensOf(state.cards.map((c) => c.root));
    for (const cv of state.cards) {
      cv.root.setPosition(cv.slot.x, cv.slot.y).setScale(1).setAngle(0).setAlpha(1);
      if (!cv.flipped) {
        this.showFace(state, cv);
        const r = state.results[cv.i];
        if (tensionMs(r.rarity) > 0) this.rays(state, cv, hexNum(rarityDef(GAME, r.rarity).color), isEpic(r.rarity));
      }
    }
    const bestCard = state.cards[state.best];
    const best = state.results[state.best];
    if (best && bestCard && isEpic(best.rarity) && !state.momentShown) {
      sfx(SUMMON_REVEAL[SOUND_RARITY[best.rarity]]);
      state.phase = 'pick';
      void this.showcase(state, bestCard).then(() => this.finish(state));
      return;
    }
    this.bestSound(state);
    this.finish(state);
  }

  private checkDone(state: RevealState): void {
    if (this.reveal !== state || state.phase === 'done' || state.phase === 'showcase') return;
    if (state.cards.length && state.cards.every((c) => c.flipped && !c.busy)) this.later(state, M.base, () => this.finish(state));
  }

  /** Итог: сетка карт с метками «Новый» / «+1 копия»; «Готово» и «Ещё ×10» (×1 — «Ещё ×1») с ценой. */
  private finish(state: RevealState): void {
    if (this.reveal !== state || state.phase === 'done' || state.phase === 'showcase') return;
    state.phase = 'done';
    for (const o of state.ui) o.destroy();
    state.ui = [];
    const L2 = state.layer;
    state.cards.forEach((cv, k) => {
      const t = resultTag(state.tags[cv.i]);
      const fh = cv.face.getData('h') as number;
      const y = cv.slot.y + fh / 2 + (state.count === 1 ? S.l : 34);
      const mark = tag(this, cv.slot.x, y, t.text, t.kind === 'new' ? 'gold' : 'neutral', { solid: t.kind === 'new' }).setName(`summonTag_${cv.i}`);
      if (t.kind === 'copy' && !view().adaptive) mark.setScale(0.85);
      state.body.add(mark);
      if (!motion.reduced) {
        mark.setAlpha(0);
        this.tweens.add({ targets: mark, alpha: 1, duration: M.base, delay: k * 24 });
      }
    });

    const st = summonStatus(session.save, today(), GAME);
    const btns = summonButtons(st);
    const again = state.count === 10 ? btns.ten : btns.one;
    const next = currentStage(session.save, GAME);
    const geometry = tavernRevealLayout(state.count, view().safeBottom, view().adaptive);
    const beforeFooter = new Set(L2.list);
    if (next) {
      const prep = button(this, GAME_W / 2, geometry.prepareY, GAME_W - 2 * S.l, BTN_H, '', 'Собрать отряд', () => this.scene.start('Stage', { stageId: next.id }), T.heading, { variant: 'secondary' });
      prep.container.setName('summonPrepare');
      L2.add(prep.container);
    }
    const wDone = 380;
    const wMore = GAME_W - 2 * S.l - S.s - wDone;
    const done = button(this, S.l + wDone / 2, geometry.doneY, wDone, BTN_H, '', 'Готово', () => this.scene.restart({} satisfies TavernData), T.heading, { variant: 'secondary' });
    done.container.setName('summonDone');
    // {} обязательно: без данных Phaser перезапускает сцену с прошлыми (reveal) и показ повторяется.
    const more = this.pullButton(GAME_W - S.l - wMore / 2, geometry.doneY, wMore, L.pullH, true, again, again.cost, again.free, `Ещё ×${state.count}`);
    more.container.setName('summonAgain');
    L2.add([done.container, more.container]);
    state.footer = L2.list.filter((o) => !beforeFooter.has(o));
    state.footerBottom = view().safeBottom;
    if (!motion.reduced) {
      for (const b of [done.container, more.container]) {
        b.setAlpha(0);
        this.tweens.add({ targets: b, alpha: 1, duration: M.base, delay: M.slow });
      }
    }
  }
}
