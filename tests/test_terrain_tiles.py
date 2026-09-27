"""Validate original repeating terrain textures and their manifest entries."""
import json
import unittest
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
IDS=('tile_grass_01','tile_grass_02','tile_grass_dry','tile_dirt','tile_stone')

class TestTerrainTiles(unittest.TestCase):
    def test_registered_tiles_and_seams(self):
        manifest=json.loads((ROOT/'assets/manifest.json').read_text())['assets']
        self.assertTrue(set(IDS).issubset(manifest))
        for name in IDS:
            with self.subTest(name=name):
                m=manifest[name]
                self.assertEqual(m['kind'],'tile')
                p=ROOT/'assets'/m['file']
                with Image.open(p) as im:
                    self.assertEqual(im.mode,'RGBA')
                    self.assertEqual(im.size,(128,128))
                    arr=np.asarray(im,dtype=np.float32)
                self.assertTrue(np.all(arr[:,:,3]==255),f'{name} has transparent holes')
                a=arr[:,:,:3]
                seam_x=np.abs(a[:,0]-a[:,-1]).mean()
                seam_y=np.abs(a[0]-a[-1]).mean()
                interior_x=np.abs(a[:,1:]-a[:,:-1]).mean()
                interior_y=np.abs(a[1:]-a[:-1]).mean()
                self.assertLess(seam_x,interior_x*1.5)
                self.assertLess(seam_y,interior_y*1.5)

    def test_grass_variations_are_distinct(self):
        a=np.asarray(Image.open(ROOT/'assets/tiles/tile_grass_01.png').convert('RGB'),dtype=np.int16)
        b=np.asarray(Image.open(ROOT/'assets/tiles/tile_grass_02.png').convert('RGB'),dtype=np.int16)
        self.assertGreater(float(np.abs(a-b).mean()),5)

if __name__=='__main__':unittest.main()
