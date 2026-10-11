import Phaser from 'phaser';
import { autoFormation, autoFormationForStage, dropText, enemySquad, mealExp, replayAllowed, resolveStageEnemies, getStage, setSquad, stageCardDrop, stageStatus } from '../../core';
import { heroCardIcon } from '../heroCard';
import { CONTENT, GAME } from '../content';
import { currentStage, shortfallHint, stageNeeds, stageNo, wallAdvice, type StageNeeds, type WallAction } from '../flow';
import { GAME_W } from '../layout';
import { COMBAT as COMBAT_CFG } from '../../core';
import { CONTENT_TOP, cta, powerCompare, screen, updatePowerCompare } from '../screen';
import { commit, now, session, today } from '../session';
import { BTN, button, clampLines, ellipsize, infoButton, pressable, rewardRow, ScrollArea, tag, text, toast, tutorialHint, type ButtonView, type ChipSpec } from '../ui';
import { monsterTeaser, roleName } from '../loreView';
import { ctaShine } from '../decor';
import { markHint, pickPrepHint } from '../hints';
import { startStageBattle } from '../dialogue';
import { squadDefs } from './BattleScene';
import { mealTag } from '../kitchenEntry';
import { FormationEditor } from '../squadEditor';
import { bump } from '../juice';
import { C, COLOR, S, T } from '../theme';
import { enemyTraits } from '../../core/behavior';
import { defenseElement, ELEMENT_NAMES } from '../../core/elements';
import { elementBadge } from '../battleElements';
import { scoutSheet } from '../scoutView';
import type { HeroCardDrop } from '../../core';
import { encounterThreat } from '../tactics';
import { squadChoices } from '../squadChoice';
import { showSquadChoices } from '../squadChoiceView';
import { onViewChange, view } from '../viewport';
import { prepFooterY, stagePrepLayout } from '../prepLayout';

// Аудит 11.10: одна полоса под полем (предупреждение редактора → совет стены → угроза), поле ниже, «В бой» у низа
// безопасной области — списку героев 2 полных ряда на 360×740 и 460×1000 (prepLayout.ts stagePrepLayout).
const base = stagePrepLayout();
const L = { ...base, roster: { top: base.rosterTop, bottom: base.rosterTop + 516 } };
/** Цель нажатия ряда наград — не уже двух стандартных целей. */
const TOUCH_W = 2 * 96;

/** Что сейчас в полосе под полем (кроме строки редактора): угроза встречи, совет стены или ничего. */
type BandMode = 'none' | 'threat' | 'wall';

/** Шанс карты героя: «6%», «×1», «≈1.5» (как dropText ядра, только число). */
function dropValue(x: number): string {
  return x >= 1 && Number.isInteger(x) ? `×${x}` : x >= 1 ? `≈${x}` : `${Math.round(x * 1000) / 10}%`;
}

/** Награды этапа чипами: золото, опыт в запас, шанс карт героя (значок карты нужной редкости). */
export function stageRewardChips(gold: number, exp: number, drop: HeroCardDrop | undefined): ChipSpec[] {
  const items: ChipSpec[] = [];
  if (gold > 0) items.push({ icon: 'gold', value: gold, tone: 'gold' });
  if (exp > 0) items.push({ icon: 'hero_exp', value: exp });
  for (const r of ['blue', 'purple'] as const) {
    const p = drop?.[r] ?? 0;
    // «карта 6%», а не «? 6%»: значок «?» читался как «неизвестная награда» (аудит 11.10).
    if (p > 0) items.push({ icon: (s, x, y, size) => heroCardIcon(s, x, y, size, r), value: `карта ${dropValue(p)}`, tone: 'info' });
  }
  return items;
}

/**
 * Подготовка к этапу в духе AFK Arena: в шапке — «4-6 · Врата пирамиды», под ней — награды чипами; поле — ваш отряд
 * слева, противник справа, как встанут в бою; над полем — мощь отряда (галка, когда хватает; «Не хватает N» и нужный
 * уровень героев — когда нет), «i» — лист разведки. Снизу — все герои карточками, «Авто», «Пресеты» и одна главная
 * кнопка «В бой». Сюжет beforeStage — по «В бой».
 */
export class StageScene extends Phaser.Scene {
  private stageId!: string;
  private editor!: FormationEditor;
  private fightBtns: ButtonView[] = [];
  /** Кнопки низа без условия «есть отряд» (пройденный этап: «К текущему этапу»). */
  private footerBtns: ButtonView[] = [];
  private autoHint: Phaser.GameObjects.Container | null = null;
  private power: Phaser.GameObjects.Container | null = null;
  private shortText: Phaser.GameObjects.Text | null = null;
  private wasShort: boolean | null = null;
  private threatText: Phaser.GameObjects.Text | null = null;
  private tacticText: Phaser.GameObjects.Text | null = null;
  private bandZone: Phaser.GameObjects.Zone | null = null;
  private bandMode: BandMode = 'none';
  private bandBusy: boolean | null = null;
  private threat: { text: string; advice: string } | null = null;
  private wall: { text: string; action: WallAction } | null = null;
  private choosingSquad = false;
  private body!: ScrollArea;
  /** «В бой» — у низа безопасной области вытянутого экрана (как Таверна и итоги), не над пустой полосой. */
  private get fightY(): number { return prepFooterY(view()); }

  constructor() {
    super('Stage');
  }

  create(data: { stageId: string }): void {
    this.stageId = data.stageId;
    this.autoHint = null;
    this.power = null;
    this.shortText = null;
    this.wasShort = null;
    this.threatText = null;
    this.tacticText = null;
    this.bandZone = null;
    this.bandMode = 'none';
    this.bandBusy = null;
    this.threat = null;
    this.wall = null;
    this.choosingSquad = false;
    this.fightBtns = [];
    this.footerBtns = [];
    const stage = getStage(GAME, this.stageId);
    // «Назад» — в главу этого этапа, а не в текущую главу игрока.
    const chapter = Math.max(0, CONTENT.chapters.findIndex((c) => c.id === stage.chapter));
    screen(this, `${stageNo(stage, GAME)} · ${stage.name}`, null, { to: 'Campaign', data: { chapter } });
    const beforeBody = new Set(this.children.list);
    this.body = new ScrollArea(this, CONTENT_TOP, this.fightY - 120);
    this.body.content.setName('stageBody');

    // --- Награда: один ряд чипов. Пройденный этап (как в AFK Arena) — только просмотр: «Пройдено» вместо наград ---
    const first = stageStatus(session.save, this.stageId, GAME) !== 'cleared';
    if (first) {
      const drop = stageCardDrop(stage, true, GAME);
      const row = rewardRow(this, GAME_W / 2, L.rewardY, stageRewardChips(stage.rewards.gold, mealExp(stage.rewards.jobExp, session.save, today(), GAME), drop), { size: 's' }).setName('stageRewards');
      // Касание наград — что это за чипы (шанс карты героя — словами).
      const cards = dropText(drop);
      const rw = Math.max(TOUCH_W, row.width + S.l);
      const rz = this.add.zone(GAME_W / 2, L.rewardY, rw, 88).setName('stageRewardsZone');
      pressable(this, rz, rw, 88, () => toast(this, `Награда за первую победу: золото, опыт героев${cards ? `, ${cards}` : ''}.`, C.title, 4000));
    } else {
      tag(this, GAME_W / 2, L.rewardY, 'Пройдено', 'positive', { solid: true }).setName('stageCleared');
    }

    // --- Поле (отряд против противника) и список героев ---
    // Уровни врагов поштучно не показываем (см. flow.ts stageNeeds): одно число — в листе разведки.
    const enemies = enemySquad(this.stageId, GAME, session.save.campaignChoices);
    this.editor = new FormationEditor(this, {
      // Ряд мощи и «Героям нужен ур. N» рисует сцена (powerCompare и строка нехватки).
      chrome: false,
      field: L.field,
      enemies,
      roster: L.roster,
      scrollBody: { area: this.body, origin: CONTENT_TOP },
      // «Авто» и «Пресеты» — те же кнопки-иконки, что на экране «Отряд» (аудит 11.10, ui-core 12).
      rosterHead: {
        y: L.rosterHeadY,
        onAuto: () => this.auto(),
        onPresets: () => this.scene.start('Squad', { back: { to: 'Stage', data: { stageId: this.stageId } }, presets: true }),
      },
      onChange: () => this.onSquadChange(),
    });

    // Полоса над полем: мощь (обновляется в onSquadChange), «БОСС» и «i» разведки.
    const needs = stageNeeds(session.save, this.stageId, GAME, today());
    this.power = powerCompare(this, 56, L.powerY, needs.own, needs.power, { align: 'left' });
    this.shortText = text(this, 60, L.shortY, '', T.caption, COLOR.negative, { fontStyle: 'bold' }).setOrigin(0, 0.5).setName('stageShort');
    this.shortText.setShadow(0, 2, 'rgba(0,0,0,0.8)', 4, false, true);
    // Касание мощи — тот же лист разведки (там нужная мощь и уровень).
    const pz = this.add.zone(284, L.powerY + 16, 480, 96).setName('stagePowerZone');
    pressable(this, pz, 480, 96, () => this.openScout());
    const info = infoButton(this, GAME_W - 76, L.powerY, () => this.openScout()).setName('stageScoutInfo');
    const boss = stage.boss ? tag(this, info.x - 48 - S.xs, L.powerY, 'БОСС', 'negative', { solid: true, align: 'right' }).setName('stageBoss') : null;
    // Блюдо дня (Кухня) — тег левее «БОСС» и «i»; не влезает рядом с мощью — строкой ниже, справа.
    const meal = mealTag(this, (boss ? boss.x - boss.width / 2 : info.x - 48) - S.xs, L.powerY);
    if (meal && this.power && meal.x - meal.width / 2 < 56 + this.power.width + S.xs) meal.setPosition(GAME_W - S.l - meal.width / 2, L.shortY + S.s);

    // Полоса под полем — одна на три сообщения (аудит 11.10): строка редактора (предупреждение, заметка «Авто») главнее,
    // затем совет стены (мощи мало — что делать и когда вернуться), затем угроза встречи. Касание: угроза — разведка,
    // совет — нужный экран.
    this.threatText = text(this, GAME_W / 2, L.band.titleY, '', T.caption, COLOR.title, { fontStyle: 'bold' }).setName('stageThreat');
    // Совет — до двух строк (не обрезается на полуслове).
    this.tacticText = text(this, GAME_W / 2, L.band.adviceY, '', T.caption - 6, COLOR.textSecondary, { wordWrap: { width: GAME_W - 2 * S.l }, align: 'center' }).setOrigin(0.5, 0).setName('stageTactic');
    const bandZone = this.add.zone(GAME_W / 2, L.band.y, GAME_W - 2 * S.l, L.band.zoneH).setName('stageThreatZone');
    pressable(this, bandZone, GAME_W - 2 * S.l, L.band.zoneH, () => this.tapBand());
    this.bandZone = bandZone;

    this.editor.draw();
    this.enemyTaps(resolveStageEnemies(stage, session.save.campaignChoices).map((e) => e?.unit ?? null));
    this.editor.addToBody(this.children.list.filter(o => !beforeBody.has(o)));

    // Песочница адвансов (повторы включены) сражается и на пройденных этапах — одной кнопкой «В бой», без бюджета наград.
    if (first || replayAllowed(GAME)) {
      const fight = cta(this, GAME_W / 2, this.fightY, 'В бой', () => this.fight(), { w: 640 });
      ctaShine(this, fight.container, 640, 140);
      this.fightBtns = [fight];
    } else {
      // Пройденный этап не сражается (progression.campaign.replay: false): одна вторичная кнопка — к текущему этапу.
      const cur = currentStage(session.save, GAME);
      const toCurrent = cur && cur.id !== this.stageId && stageStatus(session.save, cur.id, GAME) === 'open' ? cur : undefined;
      const go = button(this, GAME_W / 2, this.fightY, 640, BTN.cta, '', toCurrent ? 'К текущему этапу' : 'К кампании', () => {
        if (toCurrent) this.scene.start('Stage', { stageId: toCurrent.id });
        else this.scene.start('Campaign', { chapter });
      }, T.body, { variant: 'secondary' });
      go.container.setName('stageToCurrent');
      this.fightBtns = [];
      this.footerBtns = [go];
    }
    this.onSquadChange();
    // R: подсказка новичку — первый бой. После отряда: hintPointer обходит все кнопки, слоты и карточки сцены.
    // Обучение: после Таверны сильнейшие герои вне отряда — сначала «Авто» (prep_auto), иначе «В бой».
    const ids = (sq: readonly (string | null)[]) => JSON.stringify(sq.filter(Boolean).sort());
    const benchStronger = ids(autoFormation(session.save, GAME)) !== ids(session.save.squad);
    // Пройденный этап — только просмотр: подсказок подготовки к бою там нет.
    const hint = first ? pickPrepHint({ first, benchStronger, summoned: session.save.summon.firstTenDone }) : null;
    const autoBtn = this.children.getByName('autoBtn') as Phaser.GameObjects.Container | null;
    if (hint === 'prep_auto' && autoBtn) {
      this.body.offset = Math.max(0, L.rosterHeadY - (this.fightY - 280));
      this.autoHint = tutorialHint(this, hint, autoBtn.x, L.rosterHeadY - this.body.offset, 'above', { w: (autoBtn.getData('w') as number | undefined) ?? 220, h: 88 });
      if (this.autoHint && this.body.content.mask) this.autoHint.setMask(this.body.content.mask);
      this.refreshBand();
      this.autoHint?.once(Phaser.GameObjects.Events.DESTROY, () => this.refreshBand());
    }
    const fightHint = hint === 'stage_fight' ? tutorialHint(this, hint, GAME_W / 2, this.fightY, 'above', { w: 640, h: 140 }) : null;
    let hintOffset = this.body.offset;
    const followAutoHint = () => {
      // Строка редактора заняла / освободила полосу — угроза или совет стены возвращаются.
      if (this.editor.rowBusy !== this.bandBusy) this.refreshBand();
      if (!this.autoHint?.scene) return;
      this.autoHint.y += hintOffset - this.body.offset;
      hintOffset = this.body.offset;
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, followAutoHint);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, followAutoHint));
    let footerY = this.fightY;
    onViewChange(this, () => {
      const delta = this.fightY - footerY;
      for (const b of [...this.fightBtns, ...this.footerBtns]) b.container.setY(this.fightY);
      if (fightHint?.scene) fightHint.y += delta;
      footerY = this.fightY;
      this.editor.setBodyBounds(CONTENT_TOP, this.fightY - 120);
      followAutoHint();
    });
  }

  /** Лист разведки: нужная мощь, уровень врагов (и нужный уровень героев при нехватке), враги по видам. */
  private openScout(): void {
    if (this.editor.locked) return;
    const before = new Set(this.children.list);
    this.editor.locked = true;
    this.body.locked = true;
    const needs = stageNeeds(session.save, this.stageId, GAME, today());
    scoutSheet(this, enemySquad(this.stageId, GAME, session.save.campaignChoices), Object.values(squadDefs(session.save)), needs);
    const unlock = () => { this.editor.locked = false; this.body.locked = false; };
    const modal = this.children.list.find(o => !before.has(o) && o.getData('screenModal'));
    if (modal) modal.once(Phaser.GameObjects.Events.DESTROY, unlock);
    else unlock();
  }

  /**
   * Нажатие на врага на поле — подсказка из Летописи: имя, прозвище и первая фраза (data/lore/monsters.json);
   * записи нет — имя и роль. Места врагов — те же, что рисует FormationEditor (enemySlots).
   */
  private enemyTaps(unitIds: (string | null)[]): void {
    const points = this.editor['enemySlots'] as readonly { x: number; y: number }[];
    unitIds.forEach((id, i) => {
      const p = points[i];
      const unit = id ? CONTENT.units[id] : undefined;
      if (!unit || !p) return;
      const zone = this.add.zone(p.x, p.y + 10, 190, 170).setName(`enemyInfo${i}`);
      pressable(this, zone, 190, 170, () => {
        const teaser = monsterTeaser(unit.id);
        const traits = enemyTraits(unit, CONTENT, GAME.combat ?? COMBAT_CFG);
        const el = defenseElement(unit);
        const extra = [el !== 'neutral' ? `стихия: ${ELEMENT_NAMES[el]}` : '', ...traits.slice(0, 2)].filter(Boolean).join(', ');
        const head = teaser ? `${unit.name} — ${teaser}` : `${unit.name} · ${roleName(unit)}`;
        toast(this, extra ? `${head}\n${extra}` : head, C.title, 5000, 'middle');
      });
      // Стихия врага — маленький значок у фигуры (слева сверху).
      const el = defenseElement(unit);
      if (el !== 'neutral') elementBadge(this, p.x - 74, p.y - 30, el, 34).setDepth(3);
    });
  }

  /** После каждого изменения отряда: доступность «В бой», мощь против нужной, подпись нехватки; без инструкций. */
  private onSquadChange(): void {
    const save = session.save;
    const ready = save.squad.some(Boolean);
    for (const b of this.fightBtns) b.setEnabled(ready);
    if (!this.power?.scene) return;
    const needs: StageNeeds = stageNeeds(save, this.stageId, GAME, today());
    updatePowerCompare(this.power, needs.own, needs.power);
    this.shortText?.setText(needs.short ? shortfallHint(needs.short) : '');
    const short = needs.own < needs.power;
    if (this.wasShort !== null && this.wasShort !== short) bump(this, this.power, 1.08);
    this.wasShort = short;
    this.threat = encounterThreat(enemySquad(this.stageId, GAME, session.save.campaignChoices), Object.values(squadDefs(save)), GAME);
    // Совет стены — только перед первой победой (пройденный этап — просмотр).
    this.wall = stageStatus(save, this.stageId, GAME) !== 'cleared' ? wallAdvice(save, this.stageId, GAME, now(), today()) : null;
    this.refreshBand();
  }

  /** Полоса под полем: строка редактора занята — пусто; иначе совет стены, иначе угроза. */
  private refreshBand(): void {
    if (!this.threatText?.scene || !this.tacticText?.scene) return;
    const busy = this.editor.rowBusy;
    this.bandBusy = busy;
    const mode: BandMode = busy ? 'none' : this.wall ? 'wall' : this.threat ? 'threat' : 'none';
    this.bandMode = mode;
    const title = mode === 'wall' ? 'Мощи мало — что поможет' : mode === 'threat' ? this.threat!.text : '';
    const advice = mode === 'wall' ? `${this.wall!.text}${this.wall!.action ? ' ›' : ''}` : mode === 'threat' ? this.threat!.advice : '';
    this.threatText.setText(title).setColor(mode === 'wall' ? COLOR.warning : COLOR.title);
    this.tacticText.setText(advice).setColor(mode === 'wall' ? COLOR.textPrimary : COLOR.textSecondary);
    ellipsize(this.threatText, GAME_W - 2 * S.l);
    clampLines(this.tacticText, 2);
    const tappable = mode === 'threat' || (mode === 'wall' && !!this.wall?.action);
    // Пока висит подсказка «Авто», полоса — не цель нажатия: плашке подсказки нужно место над кнопкой.
    if (this.bandZone?.input) this.bandZone.input.enabled = tappable && !this.autoHint?.scene;
  }

  /** Касание полосы: угроза — лист разведки, совет стены — экран, где это делается. */
  private tapBand(): void {
    if (this.editor.locked) return;
    if (this.bandMode === 'threat') return this.openScout();
    const action = this.bandMode === 'wall' ? this.wall?.action : null;
    if (action) this.scene.start(action);
  }

  /** A real fifth-slot trade-off after summoning; smaller rosters keep the one-tap auto setup. */
  private auto(): void {
    if (this.choosingSquad) return;
    const options = squadChoices(session.save, GAME);
    if (options.length) {
      this.choosingSquad = true;
      this.editor.locked = true;
      this.body.locked = true;
      showSquadChoices(this, options, (option) => {
        markHint('prep_auto');
        this.autoHint?.destroy();
        this.autoHint = null;
        commit(setSquad(session.save, option.squad));
        this.editor.replaced();
      }, () => {
        this.choosingSquad = false;
        this.editor.locked = false;
        this.body.locked = false;
      });
      return;
    }
    markHint('prep_auto');
    this.autoHint?.destroy();
    this.autoHint = null;
    commit({ ...session.save, squad: autoFormationForStage(session.save, this.stageId, GAME, { day: today() }) });
    this.editor.replaced('Отряд расставлен автоматически');
  }

  private fight(): void {
    if (!session.save.squad.some(Boolean)) {
      toast(this, 'Поставьте в отряд хотя бы одного героя');
      return;
    }
    markHint('stage_fight');
    // Сюжет перед первым боем этапа (и вступление главы) — потом бой.
    startStageBattle(this, this.stageId);
  }
}
