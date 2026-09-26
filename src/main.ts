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
  scene: [BootScene, HomeScene, CampaignScene, StageScene, HeroesScene, HeroScene, JobChangeScene, PrepScene, BattleScene, ResultScene, QuestsScene, TowerScene, InventoryScene, SquadScene, BountiesScene, AchievementsScene],
});

// Для отладки и скриншотов (Playwright): window.__game.scene.start('Tower') и т. п. Только в dev-сборке.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
