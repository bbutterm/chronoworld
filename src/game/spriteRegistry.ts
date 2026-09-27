/**
 * Есть ли лист спрайта в реестре — для чистых помощников (flow.ts heroSprite, storyView), которые не тянут Phaser и
 * import.meta.glob (их читают и Node-скрипты). Реестр подключает src/game/sprites.ts при загрузке модуля
 * (setSpriteLookup); без него (Node, тесты) листов-вариантов нет — берётся базовый лист.
 */
let lookup: (id: string) => boolean = () => false;

export const hasSprite = (id: string): boolean => lookup(id);

export function setSpriteLookup(fn: (id: string) => boolean): void {
  lookup = fn;
}
