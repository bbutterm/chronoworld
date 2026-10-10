import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene';
import { HomeScene } from './game/scenes/HomeScene';
import { AdventureScene } from './game/scenes/AdventureScene';
import { AutobattlerScene } from './game/scenes/AutobattlerScene';
import { CampaignScene } from './game/scenes/CampaignScene';
import { StageScene } from './game/scenes/StageScene';
import { HeroesScene } from './game/scenes/HeroesScene';
import { HeroScene } from './game/scenes/HeroScene';
import { AscendScene } from './game/scenes/AscendScene';
import { HeroPickScene } from './game/scenes/HeroPickScene';
import { PrepScene } from './game/scenes/PrepScene';
import { BattleScene } from './game/scenes/BattleScene';
import { ResultScene } from './game/scenes/ResultScene';
import { QuestsScene } from './game/scenes/QuestsScene';
import { TowerScene } from './game/scenes/TowerScene';
import { HuntScene } from './game/scenes/HuntScene';
import { InventoryScene } from './game/scenes/InventoryScene';
import { SquadScene } from './game/scenes/SquadScene';
import { ExpeditionsScene } from './game/scenes/ExpeditionsScene';
import { AchievementsScene } from './game/scenes/AchievementsScene';
import { TavernScene } from './game/scenes/TavernScene';
import { EventsScene } from './game/scenes/EventsScene';
import { MailScene } from './game/scenes/MailScene';
import { ShopScene } from './game/scenes/ShopScene';
import { KitchenScene } from './game/scenes/KitchenScene';
import { ChronicleScene } from './game/scenes/ChronicleScene';
import { FriendsScene } from './game/scenes/FriendsScene';
import { startOnline } from './game/online/online';
import { holdAnimatedFx } from './game/assets';
import { battleFxIds } from './game/animatedFx';
import { webpReady } from './game/assetUrl';
import { installLifecycle, type LoopLike } from './game/lifecycle';
import { spritesBusy, spriteStats } from './game/sprites';
import { fps } from './game/state';
import { installTransitions } from './game/transitions';
import { installUnlockGates } from './game/unlockBanner';
import { initialView, installViewport, LANDSCAPE_PHONE, view } from './game/viewport';
import { FONT_FACES } from './game/theme';
import { installI18n } from './game/locale';

performance.mark('cw:script');

// Затемнение между экранами и защита от двойного нажатия во время перехода.
installTransitions();

// Пакет загрузки выбирается по поддержке WebP (assetUrl.ts): проверка асинхронная и занимает миллисекунды — ждём её,
// но не дольше 300 мс (иначе — PNG).
await Promise.race([webpReady, new Promise((r) => window.setTimeout(r, 300))]);

// Шрифты интерфейса (index.html: @font-face и preload — качаются вместе с JS, к этому моменту обычно уже пришли).
// Phaser.Text рисует текст один раз при создании: без шрифта он запечёт системный. Ждём не дольше FONT_WAIT_MS —
// на совсем медленной сети экран загрузки будет системным шрифтом, следующие экраны — уже своим.
const FONT_WAIT_MS = 2000;
// Язык: словарь перевода (не для русского) — до первого Phaser.Text (locale.ts).
await installI18n().catch((e) => console.warn('i18n', e));
const fontsReady = Promise.all(FONT_FACES.map((f) => document.fonts?.load(f, 'Аа1'))).catch(() => undefined);
await Promise.race([fontsReady, new Promise((r) => window.setTimeout(r, FONT_WAIT_MS))]);
performance.mark('cw:fonts');

const startView = initialView();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0a0907',
  // P8: холст — под размер окна и devicePixelRatio, мир 1080×1920 масштабирует камера сцены (viewport.ts).
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: startView.backW,
    height: startView.backH,
    zoom: 1 / startView.density,
  },
  // U: 30 FPS по настройке — ограничитель ставит installLifecycle ниже (его можно менять на лету).
  fps: { target: 60 },
  scene: [BootScene, HomeScene, AdventureScene, AutobattlerScene, CampaignScene, StageScene, HeroesScene, HeroScene, AscendScene, HeroPickScene, PrepScene, BattleScene, ResultScene, QuestsScene, TowerScene, HuntScene, InventoryScene, SquadScene, ExpeditionsScene, AchievementsScene, TavernScene, EventsScene, MailScene, ShopScene, KitchenScene, ChronicleScene, FriendsScene],
});

installViewport(game);
// Скорость боя ×2 закрыта до своего этапа (data/unlocks.json) — проверка и тост «Откроется на этапе…».
installUnlockGates(game);

// Метки для замера холодного старта (scripts/perf-load.mjs, docs/content/performance.md):
// первый кадр экрана загрузки и первый кадр главной после её create() — с этого момента она принимает нажатия.
// Первый кадр экрана загрузки заменяет HTML-заставку (index.html, #splash) — плавно, без мигания.
game.events.once(Phaser.Core.Events.POST_RENDER, () => {
  performance.mark('cw:boot-frame');
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('gone');
  window.setTimeout(() => splash.remove(), 250);
});
game.events.once(Phaser.Core.Events.READY, () => {
  for (const key of ['Home', 'Campaign']) {
    game.scene.getScene(key)?.sys.events.once(Phaser.Scenes.Events.CREATE, () =>
      game.events.once(Phaser.Core.Events.POST_RENDER, () => performance.getEntriesByName('cw:home').length || performance.mark('cw:home')),
    );
  }
});

// T4-12: общие анимированные эффекты боя (удар, магия, смерть…) — по дороге к бою, а не при старте. Эффекты навыков
// грузит сам бой (только своих юнитов): все листы каталога вместе — ≈ 100 МБ видеопамяти.
game.events.once(Phaser.Core.Events.READY, () => {
  for (const key of ['Stage', 'Tower', 'Hunt', 'Prep', 'Autobattler']) {
    game.scene.getScene(key)?.sys.events.on(Phaser.Scenes.Events.START, (sys: Phaser.Scenes.Systems) => void holdAnimatedFx(sys.scene, battleFxIds([])));
  }
});

// U: пауза, когда игру не видно (вкладка скрыта, окно без фокуса, Mini App свёрнут), и ограничение FPS.
// Экран загрузки — только полоса и надписи: пока он на экране, кадров не больше BOOT_FPS. Каждый кадр Phaser
// (шаг сцены + отрисовка) занимает главный поток, а он нужен загрузчику: ~320 картинок пакета, их декодирование
// и текстуры. На CPU ×4 загрузка пакета шла ~4 с при 60 FPS (docs/qa/load-2026-10-10.md). После экрана загрузки —
// ограничение из настроек.
const BOOT_FPS = 10;
const lifecycle = installLifecycle(game.loop as unknown as LoopLike, Math.min(fps.cap, BOOT_FPS));

// T3-01: телефон повёрнут — поверх игры заглушка «Поверните телефон» (index.html), игра стоит на паузе, пока её не видно.
const landscape = window.matchMedia(LANDSCAPE_PHONE);
// Экран загрузки не останавливаем: пока телефон повёрнут, игра успеет загрузиться.
let booted = false;
const onOrientation = () => (landscape.matches && booted ? lifecycle.pause('landscape') : lifecycle.resume('landscape'));
landscape.addEventListener('change', onOrientation);
game.events.once(Phaser.Core.Events.READY, () =>
  game.scene.getScene('Boot')?.sys.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    booted = true;
    // Не из середины шага Phaser (выключение сцены идёт внутри него): ограничитель перезапускает цикл.
    window.setTimeout(() => lifecycle.setFpsCap(fps.cap), 0);
    onOrientation();
  }),
);

// Онлайн фаза 1 (только в Telegram; вне его и без сети — ничего): вход, облачное сохранение, sync после побед.
if (import.meta.env?.VITE_ADVANCE_LAB !== '1') startOnline(game);
if (import.meta.env?.VITE_ADVANCE_LAB === '1') {
  const { installAdvanceLab } = await import('./game/lab');
  const { resetAdvanceLab, session } = await import('./game/session');
  installAdvanceLab(resetAdvanceLab, () => JSON.parse(JSON.stringify(session.save)), game);
}

// Для отладки и скриншотов (Playwright): window.__game.scene.start('Tower') и т. п. Только в dev-сборке.
// __sprites.busy() — идёт загрузка листов юнитов (e2e/perf ждут), __sprites.stats() — кэш листов.
if (import.meta.env.DEV) {
  Object.assign(window, { __game: game, __sprites: { busy: spritesBusy, stats: spriteStats }, __lifecycle: lifecycle, __view: view });
}
