/**
 * The store contract lives in `core/ports/store.ts` so the domain can depend on
 * it without importing infrastructure. This module re-exports it for store
 * authors, alongside the data shapes they need.
 */
export type { Store, StoreRegistry, ScrapeContext } from '../core/ports/store.js';
export type { ProductData, Availability } from '../core/entities/product.js';
export { assertProductData } from '../core/entities/product.js';
export { BlockDetectedError, ParseError, UnsupportedStoreError } from '../core/errors/app-error.js';
