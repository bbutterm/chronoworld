import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Итерация 9C полировки (docs/design/ui-polish-research.md §3, §5 «Друзья», «Летопись», «Сюжетные страницы»):
 * друзья и рекорды, Летопись, вечера в таверне, страницы сюжета и диалог — сегменты и строки списков вместо
 * кнопок-вкладок и простыней текста, ноль строк-инструкций, заголовочная гарнитура у заголовков.
 * Сцены тянут Phaser — проверяем исходники (как game-ascend-inventory.test.ts).
 */

const SRC = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', 'game', f), 'utf8');
const friends = SRC('scenes/FriendsScene.ts');
const chronicle = SRC('scenes/ChronicleScene.ts');
const evening = SRC('scenes/TavernEveningScene.ts');
const page = SRC('storyPage.ts');
const dialogue = SRC('dialogue.ts');
const heroStory = SRC('heroStoryView.ts');
const lore = SRC('loreView.ts');

/** Строки-инструкции (§3 п. 3). */
const INSTRUCTION = /Нажмите|нажмите|Коснитесь|коснитесь|, чтобы /;
/** Старые кнопки-текстуры Kenney (бежевые/коричневые «вкладки»). */
const KENNEY = /'k:buttonLong_/;

describe('друзья и рекорды (FriendsScene)', () => {
  it('вкладки и доски — segmented, строки — listRow, без старых кнопок-вкладок', () => {
    expect(friends).toMatch(/segmented\(this, GAME_W \/ 2, ty, CW, TABS/);
    expect(friends).toMatch(/segmented\(this, GAME_W \/ 2, y \+ TOUCH_COMFORT \/ 2, CW, kinds/);
    expect(friends).toMatch(/listRow\(/);
    expect(friends).not.toMatch(KENNEY);
    expect(friends).not.toMatch(INSTRUCTION);
  });

  it('«Позвать друга» — главная кнопка только в пустом списке; в списке — строка', () => {
    const primary = friends.match(/'ui_btn_primary'/g) ?? [];
    // «Забрать» колокольчики и «Позвать друга» в пустом списке (одновременно не бывают: колокольчики шлют друзья).
    expect(primary).toHaveLength(2);
    expect(friends).toMatch(/'ui_btn_primary', 'Позвать друга'/);
    expect(friends).toMatch(/title: 'Позвать друга'/);
  });

  it('вне Telegram — карточка с иллюстрацией и кнопкой бота, а не строка посреди леса', () => {
    expect(friends).toMatch(/'Друзья живут в Telegram'/);
    expect(friends).toMatch(/'Открыть в Telegram'/);
    expect(friends).not.toMatch(/emptyState\(/);
  });

  it('места 1–3 — медали, своя строка подсвечена, «Ваше место» внизу', () => {
    expect(friends).toMatch(/const MEDAL = \[/);
    expect(friends).toMatch(/boardMeRow/);
    expect(friends).toMatch(/setName\('myPlace'\)/);
  });
});

describe('Летопись (ChronicleScene, loreView, heroStoryView)', () => {
  it('вкладки — segmented; без тостов-инструкций и «нажмите на героя»', () => {
    expect(chronicle).toMatch(/segmented\(this/);
    expect(chronicle).not.toMatch(INSTRUCTION);
    expect(chronicle).not.toMatch(/нажмите на героя/);
    expect(chronicle).not.toMatch(/toast\(/);
    expect(chronicle).not.toMatch(KENNEY);
  });

  it('записи — строки и листы снизу; закрытые монстры — силуэт с «?»', () => {
    expect(chronicle).toMatch(/listRow\(/);
    expect(chronicle).toMatch(/bottomSheet\(/);
    expect(chronicle).toMatch(/setTint\(0x000000\)/);
    expect(chronicle).toMatch(/questionMark\(this\)/);
  });

  it('новое — тихая золотая точка, а не красная', () => {
    expect(chronicle).toMatch(/goldDot\(/);
    expect(chronicle).not.toMatch(/TINT\.badge/);
    expect(heroStory).not.toMatch(/TINT\.badge/);
    expect(lore).not.toMatch(/TINT\.badge/);
  });

  it('история героя: заголовки заголовочной гарнитурой, тексты для e2e на месте', () => {
    expect(heroStory).toMatch(/FAMILY\.heading/);
    expect(heroStory).toMatch(/'ИСТОРИЯ ГЕРОЯ'/);
    expect(heroStory).toMatch(/`Открыто \$\{progress\.open\} из/);
    expect(heroStory).toMatch(/'Закрыть'/);
    expect(heroStory).not.toMatch(/листайте/);
  });
});

describe('вечера в таверне (TavernEveningScene)', () => {
  it('без «· коснитесь ›»: счётчик реплик — как в сюжете', () => {
    expect(evening).not.toMatch(INSTRUCTION);
    expect(evening).toMatch(/dialogueCounter\(/);
    expect(evening).not.toMatch(KENNEY);
  });

  it('близость — чип с сердцем, а не тост; правила — за «i»', () => {
    expect(evening).toMatch(/heartPop\(/);
    expect(evening).not.toMatch(/близость \+\$\{d\}`/);
    expect(evening).toMatch(/infoButton\(/);
  });

  it('вечера — строки с медальоном главы, «Слушать» — только у нового', () => {
    expect(evening).toMatch(/fresh \? 'Слушать' : '↺'/);
    expect(evening).toMatch(/evening_\$\{e\.id\}/);
  });
});

describe('страницы сюжета и диалог (storyPage, dialogue)', () => {
  it('заголовок страницы — заголовочная гарнитура, текст — T.body с межстрочным 1.4', () => {
    expect(page).toMatch(/T\.display, C\.title, \{ fontFamily: FAMILY\.heading/);
    expect(page).toMatch(/const BODY_FS = T\.body/);
    expect(page).not.toMatch(KENNEY);
    expect(page).not.toMatch(/листайте/);
  });

  it('диалог: имя заголовочной гарнитурой, тихий счётчик, без бежевой кнопки', () => {
    expect(dialogue).toMatch(/export function speakerName/);
    expect(dialogue).toMatch(/fontFamily: FAMILY\.heading/);
    expect(dialogue).toMatch(/export function counterText/);
    expect(dialogue).not.toMatch(KENNEY);
  });
});
