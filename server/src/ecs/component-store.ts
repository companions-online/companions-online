import { ComponentBit } from '@shared/components.js';

export class ComponentStore<T> {
  private data = new Map<number, T>();
  private readonly mask: number;

  constructor(
    bit: ComponentBit,
    private dirtyMap: Map<number, number>,
  ) {
    this.mask = 1 << bit;
  }

  get(id: number): T | undefined {
    return this.data.get(id);
  }

  set(id: number, value: T): void {
    this.data.set(id, value);
    this.dirtyMap.set(id, (this.dirtyMap.get(id) ?? 0) | this.mask);
  }

  has(id: number): boolean {
    return this.data.has(id);
  }

  delete(id: number): boolean {
    return this.data.delete(id);
  }

  [Symbol.iterator](): MapIterator<[number, T]> {
    return this.data.entries();
  }
}
