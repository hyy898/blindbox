#!/usr/bin/env python3
"""网页关闭后自动退出的集成测试。只使用临时数据库，不打开真实浏览器。
python3 server/tests/session_test.py [可执行文件]
"""
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ('blindbox-server.exe' if os.name == 'nt' else
           'blindbox-server-mac-arm64' if platform.system() == 'Darwin' and platform.machine() == 'arm64' else
           'blindbox-server-mac-x64' if platform.system() == 'Darwin' else 'server/blindbox-server')
EXE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / DEFAULT


def check(name, condition):
    assert condition, name
    print('PASS', name, flush=True)


def request(port, path, body=None):
    req = urllib.request.Request('http://127.0.0.1:' + str(port) + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=5) as res:
        return json.loads(res.read()) if res.status != 204 else res.status


def start(temp, automatic=True):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    args = [str(EXE), '--port', str(port), '--web', str(ROOT), '--db', str(temp / 'save.db'),
            '--models', str(temp / 'models')]
    if automatic: args.append('--exit-on-close')
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(100):
            if proc.poll() is not None: raise AssertionError(proc.stdout.read())
            try:
                request(port, '/api/health')
                return proc, port
            except OSError:
                time.sleep(.05)
        raise AssertionError('服务器启动超时')
    except BaseException:
        proc.terminate(); proc.wait(5)
        raise


def page(port):
    # 模拟 EventSource。客户端不发任何 JavaScript 定时心跳，后台页也应持续有效。
    sock = socket.create_connection(('127.0.0.1', port), timeout=3)
    sock.sendall(b'GET /api/session HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n')
    response = b''
    while b'data: connected' not in response:
        data = sock.recv(4096)
        if not data: raise AssertionError(response)
        response += data
    assert b'200 OK' in response and b'text/event-stream' in response, response
    return sock


def close(sock):
    try: sock.shutdown(socket.SHUT_RDWR)
    except OSError: pass
    sock.close()


def main():
    with tempfile.TemporaryDirectory(prefix='blindbox-session-') as directory:
        temp = Path(directory)
        proc, port = start(temp)
        pages = []
        try:
            first, second = page(port), page(port)
            pages += [first, second]
            cfg = request(port, '/api/config')
            before = request(port, '/api/state')['state']
            check('初始金币读取最新配置', before['coins'] == cfg['economy']['startCoins'])
            request(port, '/api/open', {'seriesId': cfg['series'][0]['id']})
            saved = request(port, '/api/storage', {})['state']
            close(first); pages.remove(first)
            time.sleep(6)
            check('关闭一个标签页不会退出其余页面', proc.poll() is None and request(port, '/api/health')['ok'])
            close(second); pages.remove(second)
            time.sleep(1)
            refreshed = page(port); pages.append(refreshed)
            time.sleep(6)
            check('刷新宽限内重新连接不会退出', proc.poll() is None)
            check('没有网页定时器也保持连接，支持后台页', request(port, '/api/health')['ok'])
            close(refreshed); pages.remove(refreshed)
            check('最后一个网页关闭后自动正常退出', proc.wait(timeout=12) == 0)
            output = proc.stdout.read()
            check('自动退出有明确提示', '游戏网页已全部关闭' in output)
        finally:
            for sock in pages: close(sock)
            if proc.poll() is None: proc.terminate()
            proc.wait(5)

        proc, port = start(temp, automatic=False)
        try:
            check('普通服务器模式不启用自动退出', request(port, '/api/session') == 204)
            check('退出后重新打开保留游戏存档', request(port, '/api/state')['state'] == saved)
            time.sleep(6)
            check('不带退出参数时服务器保持常驻', proc.poll() is None and request(port, '/api/health')['ok'])
        finally:
            proc.terminate(); proc.wait(5)
    print('网页退出流程验证完成。', flush=True)


if __name__ == '__main__': main()
