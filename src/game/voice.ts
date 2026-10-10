/**
 * Озвучка реплик и страниц рассказчика. Клипы заранее сгенерированы (scripts/voice-gen.ts, ElevenLabs) и лежат в
 * assets/voice/ru/<voiceKey(текст)>.mp3: экран просто просит «озвучь этот текст» — есть клип, он звучит, нет — тишина.
 * У личных сцен героев две версии: молодая (ключ.mp3) и взрослая (ключ-a.mp3, после главы 4 — setVoiceGrown).
 * Звучит только русская озвучка и только при русском интерфейсе (английской пока нет). Громкость — «Озвучка» в
 * настройках (audioSettings.voice), канал и приглушение музыки — audio.ts.
 */
import { playVoiceFile, stopVoiceFile } from './audio';
import { LOCALE } from './locale';
import { voiceKey } from './voiceKey';

/** Какие клипы есть (имена файлов без расширения) — по списку файлов на этапе сборки, без запросов. */
const CLIPS = new Set(
  Object.keys(import.meta.glob('../../assets/voice/ru/*.mp3', { query: '?url', import: 'default' })).map((p) => p.split('/').pop()!.replace(/\.mp3$/, '')),
);

const urlOf = (key: string) => `voice/ru/${key}.mp3`;

/** Есть ли озвучка у текста (для языка интерфейса). */
export function hasVoice(text: string | undefined): boolean {
  return LOCALE === 'ru' && !!text && CLIPS.has(voiceKey(text));
}

let queue = 0;
/** Герои выросли (core heroesGrown): у текста есть взрослая версия клипа (ключ-a, личные сцены) — звучит она. */
let grown = false;
export function setVoiceGrown(on: boolean): void {
  grown = on;
}
const clipOf = (text: string) => {
  const key = voiceKey(text);
  return grown && CLIPS.has(`${key}-a`) ? `${key}-a` : key;
};

/**
 * Озвучить тексты по очереди (страница: цитата, текст, комментарий героя); прежняя озвучка обрывается.
 * Возвращает общую длительность прозвучавшего, когда очередь кончилась (null — ничего не прозвучало или перебили).
 */
export async function speak(...texts: (string | undefined)[]): Promise<number | null> {
  const id = ++queue;
  const keys = texts.filter((t): t is string => hasVoice(t)).map(clipOf);
  if (!keys.length) {
    stopVoiceFile();
    return null;
  }
  let total = 0;
  for (const [i, key] of keys.entries()) {
    const dur = await playVoiceFile(key, urlOf(key));
    if (dur === null || id !== queue) return id === queue && total ? total : null;
    total += dur;
    // Следующий кусок — после конца этого и короткой паузы (как вдох чтеца).
    if (i + 1 < keys.length) await new Promise((ok) => setTimeout(ok, dur * 1000 + 350));
    if (id !== queue) return null;
  }
  return total;
}

/** Замолчать (листание, «Пропустить», закрытие окна). */
export function hush(): void {
  queue++;
  stopVoiceFile();
}
