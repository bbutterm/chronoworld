/**
 * Озвучка главы через ElevenLabs: собрать все тексты главы (диалоги сюжета, вечер в таверне, страницы рассказчика —
 * эпизод, легенда, летопись, находки и комментарии к ним, вопрос выбора), озвучить голосами из scripts/voice/cast.json
 * и сложить в assets/voice/ru/<ключ>.mp3 (ключ — voiceKey текста, src/game/voiceKey.ts). Игра находит клип по тексту.
 *
 *   ELEVENLABS_API_KEY=… npm run voice:gen -- chapter1            — озвучить, что ещё не озвучено
 *   npm run voice:gen -- chapter1 --plan                          — только список и сколько символов уйдёт
 *   npm run voice:gen -- chapter1 --redo <ключ,ключ>              — перегенерировать выбранные клипы
 *   npm run voice:gen -- chapter1 --model eleven_v4               — другая модель
 *   npm run voice:gen -- chapter1 --roles alan,bran [--all]       — только эти голоса; --all — переозвучить и готовые
 *
 * Перед синтезом текст проходит режиссёрскую разметку (scripts/voice/direction/<глава>.json: реплика → она же с
 * пометками подачи [whispers], [excited]…) и словарь ударений (scripts/voice/stress.json). На экране — исходный текст.
 *
 * Сведения о клипах (текст, голос, модель, символы) — assets/voice/ru/index.json (в сборку не попадает, для
 * перегенерации и проверки распознаванием: tools/voice_qa.py). Ключ API — только из окружения, в файлы не пишется.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { voiceKey, voiceText } from '../src/game/voiceKey';

interface VoiceDef {
  voice: string;
  label: string;
  settings: Record<string, number | boolean>;
  /** Герои взрослеют (решение владельца): с главы fromChapter — другой голос (взрослая версия того же героя). */
  ages?: { fromChapter: number; voice: string; label: string; settings: Record<string, number | boolean> }[];
}
interface Cast {
  model: string;
  format: string;
  voices: Record<string, VoiceDef>;
  speakers: Record<string, string>;
}
interface Clip {
  key: string;
  text: string;
  role: string;
  /** Откуда текст (для отчёта): сцена, страница, вечер. */
  from: string;
  prev?: string;
  next?: string;
}
interface Line {
  speaker: string;
  text: string;
}

const root = process.cwd();
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const chapterId = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'chapter1';
const cast = JSON.parse(readFileSync(join(root, 'scripts/voice/cast.json'), 'utf8')) as Cast;
const model = opt('model') ?? cast.model;
const outDir = join(root, 'assets/voice/ru');
const indexPath = join(outDir, 'index.json');
const json = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

// ---------- тексты главы ----------

const clips: Clip[] = [];
const add = (text: string | undefined, role: string, from: string, prev?: string, next?: string) => {
  if (!text?.trim()) return;
  const key = voiceKey(text);
  if (clips.some((c) => c.key === key)) return;
  clips.push({ key, text: voiceText(text), role, from, ...(prev ? { prev } : {}), ...(next ? { next } : {}) });
};
const roleOf = (speaker: string): string => {
  const r = cast.speakers[speaker];
  if (!r) throw new Error(`Нет голоса для спикера «${speaker}» (scripts/voice/cast.json → speakers)`);
  return r;
};
/** Реплики подряд: соседние строки — контекст интонации (previous_text / next_text). */
const addLines = (lines: Line[], from: string) =>
  lines.forEach((l, i) => add(l.text, roleOf(l.speaker), from, lines[i - 1]?.text, lines[i + 1]?.text));

const storyFile = readdirSync(join(root, 'data/story')).find((f) => json(`data/story/${f}`).chapter === chapterId);
if (storyFile) {
  for (const s of json(`data/story/${storyFile}`).scenes as { id: string; lines: Line[]; choice?: { prompt: string; options: { reply: Line[] }[] } }[]) {
    addLines(s.lines, s.id);
    if (s.choice) {
      add(s.choice.prompt, 'narrator', `${s.id}:choice`);
      for (const o of s.choice.options) addLines(o.reply, `${s.id}:reply`);
    }
  }
}
for (const ev of json('data/story/tavern.json').evenings as { id: string; after: string; steps: (Line | { choice: { prompt: string; options: { reply: Line[] }[] } })[] }[]) {
  if (ev.after !== chapterId) continue;
  // Шаги вечера: реплики подряд; выбор — вопрос рассказчика и ответы героев.
  let run: Line[] = [];
  const flush = () => {
    addLines(run, ev.id);
    run = [];
  };
  for (const st of ev.steps) {
    if ('choice' in st) {
      flush();
      add(st.choice.prompt, 'narrator', `${ev.id}:choice`);
      for (const o of st.choice.options) addLines(o.reply, `${ev.id}:reply`);
    } else run.push(st);
  }
  flush();
}
// Личные сцены героев в таверне (tavern.json → heroes: сцена, задание, связь) — «глава» bonds.
if (chapterId === 'bonds') {
  const walk = (x: unknown, from: string, run: Line[]) => {
    if (Array.isArray(x)) for (const v of x) walk(v, from, run);
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (typeof o.speaker === 'string' && typeof o.text === 'string') run.push({ speaker: o.speaker, text: o.text });
      else for (const v of Object.values(o)) walk(v, from, run);
    }
  };
  for (const [hero, def] of Object.entries(json('data/story/tavern.json').heroes as Record<string, unknown>)) {
    const run: Line[] = [];
    walk(def, hero, run);
    addLines(run, `bond:${hero}`);
  }
}
const campaignFile = readdirSync(join(root, 'data/campaign')).find((f) => json(`data/campaign/${f}`).id === chapterId);
if (campaignFile) {
  const c = json(`data/campaign/${campaignFile}`);
  add(c.interlude?.text, 'narrator', 'interlude');
  add(c.episode?.quote, 'narrator', 'episode:quote');
  add(c.episode?.text, 'narrator', 'episode');
  add(c.legend?.text, 'narrator', 'legend');
  add(c.chronicle?.text, 'narrator', 'chronicle');
  for (const st of c.stages as { id: string; finding?: { text: string; comment?: { speaker: string; text: string } } }[]) {
    if (!st.finding) continue;
    add(st.finding.text, 'narrator', `finding:${st.id}`);
    if (st.finding.comment) add(st.finding.comment.text, roleOf(st.finding.comment.speaker), `finding:${st.id}:comment`);
  }
}

// ---------- озвучка ----------

const directionPath = join(root, `scripts/voice/direction/${chapterId}.json`);
const direction: Record<string, string> = existsSync(directionPath) ? JSON.parse(readFileSync(directionPath, 'utf8')) : {};
const stressRules = Object.entries(JSON.parse(readFileSync(join(root, 'scripts/voice/stress.json'), 'utf8')) as Record<string, string>).filter(([k]) => !k.startsWith('$'));
/** Ударения из словаря: начало слова (любой регистр первой буквы) → со знаком ударения. */
const stressed = (s: string) =>
  stressRules.reduce((t, [stem, mark]) => t.replace(new RegExp(`(?<![а-яё])${stem}`, 'giu'), (w) => (w[0] === w[0].toUpperCase() ? mark[0].toUpperCase() + mark.slice(1) : mark)), s);

/** КРИК ЗАГЛАВНЫМИ модель читает по буквам — слова длиннее трёх букв в обычный регистр (восклицание остаётся). */
const speakable = (s: string) => s.replace(/[А-ЯЁ]{4,}(?:-[А-ЯЁ]+)*/g, (w) => (/-/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()));

type Index = Record<string, { text: string; role: string; voice: string; model: string; chars: number; from: string }>;
const index: Index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
const redo = new Set((opt('redo') ?? '').split(',').filter(Boolean));
const roles = new Set((opt('roles') ?? '').split(',').filter(Boolean));
const todo = clips.filter((c) => (!roles.size || roles.has(c.role)) && (flag('all') || redo.has(c.key) || !existsSync(join(outDir, `${c.key}.mp3`))));
const chars = todo.reduce((n, c) => n + c.text.length, 0);
const byRole = new Map<string, number>();
for (const c of clips) byRole.set(c.role, (byRole.get(c.role) ?? 0) + c.text.length);
console.log(`${chapterId}: клипов ${clips.length}, символов ${clips.reduce((n, c) => n + c.text.length, 0)}; к озвучке ${todo.length} (${chars} симв.), модель ${model}`);
console.log([...byRole].map(([r, n]) => `  ${r.padEnd(10)} ${n}`).join('\n'));
if (flag('plan')) process.exit(0);

const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error('Нет ELEVENLABS_API_KEY в окружении.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

/** Личные сцены (bonds) открываются в таверне в любой момент — их озвучивают взрослые голоса (решение владельца). */
const chapterNum = chapterId === 'bonds' ? Infinity : Number(/^chapter(\d+)$/.exec(chapterId)?.[1] ?? 0);
/** Голос роли для этой главы: взрослая версия с ages[].fromChapter (личные сцены bonds — взрослый голос). */
function voiceOf(role: string): VoiceDef {
  const v = cast.voices[role];
  if (!v) throw new Error(`Нет голоса «${role}» в cast.voices`);
  const age = [...(v.ages ?? [])].sort((a, b) => b.fromChapter - a.fromChapter).find((a) => chapterNum >= a.fromChapter);
  return age ? { ...v, voice: age.voice, label: age.label, settings: age.settings } : v;
}

async function tts(c: Clip): Promise<{ audio: Buffer; cost: number }> {
  const v = voiceOf(c.role);
  const body = {
    text: speakable(stressed(direction[c.text] ?? c.text)),
    model_id: model,
    // style понимает только multilingual v2; v4 / v3 / turbo отвечают на него ошибкой или молча игнорируют.
    voice_settings: model === 'eleven_multilingual_v2' ? v.settings : Object.fromEntries(Object.entries(v.settings).filter(([k]) => k !== 'style')),
    ...(c.prev ? { previous_text: speakable(stressed(c.prev)) } : {}),
    ...(c.next ? { next_text: speakable(stressed(c.next)) } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.voice}?output_format=${cast.format}`, {
      method: 'POST',
      headers: { 'xi-api-key': key!, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (r.ok) return { audio: Buffer.from(await r.arrayBuffer()), cost: Number(r.headers.get('character-cost') ?? c.text.length) };
    const msg = await r.text();
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${r.status} ${msg.slice(0, 300)}`);
  }
}

let spent = 0;
for (const [i, c] of todo.entries()) {
  const { audio, cost } = await tts(c);
  writeFileSync(join(outDir, `${c.key}.mp3`), audio);
  spent += cost;
  index[c.key] = { text: c.text, role: c.role, voice: voiceOf(c.role).voice, model, chars: cost, from: `${chapterId}/${c.from}` };
  writeFileSync(indexPath, `${JSON.stringify(index, null, 1)}\n`);
  console.log(`[${i + 1}/${todo.length}] ${c.role.padEnd(9)} ${c.key} ${cost} симв. — ${c.text.slice(0, 60)}`);
}
console.log(`Готово: ${todo.length} клипов, списано ${spent} символов.`);
