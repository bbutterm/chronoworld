import Phaser from 'phaser';
import { actSkipStage, arrangeSquad, autoFormation, enemySquad, misplacedInFront, getStage, squadPower, stagePower, stageStatus } from '../../core';
import { CONTENT, GAME } from '../content';
import { formatNumber, POWER_COLORS, powerTone, stageSeed, statsLine } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, portrait, screen, unitTint } from '../screen';
import { commit, session, today } from '../session';
import { portraitKey } from '../sprites';
import { button, ellipsize, hintPointer, panel, text, toast } from '../ui';
import { HINT_TEXT, hintDone, markHint } from '../hints';
import { startStageBattle } from '../dialogue';
import { squadDefs, type ResultData } from './BattleScene';
import { fitName, SLOT_W, slotX, SquadEditor } from '../squadEditor';
import { C, FS, TOUCH } from '../theme';

/**
 * Ряд «Авто» / «Пресеты отряда» (S): поднят так, чтобы между ним и «В бой» влезла плашка подсказки
 * (≈125 ед. над кнопкой боя) — она не закрывает эти кнопки.
 */
const SQUAD_BTN_Y = 1540;

/** Подготовка к этапу: враги, награда, ваш отряд (слот → герой), «В бой». */
export class StageScene extends Phaser.Scene {
  private stageId!: string;
  private editor!: SquadEditor;
  private fightBtns: ReturnType<typeof button>[] = [];
  private powerText!: Phaser.GameObjects.Text;
  private enemyPower = 0;
  private tip!: Phaser.GameObjects.Text;
  private rearrangeBtn!: ReturnType<typeof button>;

  constructor() {
    super('Stage');
  }

  create(data: { stageId: string }): void {
    this.stageId = data.stageId;
    const stage = getStage(GAME, this.stageId);
    // «Назад» — в главу этого этапа, а не в текущую главу игрока.
    const chapter = Math.max(0, CONTENT.chapters.findIndex((c) => c.id === stage.chapter));
    screen(this, `Этап ${stage.globalIndex + 1}${stage.boss ? ' · БОСС' : ''}`, null, { to: 'Campaign', data: { chapter } });

    // --- Противник ---
    card(this, GAME_W / 2, 440, 1050, 480);
    text(this, GAME_W / 2, 232, stage.name, FS.h2, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 });
    text(this, GAME_W / 2, 284, 'Противник', FS.small, C.enemy);
    enemySquad(this.stageId, GAME).forEach((u, i) => {
      const x = slotX(i);
      panel(this, x, 480, SLOT_W, 290, u ? 'ui_slot_filled' : 'ui_slot_empty');
      text(this, x, 322, i < 2 ? 'фронт' : 'тыл', FS.caption, C.dim);
      if (!u) return;
      portrait(this, x, 405, portraitKey(u.visual.sprite), 130).setTint(unitTint(u.visual));
      // T1-22: имя целиком — в две строки (перенос по пробелу или дефису), не влезает — чуть мельче; без многоточия.
      fitName(text(this, x, 515, u.name, FS.caption, u.kind === 'boss' ? C.danger : C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4, lineSpacing: -4 }), SLOT_W - 14);
      text(this, x, 588, statsLine(u.stats, '\n', ['hp', 'atk']), FS.caption, C.muted, { stroke: C.stroke, strokeThickness: 3, lineSpacing: 2 });
    });

    // --- Награда ---
    const first = stageStatus(session.save, this.stageId, GAME) !== 'cleared';
    const k = first ? 1 : GAME.progression.campaign.replayRewardMultiplier;
    card(this, GAME_W / 2, 755, 1050, 130, true);
    text(
      this,
      GAME_W / 2,
      730,
      `${first ? 'Награда' : `Повтор (×${k})`}:  золото ${Math.floor(stage.rewards.gold * k)} · опыт ${Math.floor(stage.rewards.jobExp * k)} каждому`,
      FS.body,
      C.ink,
      { fontStyle: 'bold' },
    );
    // K2: мощь отряда против мощи врагов. Обводка тёмная, чтобы цвет читался на светлой карточке.
    this.enemyPower = stagePower(this.stageId, GAME);
    this.powerText = text(this, GAME_W / 2, 780, '', FS.body, C.text, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 });

    // --- Ваш отряд и выбор героев (K8: общий редактор, авто-расстановка, пресеты) ---
    card(this, GAME_W / 2, 1220, 1050, 780);
    text(this, GAME_W / 2, 868, 'Ваш отряд', FS.h3, C.success, { fontStyle: 'bold' });
    this.tip = text(this, GAME_W / 2, 910, '', FS.caption, C.muted, { wordWrap: { width: 980 } });
    // T1-20: стрелок или лекарь во фронте — предупреждение и «Переставить» (тот же состав, по ролям).
    this.rearrangeBtn = button(this, GAME_W - 175, 910, 290, 84, 'ui_btn_primary', 'Переставить', () => this.rearrange(), FS.small);
    this.rearrangeBtn.container.setName('rearrangeBtn');
    this.editor = new SquadEditor(this, 1100, 1365, () => this.onSquadChange());
    button(this, GAME_W / 2 - 250, SQUAD_BTN_Y, 440, TOUCH, 'ui_btn_secondary', 'Авто', () => this.auto(), FS.h3);
    button(this, GAME_W / 2 + 250, SQUAD_BTN_Y, 440, TOUCH, 'k:buttonLong_beige', 'Пресеты отряда', () =>
      this.scene.start('Squad', { back: { to: 'Stage', data: { stageId: this.stageId } } }),
    FS.h3);

    if (first) {
      this.fightBtns = [button(this, GAME_W / 2, GAME_H - 110, 640, 150, 'ui_btn_primary', 'В бой', () => this.fight(), FS.hero)];
    } else {
      // K7: пройденный этап можно повторить с просмотром боя или сразу получить итог.
      this.fightBtns = [
        button(this, GAME_W / 2 - 260, GAME_H - 110, 480, 150, 'ui_btn_secondary', 'Пропустить бой', () => this.skipBattle(), FS.h2),
        button(this, GAME_W / 2 + 260, GAME_H - 110, 480, 150, 'ui_btn_primary', 'Повторить', () => this.fight(), FS.h1),
      ];
    }
    this.editor.draw();
    // R: подсказка новичку — первый бой. После отряда: hintPointer обходит все кнопки сцены («Авто», «Пресеты»).
    if (first && !hintDone('stage_fight')) hintPointer(this, GAME_W / 2, GAME_H - 110, HINT_TEXT.stage_fight, 'above', { w: 640, h: 150 });
  }

  /** Мощь отряда против противника и доступность «В бой» — после каждого изменения отряда. */
  private onSquadChange(): void {
    const save = session.save;
    const ready = save.squad.some(Boolean);
    for (const b of this.fightBtns) b.container.setAlpha(ready ? 1 : 0.45);
    const misplaced = misplacedInFront(save, GAME);
    const names = misplaced.map((id) => save.heroes.find((h) => h.id === id)?.name ?? id);
    this.rearrangeBtn.container.setVisible(misplaced.length > 0);
    if (misplaced.length) this.tip.setText(`${names.join(', ')} во фронте — дальнему бою место в тылу`).setColor(C.warning).setX(40).setOrigin(0, 0.5);
    else this.tip.setText('Выберите слот, затем героя. Повторное нажатие на слот — убрать.').setColor(C.muted).setX(GAME_W / 2).setOrigin(0.5);
    ellipsize(this.tip, misplaced.length ? GAME_W - 380 : 1000);
    const mine = squadPower(save, GAME);
    this.powerText
      .setText(`Мощь: ваш отряд ${formatNumber(mine)}  ·  противник ${formatNumber(this.enemyPower)}`)
      .setColor(POWER_COLORS[powerTone(mine, this.enemyPower)]);
  }

  /** T1-20: тот же состав по ролям — танки и ближний бой вперёд, стрелки и лекари в тыл. */
  private rearrange(): void {
    commit({ ...session.save, squad: arrangeSquad(session.save, GAME) });
    this.editor.draw();
    toast(this, 'Отряд переставлен: дальний бой и лекари — в тылу');
  }

  /** K8: авто-расстановка сильнейших героев. */
  private auto(): void {
    const squad = autoFormation(session.save, GAME);
    commit({ ...session.save, squad });
    this.editor.draw();
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

