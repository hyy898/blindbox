#!/usr/bin/env python3
"""macOS 启动流程回归：在临时游戏包中修改配置，不触碰实际存档。
运行：python3 server/tests/launcher_test.py
需要 macOS C++ 命令行工具；Windows 流程需在 Windows 单独验证。
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(package, env=None):
    result = subprocess.run(
        ['/bin/bash', str(package / '启动游戏.command'), '--check-config'],
        input='', text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        timeout=180, env=env,
    )
    return result


def check(name, condition, details=''):
    if not condition:
        raise AssertionError(f'{name}\n{details}')
    print('PASS', name, flush=True)


def api(base, path, body=None):
    request = urllib.request.Request(
        base + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)


def serve(package, port, log_path, env):
    log = log_path.open('w')
    process = subprocess.Popen(
        ['/bin/bash', str(package / '启动游戏.command'), '--port', str(port)],
        stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, env=env,
        start_new_session=True,
    )
    try:
        for _ in range(1800):
            output = log_path.read_text()
            match = re.search(r'开盲盒服务器已启动\s+(http://127\.0\.0\.1:\d+/)', output)
            if match:
                base = match.group(1)
                api(base, 'api/health')
                return process, log, base, output
            if process.poll() is not None:
                raise AssertionError(f'启动失败\n{output}')
            time.sleep(.1)
        raise AssertionError(f'启动超时\n{log_path.read_text()}')
    except BaseException:
        stop(process)
        log.close()
        raise


def stop(process):
    import signal
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    process.wait(timeout=10)


def main():
    if platform.system() != 'Darwin':
        raise SystemExit('此测试验证 macOS .command；请在 macOS 运行。')
    with tempfile.TemporaryDirectory(prefix='blindbox 启动测试 ') as directory:
        temp = Path(directory)
        package = temp / '带空格的游戏包'
        shutil.copytree(ROOT, package, ignore=shutil.ignore_patterns('data', '.DS_Store', '__pycache__'))
        source = package / 'server/src/game_config.cpp'
        original = source.read_text()
        binary = package / ('blindbox-server-mac-arm64' if platform.machine() == 'arm64' else 'blindbox-server-mac-x64')
        check('启动器自动准备当前配置', (r := run(package)).returncode == 0, r.stdout)
        first_mtime = binary.stat().st_mtime_ns
        check('未修改源码时跳过编译', (r := run(package)).returncode == 0 and
              '源码没有变化' in r.stdout and binary.stat().st_mtime_ns == first_mtime, r.stdout)

        added = '''
        {"launcher-test", "自动导入测试", 100, 1.0, {
            {"lt-01", "测试普通", "common", "自动编译", 1.0, ""},
            {"lt-02", "测试稀有", "rare", "自动编译", 1.0, ""},
            {"lt-03", "测试史诗", "epic", "自动编译", 1.0, ""},
            {"lt-04", "测试隐藏", "secret", "自动编译", 1.0, ""},
        }},
'''
        marker = '\n    };\n\n    return cfg;'
        check('找到配置插入位置', marker in original)
        changed = original.replace(marker, added + marker)
        times = source.stat()
        source.write_text(changed)
        os.utime(source, ns=(times.st_atime_ns, times.st_mtime_ns))
        r = run(package)
        check('新增整种盲盒且保留旧时间戳仍能自动编译', r.returncode == 0, r.stdout)
        check('只重编 game_config.cpp', r.stdout.count('编译 src/') == 1 and '编译 src/game_config.cpp' in r.stdout, r.stdout)
        exported = json.loads(subprocess.check_output([str(binary), '--dump-config'], text=True))
        check('启动器运行的程序包含新增盲盒', any(s['id'] == 'launcher-test' for s in exported['series']))
        good_hash = digest(binary)

        source.write_text(changed + '\nTHIS_IS_NOT_VALID_CPP\n')
        r = run(package)
        check('C++ 语法错误时停止且保留可用程序', r.returncode != 0 and digest(binary) == good_hash and '正在启动开盲盒' not in r.stdout, r.stdout)
        source.write_text(re.sub(r'cfg\.economy\.startCoins\s*=\s*\d+;', 'cfg.economy.startCoins = -1;', changed))
        r = run(package)
        check('配置校验错误时停止且保留可用程序', r.returncode != 0 and digest(binary) == good_hash and '[配置错误]' in r.stdout, r.stdout)
        source.write_text(changed)
        env = dict(os.environ, CC='missing-blindbox-cc', CXX='missing-blindbox-cxx')
        r = run(package, env)
        check('缺编译器时明确报错且不启动旧版', r.returncode != 0 and '需要 C/C++ 编译器' in r.stdout and digest(binary) == good_hash, r.stdout)
        source.write_text(original)
        check('修正配置后可以再次启动', (r := run(package)).returncode == 0, r.stdout)

        # 避免自动打开测试浏览器；实际服务仍然通过完整 .command 流程启动。
        shim = temp / 'bin'
        shim.mkdir()
        (shim / 'open').write_text('#!/bin/sh\nexit 0\n')
        (shim / 'open').chmod(0o755)
        env = dict(os.environ, PATH=str(shim) + os.pathsep + os.environ['PATH'])
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        processes, logs = [], []
        try:
            p, log, base, output = serve(package, port, temp / 'first.log', env)
            processes.append(p); logs.append(log)
            cfg = api(base, 'api/config')
            check('实际网页接口读到奶蛙一家', any(s['id'] == 'milk-frog' for s in cfg['series']))
            check('网页目录和默认存档指向游戏根目录', str(package / 'data/blindbox-save.db') in output)
            api(base, 'api/open', {'seriesId': cfg['series'][0]['id']})
            before = api(base, 'api/storage', {})['state']
            source.write_text(changed)
            p2, log2, base2, output2 = serve(package, port, temp / 'second.log', env)
            processes.append(p2); logs.append(log2)
            cfg2 = api(base2, 'api/config')
            after = api(base2, 'api/state')['state']
            check('再次双击自动引入新盲盒到接口', any(s['id'] == 'launcher-test' for s in cfg2['series']))
            check('新增盲盒保留金币与仓库存档', before == after)
            try:
                p.wait(timeout=5)
                print('PASS 再次启动关闭本游戏包的旧服务', flush=True)
            except subprocess.TimeoutExpired:
                raise AssertionError('再次启动未能关闭旧服务；请检查 lsof 权限。')
        finally:
            for p in processes: stop(p)
            for log in logs: log.close()

        release = temp / '纯试玩包'
        release.mkdir()
        shutil.copy2(binary, release / binary.name)
        shutil.copy2(package / '启动游戏.command', release / '启动游戏.command')
        r = run(release)
        check('不含源码的试玩包仍可启动', r.returncode == 0, r.stdout)
    print('启动流程验证完成。', flush=True)


if __name__ == '__main__':
    main()
