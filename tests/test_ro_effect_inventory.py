"""Audited RO inventory regression tests (stdlib only)."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ro_effect_inventory', ROOT / 'tools/ro_effect_inventory.py')
assert spec is not None and spec.loader is not None
inv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inv)


class InventoryTests(unittest.TestCase):
    def test_requested_roles_do_not_collapse_to_hit(self):
        self.assertEqual(inv.requested_components('каст + площадь', 'площадь 512×256'), ['cast', 'area'])
        self.assertEqual(inv.requested_components('снаряд + попадание', 'снаряд 128×64 + попадание 256×256'), ['projectile', 'hit'])
        self.assertEqual(inv.requested_components('дебафф', 'аура 256×320'), ['debuff'])
        self.assertEqual(inv.requested_components('размах', 'площадь 512×256 на цель или 768×384 на поле'), ['area'])
        self.assertEqual(inv.requested_components('ультa', 'попадание 256×256 или площадь 512×256', 'общая площадь cloud'), ['area'])

    def test_verified_source_only_and_ambiguous_or_monster_never_guessed(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp) / 'src/DB'
            (base / 'Skills').mkdir(parents=True)
            (base / 'Effects').mkdir(parents=True)
            (base / 'Skills/SkillEffect.js').write_text(
                'SkillEffect[SK.MG_FIREBOLT] = { beforeHitEffectId: "ef_firebolt", hitEffectId: 49, effectId: 99999 }; //Fire Bolt\n'
                'SkillEffect[SK.X] = { hitEffectId: 49 }; //Twin\n'
                'SkillEffect[SK.Y] = { hitEffectId: 49 }; //Twin\n')
            (base / 'Effects/EffectConst.js').write_text('export default { EF_FIREHIT: 49 };')
            (base / 'Effects/EffectTable.js').write_text('export default { ef_firebolt: {} };')
            index, _ = inv.source_index(Path(temp))
            row = {'ro_hint': 'Fire Bolt', 'owner': 'hero'}
            self.assertEqual([(c['id'], c['role']) for c in inv.candidates(row, index)],
                             [('ef_firebolt', 'projectile'), ('49', 'hit')])
            self.assertEqual(inv.candidates({'ro_hint': 'Twin', 'owner': 'hero'}, index), [])
            self.assertEqual(inv.candidates({'ro_hint': 'Fire Bolt', 'owner': 'монстры'}, index), [])

    def test_live_151_and_per_component_gaps(self):
        ledger = inv.inventory(ROOT / 'docs/ART_REQUEST_SKILLS.md',
                               ROOT / 'assets/effects/effects.json', inv.RB)
        self.assertEqual(ledger['summary']['priorities'], {'P1': 26, 'P2': 55, 'P3': 70})
        rows = {r['skill_id']: r for r in ledger['rows']}
        fireball = rows['job_mage_fire_ball']
        self.assertEqual(fireball['status'], 'runtime_partial')
        self.assertEqual(fireball['components']['hit']['status'], 'runtime_mapped')
        self.assertIn('projectile', fireball['gaps'])
        self.assertEqual(fireball['components']['projectile']['atlas_effects'],
                         ['fx_job_mage_fire_ball_projectile'])
        self.assertEqual(rows['job_crusader_grand_cross']['components']['area']['status'], 'candidate_only')
        self.assertEqual(rows['job_merchant_frying_pan']['source_candidates'], [])
        self.assertEqual(rows['mob_boss1_quake']['source_candidates'], [])
        with tempfile.TemporaryDirectory() as temp:
            a, b = Path(temp) / 'ledger.json', Path(temp) / 'ledger.csv'
            inv.write_ledger(ledger, a, b)
            self.assertEqual(len(json.loads(a.read_text())['rows']), 151)
            self.assertEqual(len(b.read_text().splitlines()), 152)


if __name__ == '__main__':
    unittest.main()
