#!/usr/bin/env python3
"""Hero-ult and frequent-skill effect atlases from the scRO client files in raw/ro (BATCH_2026-10-01, fx_sources.csv).

  python3 build_ro_fx.py [id ...] [--preview DIR] [--no-json]

Why not EffectViewer: this container has no roBrowser/Electron. The capture path (README.md) is replaced by direct
renderers of the same client files, ported from roBrowserLegacy:
  - STR (lord, firewall, brandish, spell, sanctuary, 매직로드, quagmire, earthhit, windhit, potions): ro_str.py
    (StrEffect.js keyframe/morph/blend maths, quad = billboard, 1 STR px = 1 sprite px, origin (320, 320) = feet);
  - SPR+ACT (매 falcon, cconfine, 침투경_, marine_sphere): ro_spr_act.py (as build_spr_fx.py), native x1 pixels;
  - roBrowser '3D' billboards (EF_BEGINASURA 328 letters asura1-6, EF_TEIHIT1X 266 lens streaks, EF_SOULBREAKER2 409
    purpleslash) and PropertyGround (EF_BOTTOM_DE 240 ring_blue): EffectTable.js parameters, drawn by ro_str.draw_quad
    with a fixed RO-like camera (1 cell = 35 px, ground depth x0.7, height x0.8).
Every sheet: RGB on black + blend add (the client's additive glow), or RGBA for solid sprites; anchor = target feet.
Output: <repo>/assets/effects/<id>.png + effects.json → effects (skills are bound by hand, see RO_EFFECTS_EXTRACT.md).
"""
import argparse, json, math, random, sys
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from ro_str import Str, render_str, draw_quad, load_texture, TEX_DIR, RAW  # noqa: E402
from ro_spr_act import Spr, Act, render_frame  # noqa: E402
from fx_sheet import build_sheet, merge_entry  # noqa: E402

REPO = HERE.parents[3]
CELL = 35.0           # px per map cell (roBrowser pixelRatio 1/35)
DEPTH = 0.7           # ground (y) foreshortening of the RO camera
HEIGHT = 0.8          # vertical (z) foreshortening


def to_u8(c):
    return (np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8)


# ---------------------------------------------------------------- STR jobs
def str_frames(instances, keys, size, origin, gain=1.0):
    """instances: [(file, dx, dy, key_offset)] — several STR players (a wall of cells). keys: effect-time key indices."""
    sts = {f: Str.open(f) for f, *_ in instances}
    frames = []
    for k in keys:
        c = np.zeros((size[1], size[0], 3), np.float32)
        a = np.ones((size[1], size[0]), np.float32)
        for f, dx, dy, off in instances:
            kk = k - off
            if kk < 0 or kk >= sts[f].maxKey:
                continue
            render_str(sts[f], kk, origin=(origin[0] + dx, origin[1] + dy), canvas=(c, a))
        frames.append(to_u8(c * gain))
    return frames


# ---------------------------------------------------------------- SPR jobs
def spr_layers(sub, name):
    base = RAW / 'sprite' / sub / name
    return Spr((base.with_suffix('.spr')).read_bytes()), Act((base.with_suffix('.act')).read_bytes())


def paste_rgba(canvas, img, x, y):
    """Alpha-composite PIL RGBA img onto float RGBA canvas at integer (x, y)."""
    a = np.asarray(img, np.float32) / 255
    h, w = a.shape[:2]
    H, W = canvas.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    src = a[y0 - y:y1 - y, x0 - x:x1 - x]
    dst = canvas[y0:y1, x0:x1]
    sa = src[..., 3:4]
    dst[..., :3] = src[..., :3] * sa + dst[..., :3] * (1 - sa)
    dst[..., 3:4] = sa + dst[..., 3:4] * (1 - sa)


def spr_sequence(spr, act, plan, size, origin, add=False):
    """plan: list of (action, frame, dx, dy) per output frame. Returns (rgb frames, alpha frames)."""
    rgbs, alphas = [], []
    for item in plan:
        canvas = np.zeros((size[1], size[0], 4), np.float32)
        for action, fi, dx, dy in (item if isinstance(item, list) else [item]):
            img, ox, oy = render_frame(spr, act.actions[action][fi])
            if img is None:
                continue
            paste_rgba(canvas, img, int(round(origin[0] + dx - ox)), int(round(origin[1] + dy - oy)))
        if add:
            rgbs.append(to_u8(canvas[..., :3] * canvas[..., 3:4]))
            alphas.append(None)
        else:
            rgbs.append(to_u8(canvas[..., :3]))
            alphas.append(to_u8(canvas[..., 3]))
    return rgbs, alphas


# ---------------------------------------------------------------- roBrowser 3D billboards (ThreeDEffect.js subset)
def project(origin, x, y, z):
    """World offset in cells (x right, y toward camera, z up) -> screen px."""
    return origin[0] + x * CELL, origin[1] + y * CELL * DEPTH - z * CELL * HEIGHT


def billboard(c, a, tex, center, w, h, angle_deg, color, dst=2):
    ang = math.radians(angle_deg)
    ca, sa = math.cos(ang), math.sin(ang)
    pts = []
    for x, y in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        pts.append((center[0] + x * ca - y * sa, center[1] + x * sa + y * ca))
    draw_quad(c, a, tex, pts, color, 5, dst, discard_black=False)


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    """ThreeDEffect '*Smooth': log10(steps * 0.09 + 1), steps 0..100."""
    return math.log10(t * 100 * 0.09 + 1)


def alpha_of(t, amax, fade_in, fade_out):
    if fade_in and t < 0.25:
        return amax * t / 0.25
    if fade_out and t > 0.75:
        return amax * (1 - t) / 0.25
    return amax


def asura_frames(size, origin, step_ms=50):
    """EF_BEGINASURA 328 (EffectTable.js): letters 阿修羅覇凰拳 (asura1-6) at height 4 cells in a row, three ghost copies
    shrinking 250 -> 120 px over 1200 ms (fade-in), then 120 -> 200 px with fade-out over 400 ms. Overlay, normal blend;
    red/green/blue 0.1 tint from the table renders the dark ink of the glyph texture."""
    posx = {1: -6.0, 2: -3.6, 3: -1.2, 4: 1.2, 5: 3.6, 6: 6.0}
    # our battle field is narrow: the row is compressed to keep the six glyphs over the caster (x0.33)
    xs = {i: v * 0.33 for i, v in posx.items()}
    frames, alphas = [], []
    total = 1600
    for t_ms in range(0, total + 1, step_ms):
        c = np.zeros((size[1], size[0], 3), np.float32)
        a = np.zeros((size[1], size[0]), np.float32)
        for i in range(1, 7):
            tex = load_texture(f'asura{i}.tga')
            for dup in range(3):
                st = dup * 150
                tt = t_ms - st
                if 0 <= tt <= 1200:
                    t = tt / 1200
                    size_px = lerp(250, 120, smooth(t))
                    al = alpha_of(t, 1 - 0.25 * dup, True, False)
                elif dup == 0 and 1200 < t_ms <= 1600:
                    t = (t_ms - 1200) / 400
                    size_px = lerp(120, 200, t)
                    al = alpha_of(t, 1, False, True)
                else:
                    continue
                sx, sy = project(origin, xs[i], 0, 4 * 0.55)
                sz = size_px * 0.32
                billboard(c, a, tex, (sx, sy), sz, sz, 0, (0.1, 0.1, 0.1, al), dst=6)
        frames.append(to_u8(c / np.maximum(a[..., None], 1e-6)))
        alphas.append(to_u8(a))
    return frames, alphas


def lens_burst_frames(size, origin, n=24, step_ms=40, seed=266, tint=(1, 1, 1)):
    """EF_TEIHIT1X 266: 24 streaks lens1.tga 10x150 px, fade in/out over 550 ms (from 100 ms), flying from the target
    outward to a random point within 40 px, rotated toward the hit direction; additive (blendMode 2)."""
    rnd = random.Random(seed)
    tex = load_texture('lens1.tga')
    streaks = []
    for _ in range(n):
        ang = rnd.uniform(0, 360)
        dist = rnd.uniform(10, 40)
        streaks.append((ang, dist))
    frames = []
    for t_ms in range(0, 700, step_ms):
        c = np.zeros((size[1], size[0], 3), np.float32)
        a = np.ones((size[1], size[0]), np.float32)
        tt = (t_ms - 100) / 550
        if 0 <= tt <= 1:
            al = alpha_of(tt, 0.8, True, True)
            for ang, dist in streaks:
                r = math.radians(ang)
                d = dist * tt
                cx, cy = origin[0] + math.cos(r) * d, origin[1] - 45 + math.sin(r) * d * DEPTH
                billboard(c, a, tex, (cx, cy), 10 * 0.6, 150 * 0.6, ang + 90, (*tint, al))
        frames.append(to_u8(c))
    return frames


def purpleslash_frames(size, origin, step_ms=40):
    """EF_SOULBREAKER2 409 (Meteor Assault): eight purpleslash.tga crescents, alpha 0.6, 100 -> 200 px, flying from 1 to 5
    cells away from the caster in the eight directions (angle 0, -45 ... -315), fade-out, 500 ms; normal blend over a
    dark screen = we render it additive on black (the texture is a glow)."""
    tex = load_texture('purpleslash.tga')
    dirs = [(-1, 0, 0), (-0.7, -0.7, -45), (0, -1, -90), (0.7, -0.7, -135), (1, 0, -180), (0.7, 0.7, -225), (0, 1, -270),
            (-0.7, 0.7, -315)]
    frames = []
    for t_ms in range(0, 520, step_ms):
        t = t_ms / 500
        c = np.zeros((size[1], size[0], 3), np.float32)
        a = np.ones((size[1], size[0]), np.float32)
        al = alpha_of(t, 0.6, False, True)
        for dx, dy, ang in dirs:
            d = lerp(1, 5, t) * 0.55
            sx, sy = project(origin, dx * d, dy * d, 0.6)
            sz = lerp(100, 200, t) * 0.55
            billboard(c, a, tex, (sx, sy), sz, sz, ang, (1, 1, 1, al * 1.6))
        frames.append(to_u8(c))
    return frames


def property_ground_frames(texname, size, origin, step_ms=60, total_ms=1800):
    """PropertyGround (EF_BOTTOM_DE 240 / EF_BOTTOM_VO 239): a cone ring 20 segments, bottom radius 1 cell, top 3 cells,
    height 2 cells, texture wrapped around (top edge v=0), size pulsing sin(tick/(360π)) >= 0.5, alpha 0.42, texels darker
    than 0.5 discarded. Rendered here twice brighter (alpha 0.84) — the 0.42 original reads as a pale crown on our field."""
    tex = load_texture(texname).copy()
    dark = (tex[..., :3] < 0.5).any(-1)
    tex[dark] = 0
    tex[..., 3] = np.where(dark, 0, 0.84)
    seg = 20
    frames = []
    for t_ms in range(0, total_ms, step_ms):
        k = max(0.5, math.sin(t_ms / (360 * math.pi) + 2.0))
        fade = min(1, t_ms / 300, (total_ms - t_ms) / 400)
        c = np.zeros((size[1], size[0], 3), np.float32)
        al = np.zeros((size[1], size[0]), np.float32)
        quads = []
        for i in range(seg):
            a0, a1 = i / seg, (i + 1) / seg
            b0, b1 = (i + 0.5) / seg, (i + 1.5) / seg
            p_b0 = project(origin, math.sin(a0 * 2 * math.pi) * 1.0 * k, math.cos(a0 * 2 * math.pi) * 1.0 * k, 0)
            p_b1 = project(origin, math.sin(a1 * 2 * math.pi) * 1.0 * k, math.cos(a1 * 2 * math.pi) * 1.0 * k, 0)
            p_t0 = project(origin, math.sin(b0 * 2 * math.pi) * 3.0 * k, math.cos(b0 * 2 * math.pi) * 3.0 * k, 2)
            p_t1 = project(origin, math.sin(b1 * 2 * math.pi) * 3.0 * k, math.cos(b1 * 2 * math.pi) * 3.0 * k, 2)
            depth = math.cos((a0 + 0.025) * 2 * math.pi)   # far side first
            u0 = (i % 5) / 5
            quads.append((depth, [p_t0, p_t1, p_b1, p_b0], [(u0, 0), (u0 + 0.2, 0), (u0 + 0.2, 1), (u0, 1)]))
        for _, pts, uv in sorted(quads, key=lambda q: q[0]):
            draw_quad(c, al, tex, pts, (1, 1, 1, fade), 5, 6, uv=uv)
        frames.append(to_u8(c))
    return frames


def notes_frames(size, origin, step_ms=60, total_ms=1800, seed=294):
    """DC_SERVICEFORYOU ground (Songs.js / Tiles.HoveringTexture): a melody_a/melody_b note hovering over every cell of the
    song area, bobbing up and down. Here: the notes of three cells over each buffed ally (role buff)."""
    rnd = random.Random(seed)
    tex = [load_texture('melody_a.bmp'), load_texture('melody_b.bmp')]
    cells = [(-1, 0), (0, -0.4), (1, 0)]
    phase = {cxy: rnd.uniform(0, 2 * math.pi) for cxy in cells}
    which = {cxy: rnd.randrange(2) for cxy in cells}
    frames, alphas = [], []
    for t_ms in range(0, total_ms, step_ms):
        fade = min(1, t_ms / 250, (total_ms - t_ms) / 350)
        c = np.zeros((size[1], size[0], 3), np.float32)
        a = np.zeros((size[1], size[0]), np.float32)
        for (x, y) in sorted(cells, key=lambda q: q[1]):
            bob = 0.5 + 0.2 * math.sin(t_ms / 180 + phase[(x, y)])
            sx, sy = project(origin, x * 0.75, y, bob + 2.6)
            billboard(c, a, tex[which[(x, y)]], (sx, sy), 30, 30, 0, (1, 1, 1, fade), dst=6)
        frames.append(to_u8(c / np.maximum(a[..., None], 1e-6)))
        alphas.append(to_u8(a))
    return frames, alphas


# ---------------------------------------------------------------- job table
def falcon_plan(dive_from=(-120, -150), hit=(0, -40), leave=(130, -170)):
    """Blitz Beat / Falcon Assault: the falcon (data/sprite/이팩트/매) dives from the hunter's side onto the target, strikes
    and climbs away. ACT actions 0-7 = flight by direction (8 flap frames each, 100 ms); 7 = toward SE, 5 = toward NE."""
    plan = []
    n_in, n_hit, n_out = 4, 3, 6
    for i in range(n_in):
        t = (i + 1) / n_in
        plan.append((7, (i * 2) % 8, lerp(dive_from[0], hit[0], t), lerp(dive_from[1], hit[1], t * t)))
    for i in range(n_hit):
        plan.append((6, (i * 3) % 8, hit[0] + i * 4, hit[1] + (2 if i == 1 else 0)))
    for i in range(n_out):
        t = (i + 1) / n_out
        plan.append((5, (i + 3) % 8, lerp(hit[0], leave[0], t), lerp(hit[1], leave[1], math.sqrt(t))))
    return plan


def jobs():
    J = {}

    def add(fid, **kw):
        J[fid] = kw

    # ---- ults
    add('fx_wz_lord_of_vermilion', kind='str', inst=[('lord.str', 0, 0, 0)], keys=range(0, 240, 8), size=(1000, 1100),
        origin=(500, 760), ro='90', attach='ground', threshold=10, feather=28, downscale=0.6, gain=1.0, clip=(200, 380, 200, 110),
        note='EF_LORD 90: lord.str (WZ_VERMILION effectId); 240 keys at 60 fps, every 6th; faint halo cut at 26')
    add('fx_wz_wind_hit', kind='str', inst=[('windhit1.str', 0, 0, 0)], keys=range(0, 33, 2), size=(400, 400),
        origin=(200, 220), ro='52', attach='target', threshold=8, gain=1.4,
        note='EF_WINDHIT 52: windhit1.str (hitEffectId of WZ_VERMILION and MG_THUNDERSTORM)')
    add('fx_mg_fire_wall', kind='str', inst=[('firewall1.str', -80, 6, 0), ('firewall2.str', -40, -4, 9), ('firewall1.str', 0, 4, 4),
        ('firewall2.str', 40, -6, 13), ('firewall1.str', 80, 2, 7)], keys=range(0, 66, 3), size=(500, 500), origin=(250, 360),
        ro='25', attach='ground', threshold=10, gain=1.0, downscale=0.8,
        note='EF_FIREWALL 25: firewall1/2.str (file firewall%d, rand 1..2) played on five cells of the wall, staggered starts')
    add('fx_kn_brandish', kind='str', inst=[('brandish.str', 0, 0, 0)], keys=range(0, 51, 3), size=(500, 500), origin=(250, 300),
        ro='70', attach='target', threshold=10, gain=1.0, downscale=0.75, note='EF_BRANDISHSPEAR 70: brandish.str (KN_BRANDISHSPEAR effectId)')
    add('fx_kn_brandish_cast', kind='str', inst=[('brandish2.str', 0, 0, 0)], keys=range(0, 38, 2), size=(400, 500),
        origin=(200, 360), ro='144', attach='caster', threshold=10, gain=1.1, downscale=0.75,
        note='EF_BRANDISH2 144: brandish2.str (KN_BRANDISHSPEAR effectIdOnCaster)')
    add('fx_sa_spell_breaker', kind='str', inst=[('spell.str', 0, 0, 0)], keys=range(0, 48, 2), size=(500, 600), origin=(250, 470),
        ro='234', attach='target', threshold=10, gain=1.2, clip=(190, 360, 190, 40), downscale=0.75, note='EF_SPELLBREAKER 234: spell.str (SA_SPELLBREAKER successEffectId)')
    add('fx_am_potion_red', kind='str', inst=[('빨간포션.str', 0, 0, 0)], keys=range(0, 27, 1), size=(300, 300), origin=(150, 200),
        ro='str_빨간포션', attach='target', threshold=8, gain=1.3,
        note='AM_POTIONPITCHER: red potion splash 빨간포션.str (EF_THROWITEM2 299 file, not in roBrowser)')
    add('fx_rg_close_confine', kind='spr', spr=('effect', 'cconfine'), plan=[(0, i, 0, 0) for i in range(12)], size=(300, 300),
        origin=(150, 200), ro='604', attach='target', mode='alpha', ms=50,
        note='EF_NPC_STOP2 604: sprite data/sprite/이팩트/cconfine (RG_CLOSECONFINE groundEffectId), action 0, native ACT timing')
    add('fx_ht_falcon', kind='spr', spr=('effect', '매'), plan=falcon_plan(), size=(420, 360), origin=(210, 250), ro='sprite 매',
        attach='target', mode='alpha', ms=60, from_='left',
        note='Falcon sprite data/sprite/이팩트/매 (HT_BLITZBEAT 115 / SN_FALCONASSAULT 387 — roBrowser plays only the sound): '
             'flight actions 7/6/5, the dive path is ours')
    add('fx_am_marine_sphere', kind='spr', spr=('monster', 'marine_sphere'), plan='sphere', size=(300, 300), origin=(150, 220),
        ro='sprite marine_sphere', attach='ground', mode='alpha', ms=60,
        note='AM_SPHEREMINE summons the Marine Sphere monster (data/sprite/몬스터/marine_sphere): idle spin, then its death action')
    add('fx_mo_asura_cast', kind='asura', size=(560, 460), origin=(280, 400), ro='328', attach='caster', mode='alpha', ms=50,
        note='EF_BEGINASURA 328 (MO_EXTREMITYFIST effectId): glyphs 阿修羅覇凰拳 asura1-6.tga, ThreeDEffect parameters')
    add('fx_mo_asura_hit', kind='lens', size=(300, 300), origin=(150, 200), ro='266', attach='target', mode='add', ms=40,
        note='EF_TEIHIT1X 266 (Asura Strike hit): 24 lens1.tga streaks, ThreeDEffect parameters')
    add('fx_sa_deluge', kind='ground', tex='ring_blue.tga', size=(400, 340), origin=(200, 220), ro='240', attach='ground',
        mode='add', ms=60, note='EF_BOTTOM_DE 240: PropertyGround cone with ring_blue.tga (SA_DELUGE groundEffectId), alpha x2')
    add('fx_dc_service_for_you', kind='notes', size=(300, 300), origin=(150, 240), ro='294_ground', attach='target', mode='alpha',
        ms=60, note="'294_ground' (DC_SERVICEFORYOU groundEffectId): Songs.js HoveringTexture melody_a/b.bmp over the song cells")
    # ---- frequent skills
    add('fx_asc_meteor_assault', kind='slash', size=(500, 360), origin=(250, 200), ro='409', attach='caster', mode='add', ms=40,
        note='EF_SOULBREAKER2 409 (ASC_METEORASSAULT effectIdOnCaster): eight purpleslash.tga crescents, ThreeDEffect parameters')
    add('fx_wz_earth_hit', kind='str', inst=[('earthhit.str', 0, 0, 0)], keys=range(0, 17, 1), size=(300, 300), origin=(150, 180),
        ro='147', attach='target', threshold=16, gain=1.6, note='EF_EARTHHIT 147: earthhit.str (WZ_HEAVENDRIVE / WZ_EARTHSPIKE hitEffectId)')
    add('fx_pr_sanctuary', kind='str', inst=[('sanctuary.str', 0, 0, 0)], keys=range(0, 105, 4), size=(500, 500), origin=(250, 330),
        ro='83', attach='ground', threshold=10, gain=1.0, clip=(200, 260, 200, 90), downscale=0.7, note='EF_SANCTUARY 83: sanctuary.str (PR_SANCTUARY effectId)')
    add('fx_sa_magic_rod', kind='str', inst=[('매직로드.str', 0, 0, 0)], keys=range(0, 44, 2), size=(600, 600), origin=(300, 420),
        ro='244', attach='caster', threshold=10, gain=1.2, clip=(230, 340, 230, 60), downscale=0.7, note='EF_MAGICROD 244: 매직로드.str (SA_MAGICROD successEffectId)')
    add('fx_wz_quagmire', kind='str', inst=[('quagmire.str', x * 30 + y * 12, y * 18, (abs(x) * 7 + abs(y) * 11) % 20)
                                             for x in (-2, -1, 0, 1, 2) for y in (-1, 0, 1)],
        keys=range(0, 140, 5), size=(500, 400), origin=(250, 250), ro='95', attach='ground', threshold=10, gain=1.6,
        downscale=0.8,
        note='EF_QUAGMIRE 95: quagmire.str (WZ_QUAGMIRE groundEffectId) on 15 cells of the swamp, staggered; x1.6 gain (too faint 1:1)')
    add('fx_mo_occult_impaction', kind='spr', spr=('effect', '침투경_'), plan=[(0, i, 0, 0) for i in range(12)], size=(300, 300),
        origin=(150, 200), ro='sprite 침투경_', attach='target', mode='add', ms=40,
        note='MO_INVESTIGATE 267: client sprite data/sprite/이팩트/침투경_ (Occult Impaction burst; roBrowser plays only the sound)')
    return J


def sphere_plan(act):
    idle = [(0, i, 0, 0) for i in range(0, 18, 4)]
    die = [(32, i, 0, 0) for i in range(0, len(act.actions[32]), 2)]
    return idle + die


def run(fid, job, preview_dir, write_json):
    kind = job['kind']
    mode = job.get('mode', 'add')
    alphas = None
    if kind == 'str':
        frames = str_frames(job['inst'], list(job['keys']), job['size'], job['origin'], job.get('gain', 1.0))
        keys = list(job['keys'])
        step = (keys[1] - keys[0]) * 1000 / 60
    elif kind == 'spr':
        spr, act = spr_layers(*job['spr'])
        plan = sphere_plan(act) if job['plan'] == 'sphere' else job['plan']
        frames, alphas = spr_sequence(spr, act, plan, job['size'], job['origin'], add=(mode == 'add'))
        if mode != 'alpha':
            alphas = None
        step = job['ms']
    elif kind == 'asura':
        (frames, alphas), step = asura_frames(job['size'], job['origin'], job['ms']), job['ms']
    elif kind == 'lens':
        frames, step = lens_burst_frames(job['size'], job['origin'], step_ms=job['ms']), job['ms']
    elif kind == 'slash':
        frames, step = purpleslash_frames(job['size'], job['origin'], job['ms']), job['ms']
    elif kind == 'ground':
        frames, step = property_ground_frames(job['tex'], job['size'], job['origin'], job['ms']), job['ms']
    elif kind == 'notes':
        (frames, alphas), step = notes_frames(job['size'], job['origin'], job['ms']), job['ms']
    else:
        raise SystemExit(kind)
    origin = job['origin']
    if job.get('clip'):            # fixed window around the feet (l, t, r, b px from origin): cuts the faint full-screen halo
        l, t, r, b = job['clip']
        x0, y0 = origin[0] - l, origin[1] - t
        frames = [f[y0:origin[1] + b, x0:origin[0] + r] for f in frames]
        if alphas is not None:
            alphas = [f[y0:origin[1] + b, x0:origin[0] + r] for f in alphas]
        origin = (l, t)
    out_png = REPO / 'assets' / 'effects' / f'{fid}.png'
    rep = build_sheet(frames, step, origin, out_png, preview=preview_dir / f'{fid}.png' if preview_dir else None,
                      threshold=job.get('threshold', 8), alphas=alphas, mode=mode if mode == 'alpha' else 'add',
                      downscale=job.get('downscale', 1.0), feather=job.get('feather', 0), max_frames=job.get('max_frames'))
    entry = {'id': fid, 'file': f'effects/{fid}.png', 'cell': rep['cell'], 'columns': rep['columns'], 'frames': rep['frames'],
             'ms': rep['ms'], 'loop': False, 'delayMs': rep['delayMs'], 'blend': 'normal' if mode == 'alpha' else 'add',
             'anchor': rep['anchor'], 'attach': job['attach']}
    if job.get('from_'):
        entry['from'] = job['from_']
    entry['source'] = {'roEffectId': job['ro'], 'renderer': f'raw/ro-build/tools/fx/build_ro_fx.py ({kind})',
                       'scale': round(1 / job.get('downscale', 1.0), 4), 'note': job['note']}
    if write_json:
        doc = json.loads((REPO / 'assets/effects/effects.json').read_text())
        old = next((e for e in doc['effects'] if e['id'] == fid), None)
        for k in ('scale', 'alpha', 'rise'):        # hand-tuned display fields survive a rebuild
            if old and k in old:
                entry[k] = old[k]
        if old and 'scale' in old:
            entry = {**{k: v for k, v in entry.items() if k != 'source'}, 'source': entry['source']}
        merge_entry(REPO / 'assets/effects/effects.json', entry)
    print(fid, json.dumps({k: rep[k] for k in ('cell', 'frames', 'ms', 'sheet', 'bytes', 'thinned')}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='*')
    ap.add_argument('--preview')
    ap.add_argument('--no-json', action='store_true')
    a = ap.parse_args()
    J = jobs()
    for fid in a.ids or list(J):
        run(fid, J[fid], Path(a.preview) if a.preview else None, not a.no_json)


if __name__ == '__main__':
    main()
