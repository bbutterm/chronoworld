import Phaser from 'phaser';
import { COMBAT, HEROES, type Side } from '../../core';
import { hasArt, heroBattle, heroPortrait } from '../assets';
import { describeHero } from '../describe';
import { ARENA_TOP, GAME_W, slotPos } from '../layout';
import { squads } from '../state';
import { button, text } from '../ui';

const SLOT_SIZE = 160;
/** На экране подготовки поле чуть выше, чтобы под ним поместились кнопки. */
const DY = -80;

export class PrepScene extends Phaser.Scene {
  private selected: { side: Side; slot: number } = { side: 'A', slot: 0 };
  private slotViews: { side: Side; slot: number; bg: Phaser.GameObjects.Image; hero: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text }[] = [];
  private info!: Phaser.GameObjects.Text;
  private startBtn!: ReturnType<typeof button>;

  constructor() {
    super('Prep');
  }

  create(): void {
    this.slotViews = [];
    this.add.image(GAME_W / 2, 960, 'bg_arena').setDisplaySize(GAME_W, 1920);
    text(this, GAME_W / 2, 70, 'Подготовка к бою', 64, '#ffe9a8');
    text(this, GAME_W / 2, 140, 'Выберите слот, затем героя. Повторное нажатие на слот — убрать героя.', 30, '#c8cbd4', {
      wordWrap: { width: 1000 },
    });

    this.buildPicker();

    this.info = text(this, GAME_W / 2, 500, '', 30, '#e6e6e6', { lineSpacing: 10, wordWrap: { width: 1020 } });

    text(this, 270, ARENA_TOP - 110, 'Ваш отряд', 40, '#9fe0a6');
    text(this, 810, ARENA_TOP - 110, 'Противник', 40, '#f0a0a0');
    text(this, 150, ARENA_TOP - 55, 'тыл', 26, '#8a8f9c');
    text(this, 390, ARENA_TOP - 55, 'фронт', 26, '#8a8f9c');
    text(this, 690, ARENA_TOP - 55, 'фронт', 26, '#8a8f9c');
    text(this, 930, ARENA_TOP - 55, 'тыл', 26, '#8a8f9c');

    for (const side of ['A', 'B'] as Side[]) {
      for (let slot = 0; slot < COMBAT.slots.count; slot++) this.buildSlot(side, slot);
    }

    button(this, 270, 1820, 440, 130, 'ui_btn_secondary', 'Враг = мой отряд', () => {
      squads.B = [...squads.A];
      this.refresh();
    });
    this.startBtn = button(this, 810, 1820, 440, 130, 'ui_btn_primary', 'В бой!', () => {
      if (!squads.A.some(Boolean) || !squads.B.some(Boolean)) return;
      this.scene.start('Battle', { seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0 });
    });

    this.refresh();
  }

  private buildPicker(): void {
    const ids = Object.keys(HEROES);
    const step = GAME_W / ids.length;
    ids.forEach((id, i) => {
      const x = step * (i + 0.5);
      const img = this.add.image(x, 320, heroPortrait(id)).setDisplaySize(150, 150).setInteractive({ useHandCursor: true });
      text(this, x, 420, HEROES[id].name, 30);
      img.on('pointerdown', () => this.pickHero(id));
      img.on('pointerover', () => this.info.setText(describeHero(HEROES[id])));
    });
  }

  private buildSlot(side: Side, slot: number): void {
    const { x, y } = slotPos(side, slot, DY);
    const bg = this.add.image(x, y, 'ui_slot_empty').setDisplaySize(SLOT_SIZE, SLOT_SIZE).setInteractive({ useHandCursor: true });
    const hero = this.add.image(x, y, 'ui_slot_empty').setDisplaySize(SLOT_SIZE - 16, SLOT_SIZE - 16);
    const label = text(this, x, y + SLOT_SIZE / 2 + 16, '', 26);
    bg.on('pointerdown', () => this.onSlot(side, slot));
    this.slotViews.push({ side, slot, bg, hero, label });
  }

  private onSlot(side: Side, slot: number): void {
    const same = this.selected.side === side && this.selected.slot === slot;
    if (same && squads[side][slot]) squads[side][slot] = null;
    this.selected = { side, slot };
    const id = squads[side][slot];
    if (id) this.info.setText(describeHero(HEROES[id]));
    this.refresh();
  }

  private pickHero(id: string): void {
    const { side, slot } = this.selected;
    const squad = squads[side];
    // Каждый герой — один раз на сторону: если уже стоит, меняем местами.
    const existing = squad.indexOf(id);
    if (existing >= 0) squad[existing] = squad[slot];
    squad[slot] = id;
    this.info.setText(describeHero(HEROES[id]));
    const nextEmpty = squad.findIndex((h) => !h);
    if (nextEmpty >= 0) this.selected = { side, slot: nextEmpty };
    this.refresh();
  }

  private refresh(): void {
    for (const v of this.slotViews) {
      const id = squads[v.side][v.slot];
      const isSel = this.selected.side === v.side && this.selected.slot === v.slot;
      v.bg.setTexture(isSel ? 'ui_slot_selected' : id ? 'ui_slot_filled' : 'ui_slot_empty').setDisplaySize(SLOT_SIZE, SLOT_SIZE);
      v.hero.setVisible(!!id);
      if (id) {
        v.hero.setTexture(heroBattle(id)).setDisplaySize(SLOT_SIZE - 16, SLOT_SIZE - 16);
        v.hero.setFlipX(v.side === 'B' && hasArt(heroBattle(id)));
      }
      v.label.setText(id ? HEROES[id].name : '');
    }
    const ready = squads.A.some(Boolean) && squads.B.some(Boolean);
    this.startBtn.container.setAlpha(ready ? 1 : 0.4);
  }
}
