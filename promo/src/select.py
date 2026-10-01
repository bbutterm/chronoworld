"""Отбор кадров: promo/.work/raw/*.png → promo/shots/*.jpg (1080×1920, ≤ 400 КБ) и promo/branches/*.png → *.jpg.

Кадры 1080×2338 (экран 390×844) обрезаются до 1920 по высоте (сдвиг — CROP, по умолчанию по центру); кадры 1080×1920
(экран 405×720) — как есть. Запуск из корня репозитория: python3 promo/src/select.py
"""
import io
import sys
from pathlib import Path

from PIL import Image

RAW = Path('promo/.work/raw')
OUT = Path('promo/shots')
LIMIT = 400 * 1024

# имя в promo/shots ← кадр в raw (первый существующий из списка)
PICK = {
    'battle_intro': ['battle_storm_intro'],
    'battle_ult_storm_gust': ['battle_storm_ult_ult_lira_storm_gust_1_600'],
    'battle_ult_magnus': ['battle_storm_ult_ult_vika_magnus_1_600', 'battle_storm_ult_ult_vika_magnus_1_250'],
    'battle_ult_lord_of_vermillion': ['battle_storm_ult_ult_kai_lord_of_vermillion_1_250'],
    'battle_ult_magnum_break': ['battle_storm_ult_ult_alan_magnum_break_2_250'],
    'battle_ult_claymore': ['battle_storm_ult_ult_bran_claymore_1_250'],
    'battle_ult_asura': ['battle_asura_ult_ult_vika_asura_1_250', 'battle_asura_ult_ult_vika_asura_1_600'],
    'battle_ult_bowling_bash': ['battle_asura_ult_ult_iris_bowling_bash_1_250', 'battle_asura_ult_ult_iris_bowling_bash_1_600'],
    'battle_ult_falcon': ['battle_asura_ult_ult_meilin_blitz_beat_1_250'],
    'battle_ult_sonic_blow': ['battle_asura_ult_ult_zara_sonic_blow_1_250'],
    'battle_charge': ['battle_storm_charge_14_120'],
    'battle_break': ['battle_storm_break_15_400', 'battle_storm_break_15_150'],
    'mvp_dracula': ['hunt_mvp_dracula_intro'],
    'mvp_baphomet': ['hunt_mvp_baphomet_intro'],
    'mvp_pharaoh': ['hunt_mvp_pharaoh_intro'],
    'mvp_osiris': ['hunt_mvp_osiris_intro'],
    'mvp_dracula_win': ['hunt_mvp_dracula_end'],
    'mvp_baphomet_win': ['hunt_mvp_baphomet_end'],
    'mvp_pharaoh_win': ['hunt_mvp_pharaoh_end'],
    'hunt_screen': ['hunt_mvp_dracula_screen'],
    'tower_cards': ['tower_bless'],
    'tower_lobby': ['tower_lobby'],
    'tower_run': ['tower_run'],
    'tower_event': ['tower_event'],
    'tavern_evening_1': ['evening_tav_ch1_3'],
    'tavern_evening_2': ['evening_tav_ch5_2'],
    'tavern_evening_3': ['evening_tav_ch9_2'],
    'tavern_hub': ['evening_hub'],
    'tavern_summon': ['tavern_summon'],
    'hero_lira': ['hero_lira'],
    'hero_vika': ['hero_vika'],
    'heroes': ['heroes'],
    'home': ['home'],
}
# Сдвиг обрезки сверху для высоких кадров (по умолчанию — центр).
CROP = {}


def fit(im: Image.Image, dst: Path) -> int:
    for q in (90, 86, 82, 78, 74, 70, 65, 60):
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=q, optimize=True, progressive=True)
        if buf.tell() <= LIMIT or q == 60:
            dst.write_bytes(buf.getvalue())
            return buf.tell()
    return 0


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, srcs in PICK.items():
        src = next((RAW / f'{s}.png' for s in srcs if (RAW / f'{s}.png').exists()), None)
        if not src:
            print(f'нет кадра для {name}', file=sys.stderr)
            continue
        im = Image.open(src).convert('RGB')
        w, h = im.size
        if h > 1920:
            top = CROP.get(name, (h - 1920) // 2)
            im = im.crop((0, top, w, top + 1920))
        size = fit(im, OUT / f'{name}.jpg')
        print(f'{name}.jpg ← {src.name} ({size // 1024} КБ)')
    br = Path('promo/branches')
    br.mkdir(parents=True, exist_ok=True)
    for src in sorted(Path('promo/.work/branches').glob('*.png')):
        size = fit(Image.open(src).convert('RGB'), br / f'{src.stem}.jpg')
        print(f'branches/{src.stem}.jpg ({size // 1024} КБ)')


main()
