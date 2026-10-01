import Phaser from 'phaser';
import { autoFormation } from '../../core';
import { GAME } from '../content';
import { GAME_H, GAME_W } from '../layout';
import { cta, screen } from '../screen';
import { commit, session } from '../session';
import { FormationEditor } from '../squadEditor';
import { openPresetsSheet } from '../squadPresets';

export interface SquadData {
  /** Куда вернуться («Готово» и «Назад»): экран этапа, башня… */
  back?: { to: string; data?: object };
  /** Итерация 4: сразу открыть лист пресетов (кнопка «Пресеты» на экране этапа). */
  presets?: boolean;
}

/** Геометрия экрана «Отряд» (игровые единицы 1080×1920): поле, заголовок сетки, сетка героев, «Готово». */
const L = {
  field: { top: 168, bottom: 870 },
  rosterHeadY: 990,
  roster: { top: 1046, bottom: 1712 },
  doneY: GAME_H - 110,
} as const;

/**
 * K8. Отряд: поле (как встанут в бою) и все герои плитками — общий редактор с экраном этапа
 * (нажать — в отряд, перетащить — на место, между слотами — обмен). В заголовке сетки — кнопки-иконки «Авто»
 * (авто-расстановка) и «Пресеты» (лист снизу: сохранить текущий, поставить, удалить). Открывается с экрана этапа
 * и из башни, изменения сразу в сохранении (башня и кампания используют один отряд).
 */
export class SquadScene extends Phaser.Scene {
  private back: { to: string; data?: object } = { to: 'Home' };
  private editor!: FormationEditor;

  constructor() {
    super('Squad');
  }

  create(data: SquadData = {}): void {
    this.back = data.back ?? { to: 'Home' };
    screen(this, 'Отряд', null, { to: this.back.to, data: this.back.data });

    this.editor = new FormationEditor(this, {
      field: L.field,
      roster: L.roster,
      rosterHead: { y: L.rosterHeadY, onAuto: () => this.auto(), onPresets: () => this.presets() },
    });
    this.editor.draw();

    cta(this, GAME_W / 2, L.doneY, 'Готово', () => this.scene.start(this.back.to, this.back.data));
    if (data.presets) this.presets();
  }

  private auto(): void {
    commit({ ...session.save, squad: autoFormation(session.save, GAME) });
    this.editor.replaced('Отряд расставлен автоматически');
  }

  private presets(): void {
    openPresetsSheet(this, {
      onApplied: () => this.editor.replaced(),
      onLock: (on) => (this.editor.locked = on),
    });
  }
}
