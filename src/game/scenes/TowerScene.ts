import Phaser from 'phaser';
import { heroPower, squadPower, towerFloor, towerStatus, unitPower, withGear } from '../../core';
import { GAME } from '../content';
import { formatNumber, heroSprite, POWER_COLORS, powerTone } from '../flow';
import { GAME_W } from '../layout';
import { card, CONTENT_TOP, gemIcon, portrait, screen } from '../screen';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { button, icon, panel, text } from '../ui';

const SLOT_W = 190;
const slotX = (i: number) => GAME_W / 2 + (i - 2) * (SLOT_W + 12);

/** K4. Башня испытаний: пройденный этаж, превью следующего (враги, босс, награда, мощь) и «Штурм». */
export class TowerScene extends Phaser.Scene {
  constructor() {
    super('Tower');
  }

  create(): void {
    screen(this, 'Башня испытаний', 'Home', { to: 'Home' });
    const save = session.save;
    const st = towerStatus(save, GAME);
    const top = CONTENT_TOP;

    if (!st.unlocked) {
      const stage = GAME.content.stages.find((s) => s.id === st.unlockAfterStage);
      card(this, GAME_W / 2, top + 300, 1000, 500);
      icon(this, GAME_W / 2, top + 160, 'iconCross_grey', 110);
      text(this, GAME_W / 2, top + 300, 'Башня пока закрыта', 48, '#ffe9a8', { fontStyle: 'bold', stroke: '#3a2412', strokeThickness: 6 });
      text(this, GAME_W / 2, top + 380, stage ? `Пройдите этап ${stage.globalIndex + 1} «${stage.name}» кампании` : 'Пройдите кампанию дальше', 34, '#ffffff', {
        wordWrap: { width: 880 },
      });
      button(this, GAME_W / 2, top + 650, 640, 140, 'ui_btn_primary', 'В кампанию', () => this.scene.start('Campaign'), 46);
      return;
    }

    // --- Где мы: пройденный этаж и лестница ближайших этажей ---
    card(this, GAME_W / 2, top + 190, 1040, 380);
    const band = st.next !== null ? GAME.tower.bands[towerFloor(st.next, GAME).band] : GAME.tower.bands[GAME.tower.bands.length - 1];
    text(this, 80, top + 70, 'Пройдено этажей', 32, '#e0cfb0').setOrigin(0, 0.5);
    text(this, 80, top + 150, `${st.floor}`, 110, '#ffe9a8', { fontStyle: 'bold', stroke: '#3a2412', strokeThickness: 10 }).setOrigin(0, 0.5);
    text(this, 80, top + 240, `из ${st.maxFloor}`, 32, '#e0cfb0').setOrigin(0, 0.5);
    text(this, 80, top + 310, band?.name ?? '', 34, '#9fe0a6', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 }).setOrigin(0, 0.5);
    this.ladder(st.floor, st.maxFloor, 800, top + 30);

    if (st.next === null) {
      text(this, GAME_W / 2, top + 600, 'Вершина башни взята!', 50, '#ffd84a', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 8 });
      return;
    }

    // --- Следующий этаж ---
    const f = towerFloor(st.next, GAME);
    const cy = top + 410;
    card(this, GAME_W / 2, cy + 330, 1040, 660);
    text(this, GAME_W / 2, cy + 45, `Этаж ${f.floor}${f.boss ? '  ·  БОСС' : ''}`, 46, f.boss ? '#ff9a8a' : '#ffe9a8', {
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 7,
    });
    f.enemies.forEach((u, i) => {
      const x = slotX(i);
      const y = cy + 235;
      const boss = u?.kind === 'boss';
      panel(this, x, y, SLOT_W, 230, u ? 'ui_slot_filled' : 'ui_slot_empty');
      text(this, x, y - 138, i < 2 ? 'фронт' : 'тыл', 26, '#b8bcc8');
      if (!u) return;
      if (boss) this.add.rectangle(x, y, SLOT_W - 8, 222).setStrokeStyle(6, 0xd64545);
      portrait(this, x, y - 20, portraitKey(u.visual.sprite), 150);
      text(this, x, y + 80, formatNumber(unitPower(u, GAME)), 30, boss ? '#ff9a8a' : '#ffffff', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 });
      if (boss) text(this, x, y - 95, 'БОСС', 28, '#ffffff', { fontStyle: 'bold', backgroundColor: '#b83a2a', padding: { x: 10, y: 2 } });
    });

    // Награда
    const ry = cy + 410;
    const r = f.rewards;
    const parts = [`золото +${formatNumber(r.gold)}`, `опыт +${formatNumber(r.jobExp)} каждому`];
    const rt = text(this, GAME_W / 2, ry, `Награда: ${parts.join(' · ')}${r.gems ? ` · +${r.gems}` : ''}`, 32, '#ffd84a', {
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 5,
    });
    if (r.gems) gemIcon(this, rt.x + rt.width / 2 + 26, ry, 34);

    // Мощь
    const enemy = f.enemies.reduce((s, u) => s + (u ? unitPower(u, GAME) : 0), 0);
    const mine = squadPower(save, GAME);
    const tone = powerTone(mine, enemy);
    text(this, GAME_W / 2, ry + 65, `Мощь: ваш отряд ${formatNumber(mine)}  ·  этаж ${formatNumber(enemy)}`, 32, POWER_COLORS[tone], {
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    });
    const hint = tone === 'ahead' ? 'Отряд сильнее — вперёд!' : tone === 'close' ? 'Силы почти равны — возможна победа' : 'Враги намного сильнее: прокачайте героев и экипировку';
    text(this, GAME_W / 2, ry + 120, hint, 28, '#e0cfb0');

    // --- Отряд ---
    this.squad(cy + 740);

    // K8: отряд общий с кампанией, но редактируется прямо отсюда.
    button(this, 260, 1650, 420, 140, 'ui_btn_secondary', 'Изменить отряд', () => this.editSquad(), 38);
    button(this, 760, 1650, 520, 140, 'ui_btn_primary', 'Штурм', () => this.assault(), 56);
  }

  /** Лестница: 4 ближайших этажа сверху вниз, следующий подсвечен, босс-этажи красные, пройденный — внизу. */
  private ladder(floor: number, max: number, x: number, top: number): void {
    const floors: number[] = [];
    for (let n = Math.min(max, floor + 4); n >= Math.max(1, floor); n--) floors.push(n);
    const h = 64;
    floors.slice(0, 5).forEach((n, i) => {
      const y = top + 30 + i * (h + 4);
      const boss = n % GAME.tower.bossEvery === 0;
      const done = n <= floor;
      const next = n === floor + 1;
      const color = done ? 0x4a4a4a : boss ? 0x8a2a22 : next ? 0x2f6b9a : 0x5a4028;
      const w = 300 - i * 6;
      this.add.rectangle(x, y, w, h, color).setStrokeStyle(next ? 6 : 3, next ? 0xffd84a : 0x2a1a0a);
      text(this, x, y, `${n}${boss ? ' · босс' : ''}`, 30, done ? '#b8bcc8' : '#ffffff', { fontStyle: 'bold' });
      if (done) icon(this, x + w / 2 - 30, y, 'iconCheck_bronze', 36);
    });
  }

  private squad(y: number): void {
    const save = session.save;
    const gctx = withGear(GAME, save);
    const bg = card(this, GAME_W / 2, y + 115, 1040, 250, true);
    bg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.editSquad());
    text(this, GAME_W / 2, y + 22, 'Ваш отряд (общий с кампанией) — нажмите, чтобы изменить', 28, '#4a3520', { fontStyle: 'bold' });
    save.squad.forEach((id, i) => {
      const x = slotX(i);
      const hero = id ? save.heroes.find((h) => h.id === id) : undefined;
      if (!hero) {
        text(this, x, y + 120, 'пусто', 28, '#8a7a6a');
        return;
      }
      portrait(this, x, y + 105, portraitKey(heroSprite(hero, GAME)), 110);
      text(this, x, y + 190, formatNumber(heroPower(hero, gctx)), 28, '#4a3520', { fontStyle: 'bold' });
    });
  }

  private editSquad(): void {
    this.scene.start('Squad', { back: { to: 'Tower' } });
  }

  private assault(): void {
    if (!session.save.squad.some(Boolean)) {
      this.editSquad();
      return;
    }
    this.scene.start('Battle', { mode: 'tower' });
  }
}
