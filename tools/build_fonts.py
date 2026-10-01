# Сборка шрифтов игры (assets/fonts): Rubik 500/700 из вариативного, Philosopher Bold — подмножество латиница+кириллица, woff2.
# Исходники TTF — github.com/google/fonts (OFL). Нужен fontTools: pip install fonttools brotli. Итог — tools/out/*.woff2.
import os
import sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'py'))
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

UNI = "U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+0401-045F,U+0490-0491,U+2000-206F,U+20BD,U+20AC,U+2116,U+2122,U+2190-2193,U+2212,U+2215"
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)


def sub(font, out):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['kern', 'liga', 'calt', 'locl', 'tnum', 'lnum', 'case', 'mark', 'mkmk', 'ccmp']
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.notdef_outline = True
    opts.hinting = False
    s = subset.Subsetter(opts)
    s.populate(unicodes=subset.parse_unicodes(UNI))
    s.subset(font)
    font.flavor = 'woff2'
    font.save(os.path.join(OUT, out))


for w in (500, 700):
    vf = TTFont(os.path.join(HERE, 'Rubik.ttf'))
    f = instancer.instantiateVariableFont(vf, {'wght': w}, updateFontNames=False)
    sub(f, f'rubik-{w}.woff2')
sub(TTFont(os.path.join(HERE, 'Philosopher-Bold.ttf')), 'philosopher-700.woff2')
