import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene';
import { HomeScene } from './game/scenes/HomeScene';
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
import { ensureAnimatedFx } from './game/assets';
import { webpReady } from './game/assetUrl';
import { installLifecycle, type LoopLike } from './game/lifecycle';
import { spritesBusy, spriteStats } from './game/sprites';
import { fps } from './game/state';
import { installTransitions } from './game/transitions';
import { installUnlockGates } from './game/unlockBanner';
import { initialView, installViewport, LANDSCAPE_PHONE, view } from './game/viewport';

performance.mark('cw:script');

// Затемнение между экранами и защита от двойного нажатия во время перехода.
installTransitions();

// Пакет загрузки выбирается по поддержке WebP (assetUrl.ts): проверка асинхронная и занимает миллисекунды — ждём её,
// но не дольше 300 мс (иначе — PNG).
await Promise.race([webpReady, new Promise((r) => window.setTimeout(r, 300))]);

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
  scene: [BootScene, HomeScene, CampaignScene, StageScene, HeroesScene, HeroScene, AscendScene, HeroPickScene, PrepScene, BattleScene, ResultScene, QuestsScene, TowerScene, HuntScene, InventoryScene, SquadScene, ExpeditionsScene, AchievementsScene, TavernScene, EventsScene, MailScene, ShopScene],
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

// T4-12: анимированные эффекты боя — по дороге к бою, а не при старте (≈ 14 МБ видеопамяти на главной).
game.events.once(Phaser.Core.Events.READY, () => {
  for (const key of ['Stage', 'Tower', 'Hunt', 'Battle', 'Prep']) game.scene.getScene(key)?.sys.events.on(Phaser.Scenes.Events.START, () => ensureAnimatedFx(game));
});

// U: пауза, когда игру не видно (вкладка скрыта, окно без фокуса, Mini App свёрнут), и ограничение FPS.
const lifecycle = installLifecycle(game.loop as unknown as LoopLike, fps.cap);

// T3-01: телефон повёрнут — поверх игры заглушка «Поверните телефон» (index.html), игра стоит на паузе, пока её не видно.
const landscape = window.matchMedia(LANDSCAPE_PHONE);
// Экран загрузки не останавливаем: пока телефон повёрнут, игра успеет загрузиться.
let booted = false;
const onOrientation = () => (landscape.matches && booted ? lifecycle.pause('landscape') : lifecycle.resume('landscape'));
landscape.addEventListener('change', onOrientation);
game.events.once(Phaser.Core.Events.READY, () =>
  game.scene.getScene('Boot')?.sys.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    booted = true;
    onOrientation();
  }),
);

// Для отладки и скриншотов (Playwright): window.__game.scene.start('Tower') и т. п. Только в dev-сборке.
// __sprites.busy() — идёт загрузка листов юнитов (e2e/perf ждут), __sprites.stats() — кэш листов.
if (import.meta.env.DEV) {
  Object.assign(window, { __game: game, __sprites: { busy: spritesBusy, stats: spriteStats }, __lifecycle: lifecycle, __view: view });
}
