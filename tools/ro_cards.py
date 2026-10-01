#!/usr/bin/env python3
"""Рисунки карт RO: raw/ro/texture/cardbmp/*.bmp (300x400, партия 01.10) -> assets/ui/cards/<id>.webp (180x240, WebP q85).

    python3 tools/ro_cards.py

Имя файла: карты MVP охоты — id карты (card_<mvp>, data/hunt.json -> cards), карты Башни — id благословения
(data/tower.json -> run.blessings). Карта Башни того же монстра, что MVP (Осирис, Лунный цветок, Бафомет, Мистресс,
Тёмный лорд), берёт рисунок card_<id> — src/game/cardArt.ts. Соответствие RO -> файл — по note манифеста
(raw/ro/manifest.csv, группа card). Рисунки грузятся по требованию (не на экране загрузки), поэтому сразу WebP с
потерями: ~10-15 КБ на карту.
"""
import csv, os
from PIL import Image
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# note (RO card name) -> our file id: MVP cards card_<mvp>, Tower cards <tower id>; Tower cards of MVPs reuse card_<mvp>.
MAP = {
    'Mastering Card': 'card_mastering', 'Osiris Card': 'card_osiris', 'Moonlight Flower Card': 'card_moonlight',
    'Orc Lord Card': 'card_orc_lord', 'Mistress Card': 'card_mistress', 'Dark Lord Card': 'card_dark_lord',
    'Baphomet Card': 'card_baphomet', 'Pharaoh Card': 'card_pharaoh',
    'Eddga Card': 'card_eddga', 'Dracula Card': 'card_dracula', 'Maya Card': 'card_maya',
    'Turtle General Card': 'card_turtle_general', 'Amon Ra Card': 'card_amon_ra', 'Doppelganger Card': 'card_doppelganger',
    'Poring Card': 'poring', 'Pupa Card': 'pupa', 'Hunter Fly Card': 'hunter_fly', 'Orc Warrior Card': 'orc_warrior',
    'Mandragora Card': 'mandragora', 'Mantis Card': 'mantis', 'Fabre Card': 'fabre', 'Rocker Card': 'rocker',
    'Drops Card': 'drops', 'Marin Card': 'marin', 'Poporing Card': 'poporing', 'Thief Bug Card': 'thief_bug',
    'Steel Chonchon Card': 'chonchon', 'High Orc Card': 'high_orc', 'Angeling Card': 'angeling',
    'Archangeling Card': 'archangeling', 'Bapho Jr. Card': 'baphomet_jr', 'Deviruchi Card': 'deviruchi',
    'Vagabond Wolf Card': 'wolf', 'Whisper Card': 'whisper', 'Rideword Card': 'rideword', 'Orc Hero Card': 'orc_hero',
    'Golden Thief Bug Card': 'golden_bug', 'Drake Card': 'drake',
}
SIZE = (180, 240)
os.makedirs('assets/ui/cards', exist_ok=True)
total = 0
prov = {}
for r in csv.DictReader(open('raw/ro/manifest.csv', encoding='utf-8')):
    if r['group'] != 'card':
        continue
    name, _, num = r['note'].rpartition(' ')
    our = MAP[name]
    im = Image.open(r['output']).convert('RGB')
    assert im.size == (300, 400), im.size
    out = f'assets/ui/cards/{our}.webp'
    im.resize(SIZE, Image.LANCZOS).save(out, 'WEBP', quality=85, method=6)
    sz = os.path.getsize(out)
    total += sz
    prov[our] = dict(card=name, cardId=int(num), source=r['source'], sha256=r['sha256'])
    print(our, sz)
print('total', total, len(prov))
