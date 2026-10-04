import Phaser from 'phaser';
import {
  actPlayStage,
  actTowerFight,
  runConfig,
  towerRunSquad,
  type TowerFightOutcome,
  buildUnit,
  COMBAT,
  enemySquad,
  beginCampaignStage,
  fightHunt,
  fightAutobattlerRound,
  type AutobattlerOutcome,
  bondView,
  fightBondQuest,
  type BondQuestOutcome,
  getStage,
  orderActives,
  progressLevelBand,
  recommendedFactor,
  simulateBattle,
  ultSkillOf,
  unitLevel,
  type CardRarity,
  withGear,
  type BattleEvent,
  type BattleInput,
  type BattleResult,
  type PlayerControl,
  type SkillDef as CoreSkill,
  type HuntOutcome,
  type SaveState,
  type StageOutcomeWithDrops,
  type TowerOutcome,
  type UnitDef,
  type UnitSnapshot,
} from '../../core';
import type { AnimName } from '../../pipeline/sprites';
import { CONTENT, GAME } from '../content';
import { startTavernEvening, type TavernEveningData } from './TavernEveningScene';
import { enemyLevelColor, heroSprite, levelLabel as levelLabelOf, stageLevelsFor, stageNo, stageSeed } from '../flow';
import { commit, now, session, today } from '../session';
import { BLEED_X, BLEED_Y, GAME_W } from '../layout';
import { SKIN, SKIN_TINT, skinIcon, type SkinIcon } from '../skin';
import { anim, hitDelay, lazyPortrait, portraitKey, spriteView, whenSprites, type SpriteView } from '../sprites';
import { clampDelta } from '../lifecycle';
import { nextPlaybackSpeed, playback, setPlaybackSpeed, squads } from '../state';
import { BarkLayer, BEHAVIOR_LABEL_DEPTH, BEHAVIOR_LABEL_SIZE, clampX, DEPTH, FloatLayer, RO_HIT, RO_RISE, ULT_FX_BOOST, UltPresenter } from '../battleFx';
import { settleSpread, spreadUnits, type SpreadUnit } from '../battleSpread';
import { battleSpriteHitArea, battleSpritePresentation, separateBattleSprites, type BattlePresentationBounds, type BattleSpritePresentation } from '../battlePresentation';
import { gaitReset, gaitStep, type GaitState } from '../battleGait';
import { BehaviorFx } from '../battleBehaviorFx';
import { button, ellipsize, panel, text, toast, tutorialHint, type ButtonView } from '../ui';
import { audioSettings, setAudioSettings } from '../audio';
import { hintDone, markHint } from '../hints';
import { isUnlocked } from '../unlockBanner';
import { ease, Scheduler } from '../perf';
import { navShift, topBand, unitTint } from '../screen';
import { animatedFxKey, battleFxIds, castFxId, skillFx, type SkillFx as AtlasRoles } from '../animatedFx';
import { holdAnimatedFx } from '../assets';
import { FIRE_BOLT_MS, FIRE_BOLT_STEP, SkillFx, STAR_TEX, type CastRig, type FxPoint, type HitStyle } from '../skillFx';
import { flyAtlas, playAura, playBigImpact, playBossDeath, playCharge, playCrit, playProc, playSignature, playTwinkle, type SigCtx } from '../skillSigs';
import { visualOf } from '../skillVisuals';
import { motion } from '../state';
import { buffColor, ELEMENT_COLORS, lookOf } from '../skillLook';
import { addThemeBackground, themeOfBattle, type Theme } from '../backdrops';
import { Ambient, SHADOW_TEX } from '../ambient';
import { skillIcon, statusIcon } from '../skillIcons';
import type { SkillDef, StatusDef } from '../../core';
import { battleSound } from '../battleAudio';
import { haptic } from '../haptics';
import { chargeBreakBadge, ultBreaksCharge } from '../ultBadge';
import { firstTip, tipDone } from '../firstTips';
import { huntHud, type HuntHud } from '../huntBattle';
import { HeroPanel, PANEL_TOP, shadeBand } from '../battlePanel';
import { COLOR, COLOR_N, E, M, T } from '../theme';
import { decorTween } from '../juice';
import { battleMode, nextTick, setBattleAuto, ultHint } from '../battleMode';
import { elementBadge } from '../battleElements';
import { attackElement, defenseElement } from '../../core/elements';
import { autoAdvance } from '../state';
import { recordMvpAttempt, recordTowerProgress } from '../online/online';
import type { AutobattlerSceneData } from './AutobattlerScene';

/** Полоски компактные: у сошедшихся в ближнем бою пар они не должны касаться. */
const BAR_W = 124;
/** Полоски под ногами: HP (центр y, толщина) и энергия врага под ней. */
const HP_BAR_Y = 12;
const HP_BAR_H = 10;
const EN_BAR_Y = 25;
/** Полоски и имя сдвинуты к «своему тылу» (A — влево, B — вправо), чтобы у пары в ближнем бою не наезжали. */
const UI_SHIFT = 18;
/** Подъём запасных цифр; размещение и занятость теперь считает сам FloatLayer по живым надписям. */
const FLOAT_RISE = 36;
/** Белый «след» полоски HP: пауза и время догоняющего сжатия. */
const TRAIL_DELAY = 250;
const TRAIL_MS = 450;
/** Полёт снаряда, мс на 1x: столько же, сколько снаряд летит в ядре (combat.json projectileSeconds). */
const PROJECTILE_MS = Math.round((COMBAT.projectileSeconds ?? 0.3) * 1000);
/** «Получил урон» не чаще, чем раз в столько мс, и не перебивает атаку. */
const HURT_COOLDOWN = 500;
/** Красная вспышка при попадании, мс на 1x (перед ней HIT_FLASH_MS — белая заливка). */
const HURT_TINT_MS = 90;
const HIT_FLASH_MS = 30;
/**
 * RR-15 / BUG-158: белая заливка попадания — не чаще раза в HIT_FLASH_EVERY мс на юнита (по боссу бьют все пятеро и
 * он был белым силуэтом весь бой); у босса белой заливки нет вовсе — только короткий светло-красный оттенок.
 */
const HIT_FLASH_EVERY = 600;
/** RR-14: первые секунды боя (ауры, пассивки «на начало боя») — без подписей пассивок и статусов. */
const OPENING_QUIET_S = 1;
/** Фокус на ульте героя (мс сцены): столько остальные бойцы приглушены после начала ульты… */
const ULT_FOCUS_MS = 1000;
/** …и не меньше, чем до удара ульты плюс столько (вспышка и цифры удара успевают прочитаться). */
const ULT_FOCUS_TAIL_MS = 500;
/** Глубина панели героев (RR-05): выше фигур поля, ниже затемнения ульты (DEPTH.dim). */
const PANEL_DEPTH = 2800;
/** «Сбито!» над боссом — вдвое крупнее подписей поведения (их 36): главный момент боя с решениями. */
const CHARGE_BREAK_SIZE = 76;
/** Подсказка первого заряда босса: поверх плашки с названием этапа (кнопки и полоса босса ниже — не закрывает). */
const CHARGE_TIP_Y = 24;
const BOSS_HURT_TINT = 0xffb4a8;
/** Бело-зелёный отсвет на юните, которого вылечили, мс на 1x. */
const HEAL_TINT_MS = 220;
/** Полёт снаряда навыка (огненная стрела, ледяной осколок), мс на 1x, и шаг между снарядами одного навыка. */
const SKILL_PROJECTILE_MS = 320;
/** Пауза-«hit stop» на смерти босса (мс): бой, твины и анимации замирают на миг. «Уменьшить анимацию» — без неё. */
const BOSS_HIT_STOP_MS = 100;
/** Крупный удар — от этой доли ОЗ цели: подсветка «крита» (skillSigs playCrit). */
const CRIT_HP_PART = 0.25;
const SKILL_VOLLEY_STEP = 120;
/**
 * Значки перезарядки активных навыков под полоской HP героя — спокойно, как в AFK Arena: мелкие, не больше CD_SLOTS
 * (очередь «что будет готово следующим»: готовые первыми, дальше по времени готовности), пока навык перезаряжается —
 * полупрозрачный (CD_DIM), готовый — полностью виден и в золотой рамке. Ряд уже полоски HP — не заходит к соседу.
 */
const CD_ICON = 26;
const CD_GAP = 4;
const CD_SLOTS = 3;
const CD_DIM = 0.45;
/** Лист шторок перезарядки: кадр 0 — пусто, 1 — золотая рамка готового, 1 + k — сектор k/CD_STEPS. */
const CD_SHEET = 'cd_sweep_sheet';
const CD_STEPS = 48;
const CD_FRAME_EMPTY = 0;
const CD_FRAME_READY = 1;
/** Клетка листа (единицы игры): значок CD_ICON с рамкой 2 и обводкой; рисуется с плотностью CD_RES. */
const CD_CELL = 32;
const CD_RES = 2;
/** Значки статусов над полоской HP: размер и сколько видно (остальные — счётчиком «+N» справа от значков). */
const STATUS_ICON = 32;
const STATUS_MAX = 3;
const STATUS_GAP = 3;
/** Значок навыка у полосы каста. */
const CAST_ICON = 30;
/** Имена над юнитами (T2-15, T3-02): мелко, видны первые секунды боя, потом гаснут; касание юнита — показать снова. */
/** Подпись на телефоне остаётся читаемой, даже когда бойцы сходятся вплотную. */
const NAME_SIZE = T.caption;
/** Подписи выше фигур и эффектов; их область ограничена полем между двумя панелями HUD. */
const UNIT_LABEL_DEPTH = DEPTH.numbers + 80;
const UNIT_LABEL_GAP = 10;
const NAME_SHOW_S = 3;
const NAME_FADE_MS = 500;
const NAME_TAP_MS = 1800;
/** Строка seed под таймером — только в отладке (?debug в адресе). */
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
/** Сколько бой ждёт ленивой загрузки анимированных эффектов (fx_hit, fx_heal…), прежде чем начаться без них. */
const FX_WAIT_MS = 2500;
/** Враг ближе этого по x — не разворачиваться к нему (не вертеться, когда он прямо над/под). */
const FACE_DEADZONE = 24;
/** Звёзды оглушения над головой: сколько, радиус орбиты. */
const STUN_STARS = 3;
const STUN_R = 34;
/** Ледяной оттенок замороженного (Ледяной удар). */
const FROZEN_TINT = 0x9ad8ff;

/** Все статусы из навыков (id → описание) — для значка над HP по событию status. */
let statusDefs: Map<string, StatusDef> | null = null;
function statusDef(id: string): StatusDef | undefined {
  if (!statusDefs) {
    statusDefs = new Map();
    for (const sk of Object.values(CONTENT.skills)) for (const e of sk.effects) if (e.type === 'status' && !statusDefs.has(e.status.id)) statusDefs.set(e.status.id, e.status);
    for (const unit of Object.values(CONTENT.units)) for (const phase of unit.phases ?? []) for (const action of phase.actions) {
      if (action.type === 'status' && !statusDefs.has(action.status.id)) statusDefs.set(action.status.id, action.status);
    }
    statusDefs.set('charge_broken', { id: 'charge_broken', name: 'Сбит', turns: COMBAT.charge?.stunTurns ?? 3, stun: true });
  }
  return statusDefs.get(id);
}

/** Перезарядка одного активного навыка героя. */
interface CdSkill {
  skill: SkillDef;
  /** Когда готов (время боя, с) и полная перезарядка. */
  readyAt: number;
  cd: number;
  /** Порядок выбора в ядре (приоритет): при равной готовности раньше идёт тот, кого ядро выберет первым. */
  order: number;
}
/** Место под значок перезарядки под полоской HP: какой навык в нём сейчас. */
interface CdIcon {
  icon: Phaser.GameObjects.Image;
  /** Кадр листа шторок (CD_SHEET): пусто / золотая рамка / сектор k/48. */
  sweep: Phaser.GameObjects.Image;
  x: number;
  y: number;
  s: CdSkill | null;
  /** Последняя нарисованная доля (чтобы не перерисовывать каждый кадр). */
  shown: number;
}
/** Баннер босса: появление, показ, угасание (мс на 1x). Бой стоит, пока баннер на экране (без угасания). */
const BOSS_IN_MS = 220;
const BOSS_HOLD_MS = 1100;
const BOSS_OUT_MS = 400;
/** Баннер босса — полосой через центр поля: кнопки скорости и «Пропустить» (y≈360) не закрывает. */
const BOSS_BANNER_Y = 780;
/**
 * Верхняя полоса боя (итерация 5): одна строка ~110 ед. — слева таймер (обратный отсчёт) и мелко название этапа,
 * справа значки звука, скорости, «Авто» и «Пропустить» без плитки. HUD_Y — её центр на поле 9:16; на вытянутом
 * экране полоса поднимается к верху безопасной области (topBand).
 */
const HUD_Y = 72;
/** Полоска HP босса — под верхней полосой: имя и уровень над ней, засечки фаз — ромбами на ней. */
const BOSS_BAR_DY = 170;
const BOSS_BAR_W = 760;
const BOSS_BAR_H = 22;
/** Полоса заряда босса под его полоской HP. */
const BOSS_CHARGE_W = 320;
/** Верхняя полоса: поле от края, высота значков, ширины кнопок и зазор между ними. */
const TOP_MARGIN = 40;
const TOP_BTN_H = 96;
const SPEED_W = 104;
const AUTO_W = 132;
const SKIP_W = 228;
const TOP_GAP = 12;
/** Низ подписей под ногами (полоска, значки перезарядки) от точки ног — медальоны героев ниже с зазором. */
const UNDER_FEET = 66;
/** Куда можно сдвинуть фигуру при расталкивании (поле 1080×1920; как bounds в combat.json). */
const SPREAD_BOUNDS = COMBAT.field.bounds ?? { minX: 70, maxX: COMBAT.field.width - 70, minY: 900, maxY: 1840 };
/**
 * RR-03: поле ядра (x 70…1010 на ширине 1080) на экране чуть сжато к центру — отступающий к краю лекарь или маг
 * (x ≈ 70) виден целиком вместе с цифрами и подписями, а не обрезан кромкой экрана. Только показ: ядро, лог и баланс
 * не меняются. x ядра 0 → 86, 70 → 145, 540 → 540.
 */
const FIELD_CX = COMBAT.field.width / 2;
export const FIELD_SQUEEZE = 0.84;
export const fieldX = (x: number): number => FIELD_CX + (x - FIELD_CX) * FIELD_SQUEEZE;

/**
 * Вид юнита. pos (SpreadUnit) — позиция из лога ядра (её двигают шаги), node — показанная: pos + смещение
 * расталкивания (battleSpread.ts), его считает update() каждый кадр.
 */
interface UnitView extends SpreadUnit, GaitState {
  snap: UnitSnapshot;
  def: UnitDef;
  spriteId: string;
  look: SpriteView;
  node: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  presentation: BattleSpritePresentation;
  /** Screen projection only: core pos and formation offX/offY stay unchanged. */
  displayX: number;
  displayY: number;
  /** Тень под ногами (гаснет вместе с павшим). */
  shadow: Phaser.GameObjects.Image;
  hpBar: Phaser.GameObjects.Image;
  /** Белый след под HP: показывает только что снятое здоровье и плавно догоняет. */
  trailBar: Phaser.GameObjects.Image;
  trail: number;
  /** След догоняет HP: откуда, куда и сколько мс прошло (−1 — стоит). Считается в update, без твина на каждый удар. */
  trailFrom: number;
  trailTo: number;
  trailT: number;
  /** Сколько мс ещё держать красный оттенок попадания (0 — нет). */
  tintLeft: number;
  /** Смещение подписи с именем от точки ног (y). */
  nameY: number;
  /** Юнит кастует ульту (до своей следующей обычной атаки) — его удары подсвечиваются. */
  inUlt: boolean;
  shieldBar: Phaser.GameObjects.Image;
  energyBar: Phaser.GameObjects.Image;
  /** Полоса каста (на месте энергии): видна, пока юнит колдует. */
  castBar: Phaser.GameObjects.Image;
  castBack: Phaser.GameObjects.Image;
  /** Идёт каст: начало и длительность в секундах боя. */
  cast: { start: number; dur: number } | null;
  /** Значок навыка слева от полосы каста (вместо названия; у заряда — молния castBolt). */
  castIcon: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  /** Отдельный слой подписи/каста: фигура соседа не может закрыть имя или готовящийся навык. */
  labels: Phaser.GameObjects.Container;
  namePlate: Phaser.GameObjects.Rectangle;
  labelLeader: Phaser.GameObjects.Rectangle;
  nameUnder: number;
  /** Круг каста и аура (создаются при первом касте). */
  castRig?: CastRig;
  /** Идёт заряд (каст с charge): молния у полосы каста; создаётся при первом заряде. */
  charging: boolean;
  castBolt?: Phaser.GameObjects.Image;
  /** Попадания текущего навыка по целям: время сцены (мс) каждого удара — цифры встают под свой снаряд. */
  hitPlan: Map<string, number[]>;
  /** Значки статусов над HP (id статуса → картинка). */
  statusIcons: Map<string, Phaser.GameObjects.Image>;
  /** Счётчик «+N» статусов, не поместившихся в ряд (создаётся при первой надобности). */
  statusMore?: Phaser.GameObjects.Text;
  statusY: number;
  statusX0: number;
  /** Перезарядка активных навыков (только у героев игрока) и места под значки. */
  cdSkills: CdSkill[];
  cdIcons: CdIcon[];
  /** Идёт белая вспышка попадания (затем — красный оттенок). */
  flashFill: boolean;
  /** Когда была последняя белая вспышка (RR-15: не на каждый удар). */
  lastFlash: number;
  /** Навык текущего действия (для эффекта попадания). */
  lastSkill?: string;
  /** Сработавшая пассивка (событие passive): её удары/статусы в тот же момент рисуются по ней, а не по lastSkill. */
  proc?: { skill: string; t: number };
  bars: Phaser.GameObjects.Components.Visible[];
  hp: number;
  shield: number;
  energy: number;
  /** Время боя, к которому относится energy (между событиями энергия героя растёт от времени — UnitDef.energy.perSecond). */
  energyT: number;
  alive: boolean;
  /** Смерть уже показана (die). */
  shownDead: boolean;
  /** Сколько отложенных попаданий по юниту ещё не показано; смерть ждёт их (цифры не всплывают над трупом). */
  pending: number;
  deathQueued?: () => void;
  /** Кто последним наложил статус (оглушение сбивает каст — показываем в момент его удара). */
  lastStatusSrc?: string;
  /** Куда идёт текущий шаг (для «Пропустить»: встать в конечную точку). */
  moveDest: [number, number] | null;
  /** Сдвиг подписей к своему тылу (x относительно ног). */
  labelX: number;
  /** Время сцены (мс), когда удар текущего действия юнита достигнет цели. */
  impactAt: number;
  /** Идёт разовая анимация (атака, каст, смерть) — стойка/ходьба её не перебивают. */
  busyUntil: number;
  lastHurt: number;
  moveTween: Phaser.Tweens.Tween | null;
  /** Вид искры обычного удара юнита и её цвет. */
  hitStyle: HitStyle;
  hitTint: number;
  /** Оглушён (звёзды над головой) / заморожен (ледяной оттенок). */
  stunned: boolean;
  frozen: boolean;
  stunStars?: Phaser.GameObjects.Image[];
  /** Время вращения звёзд оглушения, мс боя. */
  starT: number;
  /** Когда последний раз сыпали след рывка (время сцены). */
  lastTrail: number;
  /** Подсвечен ультой — глубину держит spotlight, а не сортировка по y. */
  spot: boolean;
  /** Вид текущего шага ядра (null — стоит). */
  moveKind: 'walk' | 'dash' | null;
  /**
   * Походка по показанной позиции (позиция ядра + смещение разведения): прошлая точка node и сглаженная скорость,
   * px на мс боя. Ходьба и разворот — по ней, а не по флагу твина: шаг, который разведение гасит, — не ходьба,
   * а сдвиг разведением без своего шага — не шаг вперёд.
   */
  /** Куда смотрит фигура: 1 — вправо, -1 — влево. */
  faceDir: 1 | -1;
  /** Цель последней атаки — к ней юнит повёрнут, пока стоит. */
  lookAt: UnitView | null;
  /** Отход стрелка (move reason kite): пятится лицом к врагу, не разворачиваясь. */
  backpedal: boolean;
  /** Подпись «Отход!» уже была (раз за бой). */
  kiteShown: boolean;
  /** Зона касания тела (при развороте едет вместе с origin). */
  hitRect: Phaser.Geom.Rectangle;
  /** Ключи зацикленных анимаций (считаются один раз — gait() зовёт loop() каждый кадр). */
  loopKeys: Record<'idle' | 'walk' | 'cast', string | null>;
}

/** Тестовый бой (отряды экрана подготовки), этап кампании или этаж башни (отряд из сохранения). */
export type BattleData =
  | { mode?: 'test'; seed: number }
  | { mode: 'stage'; stageId: string }
  | { mode: 'tower' }
  | { mode: 'hunt'; rank?: number }
  | { mode: 'autobattler' }
  /** Личное задание героя (вечера, BUG-188): бой ядра fightBondQuest, после — «Вечера» с итогом. back — куда вела «Назад» вечеров. */
  | { mode: 'bond'; templateId: string; back?: TavernEveningData['back'] };

/** Что получает экран итогов. */
export interface ResultData {
  result: BattleResult;
  /** Описания юнитов боя по unitId (у героев игрока и врагов этапа их нет в CONTENT.units). */
  defs: Record<string, UnitDef>;
  /** Только для этапа: итог с новым сохранением, событиями прогрессии и выпавшими предметами. skipped — бой пропущен (K7). */
  stage?: { stageId: string; outcome: StageOutcomeWithDrops; skipped?: boolean };
  /** Только для башни: какой этаж штурмовали и итог. */
  tower?: { floor: number; outcome: TowerOutcome };
}

/** Герои отряда с экипировкой — описания для боя и экрана итогов. */
export function squadDefs(save: SaveState): Record<string, UnitDef> {
  const ctx = withGear(GAME, save);
  const defs: Record<string, UnitDef> = {};
  for (const h of save.heroes) {
    if (!save.squad.includes(h.id)) continue;
    const def = buildUnit(h, ctx);
    // Лист по полу героя (<спрайт>_f/_m, иначе базовый) — как на остальных экранах (flow.ts heroSprite).
    defs[h.id] = { ...def, visual: { ...def.visual, sprite: heroSprite(h, GAME) } };
  }
  return defs;
}

export class BattleScene extends Phaser.Scene {
  private result!: BattleResult;
  private defs: Record<string, UnitDef> = {};
  private stage?: ResultData['stage'];
  private tower?: ResultData['tower'];
  /** Забег Башни (рогалик): итог боя этажа; после боя — экран Башни, а не итоги. */
  private towerRun?: { outcome: TowerFightOutcome };
  /** Охота на босса: итог ядра и счётчик урона (huntBattle.ts); после боя — экран охоты, а не итоги. */
  private hunt?: { outcome: HuntOutcome; hud?: HuntHud };
  private autobattler?: AutobattlerOutcome;
  /** Личное задание (режим bond): итог ядра и куда вернуться. */
  private bond?: { templateId: string; outcome: BondQuestOutcome; back?: TavernEveningData['back'] };
  private committed = false;
  private views = new Map<string, UnitView>();
  /** Те же юниты массивом — обход в update() каждый кадр без итератора Map. */
  private viewList: UnitView[] = [];
  /** Повторно используемые очереди разведения только видимых подписей (обычно 1–5). */
  private labelViews: UnitView[] = [];
  private labelRects: { x: number; y: number; w: number; h: number }[] = [];
  private cursor = 0;
  private clock = 0;
  /** Какие пассивки уже подписывали в этом бою (unit:skill). */
  private shownPassives = new Set<string>();
  /** RR-07: какие статусы уже подписывали над юнитом (unit:status) — подпись только при первом наложении. */
  private shownStatuses = new Set<string>();
  /** Версия статуса не дает отложенному эффекту вновь показать уже снятый бафф. */
  private statusVersions = new Map<string, number>();
  /** Несколько оглушений могут перекрываться: истечение одного не снимает остальные. */
  private activeStatuses = new Map<string, { def: StatusDef; frozen: boolean }>();
  private finished = false;
  private timeText!: Phaser.GameObjects.Text;
  /** Последняя показанная секунда таймера — текст перерисовываем раз в секунду, а не каждый кадр. */
  private shownSec = -1;
  private ult!: UltPresenter;
  private floats!: FloatLayer;
  /** Реплики боссов (поле юнита barks) и какие уже сказаны: `<uid>:<вид>`. */
  private barks!: BarkLayer;
  private barked = new Set<string>();
  private sfx!: SkillFx;
  /** Поведение в бою: провокация «!», нить связи (docs/design/battle-behavior.md). */
  private behaviorFx: BehaviorFx | null = null;
  /** id статусов-провокаций боя (по событию apply с taunt) — на expire снять «!». */
  private readonly tauntIds = new Set<string>();
  /** Когда над защитником последний раз писали «↪» (перенаправленный урон), мс сцены. */
  private readonly redirectShown = new Map<string, number>();
  /** Сколько мс (с учётом скорости) бой ещё стоит ради баннера босса. */
  private introLeft = 0;
  /** Осталось паузы «hit stop», мс реального времени (0 — бой идёт). */
  private stopLeft = 0;
  /** Уровни врагов (core/features/levels.ts): редкость полосы и поправка босс-этапа; null — тестовый бой (без уровней). */
  private levels: { rarity: CardRarity; bossFactor: number; shift?: number; choices?: Record<string, string> } | null = null;
  /** BUG-061: панель героев отряда над ареной (портрет, здоровье, энергия). */
  private heroPanel: HeroPanel | null = null;
  /** Полоска HP босса наверху (только на босс-этапе). */
  private bossBar: { uid: string; fill: Phaser.GameObjects.Image } | null = null;
  /** Тема поля (глава этапа / ярус башни) и лёгкие частицы по ней. */
  private theme: Theme = 'meadow';
  private ambient: Ambient | null = null;
  /** Отложенные действия боя (момент удара, вылет снаряда) — своя очередь вместо таймера Phaser на каждый удар. */
  private readonly later = new Scheduler();
  /** Идёт «Пропустить»: отложенное выполняется без анимации. */
  private skipping = false;
  /** Имена уже погашены после начала боя. */
  private namesHidden = false;
  /**
   * U: листы юнитов загружены и сцена построена. До этого бой не идёт (часы стоят), кнопок ещё нет.
   * Публичное — e2e/perf ждут готовности.
   */
  ready = false;
  /** Номер запуска сцены: отложенная сборка старого запуска (сцену уже выключили или перезапустили) не выполняется. */
  private createSeq = 0;
  /**
   * Ульта вручную (docs/design/battle-decisions.md §1). rerun — пересчитать бой (и итог этапа) с вводами игрока; null —
   * режим недоступен (Охота: всегда авто). manual — текущий режим, startManual — с каким начали (вводы — от него).
   */
  private rerun: ((ctl: PlayerControl) => BattleResult) | null = null;
  private manual = false;
  private startManual = false;
  private inputs: BattleInput[] = [];
  /** Ульта героя стороны A (навык) и когда её применили в последний раз (для полоски готовности). */
  private readonly ultSkill = new Map<string, CoreSkill>();
  private readonly ultUsedAt = new Map<string, number>();
  /**
   * Фокус на ульте героя (владелец 01.10): до until (время сцены) цифры, подписи и эффекты остальных бойцов
   * приглушены (FOCUS_MUTE_ALPHA), плашки и затемнение ульт монстров не показываются поверх.
   */
  private focus: { uid: string; until: number } | null = null;
  /** Герои, чью ульту игрок только что нажал: её удар — с затемнением и баннером, как ульта монстра. */
  private readonly tapped = new Set<string>();
  private modeBtn: ReturnType<typeof button> | null = null;
  private ultHintNode: Phaser.GameObjects.GameObject | null = null;
  /** Указатель «Скорость ×2» (обучение), пока висит. */
  private speedHint: Phaser.GameObjects.Container | null = null;
  /**
   * Раскладка экрана (считается в build по видимой области): центр верхней полосы, полоски босса, сдвиг панели
   * героев вниз и подъём поля. Поле ядра (ноги y 900…1840) поднято на dy — внизу медальоны героев (battlePanel.ts);
   * на вытянутом экране панель опущена к низу безопасной области, и поле поднимается меньше (или не поднимается).
   */
  private hudY = HUD_Y;
  private bossBarY = HUD_Y + BOSS_BAR_DY;
  private panelShift = 0;
  private dy = 0;
  private presentationBounds: BattlePresentationBounds = { minX: TOP_MARGIN, maxX: GAME_W - TOP_MARGIN, minY: 400, maxY: PANEL_TOP - UNDER_FEET };
  private speedBtn: ButtonView | null = null;
  /** Полоска HP босса: засечки фаз (доля HP) и полоса заряда под ней. */
  private bossPips: { pct: number; pip: Phaser.GameObjects.Rectangle }[] = [];
  private bossCharge: { node: Phaser.GameObjects.Container; fill: Phaser.GameObjects.Rectangle } | null = null;

  constructor() {
    super('Battle');
  }

  create(data: BattleData): void {
    // Выключение сцены: забыть юнитов и пулы (объекты, твины и таймеры Phaser убирает сам). once — без накопления слушателей.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.views.clear();
    this.viewList.length = 0;
    this.labelViews.length = 0;
    this.labelRects.length = 0;
    this.later.clear();
    this.shownSec = -1;
    this.cursor = 0;
    this.clock = 0;
    this.shownPassives.clear();
    this.shownStatuses.clear();
    this.finished = false;
    this.committed = false;
    this.ready = false;
    this.introLeft = 0;
    this.bossBar = null;
    this.skipping = false;
    this.namesHidden = false;
    this.ambient = null;
    this.theme = 'meadow';
    this.rerun = null;
    this.manual = false;
    this.startManual = false;
    this.inputs = [];
    this.statusVersions.clear();
    this.activeStatuses.clear();
    this.ultSkill.clear();
    this.ultUsedAt.clear();
    this.focus = null;
    this.tapped.clear();
    this.modeBtn = null;
    this.ultHintNode = null;
    this.speedHint = null;
    // Новый игрок — вручную; «Авто» в бою запоминается; «Авто: следующий этап» — бои без касаний.
    const wantManual = !battleMode.auto && !autoAdvance.on;
    let title = 'Тестовый бой';
    this.stage = undefined;
    this.tower = undefined;
    this.towerRun = undefined;
    this.hunt = undefined;
    this.autobattler = undefined;
    this.bond = undefined;
    this.levels = null;
    if (data.mode === 'stage') {
      // Бой считает ядро (actPlayStage: экипировка, выпадение, задания); сцена только проигрывает лог.
      // Сохраняем, когда бой закончится.
      const save = beginCampaignStage(session.save, data.stageId, GAME);
      if (save !== session.save) commit(save);
      let outcome: StageOutcomeWithDrops;
      // Тот же бой с вводами игрока: seed, день и время — как у первого расчёта (итог этапа — по показанному бою).
      const day = today();
      const ts = now();
      const seed = stageSeed(save);
      const stageId = data.stageId;
      const run = (ctl: PlayerControl) => actPlayStage(save, day, stageId, seed, { ...GAME, combat: { ...(GAME.combat ?? COMBAT), player: ctl } }, ts);
      try {
        outcome = run({ manualUlt: wantManual, inputs: [] });
      } catch (e) {
        console.warn(e);
        this.finished = true;
        this.scene.start('Campaign');
        return;
      }
      this.result = outcome.result;
      this.stage = { stageId: data.stageId, outcome };
      this.manual = this.startManual = wantManual;
      this.rerun = (ctl) => {
        const o = run(ctl);
        this.stage = { stageId, outcome: o };
        return o.result;
      };
      this.defs = squadDefs(save);
      for (const u of enemySquad(data.stageId, GAME, save.campaignChoices)) if (u) this.defs[u.id] = u;
      const st = getStage(GAME, data.stageId);
      // RR-16: та же шкала, что на экране этапа (редкость отряда, типичный враг = рекомендуемый уровень).
      const lv = stageLevelsFor(save, data.stageId, GAME);
      this.levels = { rarity: lv.rarity, bossFactor: recommendedFactor(data.stageId, GAME, save.campaignChoices), shift: lv.shift, choices: save.campaignChoices };
      title = `${stageNo(st, GAME)} · ${st.name}`;
      this.theme = themeOfBattle({ stageId: data.stageId });
    } else if (data.mode === 'tower') {
      // Забег Башни (docs/design/tower-roguelite.md): бой этажа с ранами и картами; ручная ульта — как в кампании.
      const save = session.save;
      const day = today();
      const run = (ctl: PlayerControl) => actTowerFight(save, day, GAME, ctl);
      let outcome: TowerFightOutcome;
      try {
        outcome = run({ manualUlt: wantManual, inputs: [] });
      } catch (e) {
        console.warn(e);
        this.finished = true;
        this.scene.start('Tower');
        return;
      }
      this.result = outcome.result;
      this.towerRun = { outcome };
      this.manual = this.startManual = wantManual;
      this.rerun = (ctl) => {
        const o = run(ctl);
        this.towerRun = { outcome: o };
        return o.result;
      };
      this.defs = {};
      for (const u of towerRunSquad(save, GAME).squad) {
        const hero = u ? save.heroes.find((h) => h.id === u.id) : undefined;
        if (u && hero) this.defs[u.id] = { ...u, visual: { ...u.visual, sprite: heroSprite(hero, GAME) } };
      }
      for (const u of outcome.enemies) if (u) this.defs[u.id] = u;
      this.levels = { rarity: progressLevelBand(save, GAME).rarity, bossFactor: 1 };
      const kindName = outcome.kind === 'boss' ? ' · босс' : outcome.kind === 'elite' ? ' · элита' : '';
      title = `Башня · этаж ${outcome.floor}${kindName}`;
      this.theme = themeOfBattle({ towerFloor: outcome.floor });
    } else if (data.mode === 'hunt') {
      // MVP-охота (docs/design/mvp-hunt.md): ульта вручную, как в кампании — бой пересчитывается с вводами игрока.
      const save = session.save;
      const day = today();
      const rank = data.rank;
      const run = (ctl: PlayerControl) => fightHunt(save, day, { ...GAME, combat: { ...(GAME.combat ?? COMBAT), player: ctl } }, { rank });
      let outcome: HuntOutcome;
      try {
        outcome = run({ manualUlt: wantManual, inputs: [] });
      } catch (e) {
        console.warn(e);
        this.finished = true;
        this.scene.start('Hunt');
        return;
      }
      this.result = outcome.result!;
      this.hunt = { outcome };
      this.manual = this.startManual = wantManual;
      this.rerun = (ctl) => {
        const o = run(ctl);
        this.hunt = { outcome: o, hud: this.hunt?.hud };
        return o.result!;
      };
      this.defs = squadDefs(save);
      this.defs[outcome.boss.def.id] = outcome.boss.def;
      this.levels = { rarity: progressLevelBand(save, GAME).rarity, bossFactor: 1 };
      title = outcome.boss.rank !== undefined ? `Охота на MVP · ур. ${outcome.boss.rank + 1}` : 'Охота на босса';
      this.theme = 'swamp';
    } else if (data.mode === 'autobattler') {
      const save = session.save;
      const day = today();
      const run = (ctl: PlayerControl) => fightAutobattlerRound(save, day, GAME, ctl);
      let outcome: AutobattlerOutcome;
      try {
        outcome = run({ manualUlt: wantManual, inputs: [] });
      } catch (error) {
        console.warn(error);
        this.finished = true;
        this.scene.start('Autobattler');
        return;
      }
      this.result = outcome.result;
      this.autobattler = outcome;
      this.manual = this.startManual = wantManual;
      this.rerun = (ctl) => {
        const next = run(ctl);
        this.autobattler = next;
        return next.result;
      };
      this.defs = Object.fromEntries([...outcome.squad, ...outcome.enemies].filter((u): u is UnitDef => !!u).map((u) => [u.id, u]));
      title = `Арена · раунд ${outcome.round} · ${outcome.cohort.name}`;
      this.theme = 'meadow';
    } else if (data.mode === 'bond') {
      // Личное задание (tavern-evenings.md «Что осталось» п. 2): бой ядра с ульта вручную, как в кампании.
      const save = session.save;
      const templateId = data.templateId;
      const view = bondView(save, templateId, GAME);
      const seed = stageSeed(save);
      const run = (ctl: PlayerControl) => fightBondQuest(save, templateId, seed, { ...GAME, combat: { ...(GAME.combat ?? COMBAT), player: ctl } });
      let outcome: BondQuestOutcome;
      try {
        if (!view) throw new Error(`Нет задания героя ${templateId}`);
        outcome = run({ manualUlt: wantManual, inputs: [] });
      } catch (e) {
        console.warn(e);
        this.finished = true;
        startTavernEvening(this, { mode: 'hub', back: data.back });
        return;
      }
      this.result = outcome.result;
      this.bond = { templateId, outcome, back: data.back };
      this.manual = this.startManual = wantManual;
      this.rerun = (ctl) => {
        const o = run(ctl);
        this.bond = { templateId, outcome: o, back: data.back };
        return o.result;
      };
      this.defs = squadDefs(save);
      for (const u of enemySquad(view.quest.stage, GAME)) if (u) this.defs[u.id] = u;
      title = `Задание · ${view.quest.title}`;
      this.theme = themeOfBattle({ stageId: view.quest.stage });
    } else {
      const seed = data.seed;
      const run = (ctl: PlayerControl) => simulateBattle(CONTENT, squads.A, squads.B, seed, { manualUlt: ctl.manualUlt, inputs: ctl.inputs });
      this.result = run({ manualUlt: wantManual, inputs: [] });
      this.manual = this.startManual = wantManual;
      this.rerun = run;
      this.stage = undefined;
      this.defs = CONTENT.units;
    }

    // Свита фаз босса (появится посреди боя): описание — юнит data/units (статы в бою свои, виду они не нужны).
    for (const s of this.result.spawned ?? []) if (!this.defs[s.unitId]) this.defs[s.unitId] = CONTENT.units[s.unitId];
    // U: листы только этого боя — грузятся по требованию (уже в кэше — строим сразу, в этом же кадре).
    const sprites = [...this.result.units, ...(this.result.spawned ?? [])].map((u) => this.defs[u.unitId].visual.sprite);
    // Анимированные эффекты грузятся лениво (T4-12) и только нужные этому бою (навыки его юнитов, battleFxIds): бой ждёт
    // их вместе с листами юнитов (не дольше FX_WAIT_MS), иначе первые удары шли статичными картинками.
    const unitDefs = [...this.result.units, ...(this.result.spawned ?? [])].map((u) => this.defs[u.unitId]);
    const fxIds = battleFxIds(
      unitDefs.flatMap((d) => [d.skills.basic, d.skills.ult, ...d.skills.actives, ...d.skills.passives, d.charge?.skill]),
      unitDefs.flatMap((d) => [d.visual.hitFx, d.visual.projectile]),
      GAME.content.skills,
    );
    void holdAnimatedFx(this, fxIds);
    const since = Date.now();
    const seq = ++this.createSeq;
    const fxReady = (done: () => void) => {
      if (seq !== this.createSeq) return;
      if (fxIds.every((id) => this.textures.exists(animatedFxKey(id))) || Date.now() - since > FX_WAIT_MS) done();
      else setTimeout(() => fxReady(done), 50);
    };
    whenSprites(this, sprites, () => fxReady(() => this.build(title)));
  }

  private build(title: string): void {
    this.ready = true;
    // Раскладка по видимой области: полоса — к верху безопасной области, медальоны — к низу, поле — между ними.
    this.hudY = HUD_Y - topBand();
    this.bossBarY = this.hudY + BOSS_BAR_DY;
    this.panelShift = navShift();
    this.dy = Math.max(0, SPREAD_BOUNDS.maxY + UNDER_FEET - (PANEL_TOP + this.panelShift));
    this.presentationBounds = {
      minX: TOP_MARGIN,
      maxX: GAME_W - TOP_MARGIN,
      minY: Math.max(this.hudY + 130, this.bossBarY + 150),
      maxY: PANEL_TOP + this.panelShift - UNDER_FEET,
    };
    this.bossPips = [];
    this.bossCharge = null;
    // Фон по главе/ярусу (луг, топь, склеп) и частицы под юнитами (светлячки, туман, пыль).
    addThemeBackground(this, 'battle', this.theme);
    this.ambient = new Ambient(this, this.theme);
    this.topBar(title);
    if (this.towerRun) this.towerCards();
    // Обучение (hints.ts): скорость ×2 открылась (этап 1-2) — указатель на кнопку скорости в первом бою на 1x.
    if (this.stage && this.speedBtn && playback.speed === 1 && isUnlocked('speed_x2') && !hintDone('battle_speed')) {
      const c = this.speedBtn.container;
      this.speedHint = tutorialHint(this, 'battle_speed', c.x, c.y, 'below', { w: SPEED_W, h: TOP_BTN_H });
    }
    // Вся анимация (твины, задержки) идёт в темпе выбранной скорости.
    this.tweens.timeScale = playback.speed;
    this.time.timeScale = playback.speed;

    this.ult = new UltPresenter(this);
    this.floats = new FloatLayer(this);
    this.sfx = new SkillFx(this);
    this.sfx.setSpeed(playback.speed);
    // Реплики боссов — не выше полоски босса (и верхней полосы).
    this.barks = new BarkLayer(this, this.bossBarY + 40);
    this.barked.clear();
    this.behaviorFx = new BehaviorFx(this);
    this.tauntIds.clear();
    this.statusVersions.clear();
    this.activeStatuses.clear();
    this.redirectShown.clear();
    for (const u of this.result.units) {
      const def = this.defs[u.unitId];
      const s = u.side === 'A' && def ? ultSkillOf(def, CONTENT.skills, COMBAT) : null;
      if (s) this.ultSkill.set(u.uid, s);
    }
    for (const u of this.result.units) this.buildUnit(u);
    this.layoutUnits(0);
    const fromSave = !!(this.stage || this.towerRun || this.hunt || this.bond);
    const rarityOf = (unitId: string): CardRarity | undefined => (fromSave ? session.save.heroes.find((h) => h.id === unitId)?.rarity : undefined);
    this.heroPanel = new HeroPanel(
      this,
      this.result.units
        .filter((u) => u.side === 'A')
        .sort((a, b) => a.slot - b.slot)
        .map((u) => {
          const def = this.defs[u.unitId];
          return {
            uid: u.uid,
            name: def?.name ?? u.unitId,
            sprite: def?.visual.sprite ?? u.unitId,
            hasUlt: !!def?.skills.ult,
            ult: this.ultSkill.has(u.uid),
            breaks: ultBreaksCharge(this.ultSkill.get(u.uid)?.id),
            rarity: rarityOf(u.unitId),
          };
        }),
      // RR-05: панель — интерфейс, выше фигур поля (их глубина — y ног); затемнение ульты (2900) и эффекты — выше панели.
      PANEL_DEPTH,
      (uid) => this.tapUlt(uid),
      this.panelShift,
    );
    for (const v of this.viewList) this.redraw(v);
    if (this.stage && getStage(GAME, this.stage.stageId).boss) this.bossIntro();
    if (this.hunt) {
      const boss = this.result.units.find((u) => u.side === 'B')!;
      this.hunt.hud = huntHud(this, boss.uid, boss.maxHp, this.hunt.outcome.boss.rank);
      this.bossIntro(this.hunt.outcome.boss.rank !== undefined ? 'MVP появился!' : 'Босс охоты');
    }
    // Реплика босса на старте — когда ушёл баннер (или сразу, если баннера нет: этаж Башни).
    const startBark = () => {
      for (const v of this.viewList) this.bossBark(v, 'start');
    };
    if (this.introLeft > 0) this.later.after(this.introLeft + BOSS_OUT_MS, startBark);
    else this.later.after(500, startBark);
  }

  /**
   * Верхняя полоса (итерация 5, §5 «Бой»): слева — обратный отсчёт и мелко название этапа, справа — значки звука,
   * скорости и «Авто» и «Пропустить» без плитки. Подписи «1x»/«2x», «Авто», «Пропустить» — e2e жмёт по тексту.
   */
  private topBar(title: string): void {
    const y = this.hudY;
    // Верх экрана темнеет к полосе: цифры и значки читаются на любом фоне (небо, листва, палуба).
    shadeBand(this, y - 110, y + 130, PANEL_DEPTH - 1, true);
    this.add.rectangle(GAME_W / 2, y - 110, GAME_W + 2 * BLEED_X, 2 * BLEED_Y, 0x0a0907, 0.85).setOrigin(0.5, 1).setDepth(PANEL_DEPTH - 1);
    this.timeText = text(this, TOP_MARGIN, y - 18, '', T.heading, COLOR.textPrimary, { fontStyle: 'bold', stroke: '#000000a0', strokeThickness: 3 }).setOrigin(0, 0.5);
    this.timeText.setDepth(PANEL_DEPTH);
    // Таймер виден сразу, и во время баннера босса (T2-13).
    this.showTime(0);
    const xSkip = GAME_W - TOP_MARGIN - SKIP_W / 2;
    const xAuto = xSkip - SKIP_W / 2 - TOP_GAP - AUTO_W / 2;
    const xSpeed = (this.rerun ? xAuto - AUTO_W / 2 : xSkip - SKIP_W / 2) - TOP_GAP - SPEED_W / 2;
    const xSound = xSpeed - SPEED_W / 2 - TOP_GAP - TOP_BTN_H / 2;
    const name = text(this, TOP_MARGIN, y + 26, title, T.caption, COLOR.textSecondary, { stroke: '#000000a0', strokeThickness: 3 }).setOrigin(0, 0.5).setDepth(PANEL_DEPTH);
    ellipsize(name, xSound - TOP_BTN_H / 2 - TOP_GAP - TOP_MARGIN);
    if (DEBUG) text(this, TOP_MARGIN, y + 60, `seed ${this.result.seed}`, 22, '#e0cfb0').setOrigin(0, 0.5).setDepth(PANEL_DEPTH);

    const speedBtn = button(this, xSpeed, y, SPEED_W, TOP_BTN_H, '', `${playback.speed}x`, () => {
      // Выбор скорости запоминается (localStorage) и действует в следующих боях.
      setPlaybackSpeed(nextPlaybackSpeed());
      if (playback.speed > 1) {
        markHint('battle_speed');
        this.speedHint?.destroy();
        this.speedHint = null;
      }
      speedBtn.setLabel(`${playback.speed}x`);
      this.paintSpeed();
      for (const v of this.views.values()) v.sprite.anims.timeScale = playback.speed;
      this.sfx.setSpeed(playback.speed);
      this.tweens.timeScale = playback.speed;
      this.time.timeScale = playback.speed;
    }, T.body, { variant: 'icon', repeat: true });
    this.speedBtn = speedBtn;
    this.paintSpeed();
    speedBtn.container.setDepth(PANEL_DEPTH).setName('speedBtn');
    const skip = button(this, xSkip, y, SKIP_W, TOP_BTN_H, '', 'Пропустить', () => this.skip(), T.body, { variant: 'ghost' });
    skip.container.setDepth(PANEL_DEPTH).setName('skipBtn');
    // Ульты сами / касанием (docs/design/battle-decisions.md §1): «Авто» горит золотом, выключено — тусклое.
    if (this.rerun) {
      this.modeBtn = button(this, xAuto, y, AUTO_W, TOP_BTN_H, '', 'Авто', () => this.toggleAuto(), T.caption, { variant: 'icon', repeat: true });
      this.modeBtn.container.setName('ultModeBtn').setDepth(PANEL_DEPTH);
      this.paintMode();
    }
    this.battleSoundButton(xSound, y);
  }

  /** Скорость выше 1x — подпись золотом (включённый режим), 1x — обычная. */
  private paintSpeed(): void {
    this.speedBtn?.label.setColor(playback.speed > 1 ? COLOR.gold : COLOR.textPrimary);
  }

  /** «Авто» включено — золотая подпись и плитка; выключено (ульты касанием) — тусклые. */
  private paintMode(): void {
    const b = this.modeBtn;
    if (!b) return;
    b.label.setColor(this.manual ? COLOR.textTertiary : COLOR.gold);
    (b.container.list[0] as Phaser.GameObjects.NineSlice).setAlpha(this.manual ? 0.55 : 1);
  }

  /**
   * Значок динамика в верхней полосе: звуки боя вкл/выкл — та же настройка, что строка «Звуки боя» в Настройках
   * (audioSettings.battleSfx, запоминается). Музыку боя и интерфейс не трогает. Состояние видно по значку — без тоста.
   */
  private battleSoundButton(x: number, y: number): void {
    const icon = this.add.graphics();
    const draw = () => {
      const on = audioSettings.battleSfx;
      icon.clear();
      icon.fillStyle(COLOR_N.textPrimary, on ? 1 : 0.6);
      // Динамик: корпус и раструб.
      icon.fillRect(-26, -9, 12, 18);
      icon.fillTriangle(-14, -9, 3, -23, 3, 23);
      icon.fillTriangle(-14, -9, -14, 9, 3, 23);
      icon.lineStyle(5, on ? COLOR_N.textPrimary : COLOR_N.negative, 1);
      if (on) {
        icon.beginPath();
        icon.arc(6, 0, 11, -0.9, 0.9);
        icon.strokePath();
        icon.beginPath();
        icon.arc(6, 0, 21, -0.9, 0.9);
        icon.strokePath();
      } else {
        icon.lineBetween(11, -11, 29, 11);
        icon.lineBetween(11, 11, 29, -11);
      }
    };
    const btn = button(this, x, y, TOP_BTN_H, TOP_BTN_H, '', '', () => {
      setAudioSettings({ battleSfx: !audioSettings.battleSfx });
      draw();
    }, undefined, { repeat: true, variant: 'icon' });
    btn.container.add(icon);
    btn.container.setName('battleSound').setDepth(PANEL_DEPTH);
    draw();
  }

  /**
   * Босс-этап: крупный баннер «имя босса · Босс главы» (скин «тёмная бронза», золото) на ~1.5 с, затем угасает;
   * наверху — полоска HP босса. Баннер без интерактива: кнопки («Пропустить», скорость) работают сквозь показ.
   */
  private bossIntro(subtitle = 'Босс главы'): void {
    const boss = this.result.units.find((u) => u.side === 'B' && this.defs[u.unitId]?.kind === 'boss');
    if (!boss) return;
    const name = this.defs[boss.unitId].name;
    // BUG-192: у MVP — уровень охоты («уровень 9»), у босса Башни уровня нет (статы этажа не по шкале героев).
    const huntRank = this.hunt?.outcome.boss.rank;
    const level = this.enemyLevel(this.defs[boss.unitId]);
    const levelLabel = (lv: number) => (huntRank !== undefined ? `уровень ${huntRank + 1}` : levelLabelOf(lv));

    // Полоска босса под верхней полосой: имя и уровень над ней, засечки фаз — ромбами на ней, заряд — под ней.
    const y = this.bossBarY;
    const barX = GAME_W / 2 - BOSS_BAR_W / 2;
    const parts: Phaser.GameObjects.GameObject[] = [];
    parts.push(this.add.rectangle(GAME_W / 2, y, BOSS_BAR_W + 8, BOSS_BAR_H + 8, 0x000000, 0.7).setStrokeStyle(2, COLOR_N.border, 1));
    const fill = this.add.image(barX, y, 'ui_bar_hp_enemy').setOrigin(0, 0.5).setDisplaySize(BOSS_BAR_W, BOSS_BAR_H);
    parts.push(fill);
    const nameText = text(this, GAME_W / 2, y - BOSS_BAR_H / 2 - 30, name, T.caption, COLOR.title, { fontStyle: 'bold', stroke: '#000000a0', strokeThickness: 3 });
    parts.push(nameText);
    if (level !== null || huntRank !== undefined) {
      const lv = text(this, 0, nameText.y, levelLabel(level ?? 0), T.caption, level !== null && huntRank === undefined ? enemyLevelColor(level, session.save) : COLOR.textSecondary, { fontStyle: 'bold', stroke: '#000000a0', strokeThickness: 3 }).setOrigin(0, 0.5);
      const gap = 16;
      const total = nameText.width + gap + lv.width;
      nameText.setX(GAME_W / 2 - total / 2 + nameText.width / 2);
      lv.setX(GAME_W / 2 - total / 2 + nameText.width + gap);
      parts.push(lv);
    }
    this.bossBar = { uid: boss.uid, fill };
    // Засечки фаз (50%, 25%…) видны с начала боя: игрок знает, когда босс сменит поведение; пройденная — гаснет.
    for (const p of this.defs[boss.unitId].phases ?? []) {
      if (p.atHpPct === undefined) continue;
      const pip = this.add.rectangle(barX + BOSS_BAR_W * p.atHpPct, y, 18, 18, COLOR_N.gold).setAngle(45).setStrokeStyle(3, 0x1a0f04, 1);
      this.bossPips.push({ pct: p.atHpPct, pip });
      parts.push(pip);
    }
    // Заряд босса: молния и красная полоса под полоской HP (вместо абзаца-подсказки).
    const cy = y + BOSS_BAR_H / 2 + 26;
    const cw = BOSS_CHARGE_W;
    const chBack = this.add.rectangle(GAME_W / 2 + 22, cy, cw + 6, 14, 0x000000, 0.7);
    const chFill = this.add.rectangle(GAME_W / 2 + 22 - cw / 2, cy, 0, 8, 0xff4a2a).setOrigin(0, 0.5);
    const chBolt = chargeBreakBadge(this, GAME_W / 2 + 22 - cw / 2 - 30, cy, 40);
    const chNode = this.add.container(0, 0, [chBack, chFill, chBolt]).setVisible(false).setName('bossCharge');
    this.bossCharge = { node: chNode, fill: chFill };
    parts.push(chNode);
    for (const o of parts) (o as Phaser.GameObjects.Components.Depth & Phaser.GameObjects.GameObject).setDepth(PANEL_DEPTH);
    const v = this.views.get(boss.uid);
    if (v) this.redraw(v);

    const w = 960;
    const h = 300;
    const band = this.add.rectangle(0, 0, GAME_W, h + 80, 0x000000, 0.55);
    const bg = this.textures.exists('skin_btn_active')
      ? panel(this, 0, 0, w, h, 'skin_btn_active')
      : this.add.rectangle(0, 0, w, h, 0x1d1914, 0.95).setStrokeStyle(6, SKIN_TINT.gold);
    const inner = this.add.rectangle(0, 0, w - 36, h - 36).setStrokeStyle(2, SKIN_TINT.gold, 0.5);
    const title = text(this, 0, -34, name.toUpperCase(), 104, SKIN.goldLight, { fontStyle: 'bold', stroke: '#2a1a08', strokeThickness: 12 });
    if (title.width > w - 80) title.setScale((w - 80) / title.width);
    const sub = text(this, 0, 82, level !== null || huntRank !== undefined ? `${subtitle} · ${levelLabel(level ?? 0)}` : subtitle, 44, SKIN.cream, { stroke: '#000000', strokeThickness: 6 });
    // Уровень босса — цветом против среднего уровня отряда (красный — выше больше чем на 5).
    if (level !== null) sub.setColor(enemyLevelColor(level, session.save));
    const lineW = 150;
    const gap = sub.width / 2 + 30;
    const lines = [-1, 1].map((d) => this.add.rectangle(d * (gap + lineW / 2), 82, lineW, 4, SKIN_TINT.gold));
    const node = this.add
      .container(GAME_W / 2, BOSS_BANNER_Y, [band, bg, inner, title, sub, ...lines])
      .setDepth(DEPTH.banner + 10)
      .setAlpha(0)
      .setScale(1.15)
      .setName('bossBanner');
    this.introLeft = BOSS_IN_MS + BOSS_HOLD_MS;
    this.cameras.main.shake(260, 0.004);
    this.tweens.chain({
      targets: node,
      tweens: [
        { alpha: 1, scale: 1, duration: BOSS_IN_MS, ease: 'Back.easeOut' },
        { alpha: 1, duration: BOSS_HOLD_MS },
        { alpha: 0, duration: BOSS_OUT_MS, ease: 'Quad.easeIn' },
      ],
      onComplete: () => node.destroy(),
    });
  }

  private buildUnit(snap: UnitSnapshot): void {
    const def = this.defs[snap.unitId];
    const spriteId = def.visual.sprite;
    // visual.scale — крупнее фигура (и выше подпись/полоски): босс на листе обычного монстра.
    const base = spriteView(this, spriteId);
    const requested = crispScale(base, def.visual.scale ?? 1);
    const presentation = base.art && base.def
      ? battleSpritePresentation(base.def, base.def.scale * requested, this.presentationBounds)
      : { scale: requested, animated: { left: -90 * requested, top: -base.height * requested, right: 90 * requested, bottom: 0 }, body: { left: -90 * requested, top: -base.height * requested, right: 90 * requested, bottom: 0 }, large: false };
    const k = base.art && base.def ? presentation.scale / base.def.scale : requested;
    const look = k === 1 ? base : { ...base, size: base.size * k, height: base.height * k };
    // Отражение идёт от середины клетки, а якорь ног не в середине: у отражённого — зеркальный origin, иначе фигура
    // уезжает от своих полосок (у поринга ×2 — заметно).
    const flip = snap.side === 'B' && look.art;
    const sprite = this.add.sprite(0, 0, look.key, 0).setOrigin(flip ? 1 - look.originX : look.originX, look.originY);
    sprite.setScale(look.size / sprite.frame.realHeight).setFlipX(flip).setTint(unitTint(def.visual));
    presentation.scale = sprite.scaleX;
    sprite.anims.timeScale = playback.speed;
    // Мягкая тень под ногами: у листов RO своей тени нет, без неё фигуры «висят» над полем.
    const footW = look.def?.width ? look.def.width * look.def.scale * k : look.height * 0.7;
    // Центр чуть выше точки ног: полоска HP (y +4…+24) закрывает низ эллипса, вокруг ступней тень видна.
    const shW = Phaser.Math.Clamp(footW * 1.1, 120, 360);
    const shadow = this.add.image(0, -6, SHADOW_TEX).setDisplaySize(shW, Math.min(56, shW * 0.3));

    const ox = snap.side === 'A' ? -UI_SHIFT : UI_SHIFT;
    const bar = (y: number, texId: string, h: number) => this.add.image(ox - BAR_W / 2, y, texId).setOrigin(0, 0.5).setDisplaySize(BAR_W, h);
    const hpTex = snap.side === 'A' ? 'ui_bar_hp_ally' : 'ui_bar_hp_enemy';
    // Итерация 5: полоски тоньше (HP 10, энергия 5), цвет — по стороне (свои зелёные, враги красные).
    const barBack = this.add.image(ox, HP_BAR_Y, 'ui_bar_back').setDisplaySize(BAR_W + 4, HP_BAR_H + 4);
    const trailBar = bar(HP_BAR_Y, hpTex, HP_BAR_H).setTintFill(0xffffff);
    const hpBar = bar(HP_BAR_Y, hpTex, HP_BAR_H);
    const shieldBar = bar(HP_BAR_Y - HP_BAR_H / 2 + 1, 'ui_bar_shield', 4).setVisible(false);
    const energyBack = this.add.image(ox, EN_BAR_Y, 'ui_bar_back').setDisplaySize(BAR_W + 4, 9);
    const energyBar = bar(EN_BAR_Y, 'ui_bar_energy', 5);
    // Энергия над фигурой — только у врагов с ультой (монстры, боссы); готовность ульт героев — кольцом на медальоне внизу.
    const hasUlt = !!def.skills.ult && snap.side === 'B';
    energyBack.setVisible(hasUlt);
    energyBar.setVisible(hasUlt);
    // Подпись — сразу над макушкой (высота фигуры в стойке из bbox листа), со сдвигом к своему тылу.
    const nameY = -look.height - 22;
    // Полоса каста — на месте имени (имя на время каста прячется).
    const castW = BAR_W + 20;
    const castX = (CAST_ICON + 10) / 2;
    const castBack = this.add.image(castX, 0, 'ui_bar_back').setDisplaySize(castW + 6, 22).setVisible(false);
    const castBar = this.add.image(castX - castW / 2, 0, 'ui_bar_energy').setOrigin(0, 0.5).setDisplaySize(castW, 16).setVisible(false);
    // Итерация 5: у полосы каста — значок навыка, не название («Метеоритный дождь» над головой — лишний текст).
    const castIcon = this.add.image(castX - castW / 2 - 22, 0, '__DEFAULT').setDisplaySize(CAST_ICON, CAST_ICON).setVisible(false);
    // NB-19: имя — под своими полосками (у ног), а не над макушкой: над головой заднего ряда висят полоски соседа
    // сверху, и подпись читалась как чужая.
    // У героев под полоской — значки перезарядки навыков: имя ниже них.
    const cdRow = snap.side === 'A' && def.skills.actives.length > 0 ? CD_ICON + 2 : 0;
    const belowBars = hasUlt ? EN_BAR_Y + 5 : HP_BAR_Y + HP_BAR_H / 2 + 2;
    const nameUnder = belowBars + 4 + cdRow + NAME_SIZE / 2;
    const name = text(this, 0, 0, def.name, NAME_SIZE, COLOR.textPrimary, { fontStyle: 'bold', stroke: COLOR.bg, strokeThickness: 3 });
    const namePlate = this.add.rectangle(0, 0, name.width + 16, name.height + 8, COLOR_N.surfaceSunken, 0.94);
    const labelLeader = this.add.rectangle(0, 0, 1, 2, snap.side === 'A' ? COLOR_N.positive : COLOR_N.negative, 0.85).setOrigin(0, 0.5);
    const labels = this.add.container(0, 0, [labelLeader, namePlate, name, castBack, castBar, castIcon]).setDepth(UNIT_LABEL_DEPTH).setVisible(false).setName(`unitLabels_${snap.uid}`);
    // §5 «Бой»: имена своих не пишем (их видно по медальонам внизу), касание фигуры — показать на миг.
    if (snap.side === 'A') name.setAlpha(0);
    const bars: Phaser.GameObjects.Components.Visible[] = [barBack, trailBar, hpBar, shieldBar, ...(hasUlt ? [energyBack, energyBar] : []), name];
    const parts: Phaser.GameObjects.GameObject[] = [shadow, sprite, barBack, trailBar, hpBar, shieldBar, energyBack, energyBar];
    // Уровни рядовых врагов не пишем: на шкале отряда слабые упирались в «ур. 1» рядом с «ур. 16» — путало.
    // Уровень босса — в его полоске наверху (bossIntro).
    // Стихия (docs/design/battle-decisions.md §3): у врага — защита, у героя — атака; нейтраль без значка.
    const el = snap.side === 'B' ? defenseElement(def) : attackElement(def, CONTENT.skills);
    if (el !== 'neutral') {
      const badge = elementBadge(this, ox + BAR_W / 2 + 18, HP_BAR_Y, el, 26);
      bars.push(badge);
      parts.push(badge);
    }
    // Перезарядка активных навыков героев (как в AFK Arena): значки с круговой «шторкой» под полоской HP.
    const cdIcons: CdIcon[] = [];
    const cdSkills: CdSkill[] = [];
    if (snap.side === 'A') {
      const known = def.skills.actives.map((id) => CONTENT.skills[id]).filter((sk): sk is SkillDef => !!sk);
      orderActives(known).forEach((skill, order) => {
        skillIcon(this, skill); // текстура значка — заранее, смена навыка в месте потом без рисования
        cdSkills.push({ skill, readyAt: 0, cd: 0, order });
      });
      // Сразу под полоской HP (или энергии) с зазором 4 — в ряд от левого края полоски.
      const cy = belowBars + 4 + CD_ICON / 2;
      for (let i = 0; i < Math.min(CD_SLOTS, cdSkills.length); i++) {
        const x = ox - BAR_W / 2 + CD_ICON / 2 + i * (CD_ICON + CD_GAP);
        const icon = this.add.image(x, cy, '__DEFAULT').setDisplaySize(CD_ICON, CD_ICON);
        const sweep = this.add.image(x, cy, cooldownSheet(this), CD_FRAME_EMPTY).setDisplaySize(CD_CELL, CD_CELL);
        cdIcons.push({ icon, sweep, x, y: cy, s: null, shown: -1 });
        bars.push(icon, sweep);
        parts.push(icon, sweep);
      }
    }
    const node = this.add.container(fieldX(snap.x), snap.y - this.dy, parts).setDepth(snap.y - this.dy);

    const v: UnitView = {
      snap,
      def,
      spriteId,
      look,
      node,
      sprite,
      presentation,
      displayX: fieldX(snap.x),
      displayY: snap.y - this.dy,
      shadow,
      hpBar,
      trailBar,
      trail: 1,
      trailFrom: 1,
      trailTo: 1,
      trailT: -1,
      tintLeft: 0,
      nameY,
      inUlt: false,
      shieldBar,
      energyBar,
      castBar,
      castBack,
      cast: null,
      castIcon,
      charging: false,
      nameText: name,
      labels,
      namePlate,
      labelLeader,
      nameUnder,
      hitPlan: new Map(),
      statusIcons: new Map(),
      // Над подложкой полоски HP (её верх — y 4) с зазором 2.
      statusY: HP_BAR_Y - HP_BAR_H / 2 - 2 - 2 - STATUS_ICON / 2,
      statusX0: ox - BAR_W / 2 + STATUS_ICON / 2,
      cdSkills,
      cdIcons,
      flashFill: false,
      lastFlash: -Infinity,
      bars,
      hp: snap.hp ?? snap.maxHp,
      shield: 0,
      energy: 0,
      energyT: 0,
      alive: true,
      shownDead: false,
      pending: 0,
      moveDest: null,
      labelX: ox,
      impactAt: 0,
      busyUntil: 0,
      lastHurt: -Infinity,
      moveTween: null,
      ...hitLook(def),
      stunned: false,
      frozen: false,
      starT: 0,
      lastTrail: 0,
      spot: false,
      moveKind: null,
      lastX: fieldX(snap.x),
      lastY: snap.y - this.dy,
      vx: 0,
      vy: 0,
      walking: false,
      faceDir: snap.side === 'A' ? 1 : -1,
      lookAt: null,
      backpedal: false,
      kiteShown: false,
      hitRect: new Phaser.Geom.Rectangle(0, 0, 0, 0),
      loopKeys: { idle: anim(look, spriteId, 'idle'), walk: anim(look, spriteId, 'walk'), cast: anim(look, spriteId, 'cast') },
      pos: { x: snap.x, y: snap.y },
      offX: 0,
      offY: 0,
      sx: snap.x,
      sy: snap.y,
      side: snap.side,
      extra: def.kind === 'boss' ? 60 : 0,
      active: true,
    };
    this.views.set(snap.uid, v);
    this.viewList.push(v);
    this.assignCooldowns(v);
    // Разовая анимация закончилась — вернуться к стойке/ходьбе. Один слушатель на юнита, а не на каждую атаку.
    sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (v.alive) this.loop(v, this.stance(v));
    });
    this.loop(v, 'idle');
    this.redraw(v);
    // Касание юнита — ненадолго показать имя (после начала боя имена гаснут).
    // Зона касания — только тело (кадр листа намного больше фигуры и заходил бы на кнопки и соседей).
    this.bodyHitArea(v);
    sprite.setInteractive(v.hitRect, Phaser.Geom.Rectangle.Contains).on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.flashName(v));
  }

  /** Уровень врага в этом бою (null — тестовый бой). */
  private enemyLevel(def: UnitDef): number | null {
    // BUG-192: в Башне и на охоте статы врагов не по шкале уровней героев («ур. 267», «ур. 300») — уровень не пишем.
    if (this.towerRun || this.hunt) return null;
    return this.levels ? Math.max(1, unitLevel(def, this.levels.rarity, GAME, this.levels.bossFactor, this.levels.choices) + (this.levels.shift ?? 0)) : null;
  }

  private flashName(v: UnitView): void {
    if (!v.alive || !this.namesHidden) return;
    this.tweens.killTweensOf(v.nameText);
    v.nameText.setAlpha(1);
    this.tweens.add({ targets: v.nameText, alpha: 0, delay: NAME_TAP_MS, duration: NAME_FADE_MS });
  }

  /** Первые секунды боя имена видны, затем гаснут — поле не засоряется подписями. */
  private hideNames(): void {
    this.namesHidden = true;
    const names = [...this.views.values()].map((v) => v.nameText);
    this.tweens.add({ targets: names, alpha: 0, duration: NAME_FADE_MS });
  }

  update(_time: number, rawDelta: number): void {
    if (!this.ready) return;
    // U: после паузы/подвисания бой не «прыгает» вперёд — шаг не больше MAX_FRAME_MS.
    const delta = clampDelta(rawDelta);
    if (this.stopLeft > 0) {
      this.stopLeft -= delta;
      if (this.stopLeft <= 0) this.endHitStop();
      return;
    }
    this.ambient?.step(delta);
    // Лёгкие анимации (цифры, вспышки, снаряды, след HP, оттенок попадания) идут и после конца боя — до смены сцены.
    const dt = delta * this.tweens.timeScale;
    this.later.step(dt);
    this.floats.step(dt);
    this.barks.step(dt);
    this.sfx.step(dt);
    this.behaviorFx?.update(dt);
    const views = this.viewList;
    for (let i = 0; i < views.length; i++) this.animateUnit(views[i], dt);
    this.layoutUnits(dt);
    if (this.finished) return;
    // Баннер босса: часы боя стоят, пока он на экране («Пропустить» работает — skip не ждёт часов).
    if (this.introLeft > 0) {
      this.introLeft -= dt;
      return;
    }
    this.clock += (delta / 1000) * playback.speed;
    if (!this.namesHidden && this.clock >= NAME_SHOW_S) this.hideNames();
    // Лог берётся заново на каждом шаге: касание ульты посреди кадра подменяет бой (this.result) пересчитанным.
    while (this.cursor < this.result.log.length && this.result.log[this.cursor].t <= this.clock) {
      this.play(this.result.log[this.cursor], true);
      this.cursor++;
    }
    this.showTime(Math.min(this.clock, this.result.duration));
    if (this.heroPanel) for (const uid of this.ultSkill.keys()) this.heroPanel.setCharge(uid, this.ultCharge(uid));
    // Обе команды Арены: энергия от времени должна отображаться и между событиями лога.
    for (const v of views) {
      if (v.alive && v.def.skills.ult && v.def.energy?.perSecond) cropBar(v.energyBar, this.shownEnergy(v) / COMBAT.energy.max);
    }
  }

  // ---------- ульта вручную (docs/design/battle-decisions.md §1) ----------

  /** Энергия бойца сейчас: последняя из лога + рост от времени (герои: UnitDef.energy.perSecond) до часов показа. */
  private shownEnergy(v: UnitView): number {
    const rate = v.def.energy?.perSecond ?? 0;
    if (!rate || !v.alive) return v.energy;
    return Math.min(COMBAT.energy.max, v.energy + rate * Math.max(0, Math.min(this.clock, this.result.duration) - v.energyT));
  }

  /** Готовность ульты героя 0…1: энергия (ульта на энергии) или прошедшая доля перезарядки. */
  private ultCharge(uid: string): number {
    const v = this.views.get(uid);
    const s = this.ultSkill.get(uid);
    if (!v || !s || !v.alive) return 0;
    if (v.def.skills.ult === s.id) return this.shownEnergy(v) / COMBAT.energy.max;
    const used = this.ultUsedAt.get(uid);
    if (used === undefined) return 1;
    const cd = s.cooldown ?? COMBAT.skills?.defaultCooldown ?? 8;
    return cd > 0 ? Math.min(1, (this.clock - used) / cd) : 1;
  }

  /** Пересчитать бой с вводами (тот же seed): прошлое лога то же, показ продолжается с текущего места по новому логу. */
  private applyInputs(): void {
    if (!this.rerun) return;
    const res = this.rerun({ manualUlt: this.startManual, inputs: this.inputs });
    this.result = res;
    for (const s of res.spawned ?? []) if (!this.defs[s.unitId]) this.defs[s.unitId] = CONTENT.units[s.unitId];
    if (this.cursor > res.log.length) this.cursor = res.log.length;
  }

  /** Касание портрета: ульта героя (только вручную и когда светится). */
  private tapUlt(uid: string): void {
    if (!this.rerun || !this.manual || this.finished || this.skipping || !this.heroPanel?.isReady(uid)) return;
    this.inputs.push({ t: nextTick(this.clock, COMBAT.tickSeconds), uid });
    this.applyInputs();
    this.heroPanel.setReady(uid, false);
    this.heroPanel.pressed(uid);
    // Ульта запущена касанием — тяжёлый толчок (звук всплеска — по событию ult, battleAudio.ts).
    haptic('ultCast');
    this.tapped.add(uid);
    ultHint.mark();
    this.ultHintNode?.destroy();
    this.ultHintNode = null;
  }

  /** «Авто»: ульты сами / касанием; выбор запоминается. */
  private toggleAuto(): void {
    if (!this.rerun || this.finished || this.skipping) return;
    this.manual = !this.manual;
    setBattleAuto(!this.manual);
    this.inputs.push({ t: nextTick(this.clock, COMBAT.tickSeconds), auto: !this.manual });
    this.applyInputs();
    if (!this.manual) for (const uid of this.ultSkill.keys()) this.heroPanel?.setReady(uid, false);
    this.paintMode();
    // Режим виден по кнопке; объяснение — только пока игрок ни разу не применял ульту касанием.
    if (this.manual && !ultHint.done) toast(this, 'Ульты — касанием портрета', COLOR.title, 1800, 'battle');
  }

  /** Молния у полосы каста бойца: идёт заряд, его сбивает ульта с молнией (ultBadge.ts). */
  private castBolt(v: UnitView): Phaser.GameObjects.Image {
    const bolt = chargeBreakBadge(this, v.castBar.x - 22, v.castBar.y, 36);
    v.labels.add(bolt);
    return bolt;
  }

  /** Первая готовая ульта — подсказка под карточкой героя (пока игрок не коснётся ни разу). */
  private showUltHint(uid: string): void {
    if (this.ultHintNode || ultHint.done || this.skipping || !this.manual) return;
    const card = this.heroPanel?.cardAt(uid);
    if (!card) return;
    // BUG-191: две подсказки обучения разом не показываем — указатель «Скорость ×2» уступает ульте (вернётся в другом бою).
    this.speedHint?.destroy();
    this.speedHint = null;
    // Над медальоном (панель — у нижнего края), стрелкой вниз; один раз, пока игрок не коснётся.
    const t = text(this, card.x, card.y - card.h / 2 - 34, '▼ Коснитесь', T.caption, COLOR.gold, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 }).setDepth(PANEL_DEPTH + 1);
    if (t.x - t.width / 2 < TOP_MARGIN) t.setX(TOP_MARGIN + t.width / 2);
    if (t.x + t.width / 2 > GAME_W - TOP_MARGIN) t.setX(GAME_W - TOP_MARGIN - t.width / 2);
    decorTween(this, { targets: t, y: t.y - 10, duration: M.slow, yoyo: true, repeat: -1, ease: E.inOut });
    this.ultHintNode = t;
    this.later.after(9000, () => {
      if (this.ultHintNode === t) {
        t.destroy();
        this.ultHintNode = null;
      }
    });
  }

  private showTime(s: number): void {
    const sec = Math.floor(s);
    if (sec === this.shownSec) return;
    this.shownSec = sec;
    // Обратный отсчёт (как в AFK Arena): последние 15 с — красным.
    const left = Math.max(0, (this.hunt ? GAME.hunt.timeLimitSeconds : COMBAT.timeLimitSeconds) - sec);
    this.timeText.setText(fmt(left));
    const color = left <= 15 ? COLOR.negative : COLOR.textPrimary;
    if (this.timeText.style.color !== color) this.timeText.setColor(color);
  }

  /**
   * Показанные позиции: позиция ядра + сглаженное смещение, чтобы близкие бойцы не сливались в кучу;
   * глубина фигур — по y; полоски/статусы едут с ними, видимые подписи разводятся отдельным слоем.
   */
  private layoutUnits(dt: number): void {
    const views = this.viewList;
    spreadUnits(views, dt, SPREAD_BOUNDS);
    this.projectUnits();
    for (let i = 0; i < views.length; i++) this.placeUnit(views[i]);
    if (dt > 0) for (let i = 0; i < views.length; i++) this.gait(views[i], dt);
    this.layoutLabels();
  }

  /** Имена и касты не заслоняются фигурами и друг другом. Короткая линия сохраняет связь с бойцом. */
  private layoutLabels(): void {
    const queue = this.labelViews;
    const occupied = this.labelRects;
    queue.length = 0;
    occupied.length = 0;
    for (const v of this.viewList) {
      const cast = !!v.cast && v.castBack.visible;
      const name = v.nameText.visible && v.nameText.alpha > 0.01;
      v.labels.setVisible(v.alive && !v.shownDead && (cast || name)).setAlpha(v.node.alpha);
      v.namePlate.setVisible(!cast && name).setAlpha(v.nameText.alpha);
      if (v.labels.visible) queue.push(v);
    }
    // Заряд, затем обычный каст, затем имя: важная подготовка удара занимает ближайшее к юниту место.
    queue.sort((a, b) => Number(b.charging) * 2 + Number(!!b.cast) - Number(a.charging) * 2 - Number(!!a.cast));
    const top = Math.max(this.hudY + 130, this.bossBarY + 150);
    const bottom = PANEL_TOP + this.panelShift - UNIT_LABEL_GAP;
    for (const v of queue) {
      const cast = !!v.cast && v.castBack.visible;
      const w = cast ? BAR_W + 20 + CAST_ICON + 30 : v.namePlate.width;
      const h = cast ? CAST_ICON + 12 : v.namePlate.height;
      const x = clampX(v.node.x + v.labelX, w + UNIT_LABEL_GAP * 2);
      const preferred = Phaser.Math.Clamp(v.node.y + (cast ? v.nameY + 4 : v.nameUnder) * v.node.scaleY, top + h / 2, bottom - h / 2);
      let y = preferred;
      const free = (cy: number) => cy - h / 2 >= top && cy + h / 2 <= bottom && occupied.every((r) =>
        Math.abs(x - r.x) >= (w + r.w) / 2 + UNIT_LABEL_GAP || Math.abs(cy - r.y) >= (h + r.h) / 2 + UNIT_LABEL_GAP);
      if (!free(y)) {
        for (let step = 1; step <= this.viewList.length * 2; step++) {
          const offset = Math.ceil(step / 2) * (h + UNIT_LABEL_GAP) * (step % 2 ? -1 : 1);
          if (free(preferred + offset)) { y = preferred + offset; break; }
        }
      }
      v.labels.setPosition(x, y);
      occupied.push({ x, y, w, h });
      // Линия идёт к стопам имени или к макушке каста; обе её точки остаются вне верхнего/нижнего HUD.
      const ax = v.node.x;
      const ay = Phaser.Math.Clamp(v.node.y + (cast ? -v.look.height * v.node.scaleY : HP_BAR_Y), top, bottom);
      const ex = Phaser.Math.Clamp(ax, x - w / 2, x + w / 2);
      const ey = Phaser.Math.Clamp(ay, y - h / 2, y + h / 2);
      const dx = ex - ax;
      const dy = ey - ay;
      v.labelLeader.setPosition(ax - x, ay - y).setDisplaySize(Math.hypot(dx, dy), 2).setRotation(Math.atan2(dy, dx)).setAlpha(cast ? 1 : v.nameText.alpha);
    }
  }

  /**
   * Походка («лунная походка», T3): по скорости показанной фигуры, а не по флагу шага.
   * Ходьба — только пока юнит сам идёт (шаг ядра) и фигура правда движется; сдвиг разведением или шаг, который
   * разведение гасит, — стойка. Пока движется своим шагом или рывком — смотрит, куда идёт (отход назад — лицом
   * назад, а не спиной вперёд); стоит, бьёт или его сдвигают — лицом к цели/ближайшему врагу.
   */
  private gait(v: UnitView, dt: number): void {
    const dir = gaitStep(v, v.node.x, v.node.y, dt, v.alive ? v.moveKind : null);
    if (!v.alive || v.shownDead) return;
    if (dir === null || v.backpedal) this.faceFoe(v);
    else if (dir !== 0) this.face(v, dir);
    // Разовая анимация (удар, каст ульты, «получил урон») доигрывает; оглушённый/замороженный не шагает.
    if (this.time.now < v.busyUntil) return;
    this.loop(v, this.stance(v));
  }

  /** Стойка по состоянию: ходьба, каст или покой. */
  private stance(v: UnitView): 'walk' | 'cast' | 'idle' {
    return v.walking && !v.stunned ? 'walk' : v.cast ? 'cast' : 'idle';
  }

  /** Повернуться к цели последней атаки или к ближайшему живому врагу (по показанным позициям). */
  private faceFoe(v: UnitView): void {
    let foe = v.lookAt && v.lookAt.alive ? v.lookAt : null;
    if (!foe) {
      let best = Infinity;
      const views = this.viewList;
      for (let i = 0; i < views.length; i++) {
        const o = views[i];
        if (!o.alive || o.side === v.side) continue;
        const dx = o.node.x - v.node.x;
        const dy = o.node.y - v.node.y;
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          foe = o;
        }
      }
    }
    const dx = foe ? foe.node.x - v.node.x : 0;
    // Враг почти над/под юнитом — не вертеться туда-сюда; без врагов — к стороне противника.
    if (Math.abs(dx) > FACE_DEADZONE) this.face(v, dx > 0 ? 1 : -1);
    else if (!foe) this.face(v, v.side === 'A' ? 1 : -1);
  }

  /** Развернуть фигуру (лист нарисован лицом вправо). Отражается и origin — ноги остаются в точке юнита. */
  private face(v: UnitView, dir: 1 | -1): void {
    if (v.faceDir === dir) return;
    v.faceDir = dir;
    if (!v.look.art) return;
    const flip = dir < 0;
    v.sprite.setFlipX(flip).setOrigin(flip ? 1 - v.look.originX : v.look.originX, v.look.originY);
    this.bodyHitArea(v);
  }

  private bodyHitArea(v: UnitView): void {
    const s = v.sprite;
    const h = battleSpriteHitArea(v.presentation, s.frame.realWidth, s.frame.realHeight, s.originX, s.originY, s.flipX);
    v.hitRect.setTo(h.x, h.y, h.width, h.height);
  }

  private placeUnit(v: UnitView): void {
    v.node.setPosition(v.displayX, v.displayY);
    if (!v.shownDead && !v.spot) v.node.setDepth(v.node.y);
  }

  private projectUnits(): void {
    for (const v of this.viewList) if (v.active) {
      v.displayX = fieldX(v.pos.x + v.offX);
      v.displayY = v.pos.y + v.offY - this.dy;
    }
    separateBattleSprites(this.viewList, this.presentationBounds);
  }

  /** След HP и красный оттенок попадания (раньше — твин и таймер на каждый удар). */
  private animateUnit(v: UnitView, dt: number): void {
    if (v.cast) {
      const p = Phaser.Math.Clamp((this.clock - v.cast.start) / v.cast.dur, 0, 1);
      cropBar(v.castBar, p);
      v.castRig?.step(dt, p);
      if (v.charging && this.bossCharge && this.bossBar?.uid === v.snap.uid) this.bossCharge.fill.width = BOSS_CHARGE_W * p;
    }
    for (const c of v.cdIcons) this.drawCooldown(c);
    if (v.tintLeft > 0) {
      v.tintLeft -= dt;
      if (v.flashFill && v.tintLeft <= HURT_TINT_MS) {
        v.flashFill = false;
        if (v.tintLeft > 0) v.sprite.setTint(0xff8080);
      }
      if (v.tintLeft <= 0) {
        v.tintLeft = 0;
        v.sprite.setTint(baseTint(v));
      }
    }
    if (v.stunned && v.stunStars) this.spinStars(v, dt);
    if (v.trailT < 0) return;
    v.trailT += dt;
    if (v.trailT <= TRAIL_DELAY) return;
    const p = Math.min(1, (v.trailT - TRAIL_DELAY) / TRAIL_MS);
    v.trail = v.trailFrom + (v.trailTo - v.trailFrom) * ease.quadIn(p);
    cropBar(v.trailBar, v.trail);
    if (p >= 1) v.trailT = -1;
  }

  private shutdown(): void {
    this.createSeq++;
    for (const v of this.views.values()) this.endCast(v, false);
    this.views.clear();
    this.viewList.length = 0;
    this.labelViews.length = 0;
    this.labelRects.length = 0;
    this.ambient = null;
    this.bossBar = null;
    this.heroPanel = null;
    // Сцена-синглтон живёт всю игру: ссылка на уничтоженный текст таймера держала бы его (и canvas) до следующего боя.
    this.timeText = undefined as unknown as Phaser.GameObjects.Text;
    this.endHitStop();
    this.later.clear();
    this.floats?.clear();
    this.barks?.clear();
    this.sfx?.clear();
    this.ult?.clear();
    this.behaviorFx?.clear();
    this.behaviorFx = null;
    this.tauntIds.clear();
    this.redirectShown.clear();
  }

  /**
   * «Пропустить» (T2-12): сначала без анимации выполнить всё отложенное (удары, смерти), оборвать эффекты, твины,
   * баннеры и тряску, поставить юнитов в конечные точки шагов — и доиграть остаток лога без анимации.
   * Поверх итогового положения ничего не доигрывается.
   */
  private skip(): void {
    if (this.finished || !this.ready) return;
    // Остаток пропущенного боя — авто (ульты сами), режим игрока не меняется.
    if (this.rerun && this.manual) {
      this.inputs.push({ t: nextTick(this.clock, COMBAT.tickSeconds), auto: true });
      this.applyInputs();
    }
    this.ultHintNode?.destroy();
    this.ultHintNode = null;
    this.skipping = true;
    this.introLeft = 0;
    this.endHitStop();
    this.later.flush();
    this.sfx.cancel();
    this.floats.cancel();
    this.ult.cancel();
    this.tweens.killAll();
    this.cameras.main.resetFX();
    this.children.getByName('bossBanner')?.destroy();
    this.barks.clear();
    for (const v of this.views.values()) {
      if (v.moveDest) {
        v.pos.x = v.moveDest[0];
        v.pos.y = v.moveDest[1];
      }
      v.spot = false;
      v.moveTween = null;
      v.moveKind = null;
      v.walking = false;
      v.moveDest = null;
      v.node.setScale(1);
      v.sprite.setY(0);
      v.nameText.setAlpha(0);
      if (v.shownDead) {
        v.sprite.setAlpha(0.3);
        v.shadow.setAlpha(0);
      }
    }
    this.namesHidden = true;
    const log = this.result.log;
    while (this.cursor < log.length) this.play(log[this.cursor++], false);
    for (const v of this.views.values()) this.endCast(v);
    settleSpread(this.viewList, SPREAD_BOUNDS);
    this.projectUnits();
    for (const v of this.viewList) {
      this.placeUnit(v);
      gaitReset(v, v.node.x, v.node.y);
      if (v.alive) {
        this.faceFoe(v);
        this.loop(v, this.stance(v));
      }
    }
  }

  /**
   * Отложить до момента удара источника (кадр удара анимации, полёт снаряда, рывок). target — если у навыка
   * свой план попаданий (залп снарядов), удар по этой цели ждёт свой снаряд.
   */
  private atImpact(sourceUid: string | null, animate: boolean, draw: (animate: boolean) => void, opts: { plan?: string; on?: UnitView } = {}): void {
    const src = sourceUid ? this.views.get(sourceUid) : undefined;
    // Удар ульты героя — в полную яркость; чужие удары, попавшие на время ульты, — приглушённо (fxMode, в момент удара).
    const ult = this.heroUlt(src);
    const fn = (a: boolean) => (a ? this.fxMode(sourceUid ?? undefined, ult, () => draw(a), opts.on?.snap.side === 'A') : draw(a));
    const planned = opts.plan ? src?.hitPlan.get(opts.plan)?.shift() : undefined;
    const live = animate && !this.skipping;
    const wait = live && src ? (planned ?? src.impactAt) - this.time.now : 0;
    if (wait <= 0) {
      fn(live);
      return;
    }
    // Попадание по юниту ещё впереди — его смерть подождёт (P1: цифры не всплывают над трупом).
    const on = opts.on;
    if (on) on.pending++;
    this.later.after(wait, () => {
      fn(!this.skipping);
      if (!on) return;
      on.pending--;
      if (on.pending <= 0 && on.deathQueued) {
        const die = on.deathQueued;
        on.deathQueued = undefined;
        die();
      }
    });
  }

  /** Идёт ульта героя, и источник — не её кастер: его цифры и эффекты приглушить. */
  private muted(uid: string | undefined): boolean {
    const f = this.focus;
    return !!f && uid !== f.uid && this.time.now < f.until;
  }

  /**
   * Ульта героя началась: остальные бойцы приглушены (уже идущие цифры и эффекты — тоже), плашка ульты монстра убрана.
   * Сам фокус продлевается в case 'ult' до удара ульты.
   */
  private beginFocus(v: UnitView): void {
    this.focus = { uid: v.snap.uid, until: this.time.now + ULT_FOCUS_MS };
    this.floats.muteLive();
    this.sfx.muteLive();
    this.ult.hideBanner('B');
  }

  /** Действие юнита — ульта героя (событие ult стороны A и удары/лечение/статусы, пока она идёт). */
  private heroUlt(v: UnitView | undefined): boolean {
    return !!v && v.snap.side === 'A' && v.inUlt;
  }

  /**
   * Рисовать fn в режиме эффектов: ult — эффекты ульты героя в полную яркость и крупнее (RR-15 не действует),
   * иначе во время чужой ульты героя — приглушённо. Режим запоминают отложенные продолжения эффектов (SkillFx).
   */
  private fxMode(src: string | undefined, ult: boolean, fn: () => void, onAlly = false): void {
    const f = this.floats;
    const s = this.sfx;
    const was = [f.ult, f.mute, s.boost, s.mute, s.soft] as const;
    const mute = !ult && this.muted(src);
    f.ult = ult;
    f.mute = mute;
    // Лечение и баффы ульты на своих — в полную яркость, но не крупнее (иначе лист закрывает фигуры отряда).
    s.boost = ult && !onAlly ? ULT_FX_BOOST : 1;
    s.mute = mute;
    // Попадания по отряду проходят тем же мягким режимом, что лечение и баффы.
    s.soft = onAlly && !ult;
    try {
      fn();
    } finally {
      [f.ult, f.mute, s.boost, s.mute, s.soft] = was;
    }
  }

  private play(e: BattleEvent, animate: boolean): void {
    if (!animate) {
      this.playEvent(e, animate);
      return;
    }
    const src = 'source' in e ? e.source : 'unit' in e ? e.unit : undefined;
    const v = src ? this.views.get(src) : undefined;
    const ult = e.type === 'ult' ? v?.snap.side === 'A' : e.type !== 'attack' && this.heroUlt(v);
    if (e.type === 'ult' && ult && v && !this.skipping) this.beginFocus(v);
    this.fxMode(src, ult, () => this.playEvent(e, animate));
  }

  private playEvent(e: BattleEvent, animate: boolean): void {
    battleSound(e, animate && !this.skipping, this.result, this.defs);
    switch (e.type) {
      case 'turn':
        return;
      case 'move': {
        const v = this.views.get(e.unit)!;
        if (!animate || e.duration <= 0) {
          // duration 0 — остановка на месте (оглушение, P1): оборвать шаг, встать в стойку.
          v.moveTween?.stop();
          v.moveTween = null;
          v.moveKind = null;
          v.moveDest = null;
          v.walking = false;
          v.pos.x = e.to[0];
          v.pos.y = e.to[1];
          if (animate && v.alive && this.time.now >= v.busyUntil) this.loop(v, this.stance(v));
          return;
        }
        this.moveTo(v, e.to[0], e.to[1], e.duration * 1000, e.kind);
        v.backpedal = e.reason === 'kite';
        this.behaviorMove(v, e.reason);
        return;
      }
      case 'attack': {
        const v = this.views.get(e.unit)!;
        const hadCast = !!v.cast;
        if (this.ultSkill.get(e.unit)?.id === e.skill) {
          this.ultUsedAt.set(e.unit, e.t);
          this.heroPanel?.setReady(e.unit, false);
          // Ульта по касанию — как ульта монстра: затемнение, подсветка героя, баннер.
          if (this.tapped.delete(e.unit) && animate && !this.skipping && e.name) this.spotlight(v, e.name, e.skill);
        }
        v.inUlt = false;
        v.lastSkill = e.skill;
        v.proc = undefined;
        v.energy = e.energy;
        v.energyT = e.t;
        this.endCast(v);
        // Удар мага по кругу: вспышка на земле (круг рос весь каст).
        this.behaviorFx?.endArea(v, animate);
        this.redraw(v);
        v.hitPlan.clear();
        const cd = e.cooldown !== undefined ? v.cdSkills.find((c) => c.skill.id === e.skill) : undefined;
        if (cd) {
          cd.readyAt = e.t + (e.cooldown ?? 0);
          cd.cd = e.cooldown ?? 0;
          this.assignCooldowns(v);
        }
        if (!animate) return;
        const skill = CONTENT.skills[e.skill];
        // Bash has no castTime in this game: its RO beginCast cue belongs to the attack start.
        if (!hadCast) this.castCue(v, e.skill);
        // §5 «Бой» (P0 «каша подписей»): названия обычных и активных навыков над головами не пишем — навык виден по
        // эффекту; название — только у ульты (баннер) и у каста босса/заряда (над полосой каста).
        const target = this.views.get(e.targets[0]);
        // Бьёт — лицом к цели (свою цель — лечение, бафф — не разворачивает).
        if (target && target.side !== v.side) {
          v.lookAt = target;
          if (!v.moveKind) this.faceFoe(v);
        }
        let impact = this.once(v, 'attack');
        // «Ульта» героя (SkillVisual.big): аура подготовки у кастера, встряска и вспышка в момент удара.
        if (e.name && skill && visualOf(skill.id)?.big) this.bigCue(v, skill, e.t);
        if (e.name && skill && this.skillVisual(v, skill, impact)) return;
        if (e.kind !== 'melee' && target) {
          const tex = e.kind === 'heal' ? 'fx_heal' : (v.def.visual.projectile ?? 'fx_magic');
          if (tex === 'fx_arrow') this.later.after(impact, () => this.projectile(v, target, tex));
          // Магия и лечение — светящийся шар со шлейфом (цвет искры юнита; лечение — зелёный).
          else this.sfx.projectile('arcane', this.point(v), this.point(target), e.kind === 'heal' ? 0x8dff9a : v.hitTint, PROJECTILE_MS, impact, () => {});
          impact += PROJECTILE_MS;
        }
        v.impactAt = this.time.now + impact;
        return;
      }
      case 'ult': {
        const v = this.views.get(e.unit)!;
        this.tapped.delete(e.unit);
        this.heroPanel?.setReady(e.unit, false);
        if (animate && !v.cast) this.castCue(v, e.skill);
        v.lastSkill = e.skill;
        v.proc = undefined;
        v.energy = 0;
        v.energyT = e.t;
        v.inUlt = true;
        this.redraw(v);
        if (!animate) return;
        v.hitPlan.clear();
        // Ульта героя с подготовкой (SkillVisual.windup, Удар Асуры): удар — позже кадра каста, атлас каста успевает прочитаться.
        const impact = this.once(v, 'cast') + (v.snap.side === 'A' ? visualOf(e.skill)?.windup ?? 0 : 0);
        v.impactAt = this.time.now + impact;
        this.spotlight(v, e.name, e.skill);
        const skill = CONTENT.skills[e.skill];
        if (skill) {
          this.bigCue(v, skill, e.t);
          this.skillVisual(v, skill, impact);
        }
        // Фокус на ульте героя — до конца её удара (и не меньше ULT_FOCUS_MS).
        if (v.snap.side === 'A') this.focus = { uid: v.snap.uid, until: Math.max(this.time.now + ULT_FOCUS_MS, v.impactAt + ULT_FOCUS_TAIL_MS) };
        // Ульта босса — экран вздрагивает в момент удара.
        if (v.def.kind === 'boss') this.sfx.later(Math.max(0, v.impactAt - this.time.now), () => this.sfx.shake(0.009, 280));
        return;
      }
      case 'cast': {
        const v = this.views.get(e.unit)!;
        if (e.action === 'interrupt') {
          this.behaviorFx?.endArea(v, false);
          // T2-08/T2-09: нейтральная подпись без рода. Оглушение — в момент удара оглушившего; пропавший без цели
          // каст — серым «нет цели»; Развеивание контрмага — «Сбито!».
          if (e.reason === 'noTarget') {
            this.endCast(v);
            return;
          }
          // Свой каст оборван ультой по касанию — молча.
          if (e.reason === 'ult') {
            this.endCast(v);
            return;
          }
          // Заряд босса сбит ультой: крупно, с тряской.
          if (e.reason === 'break') {
            this.endCast(v);
            if (animate && v.alive && !this.skipping) this.chargeBroken(v);
            return;
          }
          this.atImpact(v.lastStatusSrc ?? null, animate, (animate) => {
            this.endCast(v);
            if (animate && v.alive) this.behaviorLabel(v, e.reason === 'dispel' ? 'Сбито!' : 'Каст сорван', e.reason === 'dispel' ? '#b8a0ff' : '#ff9a8a');
          }, { on: v });
          return;
        }
        v.cast = { start: e.t, dur: e.duration };
        const sk = CONTENT.skills[e.skill];
        const col = ELEMENT_COLORS[sk ? lookOf(sk).element : 'neutral'];
        v.castBack.setVisible(true);
        v.castBar.setVisible(true).setTintFill(col.main);
        // Название каста не пишем (§5 «Бой»): значок навыка у полосы; у заряда вместо значка — молния.
        if (sk && !e.charge) v.castIcon.setTexture(skillIcon(this, sk)).setDisplaySize(CAST_ICON, CAST_ICON).setVisible(true);
        v.nameText.setVisible(false);
        cropBar(v.castBar, 0);
        // Заряд босса: красная полоса с молнией над бойцом (и под полоской босса); у героев, чья ульта собьёт заряд,
        // пульсируют молнии на медальонах — кто ответит, видно без текста.
        if (e.charge) {
          v.castBar.setTintFill(0xff4a2a);
          v.charging = true;
          (v.castBolt ??= this.castBolt(v)).setVisible(true);
          if (this.bossBar?.uid === v.snap.uid) this.bossCharge?.node.setVisible(true);
          this.heroPanel?.alertBreakers(true);
          if (animate && !this.skipping) {
            this.behaviorLabel(v, 'Заряд!', '#ff6a4a');
            // Первый заряд босса — реплика Гаррета (firstTips.ts, один раз).
            if (!tipDone('tip_boss_charge')) {
              firstTip(this, 'tip_boss_charge', CHARGE_TIP_Y, PANEL_DEPTH + 5);
            }
          }
        }
        if (!animate) return;
        // Маг бьёт по кругу: круг на земле там, куда упадёт удар, растёт вместе с полосой каста.
        if (e.at && e.radius) this.behaviorFx?.castArea(v, fieldX(e.at[0]), e.at[1] - this.dy, e.radius * FIELD_SQUEEZE, col.main, e.duration * 1000);
        // Круг под ногами, аура и анимация каста — пока идёт каст.
        (v.castRig ??= this.sfx.castRig(v.node, v.look.height)).show(col.main, castFxId(GAME.content.skills[e.skill] ?? {}));
        this.castCue(v, e.skill);
        this.loop(v, 'cast');
        return;
      }
      case 'passive': {
        const v = this.views.get(e.unit)!;
        // Название пассивки — только при первом срабатывании у юнита за бой, иначе экран засоряется
        // (пассивки на начало хода срабатывают каждый ход).
        const key = `${e.unit}:${e.skill}`;
        // RR-14: в первую секунду боя пассивки и ауры всего поля срабатывают разом — их подписи не выводим (8–9 штук
        // лежали пачкой на отряде); подпись выйдет при следующем срабатывании, по очереди ходов.
        const opening = e.t < OPENING_QUIET_S;
        if (!opening) this.shownPassives.add(key);
        v.proc = { skill: e.skill, t: e.t };
        // Своя вспышка пассивки на кастере (сокол к цели, колба к союзнику, сферы…) — в момент срабатывания.
        const pv = visualOf(e.skill);
        // Аура (Поэма Браги) срабатывает каждый ход барда — вспышка только в первый раз, дальше виден круг ауры.
        const auraRepeat = !!CONTENT.skills[e.skill]?.aura && this.shownPassives.has(`${key}:proc`);
        this.shownPassives.add(`${key}:proc`);
        if (animate && pv?.proc && v.alive && !this.skipping && !auraRepeat) playProc(this.sfx, pv.proc, this.point(v), this.eventTargets(v, e.t).map((u) => this.point(u)), pv.tint ?? 0xffffff);
        return;
      }
      case 'skip':
        // Оглушение видно значком над HP и звёздами над головой — без подписи.
        return;
      case 'damage': {
        this.hunt?.hud?.hit(e);
        const v = this.views.get(e.target)!;
        // Удар ульты — крупная золотая цифра (как крит); флаг читаем сейчас, до задержки удара.
        const big = !e.dot && !!this.views.get(e.source)?.inUlt;
        const dmgSkill = e.dot ? undefined : this.skillOf(this.views.get(e.source), e.t);
        this.atImpact(e.dot ? null : e.source, animate, (animate) => {
          if (v.shownDead) return;
          v.hp = e.hp;
          v.shield = e.shield;
          v.energy = e.energy;
          v.energyT = e.t;
          this.redraw(v, animate);
          if (!animate) return;
          // Стихия (слабость/стойкость) — цветом и размером цифры (battleFx ELEM_LOOK), без подписи.
          const hpPart = e.amount - e.absorbed;
          const src = this.views.get(e.source);
          const sk = dmgSkill ? CONTENT.skills[dmgSkill] : undefined;
          // Цифры RO: белые — по монстрам, красные — по героям, жёлтые крупные — удар ульты, голубые — ушло в щит.
          const roTint = hpPart <= 0 ? RO_TINT.shield : big ? RO_TINT.ult : v.snap.side === 'A' ? RO_TINT.hero : RO_TINT.enemy;
          if (!this.popRo(v, hpPart > 0 ? hpPart : e.absorbed, roTint, big && hpPart > 0 ? 1.6 : e.dot ? 0.9 : 1.15, RO_HIT, hpPart > 0 ? e.elem : undefined)) {
            const style = numberStyle(sk, src);
            const color = e.dot ? '#9be36b' : big && hpPart > 0 ? '#ffd84a' : hpPart > 0 ? style.color : '#bcd6ff';
            this.popNumber(v, hpPart > 0 ? `-${hpPart}${big ? '!' : ''}` : `(${e.absorbed})`, color, big && hpPart > 0, style.size);
          }
          this.hurt(v);
          // Урон, принятый за союзника по связи (Самопожертвование), виден золотой нитью связи (battleBehaviorFx) — без подписи.
          if (e.dot) return;
          const hit = hitFxOf(src, dmgSkill);
          if (hit === 'fx_magic') this.fx(v, hit, 1.15, 450, 0.62);
          else this.fx(v, hit, 0.45, 200, 0.5, src?.node.x);
          if (src) this.hitVisual(src, v, sk, hpPart, big);
        }, { plan: e.dot ? undefined : e.target, on: v });
        return;
      }
      case 'heal': {
        const v = this.views.get(e.target)!;
        const healAura = visualOf(this.skillOf(this.views.get(e.source), e.t));
        this.atImpact(e.source, animate, (animate) => {
          if (v.shownDead) return;
          v.hp = e.hp;
          this.redraw(v, animate);
          if (animate && e.amount > 0) {
            // RO Heal: крупное зелёное «+N» с тёмно-зелёной обводкой, столб света (skillFx.heal), лист fx_heal
            // в рост фигуры и короткий бело-зелёный отсвет на самом юните.
            // Лечение в RO — зелёные цифры без «+», прямо вверх.
            if (!this.popRo(v, e.amount, RO_TINT.heal, 1.15, RO_RISE)) this.popNumber(v, `+${e.amount}`, '#8dff9a', false, 54, '#0b3d12');
            this.fx(v, 'fx_heal', 1.3);
            // Первая помощь и мелкое восстановление (пассивки) — маленький столб с крестиком.
            const small = this.views.get(e.source)?.lastSkill === 'novice_first_aid' || e.amount < v.snap.maxHp * 0.08;
            // RR-15: столбы лечения и ауры на своих героях — прозрачнее (SkillFx.soft).
            this.sfx.soft = v.snap.side === 'A';
            this.sfx.heal(this.point(v), e.amount >= v.snap.maxHp * 0.15, small);
            if (healAura?.aura) playAura(this.sfx, healAura.aura, this.point(v), healAura.tint ?? 0x8dff9a);
            this.sfx.soft = false;
            if (v.tintLeft <= 0) {
              v.sprite.setTint(0xc8ffcc);
              v.flashFill = false;
              v.tintLeft = HEAL_TINT_MS;
            }
          }
        }, { on: v, plan: e.target });
        return;
      }
      case 'buff': {
        const v = this.views.get(e.target)!;
        const shieldSkill = this.skillOf(this.views.get(e.source), e.t);
        const shieldLook = visualOf(shieldSkill);
        this.atImpact(e.source, animate, (animate) => {
          if (v.shownDead) return;
          v.shield = e.shield;
          this.redraw(v);
          if (animate) {
            if (!this.popRo(v, e.amount, RO_TINT.shield, 0.9, RO_RISE)) this.popNumber(v, `щит +${e.amount}`, '#bcd6ff', false, 30);
            // Лист RO навыка (effects.json → skills.<id>.buff) заменяет общий щит и процедурную ауру.
            const sheet = skillFx(shieldSkill)?.buff;
            this.fx(v, sheet ?? 'fx_shield', sheet ? 1.2 : 1.4, 400);
            // Свой щит навыка (Кирие — двойной пузырь, Стена безопасности — розовые столбы…), иначе общий столб искр.
            this.sfx.soft = v.snap.side === 'A';
            if (sheet) playTwinkle(this.sfx, v.node.x, this.headY(v), 0x9cc8ff);
            else if (shieldLook?.aura) playAura(this.sfx, shieldLook.aura, this.point(v), shieldLook.tint ?? 0x9cc8ff);
            else this.sfx.buff(this.point(v), 0x9cc8ff);
            this.sfx.soft = false;
          }
        }, { on: v });
        return;
      }
      case 'status': {
        const v = this.views.get(e.target)!;
        // Аура продлила статус (каждый ход барда) — значок уже висит, заново не рисуем.
        if (e.action === 'refresh') return;
        const statusKey = `${e.target}:${e.status}`;
        if (e.action === 'expire') {
          this.statusVersions.set(statusKey, (this.statusVersions.get(statusKey) ?? 0) + 1);
          this.activeStatuses.delete(statusKey);
          const remaining = [...this.activeStatuses].filter(([key]) => key.startsWith(`${e.target}:`)).map(([, status]) => status);
          if (this.tauntIds.has(e.status) && !remaining.some((status) => status.def.taunt)) this.behaviorFx?.untaunt(v);
          this.setStatusIcon(v, e.status, undefined);
          if (statusDef(e.status)?.stun) this.setStun(v, remaining.some((status) => status.def.stun), remaining.some((status) => status.frozen));
          return;
        }
        const version = (this.statusVersions.get(statusKey) ?? 0) + 1;
        this.statusVersions.set(statusKey, version);
        const def = statusDef(e.status);
        const src = this.views.get(e.source);
        // Бафф союзнику (не свой яд/оглушение по врагу) — вспышка защиты из эффектов RO и столб искр.
        const ally = !!src && src.snap.side === v.snap.side;
        v.lastStatusSrc = e.source;
        const srcSkillId = this.skillOf(src, e.t);
        const frozen = !!def?.stun && (/замороз/i.test(e.name) || /frost|storm_gust/.test(srcSkillId ?? ''));
        if (def) this.activeStatuses.set(statusKey, { def, frozen });
        if (e.taunt) this.tauntIds.add(e.status);
        this.atImpact(e.source, animate, (animate) => {
          if (this.statusVersions.get(statusKey) !== version || !v.alive || v.shownDead) return;
          if (v.alive && !v.shownDead) {
            if (e.taunt && src) this.behaviorFx?.taunt(v, src);
            this.setStatusIcon(v, e.status, def);
            if (def?.stun) this.setStun(v, true, frozen);
          }
          if (!animate) return;
          if (!ally && v.alive && !this.floats.catalogFlash(v.node.x, v.node.y, skillFx(srcSkillId)?.debuff, 220, undefined, undefined, v.snap.side === 'A')) {
            this.sfx.soft = v.snap.side === 'A';
            this.statusVisual(v, e.status, def);
            this.sfx.soft = false;
          }
          // Бафф на весь отряд (Ускорение, Благословение): подпись не пишем над каждым — хватает искр и значка у HP.
          const srcSkill = srcSkillId ? CONTENT.skills[srcSkillId] : undefined;
          // Итерация 5: статус — значком над юнитом с «хлопком» (не словом), дальше — маленький значок у полоски ОЗ.
          // Не в первую секунду боя (RR-14); бафф союзника — при первом наложении (RR-07), дебафф — каждый раз.
          if (def && v.alive && !(ally && srcSkill?.target.pick === 'all') && e.t >= OPENING_QUIET_S && !(ally && this.shownStatuses.has(statusKey))) {
            this.shownStatuses.add(statusKey);
            this.floats.statusPop(v.node.x, v.node.y - v.look.height - 30, statusIcon(this, def), v.snap.uid);
          }
          if (ally) {
            const sheet = skillFx(srcSkillId)?.buff;
            this.fx(v, sheet ?? 'fx_shield', 1.2, 400);
            // Нарисованный художником лист баффа (effects.json → skills) заменяет процедурную ауру; иначе своя аура баффа
            // (ноты песни, сердечки, нимб, меч света…), иначе общий столб искр цвета статуса.
            const look = visualOf(srcSkillId);
            // Бафф — искорки мерцают над головой (у каждого союзника, короткие).
            this.sfx.soft = v.snap.side === 'A';
            playTwinkle(this.sfx, v.node.x, this.headY(v), look?.tint ?? buffColor(def));
            if (sheet) {
              // только лист
            } else if (look?.aura) playAura(this.sfx, look.aura, this.point(v), look.tint ?? buffColor(def));
            else this.sfx.buff(this.point(v), buffColor(def));
            this.sfx.soft = false;
          }
        }, { on: v });
        return;
      }
      case 'energy': {
        const v = this.views.get(e.unit)!;
        v.energy = e.energy;
        v.energyT = e.t;
        this.redraw(v);
        return;
      }
      case 'death': {
        const v = this.views.get(e.unit)!;
        v.alive = false;
        // Смерть — после удара убийцы и после всех ещё не показанных попаданий по юниту.
        this.atImpact(e.killer, animate, (animate) => {
          const die = () => this.die(v, animate && !this.skipping);
          if (v.pending > 0) v.deathQueued = die;
          else die();
        });
        return;
      }
      case 'link': {
        const g = this.views.get(e.unit);
        const w = this.views.get(e.target);
        if (!g || !w) return;
        if (e.action === 'break') this.behaviorFx?.unlink(w);
        else this.behaviorFx?.link(g, w);
        return;
      }
      case 'phase':
        this.showPhase(e, animate);
        return;
      case 'spawn':
        this.spawnUnit(e, animate);
        return;
      case 'aura': {
        // Аура барда (ноты) / танцовщицы (лепестки) — цветной круг под исполнителем весь бой.
        const v = this.views.get(e.unit);
        const dancer = e.skill === 'job_dancer_fortune_kiss';
        if (v) this.behaviorFx?.aura(v, e.radius * FIELD_SQUEEZE, dancer ? 0xff7fc4 : 0x6fd0ff, dancer);
        return;
      }
      case 'ready':
        if (!this.manual) return;
        this.heroPanel?.setReady(e.unit, !e.lost);
        if (!e.lost && animate) this.showUltHint(e.unit);
        return;
      case 'mode':
        if (e.auto) for (const uid of this.ultSkill.keys()) this.heroPanel?.setReady(uid, false);
        return;
      case 'bless': {
        // Благословение Башни сработало: золотистая подпись над юнитом (не чаще раза в 1,5 с над одним).
        const v = this.views.get(e.unit);
        if (!v || !animate) return;
        const key = `bless:${e.unit}`;
        if (this.time.now - (this.redirectShown.get(key) ?? -Infinity) < 1500) return;
        this.redirectShown.set(key, this.time.now);
        this.headline(v, e.text, '#ffe08a');
        return;
      }
      case 'enrage':
        if (animate && !this.skipping) {
          this.sfx.flash(0xff6040, 0.18, 260);
          this.floats.headline(GAME_W / 2, this.bossBarY + 90, 'Ярость!', T.heading, '#ff8a6a', DEPTH.numbers, 'enrage');
        }
        return;
      case 'end':
        this.finished = true;
        if (animate && this.result.winner === 'B') for (const v of this.viewList) if (v.alive) this.bossBark(v, 'victory');
        this.showTime(this.result.duration);
        this.commitStage();
        if (this.hunt) this.hunt.hud?.finish(this.hunt.outcome);
        this.time.delayedCall(animate ? 1200 : 150, () =>
          this.autobattler
            ? this.scene.start('Autobattler', { fight: {
                round: this.autobattler.round,
                won: this.autobattler.won,
                wins: this.autobattler.wins,
                lives: this.autobattler.lives,
                ended: this.autobattler.ended,
                rewards: this.autobattler.rewards,
                income: this.autobattler.income,
              } } satisfies AutobattlerSceneData)
            : this.bond
            ? startTavernEvening(this, {
                mode: 'hub',
                back: this.bond.back,
                quest: {
                  templateId: this.bond.templateId,
                  win: this.bond.outcome.win,
                  goal: this.bond.outcome.goal,
                  firstTime: this.bond.outcome.firstTime,
                  fallen: this.bond.outcome.fallen,
                  duration: this.result.duration,
                },
              })
            : this.hunt
            ? this.scene.start('Hunt', { outcome: this.hunt.outcome })
            : this.towerRun
              ? this.scene.start('Tower', { fight: { floor: this.towerRun.outcome.floor, win: this.result.winner === 'A', events: this.towerRun.outcome.events } })
              : this.scene.start('Result', { result: this.result, defs: this.defs, stage: this.stage, tower: this.tower } satisfies ResultData),
        );
        return;
    }
  }

  /**
   * Реплика босса или мини-босса (поле юнита barks, lore-route §5.5): старт, ниже половины здоровья, гибель, победа —
   * каждая один раз за бой. Только вид: при «Пропустить» не показываются. Реплики есть только у именных юнитов.
   */
  /**
   * Фаза босса (событие phase ядра): реплика фазы, вспышка и встряска, надпись фазы у полосы босса (у мини-босса — над
   * фигурой) и столб искр на самом боссе.
   */
  private showPhase(e: Extract<BattleEvent, { type: 'phase' }>, animate: boolean): void {
    const v = this.views.get(e.unit);
    if (!v) return;
    if (e.bark) this.bossBark(v, e.bark);
    if (!animate || this.skipping) return;
    const rage = /ярост/i.test(e.title);
    const tint = rage ? 0xff5a3a : 0xffd66b;
    this.sfx.flash(tint, 0.3, 320);
    this.sfx.shake(0.008, 260);
    this.sfx.glow(v.node.x, bodyY(v), tint, 0.6, 2.4, 520);
    this.sfx.rise(v.node.x, v.node.y, tint, 14, 70);
    if (this.bossBar?.uid === v.snap.uid) this.floats.headline(GAME_W / 2, this.bossBarY + 90, e.title, T.heading, rage ? '#ff8a6a' : '#ffe28a', DEPTH.banner, `phase:${v.snap.uid}`);
    else this.headline(v, e.title, rage ? '#ff8a6a' : '#ffe28a');
  }

  /** Свита фазы (событие spawn): фигура появляется в слоте из клуба дыма. */
  private spawnUnit(e: Extract<BattleEvent, { type: 'spawn' }>, animate: boolean): void {
    if (this.views.has(e.unit)) return;
    const snap = this.result.spawned?.find((s) => s.uid === e.unit) ?? { uid: e.unit, side: e.unit[0] as 'A' | 'B', slot: 2, unitId: e.unitId, maxHp: e.maxHp, x: e.x, y: e.y };
    if (!this.defs[snap.unitId]) this.defs[snap.unitId] = CONTENT.units[snap.unitId];
    this.buildUnit(snap);
    const v = this.views.get(e.unit)!;
    if (this.namesHidden) v.nameText.setAlpha(0);
    if (!animate || this.skipping) return;
    this.sfx.puffCloud(fieldX(e.x), e.y - this.dy - 40, 0xcfc6b8, 10, 90, 620, 0.9);
    v.node.setAlpha(0);
    this.tweens.add({ targets: v.node, alpha: 1, duration: 360, ease: 'Sine.easeOut' });
  }

  private bossBark(v: UnitView, kind: 'start' | 'half' | 'rage' | 'defeat' | 'victory'): void {
    const line = v.def.barks?.[kind];
    if (!line || this.skipping || !this.barks) return;
    const key = `${v.snap.uid}:${kind}`;
    if (this.barked.has(key)) return;
    this.barked.add(key);
    // Гибель — облачко остаётся над местом, где босс пал.
    this.barks.show(kind === 'defeat' ? { node: { x: v.node.x, y: v.node.y }, nameY: v.nameY } : v, line);
  }

  /** Итог этапа или этажа записывается один раз — в конце боя (и при «Пропустить»). */
  /** Карты забега Башни — ряд значков под заголовком (рамка по редкости, портрет монстра карты). */
  private towerCards(): void {
    const run = session.save.tower.run;
    if (!run?.cards.length) return;
    const cfg = runConfig(GAME);
    const size = 58;
    const max = 10;
    const shown = run.cards.slice(0, max);
    const x0 = GAME_W / 2 - ((shown.length - 1) * (size + 8)) / 2;
    shown.forEach((id, i) => {
      const b = cfg.blessings.find((x) => x.id === id);
      if (!b) return;
      const x = x0 + i * (size + 8);
      const y = 262;
      const frame = b.rarity === 'legendary' ? 0xffb830 : b.rarity === 'rare' ? 0x4aa8ff : 0xc8b89a;
      this.add.rectangle(x, y, size, size, 0x1c140c, 0.9).setStrokeStyle(4, frame).setDepth(PANEL_DEPTH);
      const u = b.monster ? GAME.content.units[b.monster] : undefined;
      if (u) {
        const img = this.add.image(x, y, portraitKey(u.visual.sprite)).setDepth(PANEL_DEPTH).setTint(unitTint(u.visual));
        const fit = () => img.setScale((size - 10) / Math.max(img.width, img.height, 1));
        lazyPortrait(this, portraitKey(u.visual.sprite), img, fit);
        fit();
      } else this.add.image(x, y, skinIcon((b.icon ?? 'star') as SkinIcon)).setDisplaySize(size - 16, size - 16).setTint(0xffe08a).setDepth(PANEL_DEPTH);
    });
    if (run.cards.length > max) text(this, x0 + max * (size + 8), 262, `+${run.cards.length - max}`, 30, '#ffe08a', { fontStyle: 'bold' }).setDepth(PANEL_DEPTH);
  }

  private commitStage(): void {
    const out = this.stage?.outcome ?? this.tower?.outcome ?? this.towerRun?.outcome ?? this.hunt?.outcome ?? this.bond?.outcome ?? this.autobattler;
    if (!out || this.committed) return;
    this.committed = true;
    commit(out.save);
    if (this.hunt && !this.hunt.outcome.sweep) recordMvpAttempt(this.hunt.outcome.score);
    if (this.towerRun && this.towerRun.outcome.result.winner === 'A') recordTowerProgress(this.towerRun.outcome.floor);
  }

  // ---------- анимации ----------

  /** Каст закончился или сбит: спрятать полосу, вернуть стойку. */
  private endCast(v: UnitView, returnToStance = true): void {
    if (!v.cast) return;
    this.floats.cancelFx(`cast:${v.snap.uid}`);
    v.cast = null;
    v.castBack.setVisible(false);
    v.castBar.setVisible(false);
    v.castIcon.setVisible(false);
    v.nameText.setVisible(v.alive);
    v.castRig?.hide();
    if (v.charging) {
      v.charging = false;
      v.castBolt?.setVisible(false);
      if (this.bossBar?.uid === v.snap.uid) this.bossCharge?.node.setVisible(false);
      if (!this.viewList.some((o) => o.charging)) this.heroPanel?.alertBreakers(false);
    }
    if (returnToStance && v.alive && this.time.now >= v.busyUntil) this.loop(v, this.stance(v));
  }

  private loop(v: UnitView, name: 'idle' | 'walk' | 'cast'): void {
    const key = v.loopKeys[name];
    if (key && v.sprite.anims.currentAnim?.key !== key) v.sprite.play({ key, repeat: -1 });
  }

  /** Разовая анимация; возвращает задержку до кадра удара (мс на 1x). */
  private once(v: UnitView, name: AnimName): number {
    const key = anim(v.look, v.spriteId, name);
    if (!key || !v.alive) return 0;
    v.sprite.play(key);
    const total = v.sprite.anims.currentAnim?.duration ?? 0;
    v.busyUntil = this.time.now + total;
    return hitDelay(v.look, name);
  }

  private hurt(v: UnitView): void {
    // Свои герои сохраняют детали спрайта: только оттенок. Короткая белая вспышка — у рядового врага.
    const boss = v.def.kind === 'boss';
    if (!boss && v.snap.side === 'B' && !motion.reduced && this.time.now - v.lastFlash >= HIT_FLASH_EVERY) {
      v.sprite.setTintFill(0xffffff);
      v.flashFill = true;
      v.lastFlash = this.time.now;
      v.tintLeft = HURT_TINT_MS + HIT_FLASH_MS;
    } else if (!v.flashFill) {
      v.sprite.setTint(boss ? BOSS_HURT_TINT : 0xff8080);
      v.tintLeft = HURT_TINT_MS;
    }
    if (!v.alive || this.time.now < v.busyUntil || this.time.now - v.lastHurt < HURT_COOLDOWN || v.moveTween) return;
    v.lastHurt = this.time.now;
    this.once(v, 'hurt');
  }

  private moveTo(v: UnitView, x: number, y: number, ms: number, kind: 'walk' | 'dash'): void {
    v.moveTween?.stop();
    v.moveDest = [x, y];
    v.moveKind = kind;
    // Ходьбу и разворот включает gait() по показанной скорости фигуры.
    // Удары, которые юнит нанесёт в конце рывка, покажем, когда он долетит.
    const dash = kind === 'dash';
    const dir = x >= v.pos.x ? 1 : -1;
    if (dash) {
      v.impactAt = Math.max(v.impactAt, this.time.now + ms);
      // Рывок: пыль из-под ног на старте и при приземлении, светящийся след по пути тела.
      this.sfx.dashDust(v.node.x, v.node.y, dir);
    }
    const trailTint = v.snap.side === 'A' ? 0xfff0c0 : 0xffd0e8;
    v.moveTween = this.tweens.add({
      targets: v.pos,
      x,
      y,
      duration: ms,
      ease: dash ? 'Quad.easeOut' : 'Linear',
      onUpdate: () => {
        if (!dash || this.time.now - v.lastTrail < 28) return;
        v.lastTrail = this.time.now;
        this.sfx.dashTrail(v.node.x - dir * 20, v.node.y + v.sprite.y - v.look.height * 0.45, trailTint);
      },
      onComplete: () => {
        v.moveTween = null;
        v.moveKind = null;
        v.moveDest = null;
        v.backpedal = false;
        if (dash && !this.skipping) this.sfx.dashDust(v.node.x, v.node.y, -dir);
      },
    });
    if (kind === 'dash') this.tweens.add({ targets: v.sprite, y: -60, duration: ms / 2, yoyo: true, ease: 'Sine.easeOut' });
    else if (!anim(v.look, v.spriteId, 'walk')?.endsWith(':walk')) {
      // В листе нет ходьбы — хотя бы покачивание, чтобы не «скользил».
      this.tweens.add({ targets: v.sprite, y: -8, duration: 120, yoyo: true, repeat: Math.max(0, Math.floor(ms / 240) - 1), onComplete: () => v.sprite.setY(0) });
    }
  }

  private die(v: UnitView, animate: boolean): void {
    if (v.shownDead) return;
    v.shownDead = true;
    for (const key of this.activeStatuses.keys()) if (key.startsWith(`${v.snap.uid}:`)) this.activeStatuses.delete(key);
    v.hp = 0;
    v.shield = 0;
    this.redraw(v);
    v.moveTween?.stop();
    v.moveTween = null;
    v.moveKind = null;
    v.moveDest = null;
    v.walking = false;
    this.endCast(v);
    for (const b of v.bars) b.setVisible(false);
    v.labels.setVisible(false);
    // Павший — без вспышки попадания.
    v.tintLeft = 0;
    v.flashFill = false;
    this.setStun(v, false, false);
    v.sprite.setTint(unitTint(v.def.visual));
    for (const id of [...v.statusIcons.keys()]) this.setStatusIcon(v, id, undefined);
    v.active = false;
    v.node.setDepth(v.node.y - 1000);
    const key = anim(v.look, v.spriteId, 'death');
    if (key) {
      v.sprite.play(key);
      // Тело темнеет, затем растворяется (как в AFK Arena) — поле не засоряется павшими.
      if (animate) this.tweens.chain({ targets: v.sprite, tweens: [{ alpha: 0.55, delay: 400, duration: 400 }, { alpha: 0, delay: 700, duration: 600 }] });
      else v.sprite.setAlpha(0.55);
    } else {
      // Листа смерти нет: тело просто падает — стойку больше не крутим.
      v.sprite.anims.stop();
      if (animate) this.tweens.chain({ targets: v.sprite, tweens: [{ alpha: 0.2, angle: v.snap.side === 'A' ? -90 : 90, duration: 400 }, { alpha: 0, delay: 700, duration: 500 }] });
      else v.sprite.setAlpha(0.2).setAngle(v.snap.side === 'A' ? -90 : 90);
    }
    if (animate) this.tweens.add({ targets: v.shadow, alpha: 0, delay: 500, duration: 900 });
    else v.shadow.setAlpha(0);
    if (animate) this.bossBark(v, 'defeat');
    if (animate) {
      const boss = v.def.kind === 'boss';
      this.fx(v, 'fx_death', boss ? 2.4 : 1.6, 600);
      // Облачко дыма у ног (как в AFK Arena), у босса — крупнее.
      this.sfx.deathPuff(this.point(v), boss);
      // Смерть босса: вспышка, встряска, кольца — и пауза «hit stop» на миг (не при «Уменьшить анимацию»).
      if (boss) {
        playBossDeath(this.sfx, this.point(v));
        this.hitStop(BOSS_HIT_STOP_MS);
      }
    }
  }

  // ---------- мелочи ----------

  /** Перерисовать полоски. animate — снятое HP уходит белым следом, иначе след сразу догоняет. */
  private redraw(v: UnitView, animate = false): void {
    const max = v.snap.maxHp;
    const pct = Phaser.Math.Clamp(v.hp / max, 0, 1);
    cropBar(v.hpBar, pct);
    if (this.bossBar?.uid === v.snap.uid) cropBar(this.bossBar.fill, pct);
    // Реплика «half» — по событию фазы (phase), если у юнита она привязана к фазе; иначе — на половине ОЗ, как раньше.
    if (pct > 0 && pct < 0.5 && v.alive && !v.def.phases?.some((p) => p.bark === 'half')) this.bossBark(v, 'half');
    if (pct >= v.trail || !animate) {
      v.trailT = -1;
      v.trail = pct;
      cropBar(v.trailBar, pct);
    } else {
      // След стоит TRAIL_DELAY, затем догоняет HP (Quad.easeIn) — в update (animateUnit).
      cropBar(v.trailBar, v.trail);
      v.trailFrom = v.trail;
      v.trailTo = pct;
      v.trailT = 0;
    }
    cropBar(v.energyBar, this.shownEnergy(v) / COMBAT.energy.max);
    this.heroPanel?.set(v.snap.uid, pct, this.ultSkill.has(v.snap.uid) ? this.ultCharge(v.snap.uid) : v.energy / COMBAT.energy.max, !v.shownDead && v.hp > 0);
    v.shieldBar.setVisible(v.alive && v.shield > 0);
    cropBar(v.shieldBar, Math.min(1, v.shield / max));
  }

  /** Снаряд и вспышки — из пула FloatLayer (вид как у прежних твинов). */
  private projectile(from: UnitView, to: UnitView, texId: string): void {
    this.floats.projectile(from.node.x, bodyY(from), to.node.x, bodyY(to), texId, 48, PROJECTILE_MS, DEPTH.fx);
  }

  private fx(v: UnitView, texId: string, scale: number, duration = 250, alpha = 0.8, fromX?: number): void {
    // RR-15: на своих героях эффект меньше и прозрачнее (battleFx.ts → ALLY_FX_ALPHA).
    this.floats.flash(v.node.x, bodyY(v), texId, 140 * scale, alpha, duration, DEPTH.fx, v.node.y, undefined, fromX, v.snap.side === 'A');
  }

  /** Цифры сбоку от тела, к своему тылу; FloatLayer разводит их по реальным живым границам. */
  private popNumber(v: UnitView, value: string, color: string, big = false, size = 40, stroke = '#000000'): void {
    const fs = big ? Math.round(size * 1.3) : size;
    const x = v.node.x + (v.snap.side === 'A' ? -64 : 64);
    const y = bodyY(v) - 42;
    this.floats.number(x, y, value, fs, color, big ? '#5a2a00' : stroke, big ? 8 : 6, DEPTH.numbers, FLOAT_RISE, big ? 650 : 450, big, v.snap.uid);
  }

  /** Цифра RO: урон — дугой к тылу, лечение/щит — вверх; при отсутствии атласа используется popNumber. */
  private popRo(v: UnitView, amount: number, tint: number, scale: number, mode: number, elem?: 'weak' | 'resist'): boolean {
    const dir = v.snap.side === 'A' ? -1 : 1;
    return this.floats.roNumber(v.node.x + dir * 64, bodyY(v) - 42, String(Math.round(amount)), tint, scale, DEPTH.numbers, mode, dir, v.snap.uid, elem);
  }

  /**
   * Короткая подпись на юните (пассивка, статус, «оглушён») — уходит вверх к макушке. Над одним юнитом
   * не больше двух: новая сдвигает прежнюю вверх и та гаснет; у края экрана подпись не обрезается (T3-02).
   */
  /**
   * Поведение в бою (docs/design/battle-behavior.md) — подписи шагов по причине: отход стрелка — «Отход!» один раз за бой
   * (дальше видно и так: пятится лицом к врагу), перехват стража — «Перехват!» каждый раз. Лекарь за танком — просто идёт.
   */
  private behaviorMove(v: UnitView, reason: 'kite' | 'follow' | 'intercept' | 'flee' | undefined): void {
    if (reason === 'kite' && !v.kiteShown) {
      v.kiteShown = true;
      this.behaviorLabel(v, 'Отход!', '#9fe3ff');
    } else if (reason === 'intercept') this.behaviorLabel(v, 'Перехват!', '#ffe28a');
    // Трус убегает к своим (раз за бой): разворачивается и бежит, в спину бьют сильнее.
    else if (reason === 'flee') this.behaviorLabel(v, 'Бежит!', '#ff8a6a');
  }

  /** RR-13: подпись поведения — крупная, над цифрами урона и идёт за юнитом (страж бежит к цели — «Перехват!» с ним). */
  /**
   * «Сбито!» (docs/design/battle-decisions.md §4): заряд босса сорван ультой — крупная золотая надпись над боссом с
   * «хлопком», вспышка ореола, короткая тряска и вспышка экрана. «Меньше движения» — без тряски, вспышек и хлопка
   * (надпись просто появляется и гаснет). Звук и вибрация — в battleAudio.ts.
   */
  private chargeBroken(v: UnitView): void {
    const x = clampX(v.node.x + v.labelX, 360);
    const y = Math.max(this.bossBarY + 110, v.node.y - v.look.height * 0.72 - 60);
    const label = text(this, x, y, 'Сбито!', CHARGE_BREAK_SIZE, '#ffe070', { fontStyle: 'bold', stroke: '#3a1a00', strokeThickness: 12 })
      .setDepth(BEHAVIOR_LABEL_DEPTH + 1)
      .setName('chargeBroken');
    label.setShadow(0, 6, 'rgba(0,0,0,0.65)', 6, true, false);
    if (motion.reduced) {
      this.tweens.add({ targets: label, alpha: 0, delay: 1100, duration: 400, onComplete: () => label.destroy() });
      return;
    }
    label.setScale(0.4);
    this.tweens.add({ targets: label, scale: 1.12, duration: 160, ease: 'Back.easeOut', yoyo: false });
    this.tweens.add({ targets: label, scale: 1, delay: 160, duration: 140, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: label, y: y - 50, alpha: 0, delay: 900, duration: 450, ease: 'Quad.easeIn', onComplete: () => label.destroy() });
    this.sfx.glow(v.node.x, bodyY(v), 0xffe070, 0.5, 2.6, 420);
    this.sfx.shake(0.012, 240);
    this.sfx.flash(0xfff0a0, 0.26, 220);
  }

  private behaviorLabel(v: UnitView, value: string, color: string): void {
    if (this.skipping) return;
    const y = v.node.y - v.look.height * 0.72 - 30;
    this.floats.headline(v.node.x + v.labelX, y, value, BEHAVIOR_LABEL_SIZE, color, BEHAVIOR_LABEL_DEPTH, `${v.snap.uid}:bh`, v.node);
  }

  private headline(v: UnitView, value: string, color: string): void {
    if (this.skipping) return;
    const x = v.node.x + v.labelX;
    // По фигуре юнита (от лица вверх к макушке), не над головой: в заднем ряду над головой сразу полоски соседа сверху (T2-15).
    const y = v.node.y - v.look.height * 0.72;
    this.floats.headline(x, y, value, 24, color, DEPTH.numbers, v.snap.uid);
  }

  /** Ульта: экран темнеет, кастер подсвечен поверх затемнения, сверху — баннер с названием. */
  private spotlight(v: UnitView, skillName: string, skillId: string): void {
    // Идёт ульта героя — ульта монстра не перебивает её затемнением и плашкой (только свечение под кастером).
    if (v.snap.side === 'B' && this.muted(v.snap.uid)) {
      this.ult.glow(v.node.x, v.node.y);
      return;
    }
    if (v.snap.side === 'A') this.focus = { uid: v.snap.uid, until: this.time.now + ULT_FOCUS_MS };
    this.ult.flashDim();
    this.ult.showBanner(v.def.name, skillName, v.snap.side === 'A', skillIcon(this, CONTENT.skills[skillId]));
    this.ult.glow(v.node.x, v.node.y);
    v.spot = true;
    v.node.setDepth(DEPTH.spotlight + v.node.y / 10);
    this.tweens.add({ targets: v.node, scale: 1.12, duration: 160, yoyo: true, hold: 300, ease: 'Quad.easeOut' });
    this.later.after(1000, () => {
      v.spot = false;
      v.node.setDepth(v.shownDead ? v.node.y - 1000 : v.node.y);
    });
  }

  // ---------- навыки: снаряды, площадь, статусы, перезарядка ----------

  /** Навык, которым юнит действует в момент t: сработавшая в этот момент пассивка, иначе последняя атака/ульта. */
  private skillOf(v: UnitView | undefined, t: number): string | undefined {
    if (!v) return undefined;
    return v.proc && Math.abs(v.proc.t - t) < 1e-9 ? v.proc.skill : v.lastSkill;
  }

  /** Цели действия юнита в момент t (следующие события лога того же момента): урон, лечение, щит, статус. */
  private eventTargets(v: UnitView, t: number, later = false): UnitView[] {
    const log = this.result.log;
    const out: UnitView[] = [];
    for (let i = this.cursor + 1; i < log.length && log[i].t <= t + 1e-9; i++) {
      const ev = log[i];
      // later — удары снаряда, долетающие к t: между ними ходят другие юниты, берём только события в момент t.
      if (later && Math.abs(ev.t - t) >= 1e-9) continue;
      if (!later && (ev.type === 'attack' || ev.type === 'ult' || ev.type === 'passive' || ev.type === 'turn')) break;
      const target =
        (ev.type === 'damage' && !ev.dot) || ev.type === 'heal' || ev.type === 'buff' || (ev.type === 'status' && ev.action === 'apply')
          ? ev.source === v.snap.uid ? ev.target : undefined
          : undefined;
      const tv = target ? this.views.get(target) : undefined;
      if (tv && !out.includes(tv)) out.push(tv);
    }
    return out;
  }

  /** Точка эффекта на юните: x, центр тела, ноги. */
  private point(v: UnitView): FxPoint {
    return { x: v.node.x, y: bodyY(v), feet: v.node.y };
  }

  /** Роли атласов RO навыка (effects.json → skills), текстуры которых уже загружены; без загруженных — undefined. */
  private loadedFx(skillId: string | undefined): AtlasRoles | undefined {
    const roles = skillFx(skillId);
    if (!roles) return undefined;
    let out: AtlasRoles | undefined;
    for (const [role, id] of Object.entries(roles) as [keyof AtlasRoles, string][]) {
      if (id && this.textures.exists(animatedFxKey(id))) (out ??= {})[role] = id;
    }
    return out;
  }

  /** Высота «над головой» для мерцания баффа: у макушки, ниже полосок ОЗ. */
  private headY(v: UnitView): number {
    return v.node.y - v.look.height * 0.92;
  }

  /**
   * Ульта (событие ult) или «большой» навык героя: аура подготовки у кастера сейчас, в момент удара — лёгкая встряска,
   * вспышка экрана и кольца на целях (цели — из плана ударов навыка, иначе из событий того же момента).
   */
  private bigCue(v: UnitView, skill: SkillDef, t: number): void {
    if (this.skipping) return;
    const look = lookOf(skill);
    const tint = visualOf(skill.id)?.tint ?? (look.element === 'physical' ? 0xffe0a0 : ELEMENT_COLORS[look.element].main);
    playCharge(this.sfx, this.point(v), tint);
    const now = this.eventTargets(v, t);
    this.later.after(0, () => {
      if (this.skipping) return;
      const planned = [...v.hitPlan.keys()].map((uid) => this.views.get(uid)).filter((u): u is UnitView => !!u);
      const pts = (planned.length ? planned : now).filter((u) => u.side !== v.side).map((u) => this.point(u));
      if (!pts.length) return;
      this.sfx.later(Math.max(0, v.impactAt - this.time.now), () => playBigImpact(this.sfx, pts, tint));
    });
  }

  /** Пауза «hit stop»: часы боя, твины и анимации фигур замирают на ms (реального времени). */
  private hitStop(ms: number): void {
    if (motion.reduced || this.skipping || this.stopLeft > 0) return;
    this.stopLeft = ms;
    this.tweens.pauseAll();
    this.anims.pauseAll();
  }

  private endHitStop(): void {
    if (this.stopLeft === 0) return;
    this.stopLeft = 0;
    this.tweens.resumeAll();
    this.anims.resumeAll();
  }

  /** Authored caster cue, keyed so an interrupted timed cast cannot leave its old atlas on screen. */
  private castCue(v: UnitView, skillId: string): void {
    const id = skillFx(skillId)?.cast;
    if (id) this.floats.catalogFlash(v.node.x, v.node.y, id, 190, `cast:${v.snap.uid}`, undefined, v.snap.side === 'A');
  }

  /** One ground atlas per resolved area, never one column per target. Timing follows the skill impact. */
  private groundCue(v: UnitView, skill: SkillDef, targets: UnitView[], delay: number): void {
    const id = skillFx(skill.id)?.ground;
    if (!id || !targets.length) return;
    const pts = targets.map((u) => this.point(u));
    // Grand Cross and Volcano originate under the caster, including ally status casts.
    const center = skill.id === 'job_crusader_grand_cross' || skill.id === 'job_sage_volcano' || skill.range === 'melee'
      ? this.point(v) : { x: avg(pts.map((p) => p.x)), feet: avg(pts.map((p) => p.feet)) };
    this.sfx.later(delay, () => this.floats.catalogFlash(center.x, center.feet, id, 320, undefined, v.node.x, targets[0].snap.side === 'A'));
  }

  /**
   * Эффект навыка по стихии (skillLook): снаряды по каждому удару (огненная стрела — три огненных шара, у каждого своя
   * цифра урона), площадь (гроза — молнии по всем целям), иначе — вспышка стихии на цели. Цели ударов берём из
   * следующих событий лога с тем же временем (навык с random-целями бьёт разных врагов).
   * false — у навыка нет особого вида, работает обычная атака.
   */
  private skillVisual(v: UnitView, skill: SkillDef, impact: number): boolean {
    // RR-15: навык врага по отряду — его эффекты (и отложенные продолжения) прозрачнее: фигуры героев видны.
    this.sfx.soft = v.snap.side === 'B' && skill.target.side === 'enemy';
    try {
      return this.skillVisualInner(v, skill, impact);
    } finally {
      this.sfx.soft = false;
    }
  }

  private skillVisualInner(v: UnitView, skill: SkillDef, impact: number): boolean {
    const look = lookOf(skill);
    const vis = visualOf(skill.id);
    const tint = vis?.tint ?? (look.element === 'physical' ? 0xffe0a0 : ELEMENT_COLORS[look.element].main);
    const log = this.result.log;
    const t = log[this.cursor]?.t;
    const hits: UnitView[] = [];
    for (let i = this.cursor + 1; i < log.length && log[i].t === t; i++) {
      const ev = log[i];
      if (ev.type === 'damage' && ev.source === v.snap.uid && !ev.dot) {
        const tv = this.views.get(ev.target);
        if (tv) hits.push(tv);
      } else if (ev.type === 'attack' || ev.type === 'ult' || ev.type === 'turn') break;
    }
    // Дальний навык по врагам летит снарядом (ядро, T2-10): его удары — в логе через projectileSeconds, а не в тот же
    // момент. Без этого у огненной стрелы, ледяного осколка и т. п. не находилось целей и рисовалась обычная атака.
    const flies = skill.range === 'ranged' && skill.target.side === 'enemy' && !skill.effects.some((ef) => ef.type === 'dash');
    if (!hits.length && flies && t !== undefined && COMBAT.projectileSeconds) {
      const land = Math.round((t + COMBAT.projectileSeconds) * 100) / 100;
      for (let i = this.cursor + 1; i < log.length && log[i].t <= land + 1e-9; i++) {
        const ev = log[i];
        if (ev.t >= land - 1e-9 && ev.type === 'damage' && ev.source === v.snap.uid && !ev.dot) {
          const tv = this.views.get(ev.target);
          if (tv) hits.push(tv);
        }
      }
    }
    const now = this.time.now;
    // Навыки со своим видом целиком (skillVisuals.ts → рецепты skillSigs.ts): Магнум брейк, Боулинг Баш, сокол, ловушки,
    // колбы алхимика, Великий крест… Навык без ударов (бафф, лечение, дебафф) — цели из событий heal/buff/status.
    if (vis?.sig) {
      let targets = hits.length ? hits : this.eventTargets(v, t ?? 0);
      if (!targets.length && flies && t !== undefined && COMBAT.projectileSeconds) targets = this.eventTargets(v, Math.round((t + COMBAT.projectileSeconds) * 100) / 100, true);
      const pts = new Map<UnitView, FxPoint>();
      for (const u of targets) if (!pts.has(u)) pts.set(u, this.point(u));
      const k: SigCtx = { c: this.point(v), hits: targets.map((u) => pts.get(u)!), uniq: [...pts.values()], dir: v.snap.side === 'A' ? 1 : -1, tint, atlas: this.loadedFx(skill.id) };
      const times = playSignature(this.sfx, vis.sig, k, impact);
      this.groundCue(v, skill, targets, impact);
      targets.forEach((tv, i) => {
        const at = now + times[i];
        const q = v.hitPlan.get(tv.snap.uid);
        if (q) q.push(at);
        else v.hitPlan.set(tv.snap.uid, [at]);
      });
      v.impactAt = now + Math.max(impact, ...times);
      return true;
    }
    // Огненная стрела (RO Fire Bolt): по стреле на удар, падают сверху одна за другой, каждая — взрыв огня.
    if (/fire_bolt/.test(skill.id) && hits.length) {
      const from = this.point(v);
      let last = impact;
      hits.forEach((tv, i) => {
        const delay = impact + i * FIRE_BOLT_STEP;
        this.sfx.fireBolt(from, this.point(tv), i, i === hits.length - 1, delay, () => {});
        const at = now + delay + FIRE_BOLT_MS;
        const q = v.hitPlan.get(tv.snap.uid);
        if (q) q.push(at);
        else v.hitPlan.set(tv.snap.uid, [at]);
        last = delay + FIRE_BOLT_MS;
      });
      v.impactAt = now + last;
      return true;
    }
    if (look.projectile && hits.length) {
      const from = this.point(v);
      let last = impact;
      hits.forEach((tv, i) => {
        const delay = impact + i * SKILL_VOLLEY_STEP;
        const flight = look.projectile === 'meteor' ? SKILL_PROJECTILE_MS * 1.6 : look.projectile === 'beam' ? 90 : look.projectile === 'rock' ? 120 : SKILL_PROJECTILE_MS;
        const to = this.point(tv);
        const onHit = () => this.sfx.impact(this.point(tv), tint, look.projectile === 'meteor');
        // Атлас RO навыка (effects.json → skills.<id>.projectile) летит вместо процедурного снаряда.
        const atlas = this.loadedFx(skill.id)?.projectile;
        if (atlas && look.projectile !== 'beam' && look.projectile !== 'rock') {
          const arc = look.projectile === 'meteor' ? 0 : Math.min(120, Math.abs(to.x - from.x) * 0.18);
          flyAtlas(this.sfx, atlas, look.projectile === 'meteor' ? { x: to.x - 260, y: to.y - 760 } : from, to, flight, delay, arc, tint, onHit);
        } else if (look.projectile === 'arrow') this.sfx.glowArrow(from, to, tint, skill.id === 'job_archer_charge_arrow' ? 1.9 : 1.35, SKILL_PROJECTILE_MS, delay, onHit);
        else this.sfx.projectile(look.projectile!, from, to, tint, SKILL_PROJECTILE_MS, delay, onHit);
        const at = now + delay + flight;
        const q = v.hitPlan.get(tv.snap.uid);
        if (q) q.push(at);
        else v.hitPlan.set(tv.snap.uid, [at]);
        last = delay + flight;
      });
      v.impactAt = now + last;
      return true;
    }
    if (look.area) {
      const uniq = [...new Set(hits)];
      // Лечение по площади (Святилище) — круги под союзниками из событий heal.
      if (look.area === 'sanctuary') {
        for (let i = this.cursor + 1; i < log.length && log[i].t === t; i++) {
          const ev = log[i];
          if (ev.type === 'heal' && ev.source === v.snap.uid) {
            const tv = this.views.get(ev.target);
            if (tv && !uniq.includes(tv)) uniq.push(tv);
          }
        }
      }
      if (!uniq.length) return false;
      const pts = uniq.map((u) => this.point(u));
      const melee = skill.range === 'melee';
      const center = melee ? this.point(v) : { x: avg(pts.map((p) => p.x)), y: avg(pts.map((p) => p.y)), feet: avg(pts.map((p) => p.feet)) };
      this.groundCue(v, skill, uniq, impact);
      const hitAt = this.sfx.areaAt(impact, look.area, pts, center, tint);
      // Атлас-снаряд у площади (Град стрел — пучок стрел RO) падает сверху на каждую цель к моменту удара.
      const rain = this.loadedFx(skill.id)?.projectile;
      if (rain) {
        const dir = v.snap.side === 'A' ? 1 : -1;
        pts.forEach((p, i) => flyAtlas(this.sfx, rain, { x: p.x - dir * 90, y: p.y - 520 }, { x: p.x, y: p.y - 10 }, 240, Math.max(0, hitAt - 240 + i * 30), 0, tint));
      }
      v.impactAt = now + hitAt;
      if (uniq.length >= 3 && look.area !== 'sanctuary') this.sfx.later(hitAt, () => this.sfx.shake(0.005, 180));
      return true;
    }
    // Навык на союзников (бафф, лечение): без снаряда — вспышка на кастере, эффекты — на целях (события heal/status).
    if (!hits.length && skill.target.side === 'ally') {
      const heal = skill.effects.some((e) => e.type === 'heal');
      const p = this.point(v);
      this.sfx.later(impact, () => {
        if (heal) this.sfx.holyCast(p);
        this.sfx.glow(p.x, p.y, heal ? 0x7dff8f : tint, 1, 3.4, 450, 0, 0.9);
        this.sfx.rise(p.x, p.feet, heal ? 0x9dff9a : tint, 6, 40);
      });
      v.impactAt = now + impact + 120;
      return true;
    }
    // Ближний бой и прочее: вспышка стихии на целях в момент удара (обычный путь атаки задаёт impactAt).
    if (hits.length && look.element !== 'physical') {
      const uniq = [...new Set(hits)];
      this.sfx.later(impact, () => uniq.forEach((tv) => this.sfx.impact(this.point(tv), tint)));
    }
    return false;
  }

  /**
   * Искра попадания (P: «бой красочнее»): у навыка со своим видом — он (Баш, Отравление, Кража, монеты Маммонита…),
   * у навыка со снарядом/площадью искра уже нарисована его эффектом, иначе — искра обычного удара по оружию атакующего.
   * Крупный удар (ульта, активный навык, ≥ 20% HP цели) — вспышка крупнее; очень крупный (≥ 35% HP) — лёгкая тряска.
   */
  private hitVisual(src: UnitView, v: UnitView, sk: SkillDef | undefined, hpPart: number, ult: boolean): void {
    const p = this.point(v);
    const dir = v.node.x >= src.node.x ? 1 : -1;
    const special = visualOf(sk?.id)?.hit;
    const active = !!sk && (src.def.skills.actives.includes(sk.id) || src.def.skills.ult === sk.id);
    // Снаряд/площадь активного навыка уже нарисованы skillVisual (у обычной атаки lookOf тоже даёт «стрелу» — её не считаем).
    const drawn = !!sk && active && !!(visualOf(sk.id)?.sig || lookOf(sk).projectile || lookOf(sk).area || /fire_bolt/.test(sk.id));
    if (special) this.sfx.skillHit(special, p, dir, this.point(src));
    else if (!drawn) {
      const heavy = ult || active || hpPart >= v.snap.maxHp * 0.2;
      this.sfx.strike(hpPart > 0 ? src.hitStyle : 'magic', p, dir, heavy, hpPart > 0 ? src.hitTint : 0xbcd6ff);
    }
    // Крупный удар (≥ CRIT_HP_PART ОЗ цели или удар ульты) — золотая звезда-вспышка, как крит.
    if (hpPart > 0 && (ult || hpPart >= v.snap.maxHp * CRIT_HP_PART)) playCrit(this.sfx, p, dir);
    if (hpPart >= v.snap.maxHp * 0.35 || (ult && src.def.kind === 'boss')) this.sfx.shake(0.004, 140);
  }

  /** Вид статуса на враге в момент наложения: «!» провокации, пузырьки яда, звёзды оглушения, ледяной блеск… */
  private statusVisual(v: UnitView, id: string, def: StatusDef | undefined): void {
    const p = this.point(v);
    const head = v.node.y - v.look.height;
    if (id === 'provoke') this.sfx.provoke(p, head);
    else if (def?.stun) {
      if (v.frozen) this.sfx.glow(p.x, p.y, 0xbfeaff, 1, 3, 420, 0, 0.8);
      else this.sfx.stars(p.x, head, 0xffe060, 6);
    } else if (def?.dot) this.sfx.rise(p.x, p.y, /burn/.test(id) ? 0xff8a3a : 0x9be36b, 6, 30);
    else if (id === 'mud' || id === 'sticky') this.sfx.splat(p.x, p.feet - 10, id === 'mud' ? 0x9a7a4a : 0xff9ad0, 1.2);
    else if (id !== 'sand_attack' && id !== 'rooted') this.sfx.rise(p.x, p.y, 0xff8a6a, 5, 30);
  }

  /** Оглушение: звёзды над головой (в контейнере юнита) и ледяной оттенок у замороженного. */
  private setStun(v: UnitView, on: boolean, frozen: boolean): void {
    v.stunned = on;
    v.frozen = on && frozen;
    if (on && !v.stunStars) {
      v.stunStars = Array.from({ length: STUN_STARS }, () => this.add.image(0, 0, STAR_TEX).setTint(0xffe060).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(26, 26));
      v.node.add(v.stunStars);
    }
    for (const st of v.stunStars ?? []) st.setVisible(on && !v.frozen);
    if (v.tintLeft <= 0 && v.alive) v.sprite.setTint(baseTint(v));
    if (on) this.spinStars(v, 0);
  }

  private spinStars(v: UnitView, dt: number): void {
    const stars = v.stunStars!;
    const t = (v.starT += motion.reduced ? 0 : dt);
    const cy = -v.look.height - 4;
    for (let i = 0; i < stars.length; i++) {
      const a = t * 0.006 + (i * Math.PI * 2) / stars.length;
      stars[i].setPosition(Math.cos(a) * STUN_R, cy + Math.sin(a) * 9).setAlpha(Math.sin(a) > 0 ? 1 : 0.55);
    }
  }

  /** Значок статуса над HP: def — наложить/обновить, undefined — снять. Значки идут в ряд от левого края полоски. */
  private setStatusIcon(v: UnitView, id: string, def: StatusDef | undefined): void {
    const old = v.statusIcons.get(id);
    if (!def) {
      if (!old) return;
      old.destroy();
      v.statusIcons.delete(id);
    } else if (!old) {
      const img = this.add.image(0, v.statusY, statusIcon(this, def)).setDisplaySize(STATUS_ICON, STATUS_ICON);
      v.node.add(img);
      v.statusIcons.set(id, img);
    } else return;
    // Видно STATUS_MAX значков — остальные (самые новые) ждут, пока освободится место; их число — «+N» справа.
    let i = 0;
    for (const img of v.statusIcons.values()) {
      img.setX(v.statusX0 + i * (STATUS_ICON + STATUS_GAP)).setVisible(i < STATUS_MAX);
      i++;
    }
    const more = v.statusIcons.size - STATUS_MAX;
    if (more > 0 && !v.statusMore) {
      v.statusMore = text(this, 0, v.statusY, '', 18, '#ffffff', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 }).setOrigin(0, 0.5);
      v.node.add(v.statusMore);
    }
    if (v.statusMore) {
      v.statusMore.setVisible(more > 0);
      if (more > 0) v.statusMore.setText(`+${more}`).setX(v.statusX0 + STATUS_MAX * (STATUS_ICON + STATUS_GAP) - STATUS_ICON / 2);
    }
  }

  /**
   * Очередь значков перезарядки: готовые (по приоритету ядра), затем по времени готовности. Пересчёт — только когда
   * навык применён (готовность других от времени не меняет их порядок), значок в месте меняется без создания объектов.
   */
  private assignCooldowns(v: UnitView): void {
    if (!v.cdIcons.length) return;
    const now = this.clock;
    const queue = [...v.cdSkills].sort((a, b) => Math.max(a.readyAt, now) - Math.max(b.readyAt, now) || a.order - b.order);
    v.cdIcons.forEach((c, i) => {
      const s = queue[i] ?? null;
      if (c.s === s) return;
      c.s = s;
      c.shown = -1;
      if (s) c.icon.setTexture(skillIcon(this, s.skill)).setDisplaySize(CD_ICON, CD_ICON);
    });
  }

  /**
   * Круговая «шторка» перезарядки: тёмный сектор по часовой стрелке от 12 часов, у готового — золотая рамка.
   * Все 48 шагов сектора нарисованы заранее в лист (cooldownSheet) — здесь только смена кадра.
   */
  private drawCooldown(c: CdIcon): void {
    const s = c.s;
    if (!s) return;
    const left = s.cd > 0 ? Phaser.Math.Clamp((s.readyAt - this.clock) / s.cd, 0, 1) : 0;
    const k = Math.ceil(left * CD_STEPS);
    const q = k / CD_STEPS;
    if (q === c.shown) return;
    c.shown = q;
    c.sweep.setFrame(k > 0 ? CD_FRAME_READY + k : CD_FRAME_READY);
    c.icon.setAlpha(k > 0 ? CD_DIM : 1);
  }
}

/**
 * Лист шторок перезарядки (один на игру): те же фигуры, что раньше рисовал Graphics на каждый шаг, — тёмный сектор,
 * спроецированный на квадрат значка (до 65 точек луча), и золотая скруглённая рамка готового навыка.
 */
function cooldownSheet(scene: Phaser.Scene): string {
  if (scene.textures.exists(CD_SHEET)) return CD_SHEET;
  const px = CD_CELL * CD_RES;
  const frames = CD_STEPS + 2;
  const cols = 10;
  const rows = Math.ceil(frames / cols);
  const tex = scene.textures.createCanvas(CD_SHEET, cols * px, rows * px)!;
  const ctx = tex.getContext();
  const r = CD_ICON / 2;
  for (let f = 0; f < frames; f++) {
    const ox = (f % cols) * px;
    const oy = Math.floor(f / cols) * px;
    tex.add(f, 0, ox, oy, px, px);
    if (f === CD_FRAME_EMPTY) continue;
    ctx.save();
    ctx.translate(ox + px / 2, oy + px / 2);
    ctx.scale(CD_RES, CD_RES);
    ctx.beginPath();
    if (f === CD_FRAME_READY) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255, 216, 74, 0.95)';
      ctx.roundRect(-r - 1, -r - 1, CD_ICON + 2, CD_ICON + 2, 5);
      ctx.stroke();
    } else {
      const q = (f - CD_FRAME_READY) / CD_STEPS;
      ctx.moveTo(0, 0);
      const steps = Math.max(2, Math.ceil(q * 64));
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (q * Math.PI * 2 * i) / steps;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const k = r / Math.max(Math.abs(cos), Math.abs(sin));
        ctx.lineTo(cos * k, sin * k);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * CD_DIM})`;
      ctx.fill();
    }
    ctx.restore();
  }
  tex.refresh();
  return CD_SHEET;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Слизни (шлепок вместо укуса): поринг, дропс, попоринг, Мастеринг — и их цвет. */
const SLIMES: [RegExp, number][] = [
  [/poporing/, 0x9be36b],
  [/drops/, 0xffb050],
  [/mastering/, 0xff9ad0],
  [/^fast|poring|marin/, 0xff8fb8],
];

/**
 * Искра обычного удара юнита по виду (visual): стрелки — попадание стрелы, маги — магическая искра (служители — святая),
 * мечники — разрез, воры — двойной укол, торговцы/кузнецы/монахи — тупой удар; монстры — укус, слизни — шлепок,
 * рыцари/орки — разрез, жуки/деревья/кузнечики — тупой удар.
 */
function hitLook(def: UnitDef): { hitStyle: HitStyle; hitTint: number } {
  const s = def.visual.sprite;
  const p = def.visual.projectile;
  if (p === 'fx_arrow') return { hitStyle: 'arrow', hitTint: 0xffe0a0 };
  if (p === 'fx_magic') {
    if (/acolyte|priest/.test(s)) return { hitStyle: 'holy', hitTint: 0xfff0a0 };
    if (/mandragora/.test(s)) return { hitStyle: 'magic', hitTint: 0x9be36b };
    if (/dark/.test(s)) return { hitStyle: 'magic', hitTint: 0xb77aff };
    return { hitStyle: 'magic', hitTint: 0x9ab8ff };
  }
  if (def.kind === 'hero') {
    if (/thief|assassin|rogue/.test(s)) return { hitStyle: 'stab', hitTint: 0xe8f0ff };
    if (/merchant|blacksmith|monk|alchemist/.test(s)) return { hitStyle: 'blunt', hitTint: 0xffd890 };
    return { hitStyle: 'slash', hitTint: 0xdfeaff };
  }
  const slime = SLIMES.find(([re]) => re.test(s));
  if (slime) return { hitStyle: 'slime', hitTint: slime[1] };
  if (/warrior|guard|assassin|raydric|boss1|knight|swordman|novice|orc/.test(s)) return { hitStyle: 'slash', hitTint: 0xffc0a0 };
  if (/tank|rocker|elite|mimic|golem/.test(s)) return { hitStyle: 'blunt', hitTint: 0xffd890 };
  return { hitStyle: 'bite', hitTint: 0xff6a58 };
}

/** Постоянный оттенок юнита: заморожен — ледяной, иначе свой (visual.tint). */
const baseTint = (v: UnitView): number => (v.frozen ? FROZEN_TINT : unitTint(v.def.visual));

/**
 * Цвет и размер цифры урона по навыку: обычная атака — белая, магия (стихийный навык, каст) — цветом стихии
 * (огонь оранжевый, лёд голубой, молния жёлтая, прочая магия — сиреневая), активный навык — крупнее.
 */
/** Цвета цифр RO (tint белых цифр атласа, как в клиенте RO). */
const RO_TINT = {
  enemy: 0xffffff,
  hero: 0xff4a3a,
  ult: 0xffd23a,
  heal: 0x5cff6a,
  shield: 0x8cc8ff,
} as const;

function numberStyle(sk: SkillDef | undefined, src: UnitView | undefined): { color: string; size: number } {
  if (!sk) return { color: '#ffffff', size: 40 };
  const active = !!src && (src.def.skills.actives.includes(sk.id) || src.def.skills.ult === sk.id);
  const el = lookOf(sk).element;
  // Обычный выстрел мага (снаряд fx_magic) — тоже магия.
  const magicShot = sk.range === 'ranged' && src?.def.visual.projectile === 'fx_magic';
  const magic = (el !== 'physical' && (active || sk.castTime > 0)) || magicShot;
  const color = !magic ? '#ffffff' : el === 'neutral' || el === 'dark' || el === 'physical' ? '#c8b0ff' : ELEMENT_COLORS[el].light;
  return { color, size: active ? 46 : 40 };
}

/**
 * Эффект попадания по навыку атакующего: явная привязка из effects.json (skills.<id>.hit), иначе магия
 * (навык с кастом или дальний навык мага) — fx_magic, иначе эффект удара юнита (visual.hitFx).
 */
function hitFxOf(src: UnitView | undefined, skillId = src?.lastSkill): string {
  const mapped = skillFx(skillId)?.hit;
  if (mapped) return mapped;
  const sk = skillId ? CONTENT.skills[skillId] : undefined;
  const magic = !!sk && (sk.castTime > 0 || (sk.range === 'ranged' && src?.def.visual.projectile === 'fx_magic'));
  return magic ? 'fx_magic' : (src?.def.visual.hitFx ?? 'fx_hit');
}

/** Полоска заполняется обрезкой текстуры, чтобы скруглённые края не сжимались. */
function cropBar(img: Phaser.GameObjects.Image, pct: number): void {
  const p = Phaser.Math.Clamp(pct, 0, 1);
  img.setCrop(0, 0, img.frame.width * p, img.frame.height);
}

const fmt = (s: number) => {
  const sec = Math.floor(s);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};
/** Центр тела над точкой ног (y) — туда летят снаряды и всплывают цифры; x — это node.x. */
const bodyY = (v: UnitView) => v.node.y - v.look.height * 0.5;

/**
 * Чёткий пиксель-арт у юнитов с visual.scale (боссы ×1.3 и т. п.): итоговый масштаб листа округляется до шага 0.5
 * (3.2 × 1.3 = 4.16 → 4.0), чтобы пиксели листа ложились на экран ровной сеткой, а не «плыли» через один.
 * Размер меняется не больше чем на ~6%. Обычные юниты (×1) не трогаем — раскладка поля рассчитана на них.
 */
export function crispScale(view: { art: boolean; def?: { scale: number } }, k: number): number {
  if (k === 1 || !view.art || !view.def) return k;
  const src = view.def.scale * k;
  return Math.max(0.5, Math.round(src * 2) / 2) / view.def.scale;
}
