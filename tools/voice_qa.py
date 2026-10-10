"""Проверка озвучки распознаванием (Whisper): каждый клип assets/voice/ru/<ключ>.mp3 → текст → сравнение с репликой
из assets/voice/ru/index.json. Ловит пропущенные и лишние слова, кашу, обрывы; ударения не проверяет.

    pip install faster-whisper            # один раз (в отдельном venv)
    python3 tools/voice_qa.py [--from chapter1] [--model medium] [--min 0.85]

Печатает худшие клипы и сводку (длительность, сходство); код выхода 1, если есть клипы ниже порога --min.
Сходство — по буквам без пунктуации и регистра (е/ё, й/и не различаются: Whisper их путает).
"""
import argparse
import difflib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE = os.path.join(ROOT, 'assets', 'voice', 'ru')


def norm(s: str) -> str:
    s = s.lower().replace('ё', 'е').replace('й', 'и')
    return ' '.join(re.sub(r'[^а-яa-z0-9 ]+', ' ', s).split())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='src', default='', help='только клипы, чей from начинается с этого (chapter1)')
    ap.add_argument('--model', default='medium')
    ap.add_argument('--min', type=float, default=0.85)
    a = ap.parse_args()
    from faster_whisper import WhisperModel  # noqa: PLC0415 — тяжёлый импорт только при запуске

    index = json.load(open(os.path.join(VOICE, 'index.json'), encoding='utf8'))
    model = WhisperModel(a.model, device='cpu', compute_type='int8')
    rows = []
    for key, meta in sorted(index.items(), key=lambda kv: kv[1]['from']):
        if not meta['from'].startswith(a.src):
            continue
        path = os.path.join(VOICE, f'{key}.mp3')
        # VAD и без опоры на прошлый текст: иначе Whisper дописывает в тишине конца фразы («…на наш канал»).
        segs, info = model.transcribe(path, language='ru', vad_filter=True, condition_on_previous_text=False)
        heard = ''.join(s.text for s in segs).strip()
        ratio = difflib.SequenceMatcher(None, norm(meta['text']), norm(heard)).ratio()
        rows.append((ratio, info.duration, key, meta, heard))
    rows.sort(key=lambda r: r[0])
    bad = [r for r in rows if r[0] < a.min]
    for ratio, dur, key, meta, heard in rows[:15]:
        print(f'{ratio:.2f} {dur:5.1f}с {meta["role"]:9} {key}\n   текст: {meta["text"]}\n   слышно: {heard}')
    total = sum(r[1] for r in rows)
    print(f'\nклипов {len(rows)}, всего {total / 60:.1f} мин, среднее сходство {sum(r[0] for r in rows) / max(1, len(rows)):.3f}, ниже {a.min}: {len(bad)}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
