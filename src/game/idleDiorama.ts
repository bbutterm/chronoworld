import Phaser from 'phaser';
import { enemySquad, idleIncome, lastClearedStage, offlineFullInMs, offlineLoot, offlineRewards } from '../core';
import { animatedEffect, animatedFxKey, skillFx } from './animatedFx';
import { holdAnimatedFx, hasArt } from './assets';
import { ensureAmbientTextures, SHADOW_TEX } from './ambient';
import { setThemeBackground, themeOfChapter } from './backdrops';
import { CONTENT, GAME } from './content';
import { currentStage, formatNumber } from './flow';
import { roIcon } from './itemIcons';
import { rewardIcon } from './rewardsView';
import { unitTint } from './screen';
import { now, session } from './session';
import { skinIcon } from './skin';
import { anim, spriteView, SPRITES, whenSprites, type SpriteView } from './sprites';
import { V2_SCALE, resolveAnim, type AnimName } from '../pipeline/sprites';
import { motion } from './state';
import { COLOR, COLOR_N, OUTLINE, R, S, T as TYPE } from './theme';
import { plate, pressable, text } from './ui';
import { squadDefs } from './scenes/BattleScene';
import {
  animTimeScale,
  chestFlight,
  DIORAMA_H,
  DIORAMA_SCALE,
  DIORAMA_W,
  ENEMY_SPAWN_DX,
  enemyPoint,
  enemyPool,
  heroPoint,
  planWave,
  squadLineup,
  T,
  ultHeroFor,
  waveUnits,
  type ChestSnapshot,
  type LineupHero,
  type WaveEvent,
} from './idleDioramaPlan';

/**
 * «Отряд в походе» — живая полоса-диорама на странице «Город» (как idle-бой на главной AFK Arena): текущий отряд игрока
 * (его листы, формы и ветки — как в бою, squadDefs) слева бьётся с волнами монстров этапа, который игрок проходит
 * сейчас (фон — поле боя темы его главы). Монстр падает — монетки (и, если в сундуке правда прибавился предмет, —
 * предмет) летят к сундуку в углу, счётчик сундука — настоящий (offlineRewards ядра). Касание — страница «Кампания»
 * с сундуком и «Собрать».
 *
 * Это украшение: ядро боя не зовём, сценарий волны — idleDioramaPlan.ts. Дёшево: ≤ 5 героев + ≤ 3 монстров, без частиц,
 * анимации листов не быстрее 10 кадров/с, один таймер сцены на 10 Гц (часы сцены: игра свёрнута — цикл спит, lifecycle.ts),
 * объекты — в своём контейнере, уходят со сценой. Листы и эффекты грузятся лениво и тихо (без «Загрузка…»).
 * «Уменьшить анимацию» — статичная поза. Звука нет.
 */

/**
 * Окно в фон поля боя: фон (720×1280 → 1080×1920) увеличен в ZOOM раз (фигуры в полосе крупнее, чем в бою на
 * том же месте фона), BAND_Y — верх окна в единицах фона 1080×1920: сверху небо/стены, снизу земля под ногами.
 */
const BAND_Y = 70;
const ZOOM = 1.25;
/** Шаг таймера диорамы, мс (10 Гц). */
const TICK_MS = 100;
/** Сундук в правом верхнем углу (центр, локально). */
const CHEST = { x: DIORAMA_W - 96, y: 92, size: 116 };
/** Высота мягкого затемнения сверху и снизу полосы (переход в шапку и в страницу). */
const FADE = { top: 120, bottom: 150 };
/** Самая высокая фигура в полосе (ед.): крупные монстры уменьшаются до неё. */
const MAX_FIG = 250;
/** Текстура вертикального градиента «прозрачно → чёрный» (затемнения краёв полосы). */
const FADE_TEX = 'diorama_fade';

type Fig = Phaser.GameObjects.Sprite;

interface Unit {
  spr: Fig;
  shadow: Phaser.GameObjects.Image;
  id: string;
  view: SpriteView;
  tint: number;
  /** Номер последнего действия: отложенный возврат в стойку не перебивает новое. */
  token: number;
  dead?: boolean;
}

interface Timed {
  at: number;
  run: () => void;
}

/** Ключ анимации и её скорость (кадры не чаще 10 в секунду). */
function animOf(u: Unit, name: AnimName): { key: string | null; scale: number; ms: number } {
  const key = anim(u.view, u.id, name);
  const real = resolveAnim(u.view.def, name);
  const a = real ? u.view.def?.anims[real] : undefined;
  const frameMs = a?.ms[0] ?? 100;
  const scale = animTimeScale(frameMs);
  return { key, scale, ms: a ? (a.ms.reduce((s, v) => s + v, 0) / scale) : 0 };
}

/** Вертикальный градиент «прозрачно → чёрный» 4×128 (один на игру). */
function fadeTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(FADE_TEX)) return;
  const ct = scene.textures.createCanvas(FADE_TEX, 4, 128);
  if (!ct) return;
  const c = ct.getContext();
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = g;
  c.fillRect(0, 0, 4, 128);
  ct.refresh();
}

export interface IdleDioramaOpts {
  /** Касание полосы. */
  onTap: () => void;
}

/**
 * Поставить диораму: левый верхний угол (x, y), размер DIORAMA_W × DIORAMA_H. Возвращает контейнер (его порядок
 * отрисовки фиксирован сразу — догружаемые листы встают внутрь него, а не поверх кнопок экрана).
 */
export function idleDiorama(scene: Phaser.Scene, x: number, y: number, opts: IdleDioramaOpts): Phaser.GameObjects.Container {
  return new IdleDiorama(scene, x, y, opts).layer;
}

class IdleDiorama {
  readonly layer: Phaser.GameObjects.Container;
  private units: Phaser.GameObjects.Container;
  private fly: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Image;
  private heroes: Unit[] = [];
  private enemies: Unit[] = [];
  private lineup: LineupHero[] = [];
  private pool: string[] = [];
  private enemyAtk = 20;
  private wave = 0;
  private clock = 0;
  private waveEnd = 0;
  private timeline: Timed[] = [];
  private kills = 0;
  private frozen = false;
  private chestImg?: Phaser.GameObjects.Image;
  private pill?: Phaser.GameObjects.NineSlice;
  private counter?: Phaser.GameObjects.Text;
  private coin?: Phaser.GameObjects.GameObject;
  private rate?: Phaser.GameObjects.Text;
  private chest: ChestSnapshot | null = null;
  private fxIds: { hit?: string; ult: Record<string, { at: 'target' | 'hero'; id: string } | undefined> } = { ult: {} };

  constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
    opts: IdleDioramaOpts,
  ) {
    const W = DIORAMA_W;
    const H = DIORAMA_H;
    this.layer = scene.add.container(x, y).setName('idleDiorama');
    // Фон — полоса поля боя темы текущей главы (тот же фон, что в бою; файл владельца подгружается сам).
    const cur = currentStage(session.save, GAME);
    this.bg = scene.add.image(0, 0, '__DEFAULT');
    setThemeBackground(this.bg, 'battle', themeOfChapter(cur?.chapter));
    this.layer.add(this.bg);
    this.fitBand();
    this.units = scene.add.container(0, 0);
    this.fly = scene.add.container(0, 0);
    // Края полосы мягко уходят в шапку и в страницу — «окно в мир», без рамки; фигуры — поверх затемнения.
    fadeTexture(scene);
    const top = scene.add.image(W / 2, 0, FADE_TEX).setOrigin(0.5, 0).setFlipY(true).setDisplaySize(W + 2, FADE.top).setAlpha(0.75);
    const bottom = scene.add.image(W / 2, H, FADE_TEX).setOrigin(0.5, 1).setDisplaySize(W + 2, FADE.bottom).setAlpha(0.7);
    // Нижняя кромка «окна»: бронзовая линия и мягкая тень на страницу под ней.
    const edge = scene.add.rectangle(W / 2, H - 1.5, W + 2, 3, COLOR_N.border);
    const shadow = scene.add.image(W / 2, H, FADE_TEX).setOrigin(0.5, 0).setFlipY(true).setDisplaySize(W + 2, 48).setAlpha(0.6);
    this.layer.add([top, bottom, this.units, edge, shadow]);

    // Сундук (числа ядра): справа сверху, слева от него — накопленное золото, под ним — доход в час (тихо).
    if (hasArt('ui_chest_empty')) this.chestImg = scene.add.image(CHEST.x, CHEST.y, 'ui_chest_empty').setDisplaySize(CHEST.size, CHEST.size);
    else this.chestImg = scene.add.image(CHEST.x, CHEST.y, skinIcon('chest')).setDisplaySize(CHEST.size * 0.8, CHEST.size * 0.8).setTint(0xffd27a);
    // Подложка под золото и доход: тёмная «таблетка», с доходом — в две строки (читается на светлом небе).
    this.pill = plate(scene, 0, CHEST.y - 14 - 30, 200, 60, { fill: COLOR.surfaceSunken, alpha: 0.8, border: COLOR.border, borderW: 2, r: R.l }).setOrigin(1, 0);
    this.coin = rewardIcon(scene, 0, CHEST.y - 14, 'gold', 40);
    this.counter = text(scene, CHEST.x - CHEST.size / 2 - S.s, CHEST.y - 14, '', TYPE.body, COLOR.gold, { fontStyle: 'bold' }).setOrigin(1, 0.5);
    this.rate = text(scene, CHEST.x - CHEST.size / 2 - S.s, CHEST.y + 30, '', TYPE.caption, COLOR.textSecondary).setOrigin(1, 0.5);
    this.layer.add([this.pill, this.chestImg, this.coin, this.counter, this.rate, this.fly]);

    // Касание — к сундуку (страница «Кампания»).
    const zone = scene.add.zone(W / 2, H / 2, W, H);
    this.layer.add(zone);
    pressable(scene, zone, W, H, opts.onTap);
    this.layer.bringToTop(this.fly);

    this.chest = this.readChest();
    this.updateLabels();

    // Кто в походе: отряд (листы карточек героев — как в бою) и враги текущего этапа (лёгкие листы).
    const defs = squadDefs(session.save);
    this.lineup = squadLineup(session.save.squad, defs);
    if (cur) {
      this.pool = enemyPool(
        CONTENT.stages,
        cur.id,
        (u) => CONTENT.units[u]?.visual.sprite,
        (sp) => SPRITES[sp]?.cell[1],
      );
      const atk = enemySquad(cur.id, GAME).reduce((m, d) => Math.max(m, d?.stats.atk ?? 0), 0);
      if (atk > 0) this.enemyAtk = atk;
    }
    ensureAmbientTextures(scene);
    // Эффекты: обычный удар и ульты героев отряда (атласы RO), грузятся лениво; не успели — удар без вспышки.
    const fx: string[] = [];
    if (animatedEffect('fx_hit')) {
      this.fxIds.hit = 'fx_hit';
      fx.push('fx_hit');
    }
    for (const h of this.lineup) {
      const roles = skillFx(h.ult);
      const target = roles?.ground ?? roles?.hit ?? roles?.debuff;
      const self = roles?.cast ?? roles?.buff;
      const pick = target ? { at: 'target' as const, id: target } : self ? { at: 'hero' as const, id: self } : undefined;
      if (pick && animatedEffect(pick.id)) {
        this.fxIds.ult[h.heroId] = pick;
        fx.push(pick.id);
      }
    }
    if (!motion.reduced && fx.length) void holdAnimatedFx(scene, fx);

    const sheets = [...this.lineup.map((h) => h.sprite), ...this.pool.map((u) => CONTENT.units[u].visual.sprite)];
    whenSprites(scene, sheets, () => this.start(), { quiet: true });

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // Сцена-синглтон живёт всю игру: не держать уничтоженные объекты (npm run perf — «dead»).
      this.heroes = [];
      this.enemies = [];
      this.timeline = [];
      this.chestImg = this.counter = this.rate = this.coin = this.pill = undefined;
    });
  }

  /** Окно фона: поле боя (720×1280 → 1080×1920), увеличенное в ZOOM раз и обрезанное до полосы под диорамой. */
  private fitBand(): void {
    const bg = this.bg;
    const fw = bg.frame.realWidth || 1;
    const fh = bg.frame.realHeight || 1;
    const dw = 1080 * ZOOM;
    const k = fw / dw;
    const ox = (dw - DIORAMA_W) / 2;
    const oy = BAND_Y * ZOOM;
    bg.setDisplaySize(dw, dw * (fh / fw));
    bg.setOrigin(0, 0).setPosition(-ox, -oy);
    bg.setCrop(ox * k, oy * k, DIORAMA_W * k, DIORAMA_H * k);
  }

  private readChest(): ChestSnapshot | null {
    const save = session.save;
    if (!lastClearedStage(save, GAME)) return null;
    const t = now();
    return { gold: offlineRewards(save, t, GAME).gold, items: offlineLoot(save, t, GAME).items };
  }

  private updateLabels(): void {
    const save = session.save;
    const last = lastClearedStage(save, GAME);
    // Доход в час — тихая подпись под золотом; сундук полон — она же предупреждает. Сундук ещё не копит — пусто.
    if (this.rate) {
      const full = last ? offlineFullInMs(save, now(), GAME) : null;
      if (!last) this.rate.setText('');
      else if (full !== null && full <= 0) this.rate.setText('Сундук полон').setColor(COLOR.warning);
      else this.rate.setText(`+${formatNumber(idleIncome(last, 60, GAME).gold)}/ч`).setColor(COLOR.textSecondary);
    }
    const c = this.chest;
    this.counter?.setText(c ? formatNumber(c.gold) : '').setVisible(!!c);
    const coin = this.coin as (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Visible) | undefined;
    if (coin && this.counter) coin.setVisible(!!c).setX(this.counter.x - this.counter.width - 30);
    if (this.pill && this.counter) {
      const right = this.counter.x + S.s + 10;
      const two = !!this.rate?.text;
      const w = Math.max(this.counter.width + 40 + 30, two && this.rate ? this.rate.width : 0) + S.s + S.xs;
      this.pill.setVisible(!!c).setSize(w, two ? 108 : 60).setX(right);
    }
    if (this.chestImg && hasArt('ui_chest_empty') && c) {
      const capMin = GAME.progression.offline.capHours * 60;
      const minutes = offlineRewards(save, now(), GAME).minutes;
      const state = c.gold <= 0 ? 'empty' : minutes >= capMin * 0.9 ? 'full' : 'filling';
      this.chestImg.setTexture(`ui_chest_${state}`).setDisplaySize(CHEST.size, CHEST.size);
    }
  }

  // ---------- юниты ----------

  private addUnit(spriteId: string, x: number, y: number, enemy: boolean, tint: number, k = 1): Unit {
    const scene = this.scene;
    const view = spriteView(scene, spriteId);
    const flip = enemy && view.art;
    // Крупный монстр (visual.scale) — не выше MAX_FIG, и вся фигура (с тем, что ниже точки ног) — внутри полосы.
    const fig = view.height * (DIORAMA_SCALE / V2_SCALE) * k;
    if (fig > MAX_FIG) k *= MAX_FIG / fig;
    const px = (DIORAMA_SCALE / V2_SCALE) * k * (view.size / ((view.def?.cell[1] ?? view.size) || 1));
    const box = view.def?.boxes?.idle;
    const below = box && view.def ? Math.max(0, box[3] - view.def.anchor[1]) * px : 0;
    y = Math.min(y, DIORAMA_H - 8 - below);
    const spr = scene.add.sprite(x, y, view.key, 0).setOrigin(flip ? 1 - view.originX : view.originX, view.originY).setFlipX(flip).setTint(tint);
    spr.setScale((view.size * (DIORAMA_SCALE / V2_SCALE) * k) / spr.frame.realHeight);
    const footW = view.def?.width ? view.def.width * DIORAMA_SCALE * k : 60;
    const shW = Phaser.Math.Clamp(footW * 1.1, 56, 170);
    const shadow = scene.add.image(x, y - 3, SHADOW_TEX).setDisplaySize(shW, Math.min(26, shW * 0.3)).setAlpha(0.8);
    this.units.add([shadow, spr]);
    const u: Unit = { spr, shadow, id: spriteId, view, tint, token: 0 };
    return u;
  }

  /** Сортировка по точке ног: кто ниже — тот ближе (тени — под всеми). */
  private sortUnits(): void {
    this.units.sort('y', (a: Phaser.GameObjects.Components.Transform & { texture?: { key: string } }, b: Phaser.GameObjects.Components.Transform & { texture?: { key: string } }) => {
      const sa = a.texture?.key === SHADOW_TEX ? 0 : 1;
      const sb = b.texture?.key === SHADOW_TEX ? 0 : 1;
      return sa !== sb ? sa - sb : a.y - b.y;
    });
  }

  /** Проиграть анимацию; не зациклена — потом стойка (если юнита не перебили новым действием). */
  private act(u: Unit, name: AnimName, loop = false): number {
    if (this.frozen || u.dead || !u.spr.scene) return 0;
    const a = animOf(u, name);
    if (!a.key) return 0;
    const token = ++u.token;
    u.spr.play({ key: a.key, repeat: loop ? -1 : 0 });
    u.spr.anims.timeScale = a.scale;
    if (!loop && name !== 'death') {
      this.scene.time.delayedCall(a.ms, () => {
        if (u.token === token && !u.dead && u.spr.scene) this.idle(u);
      });
    }
    return a.ms;
  }

  private idle(u: Unit): void {
    const a = animOf(u, 'idle');
    if (!a.key || this.frozen) return;
    u.token++;
    u.spr.play({ key: a.key, repeat: -1 });
    u.spr.anims.timeScale = a.scale;
  }

  // ---------- цикл ----------

  private start(): void {
    if (!this.layer.scene) return;
    this.heroes = this.lineup.map((h) => {
      const p = heroPoint(h.slot);
      return this.addUnit(h.sprite, p.x, p.y, false, 0xffffff);
    });
    // Статичная поза («Уменьшить анимацию»): отряд и первая волна стоят, ничего не летает.
    this.spawnWave(motion.reduced);
    this.sortUnits();
    if (motion.reduced) {
      this.frozen = true;
      return;
    }
    for (const u of this.heroes) this.idle(u);
    this.beginWave();
    this.scene.time.addEvent({ delay: TICK_MS, loop: true, callback: () => this.tick() });
  }

  private tick(): void {
    // «Уменьшить анимацию» включили прямо сейчас (настройки) — замереть; выключили — продолжить.
    if (motion.reduced !== this.frozen) this.setFrozen(motion.reduced);
    if (this.frozen) return;
    this.clock += TICK_MS;
    while (this.timeline.length && this.timeline[0].at <= this.clock) this.timeline.shift()?.run();
    if (this.clock >= this.waveEnd) {
      this.wave++;
      this.spawnWave(false);
      this.sortUnits();
      this.beginWave();
    }
  }

  private setFrozen(on: boolean): void {
    this.frozen = on;
    for (const u of [...this.heroes, ...this.enemies]) {
      if (!u.spr.scene) continue;
      if (on) u.spr.anims.pause();
      else u.spr.anims.resume();
    }
  }

  /** Монстры новой волны выходят справа (в статичной позе — сразу на местах). */
  private spawnWave(still: boolean): void {
    for (const e of this.enemies) this.removeUnit(e);
    const units = waveUnits(this.pool, this.wave);
    this.enemies = units.map((uid, i) => {
      const def = CONTENT.units[uid];
      const p = enemyPoint(i);
      const u = this.addUnit(def.visual.sprite, still ? p.x : p.x + ENEMY_SPAWN_DX, p.y, true, unitTint(def.visual), def.visual.scale ?? 1);
      if (!still) {
        // Проявляется у правого края и подходит на своё место (за рамку полосы не выходит — маски нет).
        this.act(u, 'walk', true);
        u.spr.setAlpha(0);
        u.shadow.setAlpha(0);
        this.scene.tweens.add({ targets: [u.spr, u.shadow], alpha: 1, duration: 350 });
        this.scene.tweens.add({ targets: [u.spr, u.shadow], x: p.x, duration: T.walkIn - 250 + i * 60, ease: 'Sine.easeOut', onComplete: () => this.idle(u) });
      }
      return u;
    });
  }

  private removeUnit(u: Unit): void {
    u.dead = true;
    if (u.spr.scene) u.spr.destroy();
    if (u.shadow.scene) u.shadow.destroy();
  }

  /** Сценарий волны → лента событий на часах диорамы. Герои «идут» на месте, пока монстры выходят. */
  private beginWave(): void {
    const ult = ultHeroFor(this.wave, this.lineup);
    const plan = planWave({ heroes: this.lineup, enemies: this.enemies.length, wave: this.wave, ult, enemyAtk: this.enemyAtk });
    const base = this.clock;
    // Фон мог смениться (догрузился файл владельца) — полоса по его размеру.
    this.fitBand();
    this.waveEnd = base + plan.end;
    this.timeline = [];
    if (this.enemies.length && this.heroes.length) {
      for (const h of this.heroes) this.act(h, 'walk', true);
      this.timeline.push({ at: base + T.walkIn - 100, run: () => this.heroes.forEach((h) => this.idle(h)) });
    }
    for (const ev of plan.events) this.schedule(base, ev);
    this.timeline.sort((a, b) => a.at - b.at);
  }

  private schedule(base: number, ev: WaveEvent): void {
    const at = base + ev.at;
    if (ev.type === 'attack') {
      this.timeline.push({ at, run: () => this.attack(this.heroes[ev.hero], this.lineup[ev.hero]?.slot ?? 2) });
      this.timeline.push({ at: at + T.hit, run: () => this.hit(this.enemies[ev.target], ev.dmg, ev.kill, false) });
    } else if (ev.type === 'ult') {
      this.timeline.push({ at, run: () => this.ult(ev.hero) });
      this.timeline.push({ at: at + T.hit, run: () => ev.targets.forEach((i) => this.hit(this.enemies[i], ev.dmg, true, true, ev.hero)) });
    } else {
      this.timeline.push({ at, run: () => this.act(this.enemies[ev.enemy], 'attack') });
      this.timeline.push({
        at: at + T.hit,
        run: () => {
          const h = this.heroes[ev.hero];
          if (!h || this.enemies[ev.enemy]?.dead) return;
          this.act(h, 'hurt');
          this.number(h.spr.x, h.spr.y - this.figH(h) - 6, ev.dmg, COLOR.negative, TYPE.caption);
        },
      });
    }
  }

  /** Удар героя; фронт (слоты 0–1) коротко шагает вперёд и обратно. */
  private attack(h: Unit | undefined, slot: number): void {
    if (!h || this.frozen) return;
    this.act(h, 'attack');
    if (slot > 1) return;
    const x = heroPoint(slot).x;
    this.scene.tweens.add({ targets: [h.spr, h.shadow], x: x + 46, duration: 140, yoyo: true, hold: 120, ease: 'Quad.easeOut', onComplete: () => h.spr.scene && (h.spr.setX(x), h.shadow.setX(x)) });
  }

  /** Высота фигуры на экране (макушка над ногами): высота в бою × во сколько раз диорама мельче. */
  private figH(u: Unit): number {
    return (u.view.height * u.spr.scaleX * u.spr.frame.realHeight) / Math.max(1, u.view.size);
  }

  /** Ульта: каст, название навыка над героем и её эффект RO (на цели или на герое) — коротко, без затемнения. */
  private ult(i: number): void {
    const h = this.heroes[i];
    const info = this.lineup[i];
    if (!h || !info) return;
    this.act(h, 'cast');
    const name = info.ult ? CONTENT.skills[info.ult]?.name : undefined;
    if (name) {
      const t = text(this.scene, h.spr.x + 30, h.spr.y - this.figH(h) - 24, name, TYPE.caption, COLOR.gold, { fontStyle: 'bold', ...OUTLINE });
      this.fly.add(t);
      this.scene.tweens.add({ targets: t, y: t.y - 30, alpha: { from: 1, to: 0 }, delay: 500, duration: 700, onComplete: () => t.destroy() });
    }
    const fx = this.fxIds.ult[info.heroId];
    if (fx?.at === 'hero') this.atlas(fx.id, h.spr.x, h.spr.y, h.spr.x, 0.75);
    else {
      // Лёгкая золотая аура у героя — и без атласа видно, что это ульта.
      const g = this.scene.add.image(h.spr.x, h.spr.y - this.figH(h) / 2, 'skin_glow').setTint(0xffd27a).setAlpha(0.7).setDisplaySize(150, 150);
      this.units.add(g);
      this.scene.tweens.add({ targets: g, alpha: 0, scale: g.scale * 1.4, duration: 600, onComplete: () => g.destroy() });
    }
  }

  /** Попадание по монстру: вспышка, цифра урона, «больно» или падение (монетки к сундуку). */
  private hit(e: Unit | undefined, dmg: number, kill: boolean, ult: boolean, hero?: number): void {
    if (!e || e.dead || !e.spr.scene) return;
    const top = e.spr.y - this.figH(e);
    const fx = hero !== undefined ? this.fxIds.ult[this.lineup[hero]?.heroId ?? ''] : undefined;
    // Эффекты мельче, чем в бою: полоса узкая, а маски нет (дорого) — крупный атлас вылез бы за рамку.
    if (ult && fx?.at === 'target') this.atlas(fx.id, e.spr.x, e.spr.y, this.heroes[hero ?? 0]?.spr.x, 0.75);
    else if (this.fxIds.hit) this.atlas(this.fxIds.hit, e.spr.x, e.spr.y - this.figH(e) * 0.45, undefined, 0.5);
    e.spr.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => {
      if (e.spr.scene) e.spr.setTint(e.tint);
    });
    this.number(e.spr.x, top - 4, dmg, ult ? COLOR.gold : COLOR.textPrimary, ult ? TYPE.body : TYPE.caption);
    if (!kill) {
      this.act(e, 'hurt');
      return;
    }
    this.act(e, 'death');
    e.dead = true;
    const death = animOf(e, 'death').ms || 400;
    this.scene.tweens.add({ targets: [e.spr, e.shadow], alpha: 0, delay: Math.min(death, T.death - 250), duration: 250 });
    this.loot(e.spr.x, e.spr.y - this.figH(e) / 2);
  }

  /** Маленькая цифра урона: всплывает и гаснет. */
  private number(x: number, y: number, n: number, color: string, size: number): void {
    const t = text(this.scene, x, y, formatNumber(n), size, color, { fontStyle: 'bold', ...OUTLINE });
    this.fly.add(t);
    this.scene.tweens.add({ targets: t, y: y - 44, alpha: { from: 1, to: 0 }, duration: 650, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }

  /** Кадры атласа эффекта RO (animatedFx) в точке ног (x, y); атлас не загружен — ничего. */
  private atlas(id: string, x: number, y: number, fromX?: number, k = 1): void {
    const eff = animatedEffect(id);
    const key = animatedFxKey(id);
    if (!eff || !this.scene.textures.exists(key)) return;
    const flip = !!eff.from && fromX !== undefined && fromX !== x && (eff.from === 'right') === (fromX < x);
    const ox = eff.anchor[0] / eff.cell[0];
    const img = this.scene.add.image(x, y, key, 0).setOrigin(flip ? 1 - ox : ox, eff.anchor[1] / eff.cell[1]).setFlipX(flip);
    img.setScale((eff.scale ?? V2_SCALE) * (DIORAMA_SCALE / V2_SCALE) * k).setAlpha(eff.alpha ?? 1);
    img.setBlendMode(eff.blend === 'add' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    img.setVisible(eff.delayMs === 0);
    this.fly.add(img);
    // Кадры не чаще 10 в секунду не трогаем у эффектов: они короткие (≈ 0.5 с), медленнее выглядят «пластилином».
    let frame = 0;
    this.scene.time.addEvent({
      delay: Math.max(40, eff.ms),
      startAt: 0,
      repeat: eff.frames,
      callback: () => {
        if (!img.scene) return;
        frame++;
        if (frame >= eff.frames) img.destroy();
        else img.setVisible(true).setFrame(frame);
      },
    });
  }

  /** Монстр упал: монетки (и опыт, и предмет — если в сундуке правда прибавился) летят к сундуку; счётчик — из ядра. */
  private loot(x: number, y: number): void {
    const next = this.readChest();
    const f = chestFlight(this.chest, next, this.kills++);
    this.chest = next;
    const parts: { make: () => Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform; delay: number }[] = [];
    for (let i = 0; i < f.coins; i++) parts.push({ make: () => rewardIcon(this.scene, 0, 0, 'gold', 30) as never, delay: i * 90 });
    if (f.exp) parts.push({ make: () => rewardIcon(this.scene, 0, 0, 'exp', 30) as never, delay: 140 });
    if (f.item) {
      const key = roIcon(this.scene, f.item);
      parts.push({
        make: () => (key ? this.scene.add.image(0, 0, key).setScale(2) : this.scene.add.image(0, 0, skinIcon('bag')).setDisplaySize(40, 40).setTint(0xffd27a)),
        delay: 220,
      });
    }
    let landed = 0;
    for (const p of parts) {
      const o = p.make();
      o.setPosition(x + Phaser.Math.Between(-16, 16), y);
      this.fly.add(o);
      this.scene.tweens.add({
        targets: o,
        x: CHEST.x,
        y: CHEST.y,
        delay: 180 + p.delay,
        duration: 620,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          o.destroy();
          if (++landed === parts.length) this.chestBump();
        },
      });
    }
    if (!parts.length) this.updateLabels();
  }

  private chestBump(): void {
    this.updateLabels();
    const img = this.chestImg;
    if (!img?.scene) return;
    const s = img.scale;
    this.scene.tweens.add({ targets: img, scale: s * 1.12, yoyo: true, duration: 110, onComplete: () => img.scene && img.setScale(s) });
  }
}
