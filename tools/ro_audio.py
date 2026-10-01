#!/usr/bin/env python3
"""Звуки RO → assets/audio (docs/design/audio.md, docs/RO_EXTRACT_LIST.md §7).

    python3 tools/ro_audio.py            # собрать всё (пропускает готовые файлы)
    python3 tools/ro_audio.py --force    # пересобрать всё
    python3 tools/ro_audio.py --check    # только проверить: всё ли собрано, нет ли лишнего (код выхода 1)

Источник — сырые WAV клиента в raw/ro/wav и raw/ro/wav/effect (лежат в репозитории). Что куда:
  1. SFX — таблица SFX ниже: id звука из src/game/audioCatalog.ts → файлы RO. Несколько файлов — варианты
     <id>.ogg, <id>_v2.ogg, … (игра чередует их, чтобы сто одинаковых ударов не звучали как пулемёт).
  2. Звуки монстров — все имена из data/monster_sounds.json → mon_<имя>.ogg.
Обработка (numpy): обрезать тишину по краям, при необходимости укоротить с затуханием, пик −1 dBFS, короткие
подъём/спад против щелчков. Кодирование — ffmpeg: Opus в Ogg (.ogg, Chrome/Android/Firefox/Telegram Android) и
AAC-LC в MP4 (.m4a, Safari/iOS/macOS, Telegram iOS). Игра берёт первый формат, который браузер умеет
(src/game/audio.ts → fileUrls), при ошибке декодирования — следующий.

ffmpeg — только инструмент сборки, в игру не попадает: $FFMPEG, иначе ffmpeg из PATH, иначе статический из
pip-пакета imageio-ffmpeg (`pip install imageio-ffmpeg`). Нужен numpy.

Музыку (raw/ro/bgm) скрипт НЕ трогает: её владелец готовит сам (docs/design/audio.md, «Музыка: заказ»).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WAV = os.path.join(ROOT, 'raw', 'ro', 'wav')
OUT = os.path.join(ROOT, 'assets', 'audio')
MONSTERS = os.path.join(ROOT, 'data', 'monster_sounds.json')

E = 'effect/'
# id звука → [(файл RO без .wav, укоротить до N с или None)]. Нет в таблице — играет синтез (audioSynth.ts).
SFX: dict[str, list[tuple[str, float | None]]] = {
    # интерфейс
    'ui_tap': [('버튼소리', 0.45)],
    # награды и прогресс
    'coin': [(E + 'ef_coin2', None)],
    'chest_open': [(E + 'rog_steal coin', None)],
    'unlock': [(E + 'ef_portal', None)],
    'level_up': [('levelup', None)],
    'job_change': [('levelup', None)],
    'rarity_up': [(E + 'drop_pink', 2.2)],
    'refine_success': [(E + 'bs_refinesuccess', None)],
    'refine_fail': [(E + 'bs_refinefailed', None)],
    # Башня: выбрана карта-благословение (Blessing послушника)
    'bless_pick': [(E + 'ef_blessing', None)],
    # таверна: открытие карты по цвету редкости (звуки выпадения вещей RO)
    'summon_common': [(E + 'drop_green', 1.2)],
    'summon_rare': [(E + 'drop_blue', 2.0)],
    'summon_epic': [(E + 'drop_purple', 2.4)],
    'summon_legendary': [(E + 'drop_yellow', None)],
    # бой: удары и взмахи (WeaponHitSoundTable / WeaponSoundTable клиента)
    'swing': [('attack_sword', None), ('attack_twohand_sword', None)],
    'swing_dagger': [('attack_short_sword', None), ('attack_katar', None)],
    'swing_blunt': [('attack_mace', None), ('attack_axe', None)],
    'hit_sword': [('_hit_sword', None)],
    'hit_dagger': [('_hit_dagger', None)],
    'hit_blunt': [('_hit_mace', None), ('_hit_axe', None)],
    'hit_arrow': [('_hit_arrow', None)],
    'hit_claw': [('_hit_fist1', None), ('_hit_fist2', None), ('_hit_fist3', None), ('_hit_fist4', None), ('_enemy_hit_normal1', None)],
    'hit_magic': [(E + 'ef_hit2', None)],
    'crit': [(E + 'ef_hit5', None), (E + 'ef_hit6', None)],
    'bow_shot': [('attack_bow1', None), ('attack_bow2', None)],
    # бой: навыки (EffectTable клиента)
    'cast_start': [(E + 'ef_beginspell', None)],
    'cast_fire': [(E + 'ef_firearrow1', None), (E + 'ef_firearrow2', None), (E + 'ef_firearrow3', None)],
    'cast_ice': [(E + 'ef_icearrow1', None), (E + 'ef_icearrow2', None), (E + 'ef_icearrow3', None), (E + 'ef_frostdiver', None)],
    'cast_wind': [(E + 'magician_thunderstorm', None), (E + 'ef_thunderstorm', None)],
    'cast_earth': [(E + 'wizard_earthspike', None), (E + 'earth_quake', 1.6)],
    'cast_holy': [(E + 'cru_holy cross', None)],
    'cast_dark': [(E + 'ef_soulstrike', None)],
    'cast_poison': [(E + 'thief_invenom', None), (E + 'ef_poisonattack', 1.4)],
    'cast_neutral': [(E + 'ef_napalmbeat', None), (E + 'ef_soulstrike', None)],
    'ult': [(E + 'ef_magnumbreak', None)],
    # ульта готова (тихий «портал готов»), заряд босса сбит (Spell Breaker мудреца)
    'ult_ready': [(E + 'ef_readyportal', None)],
    'charge_break': [(E + 'sage_spell breake', 1.0)],
    'heal': [('_heal_effect', None)],
    'buff': [(E + 'ef_blessing', None), (E + 'ef_incagility', None), (E + 'ef_angelus', 2.0)],
    'debuff': [(E + 'ef_decagility', None), (E + 'priest_lexaeterna', None)],
    'shield': [(E + 'kyrie_guard', None), (E + 'priest_kyrie_eleison_a', None)],
    'boss_death': [(E + 'st_mvp', None)],
}

PEAK_DB = -1.0
SILENCE = 10 ** (-48 / 20)  # порог тишины по краям


def ffmpeg_exe() -> str:
    exe = os.environ.get('FFMPEG') or shutil.which('ffmpeg')
    if exe:
        return exe
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit('Нужен ffmpeg: положите в PATH, задайте $FFMPEG или `pip install imageio-ffmpeg`')


def read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path) as w:
        n, ch, sw, rate = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(n)
    if sw == 1:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128
    elif sw == 2:
        x = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768
    else:
        raise ValueError(f'{path}: {sw * 8}-битный WAV не поддержан')
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)  # в игре всё моно
    return x, rate


def process(x: np.ndarray, rate: int, max_s: float | None) -> np.ndarray:
    loud = np.nonzero(np.abs(x) > SILENCE)[0]
    if len(loud) == 0:
        raise ValueError('пустой звук')
    a = max(0, loud[0] - int(0.002 * rate))
    b = min(len(x), loud[-1] + int(0.02 * rate))
    x = x[a:b].copy()
    fade_out = 0.01
    if max_s and len(x) > max_s * rate:
        x = x[: int(max_s * rate)]
        fade_out = min(0.35, max_s / 3)
    n_in, n_out = int(0.002 * rate), min(len(x) // 2, int(fade_out * rate))
    x[:n_in] *= np.linspace(0, 1, n_in, dtype=np.float32)
    x[len(x) - n_out :] *= np.linspace(1, 0, n_out, dtype=np.float32)
    peak = float(np.abs(x).max())
    return x * (10 ** (PEAK_DB / 20) / peak)


def write_wav(path: str, x: np.ndarray, rate: int) -> None:
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


def encode(ff: str, src: str, base: str) -> None:
    common = [ff, '-v', 'error', '-y', '-i', src, '-map_metadata', '-1', '-fflags', '+bitexact', '-ac', '1']
    subprocess.run(common + ['-c:a', 'libopus', '-b:a', '48k', '-vbr', 'on', '-application', 'audio', os.path.join(OUT, base + '.ogg')], check=True)
    subprocess.run(common + ['-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', os.path.join(OUT, base + '.m4a')], check=True)


def jobs() -> dict[str, tuple[str, float | None]]:
    """Имя файла в assets/audio (без расширения) → (исходник RO, укоротить до)."""
    out: dict[str, tuple[str, float | None]] = {}
    for sid, srcs in SFX.items():
        for i, (src, max_s) in enumerate(srcs):
            out[sid if i == 0 else f'{sid}_v{i + 1}'] = (src, max_s)
    with open(MONSTERS, encoding='utf8') as f:
        table = json.load(f)['sprites']
    for entry in table.values():
        for name in entry.get('attack', []) + entry.get('death', []):
            out[f'mon_{name}'] = (name, 1.8)
    return out


def managed(name: str) -> bool:
    """Файл, который создаёт этот скрипт (лишние такие — удалить); музыку и фоны владельца не трогаем."""
    base = name.rsplit('.', 1)[0]
    if base.startswith('mon_'):
        return True
    root = base.rsplit('_v', 1)[0] if '_v' in base and base.rsplit('_v', 1)[1].isdigit() else base
    return root in SFX


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--force', action='store_true', help='пересобрать готовые файлы')
    ap.add_argument('--check', action='store_true', help='только проверить')
    args = ap.parse_args()
    want = jobs()
    os.makedirs(OUT, exist_ok=True)
    problems: list[str] = []
    for base, (src, _) in want.items():
        if not os.path.exists(os.path.join(WAV, src + '.wav')):
            problems.append(f'{base}: нет исходника raw/ro/wav/{src}.wav')
    stale = [n for n in sorted(os.listdir(OUT)) if managed(n) and n.rsplit('.', 1)[0] not in want]
    missing = [b for b in want if not all(os.path.exists(os.path.join(OUT, f'{b}.{ext}')) for ext in ('ogg', 'm4a'))]
    if args.check:
        problems += [f'лишний файл assets/audio/{n}' for n in stale] + [f'не собран assets/audio/{b}.ogg|m4a' for b in missing]
        for p in problems:
            print('✗', p)
        print(f'звуков RO: {len(want)}, проблем: {len(problems)}')
        return 1 if problems else 0
    if problems:
        for p in problems:
            print('✗', p)
        return 1
    for n in stale:
        os.remove(os.path.join(OUT, n))
        print('удалён', n)
    ff = ffmpeg_exe()
    todo = list(want) if args.force else missing
    with tempfile.TemporaryDirectory() as tmp:
        for base in todo:
            src, max_s = want[base]
            x, rate = read_wav(os.path.join(WAV, src + '.wav'))
            y = process(x, rate, max_s)
            t = os.path.join(tmp, base + '.wav')
            write_wav(t, y, rate)
            encode(ff, t, base)
            print(f'{base}: {src}.wav {len(y) / rate:.2f} с')
    total = sum(os.path.getsize(os.path.join(OUT, f'{b}.{e}')) for b in want for e in ('ogg', 'm4a'))
    ogg = sum(os.path.getsize(os.path.join(OUT, f'{b}.ogg')) for b in want)
    print(f'готово: {len(want)} звуков, ogg {ogg / 1024:.0f} КБ, m4a {(total - ogg) / 1024:.0f} КБ')
    return 0


if __name__ == '__main__':
    sys.exit(main())
