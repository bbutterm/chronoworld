import Phaser from 'phaser';
import { BRANCH_RARITY, claimHeroPick, heroCard, jobTitle, pendingPicks, pickOptions, rarityIndex, type HeroPick } from '../../core';
import { sfx } from '../audio';
import { openBranchPicker } from '../branchPicker';
import { GAME } from '../content';
import { ROLE_NAMES } from '../flow';
import { drawHeroCard, glowTexture, heroCardSize, rarityName, rarityPalette } from '../heroCard';
import { burst, juiceOn, moment, MOMENT_DEPTH, staggerIn } from '../juice';
import { GAME_H, GAME_W } from '../layout';
import { CONTENT_BOTTOM, CONTENT_TOP, cta, screen } from '../screen';
import { commit, session } from '../session';
import { C, COLOR, COLOR_N, E, FAMILY, M, R, S, T, Z } from '../theme';
import { button, emptyState, plate, tag, text, toast, type ButtonView } from '../ui';
import { BLEED_X, BLEED_Y } from '../layout';

export interface HeroPickData {
  /** Какой контракт (индекс в save.pendingPicks), по умолчанию первый. */
  index?: number;
  /** Куда «‹ Назад» / «Позже» (по умолчанию — «Герои»). */
  back?: { to: string; data?: object };
}

const COLS = 4;
const TILE_W = 228;
const GAP_X = S.s;
const GAP_Y = S.s;
/** Подпись «есть N» под плиткой. */
const CAP_H = 44;
const CTA_Y = CONTENT_BOTTOM - 80;

/**
 * «Контракт героя» (docs/design/heroes-v2.md, раздел 4.2): награда события — герой на выбор нужной редкости. Сетка всех
 * 12 героев (pickOptions): касание выделяет героя (золотая рамка), одна главная кнопка «Забрать» внизу (повторное касание
 * только сохраняет выбор); у фиолетового — окно выбора ветки (общий branchPicker) → claimHeroPick: новый экземпляр
 * с выбранной веткой, момент «Контракт исполнен!». «‹» в шапке — позже (контракт остаётся: плитка в «Героях»).
 */
export class HeroPickScene extends Phaser.Scene {
  constructor() {
    super('HeroPick');
  }

  private back: { to: string; data?: object } = { to: 'Heroes' };
  private selected: string | null = null;
  private choosing = false;
  private claiming = false;

  create(data: HeroPickData = {}): void {
    this.back = data.back ?? { to: 'Heroes' };
    this.selected = null;
    this.choosing = false;
    this.claiming = false;
    screen(this, 'Контракт героя', 'Heroes', this.back);
    const picks = pendingPicks(session.save);
    const index = Math.min(Math.max(0, data.index ?? 0), Math.max(0, picks.length - 1));
    const pick = picks[index];
    if (!pick) {
      emptyState(this, GAME_W / 2, GAME_H / 2 - 100, 'Контрактов нет');
      cta(this, GAME_W / 2, CTA_Y, 'К героям', () => this.scene.start('Heroes'));
      return;
    }
    this.head(pick, picks.length);
    const go = cta(this, GAME_W / 2, CTA_Y, 'Забрать', () => this.selected && this.choose(pick, index, this.selected), { w: 640, enabled: false });
    go.container.setName('pickClaim');
    this.grid(pick, go);
  }

  /** Заголовок: «Фиолетовый герой на выбор» и число контрактов; как выбрать — видно по самой сетке (без инструкции). */
  private head(pick: HeroPick, count: number): void {
    const y = CONTENT_TOP + 40;
    const t = text(this, GAME_W / 2, y, `${rarityName(pick.rarity)} герой на выбор`, T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setName('pickTitle');
    if (count > 1) tag(this, t.x + t.width / 2 + S.s, y, `×${count}`, 'accent', { align: 'left' });
  }

  private grid(pick: HeroPick, go: ButtonView): void {
    const ids = pickOptions(pick, GAME);
    const { h } = heroCardSize(TILE_W);
    const rowH = h + CAP_H + GAP_Y;
    const rows = Math.ceil(ids.length / COLS);
    // Сетка — по центру между заголовком и кнопкой.
    const room = CTA_Y - 90 - (CONTENT_TOP + 90);
    const top = CONTENT_TOP + 90 + Math.max(0, (room - rows * rowH) / 2);
    const x0 = GAME_W / 2 - ((COLS - 1) * (TILE_W + GAP_X)) / 2;
    const owned = (tid: string) => session.save.heroes.filter((x) => x.templateId === tid).length;
    // Рамка выделения (одна, переезжает к выбранной плитке).
    const ring = plate(this, 0, 0, TILE_W + 20, h + 20, { fill: COLOR.surfaceSunken, alpha: 0.01, border: COLOR.accent, borderW: 6, r: R.l }).setVisible(false).setName('pickRing');
    const glow = this.add.image(0, 0, glowTexture(this)).setDisplaySize(TILE_W * 1.6, h * 1.4).setTint(COLOR_N.accent).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    const tiles: Phaser.GameObjects.GameObject[][] = [];
    ids.forEach((tid, i) => {
      const x = x0 + (i % COLS) * (TILE_W + GAP_X);
      const y = top + h / 2 + Math.floor(i / COLS) * rowH;
      const n = owned(tid);
      const select = () => {
        if (this.choosing || this.claiming) return;
        this.selected = tid;
        ring.setPosition(x, y).setVisible(true);
        glow.setPosition(x, y).setVisible(true);
        if (juiceOn()) {
          ring.setScale(1.06);
          this.tweens.add({ targets: ring, scale: 1, duration: M.base, ease: E.pop });
        }
        go.setEnabled(true);
        go.setLabel(`Забрать: ${GAME.content.heroes[tid]?.name ?? tid}`);
      };
      const tile = drawHeroCard(this, x, y, tid, { w: TILE_W, rarity: pick.rarity, level: null, onTap: select });
      tile.setName(`pick_${tid}`);
      // Роль уже значком на плитке; подпись — только «есть N» (сколько копий уже у игрока: пойдут на вознесение).
      const group: Phaser.GameObjects.GameObject[] = [tile];
      if (n) group.push(text(this, x, y + h / 2 + CAP_H / 2 + 4, `есть ${n}`, T.caption, COLOR.textSecondary));
      tiles.push(group);
    });
    this.children.bringToTop(ring);
    staggerIn(this, 'HeroPick', tiles);
  }

  /** Герой выбран: у фиолетового — окно ветки, иначе сразу забрать. */
  private choose(pick: HeroPick, index: number, templateId: string): void {
    const t = GAME.content.heroes[templateId];
    if (!t || this.choosing || this.claiming) return;
    if (rarityIndex(pick.rarity) < rarityIndex(BRANCH_RARITY)) {
      this.claim(index, templateId, undefined);
      return;
    }
    this.choosing = true;
    openBranchPicker(this, {
      templateId,
      title: `${t.name}: ветка`,
      subtitle: `${rarityName(pick.rarity)} · первая смена ветки бесплатно`,
      confirmLabel: (job) => (job ? `Забрать: ${jobTitle(GAME, job, t.gender)}` : 'Выберите ветку'),
      onCancel: () => { this.choosing = false; },
      onConfirm: (job) => {
        this.choosing = false;
        this.claim(index, templateId, job);
      },
    });
  }

  private claim(index: number, templateId: string, branch: string | undefined): void {
    if (this.claiming) return;
    this.claiming = true;
    try {
      const r = claimHeroPick(session.save, index, templateId, branch, GAME);
      commit(r.save);
      this.reveal(r.heroId);
    } catch (e) {
      this.claiming = false;
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** Показ: момент «Контракт исполнен!» (juice.ts: стингер, вибрация, лучи), герой в стойке, вспышка цвета редкости. */
  private reveal(heroId: string): void {
    const hero = session.save.heroes.find((h) => h.id === heroId);
    if (!hero) return;
    const c = heroCard(hero, GAME);
    const pal = rarityPalette(hero.rarity);
    const motion = juiceOn();
    // Подложка под моментом (экран не просвечивает) и передний слой над его затемнением.
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, COLOR_N.bg, 0.95).setDepth(Z.modal).setInteractive();
    const layer = this.add.container(0, 0).setDepth(MOMENT_DEPTH + 10).setName('pickReveal');
    const cy = 800;
    const W = 440;
    const halo = this.add.image(GAME_W / 2, cy, glowTexture(this)).setDisplaySize(760, 860).setTint(pal.tint).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD);
    const card = drawHeroCard(this, GAME_W / 2, cy, hero, { w: W, figure: 'sprite', showIcons: false, glow: true });
    layer.add([halo, card]);
    const y = cy + heroCardSize(W).h / 2 + 64;
    const role = tag(this, GAME_W / 2, y, `${c.jobName} · ${ROLE_NAMES[c.role] ?? c.role}`, 'neutral');
    layer.add(role);
    const more = pendingPicks(session.save).length;
    const btnY = CONTENT_BOTTOM - 80;
    const go = cta(this, GAME_W / 2 + (more ? 250 : 0), btnY, 'К герою', () => this.scene.start('Hero', { heroId }), { w: 480 });
    go.container.setName('pickDone');
    layer.add(go.container);
    const extra = more ? button(this, GAME_W / 2 - 250, btnY, 460, 120, '', `Ещё контракт · ${more}`, () => this.scene.restart({ back: this.back }), T.body, { variant: 'secondary' }).container : null;
    if (extra) layer.add(extra);
    moment(this, 'ascend', { title: 'Контракт исполнен!', subtitle: c.name, color: pal.light, at: { x: GAME_W / 2, y: 300 }, keep: true });
    sfx('job_change', { delay: 0.5 });
    if (motion) {
      burst(this, { x: GAME_W / 2, y: cy });
      const flash = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, pal.tint, 0.8).setDepth(MOMENT_DEPTH + 20).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: flash, alpha: 0, duration: 520, onComplete: () => flash.destroy() });
      card.setScale(0.85).setAlpha(0);
      this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: M.slow, ease: E.pop });
      // Кнопки — последними (§4.6: не нажать случайно).
      for (const b of [go.container, extra, role]) {
        if (!b) continue;
        b.setAlpha(0);
        this.tweens.add({ targets: b, alpha: 1, duration: M.base, delay: b === role ? M.slow : 900 });
      }
    }
  }
}
