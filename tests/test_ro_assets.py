import json
from pathlib import Path
import unittest
from PIL import Image, ImageChops

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'assets'/'ro'

class TestRoSprites(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest=json.loads((ASSETS/'manifest.json').read_text())

    def test_complete_verified_roster(self):
        m=self.manifest
        self.assertEqual(m['errors'],[])
        self.assertEqual(len(m['sprites']),26)
        self.assertEqual(sum(s['kind']=='hero' for s in m['sprites']),12)
        self.assertEqual(sum(s['kind']=='enemy' for s in m['sprites']),14)
        self.assertEqual(len(m['icons']),6)
        self.assertEqual(sorted(s['key'] for s in m['sprites'] if s['phase']==0),
                         ['archer','assassin','guard','mage','priestess','warrior'])

    def test_real_rgba_sheet_layout(self):
        for s in self.manifest['sprites']:
            with self.subTest(s['key']):
                sheet=Image.open(ROOT/s['sheet'])
                tile=s['cell_px'][0]
                self.assertEqual(sheet.mode,'RGBA')
                self.assertEqual(sheet.size,(s['columns']*tile,len(s['rows'])*tile))
                px=sheet.getpixel((0,0))
                assert isinstance(px,tuple)
                self.assertEqual(px[3],0)
                bbox=sheet.getbbox()
                assert bbox is not None
                self.assertGreater(bbox[2],0)
                for row,name in enumerate(s['rows']):
                    a=s['actions'][name]
                    self.assertEqual(a['row'],row)
                    self.assertGreater(a['frame_count'],0)
                    self.assertLessEqual(a['frame_count'],s['columns'])
                    self.assertEqual(len(a['duration_ms']),a['frame_count'])
                    self.assertTrue(a['source_sha256'])
                    for ms in a['duration_ms']:self.assertGreater(ms,0)
                    frame=sheet.crop((0,row*tile,tile,(row+1)*tile))
                    self.assertIsNotNone(frame.getbbox(),f"{s['key']} {name}")
                still=Image.open(ROOT/s['still'])
                self.assertEqual(still.mode,'RGBA')
                self.assertEqual(still.size,(tile,tile))
                row=s['actions']['ready']['row'] if s['kind']=='hero' else s['actions']['idle']['row']
                expected=sheet.crop((0,row*tile,tile,(row+1)*tile))
                self.assertIsNone(ImageChops.difference(still,expected).getbbox())
                if s['kind']=='hero':
                    portrait=Image.open(ROOT/s['portrait'])
                    self.assertEqual((portrait.mode,portrait.size),('RGBA',(256,256)))
                    self.assertIsNotNone(portrait.getbbox())

    def test_icons_rgba(self):
        for icon in self.manifest['icons']:
            with self.subTest(icon['hero']):
                image=Image.open(ROOT/icon['file'])
                self.assertEqual((image.mode,image.size),('RGBA',(128,128)))
                self.assertIsNotNone(image.getbbox())
                px=image.getpixel((0,0))
                assert isinstance(px,tuple)
                self.assertEqual(px[3],0)

if __name__=='__main__':unittest.main()
