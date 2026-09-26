import Phaser from 'phaser';
import { GAME } from '../content';
import { autoNextStage, describeEvents, formatNumber, itemStatsText, nextOpenStage, RARITY_COLORS, type AutoStop } from '../flow';
import type { BattleResult, Side } from '../../core';
import { GAME_W } from '../layout';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { button, panel, progressBar, text } from '../ui';
import { AUTO_DELAY_MS, autoAdvance, setAutoAdvance } from '../state';
import { C, FS, OUTLINE, SP, TINT, TOUCH } from '../theme';
import type { ResultData } from './BattleScene';
import { portrait } from '../screen';

const MAX_EVENT_LINES = 5;
/** Шаг строки события, минимальная высота строки таблицы, центр строки «Авто: следующий этап». */
const EVENT_LINE = 42;
const ROW_MIN = 56;
const AUTO_Y = 1680;
/** Жирный светлый текст с обводкой (награды, трофеи). */
const BOLD_OUTLINE = { fontStyle: 'bold', ...OUTLINE } as const;

/** Высота таблицы итогов (две стороны: заголовок, шапка, строки) при минимальной высоте строки. */
function tableMinHeight(units: number, compact: boolean): number {
  return (compact ? 2 * (40 + 38 + 10) : 2 * (55 + 50 + 30)) + units * ROW_MIN;
}

export class ResultScene extends Phaser.Scene {
  /** R: идущий обратный отсчёт авто-прохождения (null — нет). */
  private autoTimer: Phaser.Time.TimerEvent | null = null;
  /** Низ таблицы итогов и верх строки «Авто» (для e2e-проверки раскладки). */
  tableEnd = 0;
  autoTop = Infinity;

  constructor() {
    super('Result');
  }

  create(data: ResultData): void {
    const r = data.result;
    const stage = data.stage;
    const tower = data.tower;
    const win = r.winner === 'A';
    const compact = !!stage || !!tower;
    this.autoTimer = null;
    this.add.image(GAME_W / 2, 960, 'bg_arena').setDisplaySize(GAME_W, 1920).setAlpha(0.5);
    this.add.image(GAME_W / 2, compact ? 190 : 250, win ? 'ui_victory' : 'ui_defeat').setDisplaySize(compact ? 760 : 900, compact ? 338 : 400);
    const top = compact ? 380 : 470;
    panel(this, GAME_W / 2, (top + 1730) / 2, 1050, 1730 - top + 20, 'ui_panel');
    const reason = r.reason === 'timeout' ? 'Время вышло — атакующий проиграл' : win ? 'Отряд противника уничтожен' : 'Ваш отряд уничтожен';
    let y = top + 50;
    // Под этапом кампании — строка «Авто: следующий этап» (R), таблица заканчивается выше.
    const tableBottom = stage ? AUTO_Y - TOUCH / 2 - SP.s : 1700;
    const where = tower ? `Башня, этаж ${tower.floor} · ` : stage?.skipped ? 'Бой пропущен · ' : '';
    text(this, GAME_W / 2, y, `${where}${reason} · ${r.duration.toFixed(1)} с`, FS.small, C.muted, OUTLINE);
    y += 60;

    const outcome = stage?.outcome ?? tower?.outcome;
    if (outcome) {
      const events = outcome.events;
      const rewards = events.find((e) => e.type === 'rewards');
      if (rewards && rewards.type === 'rewards') {
        text(this, GAME_W / 2, y, `Награда: золото +${rewards.gold} · опыт +${rewards.jobExp} каждому`, FS.body, C.gold, BOLD_OUTLINE);
      } else {
        text(this, GAME_W / 2, y, tower ? 'Этаж не взят. Усильте отряд и попробуйте снова.' : 'Награды нет. Прокачайте героев или смените профессию.', FS.small, C.enemy, OUTLINE);
      }
      y += 55;
      // K6: выпавшие предметы — цветом редкости.
      for (const d of stage?.outcome.drops ?? []) {
        const def = GAME.equipment.items[d.itemId];
        const t = text(this, GAME_W / 2, y, `Трофей: ${def?.name ?? d.itemId}${def ? `  (${itemStatsText(def.stats)})` : ''}`, FS.body, def ? RARITY_COLORS[def.rarity] : C.text, BOLD_OUTLINE);
        this.tweens.add({ targets: t, scale: { from: 1.25, to: 1 }, duration: 500, ease: 'Back.easeOut' });
        y += 50;
      }
      // S: строк событий столько, чтобы таблица при минимальной высоте строки влезла до низа (не наезжала на «Авто»).
      const room = tableBottom - y - tableMinHeight(r.units.length, compact) - 15;
      const maxLines = Phaser.Math.Clamp(Math.floor(room / EVENT_LINE), 1, MAX_EVENT_LINES);
      const lines = describeEvents(events, outcome.save, GAME);
      const shown = lines.slice(0, maxLines);
      if (lines.length > shown.length) shown[shown.length - 1] = `…и ещё ${lines.length - shown.length + 1}`;
      for (const line of shown) {
        const hot = line.startsWith('Смена профессии');
        text(this, GAME_W / 2, y, line, hot ? FS.body : FS.small, hot ? C.gold : C.success, hot ? BOLD_OUTLINE : OUTLINE);
        y += EVENT_LINE;
      }
      y += 15;
    }

    // Сводка: почему победила сторона — кто сколько нанёс, вылечил и заблокировал.
    // Высота строки — чтобы обе таблицы влезли до кнопок.
    const headers = tableMinHeight(0, compact);
    const row = Phaser.Math.Clamp(Math.floor((tableBottom - y - headers) / Math.max(1, r.units.length)), ROW_MIN, 85);
    const cols = [150, 430, 590, 740, 870, 985];
    const heads = ['', 'Урон', 'Лечение', 'Щит', 'Ульты', 'Жив'];
    const maxDmg = Math.max(1, ...Object.values(r.report).map((x) => x.damageDealt));
    const mvp = mvpOf(r, 'A');
    const fs = compact ? FS.caption : FS.small;
    for (const side of ['A', 'B'] as const) {
      text(this, GAME_W / 2, y, side === 'A' ? 'Ваш отряд' : 'Противник', compact ? FS.body : FS.h3, side === 'A' ? C.success : C.enemy, BOLD_OUTLINE);
      y += compact ? 40 : 55;
      heads.forEach((h, i) => text(this, cols[i], y, h, FS.caption, C.muted));
      y += compact ? 38 : 50;
      r.units
        .filter((x) => x.side === side)
        .forEach((u, i) => {
          const rep = r.report[u.uid];
          const def = data.defs[u.unitId];
          const isMvp = u.uid === mvp;
          // Полосатые строки читаются легче; строка MVP — золотая.
          if (isMvp) this.add.rectangle(GAME_W / 2, y, 1000, row - 6, TINT.gold, 0.18).setStrokeStyle(3, TINT.gold, 0.9);
          else if (i % 2 === 0) this.add.rectangle(GAME_W / 2, y, 1000, row - 6, TINT.pressed, 0.18);
          const alpha = rep.alive ? 1 : 0.5;
          portrait(this, 70, y, portraitKey(def?.visual.sprite ?? u.unitId), row - 12).setAlpha(alpha);
          if (isMvp) crown(this, 70 + (row - 12) / 2 - 6, y - (row - 12) / 2 + 6, 22);
          const name = text(this, cols[0] - 20, isMvp ? y - 11 : y, def?.name ?? u.unitId, fs, isMvp ? C.title : C.text, {
            fontStyle: isMvp ? 'bold' : 'normal',
          })
            .setOrigin(0, 0.5)
            .setAlpha(alpha);
          if (name.width > cols[1] - 70 - name.x) name.setScale((cols[1] - 70 - name.x) / name.width);
          if (isMvp) text(this, cols[0] - 20, y + 14, 'MVP', FS.caption, C.gold, { fontStyle: 'bold' }).setOrigin(0, 0.5);
          this.add.rectangle(cols[1] - 60, y + 22, 120 * (rep.damageDealt / maxDmg), 6, TINT.danger).setOrigin(0, 0.5);
          const dim = (n: number, color: string) => (n > 0 ? color : C.placeholder);
          text(this, cols[1], y - 2, formatNumber(rep.damageDealt), fs, dim(rep.damageDealt, isMvp ? C.gold : C.text), { fontStyle: isMvp ? 'bold' : 'normal' });
          text(this, cols[2], y, formatNumber(rep.healingDone), fs, dim(rep.healingDone, C.positive));
          text(this, cols[3], y, formatNumber(rep.shieldGiven), fs, dim(rep.shieldGiven, C.shield));
          text(this, cols[4], y, String(rep.ults), fs, dim(rep.ults, C.gold));
          text(this, cols[5], y, rep.alive ? '✓' : '✗', fs, rep.alive ? C.success : C.enemy, { fontStyle: 'bold' });
          y += row;
        });
      y += compact ? 10 : 30;
    }
    /** Низ таблицы — для e2e (таблица не должна наезжать на строку «Авто»). */
    this.tableEnd = y;

    if (tower) {
      button(this, 190, 1830, 330, 130, 'k:buttonLong_beige', 'Главная', () => this.scene.start('Home'), FS.h3);
      button(this, 540, 1830, 330, 130, 'ui_btn_secondary', 'К башне', () => this.scene.start('Tower'), FS.h3);
      button(this, 890, 1830, 330, 130, 'ui_btn_primary', win ? 'Выше' : 'Ещё раз', () => this.scene.start('Battle', { mode: 'tower' }), FS.h2);
      return;
    }

    if (stage) {
      const next = win ? nextOpenStage(session.save, stage.stageId, GAME) : null;
      const bw = 330;
      button(this, 190, 1830, bw, 130, 'k:buttonLong_beige', 'К кампании', () => this.scene.start('Campaign'), FS.h3);
      button(this, 540, 1830, bw, 130, 'ui_btn_secondary', 'Повторить', () => this.scene.start('Battle', { mode: 'stage', stageId: stage.stageId }), FS.h3);
      const nextBtn = button(this, 890, 1830, bw, 130, 'ui_btn_primary', 'Дальше', () => {
        if (next) this.scene.start('Stage', { stageId: next.id });
      }, FS.h2);
      if (!next) nextBtn.container.setAlpha(0.4).disableInteractive();
      this.autoRow(stage.stageId, win);
      return;
    }

    button(this, 190, 1830, 330, 130, 'k:buttonLong_beige', 'Главная', () => this.scene.start('Home'), FS.h3);
    button(this, 540, 1830, 330, 130, 'ui_btn_secondary', 'Отряд', () => this.scene.start('Prep'), FS.h3);
    button(this, 890, 1830, 330, 130, 'ui_btn_primary', 'Ещё раз', () =>
      this.scene.start('Battle', { mode: 'test', seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0 }),
    FS.h3);
  }

  /**
   * R. «Авто: следующий этап» (как авто-бой в AFK Arena): переключатель запоминается; если он включён и бой
   * выигран, через AUTO_DELAY_MS сам стартует следующий новый этап главы. Любое касание экрана отменяет отсчёт.
   */
  private autoRow(stageId: string, win: boolean): void {
    const y = AUTO_Y;
    this.autoTop = y - TOUCH / 2;
    const plan = autoNextStage(session.save, stageId, win, GAME);
    const toggle = button(this, 280, y, 520, TOUCH, 'k:buttonLong_beige', 'Авто: следующий этап', () => {
      setAutoAdvance(!autoAdvance.on);
      drawMark();
      if (autoAdvance.on) start();
      else cancel('Авто выключено');
    }, FS.small);
    // S: чекбокс — тёмный квадрат с рамкой; включён — зелёный с белой галочкой (читается на бежевой кнопке).
    const BOX = 52;
    toggle.label.setX(BOX / 2 + 10);
    const boxX = toggle.label.x - toggle.label.width / 2 - BOX / 2 - 16;
    const box = this.add.rectangle(boxX, -3, BOX, BOX, TINT.checkOff).setStrokeStyle(5, TINT.header);
    const check = text(this, boxX, -5, '✓', FS.h2, C.text, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 4 });
    toggle.container.add([box, check]);
    const drawMark = () => {
      box.setFillStyle(autoAdvance.on ? TINT.success : TINT.checkOff).setStrokeStyle(5, autoAdvance.on ? TINT.header : TINT.frame);
      check.setVisible(autoAdvance.on);
    };
    drawMark();

    const status = text(this, 790, y - 16, '', FS.small, C.muted, { ...OUTLINE, wordWrap: { width: 480 } });
    const bar = progressBar(this, 580, y + 32, 420, 16, 0, TINT.gold).setVisible(false);
    const fill = bar.list[1] as Phaser.GameObjects.Rectangle;
    const fullW = 420 - 4;

    const cancelOnTap = () => cancel('Авто отменено — нажмите «Дальше»');
    const cancel = (msg: string) => {
      this.autoTimer?.remove();
      this.autoTimer = null;
      this.input.off('pointerdown', cancelOnTap);
      bar.setVisible(false);
      status.setText(msg).setColor(C.muted);
    };
    const start = () => {
      if (!plan.next) {
        status.setText(AUTO_STOP_TEXT[plan.stop ?? 'no_next']).setColor(plan.stop === 'defeat' ? C.danger : C.warning);
        return;
      }
      const next = plan.next;
      // Время считаем тиками таймера (они замирают на паузе сцены), а не часами игры.
      const STEP = 100;
      let elapsed = -STEP;
      bar.setVisible(true);
      const tick = () => {
        elapsed += STEP;
        const left = Math.max(0, AUTO_DELAY_MS - elapsed);
        status.setText(`Этап ${next.globalIndex + 1} через ${(left / 1000).toFixed(1)} с\nкоснитесь экрана — отмена`).setColor(C.gold);
        fill.width = fullW * (1 - left / AUTO_DELAY_MS);
        if (left > 0) return;
        cancel('');
        this.scene.start('Battle', { mode: 'stage', stageId: next.id });
      };
      tick();
      this.autoTimer = this.time.addEvent({ delay: STEP, loop: true, callback: tick });
      // Касание в любом месте (в том числе по кнопкам внизу) — отмена отсчёта.
      this.input.on('pointerdown', cancelOnTap);
    };

    if (autoAdvance.on) start();
    else status.setText('Включите — бои пойдут сами до конца главы');
  }
}

const AUTO_STOP_TEXT: Record<AutoStop, string> = {
  defeat: 'Поражение — авто остановлено',
  chapter_end: 'Глава пройдена — авто остановлено',
  no_next: 'Дальше этапов нет',
  replay: 'Это повтор — авто идёт только по новым этапам',
};

/** MVP стороны — больше всех урона (при равенстве — лечение + щит). Никто ничего не сделал — нет MVP. */
export function mvpOf(r: BattleResult, side: Side): string | null {
  let best: string | null = null;
  let score = 0;
  for (const u of r.units) {
    if (u.side !== side) continue;
    const rep = r.report[u.uid];
    const s = rep.damageDealt * 1e6 + rep.healingDone + rep.shieldGiven;
    if (s > score) {
      score = s;
      best = u.uid;
    }
  }
  return best;
}

/** Корона MVP — многоугольник (своей иконки в атласе нет). size — ширина. */
function crown(scene: Phaser.Scene, x: number, y: number, size: number): void {
  const w = size;
  const h = size * 0.7;
  const pts = [0, h, 0, h * 0.25, w * 0.25, h * 0.55, w * 0.5, 0, w * 0.75, h * 0.55, w, h * 0.25, w, h];
  scene.add.polygon(x, y, pts, TINT.gold).setStrokeStyle(3, 0x7a4a00).setDisplaySize(size * 1.6, h * 1.6);
}
