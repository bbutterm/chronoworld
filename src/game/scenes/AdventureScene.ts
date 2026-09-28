import Phaser from 'phaser';
import { finishedExpeditions, towerStatus } from '../../core';
import { GAME } from '../content';
import { expeditionsTile, towerTile } from '../featureTiles';
import { HINT_TEXT, hintDone } from '../hints';
import { huntTile } from '../huntEntry';
import { collect, staggerIn } from '../juice';
import { GAME_W, HEADER_H } from '../layout';
import { confirmOpen, screen } from '../screen';
import { now, restartOnNewDay, session } from '../session';
import { hintPointer } from '../ui';
import { motes, ribbon } from '../decor';
import { FS } from '../theme';
import { showUnlockBanners, UNLOCK_BANNER_NAME } from '../unlockBanner';

/**
 * Страница «Приключения» (вкладка нижней навигации, как «Тёмный лес» AFK Arena): режимы вне кампании крупными
 * «зданиями» (buildingTile) — Башня испытаний во всю ширину, под ней Экспедиции и Охота на босса. Закрытые — с замком
 * «Откроется на этапе …». Новые режимы (Лабиринт, Арена) встанут сюда же плитками, когда появятся.
 */
const L = {
  ribbonY: 238,
  towerY: 628,
  towerW: 1000,
  towerH: 640,
  rowY: 1298,
  tileW: 490,
  tileH: 640,
  tileXL: 286,
  tileXR: 794,
} as const;

export class AdventureScene extends Phaser.Scene {
  /** Сколько экспедиций вернулось при отрисовке плитки (раз в секунду сверяем — значок не отстаёт). */
  private expeditionsDone = 0;

  constructor() {
    super('Adventure');
  }

  create(): void {
    restartOnNewDay(this);
    screen(this, 'Приключения', 'Adventure');
    ribbon(this, GAME_W / 2, L.ribbonY, 'Окрестности', { size: FS.h2, minW: 460 });
    let tower: ReturnType<typeof towerTile> | null = null;
    const rows = [
      collect(this.children, () => {
        tower = towerTile(this, GAME_W / 2, L.towerY, L.towerW, L.towerH);
      }),
      collect(this.children, () => {
        expeditionsTile(this, L.tileXL, L.rowY, L.tileW, L.tileH);
        huntTile(this, L.tileXR, L.rowY, L.tileW, L.tileH);
      }),
    ];
    this.expeditionsDone = finishedExpeditions(session.save, now());
    motes(this, { x: 40, y: HEADER_H + 40, w: GAME_W - 80, h: L.rowY + L.tileH / 2 - HEADER_H }, 6);
    // R: Башня только что открылась — указатель на медальон плитки, плашка над ним (у верхнего края плитки, под лентой).
    const t = tower as ReturnType<typeof towerTile> | null;
    if (t && towerStatus(session.save, GAME).unlocked && !hintDone('tower_open')) {
      hintPointer(this, GAME_W / 2, t.art.y, HINT_TEXT.tower_open, 'above', { w: 250, h: 250 });
    }
    staggerIn(this, 'Adventure', rows);
    // Экспедиция вернулась, пока игрок на странице, — обновить плитку и значок (не при открытом окне).
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        const modal = !!this.children.getByName(UNLOCK_BANNER_NAME) || confirmOpen(this);
        if (!modal && finishedExpeditions(session.save, now()) !== this.expeditionsDone) this.scene.restart();
      },
    });
    showUnlockBanners(this);
  }
}
