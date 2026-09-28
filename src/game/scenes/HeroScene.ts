import Phaser from 'phaser';
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
  COMBAT,
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
  type Slot,
  type Stats,
} from '../../core';
import { CONTENT, GAME } from '../content';
import { ascendReady, formatNumber, heroSprite, itemStatsText, levelText, RARITY_COLORS, ROLE_NAMES, SLOT_NAMES, STAT_KEYS, STAT_LABELS } from '../flow';
import { GAME_W } from '../layout';
import { card, confirm, CONTENT_BOTTOM, CONTENT_TOP, screen, unitFigure } from '../screen';
import { commit, session, today } from '../session';
import { button, ellipsize, hintPointer, panel, pressable, ScrollArea, text, toast, tutorialHint } from '../ui';
import { C, FS, TINT } from '../theme';
import { skillIcon } from '../skillIcons';
import { sfx } from '../audio';
import { bump, burst, countUp, juiceOn, pulse } from '../juice';
import { skinIcon } from '../skin';
import { glowTexture, GUILD_NAMES, iconBadge, raysTexture, rarityBackdrop, rarityPalette, rarityPips } from '../heroCard';
import { ascendHint, browseNeighbours, copyCounter, heroesUi, inventoryUi, levelShortage, nextLevelDelta, copySources, skillRarityGate } from '../heroesView';
import { openBranchPicker } from '../branchPicker';
import { openSkillDetail } from '../skillDetail';
import { gemIcon } from '../screen';

const SKILL_ROW_H = 118;
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

/** Геометрия экрана (игровые единицы). */
const TOP = CONTENT_TOP;
const SHOW_H = 530;
const SHOW_Y = TOP + SHOW_H / 2;
const FIG_X = 290;
const FEET_Y = TOP + 455;
const COL_X = 560;
const COL_R = 950;
const STATS_Y = TOP + 605;
const ACT_Y = TOP + 780;
const UP_X = 840;
const TABS_Y = TOP + 935;
const TAB_TOP = TOP + 995;

interface Snapshot {
  power: number;
  stats: Stats;
  level: number;
}

/**
 * H4 «Герой» — карточка как в AFK Arena: витрина цвета редкости с орнаментом и героем в стойке, имя, редкость
 * (ромбы до максимума), класс, роль, гильдия, мощь, уровень; статы с прибавкой за следующий уровень; «Улучшить»
 * (опыт пула + золото; удержание — повтор; цена и «до апа не хватает N»); «Вознести» (экран Ascend: осколки у
 * сюжетных, корм у призывных); вкладки «Навыки» (уровни открытия, «нужен Синий», вторая профессия), «Снаряжение»,
 * «История» (био, крючок, откуда осколки). Замок (призывные), листание ‹ › по списку «Героев».
 */
export class HeroScene extends Phaser.Scene {
  constructor() {
    super('Hero');
  }

  private heroId = '';
  private tab: Tab = 'skills';
  /** Куда ведёт «‹ Назад» (по умолчанию — список «Герои»). */
  private back?: HeroBack;
  /** Счётчик строк навыков (имена skillRow_N для e2e и скриншотов). */
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
    info: Phaser.GameObjects.Container;
    up?: ReturnType<typeof button>;
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
    screen(this, c ? (c.branch ? `${c.name} · ${c.jobName}` : c.name) : 'Герой', 'Heroes', this.back ?? { to: 'Heroes' });
    if (!hero || !c) return;
    const ups = gearUpgrades(session.save, hero.id, GAME);
    this.tab = data.tab ?? heroesUi.tab ?? (ups.length && !hintDone('equip_gear') ? 'gear' : 'skills');

    this.showcase(hero, c);
    this.statsStrip();
    this.actions(hero, c);
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
    rarityBackdrop(this, GAME_W / 2, SHOW_Y, 1040, SHOW_H, hero.rarity);
    // Лучи и пьедестал цвета редкости за героем.
    const rays = this.add.image(FIG_X, FEET_Y - 170, raysTexture(this)).setDisplaySize(620, 620).setTint(pal.glow).setAlpha(0.22).setBlendMode(Phaser.BlendModes.ADD);
    if (juiceOn()) this.tweens.add({ targets: rays, angle: 360, duration: 40000, repeat: -1 });
    this.add.image(FIG_X, FEET_Y, glowTexture(this)).setDisplaySize(360, 90).setTint(pal.tint).setAlpha(0.7).setBlendMode(Phaser.BlendModes.ADD);
    this.add.ellipse(FIG_X, FEET_Y + 4, 200, 40, 0x000000, 0.45);
    unitFigure(this, heroSprite(hero, GAME), FIG_X, FEET_Y, 380, {
      maxScale: 3.2,
      onReady: (o) => {
        this.figure = o;
      },
    });
    // Искры цвета редкости поднимаются от пьедестала.
    if (juiceOn() && this.textures.exists('hc_glow')) {
      this.add.particles(0, 0, 'hc_glow', {
        x: { min: FIG_X - 150, max: FIG_X + 150 },
        y: FEET_Y,
        lifespan: 2400,
        speedY: { min: -70, max: -30 },
        scale: { start: 0.14, end: 0 },
        alpha: { start: 0.8, end: 0 },
        tint: pal.glow,
        blendMode: Phaser.BlendModes.ADD,
        frequency: 260,
      });
    }

    // Колонка справа: имя, редкость, класс, роль, гильдия, мощь, уровень.
    const name = text(this, COL_X, TOP + 62, c.name, FS.h1 + 6, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 7 }).setOrigin(0, 0.5);
    for (const size of [FS.h1 + 6, FS.h1, FS.h2, FS.h3]) {
      name.setFontSize(size);
      if (name.width <= COL_R - COL_X) break;
    }
    ellipsize(name, COL_R - COL_X);
    const rl = text(this, COL_X, TOP + 122, c.rarity.name, FS.h3, c.rarity.color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5).setName('heroRarity');
    rarityPips(this, COL_X + rl.width + 30 + 60, TOP + 122, heroTemplate(GAME, hero.templateId), hero.rarity, 12);
    iconBadge(this, COL_X + 30, TOP + 190, c.line, 30, pal.tint);
    ellipsize(text(this, COL_X + 76, TOP + 190, c.jobName, FS.h2, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5), COL_R - COL_X - 76);
    const job = CONTENT.jobs[c.job];
    iconBadge(this, COL_X + 30, TOP + 256, c.role, 30, pal.tint);
    const range = CONTENT.skills[job?.basic ?? '']?.range === 'melee' ? 'ближний бой' : 'дальний бой';
    ellipsize(text(this, COL_X + 76, TOP + 256, `${ROLE_NAMES[c.role] ?? ''} · ${range}`, FS.body, C.muted).setOrigin(0, 0.5), COL_R - COL_X - 76);
    this.branchRow(hero, c, TOP + 314);
    text(this, COL_X, TOP + 368, 'Мощь', FS.small, C.muted).setOrigin(0, 0.5);
    const power = text(this, COL_X + 90, TOP + 368, '', FS.h1, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 7 }).setOrigin(0, 0.5).setName('heroPower');
    const level = text(this, COL_X, TOP + 432, '', FS.h3, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5).setName('heroLevel');
    const barW = COL_R - COL_X;
    this.add.rectangle(COL_X, TOP + 478, barW, 22, 0x0b0805).setOrigin(0, 0.5).setStrokeStyle(3, 0x000000, 0.7);
    const levelBar = this.add.rectangle(COL_X + 3, TOP + 478, 0, 16, pal.tint).setOrigin(0, 0.5);
    this.ui = { level, levelBar, levelBarW: barW - 6, power, stats: [], deltas: [], info: this.add.container(0, 0) };

    // Копии героя (корм для вознесения) — под фигурой.
    const cc = copyCounter(session.save, hero.id, GAME);
    if (cc.text) {
      const ready = cc.need !== undefined && (cc.have ?? 0) >= cc.need;
      // Есть копии — нажатие открывает их все картами (Инвентарь → «Карты героев», только этот герой).
      const more = cc.others > 0;
      const t = text(this, FIG_X, TOP + 488, `${cc.text}${more ? ' ›' : ''}`, FS.caption, ready ? C.positive : C.muted, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setName('copyCounter');
      ellipsize(t, 470);
      const bg = this.add.rectangle(FIG_X, TOP + 488, Math.min(490, t.width + 30), 40, 0x0b0805, 0.72).setStrokeStyle(2, pal.tint, 0.8);
      this.children.bringToTop(t);
      if (more) {
        pressable(this, bg, bg.width, 56, () => {
          inventoryUi.tab = 'cards';
          inventoryUi.rarity = null;
          inventoryUi.template = hero.templateId;
          this.scene.start('Inventory', {});
        });
      }
    }
    // Замок (не уйдёт в корм) — левый верхний угол витрины. Копией бывает любой герой, сюжетный тоже.
    {
      const lock = button(this, 88, TOP + 70, 96, 96, c.locked ? 'k:buttonSquare_brown' : 'k:buttonSquare_beige', '', () => this.toggleLock(), FS.body, { sound: 'ui_toggle' });
      lock.container.add(this.add.image(0, -4, skinIcon('lock')).setDisplaySize(56, 56).setTint(c.locked ? 0xffd84a : 0x8a8070));
      lock.container.setName('lockBtn');
    }
    // Листание ‹ › по списку «Героев».
    const order = heroesUi.order.length ? heroesUi.order : session.save.heroes.map((h) => h.id);
    const nb = browseNeighbours(order, hero.id, (id) => session.save.heroes.some((h) => h.id === id));
    const { prev, next } = nb;
    if (prev) button(this, 60, TOP + 300, 84, 130, 'k:buttonSquare_beige', '‹', () => this.reopen({ heroId: prev, tab: this.tab }), FS.hero, { sound: 'ui_tab' }).container.setName('prevHero');
    if (next) button(this, 1020, TOP + 300, 84, 130, 'k:buttonSquare_beige', '›', () => this.reopen({ heroId: next, tab: this.tab }), FS.hero, { sound: 'ui_tab' }).container.setName('nextHero');
  }

  /** Ветка второй профессии: «Выбрать ветку» (фиолетовый без ветки), «Сменить ветку» (цена), превью веток ниже. */
  private branchRow(hero: HeroState, c: HeroCard, y: number): void {
    const st = branchStatus(session.save, hero.id, GAME);
    if (st.canChoose) {
      const b = button(this, COL_X + 195, y, 390, 76, 'ui_btn_primary', 'Выбрать ветку!', () => this.pickBranch(hero, c), FS.h3);
      b.container.setName('chooseBranchBtn');
      pulse(this, b.container, 1.05);
      return;
    }
    if (st.canChange) {
      const b = button(this, COL_X + 124, y, 248, 72, 'ui_btn_secondary', 'Сменить ветку', () => this.pickBranch(hero, c), FS.small);
      b.container.setName('changeBranchBtn');
      if (st.changeFree) text(this, COL_X + 258, y, 'бесплатно', FS.caption, C.positive, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5).setName('branchCost');
      else {
        gemIcon(this, COL_X + 276, y, 30);
        text(this, COL_X + 298, y, formatNumber(st.changeCost), FS.caption, C.gem, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5).setName('branchCost');
      }
      return;
    }
    if (c.branches.length) {
      const b = button(this, COL_X + 195, y, 390, 72, 'k:buttonLong_beige', 'Ветки на фиолетовом', () => this.previewBranches(hero, c), FS.small, { sound: null });
      b.container.setName('branchPreviewBtn');
    }
  }

  /** Превью обеих веток (до фиолетового). */
  private previewBranches(hero: HeroState, c: HeroCard): void {
    const rn = GAME.cards.rarities.find((r) => r.id === (c.branchAt ?? 'purple'))?.name ?? 'Фиолетовый';
    openBranchPicker(this, {
      templateId: hero.templateId,
      title: `${c.name}: ветки второй профессии`,
      subtitle: `Выбор — при вознесении в «${rn}» (синий → фиолетовый). Первую смену ветки можно сделать бесплатно.`,
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
        ? `Уровень, редкость и экипировка сохранятся. ${st.changeFree ? 'Первая смена — бесплатно.' : `Цена: ${formatNumber(st.changeCost)} гемов (есть ${formatNumber(gems)}).`}`
        : `${c.name} — фиолетовый без ветки. Выбор бесплатный, первую смену потом тоже можно сделать бесплатно.`,
      ...(st.branch ? { current: st.branch } : {}),
      ...(other ? { selected: other } : {}),
      heroId: hero.id,
      save: session.save,
      // LT-16: гемов на смену не хватает — кнопка серая, причина над ней.
      blocked: () => (change && !st.changeFree && gems < st.changeCost ? `Нужно ${formatNumber(st.changeCost)} гемов, есть ${formatNumber(gems)}` : null),
      confirmLabel: (job) => (!job ? 'Выберите ветку' : change ? (st.changeFree ? `Сменить: ${jobName(job)}` : `Сменить за ${formatNumber(st.changeCost)} гемов`) : `Выбрать: ${jobName(job)}`),
      onConfirm: (job) => {
        try {
          const r = change ? changeBranch(session.save, hero.id, job, GAME) : chooseBranch(session.save, hero.id, job, GAME);
          const spent = 'gems' in r ? (r.gems as number) : 0;
          commit(r.save);
          sfx('job_change');
          this.reopen({ heroId: hero.id, tab: this.tab });
          const sc = this.scene.get('Hero');
          sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, `${c.name} — теперь ${jobName(job)}!${spent ? ` (−${formatNumber(spent)} гемов)` : ''}`, C.success, 3000));
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
    toast(this, hero.locked ? 'Замок снят — карточку можно отдать в корм' : 'Закреплено — карточка не уйдёт в корм', C.success, 2500);
    this.reopen({ heroId: hero.id, tab: this.tab });
  }

  // ---------- статы ----------

  private statsStrip(): void {
    card(this, GAME_W / 2, STATS_Y, 1040, 130, true);
    STAT_KEYS.forEach((k, i) => {
      const cx = 150 + i * 260;
      text(this, cx, STATS_Y - 38, STAT_LABELS[k], FS.caption, C.inkMuted);
      this.ui.stats.push(text(this, cx, STATS_Y + 2, '', FS.h3, C.ink, { fontStyle: 'bold' }).setName(`stat_${k}`));
      this.ui.deltas.push(text(this, cx, STATS_Y + 42, '', FS.caption, C.positive, { fontStyle: 'bold' }));
    });
  }

  // ---------- «Улучшить» / «Вознести» ----------

  private actions(hero: HeroState, c: HeroCard): void {
    card(this, GAME_W / 2, ACT_Y, 1040, 190);
    const info = levelUpInfo(session.save, hero.id, GAME);
    const req = ascendRequirement(session.save, hero.id, GAME);
    const canAscend = ascendReady(session.save, GAME).some((h) => h.id === hero.id);
    if (info.cost) {
      const glow = this.add.image(UP_X, ACT_Y, glowTexture(this)).setDisplaySize(520, 240).setTint(0xffe08a).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      // Ширина 330 и «Вознести» 220 — между кнопками зазор (раньше края заходили друг на друга).
      const up = button(this, UP_X, ACT_Y, 330, 130, 'ui_btn_primary', 'Улучшить', () => {
        if (this.holdFired) {
          this.holdFired = false;
          return;
        }
        this.levelOnce(false);
      }, FS.h2, { sound: null });
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
      if (juiceOn()) this.tweens.add({ targets: glow, scale: glow.scale * 1.08, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      if (info.canLevel && !hintDone('level_up')) hintPointer(this, UP_X, ACT_Y, 'Опыт из запаса — в уровень героя', 'below', { w: 330, h: 130 });
      // Вознесение до предела (призывные — кормом в любой момент; сюжетные — осколками).
      if (req) {
        const asc = button(this, 560, ACT_Y - 18, 220, 96, canAscend ? 'ui_btn_primary' : 'ui_btn_secondary', 'Вознести', () => this.openAscend(), FS.h3);
        asc.container.setName('ascendBtn');
        if (canAscend) pulse(this, asc.container, 1.05);
        else asc.setEnabled(false);
        // Обучение (шаг ascend): «Улучшить» уже показано — теперь «Вознести».
        if (canAscend && !hintDone('ascend') && hintDone('level_up')) tutorialHint(this, 'ascend', 560, ACT_Y - 18, 'above', { w: 220, h: 96 }, { text: 'Три копии — «Вознести»: редкость выше, герой сильнее' });
        const hint = ascendHint(session.save, hero.id, GAME);
        const sub = canAscend ? 'копии готовы!' : (hint?.text ?? 'нужны копии');
        ellipsize(text(this, 560, ACT_Y + 55, sub, FS.caption, canAscend ? C.positive : C.muted, { stroke: C.stroke, strokeThickness: 4 }), 300);
      }
    } else if (req) {
      const glow = this.add.image(UP_X, ACT_Y, glowTexture(this)).setDisplaySize(520, 240).setTint(0xffe08a).setBlendMode(Phaser.BlendModes.ADD).setAlpha(canAscend ? 0.7 : 0);
      if (canAscend && juiceOn()) this.tweens.add({ targets: glow, alpha: 0.3, duration: 800, yoyo: true, repeat: -1 });
      const asc = button(this, UP_X, ACT_Y, 360, 130, canAscend ? 'ui_btn_primary' : 'ui_btn_secondary', 'Вознести', () => this.openAscend(), FS.h2);
      asc.container.setName('ascendBtn');
      if (canAscend) pulse(this, asc.container, 1.04);
    } else {
      text(this, GAME_W / 2, ACT_Y, 'Максимальная редкость и уровень', FS.h3, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
    }
    void c;
  }

  private openAscend(): void {
    this.scene.start('Ascend', { heroId: this.heroId });
  }

  /** Подписи слева от кнопок: цена уровня, запас, чего не хватает / что нужно для вознесения. */
  private renderInfo(hero: HeroState): void {
    this.ui.info.destroy();
    const box = this.add.container(0, 0);
    this.ui.info = box;
    const info = levelUpInfo(session.save, hero.id, GAME);
    const req = ascendRequirement(session.save, hero.id, GAME);
    const x = 50;
    const maxW = info.cost && req ? 380 : 580;
    const line = (y: number, s: string, color: string, size: number = FS.caption, bold = false) =>
      box.add(ellipsize(text(this, x, y, s, size, color, { stroke: C.stroke, strokeThickness: 4, ...(bold ? { fontStyle: 'bold' } : {}) }).setOrigin(0, 0.5), maxW));
    if (info.cost) {
      // NB-17: цена уровня и запас — не «100 / 210» (читалось как прогресс), а «−100 (есть 210)».
      // Не влезает (миллионы в запасе) — шрифт мельче, затем без «есть».
      const price = (y: number, label: string, cost: number, have: number, color: string) => {
        const t = text(this, x, y, `${label} −${formatNumber(cost)} (есть ${formatNumber(have)})`, FS.body, color, { stroke: C.stroke, strokeThickness: 4, fontStyle: 'bold' }).setOrigin(0, 0.5);
        if (t.width > maxW) t.setFontSize(FS.caption - 4);
        if (t.width > maxW) t.setFontSize(FS.body).setText(`${label} −${formatNumber(cost)}`);
        box.add(ellipsize(t, maxW));
      };
      price(ACT_Y - 62, 'Опыт', info.cost.exp, info.pool, info.blocker === 'not_enough_exp' ? C.warning : C.text);
      price(ACT_Y - 18, 'Золото', info.cost.gold, info.gold, info.blocker === 'not_enough_gold' ? C.warning : C.text);
      const short = levelShortage(info);
      if (short) line(ACT_Y + 28, short, C.danger, FS.caption, true);
      else line(ACT_Y + 28, info.affordable > 1 ? `хватит на ${info.affordable} ур.` : 'хватит на 1 уровень', C.positive);
      const toCap = info.maxLevel - info.level;
      line(ACT_Y + 68, `до предела: ${toCap} ур.`, C.dim);
    } else if (req) {
      // LT-07: точная причина — копии или золото (с разделителями разрядов).
      const hint = ascendHint(session.save, hero.id, GAME);
      const note = !hint || hint.ready ? 'Предел редкости — вознесите героя' : hint.text === 'нужны копии' ? 'Нужны копии героя — «Вознести» покажет, где взять' : `Для вознесения ${hint.text}`;
      line(ACT_Y - 50, 'Предел уровня редкости', C.title, FS.body, true);
      box.add(text(this, x, ACT_Y + 20, note, FS.caption, hint && !hint.ready ? C.warning : C.positive, { stroke: C.stroke, strokeThickness: 4, wordWrap: { width: 560 } }).setOrigin(0, 0.5));
    }
  }

  // ---------- обновление без перезапуска (удержание «Улучшить») ----------

  private renderDynamic(prev: Snapshot | null): void {
    const hero = this.hero();
    if (!hero) return;
    const now = this.snapshot(hero);
    const info = levelUpInfo(session.save, hero.id, GAME);
    this.ui.level.setText(levelText(hero.level, info.maxLevel));
    const pct = hero.level / info.maxLevel;
    const target = this.ui.levelBarW * pct;
    if (prev && juiceOn()) this.tweens.add({ targets: this.ui.levelBar, width: target, duration: 220, ease: 'Cubic.easeOut' });
    else this.ui.levelBar.width = target;
    countUp(this, this.ui.power, prev?.power ?? now.power, now.power, formatNumber, { duration: 450 });
    if (prev && now.power > prev.power) this.floatUp(COL_X + 90 + this.ui.power.width + 20, TOP + 368, `+${formatNumber(now.power - prev.power)}`);
    const gear = heroGearStats(session.save, hero.id, GAME);
    const delta = nextLevelDelta(hero, GAME);
    STAT_KEYS.forEach((k, i) => {
      const t = this.ui.stats[i];
      t.setColor(gear[k] ? C.inkInfo : C.ink);
      countUp(this, t, prev?.stats[k] ?? now.stats[k], now.stats[k], formatNumber, { duration: 380 });
      if (prev && now.stats[k] > prev.stats[k]) bump(this, t, 1.12);
      const d = delta?.[k] ?? 0;
      this.ui.deltas[i].setText(d > 0 ? `▲ +${d}` : gear[k] ? `+${gear[k]} экип.` : '').setColor(d > 0 ? C.positive : C.inkInfo);
    });
    if (this.ui.up) {
      this.ui.up.setEnabled(info.canLevel);
      this.ui.upGlow?.setAlpha(info.canLevel ? 0.55 : 0);
    }
    this.renderInfo(hero);
    this.updateGoldPill();
  }

  /** «+123» всплывает и тает. */
  private floatUp(x: number, y: number, s: string, color: string = C.positive): void {
    const t = text(this, x, y, s, FS.h3, color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5).setDepth(500);
    if (!juiceOn()) {
      this.time.delayedCall(900, () => t.destroy());
      return;
    }
    this.tweens.add({ targets: t, y: y - 60, alpha: 0, duration: 1000, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  /** Золото в шапке тратится на уровни — число «таблетки» обновляем на месте (screen.ts называет её pill_gold). */
  private updateGoldPill(): void {
    const pill = this.children.getByName('pill_gold') as Phaser.GameObjects.Container | null;
    const t = pill?.list.find((o) => o.type === 'Text') as Phaser.GameObjects.Text | undefined;
    t?.setText(formatNumber(session.save.resources.gold));
  }

  /** Один уровень. hold — повтор при удержании (без тостов об ошибке). true — уровень поднят. */
  private levelOnce(hold: boolean): boolean {
    const hero = this.hero();
    if (!hero) return false;
    const info = levelUpInfo(session.save, hero.id, GAME);
    if (!info.canLevel) {
      if (!hold) toast(this, levelShortage(info) ?? 'Нельзя улучшить', C.error, 2500);
      return false;
    }
    const prev = this.snapshot(hero);
    try {
      const r = actLevelUp(session.save, today(), hero.id, GAME, 1);
      commit(r.save);
      markHint('level_up');
      sfx('level_up', hold ? { gain: 0.55, rate: 1 + Math.min(0.4, this.holdCount * 0.03) } : {});
      this.levelFx();
      this.renderDynamic(prev);
      const skills = r.events.flatMap((e) => (e.type === 'skillUnlocked' ? [CONTENT.skills[e.skill]?.name ?? e.skill] : []));
      if (skills.length) {
        toast(this, `Новый навык: ${skills.join(', ')}`, C.success, 3000);
        if (this.tab === 'skills') this.renderTab();
      }
      // Упёрлись в предел — на месте «Улучшить» встанет «Вознести».
      if (!levelUpInfo(session.save, hero.id, GAME).cost) {
        this.stopHold();
        this.time.delayedCall(700, () => this.reopen({ heroId: hero.id, tab: this.tab }));
      }
      return true;
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
      return false;
    }
  }

  /** Вспышка уровня: кольцо цвета редкости у ног и подскок фигуры. */
  private levelFx(): void {
    if (!juiceOn()) return;
    const hero = this.hero();
    const col = hero ? rarityPalette(hero.rarity).glow : TINT.gold;
    const ring = this.add.ellipse(FIG_X, FEET_Y, 160, 40).setStrokeStyle(6, col, 1).setDepth(400);
    this.tweens.add({ targets: ring, scaleX: 2.2, scaleY: 2.2, alpha: 0, duration: 450, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    const up = this.add.image(FIG_X, FEET_Y - 180, glowTexture(this)).setDisplaySize(300, 420).setTint(col).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.6).setDepth(401);
    this.tweens.add({ targets: up, alpha: 0, duration: 380, onComplete: () => up.destroy() });
    if (this.figure?.scene && !this.tweens.isTweening(this.figure)) {
      const f = this.figure;
      const y0 = f.y;
      this.tweens.add({ targets: f, y: y0 - 14, duration: 90, yoyo: true, ease: 'Quad.easeOut', onComplete: () => f.scene && f.setY(y0) });
    }
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
    TABS.forEach((t, i) => {
      const on = this.tab === t.id;
      const b = button(this, 195 + i * 345, TABS_Y, 330, 96, on ? 'k:buttonLong_brown' : 'k:buttonLong_beige', t.label, () => {
        if (this.tab === t.id) return;
        this.tab = t.id;
        heroesUi.tab = t.id;
        this.reopen({ heroId: this.heroId, tab: t.id });
      }, FS.h3, { sound: 'ui_tab' });
      b.container.setName(`tab_${t.id}`);
      if (on) b.label.setColor('#f0cf8a');
      // Есть вещи получше — отметка на вкладке «Снаряжение».
      if (t.id === 'gear' && gearUpgrades(session.save, this.heroId, GAME).length) {
        this.add.circle(195 + i * 345 + 140, TABS_Y - 34, 20, TINT.success).setStrokeStyle(3, 0xffffff).setDepth(5);
        text(this, 195 + i * 345 + 140, TABS_Y - 36, '▲', FS.caption - 6, C.text, { fontStyle: 'bold' }).setDepth(6);
      }
    });
    card(this, GAME_W / 2, (TAB_TOP + CONTENT_BOTTOM) / 2, 1040, CONTENT_BOTTOM - TAB_TOP);
    this.tabArea = new ScrollArea(this, TAB_TOP + 8, CONTENT_BOTTOM - 8);
  }

  private renderTab(): void {
    const hero = this.hero();
    if (!hero) return;
    this.tabArea.clear();
    if (this.tab === 'skills') this.skillsTab(hero);
    else if (this.tab === 'gear') this.gearTab(hero);
    else this.storyTab(hero);
  }

  private skillsTab(hero: HeroState): void {
    const a = this.tabArea;
    this.skillRows = 0;
    const c = heroCard(hero, GAME);
    const job0 = CONTENT.jobs[c.job];
    let y = 0;
    // Сила навыков редкости (золотой и красный).
    const power = rarityDef(GAME, hero.rarity).skillPower;
    const nextPow = GAME.cards.rarities.find((r) => r.skillPower > power);
    const note = power !== 1 ? `Сила навыков ×${power} (${c.rarity.name})` : nextPow ? `С редкости «${nextPow.name}» — сила навыков ×${nextPow.skillPower}` : '';
    if (note) {
      a.add(text(this, 60, y + 34, note, FS.caption, power !== 1 ? C.gold : C.dim, { fontStyle: power !== 1 ? 'bold' : 'normal' }).setOrigin(0, 0.5));
      y += 64;
    }
    this.skillRow({ id: job0?.basic ?? '', kind: 'Обычная атака' }, y + SKILL_ROW_H / 2);
    y += SKILL_ROW_H;
    for (const sk of heroSkillList(hero, GAME)) {
      const gate = sk.unlocked ? null : skillRarityGate(sk.level, hero.rarity, GAME);
      this.skillRow(sk.unlocked ? { id: sk.skill, kind: sk.passive ? 'Пассивный' : activeKind(sk.skill) } : { id: sk.skill, kind: '', locked: sk.level, gate: gate?.name }, y + SKILL_ROW_H / 2);
      y += SKILL_ROW_H;
    }
    // Другие формы серым: до фиолетового — обе ветки («после вознесения»), без ветки — обе («выберите ветку»),
    // с веткой — другая ветка («Сменить ветку»).
    const rn = GAME.cards.rarities.find((r) => r.id === (c.branchAt ?? 'purple'))?.name ?? 'Фиолетовый';
    const others = c.branch ? c.branches.filter((b) => b.job !== c.branch) : c.branches;
    for (const b of others) {
      const head = c.branchAt ? `С редкости «${rn}» — ветка ${b.jobName}` : c.branch ? `Другая ветка: ${b.jobName} («Сменить ветку»)` : `Ветка ${b.jobName} — выберите на карточке`;
      a.add(text(this, 60, y + 40, head, FS.body, c.branchAt ? C.title : C.dim, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5).setName(`otherBranch_${b.job}`));
      y += 80;
      for (const s of [...b.skills].sort((p, q) => p.level - q.level)) {
        this.skillRow({ id: s.skill, kind: '', locked: s.level, gate: rn, form: true, note: c.branchAt ? undefined : `ур. ${s.level} · ${c.branch ? 'другая ветка' : 'после выбора'}` }, y + SKILL_ROW_H / 2);
        y += SKILL_ROW_H;
      }
    }
    a.add(text(this, GAME_W / 2, y + 36, 'Нажмите на навык — полное описание и цифры', FS.caption, C.dim));
    y += 72;
    a.setContentHeight(y + 10);
  }

  private skillRow(r: SkillRow, y: number): void {
    const a = this.tabArea;
    const sk = CONTENT.skills[r.id];
    const locked = r.locked !== undefined;
    const h = SKILL_ROW_H;
    // Касание строки — окно с полным описанием и цифрами (в строке описание обрезано до двух строк).
    if (sk) {
      const hit = a.add(this.add.rectangle(GAME_W / 2, y, 1000, h - 6, 0x000000, 0.001).setName(`skillRow_${this.skillRows++}`));
      const hero = this.hero();
      const power = hero ? rarityDef(GAME, hero.rarity).skillPower : 1;
      const kind = r.kind === 'Обычная атака' ? r.kind : sk.trigger ? 'Пассивный' : 'Активный';
      const lockNote = locked ? (r.note ?? (r.form ? `Откроется на ур. ${r.locked} после вознесения` : `Откроется на ур. ${r.locked}${r.gate ? ` · нужен ${r.gate}` : ''}`)) : undefined;
      pressable(this, hit, 1000, h - 6, a.tap(() => {
        a.locked = true;
        openSkillDetail(this, r.id, { kind, lockNote, power, basic: r.kind === 'Обычная атака', onClose: () => (a.locked = false) });
      }));
    }
    const icon = this.add.image(90, y, skillIcon(this, sk)).setDisplaySize(84, 84);
    if (locked) icon.setAlpha(0.45).setTint(0x8a8a8a);
    a.add(icon);
    if (locked) a.add(this.add.image(116, y + 26, skinIcon('lock')).setDisplaySize(34, 34).setTint(0xf0cf8a));
    const kind = r.note ?? (locked ? (r.form ? `ур. ${r.locked} · после вознесения` : `откроется на ур. ${r.locked}${r.gate ? ` · нужен ${r.gate}` : ''}`) : r.kind);
    const kindColor = locked ? (r.gate && !r.form ? C.warning : C.dim) : r.kind.startsWith('КД') ? C.gold : C.success;
    const kindText = a.add(text(this, 1010, y - h * 0.24, kind, FS.caption, kindColor).setOrigin(1, 0.5));
    a.add(ellipsize(text(this, 150, y - h * 0.24, `${sk?.name ?? r.id}`, FS.body, locked ? C.disabled : C.text, { fontStyle: 'bold' }).setOrigin(0, 0.5), Math.max(200, 1010 - 150 - kindText.width - 20)));
    if (sk?.description) {
      a.add(text(this, 150, y + h * 0.18, sk.description, FS.caption, locked ? C.disabled : C.muted, { align: 'left', wordWrap: { width: 860 } }).setOrigin(0, 0.5).setMaxLines(2));
    }
  }

  private gearTab(hero: HeroState): void {
    const a = this.tabArea;
    const slots = heroSlots(session.save, hero.id, GAME);
    const ups = gearUpgrades(session.save, hero.id, GAME);
    SLOTS.forEach((slot, i) => this.gearSlot(hero, slot, slots[slot], 150 + i * 260, 120, ups.some((u) => u.slot === slot)));
    let y = 250;
    if (ups.length) {
      const best = button(this, GAME_W / 2, y + 60, 700, 110, 'ui_btn_primary', `Надеть лучшее (${ups.length})`, () => this.equipBest(hero), FS.h3);
      best.container.setName('equipBestBtn');
      a.add(best.container);
      if (!hintDone('equip_gear')) hintPointer(this, GAME_W / 2, TAB_TOP + 8 + y + 60, 'Наденьте трофеи', 'above', { w: 700, h: 110 });
      y += 130;
    } else {
      a.add(text(this, GAME_W / 2, y + 50, 'Нажмите на слот, чтобы выбрать предмет', FS.caption, C.dim));
      y += 100;
    }
    y = this.refineAllRow(hero, y);
    a.setContentHeight(y + 20);
  }

  /**
   * «Заточить всё надетое»: по одному безопасному шагу (шанс поломки 0) каждому надетому предмету, пока хватает золота
   * (с подтверждением и суммой); рискованные шаги — только вручную в окне предмета. Закрыто — «Откроется на этапе …»;
   * всё на максимуме — подпись; безопасных шагов нет или не хватает золота — неактивная кнопка с подписью почему.
   */
  private refineAllRow(hero: HeroState, y: number): number {
    const a = this.tabArea;
    const worn = Object.values(heroSlots(session.save, hero.id, GAME));
    if (!refineConfig(GAME) || !worn.length) return y;
    if (!refineUnlocked(session.save, GAME)) {
      a.add(text(this, GAME_W / 2, y + 30, `Заточка снаряжения · ${lockedText(session.save, 'refine', GAME)}`, FS.caption, C.dim).setName('refineAllLocked'));
      return y + 70;
    }
    const plan = refineAllPlan(session.save, hero.id, GAME);
    if (!plan.steps.length) {
      if (!plan.safe && !plan.risky) {
        a.add(text(this, GAME_W / 2, y + 30, 'Всё надетое заточено до максимума', FS.caption, C.gold).setName('refineAllNone'));
        return y + 70;
      }
      const off = button(this, GAME_W / 2, y + 60, 760, 110, 'k:buttonLong_grey', 'Заточить всё надетое', () => {}, FS.h3);
      off.setEnabled(false);
      off.container.setName('refineAllBtn');
      a.add(off.container);
      const why = plan.safe ? 'Не хватает золота на безопасные шаги' : 'Безопасных шагов нет: дальше риск поломки —\nточите вручную, нажав на слот';
      a.add(text(this, GAME_W / 2, y + 150, why, FS.caption, C.dim, { lineSpacing: 4 }).setOrigin(0.5, 0).setName('refineAllNone'));
      return y + 160 + (plan.safe ? 40 : 80);
    }
    const n = plan.steps.length;
    const b = button(this, GAME_W / 2, y + 60, 760, 110, 'k:buttonLong_brown', `Заточить всё надетое · ${formatNumber(plan.gold)}`, () => {
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
    }, FS.h3);
    b.container.setName('refineAllBtn');
    a.add(b.container);
    a.add(text(this, GAME_W / 2, y + 150, 'только безопасные шаги · рискованные — вручную', FS.caption, C.dim).setOrigin(0.5, 0).setName('refineAllNote'));
    return y + 200;
  }

  private refineAll(hero: HeroState): void {
    try {
      const r = actRefineAll(session.save, hero.id, GAME);
      commit(r.save);
      sfx('equip', { rate: 1.3 });
      sfx('coin', { delay: 60 });
      this.reopen({ heroId: hero.id, tab: 'gear' });
      const sc = this.scene.get('Hero');
      sc.events.once(Phaser.Scenes.Events.CREATE, () => {
        burst(sc, { x: GAME_W / 2, y: TAB_TOP + 120 });
        toast(sc, `Заточено: ${r.events.length} · −${formatNumber(r.events.reduce((s, e) => s + e.gold, 0))} золота`, C.success, 3000);
      });
    } catch (e) {
      sfx('ui_error');
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private gearSlot(hero: HeroState, slot: Slot, item: ReturnType<typeof heroSlots>[Slot], x: number, y: number, better = false): void {
    const a = this.tabArea;
    const bg = a.add(panel(this, x, y, 244, 200, item ? 'ui_slot_filled' : 'ui_slot_empty'));
    pressable(this, bg, 244, 200, a.tap(() => this.scene.start('Inventory', { heroId: hero.id, slot, heroBack: this.back })));
    a.add(text(this, x, y - 70, SLOT_NAMES[slot], FS.small, C.dim));
    if (better) {
      a.add(this.add.circle(x + 98, y - 76, 22, TINT.success).setStrokeStyle(3, 0xffffff));
      a.add(text(this, x + 98, y - 78, '▲', FS.caption, C.text, { fontStyle: 'bold' }));
    }
    if (!item) {
      a.add(text(this, x, y + 10, '+', 72, C.placeholder, { fontStyle: 'bold' }));
      return;
    }
    const color = RARITY_COLORS[item.def.rarity];
    a.add(this.add.rectangle(x, y - 46, 200, 5, Phaser.Display.Color.HexStringToColor(color).color));
    const lvl = refineLevel(item.instance);
    a.add(ellipsize(text(this, x, y + 5, refinedName(item.def, lvl), FS.body, color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }), 226));
    a.add(text(this, x, y + 62, itemStatsText(refinedStats(item.def, lvl, GAME)), FS.caption, C.text, { stroke: C.stroke, strokeThickness: 4, wordWrap: { width: 230 } }).setMaxLines(2));
  }

  /** T1-08: надеть все улучшения из инвентаря (свободные вещи получше надетых). */
  private equipBest(hero: HeroState): void {
    try {
      const r = actEquipBest(session.save, hero.id, GAME);
      commit(r.save);
      markHint('equip_gear');
      sfx('equip');
      const names = r.equipped.map((u) => GAME.equipment.items[u.itemId]?.name ?? u.itemId);
      this.reopen({ heroId: hero.id, tab: 'gear' });
      const sc = this.scene.get('Hero');
      sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, `${heroCard(hero, GAME).name}: надето — ${names.join(', ')}`, C.success, 3000));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private storyTab(hero: HeroState): void {
    const a = this.tabArea;
    const c = heroCard(hero, GAME);
    let y = 20;
    const para = (s: string, color: string, size: number = FS.body, style: Phaser.Types.GameObjects.Text.TextStyle = {}) => {
      const t = a.add(text(this, 60, y, s, size, color, { align: 'left', wordWrap: { width: 950 }, lineSpacing: 6, ...style }).setOrigin(0, 0));
      y += t.height + 22;
    };
    const head = (s: string, color: string = C.title) => {
      const t = a.add(text(this, 60, y, s, FS.h3, color, { align: 'left', fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5, wordWrap: { width: 950 } }).setOrigin(0, 0));
      y += t.height + 14;
    };
    // Начало пути (первая профессия), затем — форма после возвышения: выбранная ветка целиком, другая — превью серым.
    const firstJob = jobTitle(GAME, heroTemplate(GAME, hero.templateId).job, c.gender);
    if (c.branch && firstJob) head(`Начало пути: ${firstJob}`);
    para(c.bio, C.text);
    if (c.hook) para(`«${c.hook}»`, C.title, FS.body, { fontStyle: 'italic' });
    const rn = GAME.cards.rarities.find((r) => r.id === (c.branchAt ?? 'purple'))?.name ?? 'Фиолетовый';
    const chosen = c.branches.find((b) => b.job === c.branch);
    const branchStory = (b: (typeof c.branches)[number], dim: boolean) => {
      if (b.promotion) para(`«${b.promotion}»`, dim ? C.dim : C.title, FS.body, { fontStyle: 'italic' });
      if (b.bio) para(b.bio, dim ? C.muted : C.text);
    };
    if (chosen) {
      y += 10;
      head(`После возвышения: ${chosen.jobName}`);
      branchStory(chosen, false);
    }
    const others = c.branches.filter((b) => b !== chosen);
    if (others.length) {
      y += 10;
      head(chosen ? 'Другая ветка (можно сменить)' : 'После возвышения — на выбор', C.dim);
      if (!chosen) para(`Ветку второй профессии выбирают на редкости «${rn}».`, C.dim, FS.caption);
      for (const b of others) {
        head(b.jobName, C.muted);
        branchStory(b, true);
      }
    }
    y += 10;
    para(`${c.gender === 'f' ? 'Героиня' : 'Герой'} гильдии ${GUILD_NAMES[c.line] ?? '—'} · ${c.source === 'story' ? 'сюжет' : 'Таверна'} · растёт до ${RARITY_GEN[c.maxRarity] ?? rarityDef(GAME, c.maxRarity).name.toLowerCase()}`, C.dim, FS.caption);
    para('Растёт копиями: копии этого героя (и любых — на красный) уходят в корм при вознесении.', C.muted, FS.caption);
    for (const s of copySources(session.save, hero.templateId, GAME)) para(`• ${s}`, C.muted, FS.caption);
    a.setContentHeight(y + 10);
  }
}

interface SkillRow {
  id: string;
  kind: string;
  /** Уровень открытия (закрытый навык). */
  locked?: number;
  /** Нужна редкость (уровень выше предела текущей). */
  gate?: string;
  /** Навык второй профессии (после вознесения). */
  form?: boolean;
  /** Своя подпись справа вместо «откроется на ур. N». */
  note?: string;
}

/** Подпись активного навыка: перезарядка и каст (например «КД 5 с · каст 2 с»). */
function activeKind(id: string): string {
  const sk = CONTENT.skills[id];
  const cd = sk?.cooldown ?? COMBAT.skills?.defaultCooldown ?? 8;
  const parts = [cd > 0 ? `КД ${cd} с` : 'КД нет'];
  if (sk?.castTime) parts.push(`каст ${sk.castTime} с`);
  return parts.join(' · ');
}
