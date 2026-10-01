"""Shared sheet assembly for software-rendered RO effects (build_str_fx.py): frames -> atlas PNG + effects.json entry.

Same rules as build_effect_sheet.py (EffectViewer captures): leading empty frames -> delayMs, trailing dropped; one shared crop
box (no jitter); anchor = effect origin (target feet) in cell coordinates; sheet <= 2048x2048 (evenly thinned, ms stretched).
Mode add: RGB on black (Phaser BlendModes.ADD); mode alpha: RGBA, straight alpha (blend normal).
"""
import json, math, shutil, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

MAX_SIDE = 2048


def build_sheet(frames, step_ms, origin, out_png, preview=None, threshold=6, pad=2, alphas=None, mode='add', max_frames=None,
                downscale=1.0, feather=0):
    """frames: list of HxWx3 uint8 (RGB on black) [alphas: HxW uint8 for mode alpha]. Returns entry fields + report."""
    def mask(i):
        return (alphas[i] if mode == 'alpha' else frames[i].max(axis=2)) > threshold
    nonempty = [i for i in range(len(frames)) if mask(i).any()]
    if not nonempty:
        raise SystemExit('all frames empty')
    first, last = nonempty[0], nonempty[-1]
    delay_ms = round(first * step_ms)
    frames = frames[first:last + 1]
    if alphas is not None:
        alphas = alphas[first:last + 1]
    ax, ay = origin
    if downscale != 1.0:
        size = (round(frames[0].shape[1] * downscale), round(frames[0].shape[0] * downscale))
        frames = [np.asarray(Image.fromarray(f).resize(size, Image.LANCZOS)) for f in frames]
        if alphas is not None:
            alphas = [np.asarray(Image.fromarray(a).resize(size, Image.LANCZOS)) for a in alphas]
        ax, ay = ax * downscale, ay * downscale
    union = np.zeros(frames[0].shape[:2], bool)
    for i, f in enumerate(frames):
        union |= ((alphas[i] if mode == 'alpha' else f.max(axis=2)) > threshold)
    ys, xs = np.nonzero(union)
    x0, y0 = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    x1, y1 = min(frames[0].shape[1], int(xs.max()) + 1 + pad), min(frames[0].shape[0], int(ys.max()) + 1 + pad)
    cw, ch = x1 - x0 + ((x1 - x0) % 2), y1 - y0 + ((y1 - y0) % 2)
    if cw > MAX_SIDE or ch > MAX_SIDE:
        raise SystemExit(f'cell {cw}x{ch} exceeds {MAX_SIDE}px')
    nch = 4 if mode == 'alpha' else 3
    cells = []
    for i, f in enumerate(frames):
        c = np.zeros((ch, cw, nch), np.uint8)
        part = f[y0:y1, x0:x1]
        c[:part.shape[0], :part.shape[1], :3] = part
        if mode == 'alpha':
            c[:part.shape[0], :part.shape[1], 3] = alphas[i][y0:y1, x0:x1]
        if feather:
            yy = np.minimum(np.arange(ch), np.arange(ch)[::-1])[:, None]
            xx = np.minimum(np.arange(cw), np.arange(cw)[::-1])[None, :]
            k = np.clip(np.minimum(yy, xx) / feather, 0, 1)[..., None]
            if mode == 'alpha':
                c[..., 3:] = (c[..., 3:] * k).astype(np.uint8)
            else:
                c[...] = (c * k).astype(np.uint8)
        cells.append(c)
    ms, thinned = step_ms, 0
    cols = max(1, min(8, MAX_SIDE // cw, len(cells)))
    cap = cols * max(1, MAX_SIDE // ch)
    if max_frames:
        cap = min(cap, max_frames)
    if len(cells) > cap:
        total = len(cells)
        idx = [round(i * (total - 1) / (cap - 1)) for i in range(cap)] if cap > 1 else [0]
        cells, ms, thinned = [cells[i] for i in idx], step_ms * total / cap, total
    cols = max(1, min(cols, len(cells)))
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * ch, cols * cw, nch), np.uint8)
    for i, c in enumerate(cells):
        r, k = divmod(i, cols)
        sheet[r * ch:(r + 1) * ch, k * cw:(k + 1) * cw] = c
    out_png = Path(out_png)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet, 'RGBA' if mode == 'alpha' else 'RGB').save(out_png, optimize=True)
    if shutil.which('oxipng'):
        subprocess.run(['oxipng', '-o', '4', '--strip', 'safe', '-q', str(out_png)], check=False)
    anchor = [round(float(ax) - x0, 1), round(float(ay) - y0, 1)]
    if preview:
        rgb = sheet[..., :3].astype(int)
        if mode == 'alpha':
            rgb = rgb * sheet[..., 3:4] // 255
        prev = Image.fromarray(np.clip(48 + rgb, 0, 255).astype(np.uint8), 'RGB')
        d = ImageDraw.Draw(prev)
        for i in range(len(cells)):
            r, k = divmod(i, cols)
            px, py = k * cw + anchor[0], r * ch + anchor[1]
            d.line([px - 6, py, px + 6, py], fill=(0, 255, 0)); d.line([px, py - 6, px, py + 6], fill=(0, 255, 0))
            d.text((k * cw + 3, r * ch + 2), str(i), fill=(255, 255, 0))
        Path(preview).parent.mkdir(parents=True, exist_ok=True)
        prev.save(preview)
    return dict(cell=[cw, ch], columns=cols, frames=len(cells), ms=round(ms, 2), delayMs=delay_ms, anchor=anchor,
                sheet=[sheet.shape[1], sheet.shape[0]], bytes=out_png.stat().st_size, thinned=thinned)


def merge_entry(effects_json, entry):
    doc = json.loads(Path(effects_json).read_text())
    doc['effects'] = [e for e in doc['effects'] if e['id'] != entry['id']] + [entry]
    Path(effects_json).write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
