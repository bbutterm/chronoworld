import Phaser from 'phaser';
import { BRANCH_RARITY, claimHeroPick, heroCard, pendingPicks, pickOptions, rarityIndex, type HeroPick } from '../../core';
import { sfx } from '../audio';
import { openBranchPicker } from '../branchPicker';
import { GAME } from '../content';
import { ROLE_NAMES } from '../flow';
import { drawHeroCard, glowTexture, heroCardSize, raysTexture, rarityColor, rarityName, rarityPalette } from '../heroCard';
import { burst, juiceOn, staggerIn } from '../juice';
import { GAME_H, GAME_W } from '../layout';
import { card, CONTENT_BOTTOM, CONTENT_TOP, screen } from '../screen';
import { commit, session } from '../session';
import { C, FS, OUTLINE } from '../theme';
import { button, emptyState, text, toast } from '../ui';

export interface HeroPickData {
  /** Какой контракт (индекс в save.pendingPicks), по умолчанию первый. */
  index?: number;
  /** Куда «‹ Назад» / «Позже» (по умолчанию — «Герои»). */
  back?: { to: string; data?: object };
}

const COLS = 4;
const TILE_W = 236;
const GAP_X = 20;
const GAP_Y = 22;
const REVEAL_DEPTH = 9500;

/**
 * «Контракт героя» (docs/design/heroes-v2.md, раздел 4.2): награда события — герой на выбор нужной редкости. Сетка всех
 * 12 героев (pickOptions) → нажатие — окно выбора ветки (у фиолетового, общий компонент branchPicker) → «Забрать» —
 * claimHeroPick: новый экземпляр с выбранной веткой, показ «Контракт исполнен!». «Позже» — контракт остаётся
 * (плитка в «Героях», значок на главной).
 */
export class HeroPickScene extends Phaser.Scene {
  constructor() {
    super('HeroPick');
  }

  private back: { to: string; data?: object } = { to: 'Heroes' };

  create(data: HeroPickData = {}): void {
    this.back = data.back ?? { to: 'Heroes' };
    screen(this, 'Контракт героя', 'Heroes', this.back);
    const picks = pendingPicks(session.save);
    const index = Math.min(Math.max(0, data.index ?? 0), Math.max(0, picks.length - 1));
    const pick = picks[index];
    if (!pick) {
      emptyState(this, GAME_W / 2, GAME_H / 2 - 100, 'Контрактов героя нет.\nОни приходят наградами событий: 7-й день входа и 180 очков новичка.');
      button(this, GAME_W / 2, GAME_H / 2 + 120, 480, 120, 'ui_btn_primary', 'К героям', () => this.scene.start('Heroes'), FS.h2);
      return;
    }
    this.head(pick, picks.length);
    this.grid(pick, index);
    const later = button(this, GAME_W / 2, CONTENT_BOTTOM - 60, 460, 110, 'k:buttonLong_beige', 'Выбрать позже', () => this.scene.start(this.back.to, this.back.data), FS.h3, { sound: 'ui_back' });
    later.container.setName('pickLater');
  }

  private head(pick: HeroPick, count: number): void {
    const y = CONTENT_TOP + 70;
    card(this, GAME_W / 2, y, 1040, 150, true);
    const withBranch = rarityIndex(pick.rarity) >= rarityIndex(BRANCH_RARITY);
    text(this, GAME_W / 2, y - 32, `${rarityName(pick.rarity)} герой на выбор${count > 1 ? ` · контрактов: ${count}` : ''}`, FS.h3, C.ink, { fontStyle: 'bold' }).setName('pickTitle');
    text(this, GAME_W / 2, y + 28, withBranch ? 'Выберите героя, затем ветку второй профессии' : 'Выберите героя — он придёт новой карточкой', FS.small, C.inkMuted);
  }

  private grid(pick: HeroPick, index: number): void {
    const ids = pickOptions(pick, GAME);
    const { h } = heroCardSize(TILE_W);
    const top = CONTENT_TOP + 180;
    const x0 = GAME_W / 2 - ((COLS - 1) * (TILE_W + GAP_X)) / 2;
    const owned = (tid: string) => session.save.heroes.filter((x) => x.templateId === tid).length;
    const tiles: Phaser.GameObjects.GameObject[][] = [];
    ids.forEach((tid, i) => {
      const x = x0 + (i % COLS) * (TILE_W + GAP_X);
      const y = top + h / 2 + Math.floor(i / COLS) * (h + GAP_Y + 34);
      const n = owned(tid);
      const tile = drawHeroCard(this, x, y, tid, { w: TILE_W, rarity: pick.rarity, level: null, onTap: () => this.choose(pick, index, tid) });
      tile.setName(`pick_${tid}`);
      const t = GAME.content.heroes[tid];
      const sub = text(this, x, y + h / 2 + 20, `${ROLE_NAMES[t.role] ?? ''}${n ? ` · есть ${n}` : ''}`, FS.caption, n ? C.muted : C.positive, { stroke: C.stroke, strokeThickness: 4 });
      tiles.push([tile, sub]);
    });
    staggerIn(this, 'HeroPick', tiles);
  }

  /** Герой выбран: у фиолетового — окно ветки, иначе сразу подтверждение. */
  private choose(pick: HeroPick, index: number, templateId: string): void {
    const t = GAME.content.heroes[templateId];
    if (!t) return;
    if (rarityIndex(pick.rarity) < rarityIndex(BRANCH_RARITY)) {
      this.claim(index, templateId, undefined);
      return;
    }
    openBranchPicker(this, {
      templateId,
      title: `${t.name}: выберите ветку`,
      subtitle: `${t.name} придёт ${rarityName(pick.rarity).toLowerCase().replace(/ый$/, 'ым').replace(/ий$/, 'им')} (ур. 1). Первую смену ветки потом можно сделать бесплатно.`,
      confirmLabel: (job) => (job ? `Забрать: ${GAME.content.jobs[job]?.name ?? job}` : 'Выберите ветку'),
      onConfirm: (job) => this.claim(index, templateId, job),
    });
  }

  private claim(index: number, templateId: string, branch: string | undefined): void {
    try {
      const r = claimHeroPick(session.save, index, templateId, branch, GAME);
      commit(r.save);
      this.reveal(r.heroId);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** Показ: вспышка цвета редкости, герой в стойке, «Контракт исполнен!». */
  private reveal(heroId: string): void {
    const hero = session.save.heroes.find((h) => h.id === heroId);
    if (!hero) return;
    const c = heroCard(hero, GAME);
    const pal = rarityPalette(hero.rarity);
    const layer = this.add.container(0, 0).setDepth(REVEAL_DEPTH).setName('pickReveal');
    layer.add(this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W * 3, GAME_H * 3, 0x05040a, 0.94).setInteractive());
    const cy = 820;
    const rays = this.add.image(GAME_W / 2, cy, raysTexture(this)).setDisplaySize(1200, 1200).setTint(pal.glow).setAlpha(0.4).setBlendMode(Phaser.BlendModes.ADD);
    layer.add([rays, this.add.image(GAME_W / 2, cy, glowTexture(this)).setDisplaySize(760, 860).setTint(pal.tint).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD)]);
    layer.add(drawHeroCard(this, GAME_W / 2, cy, hero, { w: 460, figure: 'sprite', showIcons: false, glow: true }));
    layer.add(text(this, GAME_W / 2, 280, 'Контракт исполнен!', FS.hero + 8, C.gold, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10 }));
    layer.add(text(this, GAME_W / 2, 370, `${c.name} · ${c.jobName}`, FS.h1, rarityColor(hero.rarity), { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 8 }));
    const y = cy + heroCardSize(460).h / 2 + 60;
    layer.add(text(this, GAME_W / 2, y, `${c.rarity.name} · ${ROLE_NAMES[c.role] ?? c.role} · ур. ${hero.level}`, FS.h3, C.text, { fontStyle: 'bold', ...OUTLINE }));
    const more = pendingPicks(session.save).length;
    const go = button(this, GAME_W / 2 + (more ? 250 : 0), GAME_H - 250, 460, 130, 'ui_btn_primary', 'К герою', () => this.scene.start('Hero', { heroId }), FS.h2);
    go.container.setName('pickDone');
    layer.add(go.container);
    if (more) layer.add(button(this, GAME_W / 2 - 250, GAME_H - 250, 460, 130, 'ui_btn_secondary', `Ещё контракт (${more})`, () => this.scene.restart({ back: this.back }), FS.h3).container);
    sfx('rarity_up');
    sfx('job_change', { delay: 0.5 });
    if (juiceOn()) {
      this.tweens.add({ targets: rays, angle: 360, duration: 30000, repeat: -1 });
      burst(this, { x: GAME_W / 2, y: cy });
      const flash = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0xffffff, 1).setDepth(REVEAL_DEPTH + 10);
      this.tweens.add({ targets: flash, alpha: 0, duration: 420, onComplete: () => flash.destroy() });
    }
  }
}
