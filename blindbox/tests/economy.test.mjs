import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../',import.meta.url));
test('纯抽盒：独立概率、收藏流转、防重复和旧存档', {timeout:180000}, async()=>{
  const temp = await mkdtemp(path.join(tmpdir(),'blindbox-economy-'));
  try {
    const binary = path.join(temp, process.platform === 'win32' ? 'economy-tests.exe':'economy-tests');
    const includes = ['server/src','server/third_party/nlohmann'].map(p=>path.join(root,p));
    const sources = ['tests/economy_rules.cpp','server/src/config.cpp','server/src/economy.cpp'].map(p=>path.join(root,p));
    let compiler = process.env.CXX || (process.platform === 'win32' ? 'g++':'c++');
    let msvc = /(?:^|[\\/])cl(?:\.exe)?$/i.test(compiler);
    if (process.platform === 'win32' && !process.env.CXX) {
      try { await exec('where.exe',['g++.exe']); }
      catch { compiler='cl.exe';msvc=true; }
    }
    const args = msvc ? ['/nologo','/std:c++17','/EHsc','/utf-8','/O1',...includes.map(p=>'/I'+p),...sources,'/Fe:'+binary] :
      ['-std=c++17','-O1','-Wall','-Wextra',...includes.map(p=>'-I'+p),...sources,'-o',binary];
    await exec(compiler,args,{cwd:temp,timeout:150000,maxBuffer:1024*1024});
    const result = await exec(binary,[],{cwd:temp,timeout:10000});
    assert.match(result.stdout,/Passed \d+ drawing, collection and migration checks/);
    console.log(result.stdout.trim());
  } finally { await rm(temp,{recursive:true,force:true}); }
});
