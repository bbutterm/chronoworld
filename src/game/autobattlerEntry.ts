import type Phaser from 'phaser';
import { autobattlerConfig, autobattlerStatus } from '../core';
import { GAME } from './content';
import { modeBanner, type ModeBanner } from './featureTiles';
import { session, today } from './session';
import { COLOR_N } from './theme';
import { autobattlerDailyReward } from './autobattlerView';

export function autobattlerTile(scene: Phaser.Scene, x: number, y: number, w: number, h: number): ModeBanner {
  const state = autobattlerStatus(session.save, GAME);
  const cfg = autobattlerConfig(GAME);
  const budget = autobattlerDailyReward(session.save, today(), cfg);
  return modeBanner(scene, x, y, w, h, {
    name: 'autobattlerTile',
    title: cfg.name,
    open: state.unlocked,
    lockId: 'autobattler',
    onOpen: () => scene.scene.start('Autobattler'),
    colors: [COLOR_N.surfaceRaised, COLOR_N.surfaceSunken],
    backdrop: { kind: 'battle', theme: 'meadow', focusY: 1320 },
    figures: [{ sprite: 'warrior' }, { sprite: 'priest' }, { sprite: 'archer' }],
    figureH: 0.72,
    actionFooter: true,
    status: {
      text: state.run ? `Продолжить · раунд ${state.run.round} / ${cfg.rounds}` : budget.canImprove ? `${cfg.rounds} раундов · лавка и связки` : 'Награда дня получена',
      tone: state.run ? 'accent' : 'neutral',
    },
  });
}
