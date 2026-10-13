import { type ProductData } from '../../src/core/entities/product.js';
import { ParseError, ScrapeError } from '../../src/core/errors/app-error.js';
import { type Store } from '../../src/core/ports/store.js';

export type ScriptedProduct =
  { ok: true; data: ProductData } | { ok: false; error: 'parse' | 'scrape' };

/** A store whose scrape results are scripted per canonical URL. */
export class FakeStore implements Store {
  readonly id: string;
  readonly name: string;
  readonly hosts: readonly string[];
  private readonly scripted = new Map<string, ScriptedProduct>();

  constructor(options: { id: string; name: string; hosts: readonly string[] }) {
    this.id = options.id;
    this.name = options.name;
    this.hosts = options.hosts;
  }

  matches(url: URL): boolean {
    return this.hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  }

  normalizeUrl(url: URL): URL {
    const copy = new URL(url.toString());
    copy.hash = '';
    copy.search = '';
    return copy;
  }

  extractProductId(url: URL): string {
    const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
    const last = segments.at(-1);
    if (!last) throw new ParseError(`${this.id}: no product id in url`);
    return last.replace(/\.html$/, '');
  }

  /** Script what `fetchProduct` returns for a canonical URL. */
  script(url: string, result: ScriptedProduct): void {
    this.scripted.set(this.normalizeUrl(new URL(url)).toString(), result);
  }

  async fetchProduct(url: URL): Promise<ProductData> {
    const canonical = this.normalizeUrl(url).toString();
    const result = this.scripted.get(canonical);
    if (result?.ok) return Promise.resolve(result.data);
    if (result && !result.ok) {
      if (result.error === 'parse') throw new ParseError(`${this.id}: scripted parse error`);
      throw new ScrapeError(`${this.id}: scripted scrape error`);
    }
    throw new ScrapeError(`${this.id}: no scripted response for ${canonical}`);
  }
}
