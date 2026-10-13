import { UnsupportedStoreError, InvalidUrlError } from '../errors/app-error.js';
import { type Store, type StoreRegistry } from '../ports/store.js';

/** Resolves a URL (after short-link expansion) to the store that owns it. */
export class StoreResolver {
  constructor(private readonly registry: StoreRegistry) {}

  find(url: URL): Store | null {
    return this.registry.find(url);
  }

  resolve(url: URL): Store {
    const store = this.registry.find(url);
    if (!store) {
      throw new UnsupportedStoreError(`No store registered for host: ${url.hostname}`);
    }
    return store;
  }

  resolveUrl(raw: string): Store {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new InvalidUrlError(`Cannot parse URL: ${raw}`);
    }
    return this.resolve(url);
  }
}
