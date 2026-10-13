import { UnsupportedStoreError, ValidationError } from '../core/errors/app-error.js';
import { type Store, type StoreRegistry } from '../core/ports/store.js';

/** In-memory store registry; the single place stores are resolved from. */
export class InMemoryStoreRegistry implements StoreRegistry {
  private readonly stores: Store[] = [];

  register(store: Store): void {
    if (this.stores.some((existing) => existing.id === store.id)) {
      throw new ValidationError(`Duplicate store id registered: ${store.id}`);
    }
    this.stores.push(store);
  }

  find(url: URL): Store | null {
    return this.stores.find((store) => store.matches(url)) ?? null;
  }

  resolve(url: URL): Store {
    const store = this.find(url);
    if (!store) {
      throw new UnsupportedStoreError(`No store registered for host: ${url.hostname}`);
    }
    return store;
  }

  list(): readonly Store[] {
    return [...this.stores];
  }
}
