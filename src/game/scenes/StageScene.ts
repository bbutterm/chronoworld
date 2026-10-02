import Phaser from 'phaser';
import { actSkipStage, autoFormation, enemySquad, getStage, stageCardDrop, stageStatus } from '../../core';
import { heroCardIcon } from '../heroCard';
import { CONTENT, GAME } from '../content';
import { shortfallHint, stageNeeds, stageNo, stageSeed, type StageNeeds } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { COMBAT as COMBAT_CFG } from '../../core';
import { cta, powerCompare, screen, updatePowerCompare } from '../screen';
import { commit, session, today } from '../session';
import { BTN, button, infoButton, pressable, rewardRow, tag, text, toast, tutorialHint, type ButtonView, type ChipSpec } from '../ui';
import { monsterTeaser, roleName } from '../loreView';
import { ctaShine } from '../decor';
import { markHint, pickPrepHint } from '../hints';
import { startStageBattle } from '../dialogue';
import { squadDefs, type ResultData } from './BattleScene';
import { FormationEditor } from '../squadEditor';
import { bump } from '../juice';
import { C, COLOR, FAMILY, S, T } from '../theme';
import { enemyTraits } from '../../core/behavior';
import { defenseElement, ELEMENT_NAMES } from '../../core/elements';
import { elementBadge } from '../battleElements';
import { scoutSheet } from '../scoutView';
import type { HeroCardDrop } from '../../core';

/** Геометрия экрана этапа (игровые единицы 1080×1920). */
const L = {
  /** Награды — один ряд чипов под шапкой. */
  rewardY: 212,
  field: { top: 270, bottom: 1010 },
  /** Полоса над слотами поля: мощь слева, «БОСС» и «i» справа. */
  powerY: 270 + 40,
  /** Подпись нехватки («Героям нужен ур. N») — под мощью, только когда сил не хватает. */
  shortY: 270 + 80,
  rosterHeadY: 1132,
  roster: { top: 1188, bottom: 1704 },
  fightY: GAME_H - 110,
} as const;


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

  constructor() {
    super('Stage');
  }

  create(data: { stageId: string }): void {
    this.stageId = data.stageId;
    this.autoHint = null;
    this.power = null;
    this.shortText = null;
    this.wasShort = null;
    const stage = getStage(GAME, this.stageId);
    // «Назад» — в главу этого этапа, а не в текущую главу игрока.
    const chapter = Math.max(0, CONTENT.chapters.findIndex((c) => c.id === stage.chapter));
    screen(this, `${stageNo(stage, GAME)} · ${stage.name}`, null, { to: 'Campaign', data: { chapter } });

    // --- Награда: один ряд чипов (повтор — уже с множителем повтора) ---
    const first = stageStatus(session.save, this.stageId, GAME) !== 'cleared';
    const k = first ? 1 : GAME.progression.campaign.replayRewardMultiplier;
    const drop = stageCardDrop(stage, first, GAME);
    rewardRow(this, GAME_W / 2, L.rewardY, stageRewardChips(Math.floor(stage.rewards.gold * k), Math.floor(stage.rewards.jobExp * k), drop), { size: 's' }).setName('stageRewards');

    // --- Поле (отряд против противника) и список героев ---
    // Уровни врагов поштучно не показываем (см. flow.ts stageNeeds): одно число — в листе разведки.
    const enemies = enemySquad(this.stageId, GAME);
    this.editor = new FormationEditor(this, {
      // Ряд мощи и «Героям нужен ур. N» рисует сцена (powerCompare и строка нехватки).
      chrome: false,
      field: L.field,
      enemies,
      roster: L.roster,
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
    if (stage.boss) tag(this, info.x - 48 - S.xs, L.powerY, 'БОСС', 'negative', { solid: true, align: 'right' }).setName('stageBoss');

    // --- Список героев: заголовок, «Авто» и «Пресеты» — вторичные ---
    text(this, S.l, L.rosterHeadY, 'Герои', T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
    const autoX = GAME_W - S.l - 260 - S.xs - 110;
    button(this, autoX, L.rosterHeadY, 220, BTN.m, '', 'Авто', () => this.auto(), T.body, { variant: 'secondary' });
    button(this, GAME_W - S.l - 130, L.rosterHeadY, 260, BTN.m, '', 'Пресеты', () =>
      this.scene.start('Squad', { back: { to: 'Stage', data: { stageId: this.stageId } } }),
    T.body, { variant: 'secondary' });

    if (first) {
      const fight = cta(this, GAME_W / 2, L.fightY, 'В бой', () => this.fight(), { w: 640 });
      ctaShine(this, fight.container, 640, 140);
      this.fightBtns = [fight];
    } else {
      // K7: пройденный этап можно повторить с просмотром боя или сразу получить итог.
      const skip = button(this, GAME_W / 2 - 260, L.fightY, 460, BTN.cta, '', 'Пропустить бой', () => this.skipBattle(), T.body, { variant: 'secondary' });
      const again = cta(this, GAME_W / 2 + 250, L.fightY, 'Повторить', () => this.fight(), { w: 480, h: BTN.cta });
      this.fightBtns = [skip, again];
    }
    this.editor.draw();
    this.enemyTaps(stage.enemies.map((e) => e?.unit ?? null));
    // R: подсказка новичку — первый бой. После отряда: hintPointer обходит все кнопки, слоты и карточки сцены.
    // Обучение: после Таверны сильнейшие герои вне отряда — сначала «Авто» (prep_auto), иначе «В бой».
    const ids = (sq: readonly (string | null)[]) => JSON.stringify(sq.filter(Boolean).sort());
    const benchStronger = ids(autoFormation(session.save, GAME)) !== ids(session.save.squad);
    const hint = pickPrepHint({ first, benchStronger, summoned: session.save.summon.firstTenDone });
    if (hint === 'prep_auto') this.autoHint = tutorialHint(this, hint, autoX, L.rosterHeadY, 'above', { w: 220, h: BTN.m });
    else if (hint === 'stage_fight') tutorialHint(this, hint, GAME_W / 2, L.fightY, 'above', { w: 640, h: 140 });
  }

  /** Лист разведки: нужная мощь, уровень врагов (и нужный уровень героев при нехватке), враги по видам. */
  private openScout(): void {
    const needs = stageNeeds(session.save, this.stageId, GAME);
    scoutSheet(this, enemySquad(this.stageId, GAME), Object.values(squadDefs(session.save)), needs);
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
  }

  /** K8: авто-расстановка сильнейших героев. */
  private auto(): void {
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
      for (const u of enemySquad(this.stageId, GAME)) if (u) defs[u.id] = u;
      commit(outcome.save);
      markHint('stage_fight');
      this.scene.start('Result', { result: outcome.result, defs, stage: { stageId: this.stageId, outcome, skipped: true } } satisfies ResultData);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }
}
