import test from 'node:test';
import assert from 'node:assert/strict';
import { startBrowserSession } from '../web/src/session.js';

test('one SSE per page survives backgrounding and reconnects after page-cache restoration', () => {
  const page = new EventTarget(), connections = [];
  class Source {
    constructor(url) { this.url = url; this.closed = false; connections.push(this); }
    close() { this.closed = true; }
  }
  const dispose = startBrowserSession('http://127.0.0.1:8765/', { window: page, EventSource: Source });
  assert.equal(connections[0].url, 'http://127.0.0.1:8765/api/session');
  page.dispatchEvent(new Event('pageshow'));
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(connections.length, 1);
  assert.equal(connections[0].closed, false);
  page.dispatchEvent(new Event('pagehide'));
  assert.equal(connections[0].closed, true);
  page.dispatchEvent(new Event('pageshow'));
  assert.equal(connections.length, 2);
  assert.equal(connections[1].closed, false);
  dispose();
  assert.equal(connections[1].closed, true);
  page.dispatchEvent(new Event('pageshow'));
  assert.equal(connections.length, 2);
});
