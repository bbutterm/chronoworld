import Phaser from 'phaser';
import {
  bondHeroes,
  bondOf,
  bondUnlocks,
  bondView,
  chooseOption,
  chosenOption,
  eveningStatus,
  findEvening,
  finishEvening,
  finishPersonalScene,
  heroTemplate,
  isChoice,
  lineVisible,
  storyHero,
  storyHeroesInSquad,
  type BondView,
  type ChoiceDef,
  type EveningDef,
  type StoryDef,
  type TavernDef,
  type TavernLine,
  type TavernStep,
} from '../../core';
import { applySceneSound, sfx } from '../audio';
import { lineChimes } from '../audioCore';
import { GAME } from '../content';
import { heroSprite } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { framedPortrait } from '../portraitFrame';
import { CONTENT_TOP, card, contentBottom, popIn, screen } from '../screen';
import { commit, session } from '../session';
import { SKIN } from '../skin';
import { speakerView } from '../storyView';
import { GLOW, SPARK, setTavernBackground, TAVERN_LIGHTS } from '../tavernArt';
import { screenBackground } from '../backdrops';
import { motion } from '../state';
import { button, ellipsize, panel, ScrollArea, text, toast } from '../ui';
import { C, FS, OUTLINE, TINT, TOUCH } from '../theme';
import { firstTip } from '../firstTips';

export const TAVERN_EVENING = 'TavernEvening';
/** Имя слоя плашки вечера (e2e и скриншоты). Не 'dialogue' — дымовые прогоны листают только сюжетные сцены. */
export const EVENING_LAYER = 'tavernDialogue';

interface Back {
  to: string;
  data?: object;
}

export type TavernEveningData =
  /** «Вечера»: близость, личные сцены и задания, список вечеров. */
  | { mode?: 'hub'; back?: Back; quest?: BondQuestDone }
  /** Вечер по id (новый или пересмотр). */
  | { mode: 'evening'; id: string; back?: Back }
  /** Личная сцена героя (id карточки). */
  | { mode: 'scene'; hero: string; back?: Back };

/** Итог личного задания, сыгранного в BattleScene (режим bond, BUG-188): окно итога поверх «Вечеров». */
export interface BondQuestDone {
  templateId: string;
  win: boolean;
  goal: boolean;
  firstTime: boolean;
  fallen: string[];
  duration: number;
}

/** Открыть вечер / «Вечера». Сцена регистрируется при первом показе (как «Глава пройдена») — main.ts не трогаем. */
export function startTavernEvening(from: Phaser.Scene, data: TavernEveningData): void {
  if (!from.scene.get(TAVERN_EVENING)) from.scene.add(TAVERN_EVENING, TavernEveningScene, false);
  from.scene.start(TAVERN_EVENING, data);
}

const tavern = (): TavernDef | undefined => GAME.story.tavern;
/** Спикеры вечеров в виде сюжета главы — для speakerView (имена hero1…hero5 из сохранения). */
const pseudoStory = (): StoryDef | undefined => {
  const t = tavern();
  return t ? { chapter: 'tavern', speakers: t.speakers, scenes: [] } : undefined;
};
const heroName = (templateId: string) => GAME.content.heroes[templateId]?.name ?? templateId;
/** Творительный падеж имени героя: «с Браном», «с Викой». */
const withName = (templateId: string) => {
  const n = heroName(templateId);
  return /[ая]$/.test(n) ? `${n.slice(0, -1)}${n.endsWith('я') ? 'ей' : 'ой'}` : /[йь]$/.test(n) ? `${n.slice(0, -1)}ем` : `${n}ом`;
};
const STAT_NAMES: Record<string, string> = { atk: 'к атаке (урон и лечение)', hp: 'к здоровью', def: 'к защите' };

/** Название в «ёлочках»; кавычки внутри — „лапки“ (BUG-195: «Сын „Заднего“», а не «Сын «Заднего»»). */
export const quoted = (s: string): string => `«${s.replace(/«/g, '„').replace(/»/g, '“')}»`;

/**
 * Подпись связки для карточки героя и «Вечеров»: «когда обе/оба» по роду пары, и сейчас ли она действует (BUG-195).
 */
export function linkText(v: BondView, save = session.save): string {
  const l = v.link;
  const female = (id: string) => GAME.content.heroes[id]?.gender === 'f';
  const both = female(v.templateId) && female(l.partner) ? 'обе' : 'оба';
  const inSquad = storyHeroesInSquad(save, GAME);
  const now = inSquad.includes(v.templateId) && inSquad.includes(l.partner) ? 'сейчас действует' : `${[v.templateId, l.partner].filter((h) => !inSquad.includes(h)).map(heroName).join(' и ')} не в отряде`;
  return `Связка ${quoted(l.name)}: +${l.pct}% ${STAT_NAMES[l.stat] ?? l.stat} — ${heroName(v.templateId)} и ${heroName(l.partner)}, когда ${both} в отряде · ${now}`;
}

/** «1 свиток», «3 свитка», «5 свитков». */
const scrollsText = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'свиток' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'свитка' : 'свитков'}`;

/** Номер главы вечера (order), для подписей. */
const chapterNo = (e: EveningDef) => GAME.content.chapters.find((c) => c.id === e.after)?.order ?? 0;

/** Панель реплик (как в сюжетных сценах: dialogue.ts). */
const PANEL_W = 1040;
const PANEL_H = 460;
/** Подсказка первого вечера: верх экрана (над заставкой и столом). */
const TIP_Y = 40;
const PANEL_Y = GAME_H - 30 - PANEL_H / 2;
const PORTRAIT = 250;
const BODY_FS = 42;
const TYPE_MS = 22;
const LINE_GUARD_MS = 250;

/**
 * Вечер в «Двух колоколах» (docs/design/tavern-evenings.md): тёплый зал таверны, за столом — те, кто говорит в этот
 * вечер; плашка реплик как в сюжете; касание — дописать / следующая реплика; «Пропустить» — вечер засчитан. Выбор — до
 * трёх кнопок над плашкой; итог — «Близость: Вика +2». Без данных вечера — «Вечера» (хаб близости и пересмотра).
 */
export class TavernEveningScene extends Phaser.Scene {
  private back: Back = { to: 'Chronicle' };

  constructor() {
    super(TAVERN_EVENING);
  }

  create(data: TavernEveningData = {}): void {
    this.back = data.back ?? { to: 'Chronicle', data: { tab: 'world' } };
    try {
      applySceneSound({ music: 'tavern', ambience: null });
    } catch {
      // Звук не должен ломать экран.
    }
    if (data.mode === 'evening') {
      const e = findEvening(data.id, GAME);
      if (e) return this.playEvening(e);
    } else if (data.mode === 'scene') {
      const v = bondView(session.save, data.hero, GAME);
      if (v) return this.playPersonal(v);
    }
    this.hub();
    // BUG-188: вернулись из боя задания — итог здесь же; данные сцены одноразовые (restart без данных их не повторит).
    const q = data.mode === undefined || data.mode === 'hub' ? data.quest : undefined;
    this.sys.settings.data = {};
    if (q) {
      const v = bondView(session.save, q.templateId, GAME);
      if (v) this.questResult(v, q.win, q.goal, q.firstTime, q.fallen, q.duration);
    }
  }

  // ---------- Зал ----------

  private hall(): void {
    const bg = this.add.image(GAME_W / 2, GAME_H / 2, 'skin_bg_forest');
    setTavernBackground(bg);
    this.ambience();
  }

  private ambience(): void {
    for (const l of TAVERN_LIGHTS) {
      const g = this.add.image(l.x, l.y, GLOW).setTint(l.color).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(l.r * 2, l.r * 2).setAlpha(0.22);
      if (!motion.reduced)
        this.tweens.add({ targets: g, alpha: { from: 0.16, to: 0.3 }, duration: Phaser.Math.Between(500, 900), yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Phaser.Math.Between(0, 400) });
    }
    if (motion.reduced) return;
    this.time.addEvent({
      delay: 320,
      loop: true,
      callback: () => {
        const s = this.add.image(540 + Phaser.Math.Between(-70, 70), 740, SPARK).setTint(0xffb050).setBlendMode(Phaser.BlendModes.ADD).setScale(Phaser.Math.FloatBetween(0.3, 0.6));
        this.tweens.add({ targets: s, y: s.y - Phaser.Math.Between(160, 300), x: s.x + Phaser.Math.Between(-40, 40), alpha: 0, duration: Phaser.Math.Between(1200, 2000), onComplete: () => s.destroy() });
      },
    });
  }

  // ---------- Вечер и личная сцена ----------

  private playEvening(e: EveningDef): void {
    const before = this.bondsNow();
    const replay = eveningStatus(session.save, e, GAME) === 'seen';
    this.hall();
    this.play(e.steps, { kicker: `Вечер в «Двух колоколах» · глава ${chapterNo(e)}`, title: e.title, subtitle: e.subtitle }, (gains) => {
      const r = finishEvening(session.save, e.id, GAME);
      commit(r.save);
      for (const [h, d] of Object.entries(r.gains)) gains[h] = (gains[h] ?? 0) + d;
      this.summary(replay ? 'Вечер пересмотрен' : 'Вечер окончен', gains, before, r.gains);
    });
  }

  private playPersonal(v: BondView): void {
    const before = this.bondsNow();
    this.hall();
    this.play(v.scene.steps, { kicker: `Личная сцена · ${heroName(v.templateId)}`, title: v.scene.title }, (gains) => {
      commit(finishPersonalScene(session.save, v.scene.id));
      this.summary('Сцена окончена', gains, before);
    });
  }

  private bondsNow(): Record<string, number> {
    return Object.fromEntries(bondHeroes(GAME).map((h) => [h, bondOf(session.save, h)]));
  }

  /**
   * Проиграть шаги: заставка с названием, затем реплики (с учётом when) и выбор. onEnd(gains) — дослушали или
   * «Пропустить» (выбор тогда не сделан — его можно сделать при пересмотре).
   */
  private play(steps: readonly TavernStep[], head: { kicker: string; title: string; subtitle?: string }, onEnd: (gains: Record<string, number>) => void): void {
    const story = pseudoStory();
    const gains: Record<string, number> = {};
    // Кто сидит за столом: все говорящие вечера по порядку появления.
    const cast: string[] = [];
    for (const s of steps) for (const l of isChoice(s) ? s.choice.options.flatMap((o) => o.reply) : [s]) if (!cast.includes(l.speaker)) cast.push(l.speaker);
    const table = this.table(cast);

    const layer = this.add.container(0, 0).setDepth(100).setName(EVENING_LAYER);
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.001).setInteractive();
    const top = PANEL_Y - PANEL_H / 2;
    const left = GAME_W / 2 - PANEL_W / 2;
    const box = panel(this, GAME_W / 2, PANEL_Y, PANEL_W, PANEL_H, 'ui_panel');
    const px = left + 40 + PORTRAIT / 2;
    const py = top - 20;
    const face = this.add.container(px, py);
    const nameText = text(this, px + PORTRAIT / 2 + 40, top + 48, '', FS.h1, SKIN.goldLight, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5);
    const trim = this.add.image(px + PORTRAIT / 2 + 40, top + 92, 'skin_trim').setOrigin(0, 0.5).setDisplaySize(PANEL_W - PORTRAIT - 150, 10);
    const body = text(this, left + 50, top + 140, '', BODY_FS, SKIN.cream, { wordWrap: { width: PANEL_W - 100, useAdvancedWrap: true }, lineSpacing: 12, align: 'left' }).setOrigin(0, 0);
    const more = text(this, GAME_W / 2 + PANEL_W / 2 - 40, PANEL_Y + PANEL_H / 2 - 36, '', FS.caption, SKIN.creamDim, OUTLINE).setOrigin(1, 0.5);
    // BUG-194: «Пропустить» — в правом верхнем углу: над плашкой он касался третьего ответа выбора (360×640).
    const skip = button(this, GAME_W - 170, 130, 280, TOUCH, 'k:buttonLong_beige', 'Пропустить', () => end(), FS.h3);
    skip.container.setName('eveningSkip');
    const choiceLayer = this.add.container(0, 0);
    layer.add([shade, box, face, nameText, trim, body, more, skip.container, choiceLayer]);

    // Заставка: название вечера поверх зала; касание или 1.8 с — к репликам.
    const intro = this.add.container(0, 0).setDepth(120);
    const introShade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0604, 0.55).setInteractive();
    const k = text(this, GAME_W / 2, 330, head.kicker, FS.body, SKIN.gold, { ...OUTLINE, wordWrap: { width: 960 } });
    const t = text(this, GAME_W / 2, 430, head.title, FS.hero + 16, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10, wordWrap: { width: 980 } });
    const sub = head.subtitle ? text(this, GAME_W / 2, 540, head.subtitle, FS.h3, SKIN.cream, { fontStyle: 'italic', ...OUTLINE, wordWrap: { width: 960 } }) : null;
    intro.add([introShade, k, t, ...(sub ? [sub] : [])]);
    intro.setAlpha(0);
    this.tweens.add({ targets: intro, alpha: 1, duration: 350 });
    layer.setVisible(false);
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      this.tweens.add({ targets: intro, alpha: 0, duration: 250, onComplete: () => intro.destroy() });
      layer.setVisible(true);
      next();
    };
    introShade.on('pointerup', start);
    this.time.delayedCall(1800, start);
    // Первый вечер: Бруно — зачем слушать и что даёт выбор (firstTips.ts, один раз). Над столом, не на плашке реплик.
    if (head.kicker.startsWith('Вечер')) firstTip(this, 'tip_evening', TIP_Y, 130);

    // Очередь: шаги по порядку; ответы на выбор встают перед следующим шагом.
    let stepIdx = 0;
    const queue: TavernLine[] = [];
    let full = '';
    let shown = 0;
    let typer: Phaser.Time.TimerEvent | null = null;
    let lineAt = performance.now();
    let armed = false;
    let closed = false;
    let choosing = false;
    let faceOf: string | null | undefined;
    let count = 0;
    // BUG-194: в счётчик входят и ответы на выбор: сделанный выбор добавляет свои реплики (раньше — «13/13» на ходу).
    let total = steps.reduce((n, s) => {
      if (!isChoice(s)) return n + (lineVisible(s, session.save) ? 1 : 0);
      const got = chosenOption(session.save, s.choice.id);
      return n + (s.choice.options.find((o) => o.id === got)?.reply.length ?? 0);
    }, 0);

    /** Имя и кромка: с портретом — правее рамки, без него (выбор) — от левого края плашки. */
    const placeName = (withFace: boolean) => {
      const x = withFace ? px + PORTRAIT / 2 + 40 : left + 50;
      nameText.setX(x);
      trim.setX(x).setDisplaySize(withFace ? PANEL_W - PORTRAIT - 150 : PANEL_W - 100, 10);
    };
    const end = () => {
      if (closed) return;
      closed = true;
      typer?.remove();
      layer.destroy();
      intro.destroy();
      onEnd(gains);
    };
    const finishLine = () => {
      typer?.remove();
      typer = null;
      shown = full.length;
      body.setText(full);
      more.setText(`${count}/${Math.max(total, count)}  · коснитесь ›`);
    };
    const showLine = (l: TavernLine) => {
      lineAt = performance.now();
      count++;
      const who = speakerView(story, l.speaker, session.save, GAME);
      nameText.setText(who.name);
      placeName(true);
      const faceId = who.sprite && who.gender ? `${who.sprite}|${who.gender}` : who.sprite;
      if (faceId !== faceOf) {
        faceOf = faceId;
        face.removeAll(true);
        const fp = framedPortrait(this, 0, 0, who.sprite, PORTRAIT + 30, who.gender);
        face.add(fp);
        fp.setScale(0.92);
        this.tweens.add({ targets: fp, scale: 1, duration: 160, ease: 'Back.easeOut' });
      }
      table.focus(l.speaker);
      full = l.text;
      if (lineChimes(full)) sfx('bell_chime', { delay: 0.2 });
      shown = 0;
      body.setText('');
      more.setText('');
      typer?.remove();
      const t0 = this.time.now;
      typer = this.time.addEvent({
        delay: TYPE_MS,
        loop: true,
        callback: () => {
          shown = Math.max(shown + 1, Math.floor((this.time.now - t0) / TYPE_MS));
          body.setText(full.slice(0, shown));
          if (shown >= full.length) finishLine();
        },
      });
    };
    const next = () => {
      if (closed) return;
      const q = queue.shift();
      if (q) return showLine(q);
      while (stepIdx < steps.length) {
        const s = steps[stepIdx++];
        if (isChoice(s)) {
          const got = chosenOption(session.save, s.choice.id);
          const opt = got ? s.choice.options.find((o) => o.id === got) : undefined;
          if (opt) {
            // Пересмотр: выбор уже сделан — сразу ответ на него.
            queue.push(...opt.reply);
            return next();
          }
          return ask(s.choice);
        }
        if (lineVisible(s, session.save)) return showLine(s);
      }
      end();
    };
    const ask = (c: ChoiceDef) => {
      choosing = true;
      nameText.setText('Ваш ответ');
      face.removeAll(true);
      faceOf = undefined;
      placeName(false);
      full = c.prompt;
      shown = full.length;
      body.setText(full);
      more.setText('выберите ответ');
      const OPT_H = 128;
      const GAP = 18;
      c.options.forEach((o, i) => {
        const y = top - 170 - (c.options.length - 1 - i) * (OPT_H + GAP);
        const bg = panel(this, GAME_W / 2, y, 980, OPT_H, 'k:buttonLong_beige').setInteractive({ useHandCursor: true });
        const label = text(this, GAME_W / 2, y - 4, o.text, FS.body, C.ink, { fontStyle: 'bold', wordWrap: { width: 900, useAdvancedWrap: true }, align: 'center' });
        bg.setName(`eveningOption_${o.id}`);
        choiceLayer.add([bg, label]);
        bg.setAlpha(0);
        label.setAlpha(0);
        this.tweens.add({ targets: [bg, label], alpha: 1, duration: 200, delay: 80 * i });
        bg.on('pointerup', () => {
          if (!choosing) return;
          choosing = false;
          sfx('ui_tap');
          const r = chooseOption(session.save, c.id, o.id, GAME);
          commit(r.save);
          for (const [h, d] of Object.entries(r.gains)) {
            gains[h] = (gains[h] ?? 0) + d;
            toast(this, `${heroName(h)}: близость +${d}`, C.success, 2200);
          }
          choiceLayer.removeAll(true);
          total += o.reply.length;
          queue.push(...o.reply);
          next();
        });
      });
    };
    shade.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const ts = (p.event as Event | undefined)?.timeStamp;
      armed = (typeof ts === 'number' && ts > 0 ? ts : performance.now()) - lineAt >= LINE_GUARD_MS;
    });
    shade.on('pointerup', () => {
      if (!armed || choosing || closed) return;
      armed = false;
      if (shown < full.length) finishLine();
      else next();
    });
  }

  /** Стол: портреты всех, кто говорит в этот вечер; говорящий крупнее и светлее. */
  private table(cast: string[]): { focus: (key: string) => void } {
    const story = pseudoStory();
    const n = cast.length;
    const size = n > 6 ? 130 : 150;
    const step = Math.min(size + 14, 1000 / Math.max(1, n - 1));
    const y = 740;
    this.add.image(GAME_W / 2, y + 40, GLOW).setTint(0xffa050).setAlpha(0.28).setDisplaySize(1300, 700).setBlendMode(Phaser.BlendModes.ADD);
    const faces = new Map<string, Phaser.GameObjects.Container>();
    cast.forEach((key, i) => {
      const who = speakerView(story, key, session.save, GAME);
      const x = GAME_W / 2 + (i - (n - 1) / 2) * step;
      // Лёгкая дуга: крайние чуть выше — сидят вокруг стола.
      const dy = -Math.abs(i - (n - 1) / 2) * 14;
      const fp = framedPortrait(this, x, y + dy, who.sprite, size, who.gender).setAlpha(0.55);
      faces.set(key, fp);
    });
    return {
      focus: (key) => {
        for (const [k, fp] of faces) {
          const on = k === key;
          this.tweens.add({ targets: fp, alpha: on ? 1 : 0.55, scale: on ? 1.18 : 1, duration: 180 });
          if (on) fp.setDepth(2);
          else fp.setDepth(1);
        }
      },
    };
  }

  /** Итог: кому и насколько выросла близость, что открылось; «Дальше» — туда, откуда пришли. */
  private summary(title: string, gains: Record<string, number>, before: Record<string, number>, squad: Record<string, number> = {}): void {
    const layer = this.add.container(0, 0).setDepth(200).setName('eveningSummary');
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.6).setInteractive();
    const rows: { s: string; color: string }[] = [];
    for (const [h, d] of Object.entries(gains)) {
      const v = bondView(session.save, h, GAME);
      // BUG-194: откуда близость — ответ в вечере и/или «прошли главу вместе в отряде».
      const fromSquad = squad[h] ?? 0;
      const why = [d - fromSquad > 0 ? `ответ +${d - fromSquad}` : '', fromSquad > 0 ? `в отряде +${fromSquad}` : ''].filter(Boolean).join(', ');
      rows.push({ s: `${heroName(h)}: близость +${d}${why ? ` (${why})` : ''} · ${v?.points ?? '?'} из ${v?.max ?? '?'}`, color: C.success });
      for (const u of bondUnlocks(before[h] ?? 0, v?.points ?? 0, GAME)) {
        if (!v) continue;
        rows.push({ s: u === 'scene' ? `Открыта личная сцена ${quoted(v.scene.title)}` : `Открыто личное задание ${quoted(v.quest.title)}`, color: C.title });
      }
    }
    if (!rows.length) rows.push({ s: 'Близость не изменилась — но вечер запомнится', color: C.muted });
    const h = 330 + rows.length * 70;
    const y0 = GAME_H / 2 - h / 2;
    const box = panel(this, GAME_W / 2, GAME_H / 2, 940, h, 'ui_panel');
    const head = text(this, GAME_W / 2, y0 + 80, title, FS.h1, C.title, { fontStyle: 'bold', ...OUTLINE });
    layer.add([shade, box, head]);
    rows.forEach((r, i) => layer.add(ellipsize(text(this, GAME_W / 2, y0 + 170 + i * 70, r.s, FS.body, r.color, { fontStyle: 'bold', ...OUTLINE }), 860)));
    const bw = this.back.to === TAVERN_EVENING ? 560 : 400;
    const go = button(this, this.back.to === TAVERN_EVENING ? GAME_W / 2 : GAME_W / 2 + 220, y0 + h - 90, bw, 110, 'ui_btn_primary', 'Дальше', () => this.leave(), FS.h3);
    go.container.setName('eveningDone');
    layer.add(go.container);
    if (this.back.to !== TAVERN_EVENING) {
      const hub = button(this, GAME_W / 2 - 220, y0 + h - 90, 400, 110, 'ui_btn_secondary', 'Близость', () => this.scene.restart({ mode: 'hub', back: this.back } satisfies TavernEveningData), FS.h3);
      layer.add(hub.container);
    }
    if (Object.keys(gains).length) sfx('quest_done');
    popIn(this, layer, shade);
  }

  private leave(): void {
    if (this.back.to === TAVERN_EVENING) this.scene.restart(this.back.data ?? { mode: 'hub' });
    else this.scene.start(this.back.to, this.back.data);
  }

  // ---------- «Вечера» ----------

  private hub(): void {
    screen(this, 'Вечера в таверне', 'Home', this.back);
    const bg = screenBackground(this);
    if (bg) setTavernBackground(bg);
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0604, 0.35);
    const t = tavern();
    const area = new ScrollArea(this, CONTENT_TOP + 20, contentBottom());
    if (!t) {
      area.add(text(this, GAME_W / 2, 200, 'Вечеров пока нет.', FS.body, C.muted));
      return;
    }
    const self: Back = { to: TAVERN_EVENING, data: { mode: 'hub', back: this.back } satisfies TavernEveningData };
    let y = 10;
    const headline = (s: string, sub?: string) => {
      area.add(text(this, 60, y + 30, s, FS.h2, C.title, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5));
      y += 70;
      if (sub) {
        const st = area.add(text(this, 60, y, sub, FS.small, C.muted, { ...OUTLINE, wordWrap: { width: 960 }, align: 'left' }).setOrigin(0, 0));
        y += st.height + 20;
      }
    };
    headline('Близость', `Растёт от ответов в вечерах и на ${t.bond.squadGain} за главу, пройденную вместе в отряде. На ${t.bond.sceneAt} — личная сцена, на ${t.bond.questAt} — личное задание, после задания — связка в бою.`);
    for (const h of bondHeroes(GAME)) {
      const v = bondView(session.save, h, GAME);
      if (v) y = this.bondCard(area, v, y, self) + 20;
    }
    y += 10;
    headline('Вечера', 'После каждой главы отряд собирается в «Двух колоколах». Пропущенный выбор можно сделать при пересмотре.');
    for (const e of t.evenings) y = this.eveningRow(area, e, y, self) + 14;
    area.setContentHeight(y + 30);
  }

  private bondCard(area: ScrollArea, v: BondView, top: number, self: Back): number {
    const hero = storyHero(session.save, v.templateId);
    const objs: Phaser.GameObjects.GameObject[] = [];
    const L = 250;
    // BUG-194: герой, которого отряд ещё не встретил, — «???» (без имени, сцены и связки: не спойлерить кампанию).
    const met = (id: string) => !!storyHero(session.save, id);
    const name = text(this, L, top + 50, hero ? heroName(v.templateId) : '???', FS.h2, hero ? C.title : C.disabled, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5);
    const pts = text(this, 1010, top + 50, `${v.points} / ${v.max}`, FS.h3, C.gold, { fontStyle: 'bold', ...OUTLINE }).setOrigin(1, 0.5);
    objs.push(name, pts);
    // Шкала: точки близости; пороги сцены и задания — золотая кромка.
    const t = tavern()!;
    for (let i = 0; i < v.max; i++) {
      const x = L + 22 + i * 74;
      const on = i < v.points;
      const c = this.add.circle(x, top + 120, 22, on ? 0xe0443a : 0x2a2018, 1).setStrokeStyle(i + 1 === t.bond.sceneAt || i + 1 === t.bond.questAt ? 5 : 3, i + 1 === t.bond.sceneAt || i + 1 === t.bond.questAt ? TINT.gold : 0x6a5438);
      objs.push(c);
    }
    let y = top + 170;
    const line = (s: string, color: string) => {
      const tx = text(this, 60, y, s, FS.small, color, { ...OUTLINE, wordWrap: { width: 950 }, align: 'left', lineSpacing: 4 }).setOrigin(0, 0);
      objs.push(tx);
      y += tx.height + 10;
    };
    if (!hero) line('Этого героя отряд ещё не встретил — он присоединится по ходу кампании.', C.dim);
    line(v.scene.open ? `Личная сцена ${quoted(v.scene.title)}${v.scene.seen ? ' — прочитана' : ' — открыта!'}` : `Личная сцена — на близости ${v.scene.at}`, v.scene.open ? C.text : C.dim);
    line(
      v.quest.done ? `Задание ${quoted(v.quest.title)} выполнено` : v.quest.open ? `Задание ${quoted(v.quest.title)}: ${v.quest.goal}` : `Личное задание — на близости ${v.quest.at}`,
      v.quest.done ? C.success : v.quest.open ? C.text : C.dim,
    );
    line(
      v.link.open ? linkText(v) : met(v.link.partner) && hero ? `Связка с ${withName(v.link.partner)} откроется после задания` : 'Связка в бою откроется после задания',
      v.link.open ? C.success : C.dim,
    );
    const BTN = 100;
    y += 10;
    const by = y + BTN / 2;
    y += BTN + 20;
    const h = y - top;
    const bg = area.add(card(this, GAME_W / 2, top + h / 2, 1040, h));
    if (!hero) bg.setAlpha(0.7);
    area.add(framedPortrait(this, 130, top + 85, hero ? heroSprite(hero, GAME) : null, 150));
    for (const o of objs) area.add(o);
    const sceneBtn = button(this, 290, by, 440, BTN - 6, v.scene.open ? (v.scene.seen ? 'ui_btn_secondary' : 'ui_btn_primary') : 'k:buttonLong_grey', v.scene.seen ? 'Сцена ↺' : 'Сцена', area.tap(() => {
      if (!v.scene.open) return toast(this, `Личная сцена откроется на близости ${v.scene.at}`);
      this.scene.restart({ mode: 'scene', hero: v.templateId, back: self } satisfies TavernEveningData);
    }), FS.h3);
    sceneBtn.container.setName(`bondScene_${v.templateId}`).setAlpha(v.scene.open ? 1 : 0.5);
    area.add(sceneBtn.container);
    const questBtn = button(this, 790, by, 440, BTN - 6, v.quest.open ? (v.quest.done ? 'ui_btn_secondary' : 'ui_btn_primary') : 'k:buttonLong_grey', v.quest.done ? 'Задание ✓' : 'Задание', area.tap(() => {
      if (!v.quest.open) return toast(this, `Личное задание откроется на близости ${v.quest.at}`);
      this.questModal(area, v);
    }), FS.h3);
    questBtn.container.setName(`bondQuest_${v.templateId}`).setAlpha(v.quest.open ? 1 : 0.5);
    area.add(questBtn.container);
    return top + h;
  }

  private eveningRow(area: ScrollArea, e: EveningDef, top: number, self: Back): number {
    const st = eveningStatus(session.save, e, GAME);
    const h = 140;
    const bg = area.add(card(this, GAME_W / 2, top + h / 2, 1040, h));
    if (st === 'locked') bg.setAlpha(0.6);
    // BUG-194: закрытый вечер — без подзаголовка («После капитана Дрейка» — спойлер босса).
    area.add(text(this, 60, top + 42, `Глава ${chapterNo(e)}${e.subtitle && st !== 'locked' ? ` · ${e.subtitle}` : ''}`, FS.small, C.muted, OUTLINE).setOrigin(0, 0.5));
    area.add(ellipsize(text(this, 60, top + 94, st === 'locked' ? '???' : e.title, FS.h3, st === 'locked' ? C.disabled : C.title, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0.5), 620));
    if (st === 'locked') {
      area.add(text(this, 1010, top + h / 2, `после главы ${chapterNo(e)}`, FS.small, C.dim, OUTLINE).setOrigin(1, 0.5));
      return top + h;
    }
    const b = button(this, 860, top + h / 2, 280, 96, st === 'new' ? 'ui_btn_primary' : 'k:buttonLong_beige', st === 'new' ? 'Слушать' : 'Ещё раз', area.tap(() => {
      this.scene.restart({ mode: 'evening', id: e.id, back: self } satisfies TavernEveningData);
    }), FS.h3);
    b.container.setName(`evening_${e.id}`);
    area.add(b.container);
    if (st === 'new') area.add(this.add.circle(1000, top + 22, 14, TINT.badge).setStrokeStyle(4, 0xffffff));
    return top + h;
  }

  /** Личное задание: условие, награда, «В бой» — бой считает ядро, итог — здесь же. */
  private questModal(area: ScrollArea, v: BondView): void {
    area.locked = true;
    const layer = this.add.container(0, 0).setDepth(300);
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.7).setInteractive();
    const q = v.quest;
    const W = 960;
    layer.add(shade);
    const body = this.add.container(0, 0);
    const close = () => {
      area.locked = false;
      layer.destroy();
    };
    shade.on('pointerup', close);
    let y = 70;
    const add = (s: string, size: number, color: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}, gap = 20) => {
      const t = text(this, GAME_W / 2, y, s, size, color, { wordWrap: { width: W - 120 }, lineSpacing: 6, ...OUTLINE, ...style }).setOrigin(0.5, 0);
      body.add(t);
      y += t.height + gap;
      return t;
    };
    add(`Задание · ${heroName(v.templateId)}`, FS.small, C.muted);
    add(q.title, FS.h1, C.title, { fontStyle: 'bold' });
    add(q.text, FS.body, C.text);
    add(`Цель: ${q.goal}`, FS.h3, C.gold, { fontStyle: 'bold' });
    const r = q.reward;
    const reward = [r.gold ? `${r.gold} золота` : '', r.gems ? `${r.gems} гемов` : '', r.scrolls ? scrollsText(r.scrolls) : ''].filter(Boolean).join(', ');
    add(q.done ? 'Награда уже получена. Можно сыграть ещё раз.' : `Награда: ${reward} и связка ${quoted(v.link.name)}`, FS.small, q.done ? C.muted : C.success);
    add(`${heroName(v.templateId)} должен быть в отряде. Враги — с этапа кампании, сильнее обычного.`.replace('должен', GAME.content.heroes[v.templateId]?.gender === 'f' ? 'должна' : 'должен'), FS.small, C.muted);
    const H = y + 190;
    const top = GAME_H / 2 - H / 2;
    body.setY(top);
    layer.add([panel(this, GAME_W / 2, GAME_H / 2, W, H, 'ui_panel'), body]);
    // BUG-188: «В бой» — настоящий бой в BattleScene (режим bond: тот же расчёт ядра fightBondQuest, ульта вручную),
    // итог — окном здесь же после боя. Условия проверяются сразу, без расчёта боя (касание отвечает мгновенно).
    const go = button(this, GAME_W / 2 + 200, top + H - 100, 360, 120, 'ui_btn_primary', 'В бой', () => {
      const why = !q.open
        ? `Задание откроется на близости ${q.at}`
        : !q.stageCleared
          ? 'Сначала пройдите этот этап кампании'
          : !storyHeroesInSquad(session.save, GAME).includes(v.templateId)
            ? 'Герой задания должен быть в отряде'
            : null;
      if (why) {
        toast(this, why, C.error);
        return;
      }
      close();
      this.scene.start('Battle', { mode: 'bond', templateId: v.templateId, back: this.back });
    }, FS.h2);
    go.container.setName('bondQuestGo');
    const cancel = button(this, GAME_W / 2 - 200, top + H - 100, 320, 120, 'k:buttonLong_beige', 'Назад', close, FS.h3);
    layer.add([go.container, cancel.container]);
    popIn(this, layer, shade);
  }

  private questResult(v: BondView, win: boolean, goal: boolean, firstTime: boolean, fallen: string[], duration: number): void {
    const layer = this.add.container(0, 0).setDepth(300);
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.7).setInteractive();
    const W = 960;
    layer.add(shade);
    const body = this.add.container(0, 0);
    let y = 80;
    const add = (s: string, size: number, color: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}) => {
      const t = text(this, GAME_W / 2, y, s, size, color, { wordWrap: { width: W - 120 }, lineSpacing: 6, ...OUTLINE, ...style }).setOrigin(0.5, 0);
      body.add(t);
      y += t.height + 24;
    };
    const names = fallen.map((id) => {
      const h = session.save.heroes.find((x) => x.id === id);
      return h ? heroTemplate(GAME, h.templateId).name : id;
    });
    add(goal ? 'Задание выполнено!' : win ? 'Победа, но цель не достигнута' : 'Поражение', FS.hero, goal ? C.success : win ? C.gold : C.danger, { fontStyle: 'bold' });
    add(`Бой длился ${Math.round(duration)} с${names.length ? ` · пали: ${names.join(', ')}` : ' · все устояли'}`, FS.small, C.muted);
    if (goal && firstTime) add(`Награда получена. Открыта связка ${quoted(v.link.name)}.`, FS.body, C.success);
    if (goal && v.quest.after) {
      const who = speakerView(pseudoStory(), v.quest.after.speaker, session.save, GAME);
      add(`${who.name}: «${v.quest.after.text}»`, FS.body, C.title, { fontStyle: 'italic' });
    }
    if (!goal) add('Усильте отряд или поменяйте расстановку — и попробуйте снова.', FS.small, C.text);
    sfx(goal ? 'victory' : 'defeat');
    const H = y + 190;
    const top = GAME_H / 2 - H / 2;
    body.setY(top);
    layer.add([panel(this, GAME_W / 2, GAME_H / 2, W, H, 'ui_panel'), body]);
    const ok = button(this, GAME_W / 2, top + H - 100, 400, 120, 'ui_btn_primary', 'Дальше', () => this.scene.restart({ mode: 'hub', back: this.back } satisfies TavernEveningData), FS.h2);
    ok.container.setName('bondQuestDone');
    layer.add(ok.container);
    popIn(this, layer, shade);
  }
}
