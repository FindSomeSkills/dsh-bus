// 传输层：GitHub 仓库。所有读写都落在 repo 目录里，换传输（HTTP/局域网）只需替换本文件。
import fs from 'node:fs';
import path from 'node:path';
import { buildMessage, messagePath, validateMessage } from './message.mjs';
import * as git from './git.mjs';

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => path.join(dir, n));
}

function readAll(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeMessage(repo, msg) {
  const rel = messagePath(msg);
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(msg, null, 2) + '\n');
  return rel;
}

export function readIncoming(repo, device, { all = false } = {}) {
  const out = [];
  const busDir = path.join(repo, 'bus');
  if (!fs.existsSync(busDir)) return out;
  for (const sender of fs.readdirSync(busDir)) {
    if (sender === device) continue;
    for (const file of listJson(path.join(busDir, sender))) {
      const msg = readAll(file);
      if (!msg) continue;
      if (msg.to !== device && msg.to !== '*') continue;
      out.push({ ...msg, _file: path.relative(repo, file).split(path.sep).join('/') });
    }
  }
  return out;
}

export function writeAck(repo, { device, messageId, to }) {
  const rel = `ack/${device}/${messageId}.json`;
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ schema: 1, id: messageId, from: device, to, at: new Date().toISOString() }, null, 2) + '\n');
  return rel;
}

export function readAcks(repo, device) {
  const dir = path.join(repo, 'ack');
  const bySender = {};
  if (!fs.existsSync(dir)) return bySender;
  for (const sender of fs.readdirSync(dir)) {
    for (const file of listJson(path.join(dir, sender))) {
      const ack = readAll(file);
      if (ack) bySender[ack.id] = ack;
    }
  }
  return bySender;
}

export function writeHeartbeat(repo, state) {
  const rel = `state/${state.device}/heartbeat.json`;
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(state, null, 2) + '\n');
  return rel;
}

export function readHeartbeats(repo) {
  const dir = path.join(repo, 'state');
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const device of fs.readdirSync(dir)) {
    const hb = readAll(path.join(dir, device, 'heartbeat.json'));
    if (hb) out[device] = hb;
  }
  return out;
}

export function compose(options) {
  return buildMessage(options);
}

export function check(msg) {
  return validateMessage(msg);
}

export function send(repo, cfg, { to, kind = 'prompt', body, replyTo = null, attachments = [], host = null, dryRun = false }) {
  const msg = buildMessage({ from: cfg.device, to, kind, body, replyTo, attachments, host });
  if (dryRun) return { status: 'dry-run', id: msg.id, bytes: msg.body_bytes };

  const unlock = git.lock(repo);
  try {
    // 离线也要能把消息写进本地仓库；pull 失败继续，等 push 决定是否需要排队
    try { git.pull(repo); } catch {}
    const rel = writeMessage(repo, msg);
    git.commitAll(repo, `bus: ${cfg.device} -> ${to} ${msg.id.slice(-8)}`);
    const res = git.push(repo);
    if (!res.ok) {
      queueOutbox(cfg, msg);
      return { status: 'queued', id: msg.id, bytes: msg.body_bytes, file: rel, error: res.error };
    }
    return { status: 'sent', id: msg.id, bytes: msg.body_bytes, file: rel, commit: git.head(repo) };
  } finally {
    unlock();
  }
}

function queueOutbox(cfg, msg) {
  const dir = path.join(process.env.DSH_BUS_HOME || path.join(process.env.USERPROFILE || process.env.HOME, '.dsh-bus'), 'outbox');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${msg.id}.json`), JSON.stringify(msg, null, 2) + '\n');
}

export function flushOutbox(repo, cfg) {
  const home = process.env.DSH_BUS_HOME || path.join(process.env.USERPROFILE || process.env.HOME, '.dsh-bus');
  const dir = path.join(home, 'outbox');
  if (!fs.existsSync(dir)) return { flushed: 0 };
  const files = listJson(dir);
  if (!files.length) return { flushed: 0 };
  const unlock = git.lock(repo);
  let flushed = 0;
  try {
    try { git.pull(repo); } catch {}

    for (const file of files) {
      const msg = readAll(file);
      if (!msg) {
        fs.rmSync(file, { force: true });
        continue;
      }
      writeMessage(repo, msg);
    }
    git.commitAll(repo, `bus: ${cfg.device} flush ${files.length}`);
    const res = git.push(repo);
    if (res.ok) {
      for (const file of files) fs.rmSync(file, { force: true });
      flushed = files.length;
    }
    return { flushed, pushed: res.ok };
  } finally {
    unlock();
  }
}
