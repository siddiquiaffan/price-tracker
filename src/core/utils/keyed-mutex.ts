/**
 * Serialises async work per key within a single process, so e.g. two concurrent
 * price checks for the same product cannot both notify.
 */
export class KeyedMutex {
  private readonly locks = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();

    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.locks.set(key, tail);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}
