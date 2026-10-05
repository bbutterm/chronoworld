import Phaser from 'phaser';
import { autoFormation } from '../../core';
import { GAME } from '../content';
import { GAME_W } from '../layout';
import { CONTENT_TOP, cta, screen } from '../screen';
import { commit, session } from '../session';
import { FormationEditor } from '../squadEditor';
import { openPresetsSheet } from '../squadPresets';
import { ScrollArea } from '../ui';
import { onViewChange, view } from '../viewport';
import { formationBodyRows } from '../prepLayout';

export interface SquadData {
  /** Куда вернуться («Готово» и «Назад»): экран этапа, башня… */
  back?: { to: string; data?: object };
  /** Итерация 4: сразу открыть лист пресетов (кнопка «Пресеты» на экране этапа). */
  presets?: boolean;
}

/** Геометрия экрана «Отряд» (игровые единицы 1080×1920): поле, заголовок сетки, сетка героев, «Готово». */
const field = { top: CONTENT_TOP, bottom: CONTENT_TOP + 702 };
const bodyRows = formationBodyRows(field.bottom);
const L = { field, rosterHeadY: bodyRows.rosterHeadY, roster: { top: bodyRows.rosterTop, bottom: bodyRows.rosterTop + 666 } };

/**
 * K8. Отряд: поле (как встанут в бою) и все герои плитками — общий редактор с экраном этапа
 * (нажать — в отряд, перетащить — на место, между слотами — обмен). В заголовке сетки — кнопки-иконки «Авто»
 * (авто-расстановка) и «Пресеты» (лист снизу: сохранить текущий, поставить, удалить). Открывается с экрана этапа
 * и из башни, изменения сразу в сохранении (башня и кампания используют один отряд).
 */
export class SquadScene extends Phaser.Scene {
  private back: { to: string; data?: object } = { to: 'Home' };
  private editor!: FormationEditor;
  private body!: ScrollArea;
  private get doneY(): number { return view().uiHeight - 110; }

  constructor() {
    super('Squad');
  }

  create(data: SquadData = {}): void {
    this.back = data.back ?? { to: 'Home' };
    screen(this, 'Отряд', null, { to: this.back.to, data: this.back.data });
    this.body = new ScrollArea(this, CONTENT_TOP, this.doneY - 120);
    this.body.content.setName('squadBody');

    this.editor = new FormationEditor(this, {
      field: L.field,
      roster: L.roster,
      scrollBody: { area: this.body, origin: CONTENT_TOP },
      rosterHead: { y: L.rosterHeadY, onAuto: () => this.auto(), onPresets: () => this.presets() },
    });
    this.editor.draw();

    const done = cta(this, GAME_W / 2, this.doneY, 'Готово', () => this.scene.start(this.back.to, this.back.data));
    done.container.setName('squadDone');
    onViewChange(this, () => {
      done.container.setY(this.doneY);
      this.editor.setBodyBounds(CONTENT_TOP, this.doneY - 120);
    });
    if (data.presets) this.presets();
  }

  private auto(): void {
    commit({ ...session.save, squad: autoFormation(session.save, GAME) });
    this.editor.replaced('Отряд расставлен автоматически');
  }

  private presets(): void {
    openPresetsSheet(this, {
      onApplied: () => this.editor.replaced(),
      onLock: (on) => { this.editor.locked = on; this.body.locked = on; },
    });
  }
}
