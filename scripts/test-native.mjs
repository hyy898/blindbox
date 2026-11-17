import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNative, devBinary } from '../blindbox/scripts/native.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const tests = { saves: 'tests/saves-integration.py', session: 'blindbox/server/tests/session_test.py', api: 'tests/server-integration.py' };
const script = tests[process.argv[2]];
if (!script) throw new Error('请选择 saves、session 或 api。');
const result = await buildNative({ development: true });
if (result.code !== 0) process.exit(result.code);
const child = spawn(process.platform === 'win32' ? 'python' : 'python3', [resolve(root, script), devBinary], { cwd: root, stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
