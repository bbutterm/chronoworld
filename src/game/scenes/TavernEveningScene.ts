import Phaser from 'phaser';
import {
  bondHeroes,
  bondUnlocks,
  bondView,
  chooseOption,
  chosenOption,
  eveningSquadHeroes,
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
import { bottomSheet, closeTopModal, CONTENT_TOP, contentBottom, popIn, registerModal, screen } from '../screen';
import { commit, session } from '../session';
import { SKIN } from '../skin';
import { speakerView } from '../storyView';
import { GLOW, SPARK, setTavernBackground, TAVERN_LIGHTS } from '../tavernArt';
import { screenBackground } from '../backdrops';
import { motion } from '../state';
import { BTN, button, infoButton, listRow, mixHex, plate, pressable, rewardRow, ScrollArea, SURFACE, tag, text, toast, type ChipSpec } from '../ui';
import { C, COLOR, COLOR_N, E, FAMILY, hexNum, M, R, S, T } from '../theme';
import { firstTip } from '../firstTips';
import { counterText, dialogueCounter, dialoguePanel, speakerName } from '../dialogue';
import { goldDot } from '../homeBuildings';
import { staggerIn } from '../juice';
import { minimumTouchSize, onViewChange, view, worldPoint } from '../viewport';
import { setTgBack } from '../telegram';
import { eveningChoiceBounds, eveningCreditPreview, eveningDialogueLayout, eveningModalLayout, eveningPreviewRowHeight, eveningSectionLayout } from '../compactEveningLayout';

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

/** Номер главы вечера (order), для подписей. */
const chapterNo = (e: EveningDef) => GAME.content.chapters.find((c) => c.id === e.after)?.order ?? 0;

/** Панель реплик (как в сюжетных сценах: dialogue.ts). */
const PANEL_W = 1040;
/** Подсказка первого вечера: верх экрана (над заставкой и столом). */
const TIP_Y = 40;
const PORTRAIT = 250;
const BODY_FS = 42;
const BODY_LEADING = Math.round(BODY_FS * 0.4);
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
      if (v?.scene.open) return this.playPersonal(v);
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
    const offBack = setTgBack(() => {
      if (!this.sys.isActive()) return;
      if (!closeTopModal(this)) this.leave();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offBack);
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
      if (r.save !== session.save) commit(r.save);
      for (const [h, d] of Object.entries(r.gains)) gains[h] = (gains[h] ?? 0) + d;
      this.summary(replay ? 'Вечер пересмотрен' : 'Вечер окончен', gains, before, r.gains);
    });
  }

  private playPersonal(v: BondView): void {
    const before = this.bondsNow();
    this.hall();
    this.play(v.scene.steps, { kicker: `Личная сцена · ${heroName(v.templateId)}`, title: v.scene.title }, (gains) => {
      const finished = finishPersonalScene(session.save, v.scene.id);
      if (finished !== session.save) commit(finished);
      this.summary('Сцена окончена', gains, before);
    });
  }

  private bondsNow(): Record<string, number> {
    return Object.fromEntries(bondHeroes(GAME).map((h) => [h, bondView(session.save, h, GAME)?.points ?? 0]));
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
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.001).setInteractive().setName('eveningAdvance');
    const initial = eveningDialogueLayout(view().safeBottom);
    const top = initial.top;
    const left = GAME_W / 2 - PANEL_W / 2;
    const box = dialoguePanel(this, initial.panelY);
    const px = left + 40 + PORTRAIT / 2;
    const py = top - 20;
    const face = this.add.container(px, py);
    const nameText = speakerName(this, px + PORTRAIT / 2 + 40, top + 52).setName('eveningSpeaker');
    const trim = this.add.image(px + PORTRAIT / 2 + 40, top + 96, 'skin_trim').setOrigin(0, 0.5).setDisplaySize(PANEL_W - PORTRAIT - 150, 8).setAlpha(0.7);
    const body = text(this, left + 50, 0, '', BODY_FS, SKIN.cream, { wordWrap: { width: PANEL_W - 100, useAdvancedWrap: true }, lineSpacing: BODY_LEADING, align: 'left' }).setOrigin(0, 0).setName('eveningBodyText');
    const bodyArea = new ScrollArea(this, initial.bodyTop, initial.bodyBottom);
    bodyArea.content.setName('eveningBody');
    bodyArea.add(body);
    const more = counterText(this, GAME_W / 2 + PANEL_W / 2 - S.l, initial.safeBottom - 30 - S.l).setName('eveningCounter');
    // BUG-194: «Пропустить» — в правом верхнем углу: над плашкой он касался третьего ответа выбора (360×640).
    const skip = button(this, GAME_W - S.l - 130, 130, 260, BTN.m, '', 'Пропустить', () => end(), T.body, { variant: 'secondary' });
    skip.container.setName('eveningSkip');
    const chrome = this.add.container(0, 0, [box, face, nameText, trim, more]);
    const firstChoice = eveningChoiceBounds(top, 0);
    const choiceArea = new ScrollArea(this, firstChoice.top, firstChoice.bottom);
    const choiceLayer = choiceArea.content.setName('eveningChoices');
    let choiceHeight = 0;
    layer.add([shade, chrome, ...bodyArea.parts, skip.container, ...choiceArea.parts]);
    const reflow = () => {
      const next = eveningDialogueLayout(view().safeBottom);
      chrome.y = next.safeBottom - initial.safeBottom;
      bodyArea.setBounds(next.bodyTop, next.bodyBottom);
      const choices = eveningChoiceBounds(next.top, choiceHeight);
      choiceArea.setBounds(choices.top, choices.bottom);
    };
    const offView = onViewChange(this, reflow);
    layer.once(Phaser.GameObjects.Events.DESTROY, offView);

    // Заставка: название вечера поверх зала; касание или 1.8 с — к репликам.
    const intro = this.add.container(0, 0).setDepth(120).setName('eveningIntro');
    const introShade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0604, 0.55).setInteractive().setName('eveningIntroStart');
    const k = text(this, GAME_W / 2, 330, head.kicker.toUpperCase(), T.caption, SKIN.goldLight, { fontStyle: 'bold', wordWrap: { width: 960 } });
    k.setLetterSpacing?.(4);
    const t = text(this, GAME_W / 2, 430, head.title, T.display, C.title, { fontFamily: FAMILY.heading, fontStyle: 'bold', wordWrap: { width: 980 } });
    t.setShadow(0, 4, 'rgba(0,0,0,0.85)', 10, false, true);
    const sub = head.subtitle ? text(this, GAME_W / 2, 530, head.subtitle, T.body, SKIN.cream, { fontStyle: 'italic', wordWrap: { width: 960 } }) : null;
    for (const o of [k, ...(sub ? [sub] : [])]) o.setShadow(0, 2, 'rgba(0,0,0,0.85)', 4, false, true);
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
    let pressFrom: { x: number; y: number } | null = null;
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
      trim.setX(x).setDisplaySize(withFace ? PANEL_W - PORTRAIT - 150 : PANEL_W - 100, 8);
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
      bodyArea.setContentHeight(body.height);
      more.setText(dialogueCounter(count - 1, Math.max(total, count)));
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
        this.tweens.add({ targets: fp, scale: 1, duration: M.fast, ease: E.pop });
      }
      table.focus(l.speaker);
      full = l.text;
      if (lineChimes(full)) sfx('bell_chime', { delay: 0.2 });
      shown = 0;
      body.setText('');
      bodyArea.offset = 0;
      bodyArea.setContentHeight(0);
      more.setText('');
      typer?.remove();
      const t0 = this.time.now;
      typer = this.time.addEvent({
        delay: TYPE_MS,
        loop: true,
        callback: () => {
          shown = Math.max(shown + 1, Math.floor((this.time.now - t0) / TYPE_MS));
          body.setText(full.slice(0, shown));
          bodyArea.setContentHeight(body.height);
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
      bodyArea.offset = 0;
      bodyArea.setContentHeight(body.height);
      more.setText('');
      const OPT_H = Math.max(128, minimumTouchSize());
      const GAP = S.xs;
      choiceHeight = 0;
      c.options.forEach((o, i) => {
        const label = text(this, GAME_W / 2 - 490 + S.l + S.m, 0, o.text, T.body, COLOR.textPrimary, { fontStyle: 'bold', wordWrap: { width: 980 - 2 * S.l - S.m, useAdvancedWrap: true }, align: 'left', lineSpacing: 6 }).setOrigin(0, 0.5);
        const height = Math.max(OPT_H, label.height + 2 * S.xs);
        const y = choiceHeight + height / 2;
        choiceHeight += height + GAP;
        label.setY(y);
        // Ответ — кнопка: поднятая плашка с золотистой кромкой, подпись по левому краю после маркера.
        const bg = plate(this, GAME_W / 2, y, 980, height, { ...SURFACE.raised, alpha: 0.97, border: mixHex(COLOR.border, COLOR.accent, 0.6), r: R.l });
        const mark = this.add.circle(GAME_W / 2 - 490 + S.l, y, 10, COLOR_N.accent);
        bg.setName(`eveningOption_${o.id}`);
        choiceLayer.add([bg, mark, label]);
        for (const obj of [bg, mark, label]) obj.setAlpha(0);
        this.tweens.add({ targets: [bg, mark, label], alpha: 1, duration: M.base, delay: 80 * i });
        pressable(this, bg, 980, height, choiceArea.tap(() => {
          if (!choosing) return;
          choosing = false;
          const r = chooseOption(session.save, c.id, o.id, GAME);
          commit(r.save);
          // Близость — маленький чип с сердцем над плашкой (а не тост на весь экран).
          Object.entries(r.gains).forEach(([h, d], gi) => {
            gains[h] = (gains[h] ?? 0) + d;
            this.heartPop(`${heroName(h)} +${d}`, eveningDialogueLayout(view().safeBottom).top - 60 - gi * 80);
          });
          choiceLayer.removeAll(true);
          choiceHeight = 0;
          choiceArea.setContentHeight(0);
          total += o.reply.length;
          queue.push(...o.reply);
          next();
        }));
      });
      choiceHeight = Math.max(0, choiceHeight - GAP);
      choiceArea.setContentHeight(choiceHeight);
      reflow();
    };
    const cancelPress = () => { armed = false; };
    this.input.on('ui-cancel-press', cancelPress);
    layer.once(Phaser.GameObjects.Events.DESTROY, () => this.input.off('ui-cancel-press', cancelPress));
    shade.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const ts = (p.event as Event | undefined)?.timeStamp;
      armed = (typeof ts === 'number' && ts > 0 ? ts : performance.now()) - lineAt >= LINE_GUARD_MS;
      pressFrom = worldPoint(this, p);
    });
    shade.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!armed || !p.isDown || !pressFrom) return;
      const moved = worldPoint(this, p);
      if (Math.hypot(moved.x - pressFrom.x, moved.y - pressFrom.y) > 14) armed = false;
    });
    shade.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!armed || choosing || closed) return;
      armed = false;
      const released = worldPoint(this, p);
      if (!pressFrom || Math.hypot(released.x - pressFrom.x, released.y - pressFrom.y) > 14) return;
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

  /** Близость выросла: чип «♥ Вика +1» всплывает над плашкой и тает (локальная анимация, без тоста). */
  private heartPop(label: string, y: number): void {
    const c = heartChip(this, GAME_W / 2, y, label).setDepth(140);
    sfx('quest_done');
    if (!motion.reduced) {
      c.setScale(0.6).setAlpha(0);
      this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: M.fast, ease: E.pop });
      this.tweens.add({ targets: c, y: y - 60, alpha: 0, delay: 1400, duration: M.slow, ease: E.in, onComplete: () => c.destroy() });
    } else this.time.delayedCall(1600, () => c.destroy());
  }

  /** Итог: кому и насколько выросла близость (портрет, сердце, «5 из 10»), что открылось; «Дальше» — туда, откуда пришли. */
  private summary(title: string, gains: Record<string, number>, before: Record<string, number>, squad: Record<string, number> = {}): void {
    const layer = this.add.container(0, 0).setDepth(200).setName('eveningSummary');
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.6).setInteractive();
    const W = 960;
    const RW = W - 2 * S.l;
    const ROW = view().adaptive ? 256 : 128;
    type Row = { hero?: string; title: string; sub: string; gain?: number; unlock?: boolean };
    const rows: Row[] = [];
    for (const [h, d] of Object.entries(gains)) {
      const v = bondView(session.save, h, GAME);
      // BUG-194: откуда близость — ответ в вечере и/или «прошли главу вместе в отряде».
      const fromSquad = squad[h] ?? 0;
      const why = [d - fromSquad > 0 ? `ответ +${d - fromSquad}` : '', fromSquad > 0 ? `за главу +${fromSquad}` : ''].filter(Boolean).join(' · ');
      const actual = Math.max(0, (v?.points ?? 0) - (before[h] ?? 0));
      const source = actual > 0 ? why : 'Близость достигла максимума';
      rows.push({ hero: h, title: heroName(h), sub: `${v?.points ?? '?'} из ${v?.max ?? '?'}${source ? ` · ${source}` : ''}`, gain: actual });
      for (const u of bondUnlocks(before[h] ?? 0, v?.points ?? 0, GAME)) {
        if (!v) continue;
        rows.push({ title: u === 'scene' ? 'Личная сцена' : 'Личное задание', sub: quoted(u === 'scene' ? v.scene.title : v.quest.title), unlock: true });
      }
    }
    const listH = rows.length ? rows.length * (ROW + S.xs) - S.xs : 60;
    const initial = eveningModalLayout(view().uiHeight, listH);
    const y0 = initial.top;
    const box = plate(this, GAME_W / 2, initial.centerY, W, initial.height, { ...SURFACE.raised, alpha: 0.99, r: R.xl });
    const head = text(this, GAME_W / 2, y0 + 80, title, T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setName('eveningSummaryTitle');
    layer.add([shade, box, head]);
    let completed = false;
    const done = (toHub = false) => {
      if (completed) return;
      completed = true;
      if (toHub) this.scene.restart({ mode: 'hub', back: this.back } satisfies TavernEveningData);
      else this.leave();
    };
    registerModal(layer, () => done());
    const btnY = initial.buttonY;
    const area = new ScrollArea(this, initial.bodyTop, initial.bodyBottom, { left: GAME_W / 2 - W / 2 + S.l, right: GAME_W / 2 + W / 2 - S.l });
    area.content.setName('eveningSummaryScroll');
    if (!rows.length) area.add(text(this, GAME_W / 2, 30, 'Близость не изменилась', T.body, COLOR.textSecondary));
    rows.forEach((r, i) => {
      const y = i * (ROW + S.xs) + ROW / 2;
      const hero = r.hero ? storyHero(session.save, r.hero) : undefined;
      const row = listRow(this, GAME_W / 2, y, RW, {
        icon: r.unlock ? 'star' : (sc, x, iy, size) => framedPortrait(sc, x, iy, hero ? heroSprite(hero, GAME) : null, size + 12),
        title: r.title,
        subtitle: r.sub,
        ...(r.gain ? { trailing: heartChip(this, 0, 0, `+${r.gain}`) } : r.unlock ? { trailing: tag(this, 0, 0, 'открыто', 'accent', { solid: true }) } : {}),
        h: ROW,
        subtitleFullWidth: view().adaptive,
      });
      area.add(row);
    });
    area.setContentHeight(listH);
    const toHub = this.back.to !== TAVERN_EVENING;
    const go = button(this, toHub ? GAME_W / 2 + 200 : GAME_W / 2, btnY, toHub ? 380 : 480, BTN.l, 'ui_btn_primary', 'Дальше', () => done(), T.heading);
    go.container.setName('eveningDone');
    layer.add(go.container);
    const hub = toHub ? button(this, GAME_W / 2 - 200, btnY, 380, BTN.l, '', 'Близость', () => done(true), T.body, { variant: 'secondary' }) : null;
    if (hub) layer.add(hub.container);
    if (Object.keys(gains).length) sfx('quest_done');
    popIn(this, layer, shade);
    layer.add(area.parts);
    const inner = layer.getByName('popInner') as Phaser.GameObjects.Container;
    const offView = onViewChange(this, () => {
      const next = eveningModalLayout(view().uiHeight, listH);
      inner.y = next.centerY;
      box.setSize(W, next.height).setY(0);
      head.y = next.top + 80 - next.centerY;
      go.container.y = next.buttonY - next.centerY;
      if (hub) hub.container.y = next.buttonY - next.centerY;
      area.setBounds(next.bodyTop, next.bodyBottom);
    });
    layer.once(Phaser.GameObjects.Events.DESTROY, offView);
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
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0604, 0.45);
    const t = tavern();
    const area = new ScrollArea(this, CONTENT_TOP + S.s, contentBottom());
    area.content.setName('eveningHubScroll');
    onViewChange(this, () => area.setBounds(CONTENT_TOP + S.s, contentBottom()));
    const lock = () => { area.locked = this.children.list.some((o) => !!o.getData?.('screenModal')); };
    this.events.on(Phaser.Scenes.Events.PRE_UPDATE, lock);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.PRE_UPDATE, lock));
    if (!t) {
      area.add(text(this, GAME_W / 2, 200, 'Вечеров пока нет', T.body, COLOR.textSecondary));
      return;
    }
    const self: Back = { to: TAVERN_EVENING, data: { mode: 'hub', back: this.back } satisfies TavernEveningData };
    let y = 0;
    const groups: Phaser.GameObjects.GameObject[][] = [];
    /** Заголовок секции (заголовочная гарнитура) и «i» — правила за ней, а не абзацем на экране. */
    const headline = (s: string, info: { title: string; text: string }) => {
      const section = eveningSectionLayout(y, minimumTouchSize());
      area.add(text(this, S.l + S.xxs, section.headingY, s, T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5));
      area.add(infoButton(this, GAME_W - S.l - 40, section.headingY, area.tap(() => this.infoSheet(area, info.title, info.text))).setName(`eveningInfo_${groups.length}`));
      y = section.nextTop;
    };
    // Вечера — первыми (там новое), затем близость героев.
    headline('Вечера', { title: 'Вечера в «Двух колоколах»', text: 'После каждой главы отряд собирается в таверне. Пропущенный выбор можно сделать при пересмотре.' });
    // Закрытые вечера — один следующий, остальные — строкой «Ещё N — после следующих глав». «Слушать» золотом — у первого нового.
    const firstLocked = t.evenings.findIndex((e) => eveningStatus(session.save, e, GAME) === 'locked');
    const firstNew = t.evenings.find((e) => eveningStatus(session.save, e, GAME) === 'new')?.id;
    const shown = firstLocked < 0 ? t.evenings : t.evenings.slice(0, firstLocked + 1);
    for (const e of shown) {
      const row = this.eveningRow(area, e, y, self, e.id === firstNew);
      groups.push([row]);
      y += row.height + S.xs;
    }
    const rest = t.evenings.length - shown.length;
    if (rest > 0) {
      area.add(text(this, GAME_W / 2, y + 30, `Ещё ${rest} — после следующих глав`, T.caption, COLOR.textTertiary, { fontStyle: 'bold' }));
      y += 60;
    }
    y += S.l - S.xs;
    headline('Близость', {
      title: 'Близость',
      text: `Растёт от ответов в вечерах и на ${t.bond.squadGain} за главу, пройденную вместе в отряде. На ${t.bond.sceneAt} — личная сцена, на ${t.bond.questAt} — личное задание, после задания — связка в бою.`,
    });
    for (const h of bondHeroes(GAME).filter(id => session.save.heroes.some(hero => hero.templateId === id))) {
      const v = bondView(session.save, h, GAME);
      if (!v) continue;
      const before = area.content.list.length;
      y = this.bondCard(area, v, y, self) + S.s;
      groups.push(area.content.list.slice(before));
    }
    area.setContentHeight(y + S.m);
    staggerIn(this, 'evenings', groups);
  }

  /** Правила раздела — лист снизу. */
  private infoSheet(area: ScrollArea, title: string, body: string): void {
    area.locked = true;
    bottomSheet(
      this,
      title,
      (box, width) => {
        const t = text(this, 0, 0, body, T.body, COLOR.textPrimary, { align: 'left', wordWrap: { width, useAdvancedWrap: true } }).setOrigin(0, 0);
        box.add(t);
        return t.height;
      },
      { onClose: () => (area.locked = false) },
    );
  }

  /** Карточка близости: портрет, имя, сердца (пороги сцены и задания — золотая кромка), что дальше, «Сцена» и «Задание». */
  private bondCard(area: ScrollArea, v: BondView, top: number, self: Back): number {
    const hero = storyHero(session.save, v.templateId);
    const t = tavern()!;
    // BUG-194: герой, которого отряд ещё не встретил, — «???» (без имени, сцены и связки: не спойлерить кампанию).
    const met = (id: string) => !!storyHero(session.save, id);
    const L = S.l + S.m + 150 + S.s;
    const right = GAME_W - S.l - S.m;
    const objs: Phaser.GameObjects.GameObject[] = [];
    objs.push(text(this, L, top + 56, hero ? heroName(v.templateId) : '???', T.heading, hero ? COLOR.title : COLOR.textTertiary, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5));
    objs.push(heartChip(this, right, top + 56, `${v.points}/${v.max}`, { align: 'right', dim: !hero }));
    // Сердца: заполненные — набранная близость; пороги сцены и задания — с золотой кромкой.
    const hs = Math.min(48, (right - L) / v.max - 4);
    const step = (right - L - hs) / Math.max(1, v.max - 1);
    const g = this.add.graphics();
    for (let i = 0; i < v.max; i++) {
      const gate = i + 1 === t.bond.sceneAt || i + 1 === t.bond.questAt;
      heartPath(g, L + hs / 2 + i * step, top + 124, hs, i < v.points ? COLOR_N.negative : COLOR_N.surfaceSunken, gate ? COLOR_N.accent : COLOR_N.border);
    }
    objs.push(g);
    // Что дальше — одна-две строки: связка (если открыта), иначе ближайшее открытие.
    const status = !hero
      ? { s: 'Отряд ещё не встретил этого героя', c: COLOR.textTertiary }
      : v.link.open
        ? { s: linkText(v), c: COLOR.positive }
        : !v.scene.open
          ? { s: `Личная сцена — на близости ${v.scene.at}`, c: COLOR.textSecondary }
          : !v.quest.open
            ? { s: `Личное задание — на близости ${v.quest.at}`, c: COLOR.textSecondary }
            : v.quest.done
              ? { s: `Задание ${quoted(v.quest.title)} выполнено`, c: COLOR.positive }
              : { s: met(v.link.partner) ? `${v.quest.goal} · связка с ${withName(v.link.partner)}` : v.quest.goal, c: COLOR.textPrimary };
    const tw = CW_ - 2 * S.m;
    const st = text(this, S.l + S.m, top + 190, `Вечера ${v.tavernPoints} · общий путь ${v.journeyPoints}\n${status.s}`, T.caption, status.c, { align: 'left', wordWrap: { width: tw, useAdvancedWrap: true }, lineSpacing: 6 }).setOrigin(0, 0);
    objs.push(st);
    let y = top + 190 + st.height + S.s;
    const by = y + BTN.m / 2;
    y += BTN.m + S.m;
    const h = y - top;
    area.add(plate(this, GAME_W / 2, top + h / 2, CW_, h, hero ? { ...SURFACE.raised, r: R.l } : { ...SURFACE.surface, r: R.l }));
    area.add(framedPortrait(this, S.l + S.m + 75, top + 95, hero ? heroSprite(hero, GAME) : null, 150).setAlpha(hero ? 1 : 0.5));
    for (const o of objs) area.add(o);
    const bw = (tw - S.xs) / 2;
    const bx = (i: number) => S.l + S.m + bw / 2 + i * (bw + S.xs);
    const sceneBtn = button(this, bx(0), by, bw, BTN.m, '', v.scene.seen ? 'Сцена ↺' : 'Сцена', area.tap(() => {
      if (!v.scene.open) return toast(this, `Личная сцена — на близости ${v.scene.at}`);
      this.scene.restart({ mode: 'scene', hero: v.templateId, back: self } satisfies TavernEveningData);
    }), T.body, { variant: 'secondary' });
    sceneBtn.container.setName(`bondScene_${v.templateId}`);
    if (!v.scene.open) sceneBtn.setEnabled(false);
    else if (!v.scene.seen) sceneBtn.container.add(goldDot(this, bw / 2 - 14, -BTN.m / 2 + 14));
    area.add(sceneBtn.container);
    const questBtn = button(this, bx(1), by, bw, BTN.m, '', v.quest.done ? 'Задание ✓' : 'Задание', area.tap(() => {
      if (!v.quest.open) return toast(this, `Личное задание — на близости ${v.quest.at}`);
      this.questModal(area, v);
    }), T.body, { variant: 'secondary' });
    questBtn.container.setName(`bondQuest_${v.templateId}`);
    if (!v.quest.open) questBtn.setEnabled(false);
    else if (!v.quest.done) questBtn.container.add(goldDot(this, bw / 2 - 14, -BTN.m / 2 + 14));
    area.add(questBtn.container);
    return top + h;
  }

  /** Строка вечера: медальон с номером главы, название, справа — «Слушать» / «↺»; закрытый — «???» и «после гл. N». */
  private eveningRow(area: ScrollArea, e: EveningDef, top: number, self: Back, main = false): Phaser.GameObjects.Container {
    const st = eveningStatus(session.save, e, GAME);
    const n = chapterNo(e);
    const locked = st === 'locked';
    const fresh = st === 'new';
    let trailing: Phaser.GameObjects.Container | Phaser.GameObjects.Text;
    if (locked) trailing = text(this, 0, 0, `после гл. ${n}`, T.caption, COLOR.textTertiary, { fontStyle: 'bold' });
    else {
      const bw = fresh ? 240 : BTN.icon;
      const go = area.tap(() => this.scene.restart({ mode: 'evening', id: e.id, back: self } satisfies TavernEveningData));
      // Главная кнопка экрана — одна (первый новый вечер); остальные новые — вторичные с золотой точкой.
      const b = button(this, 0, 0, bw, BTN.m, '', fresh ? 'Слушать' : '↺', go, fresh ? T.body : T.heading, { variant: fresh ? (main ? 'primary' : 'secondary') : 'icon' });
      b.container.setName(`evening_${e.id}`).setSize(bw, BTN.m);
      if (fresh && !main) b.container.add(goldDot(this, bw / 2 - 12, -BTN.m / 2 + 12));
      trailing = b.container;
    }
    // BUG-194: закрытый вечер — без подзаголовка («После капитана Дрейка» — спойлер босса).
    const subtitle = locked || !e.subtitle ? `Глава ${n}` : e.subtitle;
    const preview = fresh ? `${subtitle}\n${eveningCreditPreview(eveningSquadHeroes(session.save, e.id, GAME).map(heroName), tavern()?.bond.squadGain ?? 0)}` : subtitle;
    let height = ROW_H;
    if (fresh) {
      const measure = text(this, 0, 0, preview, T.caption, COLOR.textSecondary, { wordWrap: { width: CW_ - 2 * S.s }, lineSpacing: 0 });
      height = eveningPreviewRowHeight(measure.height);
      measure.destroy();
    }
    const row = listRow(this, GAME_W / 2, top + height / 2, CW_, {
      icon: (sc, x, y, size) => {
        const ring = sc.add.circle(0, 0, size * 0.6, locked ? COLOR_N.surfaceSunken : COLOR_N.surfaceRaised).setStrokeStyle(4, locked ? COLOR_N.border : hexNum(mixHex(COLOR.border, COLOR.accent, 0.6)));
        const num = text(sc, 0, 2, String(n), T.title, locked ? COLOR.textTertiary : COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' });
        return sc.add.container(x, y, [ring, num]);
      },
      title: locked ? '???' : e.title,
      subtitle: preview,
      subtitleFullWidth: fresh,
      trailing,
      dim: locked,
      raised: main,
      h: height,
    });
    if (fresh) (row.list.at(-1) as Phaser.GameObjects.Text).setName(`eveningCredit_${e.id}`);
    area.add(row);
    return row;
  }

  /** Личное задание: условие, награда чипами, «В бой» — бой считает ядро, итог — здесь же. */
  private questModal(area: ScrollArea, v: BondView): void {
    area.locked = true;
    const layer = this.add.container(0, 0).setDepth(300).setName('bondQuestModal');
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.7).setInteractive();
    const q = v.quest;
    const W = 960;
    layer.add(shade);
    const body = this.add.container(0, 0);
    const close = () => {
      if (!layer.scene) return;
      area.locked = false;
      layer.destroy();
    };
    shade.on('pointerup', close);
    let y = S.l + 10;
    const add = (s: string, size: number, color: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}, gap: number = S.s) => {
      const t = text(this, GAME_W / 2, y, s, size, color, { wordWrap: { width: W - 2 * S.l }, lineSpacing: 8, ...style }).setOrigin(0.5, 0);
      body.add(t);
      y += t.height + gap;
      return t;
    };
    add(`ЗАДАНИЕ · ${heroName(v.templateId).toUpperCase()}`, T.caption, COLOR.textSecondary, { fontStyle: 'bold' }, S.xxs);
    add(q.title, T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' });
    add(q.text, T.body, COLOR.textPrimary);
    add(q.goal, T.heading, COLOR.warning, { fontStyle: 'bold' });
    const r = q.reward;
    if (q.done) add('Награда уже получена', T.caption, COLOR.textTertiary);
    else {
      const items: ChipSpec[] = [];
      if (r.gold) items.push({ icon: 'gold', value: r.gold, tone: 'gold' });
      if (r.gems) items.push({ icon: 'gems', value: r.gems, tone: 'gem' });
      if (r.scrolls) items.push({ icon: 'scrolls', value: `×${r.scrolls}` });
      items.push({ icon: 'star', value: `связка ${quoted(v.link.name)}`, tone: 'positive' });
      const row = rewardRow(this, GAME_W / 2, y + 28, items, { maxW: W - 2 * S.l, size: 's' });
      body.add(row);
      y += row.height + S.s;
    }
    add(`${heroName(v.templateId)} — в отряде · враги сильнее обычного`, T.caption, COLOR.textSecondary);
    const initial = eveningModalLayout(view().uiHeight, y, 0);
    const box = plate(this, GAME_W / 2, initial.centerY, W, initial.height, { ...SURFACE.raised, alpha: 0.99, r: R.xl }).setInteractive();
    layer.add(box);
    const modalBody = new ScrollArea(this, initial.bodyTop, initial.bodyBottom, { left: GAME_W / 2 - W / 2, right: GAME_W / 2 + W / 2 });
    modalBody.content.setName('bondQuestScroll');
    modalBody.add(body);
    modalBody.setContentHeight(y);
    registerModal(layer, close);
    const btnY = initial.buttonY;
    let launching = false;
    // BUG-188: «В бой» — настоящий бой в BattleScene (режим bond: тот же расчёт ядра fightBondQuest, ульта вручную),
    // итог — окном здесь же после боя. Условия проверяются сразу, без расчёта боя (касание отвечает мгновенно).
    const go = button(this, GAME_W / 2 + 190, btnY, 400, BTN.l, 'ui_btn_primary', 'В бой', () => {
      if (launching) return;
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
      // Отклик сразу: кнопка гаснет и пишет «Бой…», пока строится сцена боя.
      launching = true;
      go.setLabel('Бой…');
      go.setEnabled(false);
      this.time.delayedCall(30, () => {
        if (!layer.scene || !this.sys.isActive()) return;
        close();
        this.scene.start('Battle', { mode: 'bond', templateId: v.templateId, back: this.back });
      });
    }, T.title);
    go.label.setFontFamily(FAMILY.heading);
    go.container.setName('bondQuestGo');
    const cancel = button(this, GAME_W / 2 - 230, btnY, 300, BTN.l, '', 'Назад', close, T.body, { variant: 'secondary' });
    cancel.container.setName('bondQuestCancel');
    layer.add([go.container, cancel.container]);
    popIn(this, layer, shade);
    layer.add(modalBody.parts);
    const inner = layer.getByName('popInner') as Phaser.GameObjects.Container;
    const offView = onViewChange(this, () => {
      const next = eveningModalLayout(view().uiHeight, y, 0);
      inner.y = next.centerY;
      box.setSize(W, next.height).setY(0);
      go.container.y = cancel.container.y = next.buttonY - next.centerY;
      modalBody.setBounds(next.bodyTop, next.bodyBottom);
    });
    layer.once(Phaser.GameObjects.Events.DESTROY, offView);
  }

  private questResult(v: BondView, win: boolean, goal: boolean, firstTime: boolean, fallen: string[], duration: number): void {
    const layer = this.add.container(0, 0).setDepth(300).setName('bondQuestResult');
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.7).setInteractive();
    const W = 960;
    layer.add(shade);
    const body = this.add.container(0, 0);
    let y = S.xl;
    const add = (s: string, size: number, color: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}) => {
      const t = text(this, GAME_W / 2, y, s, size, color, { wordWrap: { width: W - 2 * S.l }, lineSpacing: 8, ...style }).setOrigin(0.5, 0);
      body.add(t);
      y += t.height + S.s;
    };
    const names = fallen.map((id) => {
      const h = session.save.heroes.find((x) => x.id === id);
      return h ? heroTemplate(GAME, h.templateId).name : id;
    });
    add(goal ? 'Задание выполнено!' : win ? 'Цель не достигнута' : 'Поражение', T.display, goal ? COLOR.positive : win ? COLOR.warning : COLOR.negative, { fontFamily: FAMILY.heading, fontStyle: 'bold' });
    add(`${Math.round(duration)} с${names.length ? ` · пали: ${names.join(', ')}` : ' · все устояли'}`, T.caption, COLOR.textSecondary);
    if (goal && firstTime) add(`Открыта связка ${quoted(v.link.name)}`, T.heading, COLOR.positive, { fontStyle: 'bold' });
    if (goal && v.quest.after) {
      const who = speakerView(pseudoStory(), v.quest.after.speaker, session.save, GAME);
      add(`${who.name}: «${v.quest.after.text}»`, T.body, COLOR.title, { fontStyle: 'italic' });
    }
    if (!goal) add('Усильте отряд или поменяйте расстановку', T.body, COLOR.textPrimary);
    sfx(goal ? 'victory' : 'defeat');
    const initial = eveningModalLayout(view().uiHeight, y, 0);
    const box = plate(this, GAME_W / 2, initial.centerY, W, initial.height, { ...SURFACE.raised, alpha: 0.99, r: R.xl });
    layer.add(box);
    const modalBody = new ScrollArea(this, initial.bodyTop, initial.bodyBottom, { left: GAME_W / 2 - W / 2, right: GAME_W / 2 + W / 2 });
    modalBody.content.setName('bondQuestResultScroll');
    modalBody.add(body);
    modalBody.setContentHeight(y);
    let completed = false;
    const done = () => {
      if (completed) return;
      completed = true;
      this.scene.restart({ mode: 'hub', back: this.back } satisfies TavernEveningData);
    };
    registerModal(layer, done);
    const ok = button(this, GAME_W / 2, initial.buttonY, 420, BTN.l, 'ui_btn_primary', 'Дальше', done, T.heading);
    ok.container.setName('bondQuestDone');
    layer.add(ok.container);
    popIn(this, layer, shade);
    layer.add(modalBody.parts);
    const inner = layer.getByName('popInner') as Phaser.GameObjects.Container;
    const offView = onViewChange(this, () => {
      const next = eveningModalLayout(view().uiHeight, y, 0);
      inner.y = next.centerY;
      box.setSize(W, next.height).setY(0);
      ok.container.y = next.buttonY - next.centerY;
      modalBody.setBounds(next.bodyTop, next.bodyBottom);
    });
    layer.once(Phaser.GameObjects.Events.DESTROY, offView);
  }
}

/** Ширина контента «Вечеров» (поля экрана S.l) и строка вечера. */
const CW_ = GAME_W - 2 * S.l;
const ROW_H = 136;

/** Сердце (близость) в графике g: центр (x, y), ширина size, заливка и кромка. */
function heartPath(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, fill: number, rim: number): void {
  const pts: Phaser.Math.Vector2[] = [];
  // Кривая сердца по точкам: гладкое сердце без текстуры.
  for (let i = 0; i < 36; i++) {
    const t = (i / 36) * Math.PI * 2;
    const hx = 16 * Math.pow(Math.sin(t), 3);
    const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push(new Phaser.Math.Vector2(x + (hx / 34) * size, y + (hy / 34) * size + size * 0.04));
  }
  g.fillStyle(fill, 1).fillPoints(pts, true);
  g.lineStyle(Math.max(2, size / 14), rim, 1).strokePoints(pts, true);
}

/** Чип «♥ +2» / «♥ 5/10»: тёмная «таблетка», красное сердце, число. */
function heartChip(scene: Phaser.Scene, x: number, y: number, label: string, opts: { align?: 'center' | 'right'; dim?: boolean } = {}): Phaser.GameObjects.Container {
  const t = text(scene, 0, 0, label, T.caption, opts.dim ? COLOR.textTertiary : COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5);
  const hs = 34;
  const h = 56;
  const w = S.xs + hs + S.xxs + t.width + S.xs;
  const bg = plate(scene, 0, 0, w, h, { ...SURFACE.sunken, border: mixHex(COLOR.surfaceSunken, COLOR.negative, 0.45), r: R.pill });
  const g = scene.add.graphics();
  heartPath(g, -w / 2 + S.xs + hs / 2, 0, hs, opts.dim ? COLOR_N.textTertiary : COLOR_N.negative, opts.dim ? COLOR_N.border : 0x5a1a12);
  t.setX(-w / 2 + S.xs + hs + S.xxs);
  const cx = opts.align === 'right' ? x - w / 2 : x;
  return scene.add.container(cx, y, [bg, g, t]).setSize(w, h).setName('heartChip');
}
