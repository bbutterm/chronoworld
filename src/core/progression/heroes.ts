import { Rng } from '../rng';
import type { HeroState } from '../save/schema';
import type { Gender, ProgressionConfig } from './schema';

type HeroesConfig = ProgressionConfig['heroes'];

/**
 * Пол по имени: сюжетные герои (names, recruits и их formerNames), затем legacyNames (старые сохранения).
 * Неизвестное имя — undefined.
 */
export function knownGender(name: string, cfg: HeroesConfig): Gender | undefined {
  const story = cfg.names.find((n) => n.name === name) ?? cfg.recruits.find((r) => r.name === name || r.formerNames?.includes(name));
  return story?.gender ?? cfg.legacyNames[name];
}

/** Пол героя: поле сохранения → таблица имён → 'm'. */
export function heroGender(hero: Pick<HeroState, 'name' | 'gender'>, cfg: HeroesConfig): Gender {
  return hero.gender ?? knownGender(hero.name, cfg) ?? 'm';
}

/**
 * Несюжетный герой: пол случайный, но детерминированный — от seed сохранения (createdAt) и номера героя;
 * имя — первое свободное из пула этого пола по кругу со случайного места (все заняты — с номером).
 */
export function generatedHero(seed: number, index: number, taken: string[], cfg: HeroesConfig): { name: string; gender: Gender } {
  const rng = new Rng((Math.floor(seed) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  const gender: Gender = rng.next() < 0.5 ? 'm' : 'f';
  const pool = cfg.namePools[gender];
  const start = rng.int(pool.length);
  for (let k = 0; k < pool.length; k++) {
    const name = pool[(start + k) % pool.length];
    if (!taken.includes(name)) return { name, gender };
  }
  return { name: `${pool[start]} ${index + 1}`, gender };
}

/**
 * Привести героя старого сохранения к текущему составу: прежнее имя сюжетного рекрута (formerNames) → текущее,
 * нет пола — по таблице имён (неизвестное имя → 'm'). Ничего не меняли — тот же объект.
 */
export function normalizeHeroIdentity(hero: HeroState, cfg: HeroesConfig): HeroState {
  const renamed = cfg.recruits.find((r) => r.formerNames?.includes(hero.name));
  if (!renamed && hero.gender) return hero;
  const { id, name: _old, gender: _g, ...rest } = hero;
  // Порядок ключей как в схеме (id, name, gender, …) — serialize(deserialize(x)) === x.
  return { id, name: renamed?.name ?? hero.name, gender: renamed ? renamed.gender : heroGender(hero, cfg), ...rest };
}
