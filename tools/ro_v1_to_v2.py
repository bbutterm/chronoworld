#!/usr/bin/env python3
"""Convert legacy v1 RO sheets (assets/ro/sheets, manifest schema 1) to native x1 v2 atlases.

Used by build_sprites_v2.py for sprites whose renderer source is not in the APNG cache
(six second-job heroes, chapter-3/tower monsters and bosses). No resampling beyond
undoing the v1 integer nearest-neighbour upscale:

1. v1 frames were rendered with the RO shadow ((35,35,35) alpha 128, drawn at v1
   resolution); those pixels are removed, then each row is sampled back to x1 with the
   block phase that leaves every scale x scale block uniform (proof the pixels are exact).
2. v1 placed each action by its union bbox (bottom-centre), so the ACT origin is lost.
   It is reconstructed per row by fitting the shadow ellipse (centre offset
   (-0.83, -0.83) native px, radii 17.5 x 8.5 native px, calibrated on Archer Skeleton,
   Poring and Baphomet whose v2 sheets are native: 10/12 rows exact, 2 rows off by 1 px).
3. Rows without shadow (death): monsters - exact-pixel match of a death frame against a
   frame of a row with known origin; heroes (one lying frame) - lying-body bbox placed at the
   median offset of the 13 native v2 hero death frames (estimate, recorded in metadata).
4. Frames that do not fit the class cell at x1 (big slash/death FX) are skipped, never
   scaled; the remaining frames are sampled uniformly and recorded as samplingExceptions.
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
V1_MANIFEST = ROOT / 'assets/ro/manifest.json'
SHADOW = (35, 35, 35, 128)
ELLIPSE = (-0.83, -0.83, 17.5, 8.5)
# Median lying-body bbox of native v2 hero death frames: centre x, bottom y (relative to ACT origin).
HERO_DEATH_CENTRE_X, HERO_DEATH_BOTTOM = -5, 14

# v2 id -> (v1 key, v2 class, display name of the RO source)
V1_SPRITES = {
    'blacksmith': ('blacksmith', 'hero'),
    'monk': ('monk', 'hero'),
    'sage': ('sage', 'hero'),
    'rogue': ('rogue', 'hero'),
    'alchemist': ('alchemist', 'hero'),
    'bard': ('bard', 'hero'),
    'raydric': ('armored', 'monster'),
    'mimic': ('ambusher', 'monster'),
    'gargoyle': ('flying', 'monster'),
    'dark_priest': ('dark_caster', 'monster'),
    'mistress': ('boss_ch1', 'boss'),
    'osiris': ('boss_ch2', 'boss'),
    'moonlight_flower': ('boss_ch4', 'boss'),
    'drake': ('boss_ch5', 'boss'),
    'dark_lord': ('boss_ch6', 'boss'),
}
# v2 hero row -> v1 row. v1 heroes have no walk/cast actions (limitation, recorded).
HERO_ROWS = {'idle': 'ready', 'walk': 'ready', 'attack': 'attack', 'cast': 'attack', 'hurt': 'hurt', 'death': 'death'}


def sample(total, target, death=False):
    if total >= target:
        return [round(i * (total - 1) / (target - 1)) for i in range(target)]
    if death:
        return list(range(total)) + [total - 1] * (target - total)
    return [i % total for i in range(target)]


def bbox(a):
    ys, xs = np.nonzero(a[:, :, 3])
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(xs) else None


class V1Row:
    """One v1 action row reduced to native frames; origin in native frame coordinates."""

    def __init__(self, sheet, meta, action):
        cw, ch = meta['cell_px']
        act = meta['actions'][action]
        self.action = action
        self.scale = sc = int(act['scale'])
        if sc != act['scale']:
            raise ValueError(f"{meta['key']}:{action} non-integer v1 scale {act['scale']}")
        r = act['row']
        self.raw, self.shadow = [], []
        for c in range(act['frame_count']):
            f = sheet[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw].copy()
            sm = (f == np.array(SHADOW, np.uint8)).all(axis=2)
            self.shadow.append(sm)
            f[sm] = 0
            self.raw.append(f)
        best = None
        for py in range(sc):
            for px in range(sc):
                bad = 0
                for f in self.raw:
                    h = (ch - py) // sc * sc; w = (cw - px) // sc * sc
                    b = f[py:py + h, px:px + w].reshape(h // sc, sc, w // sc, sc, 4)
                    bad += int((b != b[:, :1, :, :1]).any(axis=(1, 3, 4)).sum())
                if best is None or bad < best[0]:
                    best = (bad, px, py)
        if best[0]:
            raise RuntimeError(f"{meta['key']}:{action} no clean x{sc} block phase ({best[0]} mixed blocks)")
        _, self.px, self.py = best
        self.frames = [np.ascontiguousarray(f[self.py::sc, self.px::sc]) for f in self.raw]
        self.origin = self._fit_shadow()
        self.origin_method = 'shadow-ellipse' if self.origin else None

    def _fit_shadow(self):
        sc, px, py = self.scale, self.px, self.py
        shadow = np.zeros_like(self.shadow[0]); clear = np.zeros_like(self.shadow[0])
        for f, sm in zip(self.raw, self.shadow):
            shadow |= sm
            clear |= (f[:, :, 3] == 0) & ~sm
        ys, xs = np.nonzero(shadow)
        if not len(xs):
            return None
        cx, cy, rx, ry = ELLIPSE
        yy, xx = np.mgrid[0:shadow.shape[0], 0:shadow.shape[1]]
        x0 = int((xs.min() + xs.max()) / 2); y0 = int((ys.min() + ys.max()) / 2)
        best = None
        for oy in range((y0 // sc - 10) * sc + py, (y0 // sc + 11) * sc + py, sc):
            for ox in range((x0 // sc - 14) * sc + px, (x0 // sc + 15) * sc + px, sc):
                e = (((xx - ox) / sc - cx) / rx) ** 2 + (((yy - oy) / sc - cy) / ry) ** 2 <= 1
                score = int((shadow & e).sum()) - int((shadow & ~e).sum()) - int((clear & e).sum())
                if best is None or score > best[0]:
                    best = (score, ox, oy)
        return ((best[1] - px) // sc, (best[2] - py) // sc)


def _match(a, b, rng=30):
    """Best shift so a[y, x] == b[y+dy, x+dx] on a's opaque pixels -> (fraction, dx, dy)."""
    ba = bbox(a); bb_ = bbox(b)
    if not ba or not bb_:
        return None
    A = a[ba[1]:ba[3], ba[0]:ba[2]]; op = A[:, :, 3] > 0; n = int(op.sum())
    off = rng + max(A.shape[:2]) + max(b.shape[:2])
    pad = np.zeros((b.shape[0] + 2 * off, b.shape[1] + 2 * off, 4), np.uint8)
    pad[off:off + b.shape[0], off:off + b.shape[1]] = b
    best = None
    cx = bb_[0] - ba[0]; cy = bb_[1] - ba[1]
    for dy in range(cy - rng, cy + rng + 1):
        for dx in range(cx - rng, cx + rng + 1):
            x0 = ba[0] + dx + off; y0 = ba[1] + dy + off
            if x0 < 0 or y0 < 0 or x0 + A.shape[1] > pad.shape[1] or y0 + A.shape[0] > pad.shape[0]:
                continue
            B = pad[y0:y0 + A.shape[0], x0:x0 + A.shape[1]]
            eq = int(((A == B).all(axis=2) & op).sum())
            if best is None or eq > best[0]:
                best = (eq, dx, dy)
    return (best[0] / n, best[1], best[2])


def load_v1(key):
    meta = {s['key']: s for s in json.loads(V1_MANIFEST.read_text())['sprites']}[key]
    sheet = np.asarray(Image.open(ROOT / meta['sheet']).convert('RGBA'))
    rows = {a: V1Row(sheet, meta, a) for a in meta['actions']}
    death = rows.get('death')
    if death and death.origin is None:
        if meta['kind'] == 'hero':
            b = bbox(death.frames[0])
            death.origin = ((b[0] + b[2]) // 2 - HERO_DEATH_CENTRE_X, b[3] - HERO_DEATH_BOTTOM)
            death.origin_method = 'hero-death-median-bbox (estimate)'
        else:
            best = None
            for di in range(min(3, len(death.frames))):
                d = death.frames[di]
                for a in ('hurt', 'idle', 'walk', 'attack'):
                    r = rows[a]
                    for i, f in enumerate(r.frames):
                        m = _match(d, f)
                        if m and (best is None or m[0] > best[0]):
                            best = (m[0], a, i, di, r.origin[0] - m[1], r.origin[1] - m[2])
                        if best and best[0] == 1.0:
                            break
                    if best and best[0] == 1.0:
                        break
                if best and best[0] == 1.0:
                    break
            death.origin = (best[4], best[5])
            death.origin_method = f'pixel-match death[{best[3]}] ~ {best[1]}[{best[2]}] ({best[0]:.2f})'
    return meta, rows


def convert(sid, classes, anims, overrides, save_lossless, oxipng, out_dir):
    """Build one v2 sheet from a v1 sheet; returns the sprites.json entry."""
    key, kind = V1_SPRITES[sid]
    meta, rows = load_v1(key)
    cfg = classes[kind]; cw, ch = cfg['cell']; ax, ay = cfg['anchor']; names = cfg['anims']
    sheet = Image.new('RGBA', (cw * 8, ch * len(names)))
    sub = 'heroes' if kind == 'hero' else 'bosses' if kind == 'boss' else 'monsters'
    entry = {'id': sid, 'class': kind, 'file': f'sprites/{sub}/{sid}.png',
             'source': {'job': meta['original_name'], 'jobId': meta['source_job_id'],
                        'gender': meta.get('gender') or 'none', 'head': 1 if kind == 'hero' else 0,
                        'weaponView': 0, 'shieldView': 0,
                        'renderer': 'converted from legacy v1 sheet ' + meta['sheet'] + ' (tools/ro_v1_to_v2.py): '
                                    'v1 integer upscale undone, RO shadow removed, ACT origin reconstructed'},
             'hitFrames': {'attack': 3, **({'cast': 4} if kind == 'hero' else {})},
             'bbox': {}, 'sourceFrameBboxes': {}, 'sourceFrameIndices': {}, 'sourceFrameCounts': {},
             'sourceV1Rows': {}, 'originReconstruction': {}, 'sourceAlphaValues': []}
    alphas = set(); exceptions = {}; limits = {}
    for row, anim in enumerate(names):
        v1a = HERO_ROWS[anim] if kind == 'hero' else anim
        r = rows[v1a]
        conf = dict(anims[anim]); conf.update(overrides.get(kind, {}).get(anim, {})); n = conf['frames']
        ox, oy = r.origin
        boxes = []
        for f in r.frames:
            b = bbox(f)
            boxes.append(None if b is None else [b[0] - ox, b[1] - oy, b[2] - ox, b[3] - oy])
        fits = [i for i, b in enumerate(boxes)
                if b is not None and b[0] + ax > 0 and b[1] + ay > 0 and b[2] + ax < cw and b[3] + ay < ch]
        total = len(r.frames)
        if not fits:
            raise RuntimeError(f'{sid}:{anim} no v1 frame fits {cw}x{ch} at native x1')
        if len(fits) == total:
            idx = sample(total, n, death=(anim == 'death'))
        else:
            idx = [fits[i] for i in sample(len(fits), n, death=(anim == 'death'))]
            skipped = [i for i in range(total) if i not in fits]
            exceptions[anim] = (f'v1 frames {skipped} exceed the {kind} cell at native x1 (FX or blank) and are skipped '
                                f'without scaling; remaining frames sampled uniformly')
        bounds = []
        for col, i in enumerate(idx):
            b = boxes[i]
            pad = max(r.frames[i].shape[:2])
            big = Image.new('RGBA', (cw + 2 * pad, ch + 2 * pad))
            big.alpha_composite(Image.fromarray(r.frames[i]), (pad + ax - ox, pad + ay - oy))
            frame = big.crop((pad, pad, pad + cw, pad + ch))
            target = [b[0] + ax, b[1] + ay, b[2] + ax, b[3] + ay]
            if list(bbox(np.asarray(frame))) != target:
                raise RuntimeError(f'{sid}:{anim} frame {i} was cropped')
            sheet.alpha_composite(frame, (col * cw, row * ch)); bounds.append(target)
            alphas.update(int(v) for v in np.unique(np.asarray(frame)[:, :, 3]) if 0 < int(v) < 255)
        entry['bbox'][anim] = [min(x[0] for x in bounds), min(x[1] for x in bounds), max(x[2] for x in bounds), max(x[3] for x in bounds)]
        entry['sourceFrameBboxes'][anim] = [boxes[i] for i in idx]
        entry['sourceFrameIndices'][anim] = idx
        entry['sourceFrameCounts'][anim] = total
        entry['sourceV1Rows'][anim] = {'row': v1a, 'v1Scale': r.scale, 'blockPhase': [r.px, r.py],
                                       'roAction': meta['actions'][v1a]['source_action'],
                                       'sourceSha256': meta['actions'][v1a]['source_sha256']}
        entry['originReconstruction'][anim] = r.origin_method
        if kind == 'hero' and anim == 'idle':
            f0 = r.frames[idx[0]]; pad = max(f0.shape[:2])
            big = Image.new('RGBA', (3 * pad, 3 * pad)); big.alpha_composite(Image.fromarray(f0), (pad, pad))
            portrait = big.crop((pad + ox - 32, pad + oy - 88, pad + ox + 32, pad + oy - 24))
            out = out_dir / 'portraits' / f'{sid}.png'; save_lossless(portrait, out, oxipng)
            entry['portrait'] = f'sprites/portraits/{sid}.png'
    if kind == 'hero':
        limits = {'walk': 'v1 sheet has no walk action; RO ready stance (action 38) is played while moving',
                  'cast': 'v1 sheet has no casting action; RO attack (action 46) is used',
                  'death': 'RO action 70 has one source frame; held to fill the v2 death row; origin estimated',
                  'weapon': 'v1 renders keep whatever the renderer drew by default; no weapon/shield layers were added'}
    if exceptions:
        entry['samplingExceptions'] = exceptions
    if limits:
        entry['sourceLimitations'] = limits
    entry['sourceAlphaValues'] = sorted(alphas)
    png = ROOT / 'assets' / entry['file']; png.parent.mkdir(parents=True, exist_ok=True)
    save_lossless(sheet, png, oxipng)
    return entry
