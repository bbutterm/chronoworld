import type { TacticalTip } from './tactics';

/** Совет экрана поражения (flow.ts defeatAdvice): текст и выделенная плитка. */
export interface DefeatTip {
  text: string;
  action: 'EquipBest' | 'Heroes' | 'Squad' | 'Campaign';
}

/** Строка под мощью на поражении, когда мощь не ниже ориентира: дело не в прокачке. */
export const DEFEAT_POWER_OK = 'Мощь выше ориентира — решают состав и расстановка';

/**
 * Поражение при мощи не ниже ориентира (ux 0, ui-core 9): общий запасной совет «Прокачайте героев…» (action
 * Campaign) спорит с числом мощи — вместо него угроза этапа и ответ на неё (как на «Этапе», tactics.ts
 * encounterThreat), иначе — совет сменить расстановку или состав; выделена плитка «Отряд» (ведёт на «Этап»).
 * Тактический разбор боя, «Надеть лучшее», уровень и вознесение остаются: они по делу при любой мощи.
 */
export function defeatTip(tip: DefeatTip, own: number, need: number, threat: TacticalTip | null): DefeatTip {
  if (own < need || tip.action !== 'Campaign') return tip;
  if (threat) return { text: `${threat.text}. ${threat.advice}`, action: 'Squad' };
  return { text: 'Попробуйте другую расстановку или состав: «Отряд» → «Авто» или герой с оглушением.', action: 'Squad' };
}
