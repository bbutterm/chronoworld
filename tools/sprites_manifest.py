"""Read/write the v2 sprite manifest split into two files.

assets/sprites/sprites.json            — what the game reads (bundled into JS): classes, anims and per sprite
                                          only RUNTIME_KEYS (src/pipeline/sprites.ts SpritesV2).
assets/sprites/sprites.provenance.json — art-pipeline proof, never bundled or copied to dist: per sprite id every
                                          other field (source, sourceFrameBboxes, sourceFrameIndices, ...), plus notes.
                                          Read by tools/check_sprites.py, build scripts, content:check and tests.

Tools work with the merged view: load() returns sprites.json with provenance fields put back into each entry,
save() splits it again. Adding a new field: if the game needs it, add it to RUNTIME_KEYS (and SpritesV2 in
src/pipeline/sprites.ts); otherwise it lands in provenance automatically.
"""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'assets/sprites/sprites.json'
RUNTIME_KEYS = ('id', 'class', 'file', 'portrait', 'hitFrames', 'bbox')
TOP_RUNTIME_KEYS = ('schema', 'columns', 'classes', 'anims', 'animOverrides', 'sprites')


def provenance_path(runtime: Path = RUNTIME) -> Path:
    return runtime.with_name(runtime.stem + '.provenance.json')


def load(runtime: Path = RUNTIME) -> dict:
    """sprites.json merged with sprites.provenance.json (missing provenance file — runtime data only)."""
    data = json.loads(Path(runtime).read_text())
    prov_file = provenance_path(Path(runtime))
    prov = json.loads(prov_file.read_text()) if prov_file.is_file() else {}
    per_id = prov.get('sprites', {})
    for s in data.get('sprites', []):
        s.update(per_id.get(s['id'], {}))
    for k, v in prov.items():
        if k != 'sprites' and k not in data:
            data[k] = v
    return data


def split(data: dict) -> tuple[dict, dict]:
    runtime = {k: data[k] for k in TOP_RUNTIME_KEYS if k in data}
    runtime['sprites'] = []
    prov: dict = {k: v for k, v in data.items() if k not in TOP_RUNTIME_KEYS}
    prov['sprites'] = {}
    for s in data.get('sprites', []):
        runtime['sprites'].append({k: s[k] for k in RUNTIME_KEYS if k in s})
        extra = {k: v for k, v in s.items() if k not in RUNTIME_KEYS}
        if extra:
            prov['sprites'][s['id']] = extra
    return runtime, prov


def _dump_runtime(runtime: dict) -> str:
    """Compact but diff-friendly: one line per class/anim/sprite."""
    def block(obj: dict | list, indent: str) -> str:
        if isinstance(obj, list):
            return '[\n' + ',\n'.join(indent + ' ' + json.dumps(v, ensure_ascii=False, separators=(',', ':')) for v in obj) + '\n' + indent + ']'
        return '{\n' + ',\n'.join(f'{indent} {json.dumps(k)}:' + json.dumps(v, ensure_ascii=False, separators=(',', ':')) for k, v in obj.items()) + '\n' + indent + '}'
    parts = []
    for k, v in runtime.items():
        parts.append(f' {json.dumps(k)}:' + (block(v, ' ') if isinstance(v, (dict, list)) and v else json.dumps(v)))
    return '{\n' + ',\n'.join(parts) + '\n}\n'


def save(data: dict, runtime: Path = RUNTIME) -> None:
    rt, prov = split(data)
    Path(runtime).write_text(_dump_runtime(rt))
    provenance_path(Path(runtime)).write_text(json.dumps(prov, indent=1, ensure_ascii=False) + '\n')
