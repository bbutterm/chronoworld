#!/usr/bin/env python3
"""Extract chapter-1 RO skill icons from roBrowser Remote Client, without GRF in Git.

Source: docs/ART_EXTRACT_RO.md; source URLs use cp949 GRF path bytes
represented as Latin-1 text as required by grf.robrowser.com. The service
returns PNG even for .bmp paths. Pixel art is resized only by integer nearest.
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
    'nv_firstaid', 'sm_bash', 'sm_endure', 'sm_magnum', 'sm_recovery',
    'sm_provoke', 'tf_poison', 'tf_miss', 'tf_steal', 'tf_double',
    'tf_sprinklesand', 'ac_double', 'ac_owl', 'ac_shower', 'ac_vulture',
    'ac_chargearrow', 'mg_firebolt', 'mg_srecovery', 'mg_frostdiver',
    'mg_energycoat', 'mg_thunderstorm', 'al_heal', 'al_dp',
    'al_blessing', 'al_holylight', 'al_incagi', 'pr_sanctuary',
    'mc_mammonite', 'mc_pushcart', 'mc_cartrevolution', 'mc_loud',
    'mc_overcharge',
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
            # x5 exact nearest pixel replication; no intermediate anti-alias.
            scaled = src.resize((120, 120), Image.Resampling.NEAREST)
            canvas = Image.new('RGBA', (128, 128))
            canvas.paste(scaled, (4, 4))  # preserve RGBA, including translucent source pixels
            path = OUT / f'skill_{skill}.png'
            path.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(path, optimize=True)
            with Image.open(path) as check:
                check.load()
                if check.size != (128, 128) or check.convert('RGBA').crop((4, 4, 124, 124)).tobytes() != scaled.tobytes():
                    raise ValueError(f'written PNG mismatch: {path}')
            return {'id': skill, 'file': str(path.relative_to(ROOT)),
                    'source': url, 'source_sha256': hashlib.sha256(raw).hexdigest(),
                    'source_pixels': [24, 24], 'scale': 5, 'padding': [4, 4]}
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
    with ThreadPoolExecutor(max_workers=3) as pool:
        for skill, task in zip(selected, [pool.submit(extract, s) for s in selected]):
            try:
                entries.append(task.result())
                print('OK', skill, flush=True)
            except RuntimeError as exc:
                print('ERROR', str(exc), flush=True)
                failures.append(str(exc))
    if not a.only:
        (OUT / 'ro-skills.json').write_text(json.dumps({
            'schema': 1, 'purpose': 'chapter-1 RO skill icons; source PNG pixels x5 nearest',
            'icons': entries, 'missing': failures,
        }, ensure_ascii=False, indent=2) + '\n')
    print('DONE', len(entries), 'icons;', len(failures), 'missing')
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
