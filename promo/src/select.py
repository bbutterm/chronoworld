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

# имя в promo/shots ← кадр в raw (первый существующий из списка). Ролик 01.10: две боевые сцены (Удар Асуры — каст и удар,
# Великая снежная буря), боссы глав (экран этапа), MVP (экран охоты), интерфейс и сюжет.
PICK = {
    'ult_asura_cast': ['battle_asura_ult_ult_vika_asura_1_950', 'battle_asura_ult_ult_vika_asura_1_850'],
    'ult_asura_hit': ['battle_asura_ult_ult_vika_asura_1_1250', 'battle_asura_ult_ult_vika_asura_1_1150'],
    'ult_storm_gust': ['battle_storm_ult_ult_lira_storm_gust_1_700', 'battle_storm_ult_ult_lira_storm_gust_1_500'],
    'boss_orc_lord': ['ui_stage_ch3_s10'],
    'boss_lord_of_death': ['ui_stage_ch10_s18'],
    'boss_baphomet': ['ui_stage_ch9_s18'],
    'mvp_dracula': ['ui_hunt_mvp_dracula'],
    'mvp_pharaoh': ['ui_hunt_mvp_pharaoh'],
    'ui_home': ['ui_home'],
    'ui_hero': ['ui_hero_vika'],
    'ui_tavern': ['ui_tavern'],
    'ui_inventory': ['ui_inventory_weapon'],
    'ui_campaign': ['ui_campaign_9', 'ui_campaign_10'],
    'story_dialogue': ['ui_story_ch9_intro_1', 'ui_story_ch1_s1_before_1'],
    'story_evening': ['ui_evening_tav_ch5_2', 'ui_evening_tav_ch1_2'],
    'story_chronicle': ['ui_chronicle'],
}
# Сдвиг обрезки сверху для высоких кадров (по умолчанию — умная обрезка: без тёмных полос сверху и снизу).
CROP = {}


def smart_top(im: Image.Image) -> int:
    """Окно 1920 из высокого кадра: больше всего «живых» строк (не тёмных), при равенстве — ближе к низу панели героев."""
    h = im.height
    g = im.convert('L').resize((54, h))
    rows = [sum(g.getpixel((x, y)) for x in range(54)) / 54 for y in range(h)]
    alive = [1 if r > 28 else 0 for r in rows]
    pre = [0]
    for v in alive:
        pre.append(pre[-1] + v)
    best, top = -1, (h - 1920) // 2
    for t in range(0, h - 1920 + 1, 4):
        score = pre[t + 1920] - pre[t] - abs(t - 230) * 0.05
        if score > best:
            best, top = score, t
    return top


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
        top = 0
        if h > 1920:
            top = CROP.get(name, smart_top(im))
            im = im.crop((0, top, w, top + 1920))
        size = fit(im, OUT / f'{name}.jpg')
        print(f'{name}.jpg ← {src.name} ({size // 1024} КБ){" обрезка сверху " + str(top) if h > 1920 else ""}')
    br = Path('promo/branches')
    br.mkdir(parents=True, exist_ok=True)
    for src in sorted(Path('promo/.work/branches').glob('*.png')):
        size = fit(Image.open(src).convert('RGB'), br / f'{src.stem}.jpg')
        print(f'branches/{src.stem}.jpg ({size // 1024} КБ)')


main()
