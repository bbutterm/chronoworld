"""Build schema-2 sprite sheets (docs/SPRITE_SPEC.md on chronoworld origin/main 9e5589691)
from the byte-exact SPR/ACT in staging/ro-extract/raw/ro. Output stays in staging.
"""
import json, os, sys
import numpy as np
from PIL import Image
from ro_spr_act import Spr, Act, render_frame, bbox_rel

ROOT = '/root/ro-client-extraction-2/staging/ro-extract'
RAW = os.path.join(ROOT, 'raw', 'ro')
OUT = os.path.join(ROOT, 'assets', 'sprites')

GRID = {  # class: (cell, anchor, columns) — identical to tools/check_sprites.py GRID
    'monster': ((240, 224), (100, 120), 8),
    'boss': ((256, 256), (112, 216), 8),
    'monster_xl': ((272, 330), (167, 280), 6),
    # PROPOSED, not in the game spec yet: only for sprites whose idle/walk do not fit monster_xl
    'boss_xl': ((296, 272), (96, 218), 6),
}
FOLDER = {'monster': 'monsters', 'boss': 'bosses', 'monster_xl': 'monsters_xl', 'boss_xl': 'bosses_xl'}
ANIMS = [('idle', 0, 4, 150), ('walk', 1, 6, 100), ('attack', 2, 6, 80), ('hurt', 3, 3, 100), ('death', 4, 5, 120)]
DIRECTION = 6                                 # east, per spec
# sprite file -> (sheet id, preferred class, owner-list unit ids, mob_db id)
MOBS = {
    'marin': ('marin', 'monster', ['mob_marin'], 1242),
    'pupa': ('pupa', 'monster', ['mob_pupa'], 1008),
    'thief_bug_male': ('thief_bug_male', 'monster', ['sewer_bug_male', 'sewer_bug_leader'], 1054),
    'thief_bug_female': ('thief_bug_female', 'monster', ['sewer_bug_female'], 1053),
    'thief_bug_larva': ('thief_bug_larva', 'monster', ['sewer_thief_bug'], 1051),
    'thief_bug': ('thief_bug', 'monster', ['sewer_thief_bug (alt)'], 1051),
    'thief_bug_egg': ('thief_bug_egg', 'monster', ['sewer_bug_egg'], 1048),
    'plankton': ('plankton', 'monster', ['sewer_plankton'], 1161),
    'tarou': ('tarou', 'monster', ['sewer_tarou'], 1175),
    'farmiliar': ('familiar', 'monster', ['sewer_familiar'], 1005),
    'orc_lord': ('orc_lord', 'boss', ['orc_lord'], 1190),
    'ork_warrior': ('orc_warrior', 'monster', ['orc_warrior'], 1023),
    'high_orc': ('high_orc', 'monster', ['orc_high'], 1213),
    'orc_archer': ('orc_archer', 'monster', ['orc_archer'], 1189),
    'orc_lady': ('orc_lady', 'monster', ['orc_lady'], 1273),
    'orc_skeleton': ('orc_skeleton', 'monster', ['orc_skeleton'], 1152),
    'orc_zombie': ('orc_zombie', 'monster', ['orc_zombie'], 1153),
    'steel_chocho': ('steel_chonchon', 'monster', ['orc_chonchon'], 1042),
    'ancient_mummy': ('ancient_mummy', 'boss', ['mob4_ancient_mummy'], 1297),
    'c_tower_manager': ('clock_tower_manager', 'boss', ['alde_keeper'], 1270),
    'owl_baron': ('owl_baron', 'boss', ['alde_owl_baron'], 1295),
    'owl_duke': ('owl_duke', 'monster', ['alde_owl_duke'], 1320),
    'alarm': ('alarm', 'monster', ['alde_alarm'], 1193),
    'clock': ('clock', 'monster', ['alde_clock'], 1269),
    'rideword': ('rideword', 'monster', ['alde_rideword'], 1195),
    'punk': ('punk', 'monster', ['alde_punk'], 1199),
    'elder': ('elder', 'monster', ['alde_elder'], 1377),
    'knight_of_abyss': ('abysmal_knight', 'boss', ['mob3_knight'], 1219),
    'evil_druid': ('evil_druid', 'boss', ['mob3_boss'], 1117),
    'ghoul': ('ghoul', 'monster', ['mob3_melee', 'mob2_elite'], 1036),
    'baphomet_': ('baphomet_jr', 'monster', ['maze: Baphomet Jr.'], 1101),
    'ghostring': ('ghostring', 'boss', ['maze mini-boss'], 1120),
    'vagabond_wolf': ('vagabond_wolf', 'boss', ['maze mini-boss'], 1092),
    'eclipse': ('eclipse', 'monster', ['mob_eclipse'], 1093),
    'vocal': ('vocal', 'monster', ['mob_vocal'], 1088),
    'hunter_fly': ('hunter_fly', 'monster', ['maze'], 1035),
    'side_winder': ('side_winder', 'monster', ['maze'], 1037),
    'mantis': ('mantis', 'monster', ['maze'], 1139),
    'stem_worm': ('stem_worm', 'monster', ['maze'], 1215),
    'killer_mantis': ('killer_mantis', 'monster', ['maze elite'], 1294),
    'deviruchi': ('deviruchi', 'monster', ['maze elite'], 1109),
    'lord_of_death': ('lord_of_death', 'boss', ['mob_lord_of_death'], 1373),
    'bloody_knight': ('bloody_knight', 'boss', ['mob7_bridge_warden'], 1268),
    'elder_wilow': ('elder_willow', 'boss', ['mob2_boss'], 1033),
    'pharaoh': ('pharaoh', 'boss', ['optional'], 1157),
    'penomena': ('penomena', 'monster', ['optional'], 1216),
    'khalitzburg': ('khalitzburg', 'monster', ['optional'], 1132),
    'raydric_archer': ('raydric_archer', 'monster', ['optional'], 1276),
    'wraith': ('wraith', 'monster', ['optional'], 1192),
    'whisper': ('whisper', 'monster', ['optional'], 1179),
    'skel_prisoner': ('skel_prisoner', 'monster', ['optional'], 1196),
    'zombie_prisoner': ('zombie_prisoner', 'monster', ['optional'], 1197),
    'sasquatch': ('sasquatch', 'monster', ['optional'], 1243),
    'leib_olmai': ('leib_olmai', 'monster', ['optional'], 1306),
    'disguise': ('disguise', 'monster', ['optional'], 1506),
    'lude': ('lude', 'monster', ['optional'], 1509),
    'hylozoist': ('hylozoist', 'monster', ['optional'], 1510),
    'toad': ('toad', 'monster', ['optional'], 1089),
    'thara_frog': ('thara_frog', 'monster', ['optional'], 1034),
    'roda_frog': ('roda_frog', 'monster', ['optional'], 1012),
}
ORDER = ['monster', 'boss', 'monster_xl']
PROPOSED = ['boss_xl']


def expected_indices(total, target, death):
    if total >= target:
        return [round(i * (total - 1) / (target - 1)) for i in range(target)]
    if death:
        return list(range(total)) + [total - 1] * (target - total)
    return [i % total for i in range(target)]


def fits(b, cls):
    (cw, ch), (ax, ay), _ = GRID[cls]
    return b is not None and b[0] + ax > 0 and b[1] + ay > 0 and b[2] + ax < cw and b[3] + ay < ch


def load(name):
    with open(os.path.join(RAW, 'sprite', 'monster', name + '.spr'), 'rb') as f:
        spr = Spr(f.read())
    with open(os.path.join(RAW, 'sprite', 'monster', name + '.act'), 'rb') as f:
        act = Act(f.read())
    return spr, act


def plan(spr, act):
    """Render every source frame of the 5 used actions once."""
    out = {}
    for anim, group, n, _ in ANIMS:
        a = group * 8 + DIRECTION
        if a >= len(act.actions):
            raise ValueError(f'{anim}: action {a} missing ({len(act.actions)} actions)')
        frames = []
        for fr in act.actions[a]:
            img, ox, oy = render_frame(spr, fr)
            frames.append(dict(img=img, ox=ox, oy=oy, bbox=bbox_rel(img, ox, oy), event=act.event_name(fr)))
        out[anim] = dict(action=a, frames=frames, delay=act.delay_ms(a))
    return out


def choose(src, cls):
    """Spec sampling; oversize frames are skipped (documented) only when unavoidable."""
    chosen, exceptions = {}, {}
    for anim, _, n, _ in ANIMS:
        frames = src[anim]['frames']
        idx = expected_indices(len(frames), n, anim == 'death')
        if all(fits(frames[i]['bbox'], cls) for i in idx):
            chosen[anim] = idx; continue
        ok = [i for i, f in enumerate(frames) if fits(f['bbox'], cls)]
        if not ok:
            return None, None
        alt = sorted(ok[j] for j in expected_indices(len(ok), n, anim == 'death'))
        chosen[anim] = alt
        exceptions[anim] = dict(skipped=[i for i in range(len(frames)) if i not in ok], reason='frame exceeds cell at x1')
    return chosen, exceptions


def hit_frame(src, idx):
    ev = [i for i, f in enumerate(src['attack']['frames']) if f['event'] == 'atk']
    if not ev:
        return 3, None
    h = ev[0]
    col = min(range(len(idx)), key=lambda c: (idx[c] < h, abs(idx[c] - h)))
    return col, h


def build(name, meta):
    sid, prefer, units, mob_id = meta
    spr, act = load(name)
    src = plan(spr, act)
    # Pick the approved class that skips the fewest source frames (ties -> smaller cell);
    # fall back to the proposed class only when no approved class can hold every animation.
    best = None
    for c in ORDER[ORDER.index(prefer):] + PROPOSED:
        if c in PROPOSED and best is not None:
            break
        chosen_c, exc_c = choose(src, c)
        if chosen_c is None:
            continue
        skipped = sum(len(v['skipped']) for v in exc_c.values())
        if best is None or skipped < best[0]:
            best = (skipped, c, chosen_c, exc_c)
    if best is None:
        raise ValueError('no frame fits even the proposed boss_xl class')
    _, cls, chosen, exc = best
    (cw, ch), (ax, ay), cols = GRID[cls]
    sheet = Image.new('RGBA', (cw * cols, ch * len(ANIMS)), (0, 0, 0, 0))
    entry = dict(id=sid, **{'class': cls}, file=f'sprites/{FOLDER[cls]}/{sid}.png',
                 source=dict(job=name, jobId=mob_id, gender='none', head=0, weaponView=0, shieldView=0, itemId=0,
                             shieldItemId=0, renderer=f'ro-client-extraction tools/ro_spr_act.py; scRO {name}.spr/.act; '
                                                        f'ACT direction {DIRECTION}; shadow=false; native x1'),
                 hitFrames={}, bbox={}, sourceFrameBboxes={}, sourceFrameIndices={}, sourceFrameCounts={},
                 sourceDelayMs={}, sourceSounds={}, units=units)
    alphas = set()
    for row, (anim, group, n, _) in enumerate(ANIMS):
        frames = src[anim]['frames']
        idx = chosen[anim]
        boxes = []
        for c, i in enumerate(idx):
            f = frames[i]
            if f['img'] is None:
                raise ValueError(f'{anim} frame {i} empty')
            sheet.alpha_composite(f['img'], (c * cw + ax - f['ox'], row * ch + ay - f['oy']))
            boxes.append(f['bbox'])
            a = np.asarray(f['img'])[:, :, 3]
            alphas.update(int(v) for v in np.unique(a) if 0 < v < 255)
        entry['sourceFrameIndices'][anim] = idx
        entry['sourceFrameCounts'][anim] = len(frames)
        entry['sourceFrameBboxes'][anim] = boxes
        entry['bbox'][anim] = [min(b[0] for b in boxes) + ax, min(b[1] for b in boxes) + ay,
                               max(b[2] for b in boxes) + ax, max(b[3] for b in boxes) + ay]
        entry['sourceDelayMs'][anim] = src[anim]['delay']
        entry['sourceSounds'][anim] = sorted({f['event'] for f in frames if f['event'] and f['event'] != 'atk'})
    hit, src_hit = hit_frame(src, chosen['attack'])
    entry['hitFrames']['attack'] = hit
    entry['hitFrameSource'] = f'ACT "atk" event at source frame {src_hit}' if src_hit is not None else 'no ACT atk event; spec default 3'
    entry['sourceAlphaValues'] = sorted(alphas)
    if exc:
        entry['samplingExceptions'] = exc
    path = os.path.join(OUT, FOLDER[cls], sid + '.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    save_png(sheet, path)
    return entry


def save_png(img, path):
    """Lossless: indexed PNG with alpha when <=256 RGBA colours, else RGBA."""
    arr = np.asarray(img)
    flat = arr.reshape(-1, 4)
    flat = np.where(flat[:, 3:4] == 0, 0, flat)       # all fully transparent pixels identical
    colors, inv = np.unique(flat, axis=0, return_inverse=True)
    if len(colors) <= 256:
        p = Image.fromarray(inv.reshape(arr.shape[:2]).astype(np.uint8), 'P')
        pal = colors[:, :3].astype(np.uint8).flatten().tolist()
        p.putpalette(pal + [0] * (768 - len(pal)))
        p.info['transparency'] = bytes(colors[:, 3].astype(np.uint8).tolist())
        p.save(path, optimize=True, transparency=bytes(colors[:, 3].astype(np.uint8).tolist()))
        if not np.array_equal(np.asarray(Image.open(path).convert('RGBA')).reshape(-1, 4), flat):
            raise ValueError(f'{path}: indexed round-trip changed pixels')
    else:
        Image.fromarray(flat.reshape(arr.shape).astype(np.uint8), 'RGBA').save(path, optimize=True)


def main():
    only = sys.argv[1:]
    entries, errors = [], []
    for name, meta in MOBS.items():
        if only and name not in only:
            continue
        try:
            e = build(name, meta)
            entries.append(e)
            print(f"{e['id']:22s} {e['class']:10s} hit={e['hitFrames']['attack']} counts={e['sourceFrameCounts']}"
                  + (f" EXC={list(e['samplingExceptions'])}" if 'samplingExceptions' in e else ''))
        except Exception as ex:
            errors.append((name, str(ex)))
            print(f'{name}: ERROR {ex}')
    frag = dict(schema=2, generatedFrom='scRO client (see SOURCE_PROVENANCE.md)', specRef='chronoworld origin/main 9e5589691 docs/SPRITE_SPEC.md',
                classes={k: dict(cell=list(v[0]), anchor=list(v[1]), columns=v[2], **({'proposed': True} if k in PROPOSED else {})) for k, v in GRID.items()},
                sprites=entries, errors=errors)
    with open(os.path.join(OUT, 'sprites.fragment.json'), 'w', encoding='utf-8') as f:
        json.dump(frag, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
