/** Small reference-counted LRU. Only requested models enter this cache.
 * Shared resources remain alive while any viewer holds a lease. */
export function createModelCache({ maxEntries = 3, maxBytes = 64 * 1024 * 1024, dispose = () => {} } = {}) {
  const entries = new Map();
  let clock = 0;
  function trim() {
    const resolved = [...entries.values()].filter(e => e.value);
    let bytes = resolved.reduce((sum, e) => sum + e.bytes, 0);
    let count = resolved.length;
    for (const entry of resolved.filter(e => !e.refs).sort((a,b) => a.used-b.used)) {
      if (count <= maxEntries && bytes <= maxBytes && !entry.stale) continue;
      entries.delete(entry.key); dispose(entry.value); bytes -= entry.bytes; count--;
    }
  }
  return {
    async acquire(key, bytes, load) {
      let entry = entries.get(key);
      if (!entry) {
        entry = {key, bytes: Number(bytes) || 0, refs: 0, used: ++clock, value: null, stale: false};
        entries.set(key, entry);
        entry.promise = Promise.resolve().then(load).then(value => { entry.value=value; return value; }, error => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        });
      }
      entry.refs++; entry.used=++clock;
      let value;
      try { value=await entry.promise; }
      catch(error) { entry.refs--; throw error; }
      let released=false;
      trim();
      return {value, release() { if(released)return; released=true; entry.refs--; entry.used=++clock; trim(); }};
    },
    invalidate(key) {
      const entry=entries.get(key); if(!entry)return;
      entry.stale=true;
      // Never evict resources used by another viewer. A new version has a new key.
      trim();
    },
    get size() { return entries.size; }
  };
}
