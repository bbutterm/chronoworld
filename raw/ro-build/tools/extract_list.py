"""Byte-exact extraction of the owner's RO_EXTRACT_LIST into staging/ro-extract/raw/ro.

Only whitelisted paths are written; output paths are built from fixed folders plus the
client's own file name, then checked to stay inside OUT. The client is never modified.
"""
import csv, hashlib, os, shutil, sys
from grf import GRF, CLIENT
from ro_spr_act import Act

ROOT = '/root/ro-client-extraction-2/staging/ro-extract'
OUT = os.path.join(ROOT, 'raw', 'ro')
MON = 'data\\sprite\\몬스터\\'
NPC = 'data\\sprite\\npc\\'
EFX = 'data\\sprite\\이팩트\\'
UI = 'data\\texture\\유저인터페이스\\'
WAV = 'data\\wav\\'
WEF = 'data\\wav\\effect\\'

MOBS_REQUIRED = ['marin', 'pupa', 'thief_bug_male', 'thief_bug_female', 'thief_bug_larva', 'thief_bug',
    'thief_bug_egg', 'plankton', 'tarou', 'farmiliar', 'orc_lord', 'ork_warrior', 'high_orc', 'orc_archer',
    'orc_lady', 'orc_skeleton', 'orc_zombie', 'steel_chocho', 'ancient_mummy', 'c_tower_manager', 'owl_baron',
    'owl_duke', 'alarm', 'clock', 'rideword', 'punk', 'elder', 'knight_of_abyss', 'evil_druid', 'ghoul',
    'baphomet_', 'ghostring', 'vagabond_wolf', 'eclipse', 'vocal', 'hunter_fly', 'side_winder', 'mantis',
    'stem_worm', 'killer_mantis', 'deviruchi', 'lord_of_death', 'bloody_knight', 'elder_wilow']
MOBS_OPTIONAL = ['pharaoh', 'penomena', 'khalitzburg', 'raydric_archer', 'wraith', 'whisper', 'skel_prisoner',
    'zombie_prisoner', 'sasquatch', 'leib_olmai', 'disguise', 'lude', 'hylozoist', 'toad', 'thara_frog', 'roda_frog']
NPCS = ['4_f_kafra1', '1_m_librarymaster', '2_m_sage_old', '8w_soldier', '4_m_cru_sold', '1_m_innkeeper',
    '1_m_merchant', '4_orclady', '4_m_darkpriest']
DAMAGE = ['숫자.spr', '숫자.act', '숫자_larger.act', 'msg.spr', 'msg.act', 'bluemsg.spr']
# (our item id, RO item_db id, resname expected by the list); 22145 has another item in scRO -> Fricco's Shoes
ITEMS = [('knife', 1201), ('dagger', 1213), ('sword', 1101), ('bow', 1701), ('rod', 1601), ('axe', 1301),
    ('gladius', 1219), ('composite_bow', 1704), ('staff', 1607), ('mace', 1504), ('knuckle', 1801),
    ('violin', 1901), ('claymore', 1163), ('arbalest', 1713), ('katar', 1252), ('wizardry_staff', 1473),
    ('battle_axe', 1351), ('sograt_scimitar', 1113), ('moonlight_dagger', 1234), ('pirate_saber', 1126),
    ('bloody_axe', 1363), ('keeper_hammer', 1354), ('abyss_blade', 1164),
    ('cotton_shirt', 2301), ('adventurers_suit', 2305), ('chain_mail', 2314), ('silk_robe', 2321),
    ('full_plate', 2316), ('saint_robe', 2325), ('isis_mantle', 2307), ('ninja_suit', 2337),
    ('captain_coat', 2309), ('dark_lord_robe', 2343), ('clockwork_mail', 2319), ('valkyrie_armor', 2357),
    ('bandana', 2211), ('cap', 2226), ('helm', 2228), ('biretta', 2216), ('crown', 2235),
    ('pharaoh_headdress', 5053), ('kitsune_mask', 5069), ('pirate_bandana', 2287), ('helm_of_darkness', 5017),
    ('alarm_mask', 5086), ('gjoll_helm', 2230),
    ('sandals', 2401), ('shoes', 2403), ('boots', 2405), ('greaves', 2411), ('sleipnir', 2410),
    ('desert_sandals', 2422), ('geta', 2417), ('sea_boots', 2424), ('valkyrie_boots', 2421),
    ('owl_boots', 2479), ('sentry_greaves', 2425),
    ('gold', 670), ('gems', 730), ('scrolls', 618), ('hero_exp', 12208), ('blessed_ore', 7620),
    ('treasure_chest', 7444), ('old_blue_box', 603), ('hero_card', 616), ('jellopy', 909), ('red_potion', 501)]
WAVS = ['_hit_sword', '_hit_dagger', '_hit_mace', '_hit_axe', '_hit_arrow', '_hit_fist1', '_hit_fist2',
    '_hit_fist3', '_hit_fist4', '_enemy_hit_normal1', '_hit_rod', '_hit_spear', 'attack_sword',
    'attack_short_sword', 'attack_twohand_sword', 'attack_axe', 'attack_mace', 'attack_rod', 'attack_katar',
    'attack_fist', 'attack_bow1', 'attack_bow2', '_heal_effect', 'levelup', '버튼소리', '_blind']
EFFECT_WAVS = ['ef_hit2', 'ef_hit3', 'ef_hit5', 'ef_hit6', 'ef_beginspell', 'ef_firehit', 'ef_fireball',
    'ef_firewall', 'ef_frostdiver', 'ef_frostdiver2', 'wizard_stormgust', 'magician_thunderstorm',
    'ef_thunderstorm', 'hunter_shockwavetrap', 'wizard_earthspike', 'earth_quake', 'black_hammerfall',
    'priest_magnus', 'cru_holy cross', 'cru_grand cross', 'ef_soulstrike', 'ef_napalmbeat', 'ef_poisonattack',
    'thief_invenom', 'assasin_enchantpoison', 'assasin_poisonreact', 'assasin_venomsplasher', 'wizard_fire_ivy',
    'wizard_meteor', 'ef_magnumbreak', 'ef_bash', 'ef_blessing', 'ef_incagility', 'ef_angelus',
    'ef_decagility', 'priest_lexaeterna', 'priest_kyrie_eleison_a', 'kyrie_guard', 'swordman_provoke',
    'ef_endure', 'knight_twohandquicken', 'knight_autocounter', 'knight_brandish_spear', 'ef_steal',
    'assasin_sonicblow', 'assasin_cloaking', 'rog_back stap', 'rog_steal coin', 'rog_intimidate',
    'ac_concentration', 'hunter_blitzbeat', 'hun_anklesnare', 'hunter_claymoretrap', 'hunter_sandman',
    'hunter_freezingtrap', 'acolyte_cure', 'ef_signum', 'priest_sanctuary', 'priest_magnificat',
    'priest_gloria', 'priest_impositio', 'priest_resurrection', 'priest_recovery', 'priest_suffragium',
    'priest_aspersio', 'ef_coin2', 'black_adrenalinerush_a', 'black_overthrust', 'black_weapon_perfection',
    'black_maximize_power_sword_bic', 'p_success', 'p_failed', 'sage_magic rod', 'sage_spell breake', 'st_mvp',
    'bs_refinesuccess', 'bs_refinefailed', 'drop_blue', 'drop_purple', 'drop_yellow', 'drop_red', 'drop_green',
    'drop_pink', 'ef_portal', 'ef_teleportation', 'ef_readyportal',
    'ef_firearrow', 'ef_firearrow1', 'ef_firearrow2', 'ef_firearrow3',
    'ef_icearrow', 'ef_icearrow1', 'ef_icearrow2', 'ef_icearrow3']
BGM_REQUIRED = ['01', '05', '06', '08', '11', '12', '14', '15', '16', '17', '19', '20', '21', '22', '26', '35',
    '39', '40', '42', '48', '60', '84', '85']
BGM_OPTIONAL = ['02', '03', '18', '24', '36', '37', '38', '43', '44', '47', '52', '61']


def safe_join(folder, name):
    if not name or name in ('.', '..') or any(c in name for c in '/\\\0') or ':' in name:
        raise ValueError(f'unsafe file name {name!r}')
    path = os.path.realpath(os.path.join(OUT, folder, name))
    if not path.startswith(os.path.realpath(OUT) + os.sep):
        raise ValueError(f'path escapes output: {path}')
    return path


class Extractor:
    def __init__(self):
        self.g = GRF()
        self.rows = []
        self.missing = []

    def write(self, data, folder, name, source, grf, group, note=''):
        path = safe_join(folder, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.path.islink(path):
            raise ValueError(f'refusing to overwrite symlink {path}')
        with open(path, 'wb') as f:
            f.write(data)
        self.rows.append(dict(group=group, source=source, archive=grf, size=len(data),
                              sha256=hashlib.sha256(data).hexdigest(),
                              output=os.path.relpath(path, ROOT), note=note))

    def grf(self, src, folder, group, note='', required=True):
        if not self.g.has(src):
            if required:
                self.missing.append((group, src))
            return None
        data = self.g.read(src)
        grf, _ = self.g.locate(src)
        self.write(data, folder, src.split('\\')[-1], src, grf, group, note)
        return data

    def loose(self, rel, folder, group):
        path = os.path.join(CLIENT, rel)
        if not os.path.isfile(path) or os.path.islink(path):
            self.missing.append((group, rel)); return
        with open(path, 'rb') as f:
            data = f.read()
        self.write(data, folder, os.path.basename(rel), rel, 'loose', group)


def item_resnames(g):
    table = {}
    for line in g.read('data\\idnum2itemresnametable.txt').decode('cp949', 'replace').splitlines():
        parts = line.split('#')
        if len(parts) >= 2 and parts[0].strip().isdigit():
            table[int(parts[0])] = parts[1]
    return table


def main():
    if os.path.exists(ROOT) and '--force' not in sys.argv:
        sys.exit(f'{ROOT} exists; pass --force to rebuild raw/ro')
    shutil.rmtree(OUT, ignore_errors=True)
    x = Extractor()
    mob_sounds = set()
    for group, names in (('monster', MOBS_REQUIRED), ('monster_optional', MOBS_OPTIONAL)):
        for n in names:
            x.grf(MON + n + '.spr', 'sprite/monster', group)
            act = x.grf(MON + n + '.act', 'sprite/monster', group)
            if act:
                mob_sounds.update(s for s in Act(act).sounds if s.lower().endswith('.wav'))
    for n in NPCS:
        x.grf(NPC + n + '.spr', 'sprite/npc', 'npc')
        x.grf(NPC + n + '.act', 'sprite/npc', 'npc')
    x.grf(UI + 'illust\\kafra_01.bmp', 'texture/illust', 'npc')
    for n in DAMAGE:
        x.grf(EFX + n, 'sprite/effect', 'damage')
    resnames = item_resnames(x.g)
    for our_id, item_id in ITEMS:
        res = resnames.get(item_id)
        if res is None:
            x.missing.append(('item', f'{our_id} {item_id}: no resname')); continue
        note = f'{our_id} item_db {item_id}'
        x.grf(UI + 'item\\' + res + '.bmp', 'texture/item', 'item', note)
        x.grf(UI + 'collection\\' + res + '.bmp', 'texture/collection', 'item', note)
    for w in WAVS:
        x.grf(WAV + w + '.wav', 'wav', 'sound')
    for w in EFFECT_WAVS:
        if x.g.has(WEF + w + '.wav'):
            x.grf(WEF + w + '.wav', 'wav/effect', 'sound')
        else:
            x.grf(WAV + w + '.wav', 'wav', 'sound', 'listed under effect\\, client has it in wav\\')
    for s in sorted(mob_sounds):
        rel = s.replace('/', '\\').lstrip('\\')
        folder = 'wav/' + '/'.join(rel.split('\\')[:-1]) if '\\' in rel else 'wav'
        if not x.g.has(WAV + rel) or (WAV + rel).lower() in {r['source'].lower() for r in x.rows}:
            if not x.g.has(WAV + rel):
                x.missing.append(('monster_sound', WAV + rel))
            continue
        x.grf(WAV + rel, folder.rstrip('/'), 'monster_sound')
    x.grf('data\\mp3nametable.txt', '.', 'bgm')
    for n in BGM_REQUIRED:
        x.loose(f'BGM/{n}.mp3', 'bgm', 'bgm')
    for n in BGM_OPTIONAL:
        x.loose(f'BGM/{n}.mp3', 'bgm', 'bgm_optional')
    with open(os.path.join(ROOT, 'raw', 'manifest.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['group', 'source', 'archive', 'size', 'sha256', 'output', 'note'])
        w.writeheader(); w.writerows(x.rows)
    with open(os.path.join(ROOT, 'raw', 'missing.txt'), 'w', encoding='utf-8') as f:
        f.writelines(f'{g}\t{p}\n' for g, p in x.missing)
    total = sum(r['size'] for r in x.rows)
    print(f'extracted {len(x.rows)} files, {total / 1e6:.1f} MB; missing {len(x.missing)}')
    for g, p in x.missing:
        print('  missing', g, p)


if __name__ == '__main__':
    main()
