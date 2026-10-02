// Share simultaneous reads only. Completed values are never cached, and each
// caller receives its own copy so reconciliation cannot mutate another read.
export function inFlightSnapshotReader(read) {
  const pending = new Map();
  return {
    async read(key) {
      let request = pending.get(key);
      if (!request) {
        request = Promise.resolve().then(() => read(key));
        pending.set(key, request);
      }
      try {
        return structuredClone(await request);
      } finally {
        if (pending.get(key) === request) pending.delete(key);
      }
    },
    invalidate(key) {
      pending.delete(key);
    },
  };
}
