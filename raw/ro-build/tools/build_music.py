"""RO BGM (client MP3) -> compact looping game music: Ogg Opus (Chrome/Android) + M4A AAC (iOS Safari).

Per track: linear gain to -16 LUFS (no compression), trim leading/trailing silence (< -60 dB),
3 ms fade at both ends so the AudioBufferSourceNode loop seam does not click.
Input: raw/ro/bgm/NN.mp3 of the chronoworld branch checkout. Output: raw/ro-build/audio/.
"""
import json, os, re, subprocess, sys

REPO = sys.argv[1] if len(sys.argv) > 1 else '/root/ro-client-extraction-2/push-repo'
SRC = os.path.join(REPO, 'raw', 'ro', 'bgm')
OUT = os.path.join(REPO, 'raw', 'ro-build', 'audio')
TARGET_LUFS = -16.0
PEAK_CEILING = -1.0                               # dBTP after gain
MAX_BYTES = 1_450_000                             # per file, RO_EXTRACT_LIST asks for <= 1.5 MB
# game MUSIC id (src/game/audioCatalog.ts) -> BGM file; proposed ids are not in MUSIC yet
EXISTING = {'home': '08', 'tavern': '26', 'map_meadow': '12', 'battle_meadow': '05', 'map_desert': '11',
            'battle_desert': '22', 'map_grove': '14', 'battle_grove': '20', 'map_shipwreck': '15',
            'battle_shipwreck': '17', 'map_crypt': '42', 'battle_crypt': '40', 'map_niflheim': '84',
            'battle_niflheim': '85', 'boss': '06'}
PROPOSED = {'title': '01', 'map_sewer': '19', 'battle_sewer': '19', 'map_orcs': '35', 'battle_orcs': '48',
            'map_aldebaran': '39', 'battle_aldebaran': '60', 'boss_aldebaran': '61', 'map_maze': '16',
            'battle_maze': '16', 'tower': '21', 'hunt': '02'}
TITLES = {'01': 'Title', '02': 'Gambler of Highway', '03': 'Peaceful Forest', '05': 'Tread on the Ground',
          '06': 'Risk Your Life', '08': 'Theme of Prontera', '11': 'Theme of Morroc', '12': 'Streamside',
          '14': 'Theme of Payon', '15': 'Theme of Alberta', '16': 'Labyrinth', '17': 'Treasure Hunter',
          '18': 'Time Up!!', '19': 'Under the Ground', '20': 'Ancient Groover', '21': 'Through the Tower',
          '22': 'Backattack!!', '24': 'Desert', '26': 'Everlasting Wanderers (check)', '35': 'TeMPoison',
          '36': 'Nano East', '37': 'TeMPorsche', '38': 'Hamatan', '39': 'Theme of Al de Baran',
          '40': 'Fear...', '42': "Curse'n Pain / Morning Gloomy (check)", '43': '(check)', '44': 'TeMP It Up',
          '47': 'Welcome Mr. Hwang', '48': 'Help Yourself', '52': 'Ready (check)', '60': 'Aeon', '61': 'Zingaro',
          '84': 'Christmas in the 13th Month (check)', '85': 'Dancing Christmas in the 13th Month (check)'}


def run(args):
    return subprocess.run(args, capture_output=True, text=True, check=True)


def probe(path):
    out = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=sample_rate,bit_rate',
               '-of', 'json', path]).stdout
    j = json.loads(out)
    return float(j['format']['duration']), int(j['streams'][0]['sample_rate'])


def loudness(path, af=None):
    args = ['ffmpeg', '-hide_banner', '-nostats', '-i', path]
    args += ['-af', (af + ',' if af else '') + 'ebur128=peak=true', '-f', 'null', '-']
    err = subprocess.run(args, capture_output=True, text=True).stderr
    summary = err[err.rfind('Summary:'):]
    i = float(re.search(r'I:\s+(-?[\d.]+) LUFS', summary).group(1))
    p = float(re.search(r'Peak:\s+(-?[\d.]+) dBFS', summary).group(1))
    return i, p


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith('.mp3'):
            continue
        nn = fn[:-4]; src = os.path.join(SRC, fn)
        dur, rate = probe(src)
        lufs, peak = loudness(src)
        gain = round(min(TARGET_LUFS - lufs, PEAK_CEILING - peak), 2)
        trim = ('silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.02,areverse,'
                'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.02,areverse')
        af = f'volume={gain}dB,{trim},afade=t=in:d=0.003,areverse,afade=t=in:d=0.003,areverse'
        low = rate < 32000                         # 22.05 kHz sources carry no content above ~11 kHz
        cap = int(MAX_BYTES * 8 / dur / 1000)      # kbps that keeps the whole track under MAX_BYTES
        opus_k = min(32 if low else 40, cap)
        aac_k = min(40 if low else 56, cap)
        ogg = os.path.join(OUT, f'bgm_{nn}.ogg'); m4a = os.path.join(OUT, f'bgm_{nn}.m4a')
        run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-af', af, '-map_metadata', '-1',
             '-c:a', 'libopus', '-b:a', f'{opus_k}k', '-vbr', 'on', '-application', 'audio', ogg])
        run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-af', af, '-map_metadata', '-1',
             '-c:a', 'aac', '-ar', str(rate), '-b:a', f'{aac_k}k', '-movflags', '+faststart', m4a])
        out_dur, _ = probe(ogg)
        o_lufs, o_peak = loudness(ogg)
        row = dict(bgm=nn, title=TITLES.get(nn, ''), source=f'raw/ro/bgm/{fn}', sourceBytes=os.path.getsize(src),
                   sourceRate=rate, sourceSeconds=round(dur, 3), sourceLufs=lufs, sourceTruePeak=peak, gainDb=gain,
                   seconds=round(out_dur, 3), trimmedSeconds=round(dur - out_dur, 3), lufs=o_lufs, truePeak=o_peak,
                   ogg=dict(file=f'raw/ro-build/audio/bgm_{nn}.ogg', bytes=os.path.getsize(ogg), codec='opus',
                            kbps=opus_k),
                   m4a=dict(file=f'raw/ro-build/audio/bgm_{nn}.m4a', bytes=os.path.getsize(m4a), codec='aac-lc',
                            kbps=aac_k),
                   gameIds=[k for k, v in EXISTING.items() if v == nn],
                   proposedIds=[k for k, v in PROPOSED.items() if v == nn])
        rows.append(row)
        print(f"{nn} {dur:6.1f}s -> {out_dur:6.1f}s gain {gain:+5.1f} dB  {lufs:5.1f}->{o_lufs:5.1f} LUFS peak {o_peak:+.1f}  "
              f"mp3 {row['sourceBytes'] / 1e6:.2f}MB ogg {row['ogg']['bytes'] / 1e6:.2f}MB m4a {row['m4a']['bytes'] / 1e6:.2f}MB "
              f"{row['gameIds'] or row['proposedIds'] or ''}")
    manifest = dict(schema=1, targetLufs=TARGET_LUFS,
                    note='Copy bgm_NN.ogg + bgm_NN.m4a to assets/audio/music_<gameId>.ogg/.m4a (see docs/RO_SCRO_IMPORT.md).',
                    existing=EXISTING, proposed=PROPOSED, tracks=rows)
    with open(os.path.join(OUT, 'music.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    tot = lambda k: sum(r[k]['bytes'] for r in rows) / 1e6
    print(f"total mp3 {sum(r['sourceBytes'] for r in rows) / 1e6:.1f}MB  ogg {tot('ogg'):.1f}MB  m4a {tot('m4a'):.1f}MB")


if __name__ == '__main__':
    main()
