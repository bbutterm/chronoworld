/**
 * Свои звуки монстров из клиента RO (docs/design/audio.md, «Звуки монстров»): data/monster_sounds.json — лист спрайта
 * (visual.sprite юнита) → звуки атаки и смерти, как их называет ACT монстра (raw/ro-build/sprites.fragment.json →
 * sourceSounds). Файлы — assets/audio/mon_<имя>.ogg|m4a (tools/ro_audio.py). Без Phaser и DOM: схему читают
 * content:check и content:schema.
 */
import { z } from 'zod';

/** Имя звука RO без .wav (латиница в нижнем регистре): mon_<имя> — файл в assets/audio/. */
const soundName = z.string().regex(/^[a-z0-9_]+$/, 'имя звука RO без .wav: латиница a-z0-9_');

export const MonsterSoundSchema = z.object({
  /** Монстр в RO (для справки: чей звук). */
  ro: z.string().optional(),
  /** Удар монстра (вместо общего взмаха). Несколько — по очереди. */
  attack: z.array(soundName).min(1).optional(),
  /** Смерть (вместо общего «пуф»). Несколько — по очереди. */
  death: z.array(soundName).min(1).optional(),
});

export const MonsterSoundsSchema = z.object({
  $schema: z.string().optional(),
  /** id листа спрайта (как visual.sprite в data/units) → звуки. */
  sprites: z.record(z.string().regex(/^[a-z0-9_]+$/), MonsterSoundSchema),
});

export type MonsterSound = z.infer<typeof MonsterSoundSchema>;
export type MonsterSounds = z.infer<typeof MonsterSoundsSchema>;
export type MonsterSoundKind = 'attack' | 'death';

/** Имя файла в assets/audio/ (без расширения) для звука RO. */
export const monsterSoundFile = (name: string): string => `mon_${name}`;

/** Все файлы, на которые ссылается таблица (для сборки и проверки). */
export function monsterSoundFiles(t: MonsterSounds): string[] {
  const out = new Set<string>();
  for (const s of Object.values(t.sprites)) for (const n of [...(s.attack ?? []), ...(s.death ?? [])]) out.add(monsterSoundFile(n));
  return [...out].sort();
}
