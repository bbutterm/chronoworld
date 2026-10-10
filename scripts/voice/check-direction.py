"""Проверка режиссёрской разметки озвучки: scripts/voice/direction/<файл>.json — реплика → она же с пометками [..].
Без пометок слова должны совпасть с ключом (пунктуацию можно усилить: «.» → «!», слова — нет).
    python3 scripts/voice/check-direction.py scripts/voice/direction/chapter2.json
"""
import json
import re
import sys

bad = 0
d = json.load(open(sys.argv[1], encoding='utf8'))
for k, v in d.items():
    if k.startswith('$'):
        continue
    # Сравниваем слова: пунктуацию разметка может усилить («!» вместо «.»), слова — нет.
    words = lambda s: re.findall(r'[а-яёa-z0-9-]+', s.lower().replace('ё', 'е'))
    if words(re.sub(r'\[[^\]]*\]', ' ', v)) != words(k):
        bad += 1
        print('НЕ СОВПАДАЕТ:\n  ключ:  ', k, '\n  разметка:', v)
print(f'{len(d)} записей, ошибок {bad}')
sys.exit(1 if bad else 0)
