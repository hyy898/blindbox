// 一页一条服务器连接；浏览器后台页不依赖定时器，刷新可在宽限期内重连。
export function startBrowserSession(base, { window: page = globalThis.window, EventSource: Source = globalThis.EventSource } = {}) {
  if (!page || !Source) return () => {};
  const endpoint = new URL('api/session', base.endsWith('/') ? base : `${base}/`).href;
  let connection = null;
  const connect = () => { if (!connection) connection = new Source(endpoint); };
  const disconnect = () => { connection?.close(); connection = null; };
  page.addEventListener('pagehide', disconnect);
  page.addEventListener('pageshow', connect);
  connect();
  return () => {
    disconnect();
    page.removeEventListener('pagehide', disconnect);
    page.removeEventListener('pageshow', connect);
  };
}
