import Phaser from 'phaser';
import { actSummon, addHeroCard, grantTavernWelcome, heroCard, needsBranch, rarityDef, summonPool, summonStatus, type HeroState, type SummonResult, type SummonStatus } from '../../core';
import { SUMMON_REVEAL } from '../audioCatalog';
import { sfx, summonSound } from '../audio';
import { screenBackground } from '../backdrops';
import { GAME } from '../content';
import { describeEvents, formatNumber, heroSprite, stageNo } from '../flow';
import { afterRewardFly, pulse, queueRewardFly } from '../juice';
import { GAME_H, GAME_W, BLEED_X, BLEED_Y } from '../layout';
import { card, CONTENT_TOP, gemIcon, popIn, screen, unitFigure } from '../screen';
import { commit, session, today } from '../session';
import { SKIN_TINT, skinIcon } from '../skin';
import { whenSprites } from '../sprites';
import { motion } from '../state';
import {
  againOption,
  bestResult,
  cardSlots,
  pityInfo,
  pullOptions,
  RARITY_CARD,
  firstTenText,
  RARITY_FEM,
  ratesLines,
  copyTags,
  revealOrder,
  revealSchedule,
  SOUND_RARITY,
  summaryLine,
  tensionMs,
  type CardSlot,
  type PullOption,
} from '../tavern';
import { BEAM, CARD_BACK, CIRCLE, GLOW, SPARK, setTavernBackground, TAVERN_BG, TAVERN_BG_FILE, TAVERN_LIGHTS } from '../tavernArt';
import { drawHeroCard, heroCardSize } from '../heroCard';
import { markTavernSeen } from '../tavernEntry';
import { C, FS, OUTLINE, TITLE_STYLE } from '../theme';
import { button, ellipsize, panel, progressBar, text, toast, tutorialHint } from '../ui';
import { hintDone, markHint } from '../hints';

/** Цвет редкости (#rrggbb) → число для tint и заливок. */
const colorOf = (hex: string): number => Phaser.Display.Color.HexStringToColor(hex).color;

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
  /** Строки тоста после перезапуска (подарок, ошибки). */
  toast?: string[];
}

/** Середина стола, куда ложатся карты при показе. */
const TABLE_Y = 1000;
/** Откуда вылетают карты (колода у края стола). */
const DECK = { x: GAME_W / 2, y: 1720 };
const DEPTH = 5000;

type Phase = 'deal' | 'pick' | 'flipping' | 'showcase' | 'done';

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

/** Состояние показа (читает и e2e: фаза и результаты). */
interface RevealState {
  results: SummonResult[];
  count: number;
  phase: Phase;
  cards: CardView[];
  layer: Phaser.GameObjects.Container;
  title: Phaser.GameObjects.Text;
  ui: Phaser.GameObjects.GameObject[];
  /** Подписи «Новый герой!» / «копия · теперь ×N» по картам (тот же templateId уже был у игрока до призыва). */
  tags: ReturnType<typeof copyTags>;
  /** То же для крупного показа (×1 и витрина редкой карты). */
  bigTags: ReturnType<typeof copyTags>;
}

/**
 * H5. Таверна: призыв карточек героев (docs/design/heroes-v2.md, раздел 4). Тёплый зал, круг призыва с «гостями дня»
 * (три героя пула), полосы гарантов «до синей / до фиолетовой», кнопки «Бесплатно» / свитки / ×1 / ×10, окно шансов, подарок открытия.
 * Показ как в AFK: карты рубашкой вверх вылетают на стол, нажатие — переворот (или «Открыть все»); перед редкой —
 * нарастание (summonSound задаёт время), фиолетовая — луч, вспышка и крупный показ; итог — «К героям» / «Ещё ×10».
 * «Уменьшить анимацию» — сразу итог.
 */
export class TavernScene extends Phaser.Scene {
  reveal: RevealState | null = null;

  constructor() {
    super('Tavern');
  }

  create(data: TavernData = {}): void {
    this.reveal = null;
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
    this.topRow(st);
    this.showcase();
    this.pity(st);
    this.buttons(st);
    if (!data.reveal?.results.length) this.tutorial(st);
    if (data.toast?.length) afterRewardFly(this, () => toast(this, data.toast!.join('\n'), C.success, 5000));
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
    card(this, GAME_W / 2, 800, 960, 360);
    text(this, GAME_W / 2, 700, 'Таверна пока закрыта', FS.h1, C.title, TITLE_STYLE);
    text(this, GAME_W / 2, 820, `Откроется после этапа ${stage ? `${stageNo(stage, GAME)} «${stage.name}»` : st.unlockAfterStage}`, FS.body, C.text, { ...OUTLINE, wordWrap: { width: 860 } });
    button(this, GAME_W / 2, 1100, 520, 120, 'ui_btn_primary', 'В кампанию', () => this.scene.start('Campaign'), FS.h2);
  }

  /** Свитки и шансы; подарок открытия (если не забран) или вывеска. */
  private topRow(st: SummonStatus): void {
    const y = CONTENT_TOP + 50;
    // Свитки призыва — «таблетка» как у валюты в шапке.
    const pill = this.add.container(170, y, [panel(this, 0, 0, 260, 76, 'k:buttonLong_beige'), this.add.image(-88, 0, skinIcon('scroll')).setDisplaySize(52, 52).setTint(SKIN_TINT.gold)]);
    pill.add(text(this, 12, -2, `Свитки: ${formatNumber(st.scrolls)}`, FS.body, C.title, { fontStyle: 'bold' }));
    pill.setName('scrollsPill');
    text(this, 540, y, `Призывов: ${formatNumber(st.total)}`, FS.small, C.muted, OUTLINE);
    button(this, 910, y, 240, 90, 'ui_btn_secondary', 'Шансы', () => this.openRates(), FS.h3, { sound: null });

    const gy = y + 150;
    if (!session.save.summon.welcomeGiven) {
      const w = GAME.summon.welcome;
      card(this, GAME_W / 2, gy, 1000, 190, true);
      text(this, 70, gy - 42, 'Подарок Гаррета', FS.h2, C.title, TITLE_STYLE).setOrigin(0, 0.5);
      text(this, 70, gy + 30, `Гемы +${formatNumber(w.gems)}, свитки призыва +${w.scrolls}`, FS.body, C.gem, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5);
      const b = button(this, 820, gy, 330, 120, 'ui_btn_primary', 'Забрать подарок', () => this.claimWelcome({ x: 820, y: gy }), FS.h3);
      pulse(this, b.container);
    } else {
      text(this, GAME_W / 2, gy - 20, 'Таверна Пронтеры', FS.hero, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10 });
      text(this, GAME_W / 2, gy + 45, 'Наёмники ищут работу — кто сядет за ваш стол?', FS.small, C.muted, OUTLINE);
    }
  }

  /** Круг призыва на столе и три героя из пула (гости дня: сменяются по дате игрока), подпись — сколько героев в пуле. */
  private showcase(): void {
    const cy = 1040;
    const ring = this.add.container(GAME_W / 2, cy).setScale(1.7, 0.62);
    const circle = this.add.image(0, 0, CIRCLE).setTint(0xc89bff).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD);
    const inner = this.add.image(0, 0, CIRCLE).setTint(0xffc070).setAlpha(0.3).setScale(0.62).setBlendMode(Phaser.BlendModes.ADD);
    ring.add([circle, inner]);
    this.add.image(GAME_W / 2, cy - 30, GLOW).setTint(0xa05cff).setAlpha(0.35).setDisplaySize(900, 520).setBlendMode(Phaser.BlendModes.ADD);
    if (!motion.reduced) {
      this.tweens.add({ targets: circle, angle: 360, duration: 40000, repeat: -1 });
      this.tweens.add({ targets: inner, angle: -360, duration: 26000, repeat: -1 });
      this.tweens.add({ targets: circle, alpha: { from: 0.45, to: 0.7 }, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    // Пул Таверны — все герои (12); витрина — три «гостя дня» в форме первой профессии (ветку выбирают на фиолетовом).
    const pool = summonPool(GAME, 'green');
    if (!pool.length) return;
    // Витрина меняется раз в день (по дате игрока).
    const day = today();
    let h = 0;
    for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const picks = [0, 1, 2].map((k) => pool[(h + k * 5) % pool.length]).filter((t, i, a) => a.indexOf(t) === i);
    const spots = [
      { x: 300, h: 250 },
      { x: 540, h: 310 },
      { x: 780, h: 250 },
    ];
    const heroes = picks.map((t) => addHeroCard(session.save, t, 'green').hero);
    heroes.forEach((hero, i) => {
      const s = spots[i];
      const feet = cy + (i === 1 ? 30 : 0);
      this.add.ellipse(s.x, feet + 4, 170, 34, 0x000000, 0.45);
      unitFigure(this, heroSprite(hero, GAME), s.x, feet, s.h, { maxScale: 2.4 });
    });
    const names = heroes.map((x) => GAME.content.heroes[x.templateId]?.name ?? x.templateId);
    text(this, GAME_W / 2, cy + 100, `За столом: ${names.join(', ')} · героев в Таверне: ${pool.length}`, FS.small, '#d8b8ff', { fontStyle: 'bold', ...OUTLINE, wordWrap: { width: 980 } }).setName('tavernGuests');
  }

  /** Гаранты: «До гарантированной синей: N» и «… фиолетовой: N» с полосами; заметка про первый ×10. */
  private pity(st: SummonStatus): void {
    const rows = st.pities.length ? st.pities : [{ rarity: st.pityRarity, until: st.untilPity }];
    const rowH = 58;
    const h = 40 + rows.length * rowH + (st.firstTenBonus ? 52 : 0);
    const y = 1275;
    card(this, GAME_W / 2, y, 1000, h);
    let ry = y - h / 2 + 20 + rowH / 2;
    rows.forEach((p, i) => {
      const every = GAME.summon.pity.find((x) => x.rarity === p.rarity)?.every ?? p.until;
      const info = pityInfo({ untilPity: p.until, pityRarity: p.rarity }, every);
      const color = rarityDef(GAME, p.rarity).color;
      text(this, 76, ry, `До ${RARITY_FEM[p.rarity]}: ${p.until}`, FS.h3, color, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5).setName(i === 0 ? 'pityLabel' : `pityLabel_${p.rarity}`);
      progressBar(this, 480, ry, 520, 26, info.fraction, colorOf(color), { key: `tavern:pity:${p.rarity}` });
      ry += rowH;
    });
    if (st.firstTenBonus) {
      text(this, GAME_W / 2, ry - 6, `Первый призыв ×10 — ${firstTenText(st.firstTenCount, st.firstTenRarity)}!`, FS.small, C.gold, { fontStyle: 'bold', ...OUTLINE }).setName('firstTenNote');
    }
  }

  private buttons(st: SummonStatus): void {
    const opts = pullOptions(st);
    const by = (id: PullOption['id']) => opts.find((o) => o.id === id)!;
    const small = (o: PullOption, x: number, y: number) => {
      const primary = o.id === 'free' && o.enabled;
      const b = button(this, x, y, 316, 116, primary ? 'ui_btn_primary' : 'ui_btn_secondary', o.label, () => this.pull(o), FS.h3, { sound: o.enabled ? 'ui_tap' : null });
      if (!o.enabled) b.setEnabled(false);
      if (primary) pulse(this, b.container);
      return b;
    };
    const y1 = 1455;
    small(by('free'), 200, y1);
    small(by('scroll1'), 540, y1);
    small(by('scroll10'), 880, y1);
    const big = (o: PullOption, x: number, y: number) => {
      const b = button(this, x, y, 490, 150, 'ui_btn_primary', o.label, () => this.pull(o), FS.h2, { sound: o.enabled ? 'ui_tap' : null });
      b.label.setX(22);
      b.container.add(gemIcon(this, 22 - b.label.width / 2 - 34, -6, 40));
      if (!o.enabled) b.setEnabled(false);
      return b;
    };
    const y2 = 1620;
    big(by('gems1'), 280, y2);
    big(by('gems10'), 800, y2);
    const names = (r: Parameters<typeof rarityDef>[1]) => rarityDef(GAME, r).name.toLowerCase();
    text(this, GAME_W / 2, 1765, `Шансы: ${ratesLines(GAME.summon.rates, names).join(' · ')}`, FS.small, C.muted, OUTLINE);
    text(this, GAME_W / 2, 1815, `Гарант: ${GAME.summon.pity.map((p) => `${RARITY_CARD[p.rarity]} — на ${p.every}-м призыве`).join(', ')}`, FS.small, C.dim, { ...OUTLINE, wordWrap: { width: 1000 } });
  }

  /**
   * Ведущее обучение (hints.ts, шаг tavern_summon): до первого ×10 — указатель на «Забрать подарок», затем на ×10
   * (свитки или гемы — что доступно). Шаг выполнен первым ×10 (pull) или касанием плашки.
   */
  private tutorial(st: SummonStatus): void {
    if (session.save.summon.firstTenDone || hintDone('tavern_summon')) return;
    if (!session.save.summon.welcomeGiven) {
      tutorialHint(this, 'tavern_summon', 820, CONTENT_TOP + 200, 'below', { w: 330, h: 120 }, { text: 'Заберите подарок Гаррета — свитки и гемы на призыв' });
      return;
    }
    const opts = pullOptions(st);
    const scroll = opts.find((o) => o.id === 'scroll10' && o.enabled);
    const gems = opts.find((o) => o.id === 'gems10' && o.enabled);
    const msg = `Призыв ×10 — ${firstTenText(st.firstTenCount, st.firstTenRarity)}!`;
    if (scroll) tutorialHint(this, 'tavern_summon', 880, 1455, 'above', { w: 316, h: 116 }, { text: msg });
    else if (gems) tutorialHint(this, 'tavern_summon', 800, 1620, 'above', { w: 490, h: 150 }, { text: msg });
  }

  // ---------- действия ----------

  private claimWelcome(at: { x: number; y: number }): void {
    const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
    const r = grantTavernWelcome(session.save, GAME);
    if (r.save === session.save) return;
    commit(r.save);
    queueRewardFly('Tavern', at, before);
    this.scene.restart({ toast: describeEvents(r.events, r.save, GAME) } satisfies TavernData);
  }

  private pull(o: PullOption): void {
    if (this.reveal) return;
    try {
      const r = actSummon(session.save, today(), o.count, o.pay, GAME);
      commit(r.save);
      if (o.count === 10) markHint('tavern_summon');
      this.scene.restart({ reveal: { results: r.results, count: o.count } } satisfies TavernData);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private openRates(): void {
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const layer = this.add.container(0, 0).setDepth(8500).setName('ratesModal');
    const close = () => layer.destroy();
    const shade = this.add.rectangle(cx, cy, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x000000, 0.7).setInteractive();
    shade.on('pointerup', close);
    const box = panel(this, cx, cy, 900, 1060, 'ui_panel').setInteractive();
    layer.add([shade, box]);
    layer.add(text(this, cx, cy - 450, 'Шансы призыва', FS.h1, C.title, TITLE_STYLE));
    let y = cy - 350;
    for (const r of GAME.summon.rates) {
      const def = rarityDef(GAME, r.rarity);
      layer.add(this.add.rectangle(cx - 330, y, 44, 44, colorOf(def.color)).setStrokeStyle(3, 0x000000));
      layer.add(text(this, cx - 280, y, def.name, FS.h3, def.color, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5));
      layer.add(text(this, cx + 360, y, `${String(Math.round(r.chance * 1000) / 10).replace('.', ',')}%`, FS.h3, C.text, { fontStyle: 'bold', ...OUTLINE }).setOrigin(1, 0.5));
      y += 80;
    }
    const s = GAME.summon;
    const rules = [
      ...s.pity.map((p) => `Гарант: ${p.every - 1} призывов подряд без ${RARITY_FEM[p.rarity]} — следующая карта ${RARITY_CARD[p.rarity]}.`),
      `Первый призыв ×10 (один раз) — ${firstTenText(s.firstTen.count, s.firstTen.rarity, true)}.`,
      `Бесплатно: ${s.freePerDay} призыв в день. Свиток — 1 призыв.`,
      'Фиолетовая карта приходит без ветки — выберите её на карточке героя.',
      'Повторные карты — корм для вознесения в «Героях».',
    ];
    y += 20;
    for (const line of rules) {
      const t = text(this, cx - 380, y, `• ${line}`, FS.small, C.muted, { align: 'left', wordWrap: { width: 760 } }).setOrigin(0, 0);
      layer.add(t);
      y += t.height + 18;
    }
    layer.add(button(this, cx, cy + 440, 400, 120, 'ui_btn_primary', 'Понятно', close, FS.h2).container);
    popIn(this, layer, shade);
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
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x07040a, 0.93).setInteractive();
    layer.add(shade);
    // Свет над столом.
    layer.add(this.add.image(GAME_W / 2, TABLE_Y, GLOW).setTint(0xffa050).setAlpha(0.25).setDisplaySize(1300, 1100).setBlendMode(Phaser.BlendModes.ADD));
    const title = text(this, GAME_W / 2, 230, count > 1 ? `Призыв ×${count}` : 'Призыв', FS.h1, C.title, TITLE_STYLE);
    layer.add(title);
    const heroesNow = session.save.heroes;
    const state: RevealState = { results, count, phase: 'deal', cards: [], layer, title, ui: [], tags: copyTags(results, heroesNow, count === 1), bigTags: copyTags(results, heroesNow, true) };
    this.reveal = state;

    const heroes = results.map((r) => session.save.heroes.find((h) => h.id === r.heroId)).filter((h): h is HeroState => !!h);
    if (heroes.length !== results.length) {
      // Сохранение успело поменяться (другая вкладка) — показывать нечего, сразу итог по данным призыва.
      this.finish(state);
      return;
    }
    const slots = cardSlots(results.length, TABLE_Y);
    // Листы героев грузим до раздачи — фигуры встанут в карты без «Загрузка…» посреди показа.
    whenSprites(this, [...new Set(heroes.map((h) => heroSprite(h, GAME)))], () => {
      if (this.reveal !== state) return;
      state.cards = results.map((_, i) => this.makeCard(state, i, slots[i], heroes[i], count === 1));
      if (motion.reduced) {
        // Уменьшить анимацию: карты сразу лицом вверх, один звук лучшей карты, итог.
        for (const cv of state.cards) this.showFace(state, cv, false);
        const best = bestResult(results);
        if (best) sfx(SUMMON_REVEAL[SOUND_RARITY[best.rarity]]);
        this.finish(state);
        return;
      }
      this.deal(state);
    });
  }

  private makeCard(state: RevealState, i: number, slot: CardSlot, hero: HeroState, big: boolean): CardView {
    const r = state.results[i];
    const col = colorOf(rarityDef(GAME, r.rarity).color);
    const root = this.add.container(slot.x, slot.y);
    const glow = this.add.image(0, 0, GLOW).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(slot.w * 2, slot.h * 1.7).setAlpha(0);
    const face = summonFace(this, 0, 0, slot.w, slot.h, hero, big).setVisible(false);
    // Рубашка — ровно по размеру лица: переворот не «прыгает».
    const back = this.add.image(0, 0, CARD_BACK).setDisplaySize(face.getData('w') as number, face.getData('h') as number);
    root.add([glow, back, face]);
    root.setSize(slot.w, slot.h).setInteractive({ useHandCursor: true });
    const cv: CardView = { i, slot, root, glow, back, face, flipped: false, busy: false };
    root.on('pointerup', () => {
      if (state.phase === 'pick') void this.flip(state, cv, 'tap');
      else if (state.phase === 'done') this.scene.start('Hero', { heroId: r.heroId, back: { to: 'Tavern' } });
    });
    state.layer.add(root);
    return cv;
  }

  /** Раздача: карты рубашкой вверх вылетают из колоды на свои места. */
  private deal(state: RevealState): void {
    if (state.count > 1) sfx('summon_pull');
    const n = state.cards.length;
    state.cards.forEach((cv, k) => {
      const { root, slot } = cv;
      root.setPosition(DECK.x, DECK.y).setScale(0.35).setAngle(-160 + k * 12).setAlpha(0);
      this.tweens.add({
        targets: root,
        x: slot.x,
        y: slot.y,
        scale: 1,
        angle: Phaser.Math.Between(-2, 2),
        alpha: 1,
        delay: 80 * k,
        duration: 460,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          if (k === 0 || k === n - 1) sfx('ui_tap', { rate: 0.8 });
          if (k === n - 1) this.readyToPick(state);
        },
      });
    });
  }

  private readyToPick(state: RevealState): void {
    if (this.reveal !== state || state.phase !== 'deal') return;
    state.phase = 'pick';
    const hint = text(this, GAME_W / 2, 320, state.count > 1 ? 'Нажмите на карту, чтобы открыть' : 'Нажмите на карту', FS.body, C.muted, OUTLINE);
    const all = button(this, GAME_W / 2, 1620, 520, 140, 'ui_btn_primary', state.count > 1 ? 'Открыть все' : 'Открыть', () => this.openAll(state), FS.h2);
    const skip = button(this, 915, 230, 260, 96, 'ui_btn_secondary', 'Пропустить', () => this.skip(state), FS.h3);
    pulse(this, all.container);
    state.layer.add([hint, all.container, skip.container]);
    state.ui.push(hint, all.container, skip.container);
  }

  /**
   * Переворот карты. mode: tap — нажатие игрока (у синей и выше — нарастание по summonSound); quick — «Открыть все»
   * без нарастания; tension — «Открыть все», самая редкая карта серии.
   */
  private flip(state: RevealState, cv: CardView, mode: 'tap' | 'quick' | 'tension'): Promise<void> {
    if (cv.flipped || cv.busy) return Promise.resolve();
    cv.busy = true;
    const r = state.results[cv.i];
    const rarity = r.rarity;
    const tense = mode === 'tension' || (mode === 'tap' && tensionMs(rarity) > 0);
    const wait = tense ? summonSound(SOUND_RARITY[rarity]) : 60;
    const epic = tensionMs(rarity) >= tensionMs('purple');
    const col = colorOf(rarityDef(GAME, r.rarity).color);
    const { root, glow, slot } = cv;
    this.children.bringToTop(state.layer);
    state.layer.bringToTop(root);
    let beam: Phaser.GameObjects.Image | null = null;
    if (tense) {
      // Нарастание: свечение цвета редкости, дрожь, карта чуть растёт; у фиолетовой — луч и стягивающиеся искры.
      this.tweens.add({ targets: glow, alpha: 0.95, duration: wait, ease: 'Quad.easeIn' });
      this.tweens.add({ targets: root, scale: 1.08, duration: wait, ease: 'Quad.easeIn' });
      const amp = epic ? 7 : 4;
      this.tweens.add({ targets: root, x: slot.x + amp, duration: 45, yoyo: true, repeat: Math.max(1, Math.floor(wait / 90)), ease: 'Sine.easeInOut' });
      if (epic) {
        beam = this.add.image(slot.x, slot.y + slot.h / 2, BEAM).setOrigin(0.5, 1).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
        beam.setDisplaySize(slot.w * 1.2, slot.y + slot.h / 2 + 200);
        // Луч — за всеми картами (не красит соседние).
        state.layer.addAt(beam, 2);
        this.tweens.add({ targets: beam, alpha: 0.85, duration: wait, ease: 'Quad.easeIn' });
        this.converge(state, slot, col, wait);
      }
    }
    return new Promise((resolve) => {
      this.time.delayedCall(wait, () => {
        if (this.reveal !== state || !root.scene || cv.flipped) return resolve();
        if (!tense) sfx(SUMMON_REVEAL[SOUND_RARITY[rarity]]);
        this.tweens.add({
          targets: root,
          scaleX: 0,
          duration: 110,
          ease: 'Quad.easeIn',
          onComplete: () => {
            this.showFace(state, cv, true);
            root.setX(slot.x);
            this.tweens.add({ targets: root, scaleX: 1, scaleY: 1, duration: 200, ease: 'Back.easeOut' });
            this.burst(state, slot, col, epic ? 28 : rarity === 'green' ? 8 : 16, epic);
            if (epic) {
              this.cameras.main.flash(260, 200, 150, 255);
              this.cameras.main.shake(260, 0.006);
              if (beam) this.tweens.add({ targets: beam, alpha: 0, duration: 1100, delay: 250, onComplete: () => beam?.destroy() });
            }
            this.time.delayedCall(220, () => {
              if (epic && state.count > 1 && mode !== 'quick') this.showcaseCard(state, cv).then(resolve);
              else resolve();
              this.checkDone(state);
            });
          },
        });
      });
    });
  }

  /** Лицо вместо рубашки и метка под картой («Новый!» / «дубль → на слияние», в сетке ×10 — «на слияние»). */
  private showFace(state: RevealState, cv: CardView, animated: boolean): void {
    const r = state.results[cv.i];
    cv.back.setVisible(false);
    cv.face.setVisible(true);
    cv.flipped = true;
    cv.busy = false;
    const def = rarityDef(GAME, r.rarity);
    const rare = tensionMs(r.rarity) > 0;
    const epic = tensionMs(r.rarity) >= tensionMs('purple');
    cv.glow.setAlpha(epic ? 0.9 : rare ? 0.5 : 0.2);
    if (rare && !motion.reduced) this.tweens.add({ targets: cv.glow, alpha: epic ? { from: 1, to: 0.6 } : { from: 0.55, to: 0.3 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const tag = state.tags[cv.i];
    const big = state.count === 1;
    // В сетке ×10 — одна короткая строка («Новый!» / «копия ×N»): длинные упирались в соседние карты (зазор 18 по
    // ширине, 70 по высоте). Копия — корм для вознесения (строка под сеткой).
    const t = text(this, cv.slot.x, cv.slot.y + cv.slot.h / 2 + (big ? 36 : 24), tag.text, FS.caption, tag.kind === 'new' ? C.gold : C.dim, {
      fontStyle: 'bold',
      ...OUTLINE,
    }).setName(`summonTag_${cv.i}`);
    if (r.guaranteed) {
      // «Гарант» — лентой у верхнего края карты, между значками класса и роли (выше — подписи ряда над ней).
      const gy = cv.slot.y - (cv.face.getData('h') as number) / 2 + 30;
      const g = text(this, cv.slot.x, gy, 'гарант', FS.caption, C.text, { fontStyle: 'bold', ...OUTLINE });
      const band = this.add.rectangle(cv.slot.x, gy, g.width + 24, 40, colorOf(def.color), 0.95).setStrokeStyle(2, 0xf0cf8a);
      state.layer.add([band, g]);
    }
    state.layer.add(t);
    if (animated) {
      t.setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, duration: 200 });
    }
  }

  /** Искры цвета редкости разлетаются от карты; кольцо-волна. */
  private burst(state: RevealState, slot: CardSlot, col: number, n: number, big: boolean): void {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.3;
      const d = (big ? 260 : 150) * (0.6 + Math.random() * 0.6);
      const s = this.add.image(slot.x, slot.y, SPARK).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setScale(big ? 1.1 : 0.8);
      state.layer.add(s);
      this.tweens.add({ targets: s, x: slot.x + Math.cos(a) * d, y: slot.y + Math.sin(a) * d, alpha: 0, scale: 0.2, duration: 500 + Math.random() * 300, ease: 'Cubic.easeOut', onComplete: () => s.destroy() });
    }
    const rings = big ? 2 : 1;
    for (let k = 0; k < rings; k++) {
      const ring = this.add.circle(slot.x, slot.y, slot.w * 0.4).setStrokeStyle(big ? 10 : 6, col, 1).setFillStyle(0, 0);
      state.layer.add(ring);
      this.tweens.add({ targets: ring, scale: big ? 3.2 : 2, alpha: 0, duration: 600, delay: k * 150, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    }
  }

  /** Искры со всех сторон стягиваются к карте за ms (нарастание фиолетовой). */
  private converge(state: RevealState, slot: CardSlot, col: number, ms: number): void {
    for (let k = 0; k < 18; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 280 + Math.random() * 200;
      const s = this.add.image(slot.x + Math.cos(a) * d, slot.y + Math.sin(a) * d, SPARK).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setScale(0.7).setAlpha(0);
      state.layer.add(s);
      this.tweens.add({ targets: s, x: slot.x, y: slot.y, alpha: { from: 0, to: 1 }, duration: ms * (0.6 + Math.random() * 0.4), delay: Math.random() * ms * 0.3, ease: 'Quad.easeIn', onComplete: () => s.destroy() });
    }
  }

  /** Крупный показ фиолетовой (и выше) карты серии: луч, большая карта, имя; нажатие — дальше. */
  private showcaseCard(state: RevealState, cv: CardView): Promise<void> {
    const r = state.results[cv.i];
    const hero = session.save.heroes.find((h) => h.id === r.heroId);
    if (!hero) return Promise.resolve();
    const prev = state.phase;
    state.phase = 'showcase';
    const def = rarityDef(GAME, r.rarity);
    const col = colorOf(def.color);
    const box = this.add.container(0, 0).setDepth(DEPTH + 100).setName('showcase');
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x000000, 0.78).setInteractive();
    const beam = this.add.image(GAME_W / 2, 1300, BEAM).setOrigin(0.5, 1).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(620, 1500).setAlpha(0.8);
    const halo = this.add.image(GAME_W / 2, 900, GLOW).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(1100, 1100).setAlpha(0.7);
    const ring = this.add.container(GAME_W / 2, 1180).setScale(1.3, 0.45);
    const circle = this.add.image(0, 0, CIRCLE).setTint(col).setAlpha(0.8).setBlendMode(Phaser.BlendModes.ADD);
    ring.add(circle);
    const face = summonFace(this, GAME_W / 2, 880, 440, 620, hero, true);
    const jobLine = text(this, GAME_W / 2, 530, `${heroCard(hero, GAME).jobName} · ${def.name}`, FS.h3, def.color, { fontStyle: 'bold', ...OUTLINE });
    const kind = RARITY_CARD[r.rarity];
    const head = text(this, GAME_W / 2, 440, `${kind.charAt(0).toUpperCase()}${kind.slice(1)} карта!`, FS.hero, def.color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 10 });
    const branchNote = needsBranch(hero, GAME) ? ' · ветку выберете на карточке' : '';
    const tag = state.bigTags[cv.i];
    const fresh = tag.kind === 'new';
    const sub = text(this, GAME_W / 2, 1300, `${tag.text}${branchNote}`, fresh && !branchNote ? FS.h2 : FS.h3, fresh ? C.gold : C.dim, { fontStyle: 'bold', ...OUTLINE, wordWrap: { width: 1000 } });
    const hint = text(this, GAME_W / 2, 1420, 'Нажмите, чтобы продолжить', FS.small, C.muted, OUTLINE);
    box.add([shade, beam, halo, ring, face, jobLine, head, sub, hint]);
    this.tweens.add({ targets: circle, angle: 360, duration: 9000, repeat: -1 });
    this.tweens.add({ targets: halo, alpha: { from: 0.8, to: 0.45 }, duration: 800, yoyo: true, repeat: -1 });
    face.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: face, scale: 1, alpha: 1, duration: 380, ease: 'Back.easeOut' });
    head.setScale(1.6).setAlpha(0);
    this.tweens.add({ targets: head, scale: 1, alpha: 1, duration: 320, delay: 120, ease: 'Back.easeOut' });
    return new Promise((resolve) => {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        this.tweens.add({
          targets: box,
          alpha: 0,
          duration: 200,
          onComplete: () => {
            box.destroy();
            if (state.phase === 'showcase') state.phase = prev;
            resolve();
            this.checkDone(state);
          },
        });
      };
      // Касание — дальше (не раньше чем через 0,4 с, чтобы не пролистнуть случайно).
      this.time.delayedCall(400, () => shade.once('pointerup', close));
      this.time.delayedCall(3200, close);
    });
  }

  /** «Открыть все»: простые карты быстро по очереди, самая редкая — последней, с нарастанием. */
  private openAll(state: RevealState): void {
    if (state.phase !== 'pick') return;
    state.phase = 'flipping';
    for (const o of state.ui) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    const pending = revealOrder(state.results).filter((i) => !state.cards[i].flipped && !state.cards[i].busy);
    const sched = revealSchedule(pending.map((i) => state.results[i]));
    const flips: Promise<void>[] = [];
    let chain = Promise.resolve();
    for (const s of sched) {
      const cv = state.cards[pending[s.index]];
      const p = new Promise<void>((res) => this.time.delayedCall(s.at, () => res()));
      // Нарастание ждёт, пока откроются предыдущие.
      chain = s.tension ? chain.then(() => p).then(() => this.flip(state, cv, 'tension')) : chain;
      if (!s.tension) flips.push(p.then(() => this.flip(state, cv, 'quick')));
    }
    void Promise.all([...flips, chain]).then(() => {
      if (this.reveal === state && state.phase === 'flipping') state.phase = 'pick';
      this.checkDone(state);
    });
  }

  /** «Пропустить»: все карты сразу лицом вверх, без эффектов. */
  private skip(state: RevealState): void {
    if (state.phase === 'done') return;
    this.tweens.killTweensOf(state.cards.map((c) => c.root));
    for (const cv of state.cards) {
      cv.root.setPosition(cv.slot.x, cv.slot.y).setScale(1).setAngle(0).setAlpha(1);
      if (!cv.flipped) this.showFace(state, cv, false);
    }
    const best = bestResult(state.results);
    if (best) sfx(SUMMON_REVEAL[SOUND_RARITY[best.rarity]]);
    this.finish(state);
  }

  private checkDone(state: RevealState): void {
    if (this.reveal !== state || state.phase === 'done' || state.phase === 'showcase') return;
    if (state.cards.length && state.cards.every((c) => c.flipped && !c.busy)) this.time.delayedCall(250, () => this.finish(state));
  }

  /** Итог: строка по редкостям, осколки, «К героям» / «Ещё ×10» / «Готово». */
  private finish(state: RevealState): void {
    if (this.reveal !== state || state.phase === 'done') return;
    state.phase = 'done';
    for (const o of state.ui) o.destroy();
    state.ui = [];
    const L = state.layer;
    state.title.setText('Итог призыва');
    L.add(ellipsize(text(this, GAME_W / 2, 310, summaryLine(state.results), FS.body, C.text, { fontStyle: 'bold', ...OUTLINE }), 1000).setName('summaryLine'));
    const hasDup = state.tags.some((t) => t.kind === 'copy');
    L.add(text(this, GAME_W / 2, 1480, hasDup ? 'Копии — корм для вознесения (все карты — в Инвентаре). Нажмите на карту — откроется герой.' : 'Нажмите на карту — откроется герой.', FS.small, C.muted, { ...OUTLINE, wordWrap: { width: 980 } }));

    const best = bestResult(state.results);
    const st = summonStatus(session.save, today(), GAME);
    const again = againOption(st);
    const y = 1640;
    const toHeroes = button(this, 200, y, 320, 130, 'ui_btn_secondary', 'К героям', () => (best ? this.scene.start('Hero', { heroId: best.heroId }) : this.scene.start('Heroes')), FS.h3);
    const more = button(this, 540, y, 320, 130, 'ui_btn_primary', 'Ещё ×10', () => {
      if (!again) {
        toast(this, `Нужно ${st.costs.ten} гемов (есть ${formatNumber(st.gems)}) или 10 свитков`, C.error);
        return;
      }
      this.reveal = null;
      this.pull(again);
    }, FS.h3);
    if (!again) more.setEnabled(false);
    // {} обязательно: без данных Phaser перезапускает сцену с прошлыми (reveal) и показ повторяется.
    const done = button(this, 880, y, 320, 130, 'ui_btn_secondary', 'Готово', () => this.scene.restart({} satisfies TavernData), FS.h3);
    L.add([toHeroes.container, more.container, done.container]);
    if (again) {
      const price = again.pay === 'scroll' ? '10 свитков' : `${st.costs.ten} гемов`;
      L.add(text(this, 540, y + 95, price, FS.caption, C.gem, OUTLINE));
    }
  }
}
