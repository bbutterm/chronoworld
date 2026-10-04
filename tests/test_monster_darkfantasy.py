"""Pixel-level checks for the approved 25-monster import; no source art tools required."""
import hashlib
import json
from pathlib import Path
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = json.loads((ROOT / 'tests/fixtures/monster-darkfantasy-ready25.json').read_text())

class MonsterDarkFantasyTests(unittest.TestCase):
    def test_frames_and_registry_bounds(self):
        registry = json.loads((ROOT / 'assets/sprites/sprites.json').read_text())
        for f in FIXTURES:
            with self.subTest(monster=f['id']):
                raw = (ROOT / 'assets' / f['file']).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), f['sheetSha256'])
                im = Image.open(ROOT / 'assets' / f['file']).convert('RGBA')
                cw, ch = f['cell']
                self.assertEqual(im.size, (cw * f['columns'], ch * len(f['frameBoxes'])))
                entry = next(s for s in registry['sprites'] if s['id'] == f['id'])
                occupied = 0
                for name, boxes in f['frameBoxes'].items():
                    row = f['anims'][name]['row']
                    for col in range(f['columns']):
                        box = im.crop((col*cw, row*ch, (col+1)*cw, (row+1)*ch)).getchannel('A').getbbox()
                        if col < len(boxes):
                            self.assertEqual(list(box), boxes[col]); occupied += 1
                        else:
                            self.assertIsNone(box)
                    union = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
                    self.assertEqual(entry['bbox'][name], union)
                self.assertEqual(occupied, 24)

    def test_lossless_webp_and_index(self):
        index = json.loads((ROOT / 'assets-webp/index.json').read_text())
        for f in FIXTURES:
            with self.subTest(monster=f['id']):
                source = ROOT / 'assets' / f['file']
                output = ROOT / 'assets-webp' / Path(f['file']).with_suffix('.webp')
                png, webp = Image.open(source).convert('RGBA'), Image.open(output).convert('RGBA')
                self.assertEqual(png.size, webp.size)
                self.assertEqual(png.tobytes(), webp.tobytes())
                self.assertEqual(index[f['file']], {'sha1': hashlib.sha1(source.read_bytes()).hexdigest(), 'png': source.stat().st_size, 'webp': output.stat().st_size})

if __name__ == '__main__':
    unittest.main()
