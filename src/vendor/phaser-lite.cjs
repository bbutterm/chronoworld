/**
 * Сборка Phaser для игры: то же, что `phaser/src/phaser.js`, но без физики (Arcade, Matter), тайловых карт и плагинов
 * Camera3D / Facebook Instant — игра их не использует. Все игровые объекты (частицы, NineSlice, BitmapText, RenderTexture…),
 * звук, рендер WebGL и запасной Canvas — на месте, так что экраны и эффекты работают как с полным Phaser.
 *
 * Подключается алиасом `phaser` → этот файл в vite.config.ts (сборка и dev-сервер); типы — по-прежнему из пакета phaser.
 * Флаги сборки Phaser (`typeof WEBGL_RENDERER` и т. п.) подставляет плагин `phaserFlags` там же.
 * Что вырезано, проверяет tests/phaser-lite.test.ts: если экран начнёт использовать `Phaser.Physics` / `Phaser.Tilemaps` /
 * `this.physics` / `add.tilemap`, тест упадёт — тогда вернуть модуль сюда.
 */

require('phaser/src/polyfills/requestVideoFrame');

var CONST = require('phaser/src/const');
var Extend = require('phaser/src/utils/object/Extend');

var Phaser = {
    Actions: require('phaser/src/actions'),
    Animations: require('phaser/src/animations'),
    BlendModes: require('phaser/src/renderer/BlendModes'),
    Cache: require('phaser/src/cache'),
    Cameras: require('phaser/src/cameras'),
    Core: require('phaser/src/core'),
    Class: require('phaser/src/utils/Class'),
    Create: require('phaser/src/create'),
    Curves: require('phaser/src/curves'),
    Data: require('phaser/src/data'),
    Display: require('phaser/src/display'),
    DOM: require('phaser/src/dom'),
    Events: require('phaser/src/events'),
    FX: require('phaser/src/fx'),
    Game: require('phaser/src/core/Game'),
    GameObjects: require('phaser/src/gameobjects'),
    Geom: require('phaser/src/geom'),
    Input: require('phaser/src/input'),
    Loader: require('phaser/src/loader'),
    Math: require('phaser/src/math'),
    Plugins: require('phaser/src/plugins'),
    Renderer: require('phaser/src/renderer'),
    Scale: require('phaser/src/scale'),
    ScaleModes: require('phaser/src/renderer/ScaleModes'),
    Scene: require('phaser/src/scene/Scene'),
    Scenes: require('phaser/src/scene'),
    Sound: require('phaser/src/sound'),
    Structs: require('phaser/src/structs'),
    Textures: require('phaser/src/textures'),
    Time: require('phaser/src/time'),
    Tweens: require('phaser/src/tweens'),
    Utils: require('phaser/src/utils')
};

Phaser = Extend(false, Phaser, CONST);

module.exports = Phaser;
