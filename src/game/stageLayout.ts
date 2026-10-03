import { GAME_H } from './layout';

/** Геометрия подготовки: угроза занимает отдельную полосу между полем и кнопками отряда. */
export const STAGE_LAYOUT = {
  rewardY: 212,
  field: { top: 270, bottom: 990 },
  powerY: 310,
  shortY: 350,
  threat: { titleY: 1020, adviceY: 1064, zoneY: 1038, zoneH: 88 },
  rosterHeadY: 1132,
  roster: { top: 1188, bottom: 1704 },
  fightY: GAME_H - 110,
} as const;
