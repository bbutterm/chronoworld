import { setTgBack } from './telegram';

/** Один владелец Back на время жизни сцены: верхнее окно, затем исходный переход или скрытая кнопка вкладки. */
export class ModalBack {
  private readonly layers = new Set<object>();
  private closed = false;
  private current: (() => void) | null;
  private off: () => void;
  private readonly modalAction = () => {
    if (!this.closed && this.active()) this.closeTop();
  };

  constructor(private readonly fallback: (() => void) | null, private readonly closeTop: () => void, private readonly active: () => boolean) {
    this.current = fallback;
    this.off = setTgBack(fallback);
  }

  /** Отписка вызывается вместе с уничтожением слоя; закрытие старой сцены не займёт Back новой. */
  opened(layer: object): () => void {
    if (this.closed) return () => {};
    this.layers.add(layer);
    this.refresh();
    return () => {
      this.layers.delete(layer);
      this.refresh(true);
    };
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.layers.clear();
    this.off();
  }

  private refresh(closing = false): void {
    // opened разрешён в create, до RUNNING; cleanup старого неактивного экрана не занимает Back нового.
    if (this.closed || (closing && !this.active())) return;
    const next = this.layers.size ? this.modalAction : this.fallback;
    if (next === this.current) return;
    this.off();
    this.current = next;
    this.off = setTgBack(next);
  }
}
