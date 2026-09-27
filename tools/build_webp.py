#!/usr/bin/env python3
"""WebP без потерь для PNG из assets/ (сборка кладёт их в dist/webp/, игра берёт их там, где браузер умеет WebP).

Запуск: `npm run assets:webp` (scripts/assets-webp.ts передаёт список нужных сборке PNG) или
`python3 tools/build_webp.py ui/foo.png sprites/heroes/guard.png …` (пути внутри assets/).

Результат: assets-webp/<путь без .png>.webp и assets-webp/index.json:
  {"ui/foo.png": {"sha1": "<sha1 исходного PNG>", "png": <байт>, "webp": <байт> | null}}
webp = null — WebP не меньше PNG хотя бы на 5 % или не совпал попиксельно: сборка оставит PNG.
Сборка (vite.config.ts) берёт WebP, только если sha1 исходного PNG совпадает с записанным, — заменённый художником
PNG без пересборки WebP просто уходит в игру как PNG (устаревшей картинки не будет).

Кодирование — без потерь (lossless, exact: RGB под прозрачными пикселями тоже сохраняется), каждый файл
декодируется обратно и сравнивается с исходником по RGBA. Пиксель-арт остаётся пиксель-в-пиксель.
"""
import hashlib
import io
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')
OUT = os.path.join(ROOT, 'assets-webp')
INDEX = os.path.join(OUT, 'index.json')
MIN_GAIN = 0.05


def webp_path(rel: str) -> str:
    return os.path.join(OUT, rel[: -len('.png')] + '.webp')


def rgba(im: Image.Image) -> bytes:
    return im.convert('RGBA').tobytes()


def encode(rel: str, raw: bytes) -> bytes | None:
    im = Image.open(io.BytesIO(raw))
    im.load()
    src = im.convert('RGBA')
    buf = io.BytesIO()
    # method 6 — медленнее, но меньше файл; кодируем один раз, при изменении PNG.
    src.save(buf, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    data = buf.getvalue()
    back = Image.open(io.BytesIO(data))
    back.load()
    if back.size != src.size or rgba(back) != src.tobytes():
        print(f'  ✗ {rel}: WebP не совпал попиксельно — остаётся PNG')
        return None
    return data


def main(files: list[str]) -> None:
    index = json.load(open(INDEX)) if os.path.exists(INDEX) else {}
    wanted = {f for f in files if f.endswith('.png')}
    made = kept = skipped = 0
    for rel in sorted(wanted):
        path = os.path.join(ASSETS, rel)
        if not os.path.exists(path):
            continue
        raw = open(path, 'rb').read()
        sha = hashlib.sha1(raw).hexdigest()
        prev = index.get(rel)
        if prev and prev.get('sha1') == sha and (prev.get('webp') is None or os.path.exists(webp_path(rel))):
            kept += 1
            continue
        data = encode(rel, raw)
        out = webp_path(rel)
        if data is not None and len(data) <= len(raw) * (1 - MIN_GAIN):
            os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, 'wb').write(data)
            index[rel] = {'sha1': sha, 'png': len(raw), 'webp': len(data)}
            made += 1
        else:
            if os.path.exists(out):
                os.remove(out)
            index[rel] = {'sha1': sha, 'png': len(raw), 'webp': None}
            skipped += 1
    # Файлы, которые сборке больше не нужны, — убрать.
    for rel in [r for r in index if r not in wanted]:
        out = webp_path(rel)
        if os.path.exists(out):
            os.remove(out)
        del index[rel]
    os.makedirs(OUT, exist_ok=True)
    with open(INDEX, 'w') as f:
        json.dump(dict(sorted(index.items())), f, indent=1, ensure_ascii=False)
        f.write('\n')
    png = sum(v['png'] for v in index.values())
    webp = sum(v['webp'] or v['png'] for v in index.values())
    print(f'WebP: новых {made}, без изменений {kept}, оставлены PNG {skipped}; '
          f'{png / 1024:.0f} КБ PNG → {webp / 1024:.0f} КБ ({(1 - webp / max(png, 1)) * 100:.0f} % меньше)')


if __name__ == '__main__':
    main(sys.argv[1:] if len(sys.argv) > 1 else [l.strip() for l in sys.stdin if l.strip()])
