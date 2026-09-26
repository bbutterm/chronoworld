import Phaser from 'phaser';
import { applyPreset, autoFormation, deletePreset, savePreset, squadPower, type Preset } from '../../core';
import { GAME } from '../content';
import { formatNumber, heroSprite, nextPresetName, presetMatches } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, confirm, portrait, screen } from '../screen';
import { commit, session } from '../session';
import { portraitKey } from '../sprites';
import { SquadEditor } from '../squadEditor';
import { button, dangerButton, panel, text, toast } from '../ui';

export interface SquadData {
  /** Куда вернуться («Готово» и «Назад»): экран этапа, башня… */
  back?: { to: string; data?: object };
}

const ROW_H = 112;
const LIST_TOP = 1140;

/**
 * K8. Отряд: общий редактор слотов, «Авто» (авто-расстановка) и пресеты — сохранить текущий, поставить, удалить.
 * Открывается с экрана этапа и из башни, изменения сразу в сохранении (башня и кампания используют один отряд).
 */
export class SquadScene extends Phaser.Scene {
  private back: { to: string; data?: object } = { to: 'Home' };
  private editor!: SquadEditor;
  private powerText!: Phaser.GameObjects.Text;
  private presetLayer!: Phaser.GameObjects.Container;

  constructor() {
    super('Squad');
  }

  create(data: SquadData = {}): void {
    this.back = data.back ?? { to: 'Home' };
    screen(this, 'Отряд', null, { to: this.back.to, data: this.back.data });

    this.powerText = text(this, GAME_W / 2, 205, '', 40, '#ffd84a', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 });
    card(this, GAME_W / 2, 620, 1050, 740);
    this.editor = new SquadEditor(this, 450, 745, () => this.refresh());
    button(this, GAME_W / 2 - 250, 920, 440, 100, 'ui_btn_secondary', 'Авто', () => this.auto(), 40);
    text(this, GAME_W / 2 + 250, 920, 'Сильнейшие герои:\nтанки вперёд, лекари в тыл', 26, '#e0cfb0', { lineSpacing: 2 });

    card(this, GAME_W / 2, 1385, 1050, 730);
    this.presetLayer = this.add.container(0, 0);
    this.editor.draw();

    button(this, GAME_W / 2, GAME_H - 100, 640, 130, 'ui_btn_primary', 'Готово', () => this.scene.start(this.back.to, this.back.data), 48);
  }

  private refresh(): void {
    this.powerText.setText(`Мощь отряда: ${formatNumber(squadPower(session.save, GAME))}`);
    this.drawPresets();
  }

  private drawPresets(): void {
    this.presetLayer.removeAll(true);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.presetLayer.add(o);
      return o;
    };
    const save = session.save;
    const max = GAME.meta.bounties.presets.max;
    add(text(this, 70, 1080, `Пресеты · ${save.presets.length} / ${max}`, 40, '#ffe9a8', { fontStyle: 'bold', stroke: '#3a2412', strokeThickness: 6 }).setOrigin(0, 0.5));
    const full = save.presets.length >= max;
    const saveBtn = button(this, 800, 1080, 400, 90, full ? 'k:buttonLong_grey' : 'ui_btn_primary', 'Сохранить текущий', () => this.savePreset(), 32);
    add(saveBtn.container);
    if (full) saveBtn.container.setAlpha(0.6);

    if (!save.presets.length) {
      add(text(this, GAME_W / 2, LIST_TOP + 150, 'Пресетов пока нет.\nСоберите отряд и нажмите «Сохранить текущий» —\nпотом его можно поставить одним нажатием.', 30, '#e0cfb0', { lineSpacing: 8 }));
      return;
    }
    save.presets.forEach((p, i) => this.presetRow(p, LIST_TOP + ROW_H * (i + 0.5), add));
  }

  private presetRow(p: Preset, y: number, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const save = session.save;
    const current = presetMatches(p, save.squad);
    add(panel(this, GAME_W / 2, y, 1000, ROW_H - 10, current ? 'ui_panel_light' : 'ui_panel'));
    const dark = current;
    add(text(this, 70, y - 22, p.name, 32, dark ? '#4a3520' : '#ffffff', { fontStyle: 'bold', stroke: dark ? '#00000000' : '#000000', strokeThickness: dark ? 0 : 4 }).setOrigin(0, 0.5));
    const power = squadPower(applyPreset(save, p.id), GAME);
    add(text(this, 70, y + 24, `Мощь ${formatNumber(power)}`, 26, dark ? '#6a4a2a' : '#ffd84a', { fontStyle: 'bold' }).setOrigin(0, 0.5));
    p.squad.forEach((id, i) => {
      const x = 360 + i * 62;
      const hero = id ? save.heroes.find((h) => h.id === id) : undefined;
      add(this.add.rectangle(x, y, 56, 56, 0x1a120a, 0.6).setStrokeStyle(2, 0x000000, 0.5));
      if (hero) add(portrait(this, x, y, portraitKey(heroSprite(hero, GAME)), 52));
    });
    if (current) {
      add(text(this, 800, y, 'Текущий', 30, '#2f7a3a', { fontStyle: 'bold' }));
    } else {
      add(button(this, 800, y, 230, 80, 'ui_btn_secondary', 'Поставить', () => this.apply(p), 32).container);
    }
    add(dangerButton(this, 975, y, 110, 80, '✕', () => this.remove(p), 40).container);
  }

  private auto(): void {
    commit({ ...session.save, squad: autoFormation(session.save, GAME) });
    this.editor.draw();
    toast(this, 'Отряд расставлен автоматически');
  }

  private savePreset(): void {
    try {
      const name = nextPresetName(session.save.presets);
      const r = savePreset(session.save, name, GAME);
      commit(r.save);
      this.refresh();
      toast(this, `Сохранён пресет «${r.preset.name}»`, '#9fe0a6');
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), '#ffb4a0');
    }
  }

  private apply(p: Preset): void {
    try {
      commit(applyPreset(session.save, p.id));
      this.editor.draw();
      toast(this, `Поставлен отряд «${p.name}»`, '#9fe0a6');
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), '#ffb4a0');
    }
  }

  private remove(p: Preset): void {
    confirm(this, `Удалить пресет «${p.name}»?\nТекущий отряд не изменится.`, 'Удалить', () => {
      try {
        commit(deletePreset(session.save, p.id));
        this.refresh();
      } catch (e) {
        toast(this, e instanceof Error ? e.message : String(e), '#ffb4a0');
      }
    });
  }
}
