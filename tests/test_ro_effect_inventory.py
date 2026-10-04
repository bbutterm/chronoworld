"""Inventory regressions using live game files and synthetic RO parser fixtures.

The fixture declarations exercise parsing only: they are not checked upstream
RO source and do not prove captured artwork or approve its origin. Stdlib only.
"""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ro_effect_inventory', ROOT / 'tools/ro_effect_inventory.py')
assert spec is not None and spec.loader is not None
inv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inv)


def write_synthetic_ro_checkout(root: Path) -> Path:
    """Declare the miniature parser input; never depend on a private RO checkout."""
    sources = {
        'src/DB/Skills/SkillEffect.js': (
            'SkillEffect[SK.MG_FIREBOLT] = { beforeHitEffectId: "ef_firebolt", hitEffectId: 49, '
            'effectId: 99999, releaseEffectId: "not_in_table" }; //Fire Bolt\n'
            'SkillEffect[SK.MG_FIREBALL] = { beforeHitEffectId: 24, hitEffectId: 49 }; //Fire Ball\n'
            'SkillEffect[SK.AS_VENOMKNIFE] = { beforeHitEffectId: 600 }; //Synthetic knife fixture\n'
            'SkillEffect[SK.X] = { hitEffectId: 49 }; //Twin\n'
            'SkillEffect[SK.Y] = { hitEffectId: 49 }; //Twin\n'
        ),
        'src/DB/Effects/EffectConst.js': 'export default { EF_FIREHIT: 49, EF_FIREBALL: 24, EF_THROWITEM6: 600 };\n',
        'src/DB/Effects/EffectTable.js': 'export default { ef_firebolt: {} };\n',
    }
    for relative, text in sources.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
    return root


class InventoryTests(unittest.TestCase):
    def test_requested_roles_do_not_collapse_to_hit(self):
        self.assertEqual(inv.requested_components('каст + площадь', 'площадь 512×256'), ['cast', 'area'])
        self.assertEqual(inv.requested_components('снаряд + попадание', 'снаряд 128×64 + попадание 256×256'), ['projectile', 'hit'])
        self.assertEqual(inv.requested_components('дебафф', 'аура 256×320'), ['debuff'])
        self.assertEqual(inv.requested_components('размах', 'площадь 512×256 на цель или 768×384 на поле'), ['area'])
        self.assertEqual(inv.requested_components('ультa', 'попадание 256×256 или площадь 512×256', 'общая площадь cloud'), ['area'])

    def test_verified_source_only_and_ambiguous_or_monster_never_guessed(self):
        with tempfile.TemporaryDirectory() as temp:
            index, _ = inv.source_index(write_synthetic_ro_checkout(Path(temp)))
            row = {'ro_hint': 'Fire Bolt', 'owner': 'hero'}
            self.assertEqual([(c['id'], c['role']) for c in inv.candidates(row, index)],
                             [('ef_firebolt', 'projectile'), ('49', 'hit')])
            self.assertEqual(inv.candidates({'ro_hint': 'Twin', 'owner': 'hero'}, index), [])
            self.assertEqual(inv.candidates({'ro_hint': 'Fire Bolt', 'owner': 'монстры'}, index), [])
            self.assertEqual(inv.candidates({'ro_hint': 'Venom Knife', 'owner': 'hero'}, {}), [])

    def test_live_151_and_per_component_gaps(self):
        with tempfile.TemporaryDirectory() as temp:
            ledger = inv.inventory(ROOT / 'docs/ART_REQUEST_SKILLS.md',
                                   ROOT / 'assets/effects/effects.json',
                                   write_synthetic_ro_checkout(Path(temp)))
        self.assertEqual(ledger['summary']['rows'], 151)
        self.assertEqual(ledger['summary']['priorities'], {'P1': 26, 'P2': 55, 'P3': 70})
        rows = {r['skill_id']: r for r in ledger['rows']}
        fireball = rows['job_mage_fire_ball']
        self.assertEqual(fireball['status'], 'runtime_complete')
        self.assertEqual(fireball['components']['hit']['status'], 'runtime_mapped')
        self.assertEqual(fireball['components']['hit']['runtime_source'], 'shared_ro_capture')
        self.assertEqual(fireball['components']['projectile']['status'], 'runtime_mapped')
        self.assertEqual(fireball['components']['projectile']['runtime_effect'],
                         'fx_job_mage_fire_ball_projectile')
        self.assertEqual(fireball['gaps'], [])
        self.assertEqual(fireball['components']['projectile']['atlas_effects'],
                         ['fx_job_mage_fire_ball_projectile'])
        self.assertEqual(rows['job_crusader_grand_cross']['components']['area']['status'], 'runtime_mapped')
        # The current manifest has a hit cue, but its ground cue cannot satisfy
        # the brief's projectile requirement (effects README, skill map roles).
        self.assertEqual(rows['job_wizard_meteor_storm']['status'], 'runtime_partial')
        self.assertEqual(rows['job_wizard_meteor_storm']['required'], ['projectile', 'hit'])
        self.assertEqual(rows['job_wizard_meteor_storm']['gaps'], ['projectile'])
        self.assertEqual(rows['job_wizard_meteor_storm']['components']['hit']['status'], 'runtime_mapped')
        self.assertEqual(rows['job_knight_bowling_bash']['status'], 'atlas_only')
        self.assertEqual(rows['job_knight_bowling_bash']['required'], ['hit', 'area'])
        self.assertEqual(rows['job_swordman_magnum_break']['components']['cast']['status'], 'runtime_mapped')
        self.assertEqual(rows['job_thief_steal']['status'], 'runtime_complete')
        self.assertEqual(rows['job_thief_steal']['components']['hit']['runtime_effect'], 'fx_job_thief_steal')
        # The later "Only the skill's own RO effect" README policy and
        # effects-ro-origin.test.ts removed the monster's Sonic Blow substitute.
        self.assertEqual(rows['mob3_melee_rend']['status'], 'missing')
        self.assertEqual(rows['mob3_melee_rend']['runtime_mapping'], {})
        self.assertEqual(rows['mob3_melee_rend']['shared_effects'], {})
        self.assertIsNone(rows['mob3_melee_rend']['components']['hit']['runtime_source'])
        self.assertEqual(rows['job_merchant_frying_pan']['source_candidates'], [])
        self.assertEqual(rows['mob_boss1_quake']['source_candidates'], [])
        with tempfile.TemporaryDirectory() as temp:
            a, b = Path(temp) / 'ledger.json', Path(temp) / 'ledger.csv'
            inv.write_ledger(ledger, a, b)
            self.assertEqual(len(json.loads(a.read_text())['rows']), 151)
            self.assertEqual(len(b.read_text().splitlines()), 152)

    def test_projectile_requires_matching_runtime_event_and_existing_sheet(self):
        catalog = json.loads((ROOT / 'assets/effects/effects.json').read_text(encoding='utf-8'))
        effect = next(e for e in catalog['effects'] if e['id'] == 'fx_job_thief_venom_knife_projectile')
        # Reuse a real shipped PNG, not synthetic pixels or an alias as art proof.
        self.assertEqual((ROOT / 'assets' / effect['file']).read_bytes()[:8], b'\x89PNG\r\n\x1a\n')
        missing_file = 'effects/__missing_inventory_fixture__.png'
        self.assertFalse((ROOT / 'assets' / missing_file).exists())
        cases = (
            ('projectile event', {'projectile': effect['id']}, effect['file'], 'runtime_mapped', 'runtime_complete'),
            ('hit event', {'hit': effect['id']}, effect['file'], 'atlas_only', 'atlas_only'),
            ('missing sheet', {'projectile': effect['id']}, missing_file, 'candidate_only', 'candidate_only'),
            ('source alias only', {}, effect['file'], 'candidate_only', 'candidate_only'),
        )
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            rb = write_synthetic_ro_checkout(base / 'synthetic-ro-browser')
            brief = base / 'brief.md'
            brief.write_text('### P1\n'
                             '| Fixture `inventory_projectile_fixture` | synthetic hero | Venom Knife | '
                             'снаряд | fixture | снаряд 128×64 |\n', encoding='utf-8')
            manifest = base / 'effects.json'
            for name, mapping, file, component_status, row_status in cases:
                with self.subTest(name=name):
                    manifest.write_text(json.dumps({
                        'effects': [{**effect, 'file': file}],
                        'skills': {'inventory_projectile_fixture': mapping},
                    }), encoding='utf-8')
                    row = inv.inventory(brief, manifest, rb)['rows'][0]
                    component = row['components']['projectile']
                    self.assertEqual(row['required'], ['projectile'])
                    self.assertEqual(row['status'], row_status)
                    self.assertEqual(component['status'], component_status)
                    self.assertEqual(component['candidate_ro_ids'], ['600'])
                    covered = component_status == 'runtime_mapped'
                    self.assertEqual(component['runtime_effect'], effect['id'] if covered else None)
                    self.assertEqual(row['gaps'], [] if covered else ['projectile'])

    def test_cli_reports_missing_source_without_writing_ledgers(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            missing_checkout = base / 'missing-ro-browser'
            json_out, csv_out = base / 'ledger.json', base / 'ledger.csv'
            result = subprocess.run([
                sys.executable, str(ROOT / 'tools/ro_effect_inventory.py'),
                '--ro-browser', str(missing_checkout),
                '--json-out', str(json_out), '--csv-out', str(csv_out),
            ], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn('Cannot read RO Browser source', result.stderr)
            self.assertIn(str(missing_checkout / 'src/DB/Skills/SkillEffect.js'), result.stderr)
            self.assertIn('--ro-browser PATH', result.stderr)
            self.assertNotIn('Traceback', result.stderr)
            self.assertFalse(json_out.exists())
            self.assertFalse(csv_out.exists())


if __name__ == '__main__':
    unittest.main()
