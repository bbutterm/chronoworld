/** Background textures stay alive while any image uses them; only spare textures may be evicted. */
export type BackgroundKind = 'battle' | 'map';

interface Entry {
  kind: BackgroundKind;
  users: number;
}

/** One idle texture of each kind is enough to make a return visit cheap without growing the cache. */
export class BackgroundCache<Owner extends object> {
  private readonly entries = new Map<string, Entry>();
  private readonly owners = new WeakMap<Owner, string>();

  /** null means a permanent boot texture, which is outside this disposable cache. */
  bind(owner: Owner, kind: BackgroundKind, key: string | null): string[] {
    const previous = this.owners.get(owner);
    if (previous !== key) {
      if (previous) this.entries.get(previous)!.users--;
      this.owners.delete(owner);
      if (key) {
        const entry = this.entries.get(key) ?? { kind, users: 0 };
        entry.users++;
        this.entries.set(key, entry);
        this.owners.set(owner, key);
      }
    }
    if (key) {
      const entry = this.entries.get(key)!;
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return this.trim();
  }

  release(owner: Owner): string[] {
    const previous = this.owners.get(owner);
    if (previous) {
      this.entries.get(previous)!.users--;
      this.owners.delete(owner);
    }
    return this.trim();
  }

  private trim(): string[] {
    const spare = new Set<BackgroundKind>();
    const removed: string[] = [];
    for (const [key, entry] of [...this.entries].reverse()) {
      if (entry.users > 0) continue;
      if (!spare.has(entry.kind)) spare.add(entry.kind);
      else {
        this.entries.delete(key);
        removed.push(key);
      }
    }
    return removed;
  }
}
