import Phaser from 'phaser';
import { markHint } from '../hints';
import { heroPower, squadPower, towerFloor, towerStatus, unitPower, withGear } from '../../core';
import { GAME } from '../content';
import { formatNumber, heroSprite, POWER_COLORS, powerTone } from '../flow';
import { GAME_W } from '../layout';
import { card, CONTENT_TOP, gemIcon, portrait, screen, unitTint } from '../screen';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { fitName } from '../squadEditor';
import { button, panel, pressable, text } from '../ui';
import { ctaShine, glow, medallion, ribbon } from '../decor';
import { SKIN, SKIN_TINT, skinIcon } from '../skin';
import { C, FS } from '../theme';
import { collect, staggerIn } from '../juice';

const SLOT_W = 190;
const slotX = (i: number) => GAME_W / 2 + (i - 2) * (SLOT_W + 12);

/** K4. Башня испытаний: пройденный этаж, превью следующего (враги, босс, награда, мощь) и «Штурм». */
export class TowerScene extends Phaser.Scene {
  constructor() {
    super('Tower');
  }

  create(): void {
    screen(this, 'Башня испытаний', 'Home', { to: 'Home' });
    markHint('tower_open');
    const save = session.save;
    const st = towerStatus(save, GAME);
    const top = CONTENT_TOP;

    if (!st.unlocked) {
      const stage = GAME.content.stages.find((s) => s.id === st.unlockAfterStage);
      card(this, GAME_W / 2, top + 300, 1000, 500);
      this.add.image(GAME_W / 2, top + 160, skinIcon('lock')).setDisplaySize(120, 120).setTint(SKIN_TINT.gold);
      text(this, GAME_W / 2, top + 300, 'Башня пока закрыта', FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 });
      text(this, GAME_W / 2, top + 380, stage ? `Пройдите этап ${stage.globalIndex + 1} «${stage.name}» кампании` : 'Пройдите кампанию дальше', FS.h3, C.text, {
        wordWrap: { width: 880 },
      });
      button(this, GAME_W / 2, top + 650, 640, 140, 'ui_btn_primary', 'В кампанию', () => this.scene.start('Campaign'), FS.h1);
      return;
    }

    // --- Где мы: пройденный этаж и лестница ближайших этажей ---
    card(this, GAME_W / 2, top + 190, 1040, 380);
    const band = st.next !== null ? GAME.tower.bands[towerFloor(st.next, GAME).band] : GAME.tower.bands[GAME.tower.bands.length - 1];
    text(this, 80, top + 70, 'Пройдено этажей', FS.body, C.muted).setOrigin(0, 0.5);
    text(this, 80, top + 150, `${st.floor}`, 110, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10 }).setOrigin(0, 0.5);
    text(this, 80, top + 240, `из ${st.maxFloor}`, FS.body, C.muted).setOrigin(0, 0.5);
    text(this, 80, top + 310, band?.name ?? '', FS.h3, C.success, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5);
    // Между счётом и лестницей — медальон башни в тёплом ореоле.
    glow(this, 470, top + 180, 300, 0xffc860, 0.35, true);
    medallion(this, 470, top + 180, 190, 'tower');
    this.ladder(st.floor, st.maxFloor, 800, top + 30);

    if (st.next === null) {
      text(this, GAME_W / 2, top + 600, 'Вершина башни взята!', FS.h1, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 8 });
      return;
    }

    // --- Следующий этаж ---
    const f = towerFloor(st.next, GAME);
    const cy = top + 410;
    card(this, GAME_W / 2, cy + 330, 1040, 660);
    ribbon(this, GAME_W / 2, cy + 45, `Этаж ${f.floor}${f.boss ? '  ·  БОСС' : ''}`, { size: FS.h2, minW: 420 });
    const slots: Phaser.GameObjects.GameObject[][] = [];
    f.enemies.forEach((u, i) => slots.push(collect(this.children, () => this.enemySlot(u, i, cy))));
    staggerIn(this, 'Tower', slots);

    this.floorFooter(f, cy);
  }

  /** Слот врага следующего этажа: рамка, «фронт/тыл», портрет, имя целиком и мощь. */
  private enemySlot(u: ReturnType<typeof towerFloor>['enemies'][number], i: number, cy: number): void {
    const x = slotX(i);
    const y = cy + 235;
    const boss = u?.kind === 'boss';
    panel(this, x, y, SLOT_W, 230, u ? 'ui_slot_filled' : 'ui_slot_empty');
    text(this, x, y - 138, i < 2 ? 'фронт' : 'тыл', FS.caption, C.dim);
    if (!u) return;
    if (boss) this.add.rectangle(x, y, SLOT_W - 8, 222).setStrokeStyle(6, 0xd64545);
    portrait(this, x, y - 38, portraitKey(u.visual.sprite), 116).setTint(unitTint(u.visual));
    // T3-26: имя врага целиком (две строки при необходимости) и его мощь.
    fitName(text(this, x, y + 45, u.name, FS.caption, boss ? C.danger : C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4, lineSpacing: -4 }), SLOT_W - 14);
    text(this, x, y + 94, formatNumber(unitPower(u, GAME)), FS.small, boss ? C.danger : C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
    if (boss) text(this, x, y - 95, 'БОСС', FS.small, C.text, { fontStyle: 'bold', backgroundColor: C.labelDanger, padding: { x: 10, y: 2 } });
  }

  private floorFooter(f: ReturnType<typeof towerFloor>, cy: number): void {
    const save = session.save;

    // Награда
    const ry = cy + 410;
    const r = f.rewards;
    const parts = [`золото +${formatNumber(r.gold)}`, `опыт +${formatNumber(r.jobExp)} в запас`];
    const rt = text(this, GAME_W / 2, ry, `Награда: ${parts.join(' · ')}${r.gems ? ` · +${formatNumber(r.gems)}` : ''}`, FS.body, C.gold, {
      fontStyle: 'bold',
      stroke: C.stroke,
      strokeThickness: 5,
    });
    if (r.gems) gemIcon(this, rt.x + rt.width / 2 + 26, ry, 34);

    // Мощь
    const enemy = f.enemies.reduce((s, u) => s + (u ? unitPower(u, GAME) : 0), 0);
    const mine = squadPower(save, GAME);
    const tone = powerTone(mine, enemy);
    text(this, GAME_W / 2, ry + 65, `Мощь: ваш отряд ${formatNumber(mine)}  ·  этаж ${formatNumber(enemy)}`, FS.body, POWER_COLORS[tone], {
      fontStyle: 'bold',
      stroke: C.stroke,
      strokeThickness: 6,
    });
    const hint = tone === 'ahead' ? 'Отряд сильнее — вперёд!' : tone === 'close' ? 'Силы почти равны — возможна победа' : 'Враги намного сильнее: прокачайте героев и экипировку';
    text(this, GAME_W / 2, ry + 120, hint, FS.small, C.muted);

    // --- Отряд ---
    this.squad(cy + 740);

    // K8: отряд общий с кампанией, но редактируется прямо отсюда.
    button(this, 260, 1650, 420, 140, 'ui_btn_secondary', 'Изменить отряд', () => this.editSquad(), FS.h3);
    glow(this, 760, 1650, 128, 0xffc860, 0.2, true).setScale(700 / 128, 280 / 128);
    const go = button(this, 760, 1650, 520, 140, 'ui_btn_primary', 'Штурм', () => this.assault(), FS.hero);
    go.label.setX(30);
    go.container.add(this.add.image(30 - go.label.width / 2 - 48, -4, skinIcon('swords')).setDisplaySize(62, 62).setTint(0x3a2408));
    ctaShine(this, go.container, 520, 140);
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
      // Ступени в цветах скина: тёмная бронза, следующий этаж — золотая рамка, босс — красная.
      // Плитки скина (фаска, металлическая рамка); босс — красноватый оттенок.
      const w = 300 - i * 6;
      const step = panel(this, x, y, w, h, next ? 'ui_slot_selected' : done ? 'ui_slot_empty' : 'ui_slot_filled');
      if (boss && !next) step.setTint(0xff9a8a);
      const label = next ? `${n} · следующий` : `${n}${boss ? ' · босс' : ''}`;
      text(this, x, y, label, next ? FS.small : FS.body, done ? C.dim : next ? SKIN.goldLight : boss ? C.danger : SKIN.cream, { fontStyle: 'bold' });
      if (done) this.add.image(x + w / 2 - 34, y, skinIcon('check')).setDisplaySize(34, 34).setTint(0x9fe0a6);
    });
  }

  private squad(y: number): void {
    const save = session.save;
    const gctx = withGear(GAME, save);
    pressable(this, card(this, GAME_W / 2, y + 115, 1040, 250, true), 1040, 250, () => this.editSquad());
    text(this, GAME_W / 2, y + 22, 'Ваш отряд (общий с кампанией) — нажмите, чтобы изменить', FS.small, C.ink, { fontStyle: 'bold' });
    save.squad.forEach((id, i) => {
      const x = slotX(i);
      const hero = id ? save.heroes.find((h) => h.id === id) : undefined;
      if (!hero) {
        text(this, x, y + 120, 'пусто', FS.small, C.placeholder);
        return;
      }
      portrait(this, x, y + 105, portraitKey(heroSprite(hero, GAME)), 110);
      text(this, x, y + 190, formatNumber(heroPower(hero, gctx)), FS.small, C.ink, { fontStyle: 'bold' });
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
