import Phaser from 'phaser';
import { actSkipStage, autoFormation, enemySquad, getStage, squadPower, stagePower, stageStatus } from '../../core';
import { GAME } from '../content';
import { formatNumber, POWER_COLORS, powerTone, stageSeed } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, portrait, screen } from '../screen';
import { commit, session, today } from '../session';
import { portraitKey } from '../sprites';
import { button, panel, text, toast } from '../ui';
import { squadDefs, type ResultData } from './BattleScene';
import { SLOT_W, slotX, SquadEditor } from '../squadEditor';


/** Подготовка к этапу: враги, награда, ваш отряд (слот → герой), «В бой». */
export class StageScene extends Phaser.Scene {
  private stageId!: string;
  private editor!: SquadEditor;
  private fightBtns: ReturnType<typeof button>[] = [];
  private powerText!: Phaser.GameObjects.Text;
  private enemyPower = 0;

  constructor() {
    super('Stage');
  }

  create(data: { stageId: string }): void {
    this.stageId = data.stageId;
    const stage = getStage(GAME, this.stageId);
    screen(this, `Этап ${stage.globalIndex + 1}${stage.boss ? ' · БОСС' : ''}`, null, { to: 'Campaign' });

    // --- Противник ---
    card(this, GAME_W / 2, 440, 1050, 480);
    text(this, GAME_W / 2, 240, stage.name, 44, '#ffe9a8', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 });
    text(this, GAME_W / 2, 280, 'Противник', 32, '#f0a0a0');
    enemySquad(this.stageId, GAME).forEach((u, i) => {
      const x = slotX(i);
      panel(this, x, 480, SLOT_W, 290, u ? 'ui_slot_filled' : 'ui_slot_empty');
      text(this, x, 322, i < 2 ? 'фронт' : 'тыл', 26, '#b8bcc8');
      if (!u) return;
      portrait(this, x, 420, portraitKey(u.visual.sprite), 140);
      text(this, x, 525, u.name, 26, u.kind === 'boss' ? '#ff9a8a' : '#ffffff', { stroke: '#000000', strokeThickness: 4, wordWrap: { width: SLOT_W - 10 } });
      text(this, x, 590, `HP ${u.stats.hp}\nATK ${u.stats.atk}`, 26, '#e0cfb0', { stroke: '#000000', strokeThickness: 3, lineSpacing: 0 });
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
      30,
      '#4a3520',
      { fontStyle: 'bold' },
    );
    // K2: мощь отряда против мощи врагов. Обводка тёмная, чтобы цвет читался на светлой карточке.
    this.enemyPower = stagePower(this.stageId, GAME);
    this.powerText = text(this, GAME_W / 2, 780, '', 30, '#ffffff', { fontStyle: 'bold', stroke: '#2a1a0a', strokeThickness: 6 });

    // --- Ваш отряд и выбор героев (K8: общий редактор, авто-расстановка, пресеты) ---
    card(this, GAME_W / 2, 1230, 1050, 800);
    text(this, GAME_W / 2, 868, 'Ваш отряд', 36, '#9fe0a6', { fontStyle: 'bold' });
    text(this, GAME_W / 2, 910, 'Выберите слот, затем героя. Повторное нажатие на слот — убрать.', 26, '#e0cfb0', {
      wordWrap: { width: 980 },
    });
    this.editor = new SquadEditor(this, 1100, 1395, () => this.onSquadChange());
    button(this, GAME_W / 2 - 250, 1570, 440, 90, 'ui_btn_secondary', 'Авто', () => this.auto(), 36);
    button(this, GAME_W / 2 + 250, 1570, 440, 90, 'k:buttonLong_beige', 'Пресеты отряда', () =>
      this.scene.start('Squad', { back: { to: 'Stage', data: { stageId: this.stageId } } }),
    34);

    if (first) {
      this.fightBtns = [button(this, GAME_W / 2, GAME_H - 110, 640, 150, 'ui_btn_primary', 'В бой', () => this.fight(), 56)];
    } else {
      // K7: пройденный этап можно повторить с просмотром боя или сразу получить итог.
      this.fightBtns = [
        button(this, GAME_W / 2 - 260, GAME_H - 110, 480, 150, 'ui_btn_secondary', 'Пропустить бой', () => this.skipBattle(), 42),
        button(this, GAME_W / 2 + 260, GAME_H - 110, 480, 150, 'ui_btn_primary', 'Повторить', () => this.fight(), 48),
      ];
    }
    this.editor.draw();
  }

  /** Мощь отряда против противника и доступность «В бой» — после каждого изменения отряда. */
  private onSquadChange(): void {
    const save = session.save;
    const ready = save.squad.some(Boolean);
    for (const b of this.fightBtns) b.container.setAlpha(ready ? 1 : 0.45);
    const mine = squadPower(save, GAME);
    this.powerText
      .setText(`Мощь: ваш отряд ${formatNumber(mine)}  ·  противник ${formatNumber(this.enemyPower)}`)
      .setColor(POWER_COLORS[powerTone(mine, this.enemyPower)]);
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
    this.scene.start('Battle', { mode: 'stage', stageId: this.stageId });
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
      this.scene.start('Result', { result: outcome.result, defs, stage: { stageId: this.stageId, outcome, skipped: true } } satisfies ResultData);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), '#ffb4a0');
    }
  }
}
