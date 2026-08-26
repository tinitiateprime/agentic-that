export class InProcessBackgroundJobs {
  private readonly active = new Map<string, Promise<void>>();

  start(key: string, operation: () => Promise<unknown>, onError: (error: unknown) => void = () => {}) {
    if (this.active.has(key)) return false;

    const task = Promise.resolve()
      .then(operation)
      .then(() => undefined)
      .catch((error) => {
        try {
          onError(error);
        } catch {
          // Operational logging must never turn a handled background failure
          // into an unhandled promise rejection.
        }
      })
      .finally(() => {
        if (this.active.get(key) === task) this.active.delete(key);
      });
    this.active.set(key, task);
    return true;
  }

  has(key: string) {
    return this.active.has(key);
  }

  get size() {
    return this.active.size;
  }
}
