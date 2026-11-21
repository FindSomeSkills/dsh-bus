// 端到端：临时裸仓库 + 两个设备（不同 DSH_BUS_HOME），验证 send/poll/ack/heartbeat/diff/断网补送。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(ROOT, 'bin', 'dsh-bus.mjs');

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 失败：${res.stderr || res.stdout}`);
  return res.stdout;
}

function runAs(home, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_BUS_HOME: home },
  });
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    json = { raw: res.stdout, stderr: res.stderr };
  }
  return { status: res.status, json };
}

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bus-'));
  const remote = path.join(tmp, 'remote.git');
  sh('git', ['init', '--bare', '--initial-branch=main', remote]);
  const seed = path.join(tmp, 'seed');
  fs.mkdirSync(seed);
  sh('git', ['init', '--initial-branch=main', seed]);
  fs.writeFileSync(path.join(seed, 'README.md'), '# bus\n');
  sh('git', ['-C', seed, 'add', '-A']);
  sh('git', ['-C', seed, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-m', 'init']);
  sh('git', ['-C', seed, 'push', remote, 'main']);
  return {
    tmp,
    remote,
    win: { home: path.join(tmp, 'win'), device: 'win-box' },
    mac: { home: path.join(tmp, 'mac'), device: 'mac-book' },
  };
}

test('两台设备：60KB 消息、回复、回执、心跳、diff、断网补送', () => {
  const { tmp, remote, win, mac } = setup();

  for (const side of [win, mac]) {
    const init = runAs(side.home, ['init', '--repo', remote, '--device', side.device]);
    assert.equal(init.json.ok, true, JSON.stringify(init.json));
    const hb = runAs(side.home, ['heartbeat']);
    assert.equal(hb.json.ok, true, JSON.stringify(hb.json));
  }

  // 1) 60 KB 原文：字节数与 sha256 必须一致
  const payload = '```md\n' + 'A'.repeat(60 * 1024) + '\n```\n';
  const file = path.join(tmp, 'prompt.md');
  fs.writeFileSync(file, payload);
  const sent = runAs(win.home, ['send', '--to', mac.device, '--file', file]);
  assert.equal(sent.json.status, 'sent', JSON.stringify(sent.json));

  const got = runAs(mac.home, ['poll']);
  assert.equal(got.json.count, 1, JSON.stringify(got.json));
  const msg = got.json.messages[0];
  assert.equal(msg.body_bytes, Buffer.byteLength(payload));
  assert.equal(msg.body_sha256, crypto.createHash('sha256').update(payload).digest('hex'));
  assert.equal(msg.body, payload);

  // 2) 回复 + 回执
  const reply = runAs(mac.home, ['send', '--to', win.device, '--text', '收到，围栏完整', '--kind', 'reply', '--reply-to', msg.id]);
  assert.equal(reply.json.status, 'sent', JSON.stringify(reply.json));

  const back = runAs(win.home, ['poll']);
  assert.equal(back.json.count, 1, JSON.stringify(back.json));
  assert.equal(back.json.messages[0].reply_to, msg.id);

  const acked = runAs(mac.home, ['ack', msg.id]);
  assert.equal(acked.json.ok, true, JSON.stringify(acked.json));

  // 3) 心跳与 diff：改一个插件版本，diff 必须指到包名与版本
  const macBeat = path.join(mac.home, 'repo', 'state', mac.device, 'heartbeat.json');
  const beat = JSON.parse(fs.readFileSync(macBeat, 'utf8'));
  beat.profile.plugins = { ...(beat.profile.plugins ?? {}), 'dshmarket': '1.74.0', 'dsh-ops': '0.5.4' };
  fs.writeFileSync(macBeat, JSON.stringify(beat, null, 2));
  sh('git', ['-C', path.join(mac.home, 'repo'), 'add', '-A']);
  sh('git', ['-C', path.join(mac.home, 'repo'), '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-m', 'beat']);
  sh('git', ['-C', path.join(mac.home, 'repo'), 'push']);

  const winBeatPath = path.join(win.home, 'repo', 'state', win.device, 'heartbeat.json');
  const wb = JSON.parse(fs.readFileSync(winBeatPath, 'utf8'));
  wb.profile.plugins = { ...(wb.profile.plugins ?? {}), 'dshmarket': '1.74.0', 'dsh-ops': '0.5.5' };
  fs.writeFileSync(winBeatPath, JSON.stringify(wb, null, 2));

  const diff = runAs(win.home, ['diff']);
  assert.equal(diff.json.ok, true, JSON.stringify(diff.json));
  const ops = diff.json.items.find((it) => it.name === 'dsh-ops');
  assert.ok(ops, 'diff 应报出 dsh-ops');
  assert.equal(ops.local, '0.5.5');
  assert.equal(ops.peer, '0.5.4');

  // 4) 断网：把 remote 指向不存在的地址，send 必须返回 queued，恢复后 flush 补送且不重复
  const winRepo = path.join(win.home, 'repo');
  sh('git', ['-C', winRepo, 'remote', 'set-url', 'origin', path.join(tmp, 'missing.git')]);
  const queued = runAs(win.home, ['send', '--to', mac.device, '--text', '离线期间写的']);
  assert.equal(queued.json.status, 'queued', JSON.stringify(queued.json));

  sh('git', ['-C', winRepo, 'remote', 'set-url', 'origin', remote]);
  const flushed = runAs(win.home, ['flush']);
  assert.equal(flushed.json.pushed, true, JSON.stringify(flushed.json));

  const macPoll = runAs(mac.home, ['poll', '--all']);
  const offline = macPoll.json.messages.filter((m) => m.body === '离线期间写的');
  assert.equal(offline.length, 1, '补送后应只出现一次');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('附件：默认只记元数据，--attach-blob 内联小文件并能取回', () => {
  const { tmp, remote, win, mac } = setup();
  for (const side of [win, mac]) {
    assert.equal(runAs(side.home, ['init', '--repo', remote, '--device', side.device]).json.ok, true);
  }

  const small = path.join(tmp, 'note.txt');
  fs.writeFileSync(small, '配置片段：bundle 顺序 as-is');
  const smallSha = crypto.createHash('sha256').update(fs.readFileSync(small)).digest('hex');

  // 只记元数据
  const metaOnly = runAs(win.home, ['send', '--to', mac.device, '--text', '看附件', '--attach', small]);
  assert.equal(metaOnly.json.status, 'sent', JSON.stringify(metaOnly.json));
  const gotMeta = runAs(mac.home, ['poll']).json.messages[0];
  assert.equal(gotMeta.attachments[0].sha256, smallSha);
  assert.equal(gotMeta.attachments[0].blob, undefined, '默认不应内联');

  // 内联
  const withBlob = runAs(win.home, ['send', '--to', mac.device, '--text', '带文件', '--attach-blob', small]);
  assert.equal(withBlob.json.status, 'sent', JSON.stringify(withBlob.json));
  const gotBlob = runAs(mac.home, ['poll']).json.messages[0];
  assert.ok(gotBlob.attachments[0].blob, '应带内联路径');

  const out = path.join(tmp, 'restored.txt');
  const fetched = runAs(mac.home, ['get', gotBlob.id, '--out', out]);
  assert.equal(fetched.json.ok, true, JSON.stringify(fetched.json));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex'), smallSha);
  assert.equal(fs.readFileSync(out, 'utf8'), '配置片段：bundle 顺序 as-is');

  // 超过 256 KB 必须拒绝内联
  const big = path.join(tmp, 'big.bin');
  fs.writeFileSync(big, Buffer.alloc(300 * 1024, 1));
  const rejected = runAs(win.home, ['send', '--to', mac.device, '--text', 'x', '--attach-blob', big]);
  assert.equal(rejected.json.ok, false);
  assert.match(rejected.json.error, /256 KB/);

  fs.rmSync(tmp, { recursive: true, force: true });
});
