"""First-job visual IDs must not silently alias advanced-job sprites."""
import json
import unittest
from pathlib import Path
from PIL import Image, ImageChops

ROOT=Path(__file__).resolve().parents[1]

class TestFirstJobsV2(unittest.TestCase):
    def test_six_distinct_first_jobs(self):
        entries={s['id']:s for s in json.loads((ROOT/'assets/sprites/sprites.json').read_text())['sprites']}
        expected={'swordman':1,'magician':2,'archer_first':3,'acolyte':4,'merchant':5,'thief':6}
        for name,job in expected.items():
            with self.subTest(name=name):
                e=entries[name]
                self.assertEqual((e['class'],e['source']['jobId']),('hero',job))
                self.assertEqual(e['sourceActions']['attack'],86)
                self.assertEqual(e['sourceActions']['walk'],14)
                self.assertTrue((ROOT/'assets'/e['file']).is_file())
                self.assertTrue((ROOT/'assets'/e['portrait']).is_file())
                self.assertIn('walk',e['sourceLimitations'])
                with Image.open(ROOT/'assets'/e['file']) as source:
                    im=source.convert('RGBA')
                    self.assertEqual(im.size,(1792,1152))
                    idle=im.crop((0,0,224,192))
                    attack=im.crop((224*3,192*2,224*4,192*3))
                    self.assertIsNotNone(ImageChops.difference(idle.convert('RGB'),attack.convert('RGB')).getbbox())
        # Hunter keeps historical archer ID; the first-job Archer has its own ID.
        self.assertEqual(entries['archer']['source']['jobId'],11)
        self.assertEqual(entries['archer_first']['source']['jobId'],3)

if __name__=='__main__':unittest.main()
