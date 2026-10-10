import Phaser from 'phaser';
import { actSkipStage, autoFormation, enemySquad, mealExp, resolveStageEnemies, getStage, setSquad, stageCardDrop, stageStatus, replayAllowance } from '../../core';
import { heroCardIcon } from '../heroCard';
import { CONTENT, GAME } from '../content';
import { shortfallHint, stageNeeds, stageNo, stageSeed, type StageNeeds } from '../flow';
import { GAME_W } from '../layout';
import { COMBAT as COMBAT_CFG } from '../../core';
import { CONTENT_TOP, cta, powerCompare, screen, updatePowerCompare } from '../screen';
import { commit, session, today } from '../session';
import { BTN, button, clampLines, ellipsize, infoButton, pressable, rewardRow, ScrollArea, tag, text, toast, tutorialHint, type ButtonView, type ChipSpec } from '../ui';
import { monsterTeaser, roleName } from '../loreView';
import { ctaShine } from '../decor';
import { markHint, pickPrepHint } from '../hints';
import { startStageBattle } from '../dialogue';
import { squadDefs, type ResultData } from './BattleScene';
import { mealTag } from '../kitchenEntry';
import { FormationEditor } from '../squadEditor';
import { bump } from '../juice';
import { C, COLOR, FAMILY, S, T } from '../theme';
import { enemyTraits } from '../../core/behavior';
import { defenseElement, ELEMENT_NAMES } from '../../core/elements';
import { elementBadge } from '../battleElements';
import { scoutSheet } from '../scoutView';
import type { HeroCardDrop } from '../../core';
import { encounterThreat } from '../tactics';
import { squadChoices } from '../squadChoice';
import { showSquadChoices } from '../squadChoiceView';
import { onViewChange, view } from '../viewport';
import { formationBodyRows } from '../prepLayout';

import { STAGE_LAYOUT as BASE_LAYOUT } from '../stageLayout';

// Предупреждение о расстановке, угроза и кнопки ростера имеют отдельные цели нажатия.
const bodyRows = formationBodyRows(BASE_LAYOUT.field.bottom, true);
const L = {
  ...BASE_LAYOUT,
  threat: bodyRows.threat,
  rosterHeadY: bodyRows.rosterHeadY,
  roster: { top: bodyRows.rosterTop, bottom: bodyRows.rosterTop + BASE_LAYOUT.roster.bottom - BASE_LAYOUT.roster.top },
};

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
    if (p > 0) items.push({ icon: (s, x, y, size) => heroCardIcon(s, x, y, size, r), value: dropValue(p), tone: 'info' });
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
  private autoHint: Phaser.GameObjects.Container | null = null;
  private power: Phaser.GameObjects.Container | null = null;
  private shortText: Phaser.GameObjects.Text | null = null;
  private wasShort: boolean | null = null;
  private threatText: Phaser.GameObjects.Text | null = null;
  private tacticText: Phaser.GameObjects.Text | null = null;
  private choosingSquad = false;
  private body!: ScrollArea;
  private get fightY(): number { return view().uiHeight - 110; }

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
    this.choosingSquad = false;
    this.fightBtns = [];
    const stage = getStage(GAME, this.stageId);
    // «Назад» — в главу этого этапа, а не в текущую главу игрока.
    const chapter = Math.max(0, CONTENT.chapters.findIndex((c) => c.id === stage.chapter));
    screen(this, `${stageNo(stage, GAME)} · ${stage.name}`, null, { to: 'Campaign', data: { chapter } });
    const beforeBody = new Set(this.children.list);
    this.body = new ScrollArea(this, CONTENT_TOP, this.fightY - 120);
    this.body.content.setName('stageBody');

    // --- Награда: один ряд чипов (повтор — уже с множителем повтора) ---
    const first = stageStatus(session.save, this.stageId, GAME) !== 'cleared';
    const replay = replayAllowance(session.save, today(), GAME);
    const k = first ? 1 : replay.remaining > 0 ? GAME.progression.campaign.replayRewardMultiplier : 0;
    const drop = first || replay.remaining > 0 ? stageCardDrop(stage, first, GAME) : undefined;
    rewardRow(this, GAME_W / 2, L.rewardY, stageRewardChips(Math.floor(stage.rewards.gold * k), mealExp(Math.floor(stage.rewards.jobExp * k), session.save, today(), GAME), drop), { size: 's' }).setName('stageRewards');
    if (!first) {
      if (!replay.remaining) text(this, GAME_W / 2, L.rewardY, 'Тренировка · без добычи', T.caption, COLOR.textSecondary).setName('stagePractice');
      text(this, GAME_W / 2, L.rewardY + 48, replay.remaining > 0 ? `Добыча за повторы: ещё ${replay.remaining} из ${replay.limit} побед сегодня` : `Сегодня получены все ${replay.limit} наград за повторы`, T.caption, COLOR.textSecondary).setName('stageReplayBudget');
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
      onChange: () => this.onSquadChange(),
    });

    // Полоса над полем: мощь (обновляется в onSquadChange), «БОСС» и «i» разведки.
    const needs = stageNeeds(session.save, this.stageId, GAME);
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

    // Угроза видна без открытия разведки; спокойная строка не перекрывает сюжет и обучение.
    this.threatText = text(this, GAME_W / 2, L.threat.titleY, '', T.caption, COLOR.title, { fontStyle: 'bold' }).setName('stageThreat');
    // Совет — до двух строк (не обрезается на полуслове); верх строки — там, где была середина одной строки.
    this.tacticText = text(this, GAME_W / 2, L.threat.adviceY - 18, '', T.caption - 6, COLOR.textSecondary, { wordWrap: { width: GAME_W - 2 * S.l }, align: 'center' }).setOrigin(0.5, 0).setName('stageTactic');
    const threatZone = this.add.zone(GAME_W / 2, L.threat.zoneY, GAME_W - 2 * S.l, L.threat.zoneH).setName('stageThreatZone');
    pressable(this, threatZone, GAME_W - 2 * S.l, L.threat.zoneH, () => this.openScout());

    // --- Список героев: заголовок, «Авто» и «Пресеты» — вторичные ---
    text(this, S.l, L.rosterHeadY, 'Герои', T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
    const autoX = GAME_W - S.l - 260 - S.xs - 110;
    button(this, autoX, L.rosterHeadY, 220, BTN.m, '', 'Авто', () => this.auto(), T.body, { variant: 'secondary' }).container.setName('autoBtn');
    button(this, GAME_W - S.l - 130, L.rosterHeadY, 260, BTN.m, '', 'Пресеты', () =>
      this.scene.start('Squad', { back: { to: 'Stage', data: { stageId: this.stageId } }, presets: true }),
    T.body, { variant: 'secondary' }).container.setName('presetsBtn');

    this.editor.draw();
    this.enemyTaps(resolveStageEnemies(stage, session.save.campaignChoices).map((e) => e?.unit ?? null));
    this.editor.addToBody(this.children.list.filter(o => !beforeBody.has(o)));

    if (first) {
      const fight = cta(this, GAME_W / 2, this.fightY, 'В бой', () => this.fight(), { w: 640 });
      ctaShine(this, fight.container, 640, 140);
      this.fightBtns = [fight];
    } else {
      // K7: пройденный этап можно повторить с просмотром боя или сразу получить итог.
      const skip = button(this, GAME_W / 2 - 260, this.fightY, 460, BTN.cta, '', 'Быстрый бой', () => this.skipBattle(), T.body, { variant: 'secondary' });
      const again = cta(this, GAME_W / 2 + 250, this.fightY, replay.remaining > 0 ? 'Повторить' : 'Тренировка', () => this.fight(), { w: 480, h: BTN.cta });
      this.fightBtns = [skip, again];
    }
    this.onSquadChange();
    // R: подсказка новичку — первый бой. После отряда: hintPointer обходит все кнопки, слоты и карточки сцены.
    // Обучение: после Таверны сильнейшие герои вне отряда — сначала «Авто» (prep_auto), иначе «В бой».
    const ids = (sq: readonly (string | null)[]) => JSON.stringify(sq.filter(Boolean).sort());
    const benchStronger = ids(autoFormation(session.save, GAME)) !== ids(session.save.squad);
    const hint = pickPrepHint({ first, benchStronger, summoned: session.save.summon.firstTenDone });
    if (hint === 'prep_auto') {
      this.body.offset = Math.max(0, L.rosterHeadY - (this.fightY - 280));
      this.autoHint = tutorialHint(this, hint, autoX, L.rosterHeadY - this.body.offset, 'above', { w: 220, h: BTN.m });
      if (this.autoHint && this.body.content.mask) this.autoHint.setMask(this.body.content.mask);
    }
    const fightHint = hint === 'stage_fight' ? tutorialHint(this, hint, GAME_W / 2, this.fightY, 'above', { w: 640, h: 140 }) : null;
    let hintOffset = this.body.offset;
    const followAutoHint = () => {
      if (!this.autoHint?.scene) return;
      this.autoHint.y += hintOffset - this.body.offset;
      hintOffset = this.body.offset;
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, followAutoHint);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, followAutoHint));
    let footerY = this.fightY;
    onViewChange(this, () => {
      const delta = this.fightY - footerY;
      for (const b of this.fightBtns) b.container.setY(this.fightY);
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
    const needs = stageNeeds(session.save, this.stageId, GAME);
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
    const needs: StageNeeds = stageNeeds(save, this.stageId, GAME);
    updatePowerCompare(this.power, needs.own, needs.power);
    this.shortText?.setText(needs.short ? shortfallHint(needs.short) : '');
    const short = needs.own < needs.power;
    if (this.wasShort !== null && this.wasShort !== short) bump(this, this.power, 1.08);
    this.wasShort = short;
    const threat = encounterThreat(enemySquad(this.stageId, GAME, session.save.campaignChoices), Object.values(squadDefs(save)), GAME);
    this.threatText?.setText(threat?.text ?? '');
    this.tacticText?.setText(threat?.advice ?? '');
    if (this.threatText) ellipsize(this.threatText, GAME_W - 2 * S.l);
    if (this.tacticText) clampLines(this.tacticText, 2);
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
    commit({ ...session.save, squad: autoFormation(session.save, GAME) });
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

  /** K7: бой считается без проигрывания — сразу экран итогов. */
  private skipBattle(): void {
    const save = session.save;
    if (!save.squad.some(Boolean)) {
      toast(this, 'Поставьте в отряд хотя бы одного героя');
      return;
    }
    try {
      const outcome = actSkipStage(save, today(), this.stageId, stageSeed(save), GAME);
      const defs = squadDefs(save);
      for (const u of enemySquad(this.stageId, GAME, outcome.save.campaignChoices)) if (u) defs[u.id] = u;
      commit(outcome.save);
      markHint('stage_fight');
      this.scene.start('Result', { result: outcome.result, defs, stage: { stageId: this.stageId, outcome, skipped: true } } satisfies ResultData);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }
}
