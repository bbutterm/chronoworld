import json
from pathlib import Path
import unittest
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
UI=ROOT/'assets'/'ui'

class TestUiAssets(unittest.TestCase):
    def test_manifest_matches_rgba_files(self):
        m=json.loads((UI/'manifest.json').read_text())
        self.assertEqual(m['license'].split(',')[0],'CC0')
        self.assertEqual(len(m['assets']),15)
        self.assertTrue({Path(path).name for path in m['assets']}.issubset({p.name for p in UI.glob('*.png')}))
        self.assertEqual(len(set(m['assets'])),15)
        for path in m['assets']:
            with self.subTest(path):
                f=ROOT/path
                with Image.open(f) as im:
                    im.verify()
                with Image.open(f) as im:
                    self.assertEqual(im.mode,'RGBA')
                    self.assertIsNotNone(im.getbbox())
                    if f.name.startswith('ui_result_'):self.assertEqual(im.size,(900,400))
                    if f.name.startswith('ui_slot_'):self.assertEqual(im.size,(200,200))
                    if f.name in m['nine_slice']:
                        sl=m['nine_slice'][f.name]
                        self.assertLess(sl['left']+sl['right'],im.width)
                        self.assertLessEqual(sl['top']+sl['bottom'],im.height)
        self.assertIn('License (CC0)',(UI/'KENNEY_LICENSE.txt').read_text())

if __name__=='__main__':unittest.main()
