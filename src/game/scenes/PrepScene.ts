import Phaser from 'phaser';
import { COMBAT, type Side } from '../../core';
import { tex } from '../assets';
import { CONTENT, heroIds } from '../content';
import { describeUnit } from '../describe';
import { anim, portraitKey, spriteView, whenSprites } from '../sprites';
import { ARENA_TOP, GAME_W, slotPos } from '../layout';
import { portrait } from '../screen';
import { squads } from '../state';
import { button, ellipsize, panel, pressable, text } from '../ui';
import { C, FS, TOUCH } from '../theme';

const SLOT_SIZE = 160;
/** На экране подготовки поле чуть выше, чтобы под ним поместились кнопки. */
const DY = -80;

interface SlotView {
  side: Side;
  slot: number;
  bg: Phaser.GameObjects.NineSlice;
  hero: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
}

export class PrepScene extends Phaser.Scene {
  private selected: { side: Side; slot: number } = { side: 'A', slot: 0 };
  private slotViews: SlotView[] = [];
  private info!: Phaser.GameObjects.Text;
  private startBtn!: ReturnType<typeof button>;

  constructor() {
    super('Prep');
  }

  create(): void {
    this.slotViews = [];
    this.add.image(GAME_W / 2, 960, this.textures.exists('skin_bg_battle') ? 'skin_bg_battle' : 'bg_arena').setDisplaySize(GAME_W, 1920);
    button(this, 110, 64, 180, TOUCH, 'k:buttonLong_beige', '‹ Назад', () => this.scene.start('Home'), FS.h3);
    text(this, GAME_W / 2 + 60, 60, 'Тестовый бой', FS.hero, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 8 });
    // Одна строка: в две она заходила под кнопку «Назад».
    text(this, GAME_W / 2, 132, 'Выберите слот, затем героя. Нажатие на занятый слот — убрать.', FS.small, C.dim, {
      wordWrap: { width: 1000 },
    });

    panel(this, GAME_W / 2, 280, 1050, 230, 'ui_panel');
    this.buildPicker();

    panel(this, GAME_W / 2, 490, 1050, 160, 'ui_panel_light');
    this.info = text(this, GAME_W / 2, 490, 'Нажмите на героя, чтобы увидеть его статы', FS.small, C.ink, {
      lineSpacing: 8,
      wordWrap: { width: 1000 },
    });

    text(this, 270, ARENA_TOP - 110, 'Ваш отряд', FS.h2, C.success, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 });
    text(this, 810, ARENA_TOP - 110, 'Противник', FS.h2, C.enemy, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 });
    for (const [x, label] of [[150, 'тыл'], [390, 'фронт'], [690, 'фронт'], [930, 'тыл']] as const) {
      text(this, x, ARENA_TOP - 55, label, FS.caption, C.dim);
    }

    for (const side of ['A', 'B'] as Side[]) {
      for (let slot = 0; slot < COMBAT.slots.count; slot++) this.buildSlot(side, slot);
    }

    button(this, 270, 1820, 460, 130, 'ui_btn_secondary', 'Враг = мой отряд', () => {
      squads.B = [...squads.A];
      this.refresh();
    });
    this.startBtn = button(this, 810, 1820, 460, 130, 'ui_btn_primary', 'В бой!', () => {
      if (!squads.A.some(Boolean) || !squads.B.some(Boolean)) return;
      this.scene.start('Battle', { mode: 'test', seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0 });
    });

    this.refresh();
  }

  private buildPicker(): void {
    const ids = heroIds();
    const step = 1000 / ids.length;
    ids.forEach((id, i) => {
      const x = 40 + step * (i + 0.5);
      panel(this, x, 262, 150, 150, 'ui_slot_filled');
      const u = CONTENT.units[id];
      const img = pressable(this, portrait(this, x, 262, portraitKey(u.visual.sprite), 140), 150, 150, () => this.pickHero(id));
      ellipsize(text(this, x, 362, u.name, FS.small, C.text, { stroke: C.stroke, strokeThickness: 5 }), step - 10);
      img.on('pointerover', () => this.info.setText(describeUnit(u, CONTENT)));
    });
  }

  private buildSlot(side: Side, slot: number): void {
    const feet = slotPos(side, slot, DY);
    const x = feet.x;
    const y = feet.y - SLOT_SIZE / 2 + 10;
    const bg = panel(this, x, y, SLOT_SIZE, SLOT_SIZE, 'ui_slot_empty');
    const hero = this.add.sprite(x, feet.y, '__DEFAULT');
    const label = text(this, x, y + SLOT_SIZE / 2 + 18, '', FS.caption, C.text, { stroke: C.stroke, strokeThickness: 5 });
    pressable(this, bg, SLOT_SIZE, SLOT_SIZE, () => this.onSlot(side, slot));
    this.slotViews.push({ side, slot, bg, hero, label });
  }

  private onSlot(side: Side, slot: number): void {
    const same = this.selected.side === side && this.selected.slot === slot;
    if (same && squads[side][slot]) squads[side][slot] = null;
    this.selected = { side, slot };
    const id = squads[side][slot];
    if (id) this.info.setText(describeUnit(CONTENT.units[id], CONTENT));
    this.refresh();
  }

  private pickHero(id: string): void {
    const { side, slot } = this.selected;
    const squad = squads[side];
    // Каждый герой — один раз на сторону: если уже стоит, меняем местами.
    const existing = squad.indexOf(id);
    if (existing >= 0) squad[existing] = squad[slot];
    squad[slot] = id;
    this.info.setText(describeUnit(CONTENT.units[id], CONTENT));
    const nextEmpty = squad.findIndex((h) => !h);
    if (nextEmpty >= 0) this.selected = { side, slot: nextEmpty };
    this.refresh();
  }

  private refresh(): void {
    // U: листы героев в слотах грузятся по требованию; пока грузятся — слоты рисуются без фигур.
    const ids = [...squads.A, ...squads.B].filter((id): id is string => !!id).map((id) => CONTENT.units[id].visual.sprite);
    whenSprites(this, ids, () => this.drawSlots());
    const ready = squads.A.some(Boolean) && squads.B.some(Boolean);
    this.startBtn.container.setAlpha(ready ? 1 : 0.4);
  }

  private drawSlots(): void {
    for (const v of this.slotViews) {
      const id = squads[v.side][v.slot];
      const isSel = this.selected.side === v.side && this.selected.slot === v.slot;
      const t = tex(this, isSel ? 'ui_slot_selected' : id ? 'ui_slot_filled' : 'ui_slot_empty');
      v.bg.setTexture(t.key, t.frame);
      v.hero.setVisible(!!id);
      if (id) {
        const spriteId = CONTENT.units[id].visual.sprite;
        const view = spriteView(this, spriteId);
        // Выбрали героя, чей лист ещё грузится, — фигура появится по следующему вызову (после загрузки).
        if (!this.textures.exists(view.key)) {
          v.hero.setVisible(false);
          v.label.setText(CONTENT.units[id].name);
          continue;
        }
        // Спрайт в слоте чуть меньше, чем в бою.
        v.hero.setTexture(view.key, 0).setOrigin(view.originX, view.originY).setScale((view.size / v.hero.frame.realHeight) * 0.62);
        const idle = anim(view, spriteId, 'idle');
        if (idle) v.hero.play({ key: idle, repeat: -1 });
        else v.hero.stop();
        v.hero.setFlipX(v.side === 'B' && view.art);
      }
      v.label.setText(id ? CONTENT.units[id].name : '');
    }
  }
}
