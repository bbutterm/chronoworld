import type Phaser from 'phaser';

/** Стабильный признак слоя: имя может исчезнуть в анимации закрытия. */
export const MODAL_DATA = 'screenModal';

/** Тот же порядок DisplayList, которым Back выбирает верхнее окно. */
export function topModal(scene: Phaser.Scene): Phaser.GameObjects.GameObject | undefined {
  const list = scene.children.list;
  for (let i = list.length - 1; i >= 0; i--) {
    const node = list[i];
    if (node.scene === scene && node.getData(MODAL_DATA)) return node;
  }
  return undefined;
}

/** Только содержимое верхнего открытого окна принимает ввод; locked остаётся правилом владельца списка. */
export function modalInputAllowed(scene: Phaser.Scene, content: Phaser.GameObjects.Container): boolean {
  if (content.scene !== scene) return false;
  const modal = topModal(scene);
  if (!modal) return true;
  if (modal.getData('closing')) return false;
  for (let node: Phaser.GameObjects.GameObject | null = content; node; node = node.parentContainer) {
    if (node === modal) return true;
  }
  return false;
}
