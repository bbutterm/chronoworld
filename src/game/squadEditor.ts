import Phaser from 'phaser';
import { heroPower, withGear } from '../core';
import { CONTENT, GAME } from './content';
import { assignSlot, formatNumber, heroSprite } from './flow';
import { GAME_W } from './layout';
import { portrait } from './screen';
import { commit, session } from './session';
import { portraitKey } from './sprites';
import { ellipsize, panel, pressable, text, toast } from './ui';
import { C, FS } from './theme';

export const SLOT_W = 196;
export const slotX = (i: number) => GAME_W / 2 + (i - 2) * (SLOT_W + 12);

/**
 * Редактор отряда (K8): 5 слотов и список героев с мощью. Выберите слот, затем героя; повторное нажатие
 * на выбранный слот убирает героя. Каждое изменение сразу пишется в сохранение (commit).
 * Используется на экране этапа и на экране «Отряд» (из башни и с этапа).
 */
export class SquadEditor {
  private layer: Phaser.GameObjects.Container;
  private selected: number;

  /**
   * @param slotsY центр слотов отряда (высота 250)
   * @param heroesY центр списка героев (высота 220)
   * @param onChange вызывается после каждой перерисовки (обновить мощь, кнопки)
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly slotsY: number,
    private readonly heroesY: number,
    private readonly onChange: () => void = () => {},
  ) {
    this.layer = scene.add.container(0, 0);
    this.selected = Math.max(0, session.save.squad.indexOf(null));
  }

  draw(): void {
    const scene = this.scene;
    this.layer.removeAll(true);
    const save = session.save;
    const gctx = withGear(GAME, save);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.layer.add(o);
      return o;
    };

    save.squad.forEach((heroId, i) => {
      const x = slotX(i);
      const y = this.slotsY;
      const sel = i === this.selected;
      const bg = add(panel(scene, x, y, SLOT_W, 250, sel ? 'ui_slot_selected' : heroId ? 'ui_slot_filled' : 'ui_slot_empty'));
      pressable(scene, bg, SLOT_W, 250, () => this.onSlot(i));
      add(text(scene, x, y - 143, i < 2 ? 'фронт' : 'тыл', FS.caption, C.dim, { stroke: C.stroke, strokeThickness: 3 }));
      const hero = heroId ? save.heroes.find((h) => h.id === heroId) : undefined;
      if (!hero) {
        add(text(scene, x, y, 'пусто', FS.small, sel ? C.ink : C.disabled));
        return;
      }
      add(portrait(scene, x, y - 30, portraitKey(heroSprite(hero, GAME)), 140));
      add(ellipsize(text(scene, x, y + 68, hero.name, FS.small, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }), SLOT_W - 16));
      add(ellipsize(text(scene, x, y + 102, `${CONTENT.jobs[hero.job]?.name ?? hero.job} · ${hero.jobLevel}`, FS.caption, C.title, { stroke: C.stroke, strokeThickness: 4 }), SLOT_W - 16));
    });

    const n = Math.max(1, save.heroes.length);
    const step = Math.min(200, 1040 / n);
    save.heroes.forEach((h, i) => {
      const x = GAME_W / 2 + (i - (n - 1) / 2) * step;
      const y = this.heroesY;
      const inSquad = save.squad.indexOf(h.id);
      const bg = add(panel(scene, x, y, step - 12, 220, inSquad >= 0 ? 'ui_slot_filled' : 'ui_slot_selected'));
      pressable(scene, bg, step - 12, 220, () => this.onHero(h.id));
      add(portrait(scene, x, y - 28, portraitKey(heroSprite(h, GAME)), 120)).setAlpha(inSquad >= 0 ? 0.55 : 1);
      add(ellipsize(text(scene, x, y + 50, h.name, FS.small, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }), step - 24));
      add(text(scene, x, y + 84, formatNumber(heroPower(h, gctx)), FS.caption, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }));
      if (inSquad >= 0) add(text(scene, x, y - 88, `слот ${inSquad + 1}`, FS.caption, C.success, { stroke: C.stroke, strokeThickness: 4 }));
    });
    this.onChange();
  }

  private onSlot(i: number): void {
    const save = session.save;
    if (i === this.selected && save.squad[i]) {
      if (save.squad.filter(Boolean).length === 1) {
        toast(this.scene, 'В отряде должен остаться хотя бы один герой');
        return;
      }
      commit({ ...save, squad: assignSlot(save.squad, i, null) });
    }
    this.selected = i;
    this.draw();
  }

  private onHero(heroId: string): void {
    const save = session.save;
    commit({ ...save, squad: assignSlot(save.squad, this.selected, heroId) });
    const nextEmpty = session.save.squad.indexOf(null);
    if (nextEmpty >= 0) this.selected = nextEmpty;
    this.draw();
  }
}
