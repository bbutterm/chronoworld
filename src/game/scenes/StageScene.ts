import Phaser from 'phaser';
import { actSkipStage, autoFormation, dropText, enemySquad, getStage, stageCardDrop, stageLevels, stageStatus } from '../../core';
import { heroCardIcon } from '../heroCard';
import { CONTENT, GAME } from '../content';
import { formatNumber, recommendedPower, stageNo, stageSeed } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { screen } from '../screen';
import { commit, session, today } from '../session';
import { button, hintPointer, text, toast, tutorialHint } from '../ui';
import { ctaShine, glow } from '../decor';
import { skinIcon } from '../skin';
import { HINT_TEXT, markHint, pickPrepHint } from '../hints';
import { startStageBattle } from '../dialogue';
import { squadDefs, type ResultData } from './BattleScene';
import { FormationEditor } from '../squadEditor';
import { C, FS } from '../theme';

/** Геометрия экрана этапа (игровые единицы 1080×1920). */
const L = {
  titleY: 184,
  rewardY: 230,
  cardY: 272,
  field: { top: 298, bottom: 1010 },
  rosterHeadY: 1128,
  roster: { top: 1180, bottom: 1704 },
  fightY: GAME_H - 110,
} as const;

/**
 * Подготовка к этапу в духе AFK Arena: сверху поле — ваш отряд слева (фронт ближе к врагу), противник справа,
 * как они встанут в бою; снизу — все герои карточками (нажать — в отряд, перетащить — на место);
 * «Авто», «Пресеты» и одна главная кнопка «В бой». Сюжет beforeStage — по «В бой».
 */
export class StageScene extends Phaser.Scene {
  private stageId!: string;
  private editor!: FormationEditor;
  private fightBtns: ReturnType<typeof button>[] = [];
  private autoHint: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Stage');
  }

  create(data: { stageId: string }): void {
    this.stageId = data.stageId;
    this.autoHint = null;
    const stage = getStage(GAME, this.stageId);
    // «Назад» — в главу этого этапа, а не в текущую главу игрока.
    const chapter = Math.max(0, CONTENT.chapters.findIndex((c) => c.id === stage.chapter));
    screen(this, `Этап ${stageNo(stage, GAME)}${stage.boss ? ' · БОСС' : ''}`, null, { to: 'Campaign', data: { chapter } });

    // --- Этап и награда ---
    const first = stageStatus(session.save, this.stageId, GAME) !== 'cleared';
    const k = first ? 1 : GAME.progression.campaign.replayRewardMultiplier;
    text(this, GAME_W / 2, L.titleY, stage.name, FS.h2, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 });
    text(
      this,
      GAME_W / 2,
      L.rewardY,
      `${first ? 'Награда' : `Повтор (×${k})`}: золото ${formatNumber(Math.floor(stage.rewards.gold * k))} · опыт ${formatNumber(Math.floor(stage.rewards.jobExp * k))} в запас`,
      FS.caption,
      C.muted,
      { stroke: C.stroke, strokeThickness: 4 },
    );
    // Шанс карты героя (копия случайного героя для вознесения): первое прохождение / босс главы / повтор.
    const drop = stageCardDrop(stage, first, GAME);
    const dt = dropText(drop);
    if (dt) {
      const line = text(this, GAME_W / 2 + 22, L.cardY, `Шанс: ${dt}`, FS.caption, C.info, { stroke: C.stroke, strokeThickness: 4 }).setName('stageCardDrop');
      heroCardIcon(this, line.x - line.width / 2 - 26, L.cardY, 40, (drop.purple ?? 0) > (drop.blue ?? 0) ? 'purple' : 'blue');
    }

    // --- Поле (отряд против противника) и список героев ---
    const levels = stageLevels(this.stageId, GAME);
    this.editor = new FormationEditor(this, {
      field: L.field,
      enemies: enemySquad(this.stageId, GAME),
      enemyPower: recommendedPower(this.stageId, GAME),
      enemyLevels: levels.enemies,
      recommend: levels.recommended,
      roster: L.roster,
      onChange: () => this.onSquadChange(),
    });
    text(this, 50, L.rosterHeadY, `Герои · ${session.save.heroes.length}`, FS.h3, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5);
    button(this, 610, L.rosterHeadY, 220, 90, 'ui_btn_secondary', 'Авто', () => this.auto(), FS.h3);
    button(this, 890, L.rosterHeadY, 300, 90, 'k:buttonLong_beige', 'Пресеты', () =>
      this.scene.start('Squad', { back: { to: 'Stage', data: { stageId: this.stageId } } }),
    FS.h3);

    if (first) {
      // Главная кнопка: ореол, скрещённые мечи и пробегающий блик.
      glow(this, GAME_W / 2, L.fightY, 128, 0xffc860, 0.22, true).setScale(860 / 128, 300 / 128);
      const fight = button(this, GAME_W / 2, L.fightY, 640, 150, 'ui_btn_primary', 'В бой', () => this.fight(), FS.hero);
      fight.label.setX(34);
      fight.container.add(this.add.image(34 - fight.label.width / 2 - 52, -4, skinIcon('swords')).setDisplaySize(68, 68).setTint(0x3a2408));
      ctaShine(this, fight.container, 640, 150);
      this.fightBtns = [fight];
    } else {
      // K7: пройденный этап можно повторить с просмотром боя или сразу получить итог.
      this.fightBtns = [
        button(this, GAME_W / 2 - 260, L.fightY, 480, 150, 'ui_btn_secondary', 'Пропустить бой', () => this.skipBattle(), FS.h2),
        button(this, GAME_W / 2 + 260, L.fightY, 480, 150, 'ui_btn_primary', 'Повторить', () => this.fight(), FS.h1),
      ];
      ctaShine(this, this.fightBtns[1].container, 480, 150);
    }
    this.editor.draw();
    // R: подсказка новичку — первый бой. После отряда: hintPointer обходит все кнопки, слоты и карточки сцены.
    // Обучение: после Таверны сильнейшие герои вне отряда — сначала «Авто» (prep_auto), иначе «В бой».
    const ids = (sq: readonly (string | null)[]) => JSON.stringify(sq.filter(Boolean).sort());
    const benchStronger = ids(autoFormation(session.save, GAME)) !== ids(session.save.squad);
    const hint = pickPrepHint({ first, benchStronger });
    if (hint === 'prep_auto') this.autoHint = tutorialHint(this, hint, 610, L.rosterHeadY, 'above', { w: 220, h: 90 });
    else if (hint === 'stage_fight') hintPointer(this, GAME_W / 2, L.fightY, HINT_TEXT.stage_fight, 'above', { w: 640, h: 150 });
  }

  /** Доступность «В бой» — после каждого изменения отряда (мощь и предупреждение рисует редактор). */
  private onSquadChange(): void {
    const ready = session.save.squad.some(Boolean);
    for (const b of this.fightBtns) b.setEnabled(ready);
  }

  /** K8: авто-расстановка сильнейших героев. */
  private auto(): void {
    markHint('prep_auto');
    this.autoHint?.destroy();
    this.autoHint = null;
    commit({ ...session.save, squad: autoFormation(session.save, GAME) });
    this.editor.replaced();
    toast(this, 'Отряд расставлен автоматически');
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

