#!/usr/bin/env python3
"""Extract RO skill icons (first and second jobs) from roBrowser Remote Client, without GRF in Git.

Source: docs/ART_EXTRACT_RO.md; source URLs use cp949 GRF path bytes
represented as Latin-1 text as required by grf.robrowser.com. The service
returns PNG even for .bmp paths. Icons are stored at native 24x24 (pixel art;
the game scales them with nearest-neighbour into its frame, src/game/skillIcons.ts).
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import time
from urllib.parse import quote

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/ui/icons'
SKILLS = (
    # Новичок и первые профессии
    'nv_firstaid', 'sm_bash', 'sm_endure', 'sm_magnum', 'sm_recovery',
    'sm_provoke', 'sm_twohand', 'sm_autoberserk', 'tf_poison', 'tf_miss', 'tf_steal', 'tf_double',
    'tf_sprinklesand', 'ac_double', 'ac_owl', 'ac_shower', 'ac_vulture',
    'ac_chargearrow', 'ac_concentration', 'mg_firebolt', 'mg_srecovery', 'mg_frostdiver',
    'mg_energycoat', 'mg_thunderstorm', 'mg_coldbolt', 'mg_fireball', 'mg_safetywall',
    'al_heal', 'al_dp', 'al_blessing', 'al_holylight', 'al_incagi', 'al_angelus', 'al_crucis',
    'mc_mammonite', 'mc_pushcart', 'mc_cartrevolution', 'mc_loud', 'mc_overcharge',
    # Рыцарь, Крестоносец
    'kn_bowlingbash', 'kn_autocounter', 'lk_parrying', 'kn_chargeatk', 'kn_twohandquicken', 'lk_spiralpierce',
    'cr_devotion', 'cr_trust', 'cr_autoguard', 'cr_defender', 'cr_holycross', 'cr_shieldcharge', 'cr_grandcross',
    # Охотник, Бард, Танцовщица
    'ht_blitzbeat', 'ht_beastbane', 'ht_steelcrow', 'sn_falconassault', 'ht_anklesnare', 'ht_claymoretrap', 'ht_sandman',
    'ba_musicalstrike', 'ba_poembragi', 'ba_appleidun', 'ba_assassincross', 'ba_whistle', 'ba_frostjoke',
    'dc_scream', 'dc_throwarrow', 'dc_dontforgetme', 'dc_fortunekiss',
    # Ассасин, Разбойник
    'as_sonicblow', 'as_katar', 'asc_meteorassault', 'as_grimtooth', 'as_enchantpoison', 'as_splasher', 'as_venomknife',
    'rg_raid', 'rg_plagiarism', 'rg_stripweapon', 'rg_striparmor', 'rg_backstap', 'rg_snatcher',
    # Кузнец, Алхимик
    'bs_overthrust', 'bs_hammerfall', 'ws_carttermination', 'bs_iron', 'bs_adrenaline', 'bs_weaponperfect',
    'am_potionpitcher', 'am_cp_armor', 'cr_slimpitcher', 'am_acidterror', 'am_demonstration', 'cr_aciddemonstration',
    # Волшебник, Мудрец
    'wz_jupitel', 'hw_magicpower', 'hw_souldrain', 'wz_meteor', 'wz_frostnova', 'wz_quagmire', 'wz_stormgust',
    'wz_earthspike', 'sa_freecast', 'wz_heavendrive', 'sa_dispell', 'sa_magicrod', 'sa_volcano',
    # Жрец, Монах
    'pr_impositio', 'pr_magnificat', 'pr_magnus', 'pr_lexaeterna', 'pr_kyrie', 'hp_assumptio',
    'mo_tripleattack', 'mo_callspirits', 'mo_investigate', 'mo_extremityfist', 'mo_bladestop', 'mo_ironhand', 'mo_steelbody',
)
GRF_FOLDER = '유저인터페이스'.encode('cp949').decode('latin1')
BASE = 'https://grf.robrowser.com/data/texture/' + quote(GRF_FOLDER, safe='') + '/item/'


def extract(skill: str) -> dict:
    url = BASE + skill + '.bmp'
    for attempt in range(3):
        try:
            response = requests.get(url, timeout=25)
            response.raise_for_status()
            raw = response.content
            if not raw.startswith(b'\x89PNG\r\n\x1a\n') or len(raw) > 100_000:
                raise ValueError(f'non-PNG/oversized source: {len(raw)} bytes')
            src = Image.open(io.BytesIO(raw)).convert('RGBA')
            if src.size != (24, 24) or not src.getbbox():
                raise ValueError(f'unexpected source image {src.size} / empty={not src.getbbox()}')
            # Native 24x24 RGBA (x1): 120 icons at x5 would cost ~8 MB of texture memory for nothing.
            path = OUT / f'skill_{skill}.png'
            path.parent.mkdir(parents=True, exist_ok=True)
            src.save(path, optimize=True)
            with Image.open(path) as check:
                check.load()
                if check.size != (24, 24) or check.convert('RGBA').tobytes() != src.tobytes():
                    raise ValueError(f'written PNG mismatch: {path}')
            return {'id': skill, 'file': str(path.relative_to(ROOT)),
                    'source': url, 'source_sha256': hashlib.sha256(raw).hexdigest(),
                    'source_pixels': [24, 24], 'scale': 1, 'padding': [0, 0]}
        except (requests.RequestException, ValueError, OSError) as exc:
            if attempt == 2:
                raise RuntimeError(f'{skill}: {exc}') from exc
            time.sleep(1 + attempt)
    raise AssertionError('unreachable')


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument('--only', choices=SKILLS)
    a = p.parse_args()
    selected = (a.only,) if a.only else SKILLS
    entries = []
    failures = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for skill, task in zip(selected, [pool.submit(extract, s) for s in selected]):
            try:
                entries.append(task.result())
                print('OK', skill, flush=True)
            except RuntimeError as exc:
                print('ERROR', str(exc), flush=True)
                failures.append(str(exc))
    if not a.only:
        (OUT / 'ro-skills.json').write_text(json.dumps({
            'schema': 1, 'purpose': 'RO skill icons of first and second jobs; native 24x24 source pixels',
            'icons': entries, 'missing': failures,
        }, ensure_ascii=False, indent=2) + '\n')
    print('DONE', len(entries), 'icons;', len(failures), 'missing')
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
