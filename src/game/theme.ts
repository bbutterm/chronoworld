/**
 * Дизайн-токены экранов: шрифт, отступы, радиусы, цвета по ролям, глубины, движение (docs/design/ui-polish-research.md, §4).
 * Все числа — в игровых единицах (поле 1080×1920). На телефоне игра масштабируется примерно ×0.36 (390 px)
 * и ×0.33 (360×640) — проверять по худшему случаю. Правила — docs/content/ui.md.
 *
 * Новый код берёт только новые токены (T, S, R, COLOR, Z, M, E, FAMILY). Старые FS/C/SP/TINT/OUTLINE/TITLE_STYLE —
 * алиасы на них на время миграции экранов (итерации 2–9), удаляются в итерации 10.
 */

// ———————————————————————————————————————— Шрифт ————————————————————————————————————————

/**
 * Гарнитуры (OFL, свои woff2 в assets/fonts, подмножество латиница + кириллица + знаки; грузятся до первой сцены — main.ts):
 * заголовки — Philosopher Bold (фэнтези-антиква с кириллицей), всё остальное — Rubik Medium/Bold (ровные цифры).
 * Запасные — системные: если шрифт не успел загрузиться, игра остаётся читаемой.
 */
export const FAMILY = {
  heading: 'Philosopher, Georgia, "Times New Roman", serif',
  body: 'Rubik, Arial, "Helvetica Neue", sans-serif',
} as const;

/** Файлы шрифтов (пути внутри assets/, в dist — те же; index.html объявляет @font-face и preload с ними). */
export const FONT_FILES = ['fonts/philosopher-700.woff2', 'fonts/rubik-500.woff2', 'fonts/rubik-700.woff2'] as const;
/** Начертания, которые main.ts дожидается до первой сцены (document.fonts.load). */
export const FONT_FACES = ['700 60px Philosopher', '500 40px Rubik', '700 40px Rubik'] as const;

/**
 * Шкала шрифта: пять размеров с шагом ~1.25. На 390 px: 31.8 / 21.7 / 17.3 / 14.4 / 12.3 px.
 * display и title — заголовочная гарнитура; heading/body/caption — текстовая (bold — только заголовки и числа).
 */
export const T = {
  /** «ПОБЕДА», «Глава 5», имя героя на карточке, мощь крупно. */
  display: 88,
  /** Заголовок экрана/модалки, главная кнопка «В бой». */
  title: 60,
  /** Заголовок карточки/секции, подписи кнопок, важные числа. */
  heading: 48,
  /** Основной текст, строки списков, описания навыков. */
  body: 40,
  /** Подписи под иконками, бейджи, вкладки, статы. Меньше не бывает. */
  caption: 34,
} as const;
export type TypeToken = keyof typeof T;

/** Межстрочный множитель по токену; Phaser берёт добавку в единицах: lineSpacing = (k − 1) · size — см. leading(). */
export const LEADING: Record<TypeToken, number> = { display: 1.15, title: 1.15, heading: 1.15, body: 1.35, caption: 1.25 };

/** lineSpacing для Phaser.Text по размеру шрифта (ближайший токен снизу). */
export function leading(size: number): number {
  const k = size >= T.heading ? LEADING.heading : size >= T.body ? LEADING.body : LEADING.caption;
  return Math.round((k - 1) * size);
}

// ———————————————————————————————————————— Сетка ————————————————————————————————————————

/** Отступы, сетка 8: поля экрана S.l, внутри карточки S.m, между карточками S.s, между секциями S.xl. */
export const S = { xxs: 8, xs: 16, s: 24, m: 32, l: 48, xl: 64, xxl: 96 } as const;

/** Радиусы: бейдж/чип, кнопка/слот, карточка, модалка/лист снизу, «таблетка». */
export const R = { s: 12, m: 20, l: 28, xl: 40, pill: 999 } as const;

/** Минимальная высота (и ширина) цели нажатия: 96 ед. ≈ 35 px на 390 px. */
export const TOUCH = 96;

// ———————————————————————————————————————— Цвета по ролям ————————————————————————————————————————

/**
 * 12 ролей (тёмная бронза; контраст считан на surface #1f1c18). Строки — для Phaser.Text, всегда #rrggbb
 * (экраны переводят их в числа через HexStringToColor). Числа для заливок — COLOR_N.
 */
export const COLOR = {
  bg: '#0d0e0b',
  /** Поверхность без рамки (заливка ~85 %). */
  surface: '#1f1c18',
  /** Поднятая карточка: градиент surfaceRaised → surface, рамка border. */
  surfaceRaised: '#2b2721',
  /** Поле ввода, пустой слот. */
  surfaceSunken: '#14120f',
  border: '#5c4b31',
  /** Основной текст, 14.5:1. */
  textPrimary: '#f3ead6',
  /** Вторичный текст (пояснения, подписи статов), 8.4:1. */
  textSecondary: '#c2b59a',
  /** Третичный (недоступно, получено), 4.6:1 — только от T.body и не для смысла. */
  textTertiary: '#8f8571',
  /** Акцент: главная кнопка, «можно забрать». Текст на нём — onAccent. */
  accent: '#e8b85a',
  onAccent: '#2a1c08',
  /** Заголовки (на арте и карточках), 11:1. */
  title: '#f0cf8a',
  positive: '#8fd694',
  negative: '#ff8a73',
  warning: '#f2c46b',
  info: '#7cc4ff',
  /** Валюты. */
  gold: '#ffd84a',
  gem: '#9fe8ff',
  /** Красная точка/число (точка 24 ед., с числом 44 ед.). */
  badge: '#e0392b',
} as const;
export type ColorRole = keyof typeof COLOR;

/** Тот же цвет числом — для заливок, tint, Graphics. */
export const hexNum = (hex: string): number => parseInt(hex.slice(1, 7), 16);
export const COLOR_N = Object.fromEntries(Object.entries(COLOR).map(([k, v]) => [k, hexNum(v)])) as { readonly [K in ColorRole]: number };

/** Цвета редкости героев и предметов: зелёный → синий → фиолетовый → золотой → красный. */
export const RARITY = { green: '#5fbf5a', blue: '#4a90e2', purple: '#a35fe0', gold: '#f0a030', red: '#e04848' } as const;

// ———————————————————————————————————————— Глубины и движение ————————————————————————————————————————

/** Глубины (setDepth) слоёв экрана. */
export const Z = { content: 0, sticky: 100, nav: 200, hint: 8000, modal: 8500, confirm: 9000, toast: 9500 } as const;

/** Длительности, мс: нажатие/отпускание, панели, акцент, счётчик награды. */
export const M = { press: 80, release: 120, fast: 140, base: 220, slow: 360, emphasis: 600, count: 900 } as const;

/** Кривые твинов Phaser. */
export const E = { out: 'Cubic.easeOut', in: 'Quad.easeIn', inOut: 'Sine.easeInOut', pop: 'Back.easeOut' } as const;

// ———————————————————————————————————————— Текст: гарнитура, обводка ————————————————————————————————————————

/**
 * Обводка текста. Толстая чёрная обводка на тёмных карточках делала текст «жирным и грязным» — теперь это тонкий
 * полупрозрачный контур: на тёмной поверхности почти не виден, на арте (бой, карта, диорама) отделяет буквы от фона.
 */
const STROKE = '#000000a0';
/** Тёмно-коричневый: обводка золотых заголовков и (в трёх местах) цвет тёмной подписи на золоте — поэтому непрозрачный. */
const TITLE_STROKE = '#3a2412';

/**
 * Гарнитура по стилю текста — для text() в ui.ts: заголовочная у крупных (от T.title без малого: FS.hero, T.display)
 * и у «золотых заголовков» (обводка C.titleStroke / TITLE_STYLE) от T.body; мельче Philosopher теряет вес —
 * там текстовая. Явный fontFamily в стиле главнее.
 */
export function familyFor(size: number, style: { fontFamily?: string; stroke?: string | unknown } = {}): string {
  if (style.fontFamily) return style.fontFamily;
  return size >= T.title - 4 || (style.stroke === TITLE_STROKE && size >= T.body) ? FAMILY.heading : FAMILY.body;
}

// ———————————————————————————————————————— Алиасы старых токенов ————————————————————————————————————————

/**
 * Старые размеры (алиасы на время миграции; новый код — только T.*). Экраны свёрстаны под них с фиксированными строками,
 * поэтому плотные размеры (36/32/30) пока прежние: их заменят на T.body/T.caption итерации 4–9 вместе с вёрсткой экранов
 * (Rubik на ~5 % шире Arial, цифры — на ~10 %; простой переход на 34/40 наложил строки друг на друга).
 * Крупные — уже на шкале: главная кнопка — T.title заголовочной гарнитурой, h1/h2 — T.heading/T.body.
 */
export const FS = {
  /** Главная кнопка экрана («В бой», «Штурм»). */
  hero: T.title,
  /** Крупные заголовки внутри экрана (название героя, «Башня пока закрыта»), заголовок шапки. */
  h1: T.heading,
  /** Заголовки карточек и секций. */
  h2: T.body,
  /** Имена в строках списков, важные числа, подписи кнопок в строках. → T.body (жирный). */
  h3: 36,
  /** Основной текст. → T.body. */
  body: 32,
  /** Вторичный текст: пояснения, статус. → T.caption. */
  small: 30,
  /** Подписи под иконками, «фронт/тыл», цифры на полосах. → T.caption. */
  caption: 30,
} as const;

/** Цвета текста (алиасы ролей COLOR). */
export const C = {
  /** Основной светлый текст на тёмной карточке. */
  text: COLOR.textPrimary,
  /** Заголовки, названия. */
  title: COLOR.title,
  /** Пояснения на тёмной карточке. */
  muted: COLOR.textSecondary,
  /** Служебные подписи («фронт», «тыл», слот). */
  dim: COLOR.textSecondary,
  /** Недоступно, закрыто, получено. */
  disabled: COLOR.textTertiary,
  /** Пустое место в слоте. */
  placeholder: COLOR.textTertiary,
  gold: COLOR.gold,
  gem: COLOR.gem,
  /** Успех, готово, «в отряде». */
  success: COLOR.positive,
  /** Улучшение (разница статов, «сильнее»). */
  positive: COLOR.positive,
  /** Босс, ухудшение, запрет. */
  danger: COLOR.negative,
  /** Сильно хуже («намного слабее»). */
  dangerStrong: COLOR.negative,
  /** Тост-ошибка. */
  error: COLOR.negative,
  /** Предупреждение (ещё не готово). */
  warning: COLOR.warning,
  /** Информация, редкое, экипировка. */
  info: COLOR.info,
  /** Противник. */
  enemy: COLOR.negative,
  /** Щит (таблица итогов боя). */
  shield: COLOR.info,
  /** Текст на «светлой» карточке (ui_panel_light, выбранный слот) — в скине «тёмная бронза» она тоже тёмная. */
  ink: COLOR.textPrimary,
  inkMuted: COLOR.textSecondary,
  inkSuccess: COLOR.positive,
  inkInfo: COLOR.info,
  inkGold: COLOR.title,
  /** Фон плашки «БОСС». */
  labelDanger: '#b83a2a',
  /** Фон плашки «занят». */
  labelBusy: '#7a2a20',
  /** Обводка светлого текста (тонкая, полупрозрачная). */
  stroke: STROKE,
  /** Обводка золотых заголовков; по ней text() выбирает заголовочную гарнитуру (familyFor). Иногда — цвет тёмной подписи на золоте. */
  titleStroke: TITLE_STROKE,
  /** Прозрачная обводка (текст без обводки). */
  none: '#00000000',
} as const;

/** Цвета заливок (числа для прямоугольников и tint). */
export const TINT = {
  gold: COLOR_N.gold,
  frame: 0xc8a060,
  header: 0x1d140c,
  success: 0x6fd06f,
  info: 0x6fb8ff,
  danger: 0xd64545,
  badge: COLOR_N.badge,
  /** Подложка чекбокса (выключен) и тёмные плашки. */
  checkOff: 0x1a120a,
  /** Затемнение нажатой карточки. */
  pressed: 0x000000,
} as const;

/** Отступы (старые; новые — S). */
export const SP = { xs: S.xxs, s: S.xs, m: S.s, l: 40, xl: 60 } as const;

/** Поле экрана по бокам и ширина стандартной карточки (старые; новые поля — S.l). */
export const MARGIN = 20;
export const CARD_W = 1040;

/** Подпись светлым текстом поверх арта или полупрозрачной плашки: тонкий полупрозрачный контур. */
export const OUTLINE = { stroke: C.stroke, strokeThickness: 3 } as const;
/** Заголовок карточки: золото, заголовочная гарнитура (по titleStroke), лёгкий контур. */
export const TITLE_STYLE = { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 3 } as const;
