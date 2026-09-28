#!/usr/bin/env python3
"""Read-only RO skill FX inventory. Writes JSON/CSV ledgers, never captures artwork.

Source references are *candidates*, not captured or approved art. Runtime coverage
requires a manifest mapping AND a real PNG AND the correct requested event role.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RB = Path('/root/roBrowserLegacy')
COMPONENTS = ('cast', 'projectile', 'hit', 'area', 'buff', 'debuff')
SOURCE_FIELDS = {
    'beginCastEffectId': 'cast', 'effectIdOnCaster': 'cast',
    'releaseEffectId': 'projectile', 'beforeHitEffectId': 'projectile',
    'hitEffectId': 'hit', 'groundEffectId': 'area',
    'successEffectIdOnCaster': 'buff', 'successEffectId': 'debuff',
    'effectId': 'contextual',
}
# Only aliases for spelling/naming differences; an alias still requires an actual
# SkillEffect[SK.*] entry and a valid ID in the checked-out RO source.
ALIASES = {
    'Charge Arrow': 'AC_CHARGEARROW', 'Sand Attack': 'TF_SPRINKLESAND',
    'Venom Knife': 'AS_VENOMKNIFE', 'Signum Crucis': 'AL_CRUCIS',
    'Increase AGI': 'AL_INCAGI', 'Holy Light': 'AL_HOLYLIGHT',
    'Improve Concentration': 'AC_CONCENTRATION',
    'Cart Revolution': 'MC_CARTREVOLUTION', 'Double Strafe': 'AC_DOUBLE',
    'Falcon Assault': 'SN_FALCONASSAULT', 'Arrow Shower': 'AC_SHOWER',
    'Envenom': 'TF_POISON', 'Bash': 'SM_BASH',
    'Fire Bolt': 'MG_FIREBOLT', 'Fire Ball': 'MG_FIREBALL',
    'Cold Bolt': 'MG_COLDBOLT', 'Frost Diver': 'MG_FROSTDIVER',
    'Thunderstorm': 'MG_THUNDERSTORM', 'Magnum Break': 'SM_MAGNUM',
    'Heal': 'AL_HEAL', 'Blessing': 'AL_BLESSING',
}


def norm(value: str) -> str:
    return re.sub(r'[^a-z0-9]', '', value.lower())


def requested_components(kind: str, size: str, current: str = '') -> list[str]:
    """Use explicit format/event wording, not an atlas file as a proxy."""
    k = kind.lower()
    s = size.lower()
    c = current.lower()
    # The monster brief offers hit OR area as alternatives, not both at once.
    # Select the declared current animation; no source evidence is inferred.
    alternative = 'попадание' in s and ' или ' in s and 'площадь' in s
    if alternative:
        s = 'площадь' if 'общая площадь' in c or 'площадь' in k else 'попадание'
    roles = []
    if 'каст' in k:
        roles.append('cast')
    if 'снаряд' in s or 'снаряд' in k or 'колба' in k or 'колбы' in k:
        roles.append('projectile')
    if 'попадание' in s or 'попадани' in k or 'взрыв' in k and 'площадь' not in s:
        roles.append('hit')
    if 'площадь' in s or 'поле' in k or 'ловуш' in k:
        roles.append('area')
    if 'аура' in s or 'щит' in k or 'бафф' in k or 'лечение' in k and 'площадь' not in s:
        roles.append('debuff' if 'дебафф' in k or 'оглушени' in k else 'buff')
    if not roles:
        roles.append('hit')
    return [role for role in COMPONENTS if role in roles]


def brief_rows(path: Path) -> list[dict]:
    text = path.read_text(encoding='utf-8')
    priority = None
    rows = []
    for line in text.splitlines():
        section = re.match(r'^### (P[123])\b', line)
        if section:
            priority = section.group(1)
        if not priority or not line.startswith('|'):
            continue
        cols = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cols) != 6:
            continue
        match = re.search(r'`([a-z][a-z0-9_]*)`', cols[0])
        if not match:
            continue
        skill_id = match.group(1)
        rows.append(dict(priority=priority, skill_id=skill_id,
                         name=cols[0].split('`')[0].strip(), owner=cols[1],
                         ro_hint=cols[2], kind=cols[3], current=cols[4], format=cols[5],
                         required=requested_components(cols[3], cols[5], cols[4])))
    if len({r['skill_id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate skill IDs in brief')
    if not rows:
        raise ValueError('No skill rows in brief')
    return rows


def source_index(rb: Path) -> tuple[dict, set[str]]:
    src = (rb / 'src/DB/Skills/SkillEffect.js').read_text(encoding='utf-8')
    constants = (rb / 'src/DB/Effects/EffectConst.js').read_text(encoding='utf-8')
    table = (rb / 'src/DB/Effects/EffectTable.js').read_text(encoding='utf-8')
    ids = set(re.findall(r'\bEF_[A-Z0-9_]+\s*:\s*(-?\d+)', constants))
    entries = {}
    # Deliberately parse only declarative single-line literals. Dynamic callbacks,
    # spreads, aliases and conditional branches require manual review.
    pattern = r'SkillEffect\[SK\.([A-Z0-9_]+)\]\s*=\s*\{([^{}]*)\};\s*//\s*([^\r\n]*)'
    for match in re.finditer(pattern, src):
        skill, body, comment = match.groups()
        effects = []
        for field, numeric, named in re.findall(
            r'\b(' + '|'.join(SOURCE_FIELDS) + r')\s*:\s*(?:(\d+)|[\'\"]([^\'\"]+)[\'\"])', body):
            value = numeric or named
            # Numeric IDs must resolve in EffectConst. Named IDs must occur as
            # actual keys in EffectTable (not merely a comment or a hint).
            valid = value in ids if numeric else bool(re.search(
                r'(?:[\'\"]' + re.escape(value) + r'[\'\"]|\b' + re.escape(value) + r'\b)\s*:', table))
            if valid:
                effects.append(dict(id=value, field=field, role=SOURCE_FIELDS[field]))
        entries[skill] = dict(ro_skill=skill, label=comment.strip(), effects=effects)
    return entries, ids


def candidates(row: dict, index: dict) -> list[dict]:
    hint = row['ro_hint']
    if hint == '—' or row['owner'] == 'монстры':
        return []
    clean = re.sub(r'\s*\([^)]*\)', '', hint).split('/')[0].strip()
    alias = ALIASES.get(clean)
    if alias and alias in index:
        found = [index[alias]]
    else:
        found = [entry for entry in index.values()
                 if norm(entry['label']) == norm(clean)]
    if len(found) != 1:
        return []  # no guessing across ambiguous comment matches
    return [dict(ro_skill=found[0]['ro_skill'], **effect) for effect in found[0]['effects']]


def inventory(brief: Path, manifest: Path, rb: Path) -> dict:
    rows = brief_rows(brief)
    data = json.loads(manifest.read_text(encoding='utf-8'))
    effects = {effect['id']: effect for effect in data['effects']}
    mappings = data['skills']
    index, _ = source_index(rb)
    for row in rows:
        skill = row['skill_id']
        row['source_candidates'] = candidates(row, index)
        # A sheet is associated by explicit skill prefix or actual manifest mapping;
        # generic fx_hit/fx_heal is not skill-specific coverage.
        mapped = mappings.get(skill, {})
        sheet_ids = {id for id in effects if id == 'fx_' + skill or id.startswith('fx_' + skill + '_')}
        sheet_ids.update(mapped.values())
        row['atlases'] = sorted(id for id in sheet_ids if id in effects and
                                (ROOT / 'assets' / effects[id]['file']).is_file())
        row['runtime_mapping'] = mapped
        row['components'] = {}
        for role in row['required']:
            # Only hit and buff events are supported by the current effects.json
            # contract; a manifest hit mapping cannot stand in for area/projectile.
            event = role if role in ('hit', 'buff') else None
            fx_id = mapped.get(event) if event else None
            present = fx_id in row['atlases'] if fx_id else False
            possible = [c for c in row['source_candidates'] if c['role'] in (role, 'contextual')]
            # An unrelated sheet under the same skill prefix cannot close a gap.
            # 'contextual' effects are not proven to have this visual role; expose
            # them as candidates, never call them role-ready atlases.
            atlas_for_role = sorted(id for id in row['atlases'] if
                                    any(c['id'] == str(effects[id].get('source', {}).get('roEffectId'))
                                        and c['role'] == role for c in possible))
            row['components'][role] = {
                'status': 'runtime_mapped' if present else
                          'atlas_only' if atlas_for_role else
                          'candidate_only' if possible else 'missing',
                'runtime_effect': fx_id if present else None,
                'atlas_effects': atlas_for_role,
                'candidate_ro_ids': sorted({c['id'] for c in possible}),
            }
        count = sum(c['status'] == 'runtime_mapped' for c in row['components'].values())
        row['status'] = ('runtime_complete' if count == len(row['required']) else
                         'runtime_partial' if count else 'atlas_only' if row['atlases'] else
                         'candidate_only' if row['source_candidates'] else 'missing')
        row['gaps'] = [role for role, c in row['components'].items() if c['status'] != 'runtime_mapped']
    return {'inputs': {'brief': str(brief), 'manifest': str(manifest), 'ro_source': str(rb / 'src/DB/Skills/SkillEffect.js')},
            'summary': {'rows': len(rows), 'priorities': dict(Counter(r['priority'] for r in rows)),
                        'statuses': dict(Counter(r['status'] for r in rows)),
                        'missing_components': dict(Counter(c for r in rows for c in r['gaps']))},
            'rows': rows}


def write_ledger(ledger: dict, json_path: Path, csv_path: Path) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    columns = ['priority', 'skill_id', 'name', 'ro_hint', 'kind', 'required', 'status',
               'gaps', 'atlases', 'runtime_mapping', 'source_candidates', 'components']
    with csv_path.open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for row in ledger['rows']:
            writer.writerow({k: json.dumps(row[k], ensure_ascii=False, sort_keys=True) if isinstance(row[k], (list, dict)) else row[k]
                             for k in columns})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--brief', type=Path, default=ROOT / 'docs/ART_REQUEST_SKILLS.md')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'assets/effects/effects.json')
    parser.add_argument('--ro-browser', type=Path, default=RB)
    parser.add_argument('--json-out', type=Path, default=Path('/tmp/ro-effect-inventory.json'))
    parser.add_argument('--csv-out', type=Path, default=Path('/tmp/ro-effect-inventory.csv'))
    args = parser.parse_args()
    ledger = inventory(args.brief, args.manifest, args.ro_browser)
    write_ledger(ledger, args.json_out, args.csv_out)
    print(json.dumps(ledger['summary'], ensure_ascii=False, sort_keys=True))
    print(f'JSON: {args.json_out}\nCSV: {args.csv_out}')


if __name__ == '__main__':
    main()
