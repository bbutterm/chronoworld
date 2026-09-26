import Phaser from 'phaser';
import { GAME } from '../content';
import { describeEvents, itemStatsText, nextOpenStage, RARITY_COLORS } from '../flow';
import { GAME_W } from '../layout';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { button, panel, text } from '../ui';
import type { ResultData } from './BattleScene';
import { portrait } from '../screen';

const MAX_EVENT_LINES = 5;

export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }

  create(data: ResultData): void {
    const r = data.result;
    const stage = data.stage;
    const tower = data.tower;
    const win = r.winner === 'A';
    const compact = !!stage || !!tower;
    this.add.image(GAME_W / 2, 960, 'bg_arena').setDisplaySize(GAME_W, 1920).setAlpha(0.5);
    this.add.image(GAME_W / 2, compact ? 190 : 250, win ? 'ui_victory' : 'ui_defeat').setDisplaySize(compact ? 760 : 900, compact ? 338 : 400);
    const top = compact ? 380 : 470;
    panel(this, GAME_W / 2, (top + 1730) / 2, 1050, 1730 - top + 20, 'ui_panel');
    const reason = r.reason === 'timeout' ? 'Время вышло — атакующий проиграл' : win ? 'Отряд противника уничтожен' : 'Ваш отряд уничтожен';
    let y = top + 50;
    const where = tower ? `Башня, этаж ${tower.floor} · ` : stage?.skipped ? 'Бой пропущен · ' : '';
    text(this, GAME_W / 2, y, `${where}${reason} · ${r.duration.toFixed(1)} с`, 30, '#d6d9e0');
    y += 60;

    const outcome = stage?.outcome ?? tower?.outcome;
    if (outcome) {
      const events = outcome.events;
      const rewards = events.find((e) => e.type === 'rewards');
      if (rewards && rewards.type === 'rewards') {
        text(this, GAME_W / 2, y, `Награда: золото +${rewards.gold} · опыт +${rewards.jobExp} каждому`, 34, '#ffd84a', {
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 5,
        });
      } else {
        text(this, GAME_W / 2, y, tower ? 'Этаж не взят. Усильте отряд и попробуйте снова.' : 'Награды нет. Прокачайте героев или смените профессию.', 30, '#f0a0a0');
      }
      y += 55;
      // K6: выпавшие предметы — цветом редкости.
      for (const d of stage?.outcome.drops ?? []) {
        const def = GAME.equipment.items[d.itemId];
        const t = text(this, GAME_W / 2, y, `Трофей: ${def?.name ?? d.itemId}${def ? `  (${itemStatsText(def.stats)})` : ''}`, 32, def ? RARITY_COLORS[def.rarity] : '#ffffff', {
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 5,
        });
        this.tweens.add({ targets: t, scale: { from: 1.25, to: 1 }, duration: 500, ease: 'Back.easeOut' });
        y += 50;
      }
      const lines = describeEvents(events, outcome.save, GAME);
      const shown = lines.slice(0, MAX_EVENT_LINES);
      if (lines.length > shown.length) shown.push(`…и ещё ${lines.length - shown.length}`);
      for (const line of shown) {
        const hot = line.startsWith('Смена профессии');
        text(this, GAME_W / 2, y, line, hot ? 34 : 30, hot ? '#ffd84a' : '#9fe0a6', { stroke: '#000000', strokeThickness: 4, fontStyle: hot ? 'bold' : 'normal' });
        y += hot ? 48 : 42;
      }
      y += 15;
    }

    // Сводка: почему победила сторона — кто сколько нанёс, вылечил и заблокировал.
    // Высота строки — чтобы обе таблицы влезли до кнопок.
    const headers = compact ? 2 * (42 + 42 + 10) : 2 * (55 + 50 + 30);
    const row = Phaser.Math.Clamp(Math.floor((1700 - y - headers) / Math.max(1, r.units.length)), 56, 85);
    const cols = [150, 400, 560, 720, 870, 990];
    const heads = ['', 'Урон', 'Лечение', 'Щит', 'Ульты', 'Жив'];
    const maxDmg = Math.max(1, ...Object.values(r.report).map((x) => x.damageDealt));
    const fs = compact ? 26 : 30;
    for (const side of ['A', 'B'] as const) {
      text(this, GAME_W / 2, y, side === 'A' ? 'Ваш отряд' : 'Противник', compact ? 32 : 38, side === 'A' ? '#9fe0a6' : '#f0a0a0');
      y += compact ? 42 : 55;
      heads.forEach((h, i) => text(this, cols[i], y, h, compact ? 22 : 26, '#f3dfb8'));
      y += compact ? 42 : 50;
      for (const u of r.units.filter((x) => x.side === side)) {
        const rep = r.report[u.uid];
        const def = data.defs[u.unitId];
        portrait(this, 60, y, portraitKey(def?.visual.sprite ?? u.unitId), row - 10).setAlpha(rep.alive ? 1 : 0.4);
        text(this, cols[0] + 20, y, def?.name ?? u.unitId, fs).setOrigin(0, 0.5);
        this.add.rectangle(cols[1] - 70, y + 22, 140 * (rep.damageDealt / maxDmg), 6, 0xd64545).setOrigin(0, 0.5);
        text(this, cols[1], y, String(rep.damageDealt), fs);
        text(this, cols[2], y, String(rep.healingDone), fs, '#7dff8f');
        text(this, cols[3], y, String(rep.shieldGiven), fs, '#bcd6ff');
        text(this, cols[4], y, String(rep.ults), fs, '#ffd84a');
        text(this, cols[5], y, rep.alive ? '✓' : '✗', fs, rep.alive ? '#9fe0a6' : '#f0a0a0');
        y += row;
      }
      y += compact ? 10 : 30;
    }

    if (tower) {
      button(this, 190, 1830, 330, 130, 'k:buttonLong_beige', 'Главная', () => this.scene.start('Home'), 38);
      button(this, 540, 1830, 330, 130, 'ui_btn_secondary', 'К башне', () => this.scene.start('Tower'), 38);
      button(this, 890, 1830, 330, 130, 'ui_btn_primary', win ? 'Выше' : 'Ещё раз', () => this.scene.start('Battle', { mode: 'tower' }), 40);
      return;
    }

    if (stage) {
      const next = win ? nextOpenStage(session.save, stage.stageId, GAME) : null;
      const bw = 330;
      button(this, 190, 1830, bw, 130, 'k:buttonLong_beige', 'К кампании', () => this.scene.start('Campaign'), 38);
      button(this, 540, 1830, bw, 130, 'ui_btn_secondary', 'Повторить', () => this.scene.start('Battle', { mode: 'stage', stageId: stage.stageId }), 38);
      const nextBtn = button(this, 890, 1830, bw, 130, 'ui_btn_primary', 'Дальше', () => {
        if (next) this.scene.start('Stage', { stageId: next.id });
      }, 40);
      if (!next) nextBtn.container.setAlpha(0.4).disableInteractive();
      return;
    }

    button(this, 190, 1830, 330, 130, 'k:buttonLong_beige', 'Главная', () => this.scene.start('Home'), 38);
    button(this, 540, 1830, 330, 130, 'ui_btn_secondary', 'Отряд', () => this.scene.start('Prep'), 38);
    button(this, 890, 1830, 330, 130, 'ui_btn_primary', 'Ещё раз', () =>
      this.scene.start('Battle', { mode: 'test', seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0 }),
    38);
  }
}
