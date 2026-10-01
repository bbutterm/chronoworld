"""Second byte-exact batch from the scRO client into raw/ro (01.10.2026).

Lists: docs/SPRITES_NEEDED.md (MVP monsters, item icons, card illustrations) and docs/RO_EFFECTS_EXTRACT.md
(STR/textures/SPR/WAV of the hero ults and "extract first" skills). Effect files are resolved through
roBrowserLegacy DB/Effects/EffectTable.js + DB/Skills/SkillEffect.js (pass their folder as --robrowser),
plus the hand-picked client files below. Appends rows to raw/ro/manifest.csv and writes raw/ro/fx_sources.csv.

    python3 extract_batch2.py --client /path/to/scRO --robrowser /path/with/js [--repo /path/to/chronoworld]
"""
import argparse, csv, hashlib, os, re, struct, sys
import grf as grfmod
from ro_spr_act import Act

MON = 'data\\sprite\\몬스터\\'
EFX = 'data\\sprite\\이팩트\\'
TEX = 'data\\texture\\effect\\'
UI = 'data\\texture\\유저인터페이스\\'
WAV = 'data\\wav\\'

MOBS = ['eddga', 'dracula', 'angeling', 'archangeling', 'maya', 'turtle_general', 'amon_ra', 'doppelganger',
        'marine_sphere']                              # marine_sphere: Sphere Mine (AM_SPHEREMINE) summons it
# (our item, item_db id): SPRITES_NEEDED В. Robe of Cast (2343) and Tidal Shoes (2424) are already in raw/ro
# as dark_lord_robe / sea_boots, so other dark robe / boots are taken.
ITEMS = [('crescent_scythe', 1466), ('majestic_goat', 2256), ('pact_mantle: Diabolus Robe', 2374),
         ('maze_boots: Diabolus Boots', 2433), ('maze_boots alt: Vidar\'s Boots', 2418)]
CARDS = ['Mastering', 'Osiris', 'Moonlight Flower', 'Orc Lord', 'Mistress', 'Dark Lord', 'Baphomet', 'Pharaoh',
         'Poring', 'Pupa', 'Hunter Fly', 'Orc Warrior', 'Mandragora', 'Mantis', 'Fabre', 'Rocker', 'Drops', 'Marin',
         'Poporing', 'Thief Bug', 'Steel Chonchon', 'High Orc', 'Angeling', 'Archangeling', 'Bapho Jr.',
         'Deviruchi', 'Vagabond Wolf', 'Whisper', 'Rideword', 'Orc Hero', 'Golden Thief Bug', 'Drake',
         'Eddga', 'Dracula', 'Maya', 'Turtle General', 'Amon Ra', 'Doppelganger']
SKILLS = {
    'ult': 'MO_EXTREMITYFIST WZ_VERMILION MG_FIREWALL KN_BRANDISHSPEAR AC_SHOWER HT_BLITZBEAT BA_FROSTJOKER '
           'TF_SPRINKLESAND MO_BALKYOUNG RG_CLOSECONFINE CG_ARROWVULCAN DC_SERVICEFORYOU AM_POTIONPITCHER '
           'AM_SPHEREMINE SA_SPELLBREAKER SA_DELUGE',
    'first': 'MO_STEELBODY WS_CARTTERMINATION ASC_METEORASSAULT WZ_HEAVENDRIVE SA_VOLCANO CR_ACIDDEMONSTRATION '
             'SN_FALCONASSAULT LK_SPIRALPIERCE BA_ASSASSINCROSS DC_FORTUNEKISS',
    'frequent': 'PR_SANCTUARY SA_MAGICROD BS_OVERTHRUST RG_RAID RG_BACKSTAP MO_TRIPLEATTACK MO_INVESTIGATE '
                'WZ_QUAGMIRE HW_MAGICPOWER AM_CP_ARMOR AM_ACIDTERROR DC_SCREAM',
}
HIT_EFFECTS = [51, 52, 147, 121, 122]                 # element / Sonic Blow hits shared by many skills
# Files roBrowser does not name (FUNC / '%d' patterns / code-drawn effects), found in the GRF by name.
MANUAL = [
    ('MG_FIREWALL', 'EF_FIREWALL 25 (file firewall%d)', [TEX + 'firewall.str', TEX + 'firewall1.str', TEX + 'firewall2.str']),
    ('MG_FIREWALL', 'EF_FIREHIT 49 (file firehit%d)', [TEX + 'firehit.str', TEX + 'firehit1.str', TEX + 'firehit2.str', TEX + 'firehit3.str']),
    ('WZ_VERMILION', 'EF_WINDHIT 52 (file windhit%d)', [TEX + 'windhit.str', TEX + 'windhit1.str', TEX + 'windhit2.str', TEX + 'windhit3.str']),
    ('HT_BLITZBEAT', 'falcon sprite (EF_BLITZBEAT 115 is sound only in roBrowser)', [EFX + '매.spr', EFX + '매.act']),
    ('SN_FALCONASSAULT', 'falcon sprite (EF_FALCONASSAULT 387)', [EFX + '매.spr', EFX + '매.act']),
    ('MO_INVESTIGATE', 'client sprite 침투경_ (Occult Impaction), not referenced by roBrowser', [EFX + '침투경_.spr', EFX + '침투경_.act']),
    ('AM_POTIONPITCHER', 'potion splash STRs (EF_THROWITEM2 299 not in roBrowser)', [TEX + n + '.str' for n in ('빨간포션', '주홍포션', '노란포션', '하얀포션', '파란포션', '초록포션')]),
    ('AM_SPHEREMINE', 'Marine Sphere monster (summoned by the skill)', [MON + 'marine_sphere.spr', MON + 'marine_sphere.act']),
    ('SA_VOLCANO', 'EF_BOTTOM_VO 239: PropertyGround texture ring_red', [TEX + 'ring_red.tga']),
    ('SA_DELUGE', 'EF_BOTTOM_DE 240: PropertyGround texture ring_blue', [TEX + 'ring_blue.tga']),
    ('DC_SERVICEFORYOU', 'song cell textures (Songs.js)', [TEX + 'melody_a.bmp', TEX + 'melody_b.bmp']),
    ('MO_EXTREMITYFIST', 'Asura hit texture 266/276', [TEX + 'lens1.tga', TEX + 'lens2.tga']),
]


class Out:
    def __init__(self, repo, g):
        self.raw = os.path.join(repo, 'raw', 'ro')
        self.repo = repo
        self.g = g
        self.rows = []
        with open(os.path.join(self.raw, 'manifest.csv'), encoding='utf-8') as f:
            self.known = {r['source'].lower(): r for r in csv.DictReader(f)}
        self.missing = []

    def path(self, src):
        """Output path: fixed latin folder for the client folder, client file name (and effect subfolder) kept."""
        low = src.lower()
        for pre, folder in ((MON, 'sprite/monster'), (EFX, 'sprite/effect'), (TEX, 'texture/effect'),
                            (UI + 'item\\', 'texture/item'), (UI + 'collection\\', 'texture/collection'),
                            (UI + 'cardbmp\\', 'texture/cardbmp'), (WAV, 'wav')):
            if low.startswith(pre.lower()):
                parts = src[len(pre):].split('\\')
                break
        else:
            raise ValueError(f'no folder for {src}')
        for p in parts:
            if not p or p in ('.', '..') or any(c in p for c in '/\0:'):
                raise ValueError(f'unsafe name {src!r}')
        out = os.path.realpath(os.path.join(self.raw, folder, *parts))
        if not out.startswith(os.path.realpath(self.raw) + os.sep):
            raise ValueError(f'escapes raw/ro: {out}')
        return out

    def get(self, src, group, note='', required=True):
        if not self.g.has(src):
            if required:
                self.missing.append((group, src, note))
            return None
        data = self.g.read(src)
        out = self.path(src)
        rel = os.path.relpath(out, self.repo)
        if src.lower() in self.known or any(r['source'].lower() == src.lower() for r in self.rows):
            return data                               # already extracted earlier (same GRF path)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        if os.path.islink(out):
            raise ValueError(f'refusing symlink {out}')
        with open(out, 'wb') as f:
            f.write(data)
        arch, _ = self.g.locate(src)
        self.rows.append(dict(group=group, source=self.g.locate(src)[1]['name'], archive=arch, size=len(data),
                              sha256=hashlib.sha256(data).hexdigest(), output=rel, note=note))
        return data


def table(g, path, enc):
    t = {}
    for line in g.read(path).decode(enc, 'replace').splitlines():
        a = line.split('#')
        if len(a) >= 2 and a[0].strip().isdigit():
            t[int(a[0])] = a[1]
    return t


def str_textures(path, data):
    if data[:4] != b'STRM':
        return []
    folder = path.rsplit('\\', 1)[0] + '\\'
    _, _, _, layers = struct.unpack('<IIII', data[4:20]); p = 36
    out = []
    for _ in range(layers):
        (n,) = struct.unpack('<I', data[p:p + 4]); p += 4
        for _ in range(n):
            out.append(folder + data[p:p + 128].split(b'\0')[0].decode('cp949', 'replace')); p += 128
        (k,) = struct.unpack('<I', data[p:p + 4]); p += 4 + k * 124
    return out


class RoBrowser:
    def __init__(self, folder):
        et = open(os.path.join(folder, 'EffectTable.js'), encoding='utf-8').read()
        self.se = open(os.path.join(folder, 'SkillEffect.js'), encoding='utf-8').read()
        starts = [(int(m.group(1)), m.start()) for m in re.finditer(r'^\t(\d+): \[', et, re.M)]
        self.blocks = {e: et[s:(starts[i + 1][1] if i + 1 < len(starts) else len(et))] for i, (e, s) in enumerate(starts)}

    def skill_ids(self, sk):
        m = re.search(r'SkillEffect\[SK\.' + sk + r'\]\s*=\s*\{(.*?)\n?\};', self.se, re.S)
        if not m:
            return []
        body = re.sub(r'\b(duration|delay\w*|timeout)\s*:\s*\d+', '', m.group(1))
        return [int(x) for x in dict.fromkeys(re.findall(r'(?<![\w.])(\d{1,4})(?![\w.])', body))]

    def refs(self, eid):
        b = self.blocks[eid]
        name = (re.findall(r'//\s*(EF_\w+)', b) or [''])[0]
        out = []
        for m in re.finditer(r"(\w+)\s*:\s*'([^']+)'", b):
            key, v = m.group(1), m.group(2)
            if key == 'type' or v.endswith('/') or '%' in v:
                continue
            if '\\x' in v:
                v = re.sub(r'\\x([0-9a-fA-F]{2})', lambda x: chr(int(x.group(1), 16)), v).encode('latin1').decode('cp949', 'replace')
            out.append((key, v.replace('/', '\\')))
        return name, out


def candidates(key, v):
    if key == 'wav':
        return [WAV + v + '.wav']
    return [pre + v + ext for pre in (TEX, 'data\\texture\\', EFX) for ext in ('', '.str', '.tga', '.bmp', '.spr')]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--client', required=True)
    ap.add_argument('--robrowser', required=True)
    ap.add_argument('--repo', default=os.path.realpath(os.path.join(os.path.dirname(__file__), '..', '..', '..')))
    a = ap.parse_args()
    g = grfmod.GRF(a.client)
    o = Out(a.repo, g)
    sounds = set()

    for n in MOBS:
        o.get(MON + n + '.spr', 'monster_mvp', '')
        act = o.get(MON + n + '.act', 'monster_mvp', '')
        if act:
            sounds.update(s for s in Act(act).sounds if s.lower().endswith('.wav'))
    for s in sorted(sounds):
        o.get(WAV + s.replace('/', '\\').lstrip('\\'), 'monster_sound', 'ACT event sound')

    res = table(g, 'data\\idnum2itemresnametable.txt', 'cp949')
    names = table(g, 'data\\idnum2itemdisplaynametable.txt', 'cp1251')
    for our, iid in ITEMS:
        note = f'{our}; item_db {iid} {names.get(iid, "").strip()}'
        o.get(UI + 'item\\' + res[iid] + '.bmp', 'item', note)
        o.get(UI + 'collection\\' + res[iid] + '.bmp', 'item', note)

    ill = table(g, 'data\\num2cardillustnametable.txt', 'cp949')
    card_ids = {}
    for iid, n in names.items():
        if 4001 <= iid < 4700:
            card_ids.setdefault(n.strip().replace('_', ' ').lower(), iid)
    for c in CARDS:
        iid = card_ids.get((c + ' card').lower())
        if iid is None or iid not in ill:
            o.missing.append(('card', c, 'no card id / illustration')); continue
        o.get(UI + 'cardbmp\\' + ill[iid] + '.bmp', 'card', f'{c} Card {iid}')

    rb = RoBrowser(a.robrowser)
    fx_rows = []

    def take(skill, src, eff, group):
        data = o.get(src, 'fx', f'{skill} {eff}', required=False)
        if data is None:
            return False
        row = dict(skill=skill, group=group, effect=eff, source=g.locate(src)[1]['name'], output=os.path.relpath(o.path(src), a.repo))
        if row in fx_rows:
            return True
        fx_rows.append(row)
        if src.lower().endswith('.spr'):
            take(skill, src[:-4] + '.act', eff, group)
        if src.lower().endswith('.str'):
            for t in str_textures(src, data):
                if not take(skill, t, eff, group):
                    o.missing.append(('fx', t, f'texture of {src}'))
        if src.lower().endswith('.act'):
            for s in Act(data).sounds:
                if s.lower().endswith('.wav'):
                    take(skill, WAV + s.replace('/', '\\').lstrip('\\'), eff, group)
        return True

    jobs = [(sk, grp) for grp, lst in SKILLS.items() for sk in lst.split()] + [(f'hit_{e}', 'hit') for e in HIT_EFFECTS]
    for sk, grp in jobs:
        ids = [int(sk[4:])] if grp == 'hit' else rb.skill_ids(sk)
        got = False
        for eid in ids:
            if eid not in rb.blocks:
                continue
            name, refs = rb.refs(eid)
            for key, v in refs:
                for c in candidates(key, v):
                    if g.has(c):
                        got |= take(sk, c, f'{eid} {name}', grp)
                        break
        for msk, why, files in MANUAL:
            if msk == sk:
                for f in files:
                    if take(sk, f, why, grp):
                        got = True
                    else:
                        o.missing.append(('fx', f, why))
        if not got:
            fx_rows.append(dict(skill=sk, group=grp, effect=' '.join(map(str, ids)) or 'no SkillEffect entry',
                                source='', output='nothing in GRF: code-drawn (FUNC/3D) or not found'))

    with open(os.path.join(o.raw, 'manifest.csv'), 'a', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['group', 'source', 'archive', 'size', 'sha256', 'output', 'note'])
        w.writerows(o.rows)
    with open(os.path.join(o.raw, 'fx_sources.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['skill', 'group', 'effect', 'source', 'output'])
        w.writeheader(); w.writerows(fx_rows)
    total = sum(r['size'] for r in o.rows)
    print(f'new files {len(o.rows)}, {total / 1e6:.1f} MB; missing {len(o.missing)}')
    for m in o.missing:
        print('  missing', *m)


if __name__ == '__main__':
    main()
