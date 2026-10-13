import { type BlockDetector } from '../core/ports/block-detector.js';
import { AmazonStore } from './amazon/index.js';
import { FlipkartStore } from './flipkart/index.js';
import { InMemoryStoreRegistry } from './registry.js';

export * from './store.interface.js';
export { BaseStore } from './base-store.js';
export { InMemoryStoreRegistry } from './registry.js';

export interface CreateStoreRegistryOptions {
  blockDetector?: BlockDetector;
}

/**
 * The single place stores are registered. Adding a new store = create its folder
 * and add one `registry.register(...)` line here.
 */
export function createStoreRegistry(
  options: CreateStoreRegistryOptions = {},
): InMemoryStoreRegistry {
  const registry = new InMemoryStoreRegistry();
  registry.register(new AmazonStore(options));
  registry.register(new FlipkartStore(options));
  return registry;
}
