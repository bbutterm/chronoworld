"""Minimal read-only GRF 0x200 reader (scRO client). Never writes to the client."""
import struct, zlib, os
CLIENT = '/root/ro-client-extraction-2/client/scRO'
ORDER = ['patch.grf', 'data.grf', 'rdata.grf']   # DATA.INI priority, highest first
MAX_FILE = 64 << 20                               # bomb guard: no single asset above 64 MiB

class GRF:
    def __init__(self, client=CLIENT):
        self.client = client
        self.index = {}                           # lower-case path -> (grf, entry)
        for g in reversed(ORDER):                 # lower priority first, overridden later
            for e in self._table(os.path.join(client, g)):
                self.index[e['name'].lower()] = (g, e)

    @staticmethod
    def _table(path):
        with open(path, 'rb') as f:
            h = f.read(46)
            if h[:15] != b'Master of Magic':
                raise ValueError(f'{path}: not a GRF')
            off, seed, cnt, ver = struct.unpack('<IIII', h[30:46])
            if ver != 0x200:
                raise ValueError(f'{path}: unsupported GRF version {ver:#x}')
            f.seek(off + 46)
            cs, us = struct.unpack('<II', f.read(8))
            t = zlib.decompress(f.read(cs))
        if len(t) != us:
            raise ValueError(f'{path}: table size mismatch')
        p = 0
        while p < len(t):
            e = t.index(b'\0', p)
            raw = t[p:e]; p = e + 1
            c, ca, r, fl, o = struct.unpack('<IIIBI', t[p:p + 17]); p += 17
            if fl & 1 and not fl & 6:
                yield dict(name=raw.decode('cp949', 'replace'), raw=raw, comp=c, ca=ca, size=r, off=o)

    def has(self, name):
        return name.lower() in self.index

    def locate(self, name):
        return self.index[name.lower()]

    def read(self, name):
        g, e = self.index[name.lower()]
        if e['size'] > MAX_FILE:
            raise ValueError(f'{name}: {e["size"]} bytes exceeds limit')
        with open(os.path.join(self.client, g), 'rb') as f:
            f.seek(e['off'] + 46)
            d = zlib.decompressobj().decompress(f.read(e['ca']), e['size'] + 1)
        if len(d) < e['size']:
            raise ValueError(f'{name}: truncated ({len(d)} < {e["size"]})')
        return d[:e['size']]

    def glob(self, prefix):
        prefix = prefix.lower()
        return sorted(v[1]['name'] for k, v in self.index.items() if k.startswith(prefix))
