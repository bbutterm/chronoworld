import Phaser from 'phaser';
import { finishedExpeditions, pendingExpeditionEvents, towerStatus } from '../../core';
import { GAME } from '../content';
import { expeditionsTile, towerTile, type ModeBanner } from '../featureTiles';
import { autobattlerTile } from '../autobattlerEntry';
import { hintDone } from '../hints';
import { huntTile } from '../huntEntry';
import { collect, staggerIn } from '../juice';
import { GAME_W } from '../layout';
import { confirmOpen, CONTENT_TOP, contentBottom, screen } from '../screen';
import { now, restartOnNewDay, session } from '../session';
import { ScrollArea, tutorialHint } from '../ui';
import { onViewChange } from '../viewport';
import { S } from '../theme';
import { showUnlockBanners, UNLOCK_BANNER_NAME } from '../unlockBanner';

/**
 * Страница «Приключения» (вкладка нижней навигации, как «Тёмный лес» AFK Arena): режимы вне кампании — широкие
 * арт-баннеры (modeBanner) в порядке открытия: Экспедиции, Башня испытаний, Охота на MVP. На баннере — название и
 * один чип состояния, точка — только у события; закрытые — темнее, с замком и «Откроется на этапе …».
 * Новые режимы (Лабиринт, Арена) встанут сюда же баннерами, когда появятся.
 */
const BANNER_W = GAME_W - 2 * S.l;
/** Высота баннера не больше этой (на вытянутых экранах лишнее уходит в отступы). */
const BANNER_MAX_H = 520;
/** Даже на коротком телефоне картина и две строки состояния сохраняют отдельное место. */
const BANNER_MIN_H = 360;

type Tile = (scene: Phaser.Scene, x: number, y: number, w: number, h: number) => ModeBanner;

export class AdventureScene extends Phaser.Scene {
  /** Сколько экспедиций вернулось при отрисовке баннера (раз в секунду сверяем — чип и точка не отстают). */
  private expeditionsDone = 0;
  private expeditionDecisions = 0;

  constructor() {
    super('Adventure');
  }

  create(data: { scroll?: number } = {}): void {
    restartOnNewDay(this);
    screen(this, 'Приключения', 'Adventure');
    const tiles: Tile[] = [expeditionsTile, towerTile, huntTile, autobattlerTile];
    const top = CONTENT_TOP + S.xs;
    const avail = contentBottom() - S.xs - top;
    const h = Math.max(BANNER_MIN_H, Math.min(BANNER_MAX_H, Math.floor((avail - S.s * (tiles.length - 1)) / tiles.length)));
    const gap = tiles.length > 1 ? Math.max(S.s, Math.min(S.l, (avail - h * tiles.length) / (tiles.length - 1))) : 0;
    const area = new ScrollArea(this, top, contentBottom() + 10);
    area.content.setName('adventureScroll');
    const y0 = Math.max(0, (avail - h * tiles.length - gap * (tiles.length - 1)) / 2) + h / 2;
    const made: ModeBanner[] = [];
    const rows = tiles.map((tile, i) => {
      const row = collect(this.children, () => {
        made.push(tile(this, GAME_W / 2, y0 + i * (h + gap), BANNER_W, h));
      });
      area.content.add(row);
      return row;
    });
    area.setContentHeight(y0 - h / 2 + h * tiles.length + gap * (tiles.length - 1) + S.xs);
    if (data.scroll) area.offset = data.scroll;
    onViewChange(this, () => area.setBounds(top, contentBottom() + 10));
    this.expeditionsDone = finishedExpeditions(session.save, now());
    this.expeditionDecisions = pendingExpeditionEvents(session.save, now());
    // R: Башня только что открылась — указатель на фигуру баннера.
    const tower = made[tiles.indexOf(towerTile)];
    if (tower && towerStatus(session.save, GAME).unlocked && !hintDone('tower_open')) {
      tutorialHint(this, 'tower_open', tower.focusX, top + tower.focusY, 'above', { w: 240, h: 240 });
    }
    staggerIn(this, 'Adventure', rows);
    // Отряд вернулся или наступил выбор события — обновить состояние (не при открытом окне).
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        const modal = !!this.children.getByName(UNLOCK_BANNER_NAME) || confirmOpen(this);
        if (!modal && (finishedExpeditions(session.save, now()) !== this.expeditionsDone
          || pendingExpeditionEvents(session.save, now()) !== this.expeditionDecisions)) this.scene.restart({ scroll: area.offset });
      },
    });
    showUnlockBanners(this);
  }
}
