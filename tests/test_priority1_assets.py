import json
import unittest
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
BACKGROUNDS = ('bg_arena',)
PRIORITY1 = BACKGROUNDS + tuple(f'fx_{n}' for n in ('hit','arrow','magic','heal','shield','death')) + (
    'ui_chest_empty','ui_chest_filling','ui_chest_full',
    'ui_nav_campaign','ui_nav_campaign_active','ui_nav_heroes','ui_nav_heroes_active','ui_nav_home','ui_nav_home_active',
    'ui_icon_gold','ui_icon_gem')

class TestPriority1Assets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT / 'assets/manifest.json').read_text())

    def test_inventory_dimensions_alpha(self):
        # The manifest is the loader format {file, w, h, color, label, ...} (no 'kind'); the priority-one set is
        # listed here. bg_arena became a JPEG (Vercel prep, 1ded6d0) -- opaque background, size check only.
        entries = self.manifest['assets']
        self.assertTrue(set(PRIORITY1).issubset(entries), set(PRIORITY1) - set(entries))
        for asset_id in PRIORITY1:
            item = entries[asset_id]
            with self.subTest(asset_id=asset_id):
                p = ROOT / 'assets' / item['file']
                self.assertTrue(p.is_file(), p)
                with Image.open(p) as image:
                    self.assertEqual(image.size, (item['w'], item['h']))
                    if asset_id in BACKGROUNDS:
                        continue
                    self.assertEqual(image.mode, 'RGBA')
                    alpha = image.getchannel('A')
                    self.assertIsNotNone(alpha.getbbox())
                    self.assertEqual([alpha.getpixel(xy) for xy in ((0,0), (image.width-1,0), (0,image.height-1), (image.width-1,image.height-1))], [0]*4)
                    # Content stays inside canvas; centered effect and icon must not touch any edge.
                    box = alpha.getbbox()
                    assert box is not None
                    self.assertGreater(box[0], 0)
                    self.assertGreater(box[1], 0)
                    self.assertLess(box[2], image.width)
                    self.assertLess(box[3], image.height)

    def test_distinct_ui_states(self):
        for group in [('ui_chest_empty','ui_chest_filling','ui_chest_full'),
                      ('ui_nav_campaign','ui_nav_campaign_active'),
                      ('ui_nav_heroes','ui_nav_heroes_active'),
                      ('ui_nav_home','ui_nav_home_active')]:
            images = [Image.open(ROOT/'assets'/self.manifest['assets'][key]['file']).convert('RGBA') for key in group]
            for left,right in zip(images,images[1:]):
                self.assertIsNotNone(ImageChops.difference(left,right).getbbox(),group)

if __name__ == '__main__':
    unittest.main()
