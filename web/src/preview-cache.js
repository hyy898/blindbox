// 预览只串行生成，同款共享任务；离开页面后尚未开始的任务可直接丢弃。
export function createPreviewCache({ load, dispose = () => {}, maxEntries = 48 }) {
  const entries = new Map(), queue = [];
  let running = false, clock = 0;
  const notify = (entry, result) => {
    for (const listener of [...entry.listeners]) {
      try { listener(result); } catch { /* One removed card must not stop the queue. */ }
    }
  };
  function trim() {
    const ready = [...entries.values()].filter(entry => entry.url);
    for (const entry of ready.filter(entry => !entry.listeners.size).sort((a, b) => a.used - b.used)) {
      if (entries.size <= maxEntries) break;
      entries.delete(entry.key);
      dispose(entry.url);
    }
  }
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const entry = queue.shift();
        if (!entry.listeners.size) { entries.delete(entry.key); continue; }
        try {
          entry.url = await load(entry.source, entry.key);
          entry.used = ++clock;
          notify(entry, { ok: true, url: entry.url });
        } catch {
          entries.delete(entry.key);
          notify(entry, { ok: false });
        }
        trim();
      }
    } finally { running = false; }
  }
  return {
    subscribe(key, source, listener) {
      let entry = entries.get(key);
      if (!entry) {
        entry = { key, source, listeners: new Set(), used: ++clock, url: null };
        entries.set(key, entry);
        queue.push(entry);
      }
      entry.used = ++clock;
      entry.listeners.add(listener);
      if (entry.url) queueMicrotask(() => {
        if (entry.listeners.has(listener)) listener({ ok: true, url: entry.url });
      });
      else queueMicrotask(() => { void drain(); });
      return () => { entry.listeners.delete(listener); trim(); };
    }
  };
}
