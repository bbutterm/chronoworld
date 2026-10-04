import Phaser from 'phaser';
import { veteranSkillTiles, skillTileStatus, type SkillTile } from '../heroSkillTiles';
import { heroFooterLayout } from '../runtimeUiLayout';
import { hintDone, markHint } from '../hints';
import {
  actEquipBest,
  actLevelUp,
  actRefineAll,
  lockedText,
  refineAllPlan,
  refineConfig,
  refinedName,
  refinedStats,
  refineLevel,
  refineUnlocked,
  ascendRequirement,
  branchStatus,
  changeBranch,
  chooseBranch,
  gearUpgrades,
  heroCard,
  heroGearStats,
  heroPower,
  heroSkillList,
  heroSlots,
  heroTemplate,
  jobTitle,
  levelUpInfo,
  markHeroSeen,
  rarityDef,
  setHeroLocked,
  SLOTS,
  type HeroCard,
  type HeroState,
  type LevelUpInfo,
  type Slot,
  type Stats,
  bondView,
} from '../../core';
import { CONTENT, GAME, LORE } from '../content';
import { ascendReady, formatNumber, heroSprite, itemStatsText, levelText, RARITY_COLORS, ROLE_NAMES, SLOT_NAMES, STAT_KEYS, STAT_LABELS } from '../flow';
import { GAME_W } from '../layout';
import { confirm, CONTENT_TOP, contentBottom, screen, unitFigure } from '../screen';
import { commit, session, today } from '../session';
import { BTN, button, chip, ellipsize, plate, pressable, ScrollArea, SURFACE, tag, text, toast, tutorialHint, type ButtonView } from '../ui';
import { C, COLOR, COLOR_N, E, FAMILY, M, R, S, T, TOUCH } from '../theme';
import { skillIcon } from '../skillIcons';
import { sfx } from '../audio';
import { haptic } from '../haptics';
import { bump, burst, countUp, juiceOn, pulse } from '../juice';
import { skinIcon } from '../skin';
import { glowTexture, GUILD_NAMES, rarityPalette, rarityPips } from '../heroCard';
import { browseNeighbours, copyCounter, heroesUi, inventoryUi, nextLevelDelta, copySources, skillRarityGate } from '../heroesView';
import { openBranchPicker } from '../branchPicker';
import { openSkillDetail } from '../skillDetail';
import { gemIcon } from '../screen';
import { roIconImage } from '../itemIcons';
import { chargeBreakBadge, ultBreaksCharge } from '../ultBadge';
import { linkText, startTavernEvening } from './TavernEveningScene';
import { hasHeroStory, heroStoryNew, heroStoryProgress, openHeroStory, toastOpenedStories } from '../heroStoryView';

/** Редкость в родительном падеже: «растёт до красного». */
const RARITY_GEN: Record<string, string> = { green: 'зелёного', blue: 'синего', purple: 'фиолетового', gold: 'золотого', red: 'красного' };
type Tab = 'skills' | 'gear' | 'story';

/** Экран, куда возвращает «‹ Назад» карточки героя (Инвентарь → «Карты героев», итоги Таверны…). */
export interface HeroBack {
  to: string;
  data?: object;
}

export interface HeroData {
  heroId: string;
  tab?: Tab;
  back?: HeroBack;
}
const TABS: { id: Tab; label: string }[] = [
  { id: 'skills', label: 'Навыки' },
  { id: 'gear', label: 'Снаряжение' },
  { id: 'story', label: 'История' },
];

/** Геометрия экрана (игровые единицы): витрина → статы → вкладки с прокруткой; «Улучшить» закреплено над навигацией. */
const TOP = CONTENT_TOP;
const CONTENT_W = GAME_W - 2 * S.l;
const SHOW_H = 660;
const SHOW_Y = TOP + SHOW_H / 2;
const FIG_X = GAME_W / 2;
const FEET_Y = TOP + 506;
/** Нижний ряд витрины: «Вознести» и копии. */
const BOTTOM_ROW_Y = TOP + SHOW_H - 58;
const COL_X = 48;
const COL_R = GAME_W - S.l - S.xs;
const STATS_H = 152;
const STATS_Y = TOP + SHOW_H + S.xs + STATS_H / 2;
const ACT_H = 184;

const TABS_Y = STATS_Y + STATS_H / 2 + S.s + 44;
const TAB_TOP = TABS_Y + 44 + S.xs;
/** Главная кнопка «Улучшить» / «Вознести» — справа в блоке действий. */
const UP_W = 400;
const UP_X = GAME_W - S.l - S.s - UP_W / 2;
/** Левый край содержимого блока действий. */
const ACT_L = S.l + S.s;

/** Плитки навыков: две читаемые карточки в ряд. */
const SK_COLS = 2;
const SK_BOX = 136;
const SK_ROW = 280;
/** Высота слота снаряжения. */
const GEAR_H = 160;

interface Snapshot {
  power: number;
  stats: Stats;
  level: number;
}

/**
 * H4 «Герой» — карточка как в AFK Arena: витрина цвета редкости, герой в стойке крупно, имя заголовочной гарнитурой,
 * редкость (ромбы), класс и роль, мощь крупно, уровень с полосой; статы с прибавкой за следующий уровень; одна главная
 * кнопка — «Улучшить» (чипы цены, нехватка красным чипом; удержание — повтор; «+N ур.» — сразу до предела запаса)
 * или «Вознести» на пределе; вкладки (segmented) «Навыки» (плитки, подробности — лист снизу; ветка второй профессии),
 * «Снаряжение» (сетка слотов), «История». Замок, листание ‹ › и свайпом по витрине.
 */
export class HeroScene extends Phaser.Scene {
  constructor() {
    super('Hero');
  }

  private get footer() { return heroFooterLayout(contentBottom()); }

  private heroId = '';
  private tab: Tab = 'skills';
  /** Куда ведёт «‹ Назад» (по умолчанию — список «Герои»). */
  private back?: HeroBack;
  /** Счётчик плиток навыков (имена skillRow_N для e2e и скриншотов). */
  private skillRows = 0;
  private tabArea!: ScrollArea;
  private figure: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | null = null;
  private ui!: {
    level: Phaser.GameObjects.Text;
    levelBar: Phaser.GameObjects.Rectangle;
    levelBarW: number;
    power: Phaser.GameObjects.Text;
    stats: Phaser.GameObjects.Text[];
    deltas: Phaser.GameObjects.Text[];
    /** Цена, нехватка, «+N ур.» — перестраиваются после каждого уровня. */
    info: Phaser.GameObjects.Container;
    up?: ButtonView;
    upGlow?: Phaser.GameObjects.Image;
  };
  private holdTimer?: Phaser.Time.TimerEvent;
  private repeatTimer?: Phaser.Time.TimerEvent;
  private holdFired = false;
  private holdCount = 0;

  create(data: HeroData): void {
    this.heroId = data.heroId;
    this.back = data.back;
    this.figure = null;
    this.holdTimer = this.repeatTimer = undefined;
    this.holdFired = false;
    let hero = this.hero();
    if (hero?.isNew) {
      commit(markHeroSeen(session.save, hero.id));
      hero = this.hero();
    }
    const c = hero && GAME.content.heroes[hero.templateId] ? heroCard(hero, GAME) : undefined;
    // Шапка — название места («Герой»), имя крупно на витрине (без дублирования).
    screen(this, c?.gender === 'f' ? 'Героиня' : 'Герой', 'Heroes', this.back ?? { to: 'Heroes' });
    if (!hero || !c) return;
    const ups = gearUpgrades(session.save, hero.id, GAME);
    this.tab = data.tab ?? heroesUi.tab ?? (ups.length && !hintDone('equip_gear') ? 'gear' : 'skills');

    this.add.rectangle(GAME_W / 2, (CONTENT_TOP + contentBottom()) / 2, GAME_W, contentBottom() - CONTENT_TOP, COLOR_N.surface);
    this.showcase(hero, c);
    this.statsStrip();
    this.actions(hero);
    this.tabs();
    this.renderDynamic(null);
    this.renderTab();

    const stop = () => this.stopHold();
    this.input.on('pointerup', stop);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointerup', stop);
      this.stopHold();
    });
  }

  /** Перезапуск карточки (вкладка, соседний герой, после действия) — «Назад» ведёт туда же, откуда пришли (MT-04). */
  private reopen(data: Omit<HeroData, 'back'>): void {
    this.scene.restart({ ...data, back: this.back });
  }

  private hero(): HeroState | undefined {
    return session.save.heroes.find((h) => h.id === this.heroId);
  }

  private snapshot(hero: HeroState): Snapshot {
    const gear = heroGearStats(session.save, hero.id, GAME);
    const base = heroCard(hero, GAME).stats;
    return {
      power: heroPower(hero, GAME, session.save),
      stats: { ...base, hp: base.hp + gear.hp, atk: base.atk + gear.atk, def: base.def + gear.def, spd: base.spd + gear.spd },
      level: hero.level,
    };
  }

  // ---------- витрина ----------

  private showcase(hero: HeroState, c: HeroCard): void {
    const pal = rarityPalette(hero.rarity);
    this.add.ellipse(FIG_X, FEET_Y + 4, 260, 42, 0x000000, 0.24);
    unitFigure(this, heroSprite(hero, GAME), FIG_X, FEET_Y, 390, {
      maxScale: 3.4,
      onReady: (o) => { this.figure = o; },
    });
    this.swipeBrowse(hero);

    const colW = COL_R - COL_X;
    const name = text(this, COL_X, TOP + 48, c.name, T.title, COLOR.textPrimary, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5).setName('heroName');
    ellipsize(name, colW - 140);
    ellipsize(text(this, COL_X, TOP + 108, `${c.jobName} · ${ROLE_NAMES[c.role] ?? ''}`, T.caption, COLOR.textSecondary).setOrigin(0, 0.5), colW - 140);
    const rl = text(this, COL_X, TOP + 166, c.rarity.name, T.caption, COLOR.textPrimary).setOrigin(0, 0.5).setName('heroRarity');
    rarityPips(this, COL_X + rl.width + 88, TOP + 166, heroTemplate(GAME, hero.templateId), hero.rarity, 12);
    // The real four equipment slots flank the animated figure; inventory retains all actions.
    const slots = heroSlots(session.save, hero.id, GAME);
    SLOTS.forEach((slot, i) => {
      const x = i % 2 === 0 ? 164 : 916;
      const y = TOP + 282 + Math.floor(i / 2) * 166;
      const item = slots[slot];
      const slotView = plate(this, x, y, 152, 148, { ...SURFACE.raised, border: item ? RARITY_COLORS[item.def.rarity] : COLOR.border, borderW: 2, r: R.m });
      slotView.setName(`heroEquip_${slot}`);
      pressable(this, slotView, 152, 148, () => this.scene.start('Inventory', { heroId: hero.id, slot, heroBack: this.back }));
      if (item) {
        roIconImage(this, x, y - 18, item.instance.itemId, 76);
        text(this, x, y + 47, `+${refineLevel(item.instance)}`, T.caption, COLOR.title);
      } else ellipsize(text(this, x, y, SLOT_NAMES[slot], T.caption, COLOR.textSecondary), 140);
    });
    const level = text(this, FIG_X, TOP + 548, '', T.body, COLOR.title, { fontStyle: 'bold' }).setName('heroLevel');
    const levelBar = this.add.rectangle(FIG_X - 150, TOP + 579, 0, 4, pal.tint).setOrigin(0, 0.5);
    const power = text(this, 870, BOTTOM_ROW_Y, '', T.body, COLOR.textPrimary, { fontStyle: 'bold' }).setName('heroPower');
    text(this, 650, BOTTOM_ROW_Y, 'Мощь', T.caption, COLOR.textSecondary);
    this.ui = { level, levelBar, levelBarW: 300, power, stats: [], deltas: [], info: this.add.container(0, 0) };

    // Низ витрины: «Вознести» (вторичная, пока главная — «Улучшить») с меткой «копии к вознесению» и чип копий —
    // есть копии, он открывает их картами (Инвентарь → «Карты героев»).
    const cx = S.l + S.s;
    const small = !!levelUpInfo(session.save, hero.id, GAME).cost && !!ascendRequirement(session.save, hero.id, GAME);
    if (small) this.ascendSmall(hero, cx);
    const cc = copyCounter(session.save, hero.id, GAME);
    // Рядом с «Вознести» места нет (полоса уровня) — копии видно на экране вознесения; здесь чип — когда её нет.
    if (cc.text && !small) {
      const more = cc.others > 0;
      const box = chip(this, cx, BOTTOM_ROW_Y, null, `Копии: ${cc.others}${more ? ' ›' : ''}`, 'neutral', { size: 's', align: 'left' }).setName('copyCounter').setDepth(5);
      if (more) {
        pressable(this, box, Math.max(box.width, TOUCH), TOUCH, () => {
          inventoryUi.tab = 'cards';
          inventoryUi.rarity = null;
          inventoryUi.template = hero.templateId;
          this.scene.start('Inventory', {});
        });
      }
    }
    // Замок (не уйдёт в корм) — левый верхний угол витрины. Копией бывает любой герой, сюжетный тоже.
    {
      const lock = button(this, GAME_W - 96, TOP + 64, BTN.icon, BTN.icon, '', '', () => this.toggleLock(), T.caption, { sound: 'ui_toggle', variant: 'icon' });
      lock.container.add(this.add.image(0, -2, skinIcon('lock')).setDisplaySize(56, 56).setTint(c.locked ? COLOR_N.gold : COLOR_N.textTertiary));
      lock.container.setName('lockBtn');
    }
    // Листание ‹ › по списку «Героев» (и свайпом по витрине).
    const nb = this.neighbours(hero);
    const nav = { prevX: 360, nextX: 720, y: TOP + 410, w: 132, h: 132 };
    const arrow = (x: number, id: string | null, ico: 'back' | 'next', name: string) => {
      if (!id) return;
      const b = button(this, x, nav.y, nav.w, nav.h, '', '', () => this.reopen({ heroId: id, tab: this.tab }), T.caption, { sound: 'ui_tab', variant: 'icon' });
      b.container.add(this.add.image(0, 0, skinIcon(ico)).setDisplaySize(48, 48).setTint(COLOR_N.title));
      b.container.setName(name).setAlpha(0.9);
    };
    arrow(nav.prevX, nb.prev, 'back', 'prevHero');
    arrow(nav.nextX, nb.next, 'next', 'nextHero');
  }

  private neighbours(hero: HeroState): { prev: string | null; next: string | null } {
    const order = heroesUi.order.length ? heroesUi.order : session.save.heroes.map((h) => h.id);
    return browseNeighbours(order, hero.id, (id) => session.save.heroes.some((h) => h.id === id));
  }

  /** Свайп по витрине влево/вправо — соседний герой (кнопки поверх зоны получают нажатие первыми). */
  private swipeBrowse(hero: HeroState): void {
    const nb = this.neighbours(hero);
    if (!nb.prev && !nb.next) return;
    const zone = this.add.zone(GAME_W / 2, SHOW_Y, GAME_W, SHOW_H).setInteractive();
    let from: number | null = null;
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => (from = p.worldX));
    const up = (p: Phaser.Input.Pointer) => {
      if (from === null) return;
      const dx = p.worldX - from;
      from = null;
      const id = dx > 140 ? nb.prev : dx < -140 ? nb.next : null;
      if (!id) return;
      sfx('ui_tab');
      haptic('tab');
      this.reopen({ heroId: id, tab: this.tab });
    };
    this.input.on('pointerup', up);
    zone.once(Phaser.GameObjects.Events.DESTROY, () => this.input.off('pointerup', up));
  }

  /** Превью обеих веток (до фиолетового). */
  private previewBranches(hero: HeroState, c: HeroCard): void {
    const rn = GAME.cards.rarities.find((r) => r.id === (c.branchAt ?? 'purple'))?.name ?? 'Фиолетовый';
    openBranchPicker(this, {
      templateId: hero.templateId,
      title: `${c.name}: ветки второй профессии`,
      subtitle: `Выбор — при вознесении в «${rn}». Первая смена ветки — бесплатно.`,
      viewOnly: true,
    });
  }

  /** «Выбрать ветку» (бесплатно) или «Сменить ветку» (первая смена бесплатно, дальше гемы). */
  private pickBranch(hero: HeroState, c: HeroCard): void {
    const st = branchStatus(session.save, hero.id, GAME);
    const jobName = (job: string) => jobTitle(GAME, job, c.gender);
    const change = st.canChange;
    const other = change ? c.branches.find((b) => b.job !== st.branch)?.job : undefined;
    const gems = session.save.currency.gems;
    openBranchPicker(this, {
      templateId: hero.templateId,
      title: change ? 'Сменить ветку' : 'Выберите ветку',
      subtitle: change
        ? `Уровень и герой сохранятся; неподходящие вещи вернутся в инвентарь.${st.changeFree ? ' Первая смена — бесплатно.' : ''}`
        : 'Выбор бесплатный; первая смена потом — тоже.',
      ...(st.branch ? { current: st.branch } : {}),
      ...(other ? { selected: other } : {}),
      heroId: hero.id,
      save: session.save,
      // LT-16: гемов на смену не хватает — кнопка серая, причина над ней.
      blocked: () => (change && !st.changeFree && gems < st.changeCost ? `Не хватает ${formatNumber(st.changeCost - gems)} гемов` : null),
      confirmLabel: (job) => (!job ? 'Выберите ветку' : change ? (st.changeFree ? `Сменить: ${jobName(job)}` : `Сменить за ${formatNumber(st.changeCost)} гемов`) : `Выбрать: ${jobName(job)}`),
      onConfirm: (job) => {
        try {
          const saveBefore = session.save;
          const r = change ? changeBranch(session.save, hero.id, job, GAME) : chooseBranch(session.save, hero.id, job, GAME);
          const spent = 'gems' in r ? (r.gems as number) : 0;
          commit(r.save);
          sfx('job_change');
          haptic('levelUp');
          this.reopen({ heroId: hero.id, tab: this.tab });
          const sc = this.scene.get('Hero');
          sc.events.once(Phaser.Scenes.Events.CREATE, () => {
            toast(sc, `${c.name} — теперь ${jobName(job)}!${spent ? ` (−${formatNumber(spent)} гемов)` : ''}`, C.success, 3000);
            // Ветка с уровнем 60+ сразу открывает свои кусочки истории (heroStories: кусочки по ветке).
            sc.time.delayedCall(1600, () => toastOpenedStories(sc, saveBefore, r.save, hero.templateId));
          });
        } catch (e) {
          toast(this, e instanceof Error ? e.message : String(e), C.error, 3000);
        }
      },
    });
  }

  private toggleLock(): void {
    const hero = this.hero();
    if (!hero) return;
    commit(setHeroLocked(session.save, hero.id, !hero.locked));
    toast(this, hero.locked ? 'Замок снят — карточку можно отдать в корм' : 'Закреплено — не уйдёт в корм', C.success, 2500);
    this.reopen({ heroId: hero.id, tab: this.tab });
  }

  // ---------- статы ----------

  /** Четыре стата одной полосой: подпись, значение (голубое — с прибавкой снаряжения) и «+N» за следующий уровень. */
  private statsStrip(): void {
    plate(this, GAME_W / 2, STATS_Y, CONTENT_W, STATS_H, { ...SURFACE.surface, r: R.l });
    const colW = CONTENT_W / STAT_KEYS.length;
    STAT_KEYS.forEach((k, i) => {
      const cx = S.l + colW * (i + 0.5);
      text(this, cx, STATS_Y - 46, ({ hp: 'Здоровье', atk: 'Атака', def: 'Защита', spd: 'Скорость' }[k] ?? STAT_LABELS[k]), T.caption, COLOR.textSecondary);
      this.ui.stats.push(text(this, cx, STATS_Y, '', T.heading, COLOR.textPrimary, { fontStyle: 'bold' }).setName(`stat_${k}`));
      this.ui.deltas.push(text(this, cx, STATS_Y + 48, '', T.caption, COLOR.positive, { fontStyle: 'bold' }).setOrigin(0, 0.5));
    });
  }

  /** Значение и «+N» парой по центру колонки. */
  private placeStat(i: number): void {
    const colW = CONTENT_W / STAT_KEYS.length;
    const cx = S.l + colW * (i + 0.5);
    const v = this.ui.stats[i];
    const d = this.ui.deltas[i];
    v.setOrigin(0.5, 0.5).setX(cx);
    d.setOrigin(0.5, 0.5).setX(cx);

  }

  // ---------- «Улучшить» / «Вознести» ----------

  /**
   * Блок действий. Есть цена уровня — главная «Улучшить» справа, слева чипы цены, ниже — «Вознести» (вторичная, светится,
   * когда копии готовы) и нехватка красным чипом или «+N ур.». Предел редкости — главная «Вознести», слева — чего она
   * просит (копии, золото). Всё на максимуме — тег.
   */
  private actions(hero: HeroState): void {
    plate(this, GAME_W / 2, this.footer.actionY, CONTENT_W, ACT_H, { ...SURFACE.surface, r: R.l });
    const info = levelUpInfo(session.save, hero.id, GAME);
    const req = ascendRequirement(session.save, hero.id, GAME);
    const canAscend = ascendReady(session.save, GAME).some((h) => h.id === hero.id);
    const glow = this.add.image(UP_X, this.footer.actionY, glowTexture(this)).setDisplaySize(UP_W + 160, 240).setTint(COLOR_N.accent).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    if (info.cost) {
      const up = button(this, UP_X, this.footer.actionY, UP_W, 132, '', 'Улучшить', () => {
        if (this.holdFired) {
          this.holdFired = false;
          return;
        }
        this.levelOnce(false);
      }, T.title, { sound: null, variant: 'primary' });
      up.label.setFontFamily(FAMILY.heading);
      up.container.setName('levelUpBtn');
      up.container.on('pointerdown', () => {
        this.holdFired = false;
        this.holdCount = 0;
        this.holdTimer?.remove();
        this.holdTimer = this.time.delayedCall(420, () => this.startRepeat());
      });
      up.container.on('pointerout', () => this.stopHold());
      this.ui.up = up;
      this.ui.upGlow = glow;
      if (juiceOn()) this.tweens.add({ targets: glow, scale: glow.scale * 1.08, duration: M.emphasis * 1.4, yoyo: true, repeat: -1, ease: E.inOut });
      if (info.canLevel && !hintDone('level_up')) tutorialHint(this, 'level_up', UP_X, this.footer.actionY, 'above', { w: UP_W, h: 132 });
    } else if (req) {
      const hint = canAscend;
      glow.setAlpha(hint ? 0.7 : 0);
      if (hint && juiceOn()) this.tweens.add({ targets: glow, alpha: 0.3, duration: M.emphasis * 1.4, yoyo: true, repeat: -1 });
      const asc = button(this, UP_X, this.footer.actionY, UP_W, 132, '', 'Вознести', () => this.openAscend(), T.title, { variant: canAscend ? 'primary' : 'secondary' });
      asc.label.setFontFamily(FAMILY.heading);
      asc.container.setName('ascendBtn');
      if (canAscend) pulse(this, asc.container, 1.04);
    } else {
      tag(this, GAME_W / 2, this.footer.actionY, 'Максимальная редкость и уровень', 'gold');
    }
  }

  /**
   * Компактная «Вознести» внизу витрины (пока главная — «Улучшить»): вторичная; копии готовы — светится и пульсирует.
   * Метка «0/2» — копии к вознесению. Возвращает правый край.
   */
  private ascendSmall(hero: HeroState, left: number): number {
    const canAscend = ascendReady(session.save, GAME).some((h) => h.id === hero.id);
    const w = 320;
    const ax = left + w / 2;
    const ay = BOTTOM_ROW_Y;
    if (canAscend) this.add.image(ax, ay, glowTexture(this)).setDisplaySize(w + 160, 170).setTint(COLOR_N.accent).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5).setDepth(4);
    const asc = button(this, ax, ay, w, 84, '', 'Вознести', () => this.openAscend(), T.body, { variant: 'secondary' });
    asc.container.setName('ascendBtn').setDepth(5);
    const right = left + w;
    const cc = copyCounter(session.save, hero.id, GAME);
    if (cc.need !== undefined) {
      const ready = (cc.have ?? 0) >= cc.need;
      const t = tag(this, 0, 0, `${cc.have ?? 0}/${cc.need}`, ready ? 'positive' : 'neutral', { solid: ready });
      t.setScale(0.86).setPosition(w / 2 - S.xs - (t.width * 0.86) / 2, 0);
      asc.container.add(t);
      // Подпись — по центру места слева от метки.
      asc.label.setX((-w / 2 + S.xs + t.x - (t.width * 0.86) / 2 - S.xxs) / 2);
    }
    if (canAscend) {
      asc.label.setColor(COLOR.title);
      pulse(this, asc.container, 1.05);
      // Обучение (шаг ascend): «Улучшить» уже показано — теперь «Вознести».
      if (!hintDone('ascend') && hintDone('level_up')) tutorialHint(this, 'ascend', ax, ay, 'above', { w, h: 84 });
    }
    return right;
  }

  private openAscend(): void {
    this.scene.start('Ascend', { heroId: this.heroId });
  }

  /**
   * Чипы слева от главной кнопки: цена уровня (опыт, золото; чего не хватает — красным) и под ними нехватка
   * («ещё 9 200») или «+N ур.»; на пределе — что просит вознесение (копии, золото).
   */
  private renderInfo(hero: HeroState): void {
    this.ui.info.destroy();
    const box = this.add.container(0, 0);
    this.ui.info = box;
    const info = levelUpInfo(session.save, hero.id, GAME);
    const req = ascendRequirement(session.save, hero.id, GAME);
    const rowY = this.footer.actionY - 42;
    const row = (items: Phaser.GameObjects.Container[], y: number, x0: number) => {
      let x = x0;
      for (const it of items) {
        it.setPosition(x + it.width / 2, y);
        x += it.width + S.xs;
        box.add(it);
      }
      return x;
    };
    if (info.cost) {
      const shortExp = info.blocker === 'not_enough_exp';
      const shortGold = info.blocker === 'not_enough_gold';
      row(
        [
          chip(this, 0, 0, 'hero_exp', info.cost.exp, shortExp ? 'negative' : 'neutral', { size: 's' }).setName('costExp'),
          chip(this, 0, 0, 'gold', info.cost.gold, shortGold ? 'negative' : 'neutral', { size: 's' }).setName('costGold'),
        ],
        rowY,
        ACT_L,
      );
      // Вторая строка: справа от «Вознести» (если она есть) — нехватка или «+N ур.».
      const x2 = ACT_L;
      const y2 = this.footer.actionY + 42;
      if (!info.canLevel && (shortExp || shortGold)) {
        const lack = shortExp ? info.cost.exp - info.pool : info.cost.gold - info.gold;
        row([chip(this, 0, 0, shortExp ? 'hero_exp' : 'gold', `ещё ${formatNumber(lack)}`, 'negative', { size: 's' }).setName('levelShort')], y2, x2);
      } else if (info.affordable >= 2) {
        const n = Math.min(info.affordable, info.maxLevel - info.level);
        const many = button(this, x2 + 110, y2, 220, BTN.m, '', `+${n} ур.`, () => this.levelMany(n), T.heading, { variant: 'secondary', sound: null });
        many.container.setName('levelManyBtn');
        box.add(many.container);
      }
      return;
    }
    if (req) {
      // Предел редкости: что просит вознесение — копии и золото (не хватает — красным).
      const cc = copyCounter(session.save, hero.id, GAME);
      const items: Phaser.GameObjects.Container[] = [];
      if (cc.need !== undefined) items.push(chip(this, 0, 0, null, `Копии ${cc.have ?? 0}/${cc.need}`, (cc.have ?? 0) >= cc.need ? 'positive' : 'negative', { size: 's' }).setName('ascendCopies'));
      if (req.gold) items.push(chip(this, 0, 0, 'gold', req.gold, session.save.resources.gold >= req.gold ? 'neutral' : 'negative', { size: 's' }).setName('ascendGold'));
      row([tag(this, 0, 0, 'Предел уровня', 'warning')], rowY, ACT_L);
      row(items, this.footer.actionY + 42, ACT_L);
    }
  }

  // ---------- обновление без перезапуска (удержание «Улучшить») ----------

  private renderDynamic(prev: Snapshot | null): void {
    const hero = this.hero();
    if (!hero) return;
    const now = this.snapshot(hero);
    const info = levelUpInfo(session.save, hero.id, GAME);
    this.ui.level.setText(levelText(hero.level, info.maxLevel));
    if (prev && hero.level > prev.level) bump(this, this.ui.level, 1.18);
    const target = this.ui.levelBarW * (hero.level / info.maxLevel);
    if (prev && juiceOn()) this.tweens.add({ targets: this.ui.levelBar, width: target, duration: M.base, ease: E.out });
    else this.ui.levelBar.width = target;
    countUp(this, this.ui.power, prev?.power ?? now.power, now.power, formatNumber, { duration: M.emphasis });
    if (prev && now.power > prev.power) {
      this.floatUp(COL_X + Math.max(this.ui.power.width, 160) + S.xs, TOP + 384, `+${formatNumber(now.power - prev.power)}`);
      bump(this, this.ui.power, 1.08);
    }
    const gear = heroGearStats(session.save, hero.id, GAME);
    const delta = info.canLevel ? nextLevelDelta(hero, GAME) : null;
    STAT_KEYS.forEach((k, i) => {
      const t = this.ui.stats[i];
      t.setColor(gear[k] ? COLOR.info : COLOR.textPrimary);
      const d = delta?.[k] ?? 0;
      this.ui.deltas[i].setText(d > 0 ? `+${formatNumber(d)}` : '');
      countUp(this, t, prev?.stats[k] ?? now.stats[k], now.stats[k], formatNumber, { duration: M.slow, onDone: () => t.scene && this.placeStat(i) });
      this.placeStat(i);
      if (prev && now.stats[k] > prev.stats[k]) bump(this, t, 1.12);
    });
    if (this.ui.up) {
      this.ui.up.setEnabled(info.canLevel);
      this.ui.upGlow?.setAlpha(info.canLevel ? 0.55 : 0);
    }
    this.renderInfo(hero);
    this.updateGoldPill();
  }

  /** «+123» всплывает и тает. */
  private floatUp(x: number, y: number, s: string, color: string = COLOR.positive): void {
    const t = text(this, x, y, s, T.heading, color, { fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(500);
    onArt(t);
    if (!juiceOn()) {
      this.time.delayedCall(900, () => t.destroy());
      return;
    }
    this.tweens.add({ targets: t, y: y - 60, alpha: 0, duration: M.count, ease: E.out, onComplete: () => t.destroy() });
  }

  /** Золото в шапке тратится на уровни — число «таблетки» обновляем на месте (screen.ts называет её pill_gold). */
  private updateGoldPill(): void {
    const pill = this.children.getByName('pill_gold') as Phaser.GameObjects.Container | null;
    const t = pill?.list.find((o) => o.type === 'Text') as Phaser.GameObjects.Text | undefined;
    t?.setText(formatNumber(session.save.resources.gold));
  }

  /** Один уровень. hold — повтор при удержании (без тостов об ошибке). true — уровень поднят. */
  private levelOnce(hold: boolean): boolean {
    return this.levelUp(1, hold);
  }

  /** «+N ур.»: сразу n уровней (сколько хватает запаса), одна большая вспышка. */
  private levelMany(n: number): void {
    this.stopHold();
    this.levelUp(n, false);
  }

  private levelUp(times: number, hold: boolean): boolean {
    const hero = this.hero();
    if (!hero) return false;
    const info = levelUpInfo(session.save, hero.id, GAME);
    if (!info.canLevel) {
      if (!hold) {
        sfx('ui_error');
        toast(this, shortageToast(info), C.error, 2500);
        const short = this.ui.info.getByName('levelShort') as Phaser.GameObjects.Container | null;
        if (short) bump(this, short, 1.15);
      }
      return false;
    }
    const prev = this.snapshot(hero);
    try {
      const saveBefore = session.save;
      const r = actLevelUp(session.save, today(), hero.id, GAME, times);
      commit(r.save);
      // Уровень открыл кусочек истории героя — тост и отметка «новое» на вкладке «История».
      if (toastOpenedStories(this, saveBefore, r.save, hero.templateId)) this.storyTabDot();
      markHint('level_up');
      // Шаг обучения выполнен — указатель больше не нужен (иначе висит над серой кнопкой).
      for (const o of [...this.children.list]) if (o.getData?.('hintId') === 'level_up') o.destroy();
      haptic('levelUp');
      sfx('level_up', hold ? { gain: 0.55, rate: 1 + Math.min(0.4, this.holdCount * 0.03) } : {});
      this.levelFx(!hold || this.holdCount % 5 === 0 || r.levels > 1);
      this.renderDynamic(prev);
      const skills = r.events.flatMap((e) => (e.type === 'skillUnlocked' ? [CONTENT.skills[e.skill]?.name ?? e.skill] : []));
      if (skills.length) {
        toast(this, `Новый навык: ${skills.join(', ')}`, C.success, 3000);
        if (this.tab === 'skills') this.renderTab();
      }
      // При смене формы обновляем также фигуру и название профессии в статичной шапке.
      const upgraded = r.save.heroes.find(h => h.id === hero.id)!;
      const formChanged = heroCard(hero, GAME).job !== heroCard(upgraded, GAME).job;
      // Упёрлись в предел — на месте «Улучшить» встанет «Вознести».
      if (formChanged || !levelUpInfo(session.save, hero.id, GAME).cost) {
        this.stopHold();
        this.time.delayedCall(700, () => this.reopen({ heroId: hero.id, tab: this.tab }));
      }
      return true;
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
      return false;
    }
  }

  /** Вспышка уровня: кольцо цвета редкости у ног, столб света, подскок фигуры; big — ещё искры у уровня. */
  private levelFx(big: boolean): void {
    if (!juiceOn()) return;
    const hero = this.hero();
    const col = hero ? rarityPalette(hero.rarity).glow : COLOR_N.gold;
    const ring = this.add.ellipse(FIG_X, FEET_Y, 180, 44).setStrokeStyle(6, col, 1).setDepth(400);
    this.tweens.add({ targets: ring, scaleX: 2.2, scaleY: 2.2, alpha: 0, duration: M.slow, ease: E.out, onComplete: () => ring.destroy() });
    const up = this.add.image(FIG_X, FEET_Y - 190, glowTexture(this)).setDisplaySize(320, 460).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.6).setDepth(401);
    this.tweens.add({ targets: up, alpha: 0, duration: M.slow, onComplete: () => up.destroy() });
    if (this.figure?.scene && !this.tweens.isTweening(this.figure)) {
      const f = this.figure;
      const y0 = f.y;
      this.tweens.add({ targets: f, y: y0 - 14, duration: M.press, yoyo: true, ease: E.out, onComplete: () => f.scene && f.setY(y0) });
    }
    if (big) burst(this, { x: COL_X + this.ui.level.width / 2, y: TOP + 462 });
    if (this.ui.up) bump(this, this.ui.up.container, 1.06);
  }

  private startRepeat(): void {
    this.holdFired = true;
    this.holdTimer = undefined;
    const tick = () => {
      this.holdCount++;
      if (!this.levelOnce(true)) {
        this.stopHold();
        return;
      }
      // Чем дольше держим — тем быстрее.
      if (this.holdCount === 6 && this.repeatTimer) {
        this.repeatTimer.remove();
        this.repeatTimer = this.time.addEvent({ delay: 80, loop: true, callback: tick });
      }
    };
    this.repeatTimer = this.time.addEvent({ delay: 170, loop: true, callback: tick });
    tick();
  }

  private stopHold(): void {
    this.holdTimer?.remove();
    this.repeatTimer?.remove();
    this.holdTimer = undefined;
    this.repeatTimer = undefined;
  }

  // ---------- вкладки ----------

  private tabs(): void {
    const index = Math.max(0, TABS.findIndex((t) => t.id === this.tab));
    const tabs = this.add.container(0, 0).setName('heroTabs');
    TABS.forEach((tab, i) => {
      const w = CONTENT_W / TABS.length;
      const x = S.l + w * (i + 0.5);
      const b = button(this, x, TABS_Y, w - 8, 112, '', tab.label, () => {
        this.tab = tab.id;
        heroesUi.tab = tab.id;
        this.reopen({ heroId: this.heroId, tab: tab.id });
      }, T.caption, { variant: 'secondary' });
      b.label.setColor(i === index ? COLOR.title : COLOR.textSecondary);
      tabs.add(b.container);
      if (i === index) tabs.add(this.add.rectangle(x, TABS_Y + 54, w - 8, 5, COLOR_N.accent));
    });
    // Есть вещи получше — зелёная стрелка на «Снаряжении» (не точка: это не «красное» событие).
    if (gearUpgrades(session.save, this.heroId, GAME).length) {
      const x = this.tabCorner(1);
      const g = this.add.circle(x, TABS_Y - 30, 18, COLOR_N.positive).setStrokeStyle(3, COLOR_N.surfaceSunken).setDepth(5);
      const a = this.add.triangle(x, TABS_Y - 30, 0, 12, 8, 0, 16, 12, COLOR_N.surfaceSunken).setDepth(6);
      g.setName('gearTabMark');
      void a;
    }
    this.storyTabDot();
    // Содержимое вкладки — на поверхности до навигации (на вытянутых экранах ниже CONTENT_BOTTOM).
    const tabBottom = this.footer.tabBottom;
    plate(this, GAME_W / 2, (TAB_TOP + tabBottom) / 2, CONTENT_W, tabBottom - TAB_TOP, { ...SURFACE.surface, r: R.l });
    this.tabArea = new ScrollArea(this, TAB_TOP + S.xxs, tabBottom - S.xxs);
  }

  /** x правого верхнего угла сегмента i (для отметок на вкладках). */
  private tabCorner(i: number): number {
    const segW = (CONTENT_W - 12) / TABS.length;
    return S.l + 6 + segW * (i + 1) - 40;
  }

  /** Отметка «есть что почитать» на вкладке «История»: золотая искра, не красная точка (§2.4). */
  private storyTabDot(): void {
    const hero = this.hero();
    if (!hero || !heroStoryNew(hero.templateId) || this.children.getByName('storyTabDot')) return;
    sparkDot(this, this.tabCorner(2), TABS_Y - 30).setDepth(6).setName('storyTabDot');
  }

  private renderTab(): void {
    const hero = this.hero();
    if (!hero) return;
    this.tabArea.clear();
    if (this.tab === 'skills') this.skillsTab(hero);
    else if (this.tab === 'gear') this.gearTab(hero);
    else this.storyTab(hero);
  }

  /**
   * «Навыки»: сверху — ветка второй профессии (выбрать/сменить/посмотреть) и сила навыков редкости; плитки навыков
   * (иконка, имя, «ур. N» у закрытых); другие ветки — плитками бледнее. Касание плитки — лист с описанием и цифрами.
   */
  private skillsTab(hero: HeroState): void {
    const a = this.tabArea;
    this.skillRows = 0;
    const c = heroCard(hero, GAME);
    const job0 = CONTENT.jobs[c.job];
    let y: number = S.s;
    // Строка действий: ветка слева, сила навыков справа.
    const headY = y + BTN.m / 2;
    let head = false;
    const st = branchStatus(session.save, hero.id, GAME);
    if (st.canChoose) {
      const b = button(this, S.l + S.s + 200, headY, 400, BTN.m, '', 'Выбрать ветку', () => this.pickBranch(hero, c), T.heading, { variant: 'secondary' });
      b.label.setColor(COLOR.title);
      b.container.setName('chooseBranchBtn');
      a.add(b.container);
      pulse(this, b.container, 1.05);
      head = true;
    } else if (st.canChange) {
      const b = button(this, S.l + S.s + 170, headY, 340, BTN.m, '', 'Сменить ветку', () => this.pickBranch(hero, c), T.body, { variant: 'secondary' });
      b.container.setName('changeBranchBtn');
      a.add(b.container);
      const cost = st.changeFree
        ? tag(this, S.l + S.s + 340 + S.xs, headY, 'бесплатно', 'positive', { align: 'left' })
        : chip(this, S.l + S.s + 340 + S.xs, headY, (sc, x, yy, size) => gemIcon(sc, x, yy, size * 0.7), st.changeCost, 'gem', { size: 's', align: 'left' });
      a.add(cost.setName('branchCost'));
      head = true;
    } else if (c.branches.length) {
      const b = button(this, S.l + S.s + 200, headY, 400, BTN.m, '', 'Ветки на фиолетовом', () => this.previewBranches(hero, c), T.body, { variant: 'secondary', sound: null });
      b.container.setName('branchPreviewBtn');
      a.add(b.container);
      head = true;
    }
    const power = rarityDef(GAME, hero.rarity).skillPower;
    if (power !== 1) {
      a.add(tag(this, GAME_W - S.l - S.s, headY, `Навыки ×${power}`, 'gold', { align: 'right' }).setName('skillPower'));
      head = true;
    }
    if (head) y += BTN.m + S.s;

    // Плитки формы: обычная атака, ульта, навыки по уровню открытия.
    const tiles: SkillTile[] = [{ id: job0?.basic ?? '', basic: true }];
    if (c.ult) tiles.push({ id: c.ult, ult: true, note: c.advanced ? 'Ветеран · золото и ур. 70' : c.branch ? 'Доступна после выбора этой ветки' : 'Доступна с первого уровня' });
    for (const sk of heroSkillList(hero, GAME)) {
      const gate = sk.unlocked ? null : skillRarityGate(sk.level, hero.rarity, GAME);
      tiles.push(sk.unlocked ? { id: sk.skill, note: `Открыто с ур. ${sk.level}` } : { id: sk.skill, locked: sk.level, gate: gate?.name });
    }
    for (const [title, group] of [
      ['Атака и личная ульта', tiles.filter(t => t.basic || t.ult)],
      ['Унаследованные навыки', tiles.filter(t => !t.basic && !t.ult && !t.id.startsWith('adv_') && !t.id.startsWith('ro_'))],
      ['RO-сигнатуры · адаптации · ур. 70', tiles.filter(t => t.id.startsWith('ro_'))],
      ['Авторское развитие · 70 / 80 · красный 90 / 100', tiles.filter(t => t.id.startsWith('adv_'))],
    ] as [string, SkillTile[]][]) {
      if (!group.length) continue;
      a.add(text(this, S.l + S.s, y + 22, title, T.caption, COLOR.title).setOrigin(0, 0.5));
      y += 44;
      y = this.skillGrid(group, y, power);
    }

    // Превью ветеранского ранга находится в прокручиваемой вкладке, не уплотняет шапку.
    const veteranBranches = c.branches;
    for (const b of veteranBranches) {
      const next = b.advanced;
      if (!next) continue;
      const rarity = rarityDef(GAME, next.minRarity).name;
      a.add(text(this, S.l + S.s, y + 22, `${jobTitle(GAME, c.line, c.gender)} → ${b.jobName} → ${next.jobName}`, T.caption, COLOR.title).setOrigin(0, 0.5));
      y += 44;
      a.add(text(this, S.l + S.s, y + 18, `${rarity} и выше · ур. ${next.minLevel} · автоматически`, T.caption, COLOR.textSecondary).setOrigin(0, 0.5));
      y += 44;
      if (!c.advanced || b.job !== c.branch) {
        const preview = veteranSkillTiles(next, rarity);
        y = this.skillGrid(preview, y, power);
      }
    }

    // Другие формы бледнее: до фиолетового — обе ветки, без ветки — обе, с веткой — другая.
    const rn = GAME.cards.rarities.find((r) => r.id === (c.branchAt ?? 'purple'))?.name ?? 'Фиолетовый';
    const others = c.branch ? c.branches.filter((b) => b.job !== c.branch) : c.branches;
    for (const b of others) {
      y += S.s;
      const title = c.branchAt ? `С редкости «${rn}» — ${b.jobName}` : c.branch ? `Другая ветка — ${b.jobName}` : `Ветка ${b.jobName}`;
      a.add(text(this, S.l + S.s, y + 22, title, T.caption, COLOR.textSecondary, { fontStyle: 'bold' }).setOrigin(0, 0.5).setName(`otherBranch_${b.job}`));
      y += 44 + S.xs;
      const note = c.branchAt ? 'после вознесения' : c.branch ? 'другая ветка' : 'после выбора ветки';
      const list: SkillTile[] = [];
      if (b.ult) list.push({ id: b.ult, ult: true, locked: 1, form: true, note: `Ульта · ${note}` });
      for (const s of [...b.skills].sort((p, q) => p.level - q.level)) list.push({ id: s.skill, locked: s.level, form: true, note: `Ур. ${s.level} · ${note}` });
      y = this.skillGrid(list, y, power);
    }
    a.setContentHeight(y + S.s);
  }

  /** Сетка плиток навыков (SK_COLS в ряд) с верхнего края y; возвращает низ сетки. */
  private skillGrid(tiles: SkillTile[], y: number, power: number): number {
    const cellW = (CONTENT_W - 2 * S.s) / SK_COLS;
    tiles.forEach((t, i) => {
      const col = i % SK_COLS;
      const rowI = Math.floor(i / SK_COLS);
      this.skillTile(t, S.l + S.s + cellW * (col + 0.5), y + rowI * SK_ROW + SK_BOX / 2, cellW, power);
    });
    return y + Math.ceil(tiles.length / SK_COLS) * SK_ROW;
  }

  /** Плитка навыка: иконка в утопленной рамке (ульта — золотая рамка), имя под ней; закрытый — бледный, замок, «ур. N». */
  private skillTile(r: SkillTile, x: number, y: number, cellW: number, power: number): void {
    const a = this.tabArea;
    const sk = CONTENT.skills[r.id];
    const locked = r.locked !== undefined;
    const w = cellW - 16;
    const h = SK_ROW - 16;
    const cy = y + (h - SK_BOX) / 2;
    const bg = a.add(plate(this, x, cy, w, h, { ...SURFACE.raised, border: r.ult ? COLOR.accent : COLOR.border, borderW: 2, r: R.m }));
    bg.setName(`skillRow_${this.skillRows++}`);
    const ix = x - w / 2 + 58;
    const icon = a.add(this.add.image(ix, cy, skillIcon(this, sk)).setDisplaySize(80, 80));
    if (locked) icon.setAlpha(0.65);
    if (r.ult && ultBreaksCharge(r.id)) a.add(chargeBreakBadge(this, ix - 28, cy - 34, 32));
    const tx = ix + 58;
    const tw = w - 136;
    a.add(text(this, tx, cy - 112, sk?.name ?? r.id, T.caption, COLOR.textPrimary, { align: 'left', fontStyle: 'bold', wordWrap: { width: tw } }).setOrigin(0, 0));
    const status = skillTileStatus(r);
    a.add(text(this, tx, cy + 40, status, T.caption, COLOR.textSecondary, { align: 'left', wordWrap: { width: tw } }).setOrigin(0, 0));
    if (!sk) return;
    const lockNote = locked ? (r.note ?? `Откроется на ур. ${r.locked}${r.gate ? ` · нужен ${r.gate}` : ''}`) : undefined;
    pressable(this, bg, w, h, a.tap(() => {
      a.locked = true;
      openSkillDetail(this, r.id, { lockNote, note: r.note, power, basic: r.basic, ult: r.ult, onClose: () => (a.locked = false) });
    }));
  }

  /** «Снаряжение»: 4 слота сеткой (иконка, «+N» заточки, имя, статы), под ними «Надеть лучшее» и «Заточить всё». */
  private gearTab(hero: HeroState): void {
    const a = this.tabArea;
    const slots = heroSlots(session.save, hero.id, GAME);
    const ups = gearUpgrades(session.save, hero.id, GAME);
    // Сетка 2×2: слот — плитка с иконкой слева и именем/статами справа.
    const cellW = (CONTENT_W - 2 * S.s - S.xs) / 2;
    const rows = Math.ceil(SLOTS.length / 2);
    SLOTS.forEach((slot, i) => {
      const x = S.l + S.s + cellW / 2 + (i % 2) * (cellW + S.xs);
      const y = S.s + GEAR_H / 2 + Math.floor(i / 2) * (GEAR_H + S.xs);
      this.gearSlot(hero, slot, slots[slot], x, y, cellW, ups.some((u) => u.slot === slot));
    });
    let y = S.s + rows * GEAR_H + (rows - 1) * S.xs + S.m;
    if (ups.length) {
      const best = button(this, GAME_W / 2, y + BTN.l / 2, 640, BTN.l, '', `Надеть лучшее (${ups.length})`, () => this.equipBest(hero), T.heading, { variant: 'secondary' });
      best.label.setColor(COLOR.positive);
      best.container.setName('equipBestBtn');
      a.add(best.container);
      pulse(this, best.container, 1.03);
      // Одна подсказка на карточке: шаг обучения «Улучшить» (level_up) важнее трофеев — они подождут.
      const levelStep = !hintDone('level_up') && levelUpInfo(session.save, hero.id, GAME).canLevel;
      if (!hintDone('equip_gear') && !levelStep) tutorialHint(this, 'equip_gear', GAME_W / 2, TAB_TOP + S.xxs + y + BTN.l / 2, 'auto', { w: 640, h: BTN.l });
      y += BTN.l + S.s;
    }
    y = this.refineAllRow(hero, y);
    a.setContentHeight(y + S.s);
  }

  /**
   * «Заточить всё надетое»: по одному безопасному шагу (шанс поломки 0) каждому надетому предмету, пока хватает золота
   * (с подтверждением и суммой); рискованные шаги — только вручную в окне предмета. Закрыто — «Откроется на этапе …»;
   * всё на максимуме — тег; безопасных шагов нет или не хватает золота — неактивная кнопка и короткая причина.
   */
  private refineAllRow(hero: HeroState, y: number): number {
    const a = this.tabArea;
    const worn = Object.values(heroSlots(session.save, hero.id, GAME));
    if (!refineConfig(GAME) || !worn.length) return y;
    if (!refineUnlocked(session.save, GAME)) {
      a.add(text(this, GAME_W / 2, y + 30, `Заточка · ${lockedText(session.save, 'refine', GAME)}`, T.caption, COLOR.textSecondary).setName('refineAllLocked'));
      return y + 70;
    }
    const plan = refineAllPlan(session.save, hero.id, GAME);
    if (!plan.steps.length) {
      if (!plan.safe && !plan.risky) {
        a.add(tag(this, GAME_W / 2, y + 30, 'Всё надетое заточено до максимума', 'gold').setName('refineAllNone'));
        return y + 70;
      }
      const off = button(this, GAME_W / 2, y + BTN.l / 2, 640, BTN.l, '', 'Заточить всё', () => {}, T.heading, { variant: 'secondary' });
      off.setEnabled(false);
      off.container.setName('refineAllBtn');
      a.add(off.container);
      const why = plan.safe ? 'Не хватает золота' : 'Дальше — с риском, только вручную';
      a.add(text(this, GAME_W / 2, y + BTN.l + S.s, why, T.caption, COLOR.textSecondary).setName('refineAllNone'));
      return y + BTN.l + S.s + 40;
    }
    const n = plan.steps.length;
    const b = button(this, GAME_W / 2, y + BTN.l / 2, 640, BTN.l, '', 'Заточить всё', () => {
      const list = plan.steps
        .map((st) => {
          const def = GAME.equipment.items[st.itemId];
          return def ? `${refinedName(def, st.from)} → +${st.from + 1}` : st.itemId;
        })
        .join('\n');
      confirm(
        this,
        `Заточить ${n} ${n === 1 ? 'предмет' : n < 5 ? 'предмета' : 'предметов'} на +1 за ${formatNumber(plan.gold)} золота?\n\n${list}\n\nТолько безопасные шаги (без риска поломки).\nРискованные шаги — вручную.`,
        'Заточить',
        () => this.refineAll(hero),
      );
    }, T.heading, { variant: 'secondary' });
    b.container.setName('refineAllBtn');
    // Цена — чипом на кнопке справа.
    b.label.setX(-90);
    const price = chip(this, 180, 0, 'gold', plan.gold, 'gold', { size: 's' });
    b.container.add(price);
    a.add(b.container);
    return y + BTN.l + S.s;
  }

  private refineAll(hero: HeroState): void {
    try {
      const r = actRefineAll(session.save, hero.id, GAME);
      commit(r.save);
      sfx('refine_success');
      haptic('refineOk');
      this.reopen({ heroId: hero.id, tab: 'gear' });
      const sc = this.scene.get('Hero');
      sc.events.once(Phaser.Scenes.Events.CREATE, () => {
        burst(sc, { x: GAME_W / 2, y: TAB_TOP + S.s + GEAR_H });
        toast(sc, `Заточено: ${r.events.length} · −${formatNumber(r.events.reduce((s, e) => s + e.gold, 0))} золота`, C.success, 3000);
      });
    } catch (e) {
      sfx('ui_error');
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** Слот: подпись слота, иконка предмета (пусто — «+»), «+N» заточки, имя цветом редкости и статы. */
  private gearSlot(hero: HeroState, slot: Slot, item: ReturnType<typeof heroSlots>[Slot], x: number, y: number, w: number, better = false): void {
    const a = this.tabArea;
    const color = item ? RARITY_COLORS[item.def.rarity] : undefined;
    const bg = a.add(plate(this, x, y, w, GEAR_H, item ? { ...SURFACE.raised, border: color, borderW: 3, r: R.m } : { ...SURFACE.sunken, r: R.m }));
    bg.setName(`gearSlot_${slot}`);
    pressable(this, bg, w, GEAR_H, a.tap(() => this.scene.start('Inventory', { heroId: hero.id, slot, heroBack: this.back })));
    // Иконка слева в утопленном квадрате, справа — слот, имя цветом редкости, статы.
    const box = GEAR_H - 2 * S.s;
    const ix = x - w / 2 + S.s + box / 2;
    a.add(plate(this, ix, y, box, box, { ...SURFACE.sunken, r: R.s }));
    const tx = ix + box / 2 + S.s;
    const tw = x + w / 2 - S.s - tx;
    if (better) {
      a.add(this.add.circle(x + w / 2 - 26, y - GEAR_H / 2 + 26, 18, COLOR_N.positive).setStrokeStyle(3, COLOR_N.surfaceSunken));
      a.add(this.add.triangle(x + w / 2 - 26, y - GEAR_H / 2 + 26, 0, 12, 8, 0, 16, 12, COLOR_N.surfaceSunken));
    }
    if (!item) {
      a.add(text(this, ix, y + 4, '+', T.title, COLOR.textTertiary, { fontStyle: 'bold' }));
      a.add(text(this, tx, y, SLOT_NAMES[slot], T.body, COLOR.textSecondary).setOrigin(0, 0.5));
      return;
    }
    const lvl = refineLevel(item.instance);
    const ico = roIconImage(this, ix, y, item.instance.itemId, 80);
    if (ico) a.add(ico.setName('gearIcon'));
    if (lvl > 0) a.add(tag(this, ix + box / 2 + 4, y + box / 2 - 4, `+${lvl}`, 'gold', { solid: true, align: 'right' }));
    a.add(text(this, tx, y - 42, SLOT_NAMES[slot], T.caption, COLOR.textSecondary).setOrigin(0, 0.5));
    a.add(ellipsize(text(this, tx, y, refinedName(item.def, 0), T.body, color ?? COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5), tw));
    a.add(ellipsize(text(this, tx, y + 42, itemStatsText(refinedStats(item.def, lvl, GAME)), T.caption, COLOR.textPrimary).setOrigin(0, 0.5), tw));
  }

  /** T1-08: надеть все улучшения из инвентаря (свободные вещи получше надетых). */
  private equipBest(hero: HeroState): void {
    try {
      const r = actEquipBest(session.save, hero.id, GAME);
      commit(r.save);
      markHint('equip_gear');
      sfx('equip');
      haptic('tap');
      this.reopen({ heroId: hero.id, tab: 'gear' });
      const sc = this.scene.get('Hero');
      // Успех — вспышка на слотах, без тоста (видно на экране).
      sc.events.once(Phaser.Scenes.Events.CREATE, () => burst(sc, { x: GAME_W / 2, y: TAB_TOP + S.s + GEAR_H }));
      void r.equipped;
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private storyTab(hero: HeroState): void {
    const a = this.tabArea;
    const c = heroCard(hero, GAME);
    const left = S.l + S.m;
    const wrapW = CONTENT_W - 2 * S.m;
    let y: number = S.s;
    // История героя кусочками (каждые 10 уровней) — страница во весь экран (heroStoryView).
    if (hasHeroStory(hero.templateId)) {
      const pr = heroStoryProgress(hero.templateId);
      const sb = button(this, GAME_W / 2, y + BTN.l / 2, 700, BTN.l, '', `История героя · ${pr.open} из ${pr.total}`, () => {
        openHeroStory(this, hero.templateId, { lock: a, onClose: () => this.reopen({ heroId: hero.id, tab: 'story' }) });
      }, T.heading, { variant: 'secondary' });
      sb.container.setName('heroStoryBtn');
      a.add(sb.container);
      if (heroStoryNew(hero.templateId)) a.add(sparkDot(this, GAME_W / 2 + 340, y + 10));
      y += BTN.l + S.m;
    }
    const para = (s: string, color: string, size: number = T.body, style: Phaser.Types.GameObjects.Text.TextStyle = {}) => {
      const t = a.add(text(this, left, y, s, size, color, { align: 'left', wordWrap: { width: wrapW }, ...style }).setOrigin(0, 0));
      y += t.height + S.s;
    };
    const head = (s: string, color: string = COLOR.title) => {
      const t = a.add(text(this, left, y, s, T.heading, color, { align: 'left', fontFamily: FAMILY.heading, fontStyle: 'bold', wordWrap: { width: wrapW } }).setOrigin(0, 0));
      y += t.height + S.xs;
    };
    // Близость (сюжетные герои, docs/design/tavern-evenings.md): шкала, что открыто, связка; вход в «Вечера».
    const bond = bondView(session.save, hero.templateId, GAME);
    if (bond) {
      head(`Близость · ${bond.points} из ${bond.max}`);
      for (let i = 0; i < bond.max; i++) a.add(this.add.circle(left + 22 + i * 64, y + 22, 20, i < bond.points ? COLOR_N.badge : COLOR_N.surfaceSunken, 1).setStrokeStyle(3, COLOR_N.border));
      y += 64;
      para(
        [
          bond.scene.open ? `Личная сцена «${bond.scene.title}»${bond.scene.seen ? '' : ' — открыта'}` : `Личная сцена — на близости ${bond.scene.at}`,
          bond.quest.done ? `Задание «${bond.quest.title}» выполнено` : bond.quest.open ? `Задание «${bond.quest.title}»: ${bond.quest.goal}` : `Личное задание — на близости ${bond.quest.at}`,
          bond.link.open ? linkText(bond) : `Связка «${bond.link.name}» откроется после задания`,
        ].join('\n'),
        COLOR.textSecondary,
        T.caption,
      );
      const tb = button(this, GAME_W / 2, y + BTN.m / 2, 640, BTN.m, '', 'Вечера в таверне', () => {
        startTavernEvening(this, { mode: 'hub', back: { to: 'Hero', data: { heroId: hero.id, tab: 'story', back: this.back } } });
      }, T.heading, { variant: 'secondary' });
      tb.container.setName('heroBondBtn');
      a.add(tb.container);
      y += BTN.m + S.m;
    }
    // Начало пути (первая профессия), затем — форма после возвышения: выбранная ветка целиком, другая — превью бледнее.
    const firstJob = jobTitle(GAME, heroTemplate(GAME, hero.templateId).job, c.gender);
    if (c.branch && firstJob) head(`Начало пути: ${firstJob}`);
    para(c.bio, COLOR.textPrimary);
    if (c.hook) para(`«${c.hook}»`, COLOR.title, T.body, { fontStyle: 'italic' });
    // Летопись (data/lore/heroes.json): история героя и черты характера — если писатель их добавил.
    const lore = LORE.heroes[hero.templateId];
    if (lore) {
      y += S.xs;
      head('История');
      para(lore.story, COLOR.textPrimary);
      if (lore.quirks.length) {
        head('Черты');
        para(lore.quirks.map((q) => `• ${q}`).join('\n'), COLOR.textSecondary, T.caption);
      }
    }
    const rn = GAME.cards.rarities.find((r) => r.id === (c.branchAt ?? 'purple'))?.name ?? 'Фиолетовый';
    const chosen = c.branches.find((b) => b.job === c.branch);
    const branchStory = (b: (typeof c.branches)[number], dim: boolean) => {
      if (b.promotion) para(`«${b.promotion}»`, dim ? COLOR.textSecondary : COLOR.title, T.body, { fontStyle: 'italic' });
      if (b.bio) para(b.bio, dim ? COLOR.textSecondary : COLOR.textPrimary);
    };
    if (chosen) {
      y += S.xs;
      head(`После возвышения: ${chosen.jobName}`);
      branchStory(chosen, false);
      if (chosen.advanced) {
        const v = chosen.advanced;
        head(`${c.advanced ? 'Ветеран' : 'Будущий ранг'}: ${v.jobName}`);
        para(`${rarityDef(GAME, v.minRarity).name} и выше, уровень ${v.minLevel}. Возвышение автоматически, без сброса уровня.`, COLOR.textSecondary, T.caption);
        branchStory(v, !c.advanced);
      }
    }
    const others = c.branches.filter((b) => b !== chosen);
    if (others.length) {
      y += S.xs;
      head(chosen ? 'Другая ветка (можно сменить)' : `На редкости «${rn}» — на выбор`, COLOR.textSecondary);
      for (const b of others) {
        head(b.jobName, COLOR.textSecondary);
        branchStory(b, true);
      }
    }
    y += S.xs;
    para(`${c.gender === 'f' ? 'Героиня' : 'Герой'} гильдии ${GUILD_NAMES[c.line] ?? '—'} · ${c.source === 'story' ? 'сюжет' : 'Таверна'} · растёт до ${RARITY_GEN[c.maxRarity] ?? rarityDef(GAME, c.maxRarity).name.toLowerCase()}`, COLOR.textSecondary, T.caption);
    para('Растёт копиями: копии этого героя (и любых — на красный) уходят в корм при вознесении.', COLOR.textSecondary, T.caption);
    for (const s of copySources(session.save, hero.templateId, GAME)) para(`• ${s}`, COLOR.textSecondary, T.caption);
    a.setContentHeight(y + S.s);
  }
}


/** Текст поверх арта витрины: мягкая тень вместо обводки. */
function onArt<O extends Phaser.GameObjects.Text>(t: O): O {
  t.setShadow(0, 3, 'rgba(0,0,0,0.8)', 6, false, true);
  return t;
}

/** Золотая искра «есть что почитать» (не красная точка, §2.4 п. 4). */
function sparkDot(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Container {
  const glow = scene.add.image(0, 0, glowTexture(scene)).setDisplaySize(64, 64).setTint(COLOR_N.gold).setAlpha(0.6).setBlendMode(Phaser.BlendModes.ADD);
  const star = scene.add.image(0, 0, skinIcon('star')).setDisplaySize(34, 34).setTint(COLOR_N.gold);
  const c = scene.add.container(x, y, [glow, star]).setName('storySpark');
  if (juiceOn()) scene.tweens.add({ targets: glow, alpha: 0.25, duration: M.emphasis * 2, yoyo: true, repeat: -1, ease: E.inOut });
  return c;
}

/** Тост при нажатии на серую «Улучшить»: чего не хватает. */
function shortageToast(info: LevelUpInfo): string {
  if (info.blocker === 'max_level' || !info.cost) return 'Предел редкости — вознесите героя';
  if (info.blocker === 'not_enough_exp') return `Не хватает ${formatNumber(info.cost.exp - info.pool)} опыта`;
  if (info.blocker === 'not_enough_gold') return `Не хватает ${formatNumber(info.cost.gold - info.gold)} золота`;
  return 'Нельзя улучшить';
}

