/**
 * Озвучка реплик и страниц рассказчика. Клипы заранее сгенерированы (scripts/voice-gen.ts, ElevenLabs) и лежат в
 * assets/voice/ru/<voiceKey(текст)>.mp3: экран просто просит «озвучь этот текст» — есть клип, он звучит, нет — тишина.
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

/**
 * Озвучить тексты по очереди (страница: цитата, текст, комментарий героя); прежняя озвучка обрывается.
 * Возвращает общую длительность прозвучавшего, когда очередь кончилась (null — ничего не прозвучало или перебили).
 */
export async function speak(...texts: (string | undefined)[]): Promise<number | null> {
  const id = ++queue;
  const keys = texts.filter((t): t is string => hasVoice(t)).map(voiceKey);
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
