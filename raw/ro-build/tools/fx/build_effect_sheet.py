#!/usr/bin/env python3
"""Build a game effect sheet from capture_effect.mjs frames (restored from the ro-effects skill).

- leading empty frames become delayMs, trailing ones are dropped;
- scale to RO sprite pixels using meta.json calibration (or --scale);
- one shared crop box for all frames (no jitter); anchor = target feet in cell coordinates;
- sheet <= 2048x2048: frames are thinned (ms doubled) if needed, reported as `thinned`.
Modes: add (RGB on black, BlendModes.ADD) or alpha (RGBA, alpha from brightness; blend "normal").
Writes <repo>/assets/effects/<id>.png and merges the entry into <repo>/assets/effects/effects.json.
"""
import argparse, json, math, shutil, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

MAX_SIDE = 2048
WORK = Path(__file__).resolve().parent.parent / 'work'


def load_frames(raw):
    files = sorted(raw.glob('frame_*.png'))
    if not files:
        sys.exit(f'no frame_*.png in {raw}')
    return [np.asarray(Image.open(f).convert('RGB'), dtype=np.uint8) for f in files]


def content_mask(f, thr):
    return f.max(axis=2) > thr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True)
    ap.add_argument('--repo', required=True)
    ap.add_argument('--id', required=True)
    ap.add_argument('--attach', choices=['caster', 'target', 'ground'], default='target')
    ap.add_argument('--mode', choices=['add', 'alpha'], default='alpha')
    ap.add_argument('--scale', type=float)
    ap.add_argument('--threshold', type=int, default=6)
    ap.add_argument('--pad', type=int, default=2)
    ap.add_argument('--loop', action='store_true')
    ap.add_argument('--note', default='')
    ap.add_argument('--keep', type=int, default=0, help='keep only the first N frames after the leading empty ones (one loop cycle)')
    a = ap.parse_args()

    raw = Path(a.raw)
    meta = json.loads((raw / 'meta.json').read_text())
    frames = load_frames(raw)
    step = meta['stepMs']
    loop = a.loop or meta.get('loop', False)
    nonempty = [i for i, f in enumerate(frames) if content_mask(f, a.threshold).any()]
    if not nonempty:
        sys.exit('all frames empty')
    first, last = nonempty[0], nonempty[-1]
    delay_ms = 0 if loop else round(first * step)
    frames = frames[first:last + 1] if not loop else frames
    if a.keep:
        frames = frames[:a.keep]
        loop = True

    s = a.scale or meta.get('pxPerSpritePx')
    if not s:
        sys.exit('no scale calibration')
    ax, ay = meta.get('anchor') or [frames[0].shape[1] / 2, frames[0].shape[0] / 2]
    if abs(s - 1) > 0.02:
        k = 1 / s
        size = (max(1, round(frames[0].shape[1] * k)), max(1, round(frames[0].shape[0] * k)))
        frames = [np.asarray(Image.fromarray(f).resize(size, Image.LANCZOS)) for f in frames]
        ax, ay = ax * k, ay * k

    union = np.zeros(frames[0].shape[:2], bool)
    for f in frames:
        union |= content_mask(f, a.threshold)
    ys, xs = np.nonzero(union)
    xmin, xmax, ymin, ymax = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    x0, y0 = max(0, xmin - a.pad), max(0, ymin - a.pad)
    x1 = min(frames[0].shape[1], xmax + 1 + a.pad)
    y1 = min(frames[0].shape[0], ymax + 1 + a.pad)
    cw, ch = x1 - x0 + ((x1 - x0) % 2), y1 - y0 + ((y1 - y0) % 2)
    if cw > MAX_SIDE or ch > MAX_SIDE:
        sys.exit(f'cell {cw}x{ch} exceeds {MAX_SIDE}px')
    touches = xmin - a.pad <= 0 or ymin - a.pad <= 0 or xmax + 1 + a.pad >= frames[0].shape[1] or ymax + 1 + a.pad >= frames[0].shape[0]

    cells = []
    for f in frames:
        c = np.zeros((ch, cw, 3), np.uint8)
        part = f[y0:y1, x0:x1]
        c[:part.shape[0], :part.shape[1]] = part
        cells.append(c)

    # fit the 2048 px sheet: keep as many evenly spaced frames as fit (not repeated halving)
    ms, thinned = step, 0
    cols = max(1, min(8, MAX_SIDE // cw, len(cells)))
    cap = cols * max(1, MAX_SIDE // ch)
    if len(cells) > cap:
        total = len(cells)
        idx = [round(i * (total - 1) / (cap - 1)) for i in range(cap)] if cap > 1 else [0]
        cells, ms, thinned = [cells[i] for i in idx], step * total / cap, total
    cols = max(1, min(cols, len(cells)))
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * ch, cols * cw, 3), np.uint8)
    for i, c in enumerate(cells):
        r, k = divmod(i, cols)
        sheet[r * ch:(r + 1) * ch, k * cw:(k + 1) * cw] = c

    out_dir = Path(a.repo) / 'assets' / 'effects'
    out_dir.mkdir(parents=True, exist_ok=True)
    png = out_dir / f'{a.id}.png'
    if a.mode == 'add':
        Image.fromarray(sheet, 'RGB').save(png, optimize=True)
    else:
        alpha = sheet.max(axis=2)
        rgb = np.where(alpha[..., None] > 0, np.clip(sheet.astype(np.float32) * 255 / np.maximum(alpha[..., None], 1), 0, 255), 0)
        Image.fromarray(np.dstack([rgb.astype(np.uint8), alpha]), 'RGBA').save(png, optimize=True)
    if shutil.which('oxipng'):
        subprocess.run(['oxipng', '-o', '4', '--strip', 'safe', '-q', str(png)], check=False)

    entry = {
        'id': a.id, 'file': f'effects/{a.id}.png', 'cell': [cw, ch], 'columns': cols, 'frames': len(cells), 'ms': round(ms, 2),
        'loop': loop, 'delayMs': delay_ms, 'blend': 'add' if a.mode == 'add' else 'normal',
        'anchor': [round(float(ax) - x0, 1), round(float(ay) - y0, 1)], 'attach': a.attach,
        'source': {'roEffectId': meta.get('effectId'), 'renderer': 'roBrowserLegacy EffectViewer', 'scale': round(float(s), 4),
                   'seed': meta.get('seed'), 'note': a.note},
    }
    jpath = out_dir / 'effects.json'
    doc = json.loads(jpath.read_text()) if jpath.exists() else {'schema': 1, 'effects': [], 'skills': {}}
    doc['effects'] = [e for e in doc['effects'] if e['id'] != a.id] + [entry]
    jpath.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')

    work = WORK / a.id
    work.mkdir(parents=True, exist_ok=True)
    sc = 2 if cw * cols <= 1024 else 1
    prev = Image.fromarray(np.clip(np.full_like(sheet, 48).astype(int) + sheet, 0, 255).astype(np.uint8), 'RGB')
    prev = prev.resize((prev.width * sc, prev.height * sc), Image.NEAREST)
    d = ImageDraw.Draw(prev)
    for i in range(len(cells)):
        r, k = divmod(i, cols)
        px, py = (k * cw + entry['anchor'][0]) * sc, (r * ch + entry['anchor'][1]) * sc
        d.line([px - 6, py, px + 6, py], fill=(0, 255, 0)); d.line([px, py - 6, px, py + 6], fill=(0, 255, 0))
        d.text((k * cw * sc + 3, r * ch * sc + 2), str(i), fill=(255, 255, 0))
    prev.save(work / 'preview.png')
    report = {'entry': entry, 'sheet': [sheet.shape[1], sheet.shape[0]], 'bytes': png.stat().st_size,
              'thinned': thinned, 'touchesCanvasEdge': bool(touches)}
    (work / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
