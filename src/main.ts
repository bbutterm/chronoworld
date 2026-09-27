import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene';
import { HomeScene } from './game/scenes/HomeScene';
import { CampaignScene } from './game/scenes/CampaignScene';
import { StageScene } from './game/scenes/StageScene';
import { HeroesScene } from './game/scenes/HeroesScene';
import { HeroScene } from './game/scenes/HeroScene';
import { JobChangeScene } from './game/scenes/JobChangeScene';
import { PrepScene } from './game/scenes/PrepScene';
import { BattleScene } from './game/scenes/BattleScene';
import { ResultScene } from './game/scenes/ResultScene';
import { QuestsScene } from './game/scenes/QuestsScene';
import { TowerScene } from './game/scenes/TowerScene';
import { InventoryScene } from './game/scenes/InventoryScene';
import { SquadScene } from './game/scenes/SquadScene';
import { BountiesScene } from './game/scenes/BountiesScene';
import { AchievementsScene } from './game/scenes/AchievementsScene';
import { GAME_H, GAME_W } from './game/layout';
import { installLifecycle, type LoopLike } from './game/lifecycle';
import { spritesBusy, spriteStats } from './game/sprites';
import { fps } from './game/state';
import { installTransitions } from './game/transitions';

// Затемнение между экранами и защита от двойного нажатия во время перехода.
installTransitions();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#11131a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_W,
    height: GAME_H,
  },
  // U: 30 FPS по настройке — ограничитель ставит installLifecycle ниже (его можно менять на лету).
  fps: { target: 60 },
  scene: [BootScene, HomeScene, CampaignScene, StageScene, HeroesScene, HeroScene, JobChangeScene, PrepScene, BattleScene, ResultScene, QuestsScene, TowerScene, InventoryScene, SquadScene, BountiesScene, AchievementsScene],
});

// U: пауза, когда игру не видно (вкладка скрыта, окно без фокуса, Mini App свёрнут), и ограничение FPS.
const lifecycle = installLifecycle(game.loop as unknown as LoopLike, fps.cap);

// Для отладки и скриншотов (Playwright): window.__game.scene.start('Tower') и т. п. Только в dev-сборке.
// __sprites.busy() — идёт загрузка листов юнитов (e2e/perf ждут), __sprites.stats() — кэш листов.
if (import.meta.env.DEV) {
  Object.assign(window, { __game: game, __sprites: { busy: spritesBusy, stats: spriteStats }, __lifecycle: lifecycle });
}
