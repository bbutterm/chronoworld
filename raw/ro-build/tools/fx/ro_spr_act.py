"""Parse Ragnarok Online SPR + ACT and render native x1 RGBA frames.

Coordinates: every rendered frame is an RGBA image plus the position of the ACT
origin (0,0) inside it. Layers are composited in ACT order (later layers on top).
"""
import io, math, struct
import numpy as np
from PIL import Image


class Spr:
    def __init__(self, data):
        if data[:2] != b'SP':
            raise ValueError('not SPR')
        minor, major = data[2], data[3]
        self.version = major + minor / 10
        n_idx, = struct.unpack_from('<H', data, 4)
        p = 6
        n_rgba = 0
        if self.version >= 2.0:
            n_rgba, = struct.unpack_from('<H', data, 6)
            p = 8
        self.indexed = []                                   # (w, h, uint8 array)
        for _ in range(n_idx):
            w, h = struct.unpack_from('<HH', data, p); p += 4
            if self.version >= 2.1:
                size, = struct.unpack_from('<H', data, p); p += 2
                rle = data[p:p + size]; p += size
                out = bytearray(); i = 0
                while i < len(rle):
                    b = rle[i]; i += 1
                    if b == 0:
                        out += bytes(rle[i]); i += 1
                    else:
                        out.append(b)
                pix = bytes(out[:w * h]).ljust(w * h, b'\0')
            else:
                pix = data[p:p + w * h]; p += w * h
            self.indexed.append((w, h, np.frombuffer(pix, np.uint8).reshape(h, w) if w and h else np.zeros((h, w), np.uint8)))
        self.rgba = []                                      # (w, h, HxWx4 RGBA)
        for _ in range(n_rgba):
            w, h = struct.unpack_from('<hh', data, p); p += 4
            raw = np.frombuffer(data[p:p + w * h * 4], np.uint8).reshape(h, w, 4); p += w * h * 4
            abgr = raw[::-1]                                # stored bottom-up
            self.rgba.append((w, h, abgr[:, :, [3, 2, 1, 0]].copy()))
        pal = np.frombuffer(data[-1024:], np.uint8).reshape(256, 4).copy()
        pal[:, 3] = 255
        pal[0, 3] = 0                                       # index 0 is transparent
        self.palette = pal

    def image(self, index, sprtype, palette=None):
        if sprtype == 1:
            if index >= len(self.rgba):
                return None
            return self.rgba[index][2]
        if index >= len(self.indexed):
            return None
        pal = self.palette if palette is None else palette
        return pal[self.indexed[index][2]]


class Act:
    def __init__(self, data):
        if data[:2] != b'AC':
            raise ValueError('not ACT')
        minor, major = data[2], data[3]
        self.version = major + minor / 10
        n_actions, = struct.unpack_from('<H', data, 4)
        p = 16
        self.actions = []
        for _ in range(n_actions):
            n_frames, = struct.unpack_from('<I', data, p); p += 4
            frames = []
            for _ in range(n_frames):
                p += 32                                     # attack/clip rectangles (unused)
                n_layers, = struct.unpack_from('<I', data, p); p += 4
                layers = []
                for _ in range(n_layers):
                    x, y, idx, mirror = struct.unpack_from('<iiii', data, p); p += 16
                    color = (255, 255, 255, 255); sx = sy = 1.0; angle = 0; sprtype = 0
                    if self.version >= 2.0:
                        color = tuple(data[p:p + 4]); p += 4
                        sx, = struct.unpack_from('<f', data, p); p += 4
                        sy = sx
                        if self.version >= 2.4:
                            sy, = struct.unpack_from('<f', data, p); p += 4
                        angle, sprtype = struct.unpack_from('<ii', data, p); p += 8
                        if self.version >= 2.5:
                            p += 8                          # width/height hints
                    layers.append(dict(x=x, y=y, idx=idx, mirror=mirror, color=color,
                                       sx=sx, sy=sy, angle=angle, type=sprtype))
                event = -1
                if self.version >= 2.0:
                    event, = struct.unpack_from('<i', data, p); p += 4
                anchors = []
                if self.version >= 2.3:
                    n_anchor, = struct.unpack_from('<I', data, p); p += 4
                    for _ in range(n_anchor):
                        _, ax, ay, attr = struct.unpack_from('<iiii', data, p); p += 16
                        anchors.append((ax, ay, attr))
                frames.append(dict(layers=layers, event=event, anchors=anchors))
            self.actions.append(frames)
        self.sounds = []
        if self.version >= 2.1:
            n_snd, = struct.unpack_from('<I', data, p); p += 4
            for _ in range(n_snd):
                self.sounds.append(data[p:p + 40].split(b'\0')[0].decode('cp949', 'replace')); p += 40
        self.delays = [4.0] * n_actions
        if self.version >= 2.2 and p + 4 * n_actions <= len(data):
            self.delays = list(struct.unpack_from(f'<{n_actions}f', data, p))

    def delay_ms(self, action):
        return round(self.delays[action] * 25)

    def event_name(self, frame):
        e = frame['event']
        return self.sounds[e] if 0 <= e < len(self.sounds) else None


def _layer_pixels(spr, layer, palette=None):
    img = spr.image(layer['idx'], layer['type'], palette)
    if img is None or layer['idx'] < 0 or img.size == 0:
        return None
    img = img.astype(np.float32)
    r, g, b, a = layer['color']
    if (r, g, b, a) != (255, 255, 255, 255):
        img = img * (np.array([r, g, b, a], np.float32) / 255.0)
    return img


def render_frame(spr, frame, palette=None):
    """Return (RGBA uint8 image, origin_x, origin_y) with tight bounds, or (None,0,0)."""
    parts = []
    for L in frame['layers']:
        if L['idx'] < 0:
            continue
        px = _layer_pixels(spr, L, palette)
        if px is None:
            continue
        im = Image.fromarray(np.clip(px + 0.5, 0, 255).astype(np.uint8), 'RGBA')
        w, h = im.size
        sx, sy = L['sx'], L['sy']
        mirror = bool(L['mirror']) ^ (sx < 0)
        sw, sh = max(1, round(w * abs(sx))), max(1, round(h * abs(sy)))
        if (sw, sh) != (w, h):
            im = im.resize((sw, sh), Image.NEAREST)
        if mirror:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        if sy < 0:
            im = im.transpose(Image.FLIP_TOP_BOTTOM)
        cx, cy = sw / 2, sh / 2
        if L['angle'] % 360:
            im = im.rotate(-L['angle'], resample=Image.NEAREST, expand=True)
            cx, cy = im.size[0] / 2, im.size[1] / 2
        # Same anchor rounding as the accepted ragassets sheets (x - floor(w/2),
        # y - ceil(h/2)), but mirrored layers keep every source column.
        left = L['x'] - math.floor(cx)
        top = L['y'] - math.ceil(cy)
        parts.append((im, left, top))
    if not parts:
        return None, 0, 0
    x0 = min(l for _, l, _ in parts); y0 = min(t for _, _, t in parts)
    x1 = max(l + im.size[0] for im, l, _ in parts); y1 = max(t + im.size[1] for im, _, t in parts)
    canvas = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for im, l, t in parts:
        canvas.alpha_composite(im, (l - x0, t - y0))
    return canvas, -x0, -y0


def bbox_rel(img, ox, oy):
    """Opaque bbox relative to ACT origin: [x0, y0, x1, y1] (x1/y1 exclusive)."""
    if img is None:
        return None
    a = np.asarray(img)[:, :, 3]
    ys, xs = np.nonzero(a)
    if not len(xs):
        return None
    return [int(xs.min()) - ox, int(ys.min()) - oy, int(xs.max()) + 1 - ox, int(ys.max()) + 1 - oy]
