// 一页一条连接：关闭最后一页后，启动器会自动结束。
// SSE 由浏览器维持，后台标签页无需靠 JavaScript 定时器续期。
(() => {
  const configured = new URLSearchParams(location.search).get('server');
  if (location.protocol === 'file:' && !configured) return;
  let endpoint;
  try {
    const base = configured || new URL('./', location.href).href;
    endpoint = new URL('api/session', base.endsWith('/') ? base : base + '/');
  } catch { return; }
  let connection = null;
  function connect() {
    if (!connection) connection = new EventSource(endpoint.href);
  }
  window.addEventListener('pagehide', () => {
    if (connection) connection.close();
    connection = null;
  });
  // 支持浏览器后退时从页面缓存恢复。
  window.addEventListener('pageshow', connect);
  connect();
})();
