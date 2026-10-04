import unittest, importlib.util
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('veteran_fx',ROOT/'tools/build_veteran_fx.py')
assert spec is not None and spec.loader is not None
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class VeteranFxTests(unittest.TestCase):
 def test_thirteen_distinct_original_temporal_families(self):
  self.assertEqual(len(module.COLORS),13)
  silhouettes=[]
  for job in module.COLORS:
   frames=[module.frame(job,i) for i in range(module.N)]
   self.assertEqual(len({im.tobytes() for im in frames}),24,job)
   for frame in frames:
    self.assertEqual(frame.mode,'RGBA');self.assertEqual(frame.size,(128,128))
    self.assertIsNotNone(frame.getbbox(),job)
    # Transparent margin, not the opaque square often produced by generative FX.
    self.assertEqual(frame.getpixel((0,0))[3],0,job)
    self.assertEqual(frame.getpixel((127,127))[3],0,job)
   silhouettes.append(frames[10].tobytes())
  self.assertEqual(len(set(silhouettes)),13)
 def test_atlas_has_exact_cell_grid(self):
  for job in module.COLORS:
   path=ROOT/f'assets/effects/fx_job_veteran_{job}.png'
   with Image.open(path) as im:
    self.assertEqual(im.mode,'RGBA');self.assertEqual(im.size,(768,512))
    for f in range(24):
     crop=im.crop(((f%6)*128,(f//6)*128,(f%6+1)*128,(f//6+1)*128))
     self.assertEqual(crop.tobytes(),module.frame(job,f).tobytes(),(job,f))
if __name__=='__main__':unittest.main()
