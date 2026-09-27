/**
 * Что грузит экран загрузки (BootScene) — общее для игры (src/game/assets.ts) и сборки (vite.config.ts собирает
 * эти файлы в один «пакет загрузки», см. docs/content/performance.md, «Загрузка»). Без Phaser и DOM.
 */

/**
 * T4-12. id манифеста, которые при скине не показываются: скин рисует свои фон боя и баннеры итога (buildSkin),
 * а эти картинки — запасные на случай, если скина нет. Фон арены 1080×1920 — 7.9 МБ видеопамяти впустую.
 */
export const SKIN_REPLACED: ReadonlySet<string> = new Set(['bg_arena', 'ui_victory', 'ui_defeat']);
