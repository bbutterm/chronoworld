"""RO STR effect files (data/texture/effect/*.str): loader + software renderer (no WebGL, no roBrowser runtime).

Port of roBrowserLegacy src/Loaders/Str.js + src/Renderer/Effects/StrEffect.js (calculateAnimation, quad layout, D3D blend):
layers of keyframes; type 0 = source key, type 1 = per-frame delta (morph); quad corners xy[0..3]/xy[4..7] around pos,
STR space 640x640 with the effect origin at (320, 320); texture = layer texnames[aniframe]; colour/alpha from the key.
Textures: BMP magenta = transparent, black discarded (StrEffect.fs), TGA with alpha.
Used by build_str_fx.py (atlases for skills whose STR the EffectViewer capture never covered).
"""
import math, struct
from pathlib import Path
import numpy as np
from PIL import Image

RAW = Path(__file__).resolve().parents[3] / 'ro'
TEX_DIR = RAW / 'texture' / 'effect'


class Key:
    __slots__ = ('frame', 'type', 'pos', 'uv', 'xy', 'aniframe', 'anitype', 'delay', 'angle', 'color', 'src', 'dst', 'mt')


class Layer:
    def __init__(self):
        self.texnames, self.keys = [], []


class Str:
    def __init__(self, data):
        if data[:4] != b'STRM':
            raise ValueError('not STRM')
        ver, self.fps, self.maxKey, n = struct.unpack_from('<4I', data, 4)
        if ver != 0x94:
            raise ValueError(f'STR version {ver:#x}')
        o = 4 + 16 + 16
        self.layers = []
        for _ in range(n):
            L = Layer()
            (tc,) = struct.unpack_from('<i', data, o); o += 4
            for _ in range(tc):
                L.texnames.append(data[o:o + 128].split(b'\0')[0].decode('cp949', 'replace')); o += 128
            (kc,) = struct.unpack_from('<i', data, o); o += 4
            for _ in range(kc):
                k = Key()
                k.frame, k.type = struct.unpack_from('<iI', data, o); o += 8
                f = struct.unpack_from('<18f', data, o); o += 72
                k.pos, k.uv, k.xy = list(f[0:2]), list(f[2:10]), list(f[10:18])
                k.aniframe, k.anitype, k.delay, ang = struct.unpack_from('<fIff', data, o); o += 16
                k.angle = ang / (1024 / 360)
                k.color = [c / 255 for c in struct.unpack_from('<4f', data, o)]; o += 16
                k.src, k.dst, k.mt = struct.unpack_from('<3I', data, o); o += 12
                L.keys.append(k)
            self.layers.append(L)

    @classmethod
    def open(cls, name, tex_dir=TEX_DIR):
        return cls((tex_dir / name).read_bytes())


def calc(layer, key):
    """StrEffect.js calculateAnimation: dict (pos, xy, angle, color, aniframe, src, dst) or None."""
    last_frame = last_source = 0
    fr = to = -1
    for i, a in enumerate(layer.keys):
        if a.frame <= key:
            if a.type == 0:
                fr = i
            if a.type == 1:
                to = i
        last_frame = max(last_frame, a.frame)
        if a.type == 0:
            last_source = max(last_source, a.frame)
    if fr < 0 or (to < 0 and last_frame < key):
        return None
    f = layer.keys[fr]
    t = layer.keys[to] if to >= 0 else None
    r = dict(src=f.src, dst=f.dst)
    if to != fr + 1 or t.frame != f.frame:
        if t is not None and last_source <= f.frame:
            return None
        r.update(angle=f.angle, aniframe=f.aniframe, color=list(f.color), pos=list(f.pos), xy=list(f.xy))
        return r
    d = key - f.frame
    r['color'] = [f.color[i] + t.color[i] * d for i in range(4)]
    r['xy'] = [f.xy[i] + t.xy[i] * d for i in range(8)]
    r['angle'] = f.angle + t.angle * d
    r['pos'] = [f.pos[0] + t.pos[0] * d, f.pos[1] + t.pos[1] * d]
    n = len(layer.texnames)
    if t.anitype == 1:
        r['aniframe'] = f.aniframe + t.aniframe * d
    elif t.anitype == 2:
        r['aniframe'] = min(f.aniframe + t.delay * d, n - 1)
    elif t.anitype == 3:
        r['aniframe'] = math.fmod(f.aniframe + t.delay * d, n)
    elif t.anitype == 4:
        r['aniframe'] = math.fmod(f.aniframe - t.delay * d, n)
    else:
        r['aniframe'] = 0
    return r


_tex_cache = {}


def load_texture(name, tex_dir=TEX_DIR):
    """RGBA float32 [h, w, 4] in 0..1; BMP magenta -> transparent (roBrowser texture loader). None if absent."""
    base = Path(name.replace('\\', '/')).name.lower()
    key = (str(tex_dir), base)
    if key in _tex_cache:
        return _tex_cache[key]
    p = next((c for c in tex_dir.iterdir() if c.name.lower() == base), None)
    if p is None:
        _tex_cache[key] = None
        return None
    a = np.asarray(Image.open(p).convert('RGBA'), dtype=np.float32) / 255
    if p.suffix.lower() == '.bmp':
        m = (a[..., 0] > 0.98) & (a[..., 1] < 0.03) & (a[..., 2] > 0.98)
        a = a.copy(); a[m] = 0
        # near-black texels: the client's 16-bit texture upload drops them; left in, additive quads show faint rectangles
        a[a[..., :3].max(-1) < 10 / 255] = 0
    _tex_cache[key] = a
    return a


def _factor(code, s_rgb, s_a, d_rgb, d_a):
    # D3DBLEND: 1 ZERO 2 ONE 3 SRCCOLOR 4 INVSRCCOLOR 5 SRCALPHA 6 INVSRCALPHA 7 DESTALPHA 8 INVDESTALPHA 9 DESTCOLOR 10 INVDESTCOLOR
    return {1: 0.0, 2: 1.0, 3: s_rgb, 4: 1 - s_rgb, 5: s_a[..., None], 6: 1 - s_a[..., None], 7: d_a[..., None],
            8: 1 - d_a[..., None], 9: d_rgb, 10: 1 - d_rgb}.get(code, 1.0)


def draw_quad(canvas, alpha, tex, pts, color, src=5, dst=2, uv=None, discard_black=True):
    """Rasterise a textured quad. pts: 4 screen points in order TL, TR, BR, BL. canvas HxWx3 float, alpha HxW float."""
    if tex is None:
        return
    H, W = canvas.shape[:2]
    th, tw = tex.shape[:2]
    uv = uv or [(0, 0), (1, 0), (1, 1), (0, 1)]
    col = np.asarray(color, np.float32)
    for tri in ((0, 1, 2), (0, 2, 3)):
        P = np.array([pts[i] for i in tri], np.float64)
        T = np.array([uv[i] for i in tri], np.float64)
        x0, y0 = np.floor(P.min(0)).astype(int)
        x1, y1 = np.ceil(P.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W - 1), min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        den = (P[1, 1] - P[2, 1]) * (P[0, 0] - P[2, 0]) + (P[2, 0] - P[1, 0]) * (P[0, 1] - P[2, 1])
        if abs(den) < 1e-9:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        px, py = xs + 0.5, ys + 0.5
        l0 = ((P[1, 1] - P[2, 1]) * (px - P[2, 0]) + (P[2, 0] - P[1, 0]) * (py - P[2, 1])) / den
        l1 = ((P[2, 1] - P[0, 1]) * (px - P[2, 0]) + (P[0, 0] - P[2, 0]) * (py - P[2, 1])) / den
        l2 = 1 - l0 - l1
        inside = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        if not inside.any():
            continue
        u = l0 * T[0, 0] + l1 * T[1, 0] + l2 * T[2, 0]
        v = l0 * T[0, 1] + l1 * T[1, 1] + l2 * T[2, 1]
        fx = np.clip(u * tw - 0.5, 0, tw - 1); fy = np.clip(v * th - 0.5, 0, th - 1)
        ix, iy = np.floor(fx).astype(int), np.floor(fy).astype(int)
        ix1, iy1 = np.minimum(ix + 1, tw - 1), np.minimum(iy + 1, th - 1)
        ax, ay = (fx - ix)[..., None], (fy - iy)[..., None]
        s = (tex[iy, ix] * (1 - ax) * (1 - ay) + tex[iy, ix1] * ax * (1 - ay) + tex[iy1, ix] * (1 - ax) * ay
             + tex[iy1, ix1] * ax * ay) * col
        m = inside & (s[..., 3] > 0)
        if discard_black:
            m &= s[..., :3].max(-1) > 1e-4
        if not m.any():
            continue
        reg = canvas[y0:y1 + 1, x0:x1 + 1]
        areg = alpha[y0:y1 + 1, x0:x1 + 1]
        srgb, sa = np.clip(s[..., :3], 0, 1), np.clip(s[..., 3], 0, 1)
        out = srgb * _factor(src, srgb, sa, reg, areg) + reg * _factor(dst, srgb, sa, reg, areg)
        reg[m] = np.clip(out[m], 0, 1)
        areg[m] = np.clip(sa[m] + areg[m] * (1 - sa[m]), 0, 1)


def str_quads(st, key, origin=(320, 320), scale=1.0):
    """Screen quads of one STR key: list of (tex, pts, color, src, dst)."""
    out = []
    for L in st.layers:
        if not L.texnames:
            continue
        r = calc(L, key)
        if r is None:
            continue
        idx = int(r['aniframe'])
        if idx < 0 or idx >= len(L.texnames):
            continue
        xy, ang = r['xy'], math.radians(r['angle'])
        ca, sa = math.cos(ang), math.sin(ang)
        cx = origin[0] + (r['pos'][0] - 320) * scale
        cy = origin[1] + (r['pos'][1] - 320) * scale
        pts = []
        for i in (0, 1, 3, 2):     # StrEffect.js strip: v0=(xy0,xy4) uv00, v1=(xy1,xy5) uv10, v2=(xy3,xy7) uv01, v3=(xy2,xy6) uv11
            x, y = xy[i] * scale, xy[4 + i] * scale
            pts.append((cx + x * ca - y * sa, cy + x * sa + y * ca))
        # pts now: uv00, uv10, uv01, uv11 -> reorder to TL, TR, BR, BL
        quad = [pts[0], pts[1], pts[3], pts[2]]
        out.append((L.texnames[idx], quad, r['color'], r['src'], r['dst']))
    return out


def render_str(st, key, size=(640, 640), origin=(320, 320), scale=1.0, tex_dir=TEX_DIR, canvas=None):
    """One STR key frame -> (RGB float canvas on black, alpha)."""
    if canvas is None:
        # the client back buffer is opaque: DESTALPHA (D3DBLEND 7, used by almost every STR as (5, 7)) = 1 -> additive
        canvas = (np.zeros((size[1], size[0], 3), np.float32), np.ones((size[1], size[0]), np.float32))
    c, a = canvas
    for name, quad, color, src, dst in str_quads(st, key, origin, scale):
        draw_quad(c, a, load_texture(name, tex_dir), quad, color, src, dst)
    return c, a


def missing_textures(st, tex_dir=TEX_DIR):
    return sorted({n for L in st.layers for n in L.texnames if load_texture(n, tex_dir) is None})
