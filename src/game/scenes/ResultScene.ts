import Phaser from 'phaser';
import { HEROES, type BattleResult } from '../../core';
import { heroPortrait } from '../assets';
import { GAME_W } from '../layout';
import { button, panel, text } from '../ui';

export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(data: { result: BattleResult }): void {
    const r = data.result;
    const win = r.winner === 'A';
    this.add.image(GAME_W / 2, 960, 'bg_arena').setDisplaySize(GAME_W, 1920).setAlpha(0.5);
    this.add.image(GAME_W / 2, 250, win ? 'ui_victory' : 'ui_defeat').setDisplaySize(900, 400);
    panel(this, GAME_W / 2, 1150, 1050, 1080, 'ui_panel');
    const reason = r.reason === 'timeout' ? 'Время вышло — атакующий проиграл' : win ? 'Отряд противника уничтожен' : 'Ваш отряд уничтожен';
    text(this, GAME_W / 2, 510, `${reason}\nДлительность ${r.duration.toFixed(1)} с · seed ${r.seed}`, 32, '#d6d9e0', { lineSpacing: 8 });

    // Сводка: почему победила сторона — кто сколько нанёс, вылечил и заблокировал.
    const cols = [150, 400, 560, 720, 870, 990];
    const heads = ['', 'Урон', 'Лечение', 'Щит', 'Ульты', 'Жив'];
    let y = 640;
    for (const side of ['A', 'B'] as const) {
      text(this, GAME_W / 2, y, side === 'A' ? 'Ваш отряд' : 'Противник', 38, side === 'A' ? '#9fe0a6' : '#f0a0a0');
      y += 55;
      heads.forEach((h, i) => text(this, cols[i], y, h, 26, '#f3dfb8'));
      y += 50;
      const units = r.units.filter((u) => u.side === side);
      const maxDmg = Math.max(1, ...Object.values(r.report).map((x) => x.damageDealt));
      for (const u of units) {
        const rep = r.report[u.uid];
        this.add.image(60, y, heroPortrait(u.heroId)).setDisplaySize(70, 70).setAlpha(rep.alive ? 1 : 0.4);
        text(this, cols[0] + 20, y, HEROES[u.heroId].name, 30).setOrigin(0, 0.5);
        this.add.rectangle(cols[1] - 70, y + 24, 140 * (rep.damageDealt / maxDmg), 6, 0xd64545).setOrigin(0, 0.5);
        text(this, cols[1], y, String(rep.damageDealt), 30);
        text(this, cols[2], y, String(rep.healingDone), 30, '#7dff8f');
        text(this, cols[3], y, String(rep.shieldGiven), 30, '#bcd6ff');
        text(this, cols[4], y, String(rep.ults), 30, '#ffd84a');
        text(this, cols[5], y, rep.alive ? '✓' : '✗', 30, rep.alive ? '#9fe0a6' : '#f0a0a0');
        y += 85;
      }
      y += 30;
    }

    button(this, 270, 1820, 440, 130, 'ui_btn_secondary', 'Изменить отряд', () => this.scene.start('Prep'));
    button(this, 810, 1820, 440, 130, 'ui_btn_primary', 'Ещё раз', () =>
      this.scene.start('Battle', { seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0 }),
    );
  }
}
