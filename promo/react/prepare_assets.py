#!/usr/bin/env python3
"""Готовит ассеты React-промо в promo/react/public (результат коммитится — сборке Pillow не нужен).

Кадры игры из promo/shots и promo/branches → WebP 1080×1920 (для страницы и рендера mp4) и 720×1280 (телефоны,
srcset). Карты RO — из assets/ui/cards, звук — m4a из assets/audio, шрифты — promo/src/fonts.
Запуск из promo/react: python3 prepare_assets.py
"""
import shutil
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PUB = HERE / 'public'

SHOTS = [
    'battle_intro', 'battle_ult_asura', 'battle_ult_lord_of_vermillion', 'battle_break', 'home', 'hero_vika',
    'tavern_summon', 'mvp_dracula', 'mvp_pharaoh', 'mvp_baphomet', 'hunt_screen', 'tavern_evening_1', 'tavern_evening_3',
    'tower_cards',
]
BRANCHES = ['vika', 'all_heroes']
CARDS = ['card_dracula', 'card_pharaoh', 'card_baphomet', 'card_osiris', 'card_orc_lord', 'card_eddga', 'card_maya']
AUDIO = ['charge_break', 'crit', 'hit_sword', 'job_change', 'chest_open', 'coin', 'level_up',
         'mon_dracula_attack', 'mon_baphomet__attack', 'hit_blunt']


def webp(src: Path, name: str) -> None:
    im = Image.open(src).convert('RGB')
    for w, q, suffix in ((1080, 74, ''), (720, 72, '_720')):
        h = round(im.height * w / im.width)
        out = PUB / 'img' / f'{name}{suffix}.webp'
        im.resize((w, h), Image.LANCZOS).save(out, 'WEBP', quality=q, method=6)


MUSIC = 'music_battle_desert'  # RO «Backattack!!» — бой главы 4
MUSIC_FROM = 0.15  # с какой секунды трека
DUR = 35.0  # длина ролика (как DUR в src/timeline.js)


def music() -> None:
    """Трек ровно на длину ролика с затуханием в конце: страница крутит его по кругу синхронно с таймлайном."""
    import subprocess

    import imageio_ffmpeg

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    src = ROOT / 'assets/audio' / f'{MUSIC}.ogg'
    af = f'afade=t=in:d=0.08,afade=t=out:st={DUR - 1.6}:d=1.6'
    for ext, codec in (('m4a', ['-c:a', 'aac', '-b:a', '96k']), ('ogg', ['-c:a', 'libvorbis', '-q:a', '3'])):
        out = PUB / 'audio' / f'music_promo.{ext}'
        subprocess.run([ff, '-y', '-loglevel', 'error', '-ss', str(MUSIC_FROM), '-t', str(DUR), '-i', str(src), '-af', af,
                        '-ac', '2', '-ar', '44100', *codec, str(out)], check=True)


def main() -> None:
    for old in (PUB / 'img').glob('*.webp') if (PUB / 'img').exists() else []:
        old.unlink()
    for sub in ('img', 'cards', 'audio', 'fonts'):
        (PUB / sub).mkdir(parents=True, exist_ok=True)
    for s in SHOTS:
        webp(ROOT / 'promo/shots' / f'{s}.jpg', s)
    for b in BRANCHES:
        webp(ROOT / 'promo/branches' / f'{b}.jpg', f'branch_{b}')
    for c in CARDS:
        shutil.copy(ROOT / 'assets/ui/cards' / f'{c}.webp', PUB / 'cards' / f'{c}.webp')
    for a in AUDIO:
        for ext in ('m4a', 'ogg'):
            shutil.copy(ROOT / 'assets/audio' / f'{a}.{ext}', PUB / 'audio' / f'{a}.{ext}')
    music()
    for f in (ROOT / 'promo/src/fonts').iterdir():
        shutil.copy(f, PUB / 'fonts' / f.name)
    total = sum(p.stat().st_size for p in PUB.rglob('*') if p.is_file())
    print(f'public: {total / 1024:.0f} КБ')


if __name__ == '__main__':
    main()
