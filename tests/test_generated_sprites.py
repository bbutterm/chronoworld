"""Authored sheet validation must reject corrupt evidence and preserve native RO checks."""
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import check_sprites


class GeneratedSpritesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = json.loads((ROOT / 'assets/sprites/sprites.json').read_text())

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.png = self.root / 'assets/sprites/generated.png'
        self.png.parent.mkdir(parents=True)
        self.data = copy.deepcopy(self.runtime)
        cfg = self.data['classes']['monster']
        self.cell = cfg['cell']
        cw, ch = self.cell
        self.image = Image.new('RGBA', (cw * self.data['columns'], ch * len(cfg['anims'])))
        draw = ImageDraw.Draw(self.image)
        boxes = {}
        unions = {}
        for row, name in enumerate(cfg['anims']):
            config = {**self.data['anims'][name], **self.data['animOverrides'].get('monster', {}).get(name, {})}
            count = config['frames']
            boxes[name] = []
            for col in range(count):
                box = [30 + col, 40 + row, 36 + col, 49 + row]
                boxes[name].append(box)
                draw.rectangle((cw * col + box[0], ch * row + box[1],
                                cw * col + box[2] - 1, ch * row + box[3] - 1),
                               fill=(140, 90, 50, 80))
            unions[name] = [min(b[0] for b in boxes[name]), min(b[1] for b in boxes[name]),
                            max(b[2] for b in boxes[name]), max(b[3] for b in boxes[name])]
        self.sprite = {
            'id': 'test_generated', 'class': 'monster', 'file': 'sprites/generated.png',
            'hitFrames': {'attack': 3}, 'bbox': unions,
            'source': {'kind': 'generated', 'version': 'test-v1', 'method': 'Authored test sheet',
                       'referenceSheetSha256': 'a' * 64},
            'generatedFrameBboxes': boxes, 'contractFrameCount': 24,
        }
        self.data['sprites'] = [self.sprite]
        self.save_image()

    def save_image(self):
        self.image.save(self.png)
        self.sprite['source']['sheetSha256'] = hashlib.sha256(self.png.read_bytes()).hexdigest()

    def run_check(self, payload=500, source_cache=None):
        output = io.StringIO()
        with patch.object(check_sprites, 'ROOT', self.root), \
                patch.object(check_sprites, 'REQUIRED', {'test_generated'}), \
                patch.object(check_sprites.sprites_manifest, 'load', return_value=self.data), \
                patch.object(check_sprites, 'delivered_payload', return_value=(payload, payload, 'fixture')), \
                contextlib.redirect_stdout(output):
            try:
                check_sprites.check(source_cache=source_cache)
            except SystemExit as error:
                self.assertEqual(error.code, 1)
                return False, output.getvalue()
        return True, output.getvalue()

    def assert_rejected(self, message):
        valid, output = self.run_check()
        self.assertFalse(valid, output)
        self.assertIn(message, output)

    def make_native(self):
        self.sprite['source'] = {'job': 'Native fixture'}
        self.sprite['sourceFrameBboxes'] = {}
        self.sprite['sourceFrameCounts'] = {}
        self.sprite['sourceFrameIndices'] = {}
        ax, ay = self.data['classes']['monster']['anchor']
        for name, boxes in self.sprite['generatedFrameBboxes'].items():
            self.sprite['sourceFrameBboxes'][name] = [[b[0] - ax, b[1] - ay, b[2] - ax, b[3] - ay] for b in boxes]
            self.sprite['sourceFrameCounts'][name] = len(boxes)
            self.sprite['sourceFrameIndices'][name] = list(range(len(boxes)))
        self.sprite['sourceAlphaValues'] = [80]

    def native_cache(self, corrupt=False):
        self.make_native()
        cache = self.root / 'native-cache'
        cache.mkdir()
        self.sprite['sourceCacheFiles'] = {}
        cfg = self.data['classes']['monster']
        cw, ch = self.cell
        ox, oy = 256 - cfg['anchor'][0], 480 - cfg['anchor'][1]
        for row, (name, boxes) in enumerate(self.sprite['generatedFrameBboxes'].items()):
            frames = []
            for col, box in enumerate(boxes):
                frame = self.image.crop((cw * col, ch * row, cw * (col + 1), ch * (row + 1)))
                if corrupt and name == 'idle' and col == 0:
                    frame.putpixel((box[0] + 1, box[1] + 1), (10, 240, 20, 80))
                full = Image.new('RGBA', (512, 640))
                full.paste(frame, (ox, oy))
                frames.append(full)
            filename = f'{name}.png'
            frames[0].save(cache / filename, save_all=True, append_images=frames[1:],
                           duration=100, loop=0, blend=0)
            self.sprite['sourceCacheFiles'][name] = filename
        return cache

    def test_generated_art_has_its_own_proof_and_no_native_alpha_claim(self):
        valid, output = self.run_check(source_cache=self.root / 'absent-native-cache')
        self.assertTrue(valid, output)
        self.assertNotIn('sourceAlphaValues', self.sprite)
        self.assertIn('generated contracts: 1; native cached frames checked: 0', output)
        self.assertIn('generated PNG hashes/frame contracts', output)

    def test_corrupt_sheet_digest_is_rejected(self):
        self.sprite['source']['sheetSha256'] = '0' * 64
        self.assert_rejected('generated sheet SHA-256 mismatch')

    def test_modified_png_is_rejected_even_with_unchanged_bounds(self):
        self.image.putpixel((31, 42), (255, 10, 20, 80))
        self.image.save(self.png)
        self.assert_rejected('generated sheet SHA-256 mismatch')

    def test_wrong_per_frame_bbox_is_rejected(self):
        self.sprite['generatedFrameBboxes']['walk'][2][0] += 1
        self.assert_rejected('frame 2 generated bbox mismatch')

    def test_wrong_runtime_union_is_rejected(self):
        self.sprite['bbox']['attack'][2] += 1
        self.assert_rejected('attack bbox metadata mismatch')

    def test_missing_contract_is_rejected(self):
        del self.sprite['contractFrameCount']
        self.assert_rejected('generated contractFrameCount must equal 24')

    def test_incorrect_contract_count_is_rejected(self):
        for count in (23, '24', 24.0, True):
            with self.subTest(count=count):
                self.sprite['contractFrameCount'] = count
                self.assert_rejected('generated contractFrameCount must equal 24')

    def test_malformed_generated_metadata_is_rejected(self):
        original = copy.deepcopy(self.sprite)
        cases = (
            ('method', [], 'source.method must be a nonempty string'),
            ('version', ' ', 'source.version must be a nonempty string'),
            ('referenceSheetSha256', 'invalid', 'source.referenceSheetSha256 must be a SHA-256 digest'),
            ('sheetSha256', None, 'source.sheetSha256 must be a SHA-256 digest'),
        )
        for field, value, message in cases:
            with self.subTest(field=field):
                self.sprite.clear()
                self.sprite.update(copy.deepcopy(original))
                self.sprite['source'][field] = value
                self.assert_rejected(message)

    def test_bbox_structure_requires_each_animation_and_exact_frame_counts(self):
        original = copy.deepcopy(self.sprite['generatedFrameBboxes'])
        cases = (
            (None, 'generatedFrameBboxes must be an object'),
            ({k: v for k, v in original.items() if k != 'death'}, 'animation names mismatch'),
            ({**original, 'extra': []}, 'animation names mismatch'),
            ({**original, 'walk': original['walk'][:-1]}, 'walk generated bbox count must equal 6'),
        )
        for value, message in cases:
            with self.subTest(message=message):
                self.sprite['generatedFrameBboxes'] = value
                self.assert_rejected(message)

    def test_bbox_coordinates_must_be_ordered_integers_inside_cell(self):
        original = copy.deepcopy(self.sprite['generatedFrameBboxes']['idle'][0])
        cases = ([True, 40, 36, 49], [30.0, 40, 36, 49], [30, 40, 36],
                 [36, 40, 30, 49], [0, 40, 36, 49], [30, 40, self.cell[0], 49])
        for box in cases:
            with self.subTest(box=box):
                self.sprite['generatedFrameBboxes']['idle'][0] = box
                self.assert_rejected('generated bbox 0')
        self.sprite['generatedFrameBboxes']['idle'][0] = original

    def test_empty_required_frame_is_rejected_after_updating_hash(self):
        cw, ch = self.cell
        self.image.paste((0, 0, 0, 0), (cw * 2, ch, cw * 3, ch * 2))
        self.save_image()
        self.assert_rejected('walk frame 2 is empty')

    def test_extra_visible_cell_is_rejected_after_updating_hash(self):
        self.image.putpixel((self.cell[0] * 7 + 35, 45), (255, 255, 255, 255))
        self.save_image()
        self.assert_rejected('idle extra nonempty cell 7')

    def test_pixels_touching_cell_edge_are_rejected(self):
        self.image.putpixel((0, 45), (255, 255, 255, 255))
        self.save_image()
        self.assert_rejected('idle frame 0 touches cell edge')

    def test_generated_art_does_not_bypass_payload_budget(self):
        valid, output = self.run_check(payload=check_sprites.BUDGET + 1)
        self.assertFalse(valid, output)
        self.assertIn('exceeds 3 MB', output)

    def test_native_sheet_still_requires_source_proof(self):
        del self.sprite['source']['kind']
        self.assert_rejected('source proof length')

    def test_valid_native_proof_is_unchanged(self):
        self.make_native()
        valid, output = self.run_check()
        self.assertTrue(valid, output)
        self.assertIn('generated contracts: 0', output)

    def test_native_alpha_evidence_is_not_replaced_by_generated_bounds(self):
        self.make_native()
        self.sprite['sourceAlphaValues'] = []
        self.assert_rejected('new semi-transparent alpha not present in source')

    def test_native_sampling_is_not_replaced_by_generated_contract(self):
        self.make_native()
        self.sprite['sourceFrameIndices']['walk'][2] = 4
        self.assert_rejected('source sampling indices differ')

    def test_native_cache_pixels_are_checked_when_requested(self):
        valid, output = self.run_check(source_cache=self.native_cache())
        self.assertTrue(valid, output)
        self.assertIn('native cached frames checked: 24', output)

    def test_native_cache_pixel_mismatch_is_rejected(self):
        valid, output = self.run_check(source_cache=self.native_cache(corrupt=True))
        self.assertFalse(valid, output)
        self.assertIn('idle frame 0 pixels differ from original x1 source', output)


if __name__ == '__main__':
    unittest.main()
